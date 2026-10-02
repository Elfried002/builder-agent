"""Journal de preuves (`04_EXECUTION/03_EVIDENCE.md`).

Une entrée de preuve décrit une opération **réellement** exécutée, avec son statut réel. Le
magasin n'offre ni réécriture ni suppression : une correction ajoute une entrée.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from codidev.ids import new_id, utc_now_iso
from codidev.journal import ChainedJournal, IntegrityReport
from codidev.statuses import OperationStatus


@dataclass(frozen=True, slots=True)
class ValidationOutcome:
    """Critères de vérification attachés à une preuve."""

    criteria: tuple[str, ...]
    performed: bool
    passed: bool

    def to_dict(self) -> dict[str, Any]:
        return {"criteria": list(self.criteria), "performed": self.performed, "passed": self.passed}


class EvidenceStore(ChainedJournal):
    """Magasin de preuves append-only, chaîné et validé par contrat."""

    contract = "evidence"

    @staticmethod
    def new_evidence_id() -> str:
        """Identifiant de preuve."""
        return new_id("ev")

    def record(
        self,
        operation: str,
        status: OperationStatus,
        *,
        actor: str | None = None,
        tenant_id: str | None = None,
        project_id: str | None = None,
        tool: str | None = None,
        resource: str | None = None,
        commands: list[str] | None = None,
        files: list[str] | None = None,
        tests: list[dict[str, Any]] | None = None,
        security: list[dict[str, Any]] | None = None,
        errors: list[str] | None = None,
        warnings: list[str] | None = None,
        external_ids: dict[str, str] | None = None,
        validation: ValidationOutcome | None = None,
        started_at: str | None = None,
        completed_at: str | None = None,
        evidence_id: str | None = None,
    ) -> dict[str, Any]:
        """Construit et ajoute une entrée de preuve."""
        record: dict[str, Any] = {
            "evidence_id": evidence_id or self.new_evidence_id(),
            "operation": operation,
            "status": status.value,
            "recorded_at": utc_now_iso(),
        }
        optional: dict[str, Any] = {
            "actor": actor,
            "tenant_id": tenant_id,
            "project_id": project_id,
            "tool": tool,
            "resource": resource,
            "started_at": started_at,
            "completed_at": completed_at,
        }
        record.update({key: value for key, value in optional.items() if value is not None})
        for key, value in (
            ("commands", commands),
            ("files", files),
            ("tests", tests),
            ("security", security),
            ("errors", errors),
            ("warnings", warnings),
            ("external_ids", external_ids),
        ):
            if value:
                record[key] = value
        if validation is not None:
            record["validation"] = validation.to_dict()
        return self.append(record)

    def verify(self) -> IntegrityReport:
        """Vérifie l'intégrité de la chaîne et la conformité au contrat de chaque entrée."""
        return super().verify()
