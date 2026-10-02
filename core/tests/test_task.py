"""Tests du Task Engine : transitions, vérification obligatoire, observabilité."""

from __future__ import annotations

import pytest

from codidev.audit import AuditLedger
from codidev.errors import TaskTransitionError, VerificationRequiredError
from codidev.evidence import EvidenceStore, ValidationOutcome
from codidev.statuses import OperationStatus, RiskClass, TaskState
from codidev.task import TaskEngine


@pytest.fixture
def evidence(tmp_path):
    return EvidenceStore(tmp_path / "preuves.jsonl")


@pytest.fixture
def audit(tmp_path):
    return AuditLedger(tmp_path / "audit.jsonl")


def _engine(evidence=None, audit=None) -> TaskEngine:
    return TaskEngine(evidence=evidence, audit=audit)


def _verification() -> ValidationOutcome:
    return ValidationOutcome(criteria=("les tests passent",), performed=True, passed=True)


def test_ouverture_en_brouillon() -> None:
    task = _engine().open("corriger le module", tenant_id="tenant-a")
    assert task.state is TaskState.DRAFT
    assert len(task.history) == 1
    assert task.history[0].from_state is None
    assert task.history[0].to_state is TaskState.DRAFT


def test_tache_sans_objectif_refusee() -> None:
    with pytest.raises(TaskTransitionError):
        _engine().open("   ")


def test_transition_non_autorisee_refusee() -> None:
    moteur = _engine()
    task = moteur.open("corriger le module")
    with pytest.raises(TaskTransitionError):
        moteur.transition(task, TaskState.COMPLETED)


def test_parcours_nominal_jusqua_la_verification() -> None:
    moteur = _engine()
    task = moteur.open("corriger le module")
    moteur.transition(task, TaskState.ANALYZING)
    moteur.transition(task, TaskState.PROPOSED)
    moteur.transition(task, TaskState.IN_PROGRESS)
    moteur.transition(task, TaskState.EXECUTED)
    moteur.transition(task, TaskState.VERIFYING)
    moteur.transition(task, TaskState.VERIFIED, validation=_verification())
    moteur.transition(task, TaskState.READY)
    moteur.transition(task, TaskState.COMPLETED)
    assert task.state is TaskState.COMPLETED
    assert task.is_terminal is True


def test_verification_sans_preuve_refusee() -> None:
    moteur = _engine()
    task = moteur.open("corriger le module")
    for etat in (
        TaskState.ANALYZING,
        TaskState.PROPOSED,
        TaskState.IN_PROGRESS,
        TaskState.EXECUTED,
        TaskState.VERIFYING,
    ):
        moteur.transition(task, etat)
    with pytest.raises(VerificationRequiredError):
        moteur.transition(task, TaskState.VERIFIED)


def test_verification_echouee_refusee() -> None:
    moteur = _engine()
    task = moteur.open("corriger le module")
    for etat in (
        TaskState.ANALYZING,
        TaskState.PROPOSED,
        TaskState.IN_PROGRESS,
        TaskState.EXECUTED,
        TaskState.VERIFYING,
    ):
        moteur.transition(task, etat)
    echec = ValidationOutcome(criteria=("les tests passent",), performed=True, passed=False)
    with pytest.raises(VerificationRequiredError):
        moteur.transition(task, TaskState.VERIFIED, validation=echec)


def test_verification_non_executee_refusee() -> None:
    moteur = _engine()
    task = moteur.open("corriger le module")
    for etat in (
        TaskState.ANALYZING,
        TaskState.PROPOSED,
        TaskState.IN_PROGRESS,
        TaskState.EXECUTED,
        TaskState.VERIFYING,
    ):
        moteur.transition(task, etat)
    non_executee = ValidationOutcome(criteria=("les tests passent",), performed=False, passed=False)
    with pytest.raises(VerificationRequiredError):
        moteur.transition(task, TaskState.VERIFIED, validation=non_executee)


def test_une_tache_terminee_nevolue_plus() -> None:
    moteur = _engine()
    task = moteur.open("corriger le module")
    moteur.transition(task, TaskState.CANCELLED, reason="annulée par l'utilisateur")
    with pytest.raises(TaskTransitionError):
        moteur.transition(task, TaskState.IN_PROGRESS)


def test_attente_dapprobation_observable() -> None:
    moteur = _engine()
    task = moteur.open("déployer", risk_class=RiskClass.DEPLOYMENT)
    moteur.transition(task, TaskState.ANALYZING)
    moteur.transition(task, TaskState.PROPOSED)
    moteur.transition(task, TaskState.WAITING_FOR_USER, reason="approbation requise")
    assert task.state is TaskState.WAITING_FOR_USER
    assert task.history[-1].reason == "approbation requise"


def test_blocage_par_la_politique() -> None:
    moteur = _engine()
    task = moteur.open("modifier un fichier interdit")
    moteur.transition(task, TaskState.ANALYZING)
    moteur.transition(task, TaskState.BLOCKED, reason="hors périmètre")
    assert task.state is TaskState.BLOCKED


def test_historique_observable_et_sequence() -> None:
    moteur = _engine()
    task = moteur.open("corriger le module")
    moteur.transition(task, TaskState.ANALYZING)
    moteur.transition(task, TaskState.PROPOSED)
    assert [event.seq for event in task.history] == [0, 1, 2]
    assert [event.to_state for event in task.history] == [
        TaskState.DRAFT,
        TaskState.ANALYZING,
        TaskState.PROPOSED,
    ]


def test_les_transitions_sont_consignees_dans_les_preuves(evidence, audit) -> None:
    moteur = _engine(evidence=evidence, audit=audit)
    task = moteur.open("corriger le module", tenant_id="tenant-a")
    moteur.transition(task, TaskState.ANALYZING)
    moteur.transition(task, TaskState.PROPOSED)

    assert evidence.count() == 3
    assert audit.count() == 3
    assert evidence.verify().ok
    assert audit.verify().ok

    entrees = list(evidence.records())
    assert entrees[0]["operation"] == "task.open:DRAFT"
    assert entrees[1]["status"] == OperationStatus.EXECUTED.value
    assert entrees[1]["resource"] == f"task:{task.task_id}"

    audit_entrees = list(audit.records())
    assert audit_entrees[0]["action"] == "task.open:DRAFT"
    assert audit_entrees[0]["tenant_id"] == "tenant-a"
    assert audit_entrees[0]["evidence_id"] == entrees[0]["evidence_id"]


def test_attente_consignee_avec_le_bon_statut(evidence) -> None:
    moteur = _engine(evidence=evidence)
    task = moteur.open("déployer")
    moteur.transition(task, TaskState.ANALYZING)
    moteur.transition(task, TaskState.PROPOSED)
    moteur.transition(task, TaskState.WAITING_FOR_USER)
    dernier = list(evidence.records())[-1]
    assert dernier["status"] == OperationStatus.WAITING_FOR_USER.value


def test_tache_conforme_au_contrat() -> None:
    from codidev.contracts import is_valid

    task = _engine().open("corriger le module", tenant_id="tenant-a")
    assert is_valid("task", task.to_dict())
