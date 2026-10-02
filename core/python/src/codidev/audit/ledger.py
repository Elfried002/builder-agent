"""Journal d'audit (`13_OPERATIONS/03_AUDIT.md`).

Consigne qui, pour quel tenant et quel projet, a fait quoi, sur quelle ressource, quand, à quel
niveau de risque, avec quelle décision de politique, quelle approbation, quel outil, quel
résultat et quelle preuve. Le journal est append-only, chaîné par hachage, et numéroté de façon
strictement croissante.
"""

from __future__ import annotations

from typing import Any

from codidev.ids import utc_now_iso
from codidev.journal import ChainedJournal, IntegrityIssue, IntegrityReport
from codidev.statuses import OperationStatus, RiskClass


class AuditLedger(ChainedJournal):
    """Journal d'audit append-only, chaîné et à séquence strictement croissante."""

    contract = "audit_record"

    def _prepare(self, candidate: dict[str, Any]) -> None:
        """Impose la séquence : `seq` est attribué par le journal, jamais par l'appelant."""
        last = self.last_record()
        candidate["seq"] = 0 if last is None else int(last["seq"]) + 1
        candidate["timestamp"] = candidate.get("timestamp") or utc_now_iso()

    def _check(self, record: dict[str, Any], index: int, report: IntegrityReport) -> None:
        """Vérifie la continuité de la séquence depuis 0."""
        if record.get("seq") != index:
            report.issues.append(
                IntegrityIssue(
                    index=index,
                    code="SEQUENCE_GAP",
                    detail=f"seq attendu {index}, trouvé {record.get('seq')!r}",
                )
            )

    def record_action(
        self,
        *,
        actor: str,
        action: str,
        resource: str,
        risk_class: RiskClass,
        result: OperationStatus | str,
        tenant_id: str | None = None,
        project_id: str | None = None,
        policy_decision_id: str | None = None,
        approval_id: str | None = None,
        tool: str | None = None,
        evidence_id: str | None = None,
        timestamp: str | None = None,
    ) -> dict[str, Any]:
        """Construit et ajoute une entrée d'audit."""
        record: dict[str, Any] = {
            "seq": 0,  # réattribué par `_prepare`
            "timestamp": timestamp or utc_now_iso(),
            "actor": actor,
            "action": action,
            "resource": resource,
            "risk_class": risk_class.value,
            "result": result.value if isinstance(result, OperationStatus) else result,
        }
        for key, value in (
            ("tenant_id", tenant_id),
            ("project_id", project_id),
            ("policy_decision_id", policy_decision_id),
            ("approval_id", approval_id),
            ("tool", tool),
            ("evidence_id", evidence_id),
        ):
            record[key] = value
        return self.append(record)
