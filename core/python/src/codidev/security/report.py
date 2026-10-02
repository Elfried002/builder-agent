"""Modèle de rapport de sécurité : constatations, sévérités et exécutions d'outils.

Aucune constatation n'est inventée : chaque `Finding` provient d'une règle réellement appliquée
ou d'une sortie d'outil réellement lue.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from codidev.statuses import Severity, ToolRunState

if TYPE_CHECKING:  # pragma: no cover - import de typage uniquement, évite un cycle à l'exécution
    from codidev.security.allowlist import SuppressedFinding


@dataclass(frozen=True, slots=True)
class Finding:
    """Constatation de sécurité située."""

    rule: str
    severity: Severity
    source: str
    message: str
    line: int | None = None
    column: int | None = None
    excerpt: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "rule": self.rule,
            "severity": self.severity.value,
            "source": self.source,
            "message": self.message,
            "line": self.line,
            "column": self.column,
            "excerpt": self.excerpt,
        }


@dataclass(frozen=True, slots=True)
class ToolRun:
    """Trace d'exécution d'un outil de sécurité externe.

    `state` distingue explicitement l'exécution réelle (`EXECUTED`), l'absence d'outil
    (`NOT_EXECUTED`) et l'échec (`FAILED`) : un outil indisponible n'est jamais compté comme vert.
    """

    tool: str
    state: ToolRunState
    detail: str = ""
    exit_code: int | None = None
    command: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "tool": self.tool,
            "state": self.state.value,
            "detail": self.detail,
            "exit_code": self.exit_code,
            "command": list(self.command),
        }


@dataclass(slots=True)
class SecurityReport:
    """Rapport agrégé d'une campagne de scan."""

    target: str
    findings: list[Finding] = field(default_factory=list)
    tool_runs: list[ToolRun] = field(default_factory=list)
    suppressed: list[SuppressedFinding] = field(default_factory=list)

    def add_finding(self, finding: Finding) -> None:
        self.findings.append(finding)

    def extend(self, findings: list[Finding]) -> None:
        self.findings.extend(findings)

    def add_tool_run(self, run: ToolRun) -> None:
        self.tool_runs.append(run)

    def add_suppressed(self, suppressed: list[SuppressedFinding]) -> None:
        """Consigne les constatations couvertes par une exception revue (jamais masquées)."""
        self.suppressed.extend(suppressed)

    def counts_by_severity(self) -> dict[str, int]:
        counts = {severity.value: 0 for severity in Severity}
        for finding in self.findings:
            counts[finding.severity.value] += 1
        return counts

    def max_severity(self) -> Severity | None:
        if not self.findings:
            return None
        return max((finding.severity for finding in self.findings), key=lambda sev: sev.rank)

    def tools_not_executed(self) -> list[str]:
        return [run.tool for run in self.tool_runs if run.state is not ToolRunState.EXECUTED]

    def to_dict(self) -> dict[str, Any]:
        return {
            "target": self.target,
            "counts": self.counts_by_severity(),
            "max_severity": self.max_severity().value if self.max_severity() else None,
            "findings": [finding.to_dict() for finding in self.findings],
            "tool_runs": [run.to_dict() for run in self.tool_runs],
            "tools_not_executed": self.tools_not_executed(),
            "suppressed": [item.to_dict() for item in self.suppressed],
        }
