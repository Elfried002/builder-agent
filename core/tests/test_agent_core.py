"""Tests de l'Agent Core : cycle complet, frontière d'exécution, traçabilité.

Ces tests verrouillent la règle la plus importante de la phase : le cœur **prépare** et ne
**revendique jamais** une exécution qu'il n'a pas faite.
"""

from __future__ import annotations

import pytest

from codidev.agent import (
    EXECUTION_BOUNDARY,
    AgentCore,
    IntentCategory,
    Request,
    StructuredIntentAnalyzer,
)
from codidev.audit import AuditLedger
from codidev.context import ContextEngine, ContextLayer, StaticProvider, TrustLevel
from codidev.decision import PolicyVerdict, option
from codidev.evidence import EvidenceStore
from codidev.planner import step
from codidev.statuses import OperationStatus, PolicyOutcome, RiskClass, TaskState


@pytest.fixture
def evidence(tmp_path):
    return EvidenceStore(tmp_path / "preuves.jsonl")


@pytest.fixture
def audit(tmp_path):
    return AuditLedger(tmp_path / "audit.jsonl")


def _core(evidence=None, audit=None, providers=()) -> AgentCore:
    return AgentCore(
        context=ContextEngine(providers=list(providers)), evidence=evidence, audit=audit
    )


def _request(**hints: str) -> Request:
    return Request(
        text="ajouter le module manquant",
        tenant_id="tenant-a",
        actor="user-1",
        project_id="projet-1",
        hints=hints,
    )


def _steps() -> list:
    analyse = step(
        "analyser le dépôt",
        expected_output="inventaire",
        verification=("l'inventaire est produit",),
        risk_class=RiskClass.READ,
    )
    ecriture = step(
        "écrire le module",
        expected_output="module ajouté",
        verification=("les tests passent",),
        risk_class=RiskClass.WRITE,
        depends_on=(analyse.step_id,),
    )
    return [analyse, ecriture]


def _options() -> list:
    return [option("écrire le module", risk_class=RiskClass.WRITE, option_id="opt_ecrire")]


def _verification_plan() -> list:
    return ["les tests passent", "le lint est vert"]


def test_demande_sans_tenant_refusee() -> None:
    with pytest.raises(ValueError):
        Request(text="x", tenant_id="", actor="user-1")


def test_demande_sans_acteur_refusee() -> None:
    with pytest.raises(ValueError):
        Request(text="x", tenant_id="tenant-a", actor="")


def test_le_texte_de_la_demande_est_caviarde() -> None:
    token = "gh" + "p_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"
    request = Request(text=f"utiliser {token}", tenant_id="tenant-a", actor="user-1")
    assert token not in request.text
    assert "REDACTED" in request.text


def test_analyse_sans_signal_laisse_lintention_indeterminee() -> None:
    analysis = _core().analyze(_request())
    assert analysis.intent.category is IntentCategory.UNKNOWN
    assert analysis.intent.confidence == 0.0
    assert analysis.is_determined is False
    assert analysis.open_questions


def test_analyse_signalee_et_determinee() -> None:
    analysis = _core().analyze(_request(intent_category="CREATE_SOFTWARE", constraints="a;b"))
    assert analysis.intent.category is IntentCategory.CREATE_SOFTWARE
    assert analysis.intent.confidence == 1.0
    assert analysis.is_determined is True
    assert analysis.intent.constraints == ("a", "b")
    assert any(source.startswith("request:") for source in analysis.intent.sources)


def test_planification_refusee_sur_intention_indeterminee() -> None:
    core = _core()
    analysis = core.analyze(_request())
    with pytest.raises(ValueError):
        core.plan(analysis, steps=_steps(), verification_criteria=["les tests passent"])


def test_cycle_nominal_prepare_et_sarrete_a_la_frontiere(evidence, audit) -> None:
    core = _core(evidence=evidence, audit=audit)
    run = core.run(
        _request(intent_category="MODIFY_SOFTWARE"),
        steps=_steps(),
        options=_options(),
        policy=PolicyVerdict.allow(policy_id="politique@v1"),
        verification_plan=_verification_plan(),
        plan_kwargs={"verification_criteria": ["les tests passent"]},
    )

    assert run.status is OperationStatus.NOT_EXECUTED
    assert run.boundary == EXECUTION_BOUNDARY
    assert "Execution Engine" in (run.boundary or "")
    assert run.task_state is TaskState.PROPOSED
    assert run.plan is not None and run.plan.status.value == "PROPOSED"
    assert run.decision is not None and run.decision.selected_option_id == "opt_ecrire"
    assert run.analysis is not None and run.analysis.is_determined is True


def test_le_cycle_nominal_ne_revendique_aucune_execution(evidence) -> None:
    core = _core(evidence=evidence)
    core.run(  # le cycle est vérifié via ses journaux, pas via son résumé
        _request(intent_category="MODIFY_SOFTWARE"),
        steps=_steps(),
        options=_options(),
        policy=PolicyVerdict.allow(policy_id="politique@v1"),
        verification_plan=_verification_plan(),
        plan_kwargs={"verification_criteria": ["les tests passent"]},
    )
    statuts = {entree["status"] for entree in evidence.records()}
    assert OperationStatus.VERIFIED.value not in statuts
    assert evidence.verify().ok


def test_politique_qui_refuse_bloque_la_tache(evidence, audit) -> None:
    core = _core(evidence=evidence, audit=audit)
    run = core.run(
        _request(intent_category="MODIFY_SOFTWARE"),
        steps=_steps(),
        options=_options(),
        policy=PolicyVerdict.deny(policy_id="politique@v1", reason="hors périmètre"),
        verification_plan=_verification_plan(),
        plan_kwargs={"verification_criteria": ["les tests passent"]},
    )
    assert run.status is OperationStatus.BLOCKED
    assert run.task_state is TaskState.BLOCKED
    assert any("hors périmètre" in note for note in run.notes)


def test_approbation_requise_met_la_tache_en_attente(evidence, audit) -> None:
    core = _core(evidence=evidence, audit=audit)
    run = core.run(
        _request(intent_category="DEPLOY"),
        steps=[
            step(
                "déployer",
                expected_output="service en ligne",
                verification=("health check vert",),
                risk_class=RiskClass.DEPLOYMENT,
                rollback="redéployer la version précédente",
            )
        ],
        options=[option("déployer", risk_class=RiskClass.DEPLOYMENT, option_id="opt_deployer")],
        policy=PolicyVerdict.require_approval(policy_id="politique@v1", reason="engageant"),
        verification_plan=["health check vert"],
        plan_kwargs={"verification_criteria": ["health check vert"]},
    )
    assert run.status is OperationStatus.WAITING_FOR_USER
    assert run.task_state is TaskState.WAITING_FOR_USER
    assert run.decision is not None
    assert run.decision.policy_outcome is PolicyOutcome.REQUIRE_APPROVAL


def test_intention_indeterminee_met_la_tache_en_attente_sans_plan(evidence) -> None:
    core = _core(evidence=evidence)
    run = core.run(
        _request(),
        steps=_steps(),
        options=_options(),
        policy=PolicyVerdict.allow(policy_id="politique@v1"),
        verification_plan=_verification_plan(),
    )
    assert run.status is OperationStatus.WAITING_FOR_USER
    assert run.plan is None
    assert run.task_id is None
    assert run.notes


def test_tout_le_cycle_est_consigne_et_verifiable(evidence, audit) -> None:
    core = _core(evidence=evidence, audit=audit)
    run = core.run(
        _request(intent_category="MODIFY_SOFTWARE"),
        steps=_steps(),
        options=_options(),
        policy=PolicyVerdict.allow(policy_id="politique@v1"),
        verification_plan=_verification_plan(),
        plan_kwargs={"verification_criteria": ["les tests passent"]},
    )
    operations = [entree["operation"] for entree in evidence.records()]
    assert run.status is OperationStatus.NOT_EXECUTED
    assert run.task_id is not None
    assert operations[0] == "agent.analyze"
    assert "agent.plan" in operations
    assert "agent.decide" in operations
    assert operations[-1] == "agent.run"
    assert any(operation.startswith("task.transition:") for operation in operations)
    assert evidence.verify().ok
    assert audit.verify().ok
    assert all(entree["tenant_id"] == "tenant-a" for entree in audit.records())


def test_le_contexte_alimente_les_sources_de_lintention() -> None:
    provider = StaticProvider(
        name="politique",
        layer=ContextLayer.SYSTEM,
        trust=TrustLevel.TRUSTED,
        entries=(("interdits", "aucun secret dans le dépôt"),),
    )
    analysis = _core(providers=[provider]).analyze(_request(intent_category="SECURE"))
    assert any("politique:interdits" in source for source in analysis.intent.sources)


def test_analyseur_structurel_documente_son_nom() -> None:
    assert StructuredIntentAnalyzer().name == "structured-intent-analyzer@v1"


def test_serialisation_du_cycle() -> None:
    core = _core()
    run = core.run(
        _request(intent_category="MODIFY_SOFTWARE"),
        steps=_steps(),
        options=_options(),
        policy=PolicyVerdict.allow(policy_id="politique@v1"),
        verification_plan=_verification_plan(),
        plan_kwargs={"verification_criteria": ["les tests passent"]},
    )
    charge = run.to_dict()
    assert charge["status"] == "NOT_EXECUTED"
    assert charge["task_state"] == "PROPOSED"
    assert charge["analysis_id"] and charge["plan_id"] and charge["decision_id"]
    assert run.analysis is not None and run.analysis.to_dict()["intent"]["category"]
