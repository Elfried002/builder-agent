"""Tests du Decision Engine : politique autoritaire, options tracées, obligations."""

from __future__ import annotations

import pytest

from codidev.contracts import is_valid
from codidev.decision import (
    HUMAN_GATE_OBLIGATION,
    DecisionEngine,
    PolicyVerdict,
    option,
)
from codidev.errors import ContractError
from codidev.statuses import PolicyOutcome, RiskClass


def _options() -> list:
    return [
        option(
            "réécrire le module de zéro",
            risk_class=RiskClass.DESTRUCTIVE,
            reversible=False,
            expected_outcome="module neuf",
            option_id="opt_reecrire",
        ),
        option(
            "corriger le module existant",
            risk_class=RiskClass.WRITE,
            reversible=True,
            expected_outcome="module corrigé",
            option_id="opt_corriger",
        ),
    ]


def test_la_politique_qui_refuse_interdit_toute_selection() -> None:
    verdict = PolicyVerdict.deny(policy_id="politique@v1", reason="périmètre non autorisé")
    record = DecisionEngine().decide(
        intent="modifier le module",
        options=_options(),
        policy=verdict,
        verification_plan=["les tests passent"],
    )
    assert record.selected_option_id is None
    assert record.selected is None
    assert all(item.rejected_because is not None for item in record.options)
    assert "périmètre non autorisé" in (record.rationale or "")


def test_le_risque_le_plus_faible_est_retenu_et_lautre_est_motivee() -> None:
    record = DecisionEngine().decide(
        intent="modifier le module",
        options=_options(),
        policy=PolicyVerdict.allow(policy_id="politique@v1"),
        verification_plan=["les tests passent"],
    )
    assert record.selected_option_id == "opt_corriger"
    rejetee = next(item for item in record.options if item.option_id == "opt_reecrire")
    assert rejetee.selected is False
    assert "risque supérieur" in (rejetee.rejected_because or "")


def test_la_reversibilite_departage_a_risque_egal() -> None:
    options = [
        option(
            "modifier sur place", risk_class=RiskClass.WRITE, reversible=False, option_id="opt_a"
        ),
        option(
            "modifier avec sauvegarde",
            risk_class=RiskClass.WRITE,
            reversible=True,
            option_id="opt_b",
        ),
    ]
    record = DecisionEngine().decide(
        intent="modifier",
        options=options,
        policy=PolicyVerdict.allow(policy_id="politique@v1"),
        verification_plan=["vérifier"],
    )
    assert record.selected_option_id == "opt_b"
    rejetee = next(item for item in record.options if item.option_id == "opt_a")
    assert "réversible" in (rejetee.rejected_because or "")


def test_un_verdict_qui_exige_une_approbation_ajoute_lobligation() -> None:
    verdict = PolicyVerdict.require_approval(policy_id="politique@v1", reason="action engageante")
    record = DecisionEngine().decide(
        intent="déployer",
        options=[option("déployer", risk_class=RiskClass.WRITE, option_id="opt_deployer")],
        policy=verdict,
        verification_plan=["health check vert"],
    )
    assert record.policy_outcome is PolicyOutcome.REQUIRE_APPROVAL
    assert HUMAN_GATE_OBLIGATION in record.obligations
    assert record.requires_human_gate is True


def test_une_option_risquee_impose_le_human_gate() -> None:
    """Même autorisée, une action engageante reste gatée par sa classe de risque."""
    record = DecisionEngine().decide(
        intent="purger",
        options=[
            option(
                "purger la table",
                risk_class=RiskClass.DESTRUCTIVE,
                reversible=False,
                option_id="opt_purge",
            )
        ],
        policy=PolicyVerdict.allow(policy_id="politique@v1"),
        verification_plan=["la table est vide"],
    )
    assert HUMAN_GATE_OBLIGATION in record.obligations
    assert record.requires_human_gate is True


def test_les_permissions_requises_suivent_loption_retenue() -> None:
    record = DecisionEngine().decide(
        intent="modifier",
        options=_options(),
        policy=PolicyVerdict.allow(policy_id="politique@v1"),
        verification_plan=["vérifier"],
    )
    assert record.required_permissions == [RiskClass.WRITE]


def test_en_absence_de_selection_les_permissions_exposees_sont_celles_demandees() -> None:
    record = DecisionEngine().decide(
        intent="modifier",
        options=_options(),
        policy=PolicyVerdict.deny(policy_id="politique@v1", reason="refus"),
        verification_plan=["vérifier"],
    )
    assert RiskClass.WRITE in record.required_permissions
    assert RiskClass.DESTRUCTIVE in record.required_permissions


def test_une_decision_sans_plan_de_verification_est_refusee() -> None:
    with pytest.raises(ContractError):
        DecisionEngine().decide(
            intent="modifier",
            options=_options(),
            policy=PolicyVerdict.allow(policy_id="politique@v1"),
            verification_plan=[],
        )


def test_une_decision_sans_option_est_refusee() -> None:
    with pytest.raises(ValueError):
        DecisionEngine().decide(
            intent="modifier",
            options=[],
            policy=PolicyVerdict.allow(policy_id="politique@v1"),
            verification_plan=["vérifier"],
        )


def test_le_choix_est_deterministe() -> None:
    moteur = DecisionEngine()
    kwargs = {
        "intent": "modifier",
        "options": _options(),
        "policy": PolicyVerdict.allow(policy_id="politique@v1"),
        "verification_plan": ["vérifier"],
    }
    premier = moteur.decide(**kwargs)
    second = moteur.decide(**kwargs)
    assert premier.selected_option_id == second.selected_option_id
    assert premier.rationale == second.rationale


def test_decision_conforme_au_contrat() -> None:
    record = DecisionEngine().decide(
        intent="modifier",
        options=_options(),
        policy=PolicyVerdict.allow(policy_id="politique@v1"),
        verification_plan=["vérifier"],
        sources=["docs/construction/CODIDEV_DOCUMENTATION/03_AGENT_CORE/03_DECISION_ENGINE.md"],
    )
    assert is_valid("decision", record.to_dict())


def test_les_motifs_de_politique_sont_conserves_dans_les_risques() -> None:
    verdict = PolicyVerdict.require_approval(policy_id="politique@v1", reason="action engageante")
    record = DecisionEngine().decide(
        intent="déployer",
        options=[option("déployer", risk_class=RiskClass.WRITE, option_id="opt_d")],
        policy=verdict,
        verification_plan=["health check"],
    )
    assert "action engageante" in record.risks
