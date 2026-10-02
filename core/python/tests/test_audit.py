"""Tests du journal d'audit : séquence, chaînage, altération."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from codidev.audit import AuditLedger
from codidev.hashing import GENESIS_HASH
from codidev.statuses import OperationStatus, RiskClass


def _entry(ledger: AuditLedger, action: str = "scan") -> dict:
    return ledger.record_action(
        actor="hermes",
        action=action,
        resource="src/codidev",
        risk_class=RiskClass.READ,
        result=OperationStatus.EXECUTED,
        tenant_id="tenant-a",
    )


def test_sequence_demarre_a_zero_et_croit(ledger: AuditLedger) -> None:
    first = _entry(ledger, "action-1")
    second = _entry(ledger, "action-2")
    assert first["seq"] == 0
    assert second["seq"] == 1
    assert first["prev_hash"] == GENESIS_HASH
    assert second["prev_hash"] == first["hash"]


def test_la_sequence_est_attribuee_par_le_journal(ledger: AuditLedger) -> None:
    """Un appelant ne peut pas imposer une séquence : elle est toujours recalculée."""
    record = ledger.append(
        {
            "seq": 999,
            "timestamp": "2026-10-02T20:00:00Z",
            "actor": "hermes",
            "action": "test",
            "resource": "depot",
            "risk_class": "READ",
            "result": "EXECUTED",
        }
    )
    assert record["seq"] == 0


def test_verification_dune_chaine_intacte(ledger: AuditLedger) -> None:
    for index in range(4):
        _entry(ledger, f"action-{index}")
    report = ledger.verify()
    assert report.ok
    assert report.count == 4


def test_saut_de_sequence_detecte(ledger: AuditLedger, audit_path: Path) -> None:
    for index in range(3):
        _entry(ledger, f"action-{index}")
    lines = audit_path.read_text(encoding="utf-8").splitlines()
    audit_path.write_text("\n".join([lines[0], lines[2]]) + "\n", encoding="utf-8")

    report = ledger.verify()
    assert not report.ok
    codes = {issue.code for issue in report.issues}
    assert "BROKEN_LINK" in codes or "SEQUENCE_GAP" in codes


def test_alteration_du_resultat_detectee(ledger: AuditLedger, audit_path: Path) -> None:
    _entry(ledger, "action-1")
    _entry(ledger, "action-2")
    lines = audit_path.read_text(encoding="utf-8").splitlines()
    tampered = json.loads(lines[0])
    tampered["result"] = "VERIFIED"
    lines[0] = json.dumps(tampered, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    audit_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    assert any(issue.code == "HASH_MISMATCH" for issue in ledger.verify().issues)


def test_risque_inconnu_refuse(ledger: AuditLedger) -> None:
    from codidev.errors import ContractError

    with pytest.raises(ContractError):
        ledger.append(
            {
                "seq": 0,
                "timestamp": "2026-10-02T20:00:00Z",
                "actor": "hermes",
                "action": "test",
                "resource": "depot",
                "risk_class": "TRES_RISQUE",
                "result": "EXECUTED",
            }
        )


def test_secret_caviarde_dans_l_audit(ledger: AuditLedger) -> None:
    token = "gh" + "p_" + "E1f2G3h4I5j6K7l8M9n0O1p2Q3r4S5t6U7v8"
    record = ledger.record_action(
        actor="hermes",
        action="git push",
        resource=f"https://{token}@github.com/Elfried002/codidev.git",
        risk_class=RiskClass.EXTERNAL_SIDE_EFFECT,
        result=OperationStatus.WAITING_FOR_USER,
    )
    assert token not in json.dumps(record, ensure_ascii=False)
    assert record["risk_class"] == "EXTERNAL_SIDE_EFFECT"
