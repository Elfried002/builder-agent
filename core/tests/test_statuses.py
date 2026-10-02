"""Tests des vocabulaires canoniques et des invariants opposables."""

from __future__ import annotations

import pytest

from codidev.statuses import (
    TASK_TRANSITIONS,
    GateOutcome,
    OperationStatus,
    RiskClass,
    Severity,
    TaskState,
    is_allowed_transition,
)


def test_seul_verified_implique_une_operation_terminee() -> None:
    """Principe #15 : un échec ou un blocage n'est jamais rapporté comme un succès."""
    assert OperationStatus.VERIFIED.implies_completion()
    for status in OperationStatus:
        if status is not OperationStatus.VERIFIED:
            assert not status.implies_completion(), status


def test_executed_nest_pas_un_succes() -> None:
    assert not OperationStatus.EXECUTED.implies_completion()


def test_bloque_et_echoue_sont_des_echecs_attente_nen_est_pas_un() -> None:
    assert OperationStatus.BLOCKED.is_failure()
    assert OperationStatus.FAILED.is_failure()
    assert not OperationStatus.WAITING_FOR_USER.is_failure()
    assert not OperationStatus.NOT_EXECUTED.is_failure()


def test_les_huit_classes_de_risque_sont_connues() -> None:
    assert len(RiskClass) == 8


def test_classes_risquees_exigent_une_approbation() -> None:
    attendues = {
        RiskClass.SENSITIVE_WRITE,
        RiskClass.DESTRUCTIVE,
        RiskClass.EXTERNAL_SIDE_EFFECT,
        RiskClass.DEPLOYMENT,
        RiskClass.SECURITY_SENSITIVE,
    }
    for risk_class in RiskClass:
        assert risk_class.requires_human_approval() is (risk_class in attendues), risk_class


def test_lecture_et_ecriture_ordinaire_ne_demandent_pas_dapprobation() -> None:
    assert not RiskClass.READ.requires_human_approval()
    assert not RiskClass.WRITE.requires_human_approval()
    assert not RiskClass.LOW_WRITE.requires_human_approval()


def test_transitions_autorisees() -> None:
    assert is_allowed_transition(TaskState.DRAFT, TaskState.ANALYZING)
    assert is_allowed_transition(TaskState.EXECUTED, TaskState.VERIFYING)
    assert is_allowed_transition(TaskState.VERIFYING, TaskState.VERIFIED)
    assert is_allowed_transition(TaskState.VERIFIED, TaskState.READY)
    assert is_allowed_transition(TaskState.READY, TaskState.COMPLETED)


def test_transitions_interdites() -> None:
    assert not is_allowed_transition(TaskState.DRAFT, TaskState.COMPLETED)
    assert not is_allowed_transition(TaskState.VERIFIED, TaskState.IN_PROGRESS)
    assert not is_allowed_transition(TaskState.CANCELLED, TaskState.IN_PROGRESS)
    assert not is_allowed_transition(TaskState.COMPLETED, TaskState.READY)


def test_etats_finaux_sans_sortie() -> None:
    assert TASK_TRANSITIONS[TaskState.COMPLETED] == frozenset()
    assert TASK_TRANSITIONS[TaskState.CANCELLED] == frozenset()


def test_toutes_les_cibles_de_transition_sont_des_etats_valides() -> None:
    for source, targets in TASK_TRANSITIONS.items():
        assert isinstance(source, TaskState)
        for target in targets:
            assert isinstance(target, TaskState)


def test_severites_ordonnees() -> None:
    ordonnees = sorted(Severity, key=lambda severity: severity.rank)
    assert ordonnees == [
        Severity.INFO,
        Severity.LOW,
        Severity.MEDIUM,
        Severity.HIGH,
        Severity.CRITICAL,
    ]


def test_codes_de_sortie_du_gate() -> None:
    assert GateOutcome.PASS.exit_code == 0
    assert GateOutcome.REVIEW.exit_code == 1
    assert GateOutcome.BLOCK.exit_code == 2


def test_pas_de_verification_sans_preuve_de_verification() -> None:
    """`OperationStatus` ne contient aucun statut « succès implicite » ambigu."""
    assert set(OperationStatus) == {
        OperationStatus.NOT_EXECUTED,
        OperationStatus.BLOCKED,
        OperationStatus.FAILED,
        OperationStatus.WAITING_FOR_USER,
        OperationStatus.EXECUTED,
        OperationStatus.VERIFIED,
    }
    with pytest.raises(ValueError):
        OperationStatus("SUCCESS")
