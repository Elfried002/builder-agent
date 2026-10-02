"""Tests du mécanisme d'exceptions revues (`SecurityAllowlist`)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from codidev.errors import ContractError
from codidev.security import Finding, SecurityAllowlist, SecurityReport, evaluate
from codidev.statuses import GateOutcome, Severity

ENTRY = {
    "rule": "database-url-with-credentials",
    "path": "docs/**",
    "justification": "Exemple documentaire avec identifiants factices, aucune valeur réelle.",
    "reviewed_by": "Elfried002",
    "reviewed_at": "2026-10-02T20:00:00Z",
}


def _write_allowlist(tmp_path: Path, entries: list[dict]) -> Path:
    path = tmp_path / ".codidev-security-allowlist.json"
    path.write_text(json.dumps({"version": 1, "entries": entries}), encoding="utf-8")
    return path


def _finding(source: Path, rule: str = "database-url-with-credentials") -> Finding:
    return Finding(
        rule=rule,
        severity=Severity.CRITICAL,
        source=str(source),
        line=1,
        message="constat",
    )


def test_fichier_absent_vaut_jeu_vide(tmp_path: Path) -> None:
    allowlist = SecurityAllowlist.load(tmp_path / "absent.json")
    assert allowlist.entries == []
    assert allowlist.entry_for(_finding(tmp_path), root=tmp_path) is None


def test_exception_couvre_le_chemin_declare(tmp_path: Path) -> None:
    path = _write_allowlist(tmp_path, [ENTRY])
    allowlist = SecurityAllowlist.load(path)
    cible = tmp_path / "docs" / "guide" / "exemple.md"
    cible.parent.mkdir(parents=True)
    cible.write_text("x", encoding="utf-8")
    assert allowlist.entry_for(_finding(cible), root=tmp_path) is not None


def test_exception_ne_couvre_pas_un_autre_chemin(tmp_path: Path) -> None:
    path = _write_allowlist(tmp_path, [ENTRY])
    allowlist = SecurityAllowlist.load(path)
    hors_perimetre = tmp_path / "src" / "config.py"
    hors_perimetre.parent.mkdir(parents=True)
    hors_perimetre.write_text("x", encoding="utf-8")
    assert allowlist.entry_for(_finding(hors_perimetre), root=tmp_path) is None


def test_exception_ne_couvre_pas_une_autre_regle(tmp_path: Path) -> None:
    path = _write_allowlist(tmp_path, [ENTRY])
    allowlist = SecurityAllowlist.load(path)
    cible = tmp_path / "docs" / "exemple.md"
    cible.parent.mkdir(parents=True)
    cible.write_text("x", encoding="utf-8")
    autre = Finding(rule="github-token", severity=Severity.CRITICAL, source=str(cible), message="x")
    assert allowlist.entry_for(autre, root=tmp_path) is None


def test_partition_separe_actives_et_supprimees(tmp_path: Path) -> None:
    path = _write_allowlist(tmp_path, [ENTRY])
    allowlist = SecurityAllowlist.load(path)
    couverte = tmp_path / "docs" / "exemple.md"
    couverte.parent.mkdir(parents=True)
    couverte.write_text("x", encoding="utf-8")
    autre = tmp_path / "src" / "app.py"
    autre.parent.mkdir(parents=True)
    autre.write_text("x", encoding="utf-8")

    active, suppressed = allowlist.partition([_finding(couverte), _finding(autre)], root=tmp_path)
    assert len(active) == 1
    assert len(suppressed) == 1
    assert suppressed[0].entry.justification == ENTRY["justification"]


def test_une_exception_ne_masque_pas_la_constatation_du_rapport(tmp_path: Path) -> None:
    path = _write_allowlist(tmp_path, [ENTRY])
    allowlist = SecurityAllowlist.load(path)
    cible = tmp_path / "docs" / "exemple.md"
    cible.parent.mkdir(parents=True)
    cible.write_text("x", encoding="utf-8")

    report = SecurityReport(target=str(tmp_path))
    active, suppressed = allowlist.partition([_finding(cible)], root=tmp_path)
    report.extend(active)
    report.add_suppressed(suppressed)

    payload = report.to_dict()
    assert payload["findings"] == []
    assert len(payload["suppressed"]) == 1
    assert payload["suppressed"][0]["justification"] == ENTRY["justification"]
    assert payload["suppressed"][0]["finding"]["rule"] == ENTRY["rule"]


def test_le_verdict_signale_les_constatations_supprimees(tmp_path: Path) -> None:
    path = _write_allowlist(tmp_path, [ENTRY])
    allowlist = SecurityAllowlist.load(path)
    cible = tmp_path / "docs" / "exemple.md"
    cible.parent.mkdir(parents=True)
    cible.write_text("x", encoding="utf-8")

    report = SecurityReport(target=str(tmp_path))
    active, suppressed = allowlist.partition([_finding(cible)], root=tmp_path)
    report.extend(active)
    report.add_suppressed(suppressed)

    result = evaluate(report)
    assert result.outcome is GateOutcome.PASS
    assert any("exception revue" in reason for reason in result.reasons)


def test_fichier_malforme_est_refuse(tmp_path: Path) -> None:
    path = tmp_path / ".codidev-security-allowlist.json"
    path.write_text(json.dumps({"version": 1, "entries": [{"rule": "x"}]}), encoding="utf-8")
    with pytest.raises(ContractError):
        SecurityAllowlist.load(path)


def test_fichier_json_invalide_est_refuse(tmp_path: Path) -> None:
    path = tmp_path / ".codidev-security-allowlist.json"
    path.write_text("{ceci n'est pas du json", encoding="utf-8")
    with pytest.raises(ContractError):
        SecurityAllowlist.load(path)


def test_chargement_automatique_depuis_le_perimetre(tmp_path: Path) -> None:
    _write_allowlist(tmp_path, [ENTRY])
    allowlist = SecurityAllowlist.load_for(tmp_path)
    assert len(allowlist.entries) == 1
