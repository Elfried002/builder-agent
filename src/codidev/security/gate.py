"""Security Gate : traduction d'un rapport de scan en verdict bloquant ou non.

Règle par défaut (`07_SECURITY/03_SECURITY_GATE.md`) :

    CRITICAL -> BLOCK
    HIGH     -> BLOCK
    MEDIUM   -> REVIEW
    LOW      -> WARNING
    INFO     -> INFORMATIONAL

Un prompt en langage naturel ne contourne jamais ce gate : il ne lit qu'un rapport de scan.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any

from codidev.security.report import Finding, SecurityReport
from codidev.statuses import GateOutcome, Severity, ToolRunState

#: Verdicts par sévérité.
ACTION_BLOCK = "BLOCK"
ACTION_REVIEW = "REVIEW"
ACTION_WARNING = "WARNING"
ACTION_INFORMATIONAL = "INFORMATIONAL"

DEFAULT_ACTIONS: Mapping[Severity, str] = MappingProxyType(
    {
        Severity.CRITICAL: ACTION_BLOCK,
        Severity.HIGH: ACTION_BLOCK,
        Severity.MEDIUM: ACTION_REVIEW,
        Severity.LOW: ACTION_WARNING,
        Severity.INFO: ACTION_INFORMATIONAL,
    }
)

#: Politique exigeant une revue humaine dès la moindre sévérité MEDIUM, sans bloquer la CI.
STRICT_ACTIONS: Mapping[Severity, str] = MappingProxyType(
    {
        Severity.CRITICAL: ACTION_BLOCK,
        Severity.HIGH: ACTION_BLOCK,
        Severity.MEDIUM: ACTION_REVIEW,
        Severity.LOW: ACTION_REVIEW,
        Severity.INFO: ACTION_WARNING,
    }
)


@dataclass(frozen=True, slots=True)
class GatePolicy:
    """Politique d'évaluation : associe chaque sévérité à un verdict."""

    policy_id: str
    actions: Mapping[Severity, str]

    @classmethod
    def default(cls) -> GatePolicy:
        return cls(policy_id="security-gate@v1", actions=DEFAULT_ACTIONS)

    @classmethod
    def strict(cls) -> GatePolicy:
        return cls(policy_id="security-gate-strict@v1", actions=STRICT_ACTIONS)

    @classmethod
    def by_name(cls, name: str) -> GatePolicy:
        policies = {"default": cls.default, "strict": cls.strict}
        if name not in policies:
            raise ValueError(f"politique inconnue : {name!r} (attendu : {sorted(policies)})")
        return policies[name]()

    def action_for(self, severity: Severity) -> str:
        return self.actions[severity]

    def to_dict(self) -> dict[str, Any]:
        return {
            "policy_id": self.policy_id,
            "actions": {severity.value: action for severity, action in self.actions.items()},
        }


@dataclass(frozen=True, slots=True)
class GateResult:
    """Verdict du gate, avec les motifs qui l'ont produit."""

    outcome: GateOutcome
    policy_id: str
    reasons: list[str] = field(default_factory=list)
    blocking: list[Finding] = field(default_factory=list)
    incomplete_tools: list[str] = field(default_factory=list)

    @property
    def exit_code(self) -> int:
        return self.outcome.exit_code

    def to_dict(self) -> dict[str, Any]:
        return {
            "outcome": self.outcome.value,
            "policy_id": self.policy_id,
            "exit_code": self.exit_code,
            "reasons": list(self.reasons),
            "blocking": [finding.to_dict() for finding in self.blocking],
            "incomplete_tools": list(self.incomplete_tools),
        }


def evaluate(report: SecurityReport, policy: GatePolicy | None = None) -> GateResult:
    """Évalue un rapport de scan et rend le verdict du gate.

    Un outil de sécurité qui n'a pas réellement été exécuté est signalé dans
    `incomplete_tools` : le verdict reste calculé sur ce qui a été observé, mais l'incomplétude
    est visible et ne peut pas être confondue avec un contrôle réussi.
    """
    policy = policy or GatePolicy.default()
    blocking = [
        finding
        for finding in report.findings
        if policy.action_for(finding.severity) == ACTION_BLOCK
    ]
    review = [
        finding
        for finding in report.findings
        if policy.action_for(finding.severity) == ACTION_REVIEW
    ]
    incomplete = [run.tool for run in report.tool_runs if run.state is not ToolRunState.EXECUTED]

    reasons: list[str] = []
    if blocking:
        reasons.append(
            f"{len(blocking)} constatation(s) bloquante(s) "
            f"(verdict BLOCK) — plus haute sévérité : "
            f"{max((f.severity for f in blocking), key=lambda s: s.rank).value}"
        )
    if review:
        reasons.append(f"{len(review)} constatation(s) à revoir (verdict REVIEW)")
    if incomplete:
        reasons.append(
            "outil(s) non exécuté(s), couverture incomplète : " + ", ".join(sorted(incomplete))
        )
    if report.suppressed:
        reasons.append(
            f"{len(report.suppressed)} constatation(s) supprimée(s) par exception revue "
            "(voir le rapport, jamais masquées)"
        )
    if not reasons:
        reasons.append("aucune constatation au-dessus du seuil de revue")

    if blocking:
        outcome = GateOutcome.BLOCK
    elif review:
        outcome = GateOutcome.REVIEW
    else:
        outcome = GateOutcome.PASS

    return GateResult(
        outcome=outcome,
        policy_id=policy.policy_id,
        reasons=reasons,
        blocking=blocking,
        incomplete_tools=incomplete,
    )
