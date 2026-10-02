"""Tests de l'interface en ligne de commande : codes de sortie et comportements opposables."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from codidev.cli import main
from codidev.evidence import EvidenceStore
from codidev.statuses import OperationStatus


def test_version(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["version"]) == 0
    assert "codidev" in capsys.readouterr().out


def test_contracts_list(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["contracts", "list"]) == 0
    sortie = capsys.readouterr().out
    assert "13 contrats disponibles" in sortie
    assert "evidence" in sortie


def test_contracts_show(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["contracts", "show", "risk_class"]) == 0
    schema = json.loads(capsys.readouterr().out)
    assert schema["title"] == "RiskClass"


def test_contracts_validate_accepte_un_document_conforme(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    document = tmp_path / "approval.json"
    document.write_text(
        json.dumps(
            {
                "approval_id": "appr_0123456789abcdef",
                "request_id": "req_0123456789abcdef",
                "granted_by": "Elfried002",
                "scope": {"action_id": "act_0123456789abcdef", "target": "github.com/x/y"},
                "granted_at": "2026-10-02T20:00:00Z",
                "channel": "cli",
            }
        ),
        encoding="utf-8",
    )
    assert main(["contracts", "validate", "approval", str(document)]) == 0
    assert "OK" in capsys.readouterr().out


def test_contracts_validate_refuse_un_document_non_conforme(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    document = tmp_path / "approval.json"
    document.write_text(json.dumps({"approval_id": "court"}), encoding="utf-8")
    assert main(["contracts", "validate", "approval", str(document)]) == 2
    assert "BLOQUÉ" in capsys.readouterr().err


def test_contracts_validate_fichier_illisible(tmp_path: Path) -> None:
    assert main(["contracts", "validate", "approval", str(tmp_path / "absent.json")]) == 2


def test_security_secrets_bloque_sur_un_secret(tmp_path: Path) -> None:
    token = "gh" + "p_" + "F1g2H3i4J5k6L7m8N9o0P1q2R3s4T5u6V7w8"
    (tmp_path / "config.py").write_text(f"TOKEN = '{token}'\n", encoding="utf-8")
    assert main(["security", "secrets", str(tmp_path)]) == 2


def test_security_secrets_laisse_passer_un_dossier_propre(tmp_path: Path) -> None:
    (tmp_path / "propre.txt").write_text("aucun secret ici\n", encoding="utf-8")
    assert main(["security", "secrets", str(tmp_path)]) == 0


def test_security_scan_secrets_only_respecte_le_gate(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    (tmp_path / "propre.txt").write_text("rien\n", encoding="utf-8")
    assert main(["security", "scan", str(tmp_path), "--secrets-only"]) == 0
    assert "PASS" in capsys.readouterr().out


def test_security_scan_ecrit_un_rapport_json(tmp_path: Path) -> None:
    (tmp_path / "propre.txt").write_text("rien\n", encoding="utf-8")
    rapport = tmp_path / "rapport.json"
    assert main(["security", "scan", str(tmp_path), "--secrets-only", "--json", str(rapport)]) == 0
    payload = json.loads(rapport.read_text(encoding="utf-8"))
    assert payload["gate"]["outcome"] == "PASS"
    assert payload["report"]["counts"]["CRITICAL"] == 0


def test_journal_verify_sur_un_journal_intact(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    chemin = tmp_path / "preuves.jsonl"
    store = EvidenceStore(chemin)
    store.record("opération", OperationStatus.EXECUTED, resource="src")
    assert main(["journal", "verify", str(chemin), "--contract", "evidence"]) == 0
    assert "OK" in capsys.readouterr().out


def test_journal_verify_detecte_une_alteration(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    chemin = tmp_path / "preuves.jsonl"
    store = EvidenceStore(chemin)
    store.record("opération", OperationStatus.EXECUTED, resource="src")
    contenu = json.loads(chemin.read_text(encoding="utf-8").strip())
    contenu["resource"] = "autre"
    chemin.write_text(json.dumps(contenu) + "\n", encoding="utf-8")
    assert main(["journal", "verify", str(chemin), "--contract", "evidence"]) == 2
    assert "ALTÉRÉ" in capsys.readouterr().out


def test_commande_inconnue_est_un_usage_invalide() -> None:
    with pytest.raises(SystemExit) as caught:
        main(["commande-inexistante"])
    assert caught.value.code == 2
