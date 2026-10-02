"""Tests des adaptateurs d'outils externes.

Les sorties d'outils sont des échantillons conformes à leurs formats documentés. Un outil absent
doit produire `NOT_EXECUTED` — jamais une liste vide silencieuse présentée comme un succès.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from codidev.security import tools
from codidev.statuses import Severity, ToolRunState

RUFF_PAYLOAD = json.dumps(
    [
        {
            "cell": None,
            "code": "S105",
            "end_location": {"column": 20, "row": 3},
            "filename": "app.py",
            "fix": None,
            "location": {"column": 1, "row": 3},
            "message": "Possible hardcoded password assigned to: TOKEN",
            "noqa_row": 3,
            "url": "https://docs.astral.sh/ruff/rules/hardcoded-password-string",
        },
        {
            "cell": None,
            "code": "I001",
            "end_location": {"column": 1, "row": 1},
            "filename": "app.py",
            "fix": None,
            "location": {"column": 1, "row": 1},
            "message": "Import block is un-sorted or un-formatted",
            "noqa_row": 1,
            "url": "https://docs.astral.sh/ruff/rules/unsorted-imports",
        },
    ]
)

BANDIT_PAYLOAD = json.dumps(
    {
        "errors": [],
        "results": [
            {
                "code": "1",
                "filename": "app.py",
                "issue_confidence": "HIGH",
                "issue_severity": "LOW",
                "issue_text": "Use of assert detected.",
                "line_number": 7,
                "line_range": [7],
                "test_id": "B101",
                "test_name": "assert_used",
            }
        ],
    }
)

PIP_AUDIT_PAYLOAD = json.dumps(
    {
        "dependencies": [
            {
                "name": "exemple",
                "version": "1.0.0",
                "vulns": [
                    {
                        "id": "GHSA-0000-0000-0000",
                        "fix_versions": ["1.0.1"],
                        "aliases": ["CVE-2026-0001"],
                        "description": "vulnérabilité d'exemple",
                    }
                ],
            },
            {"name": "sain", "version": "2.0.0", "vulns": []},
        ],
        "fixes": [],
    }
)


def test_analyse_ruff() -> None:
    findings = tools.parse_ruff(RUFF_PAYLOAD, Path("."))
    assert len(findings) == 2
    par_regle = {finding.rule: finding for finding in findings}
    assert par_regle["ruff:S105"].severity is Severity.HIGH
    assert par_regle["ruff:S105"].line == 3
    assert par_regle["ruff:I001"].severity is Severity.INFO


def test_analyse_bandit() -> None:
    findings = tools.parse_bandit(BANDIT_PAYLOAD)
    assert len(findings) == 1
    assert findings[0].rule == "bandit:B101"
    assert findings[0].severity is Severity.LOW
    assert findings[0].line == 7


def test_analyse_pip_audit() -> None:
    findings = tools.parse_pip_audit(PIP_AUDIT_PAYLOAD)
    assert len(findings) == 1
    assert findings[0].rule == "pip-audit:GHSA-0000-0000-0000"
    assert findings[0].severity is Severity.HIGH
    assert "1.0.1" in findings[0].message


def test_severite_inconnue_de_bandit_devient_moyenne() -> None:
    payload = json.dumps(
        {
            "results": [
                {
                    "filename": "a.py",
                    "issue_severity": "INCONNUE",
                    "issue_text": "texte",
                    "line_number": 1,
                    "test_id": "B999",
                    "test_name": "test",
                }
            ]
        }
    )
    findings = tools.parse_bandit(payload)
    assert findings[0].severity is Severity.MEDIUM


def test_outil_absent_est_non_execute(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(tools, "resolve_executable", lambda _name: None)
    findings, run = tools.run_tool("bandit", tmp_path)
    assert findings == []
    assert run.state is ToolRunState.NOT_EXECUTED
    assert "absent" in run.detail


def test_sortie_illisible_est_un_echec(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(tools, "resolve_executable", lambda _name: "/bin/echo")
    findings, run = tools.run_tool("ruff", tmp_path)
    assert findings == []
    assert run.state is ToolRunState.FAILED


def test_execution_reelle_de_ruff_sur_un_fichier_propre(tmp_path: Path) -> None:
    """Exécution réelle : si `ruff` est présent dans l'environnement, il doit tourner."""
    if tools.resolve_executable("ruff") is None:
        pytest.skip("ruff absent de l'environnement")
    (tmp_path / "propre.py").write_text(
        '"""Module."""\n\n\ndef addition(a: int, b: int) -> int:\n    """Somme."""\n'
        "    return a + b\n",
        encoding="utf-8",
    )
    findings, run = tools.run_tool("ruff", tmp_path)
    assert run.state is ToolRunState.EXECUTED
    assert findings == []


def test_outil_non_pris_en_charge(tmp_path: Path) -> None:
    with pytest.raises(KeyError):
        tools.run_tool("outil-inexistant", tmp_path)


def test_execution_de_plusieurs_outils(tmp_path: Path) -> None:
    (tmp_path / "vide.txt").write_text("", encoding="utf-8")
    findings, runs = tools.run_tools(["ruff"], tmp_path)
    assert len(runs) == 1
    assert runs[0].tool == "ruff"
    assert findings == []
