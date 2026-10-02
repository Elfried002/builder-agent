"""Tests des contrats JSON Schema et de leur alignement avec les vocabulaires Python.

Ces tests échouent si un schéma dérive du vocabulaire canonique : le contrat et le code ne
peuvent pas se contredire sans que la vérification le dise.
"""

from __future__ import annotations

from typing import Any

import pytest

from codidev.contracts import (
    SCHEMA_DIR,
    contract_path,
    is_valid,
    iter_errors,
    list_contracts,
    load_schema,
    schema_enum,
    validate,
)
from codidev.errors import ContractError
from codidev.statuses import OperationStatus, RiskClass, TaskState

EXPECTED_CONTRACTS = (
    "action",
    "approval",
    "audit_record",
    "context_bundle",
    "decision",
    "evidence",
    "intent",
    "plan",
    "policy_decision",
    "risk_class",
    "security_allowlist",
    "task",
    "tool_request",
)


def _action() -> dict[str, Any]:
    return {
        "action_id": "act_0123456789abcdef",
        "kind": "WRITE",
        "tool": "file.write",
        "target": "src/app.py",
        "tenant_id": "tenant-a",
        "requested_at": "2026-10-02T20:00:00Z",
    }


def test_tous_les_contrats_attendus_sont_presents() -> None:
    assert list_contracts() == EXPECTED_CONTRACTS
    assert len(list(SCHEMA_DIR.glob("*.json"))) == len(EXPECTED_CONTRACTS)


@pytest.mark.parametrize("name", EXPECTED_CONTRACTS)
def test_chaque_schema_a_une_identite(name: str) -> None:
    schema = load_schema(name)
    assert schema["$schema"].endswith("2020-12/schema")
    assert schema["$id"].endswith(f"/{name}.json")
    assert schema["title"]
    assert schema["type"] == "object"
    assert schema["additionalProperties"] is False
    assert schema["required"]
    assert contract_path(name).name == f"{name}.json"


def test_action_valide_est_acceptee() -> None:
    validate("action", _action())


def test_action_invalide_est_refusee_avec_localisation() -> None:
    invalid = _action()
    invalid["kind"] = "TOTALLY_UNKNOWN"
    violations = iter_errors("action", invalid)
    assert violations
    assert any("kind" in violation for violation in violations)


def test_champ_obligatoire_manquant_est_signale() -> None:
    incomplete = _action()
    del incomplete["tool"]
    violations = iter_errors("action", incomplete)
    assert any("tool" in violation for violation in violations)


def test_champ_supplementaire_est_refuse() -> None:
    extended = _action()
    extended["champ_inconnu"] = True
    assert not is_valid("action", extended)


def test_horodatage_non_conforme_est_refuse() -> None:
    bad_time = _action()
    bad_time["requested_at"] = "02/10/2026 20:00"
    assert not is_valid("action", bad_time)


def test_reference_absolue_vers_action_est_resolue_hors_ligne() -> None:
    request = {
        "request_id": "req_0123456789abcdef",
        "action": _action(),
        "identity": {"actor_id": "user-1", "actor_type": "HUMAN", "roles": ["MEMBER"]},
        "tenant_id": "tenant-a",
        "resource_scope": ["src/app.py"],
        "created_at": "2026-10-02T20:00:00Z",
    }
    validate("tool_request", request)

    request["action"] = dict(_action(), kind="NOT_A_CLASS")
    assert not is_valid("tool_request", request)


def test_enum_des_schemas_est_alignee_sur_les_vocabulaires_python() -> None:
    assert schema_enum("action", "#/$defs/risk_class") == [member.value for member in RiskClass]
    assert schema_enum("policy_decision", "#/properties/risk_class") == [
        member.value for member in RiskClass
    ]
    assert schema_enum("evidence", "#/properties/status") == [
        member.value for member in OperationStatus
    ]
    assert schema_enum("audit_record", "#/properties/result") == [
        member.value for member in OperationStatus
    ]
    assert schema_enum("task", "#/properties/state") == [member.value for member in TaskState]


def test_contrat_inconnu_est_refuse() -> None:
    with pytest.raises(ContractError):
        load_schema("contrat_inexistant")


def test_validate_leve_une_erreur_portant_les_violations() -> None:
    with pytest.raises(ContractError) as caught:
        validate("action", {"action_id": "court"})
    violations = caught.value.context["violations"]
    assert isinstance(violations, list)
    assert len(violations) >= 3
