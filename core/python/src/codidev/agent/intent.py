"""Compréhension d'une demande : intention structurée, questions ouvertes, hypothèses.

**Périmètre honnête de cette brique.** `StructuredIntentAnalyzer` ne comprend pas le langage
naturel et ne le prétend pas : il construit une intention à partir de **signaux structurés
explicites** fournis par l'appelant (ou par une couche modèle ultérieure, qui implémentera le
même `IntentAnalyzer`). Sans signal, l'intention est `UNKNOWN` avec une confiance nulle et une
question ouverte — jamais une catégorie devinée.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Protocol

from codidev.agent.request import HINT_CONSTRAINTS, HINT_INTENT_CATEGORY, Request
from codidev.context.engine import ContextBundle
from codidev.contracts import validate
from codidev.ids import new_id, utc_now_iso
from codidev.security.secrets import redact


class IntentCategory(StrEnum):
    """Nature du travail demandé."""

    CREATE_SOFTWARE = "CREATE_SOFTWARE"
    MODIFY_SOFTWARE = "MODIFY_SOFTWARE"
    ANALYZE = "ANALYZE"
    FIX = "FIX"
    SECURE = "SECURE"
    TEST = "TEST"
    DEPLOY = "DEPLOY"
    DOCUMENT = "DOCUMENT"
    UNKNOWN = "UNKNOWN"


@dataclass(frozen=True, slots=True)
class IntentRecord:
    """Intention structurée, exposable et vérifiable."""

    statement: str
    category: IntentCategory
    confidence: float
    intent_id: str = field(default_factory=lambda: new_id("intent"))
    sources: tuple[str, ...] = ()
    constraints: tuple[str, ...] = ()
    open_questions: tuple[str, ...] = ()
    assumptions: tuple[str, ...] = ()
    request_id: str | None = None
    tenant_id: str | None = None
    project_id: str | None = None
    created_at: str = field(default_factory=utc_now_iso)

    def to_dict(self) -> dict[str, Any]:
        return {
            "intent_id": self.intent_id,
            "statement": self.statement,
            "category": self.category.value,
            "confidence": self.confidence,
            "constraints": list(self.constraints),
            "sources": list(self.sources),
            "open_questions": list(self.open_questions),
            "assumptions": list(self.assumptions),
            "tenant_id": self.tenant_id,
            "project_id": self.project_id,
            "request_id": self.request_id,
            "created_at": self.created_at,
        }

    def validate(self) -> None:
        """Valide l'intention contre son contrat."""
        validate("intent", self.to_dict())


class IntentAnalyzer(Protocol):
    """Interface d'analyse d'intention. Une couche modèle l'implémentera sans changer le cœur."""

    @property
    def name(self) -> str:
        """Nom du mécanisme d'analyse, pour la traçabilité des preuves."""
        ...

    def analyze(self, request: Request, *, context: ContextBundle) -> IntentRecord: ...


@dataclass(frozen=True, slots=True)
class StructuredIntentAnalyzer:
    """Analyse déterministe à partir de signaux explicites. Ne devine rien."""

    name: str = "structured-intent-analyzer@v1"

    #: Question posée lorsqu'aucun signal ne permet d'établir la nature du travail.
    QUESTION_SANS_SIGNAL: str = (
        "nature du travail non établie : préciser la catégorie attendue "
        "(création, modification, analyse, correction, sécurisation, test, déploiement, "
        "documentation)"
    )

    def analyze(self, request: Request, *, context: ContextBundle) -> IntentRecord:
        """Construit l'intention depuis les signaux de la demande et le contexte fourni."""
        brut = request.hint(HINT_INTENT_CATEGORY)
        questions: list[str] = []
        category = IntentCategory.UNKNOWN
        confidence = 0.0

        if brut is None:
            questions.append(self.QUESTION_SANS_SIGNAL)
        else:
            try:
                category = IntentCategory(brut.upper())
            except ValueError:
                category = IntentCategory.UNKNOWN
                questions.append(
                    f"catégorie déclarée inconnue : {brut!r} — la nature du travail reste à établir"
                )
            else:
                confidence = 1.0 if category is not IntentCategory.UNKNOWN else 0.0

        contraintes = tuple(
            element.strip()
            for element in (request.hint(HINT_CONSTRAINTS) or "").split(";")
            if element.strip()
        )

        sources = [f"request:{request.request_id}"]
        sources.extend(sorted({item.source for item in context.items}))

        return IntentRecord(
            statement=redact(request.text).strip() or "(demande vide)",
            category=category,
            confidence=confidence,
            sources=tuple(sources),
            constraints=contraintes,
            open_questions=tuple(questions),
            assumptions=(
                ("aucune catégorie fournie : le travail ne peut pas être planifié sans elle",)
                if category is IntentCategory.UNKNOWN
                else ()
            ),
            request_id=request.request_id,
            tenant_id=request.tenant_id,
            project_id=request.project_id,
        )
