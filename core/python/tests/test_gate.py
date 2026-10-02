"""Tests du Security Gate : politique, verdicts, codes de sortie, incomplétude signalée."""

from __future__ import annotations

from codidev.security import Finding, GatePolicy, SecurityReport, ToolRun, evaluate
from codidev.statuses import GateOutcome, Severity, ToolRunState


def _report(*severities: Severity) -> SecurityReport:
    report = SecurityReport(target="demo")
    for index, severity in enumerate(severities):
        report.add_finding(
            Finding(rule=f"regle-{index}", severity=severity, source="f.txt", message="constat")
        )
    return report


def test_rapport_vide_passe() -> None:
    result = evaluate(_report())
    assert result.outcome is GateOutcome.PASS
    assert result.exit_code == 0


def test_critique_bloque() -> None:
    result = evaluate(_report(Severity.CRITICAL))
    assert result.outcome is GateOutcome.BLOCK
    assert result.exit_code == 2
    assert len(result.blocking) == 1


def test_haute_bloque() -> None:
    assert evaluate(_report(Severity.HIGH)).outcome is GateOutcome.BLOCK


def test_moyenne_demande_une_revue_sans_bloquer() -> None:
    result = evaluate(_report(Severity.MEDIUM))
    assert result.outcome is GateOutcome.REVIEW
    assert result.exit_code == 1


def test_basse_et_info_ne_bloquent_pas() -> None:
    assert evaluate(_report(Severity.LOW)).outcome is GateOutcome.PASS
    assert evaluate(_report(Severity.INFO)).outcome is GateOutcome.PASS


def test_la_plus_haute_severite_determine_le_verdict() -> None:
    result = evaluate(_report(Severity.LOW, Severity.CRITICAL, Severity.MEDIUM))
    assert result.outcome is GateOutcome.BLOCK
    assert "CRITICAL" in result.reasons[0]


def test_politique_stricte_demande_une_revue_des_le_niveau_bas() -> None:
    result = evaluate(_report(Severity.LOW), GatePolicy.strict())
    assert result.outcome is GateOutcome.REVIEW
    assert result.policy_id == "security-gate-strict@v1"


def test_outil_non_execute_est_signale_dans_le_verdict() -> None:
    report = _report()
    report.add_tool_run(ToolRun(tool="bandit", state=ToolRunState.NOT_EXECUTED, detail="absent"))
    result = evaluate(report)
    assert result.incomplete_tools == ["bandit"]
    assert any("couverture incomplète" in reason for reason in result.reasons)


def test_outil_execute_nest_pas_signale() -> None:
    report = _report()
    report.add_tool_run(ToolRun(tool="ruff", state=ToolRunState.EXECUTED, detail="0 constatation"))
    result = evaluate(report)
    assert result.incomplete_tools == []
    assert result.outcome is GateOutcome.PASS


def test_politique_inconnue_refusee() -> None:
    import pytest

    with pytest.raises(ValueError):
        GatePolicy.by_name("inexistante")


def test_serialisation_du_verdict() -> None:
    payload = evaluate(_report(Severity.HIGH)).to_dict()
    assert payload["outcome"] == "BLOCK"
    assert payload["exit_code"] == 2
    assert payload["policy_id"] == "security-gate@v1"
