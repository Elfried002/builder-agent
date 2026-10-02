"""Tests du magasin de preuves : contrat, chaînage, altération, caviardage."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from codidev.errors import ContractError
from codidev.evidence import EvidenceStore, ValidationOutcome
from codidev.hashing import GENESIS_HASH
from codidev.statuses import OperationStatus


def _record(store: EvidenceStore, operation: str = "verification") -> dict:
    return store.record(
        operation,
        OperationStatus.EXECUTED,
        actor="hermes",
        resource="src/codidev",
        commands=["pytest -q"],
    )


def test_premier_enregistrement_part_du_genesis(store: EvidenceStore) -> None:
    record = _record(store)
    assert record["prev_hash"] == GENESIS_HASH
    assert len(record["hash"]) == 64


def test_chaine_de_deux_enregistrements(store: EvidenceStore) -> None:
    first = _record(store, "operation-1")
    second = _record(store, "operation-2")
    assert second["prev_hash"] == first["hash"]
    assert store.count() == 2


def test_verification_dune_chaine_intacte(store: EvidenceStore) -> None:
    for index in range(5):
        _record(store, f"operation-{index}")
    report = store.verify()
    assert report.ok
    assert report.count == 5
    assert report.issues == []


def test_journal_absent_est_signale(evidence_path: Path) -> None:
    report = EvidenceStore(evidence_path).verify()
    assert not report.ok
    assert report.issues[0].code == "MISSING"


def test_alteration_du_contenu_est_detectee(store: EvidenceStore, evidence_path: Path) -> None:
    _record(store, "operation-1")
    _record(store, "operation-2")
    lines = evidence_path.read_text(encoding="utf-8").splitlines()
    tampered = json.loads(lines[1])
    tampered["operation"] = "operation-modifiee"
    lines[1] = json.dumps(tampered, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    evidence_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    report = store.verify()
    assert not report.ok
    assert any(issue.code == "HASH_MISMATCH" for issue in report.issues)


def test_suppression_dun_maillon_est_detectee(store: EvidenceStore, evidence_path: Path) -> None:
    for index in range(3):
        _record(store, f"operation-{index}")
    lines = evidence_path.read_text(encoding="utf-8").splitlines()
    evidence_path.write_text("\n".join([lines[0], lines[2]]) + "\n", encoding="utf-8")

    report = store.verify()
    assert not report.ok
    assert any(issue.code == "BROKEN_LINK" for issue in report.issues)


def test_reordonnancement_des_maillons_est_detecte(
    store: EvidenceStore, evidence_path: Path
) -> None:
    for index in range(3):
        _record(store, f"operation-{index}")
    lines = evidence_path.read_text(encoding="utf-8").splitlines()
    evidence_path.write_text("\n".join([lines[1], lines[0], lines[2]]) + "\n", encoding="utf-8")

    assert not store.verify().ok


def test_secret_caviarde_avant_ecriture(store: EvidenceStore) -> None:
    token = "gh" + "p_" + "D1e2F3g4H5i6J7k8L9m0N1o2P3q4R5s6T7u8"
    record = store.record(
        "push",
        OperationStatus.EXECUTED,
        commands=[f"git remote set-url origin https://{token}@github.com/x/y.git"],
    )
    stored = store.last_record()
    assert stored is not None
    assert token not in json.dumps(stored, ensure_ascii=False)
    assert record["hash"] == stored["hash"]


def test_enregistrement_non_conforme_est_refuse(store: EvidenceStore, evidence_path: Path) -> None:
    with pytest.raises(ContractError):
        store.append({"evidence_id": "ev_invalide"})
    assert not evidence_path.exists() or evidence_path.read_text(encoding="utf-8") == ""


def test_statut_invalide_est_refuse(store: EvidenceStore) -> None:
    record = {
        "evidence_id": "ev_0123456789abcdef",
        "operation": "operation",
        "status": "SUCCESS",
        "recorded_at": "2026-10-02T20:00:00Z",
    }
    with pytest.raises(ContractError):
        store.append(record)


def test_validation_attache_les_criteres(store: EvidenceStore) -> None:
    outcome = ValidationOutcome(
        criteria=("les tests passent", "aucun secret détecté"), performed=True, passed=True
    )
    record = store.record("phase-0", OperationStatus.VERIFIED, validation=outcome)
    assert record["validation"]["passed"] is True
    assert record["validation"]["criteria"] == ["les tests passent", "aucun secret détecté"]


def test_un_passed_sans_performed_est_refuse(store: EvidenceStore) -> None:
    record = {
        "evidence_id": "ev_0123456789abcdef",
        "operation": "operation",
        "status": "VERIFIED",
        "recorded_at": "2026-10-02T20:00:00Z",
        "validation": {"criteria": ["un critère"], "performed": False, "passed": True},
    }
    with pytest.raises(ContractError):
        store.append(record)


def test_le_journal_ne_reecrit_jamais(store: EvidenceStore, evidence_path: Path) -> None:
    """Aucune API d'écriture arbitraire : seul `append` existe, et il n'écrase rien."""
    _record(store, "operation-1")
    taille_avant = evidence_path.stat().st_size
    _record(store, "operation-2")
    assert evidence_path.stat().st_size > taille_avant
    assert store.count() == 2
    assert not hasattr(store, "delete")
    assert not hasattr(store, "update")
