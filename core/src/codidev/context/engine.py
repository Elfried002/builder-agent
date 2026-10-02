"""Context Engine — construction, provenance et isolation du contexte.

`03_AGENT_CORE/01_CONTEXT_ENGINE.md` définit neuf couches de contexte et impose que **chaque
élément porte sa provenance, sa portée et sa classification de confiance**, et que le contexte
inter-tenant soit **interdit**. Ces deux exigences ne sont pas des commentaires : elles sont
vérifiées à l'insertion et le contrat `context_bundle` les refuse côté schéma.

Principe appliqué : la confiance ne s'élève jamais toute seule. Un contenu de projet est
`UNTRUSTED` — potentiellement hostile — tant qu'un outil ne l'a pas réellement vérifié.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Protocol

from codidev.contracts import validate
from codidev.errors import ContextIsolationError
from codidev.ids import new_id, utc_now_iso
from codidev.security.secrets import redact


class ContextLayer(StrEnum):
    """Couches de contexte, dans l'ordre de rendu (`01_CONTEXT_ENGINE.md`)."""

    SYSTEM = "SYSTEM"
    TENANT = "TENANT"
    USER = "USER"
    PROJECT = "PROJECT"
    TASK = "TASK"
    SESSION = "SESSION"
    EXTERNAL_DATA = "EXTERNAL_DATA"
    TOOL_RESULTS = "TOOL_RESULTS"
    LEARNED_KNOWLEDGE = "LEARNED_KNOWLEDGE"


class TrustLevel(StrEnum):
    """Classification de confiance d'un élément de contexte."""

    TRUSTED = "TRUSTED"
    VERIFIED = "VERIFIED"
    UNVERIFIED = "UNVERIFIED"
    UNTRUSTED = "UNTRUSTED"

    @property
    def rank(self) -> int:
        return _TRUST_RANK[self]


_TRUST_RANK: dict[TrustLevel, int] = {
    TrustLevel.UNTRUSTED: 0,
    TrustLevel.UNVERIFIED: 1,
    TrustLevel.VERIFIED: 2,
    TrustLevel.TRUSTED: 3,
}

#: Seules ces couches peuvent porter des éléments sans appartenance à un tenant : ce sont des
#: règles du système, pas des données de client. Tout le reste est tenant-scopé, sans exception.
TENANT_FREE_LAYERS: frozenset[ContextLayer] = frozenset({ContextLayer.SYSTEM})

#: Ordre de rendu déterministe : le même contexte produit toujours le même texte.
LAYER_RENDER_ORDER: tuple[ContextLayer, ...] = tuple(ContextLayer)


def trust_rank(level: TrustLevel) -> int:
    """Rang de confiance, pour comparer sans ambiguïté."""
    return level.rank


@dataclass(frozen=True, slots=True)
class ContextItem:
    """Élément de contexte situé : couche, confiance, provenance, portée."""

    item_id: str
    layer: ContextLayer
    trust: TrustLevel
    source: str
    content: str
    created_at: str
    tenant_id: str | None = None
    project_id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "item_id": self.item_id,
            "layer": self.layer.value,
            "trust": self.trust.value,
            "source": self.source,
            "content": self.content,
            "tenant_id": self.tenant_id,
            "project_id": self.project_id,
            "created_at": self.created_at,
        }


def make_item(
    *,
    layer: ContextLayer,
    trust: TrustLevel,
    source: str,
    content: str,
    tenant_id: str | None = None,
    project_id: str | None = None,
) -> ContextItem:
    """Construit un élément de contexte caviardé, horodaté et identifié."""
    if not source or not source.strip():
        raise ContextIsolationError(
            "un élément de contexte sans provenance est refusé",
            layer=layer.value,
        )
    if not content or not content.strip():
        raise ContextIsolationError("un élément de contexte vide est refusé", layer=layer.value)
    return ContextItem(
        item_id=new_id("ctx"),
        layer=layer,
        trust=trust,
        source=source.strip(),
        content=redact(content),
        tenant_id=tenant_id,
        project_id=project_id,
        created_at=utc_now_iso(),
    )


@dataclass(slots=True)
class ContextBundle:
    """Contexte assemblé pour une tâche, isolé par tenant."""

    tenant_id: str
    bundle_id: str = field(default_factory=lambda: new_id("ctxb"))
    created_at: str = field(default_factory=utc_now_iso)
    project_id: str | None = None
    task_id: str | None = None
    items: list[ContextItem] = field(default_factory=list)

    def add(self, item: ContextItem) -> ContextItem:
        """Ajoute un élément après vérification de l'isolation tenant.

        Un élément d'un autre tenant, ou un élément tenant-scopé sans tenant, est **refusé** :
        le contexte inter-tenant n'est pas une règle de bonne conduite, c'est une impossibilité.
        """
        if item.tenant_id != self.tenant_id:
            if item.tenant_id is not None:
                raise ContextIsolationError(
                    "élément de contexte d'un autre tenant refusé",
                    bundle_tenant=self.tenant_id,
                    item_tenant=item.tenant_id,
                    layer=item.layer.value,
                )
            if item.layer not in TENANT_FREE_LAYERS:
                raise ContextIsolationError(
                    "élément tenant-scopé sans tenant refusé",
                    layer=item.layer.value,
                    bundle_tenant=self.tenant_id,
                )
        self.items.append(item)
        return item

    def extend(self, items: Iterable[ContextItem]) -> None:
        """Ajoute plusieurs éléments, en rejetant le premier qui viole l'isolation."""
        for item in items:
            self.add(item)

    def by_layer(self, layer: ContextLayer) -> list[ContextItem]:
        """Éléments d'une couche, dans l'ordre d'insertion."""
        return [item for item in self.items if item.layer is layer]

    def untrusted(self) -> list[ContextItem]:
        """Éléments non fiables : contenu de projet, données externes."""
        return [item for item in self.items if item.trust is TrustLevel.UNTRUSTED]

    def render(self) -> str:
        """Rend le contexte en texte déterministe, en exposant provenance et confiance.

        Le lecteur — humain ou modèle — voit **d'où** vient chaque bloc et **à quel point** il est
        fiable. Masquer la provenance rendrait le contenu de projet indiscernable d'une
        instruction du système : c'est précisément le vecteur d'injection indirecte.
        """
        lines: list[str] = []
        for layer in LAYER_RENDER_ORDER:
            for item in self.by_layer(layer):
                lines.append(f"### {layer.value} [{item.trust.value}] source={item.source}")
                lines.append(item.content)
                lines.append("")
        return "\n".join(lines).strip()

    def to_dict(self) -> dict[str, Any]:
        return {
            "bundle_id": self.bundle_id,
            "tenant_id": self.tenant_id,
            "project_id": self.project_id,
            "task_id": self.task_id,
            "created_at": self.created_at,
            "items": [item.to_dict() for item in self.items],
        }

    def validate(self) -> None:
        """Valide le contexte assemblé contre son contrat."""
        validate("context_bundle", self.to_dict())


class ContextProvider(Protocol):
    """Source de contexte. Une implémentation réelle est fournie : `StaticProvider`.

    Les attributs sont déclarés en lecture seule : un provider immuable doit satisfaire
    l'interface sans que le cœur exige de lui qu'il soit modifiable.
    """

    @property
    def name(self) -> str: ...

    @property
    def layer(self) -> ContextLayer: ...

    @property
    def trust(self) -> TrustLevel: ...

    def items(
        self,
        *,
        tenant_id: str,
        project_id: str | None,
        request_id: str | None = None,
    ) -> Iterable[ContextItem]: ...


@dataclass(frozen=True, slots=True)
class StaticProvider:
    """Provider de contexte statique : règles système, conventions de tenant, préférences.

    Chaque entrée est un couple (provenance, contenu). Le contenu passe par le caviardage, comme
    tout élément de contexte.
    """

    name: str
    layer: ContextLayer
    trust: TrustLevel
    entries: tuple[tuple[str, str], ...]

    def items(
        self,
        *,
        tenant_id: str,
        project_id: str | None,
        request_id: str | None = None,
    ) -> Iterable[ContextItem]:
        scoped_tenant = None if self.layer in TENANT_FREE_LAYERS else tenant_id
        return [
            make_item(
                layer=self.layer,
                trust=self.trust,
                source=f"{self.name}:{source}",
                content=content,
                tenant_id=scoped_tenant,
                project_id=project_id if scoped_tenant else None,
            )
            for source, content in self.entries
        ]


class ContextEngine:
    """Assemble un contexte isolé à partir de providers et d'éléments explicites."""

    def __init__(self, providers: Sequence[ContextProvider] = ()) -> None:
        self.providers: tuple[ContextProvider, ...] = tuple(providers)

    def build(
        self,
        *,
        tenant_id: str,
        project_id: str | None = None,
        task_id: str | None = None,
        request_id: str | None = None,
        items: Sequence[ContextItem] = (),
    ) -> ContextBundle:
        """Construit un contexte : providers d'abord, éléments explicites ensuite."""
        if not tenant_id:
            raise ContextIsolationError("un contexte sans tenant est refusé")
        bundle = ContextBundle(tenant_id=tenant_id, project_id=project_id, task_id=task_id)
        for provider in self.providers:
            bundle.extend(
                provider.items(tenant_id=tenant_id, project_id=project_id, request_id=request_id)
            )
        bundle.extend(items)
        return bundle

    @staticmethod
    def build_and_validate(**kwargs: Any) -> ContextBundle:
        """Construit puis valide le contexte contre le contrat (raccourci explicite)."""
        bundle = ContextEngine().build(**kwargs)
        bundle.validate()
        return bundle
