"""Entrée d'une demande adressée au cœur.

Une demande porte du texte **et** des signaux structurés explicites. Le cœur ne devine pas :
ce qu'il ne peut pas établir devient une question ouverte ou une hypothèse déclarée, jamais une
supposition silencieuse.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from codidev.ids import new_id, utc_now_iso
from codidev.security.secrets import redact

#: Clé de signal indiquant la nature attendue du travail (`intent_category`).
HINT_INTENT_CATEGORY = "intent_category"

#: Clé de signal listant des contraintes explicites, séparées par des points-virgules.
HINT_CONSTRAINTS = "constraints"


@dataclass(frozen=True, slots=True)
class Request:
    """Demande entrante, caviardée à la construction."""

    text: str
    tenant_id: str
    actor: str
    request_id: str = field(default_factory=lambda: new_id("req"))
    created_at: str = field(default_factory=utc_now_iso)
    project_id: str | None = None
    hints: Mapping[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.tenant_id or not self.tenant_id.strip():
            raise ValueError("une demande sans tenant est refusée")
        if not self.actor or not self.actor.strip():
            raise ValueError("une demande sans acteur identifié est refusée")
        object.__setattr__(self, "text", redact(self.text))
        object.__setattr__(self, "hints", dict(self.hints))

    def hint(self, key: str) -> str | None:
        """Valeur d'un signal structuré, ou `None`."""
        value = self.hints.get(key)
        return value.strip() if isinstance(value, str) and value.strip() else None

    def to_dict(self) -> dict[str, Any]:
        return {
            "request_id": self.request_id,
            "tenant_id": self.tenant_id,
            "actor": self.actor,
            "project_id": self.project_id,
            "text": self.text,
            "hints": dict(self.hints),
            "created_at": self.created_at,
        }
