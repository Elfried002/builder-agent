"""Tests du Planner : invariants, permissions dérivées, révision versionnée."""

from __future__ import annotations

import pytest

from codidev.errors import PlanInvalidError
from codidev.planner import Plan, Planner, PlanStatus, invariant_violations, step
from codidev.statuses import RiskClass


def _planner() -> Planner:
    return Planner()


def _plan_simple(planner: Planner) -> Plan:
    etape_analyse = step(
        "analyser le dépôt",
        expected_output="inventaire des fichiers",
        verification=("la liste des fichiers est produite",),
        risk_class=RiskClass.READ,
    )
    etape_ecriture = step(
        "écrire le module manquant",
        expected_output="module ajouté et testé",
        verification=("les tests du module passent",),
        risk_class=RiskClass.WRITE,
        depends_on=(etape_analyse.step_id,),
    )
    return planner.create(
        "ajouter le module manquant",
        [etape_analyse, etape_ecriture],
        verification_criteria=("les tests passent", "le lint est vert"),
        requirements=("Python 3.12",),
        assumptions=("le dépôt est accessible",),
    )


def test_les_etapes_sont_numerotees_dans_lordre() -> None:
    plan = _plan_simple(_planner())
    assert [item.order for item in plan.steps] == [1, 2]


def test_un_plan_sans_critere_de_verification_est_refuse() -> None:
    planner = _planner()
    with pytest.raises(PlanInvalidError):
        planner.create(
            "objectif",
            [step("faire", expected_output="x", verification=("y",))],
            verification_criteria=[],
        )


def test_une_etape_sans_critere_est_refusee() -> None:
    planner = _planner()
    with pytest.raises(PlanInvalidError):
        planner.create(
            "objectif",
            [step("faire", expected_output="x", verification=())],
            verification_criteria=("global",),
        )


def test_dependance_vers_une_etape_ulterieure_refusee() -> None:
    planner = _planner()
    premiere = step("un", expected_output="a", verification=("ok",))
    seconde = step(
        "deux",
        expected_output="b",
        verification=("ok",),
        depends_on=(premiere.step_id,),
    )
    with pytest.raises(PlanInvalidError):
        # ordre inversé : la seconde devient la première et dépend d'une étape ultérieure
        planner.create("objectif", [seconde, premiere], verification_criteria=("global",))


def test_dependance_inconnue_refusee() -> None:
    planner = _planner()
    etape = step(
        "faire",
        expected_output="x",
        verification=("ok",),
        depends_on=("step_inexistant",),
    )
    with pytest.raises(PlanInvalidError):
        planner.create("objectif", [etape], verification_criteria=("global",))


def test_etape_destructive_sans_rollback_refusee() -> None:
    planner = _planner()
    with pytest.raises(PlanInvalidError) as caught:
        planner.create(
            "supprimer des données",
            [
                step(
                    "purger la table",
                    expected_output="table vide",
                    verification=("comptage à zéro",),
                    risk_class=RiskClass.DESTRUCTIVE,
                )
            ],
            verification_criteria=("le comptage est nul",),
        )
    assert any("rollback" in violation for violation in caught.value.context["violations"])


def test_etape_destructive_avec_rollback_de_plan_acceptee() -> None:
    plan = _planner().create(
        "purger des données",
        [
            step(
                "purger la table",
                expected_output="table vide",
                verification=("comptage à zéro",),
                risk_class=RiskClass.DESTRUCTIVE,
            )
        ],
        verification_criteria=("le comptage est nul",),
        rollback="restaurer la sauvegarde du 2026-10-01",
    )
    assert plan.rollback is not None


def test_permissions_derivees_des_etapes() -> None:
    plan = _plan_simple(_planner())
    assert plan.permissions == (RiskClass.READ, RiskClass.WRITE)


def test_approbation_requise_pour_les_etapes_risquees() -> None:
    plan = _planner().create(
        "déployer",
        [
            step(
                "déployer en production",
                expected_output="service en ligne",
                verification=("health check vert",),
                risk_class=RiskClass.DEPLOYMENT,
                rollback="redéployer la version précédente",
            )
        ],
        verification_criteria=("health check vert",),
    )
    assert plan.requires_approval is True


def test_seul_un_brouillon_peut_etre_propose() -> None:
    planner = _planner()
    plan = planner.propose(_plan_simple(planner))
    assert plan.status is PlanStatus.PROPOSED
    with pytest.raises(PlanInvalidError):
        planner.propose(plan)


def test_revision_produit_une_nouvelle_version_sans_reecrire_lancienne() -> None:
    planner = _planner()
    origine = _plan_simple(planner)
    nouvelle = planner.revise(origine, reason="dépendance découverte à l'exécution")

    assert nouvelle.version == 2
    assert nouvelle.supersedes == origine.plan_id
    assert nouvelle.plan_id != origine.plan_id
    assert origine.status is PlanStatus.SUPERSEDED
    assert nouvelle.status is PlanStatus.DRAFT
    assert any("révision" in risque for risque in nouvelle.risks)


def test_revision_sans_motif_refusee() -> None:
    planner = _planner()
    with pytest.raises(PlanInvalidError):
        planner.revise(_plan_simple(planner), reason="   ")


def test_une_revision_sans_supersedes_est_invalide() -> None:
    """Une version > 1 doit déclarer ce qu'elle remplace : l'historique n'est pas optionnel."""
    plan = _plan_simple(_planner())
    plan.version = 3
    plan.supersedes = None
    violations = invariant_violations(plan)
    assert any("remplace" in violation for violation in violations)


def test_identifiants_detapes_dupliques_refuses() -> None:
    planner = _planner()
    etape = step("faire", expected_output="x", verification=("ok",), step_id="step_duplique")
    with pytest.raises(PlanInvalidError):
        planner.create("objectif", [etape, etape], verification_criteria=("global",))


def test_plan_conforme_au_contrat() -> None:
    from codidev.contracts import is_valid

    plan = _plan_simple(_planner())
    assert is_valid("plan", plan.to_dict())
