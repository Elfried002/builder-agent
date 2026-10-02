"""Decision Engine — choix tracé entre options, sous contrainte de politique.

`03_AGENT_CORE/03_DECISION_ENGINE.md` exige qu'une décision importante enregistre intention,
exigences, contraintes, sources, options examinées, option retenue, risques, permissions
requises, résultat de politique et plan de vérification. Le motif est **exposable** ; le
raisonnement privé n'est pas un artefact du produit.

Deux règles opposables sont appliquées ici :

1. **La politique décide, pas la préférence.** Un verdict `DENY` interdit toute sélection : la
   décision est enregistrée, motivée, et aucun choix n'est retenu.
2. **Aucune option écartée n'est passée sous silence.** Chaque option non retenue porte son motif
   de rejet.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

from codidev.contracts import validate
from codidev.ids import new_id, utc_now_iso
from codidev.statuses import PolicyOutcome, RiskClass

#: Obligation ajoutée dès qu'un verdict exige une approbation humaine.
HUMAN_GATE_OBLIGATION = "approval:human-gate"


@dataclass(frozen=True, slots=True)
class Option:
    """Option examinée par le Decision Engine."""

    option_id: str
    description: str
    risk_class: RiskClass
    reversible: bool
    expected_outcome: str | None = None
    selected: bool = False
    rejected_because: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "option_id": self.option_id,
            "description": self.description,
            "expected_outcome": self.expected_outcome,
            "risk_class": self.risk_class.value,
            "reversible": self.reversible,
            "selected": self.selected,
            "rejected_because": self.rejected_because,
        }

    def replaced(self, *, selected: bool, rejected_because: str | None) -> Option:
        """Copie de l'option avec son sort dans la décision."""
        return Option(
            option_id=self.option_id,
            description=self.description,
            risk_class=self.risk_class,
            reversible=self.reversible,
            expected_outcome=self.expected_outcome,
            selected=selected,
            rejected_because=rejected_because,
        )


def option(
    description: str,
    *,
    risk_class: RiskClass = RiskClass.WRITE,
    reversible: bool = True,
    expected_outcome: str | None = None,
    option_id: str | None = None,
) -> Option:
    """Construit une option."""
    return Option(
        option_id=option_id or new_id("opt"),
        description=description,
        risk_class=risk_class,
        reversible=reversible,
        expected_outcome=expected_outcome,
    )


@dataclass(frozen=True, slots=True)
class PolicyVerdict:
    """Verdict d'une politique sur une action ou une décision."""

    outcome: PolicyOutcome
    policy_id: str
    reasons: tuple[str, ...] = ()
    obligations: tuple[str, ...] = ()

    @classmethod
    def allow(cls, *, policy_id: str, reason: str = "conforme à la politique") -> PolicyVerdict:
        return cls(outcome=PolicyOutcome.ALLOW, policy_id=policy_id, reasons=(reason,))

    @classmethod
    def deny(cls, *, policy_id: str, reason: str) -> PolicyVerdict:
        return cls(outcome=PolicyOutcome.DENY, policy_id=policy_id, reasons=(reason,))

    @classmethod
    def require_approval(cls, *, policy_id: str, reason: str) -> PolicyVerdict:
        return cls(
            outcome=PolicyOutcome.REQUIRE_APPROVAL,
            policy_id=policy_id,
            reasons=(reason,),
            obligations=(HUMAN_GATE_OBLIGATION,),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "outcome": self.outcome.value,
            "policy_id": self.policy_id,
            "reasons": list(self.reasons),
            "obligations": list(self.obligations),
        }


@dataclass(slots=True)
class DecisionRecord:
    """Décision structurante : ce qui a été décidé, pourquoi, et à quelles conditions."""

    intent: str
    options: list[Option]
    policy_outcome: PolicyOutcome
    risks: list[str]
    required_permissions: list[RiskClass]
    verification_plan: list[str]
    decision_id: str = field(default_factory=lambda: new_id("dec"))
    selected_option_id: str | None = None
    rationale: str | None = None
    policy_id: str | None = None
    obligations: list[str] = field(default_factory=list)
    requirements: list[str] = field(default_factory=list)
    constraints: list[str] = field(default_factory=list)
    sources: list[str] = field(default_factory=list)
    plan_id: str | None = None
    tenant_id: str | None = None
    project_id: str | None = None
    decided_at: str = field(default_factory=utc_now_iso)

    @property
    def selected(self) -> Option | None:
        """Option retenue, ou `None` si la politique a refusé."""
        for item in self.options:
            if item.option_id == self.selected_option_id:
                return item
        return None

    @property
    def requires_human_gate(self) -> bool:
        """Vrai si une approbation humaine est requise avant toute exécution."""
        return (
            self.policy_outcome is PolicyOutcome.REQUIRE_APPROVAL
            or HUMAN_GATE_OBLIGATION in self.obligations
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "decision_id": self.decision_id,
            "intent": self.intent,
            "requirements": list(self.requirements),
            "constraints": list(self.constraints),
            "sources": list(self.sources),
            "options": [item.to_dict() for item in self.options],
            "selected_option_id": self.selected_option_id,
            "rationale": self.rationale,
            "risks": list(self.risks),
            "required_permissions": [item.value for item in self.required_permissions],
            "policy_outcome": self.policy_outcome.value,
            "policy_id": self.policy_id,
            "obligations": list(self.obligations),
            "verification_plan": list(self.verification_plan),
            "plan_id": self.plan_id,
            "tenant_id": self.tenant_id,
            "project_id": self.project_id,
            "decided_at": self.decided_at,
        }

    def validate(self) -> None:
        """Valide la décision contre son contrat."""
        validate("decision", self.to_dict())


class DecisionEngine:
    """Sélectionne une option sous contrainte de politique, et trace le reste."""

    def decide(
        self,
        *,
        intent: str,
        options: Sequence[Option],
        policy: PolicyVerdict,
        verification_plan: Sequence[str],
        requirements: Sequence[str] | None = None,
        constraints: Sequence[str] | None = None,
        sources: Sequence[str] | None = None,
        risks: Sequence[str] | None = None,
        plan_id: str | None = None,
        tenant_id: str | None = None,
        project_id: str | None = None,
    ) -> DecisionRecord:
        """Rend une décision complète : choix, rejets motivés, obligations, vérification."""
        if not options:
            raise ValueError("une décision sans option examinée n'est pas une décision")

        retenue, classees, motif = self.choose(options, policy)

        permissions: list[RiskClass] = []
        source_permissions = [retenue] if retenue is not None else list(options)
        for item in source_permissions:
            if item is not None and item.risk_class not in permissions:
                permissions.append(item.risk_class)

        obligations = list(policy.obligations)
        if (
            retenue is not None
            and retenue.risk_class.requires_human_approval()
            and HUMAN_GATE_OBLIGATION not in obligations
        ):
            obligations.append(HUMAN_GATE_OBLIGATION)

        record = DecisionRecord(
            intent=intent,
            options=classees,
            policy_outcome=policy.outcome,
            risks=list(risks or []) + list(policy.reasons),
            required_permissions=permissions,
            verification_plan=list(verification_plan),
            selected_option_id=retenue.option_id if retenue else None,
            rationale=motif,
            policy_id=policy.policy_id,
            obligations=obligations,
            requirements=list(requirements or []),
            constraints=list(constraints or []),
            sources=list(sources or []),
            plan_id=plan_id,
            tenant_id=tenant_id,
            project_id=project_id,
        )
        record.validate()
        return record

    @staticmethod
    def choose(
        options: list[Option], policy: PolicyVerdict
    ) -> tuple[Option | None, list[Option], str]:
        """Choisit une option de façon déterministe et explique le sort de chacune.

        Ordre de préférence : risque le plus faible, puis réversibilité, puis identifiant (pour
        rendre le résultat reproductible à entrées égales).
        """
        if policy.outcome is PolicyOutcome.DENY:
            motif = policy.reasons[0] if policy.reasons else "refusée par la politique"
            rejetees = [
                item.replaced(selected=False, rejected_because=f"politique : {motif}")
                for item in options
            ]
            return None, rejetees, f"aucune option retenue — politique : {motif}"

        classees = sorted(
            options,
            key=lambda item: (_risk_rank(item.risk_class), not item.reversible, item.option_id),
        )
        retenue = classees[0]
        resultat: list[Option] = []
        for item in options:
            if item.option_id == retenue.option_id:
                resultat.append(item.replaced(selected=True, rejected_because=None))
                continue
            if _risk_rank(item.risk_class) > _risk_rank(retenue.risk_class):
                motif = f"risque supérieur ({item.risk_class.value} > {retenue.risk_class.value})"
            elif item.reversible is False and retenue.reversible:
                motif = "non réversible alors qu'une option réversible de risque égal existe"
            else:
                motif = "équivalente à une option retenue au même niveau de risque"
            resultat.append(item.replaced(selected=False, rejected_because=motif))
        motif_retenue = f"option retenue : risque le plus faible ({retenue.risk_class.value})" + (
            ", réversible" if retenue.reversible else ", non réversible"
        )
        if policy.outcome is PolicyOutcome.REQUIRE_APPROVAL:
            motif_retenue += f" — sous réserve d'approbation ({policy.policy_id})"
        return retenue, resultat, motif_retenue


def _risk_rank(risk_class: RiskClass) -> int:
    return list(RiskClass).index(risk_class)
