"""Planner — construction et révision de plans d'ingénierie.

`03_AGENT_CORE/02_PLANNER.md` : un plan porte objectif, exigences, hypothèses, dépendances,
étapes ordonnées, sorties attendues, risque, permissions, critères de vérification et rollback.
Il **évolue** quand l'exécution produit des faits nouveaux — une révision ne réécrit jamais
l'historique, elle produit une nouvelle version qui déclare celle qu'elle remplace.

Les invariants ne sont pas décoratifs : un plan sans critère de vérification est un plan qui ne
pourra jamais être déclaré terminé, et une étape destructive sans rollback est un aller simple.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

from codidev.contracts import validate
from codidev.errors import ContractError, PlanInvalidError
from codidev.ids import new_id, utc_now_iso
from codidev.statuses import RiskClass


class PlanStatus(StrEnum):
    """Cycle de vie d'un plan."""

    DRAFT = "DRAFT"
    PROPOSED = "PROPOSED"
    APPROVED = "APPROVED"
    SUPERSEDED = "SUPERSEDED"
    ABANDONED = "ABANDONED"


#: Classes de risque qui imposent un chemin de retour arrière explicite.
ROLLBACK_REQUIRED: frozenset[RiskClass] = frozenset(
    {RiskClass.DESTRUCTIVE, RiskClass.DEPLOYMENT, RiskClass.SENSITIVE_WRITE}
)


@dataclass(frozen=True, slots=True)
class PlanStep:
    """Étape de plan : ce qui sera fait, ce qui en est attendu, et comment on le vérifiera."""

    step_id: str
    order: int
    description: str
    expected_output: str
    risk_class: RiskClass
    verification: tuple[str, ...]
    depends_on: tuple[str, ...] = ()
    rollback: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "step_id": self.step_id,
            "order": self.order,
            "description": self.description,
            "expected_output": self.expected_output,
            "risk_class": self.risk_class.value,
            "depends_on": list(self.depends_on),
            "verification": list(self.verification),
            "rollback": self.rollback,
        }


def step(
    description: str,
    *,
    expected_output: str,
    verification: tuple[str, ...] | list[str],
    risk_class: RiskClass = RiskClass.WRITE,
    depends_on: tuple[str, ...] | list[str] = (),
    rollback: str | None = None,
    step_id: str | None = None,
) -> PlanStep:
    """Construit une étape ; l'ordre est attribué par le plan, pas par l'appelant."""
    return PlanStep(
        step_id=step_id or new_id("step"),
        order=0,
        description=description,
        expected_output=expected_output,
        risk_class=risk_class,
        verification=tuple(verification),
        depends_on=tuple(depends_on),
        rollback=rollback,
    )


@dataclass(slots=True)
class Plan:
    """Plan d'ingénierie versionné."""

    objective: str
    steps: list[PlanStep]
    plan_id: str = field(default_factory=lambda: new_id("plan"))
    version: int = 1
    status: PlanStatus = PlanStatus.DRAFT
    supersedes: str | None = None
    requirements: list[str] = field(default_factory=list)
    assumptions: list[str] = field(default_factory=list)
    dependencies: list[str] = field(default_factory=list)
    risks: list[str] = field(default_factory=list)
    rollback: str | None = None
    verification_criteria: list[str] = field(default_factory=list)
    tenant_id: str | None = None
    project_id: str | None = None
    task_id: str | None = None
    intent_id: str | None = None
    created_at: str = field(default_factory=utc_now_iso)

    @property
    def permissions(self) -> tuple[RiskClass, ...]:
        """Permissions exigées : union des classes de risque des étapes, jamais déclarée."""
        seen: list[RiskClass] = []
        for item in self.steps:
            if item.risk_class not in seen:
                seen.append(item.risk_class)
        return tuple(seen)

    @property
    def requires_approval(self) -> bool:
        """Vrai si au moins une étape exige une approbation humaine."""
        return any(item.risk_class.requires_human_approval() for item in self.steps)

    def ordered_steps(self) -> list[PlanStep]:
        """Étapes dans l'ordre d'exécution."""
        return sorted(self.steps, key=lambda item: item.order)

    def to_dict(self) -> dict[str, Any]:
        return {
            "plan_id": self.plan_id,
            "objective": self.objective,
            "version": self.version,
            "supersedes": self.supersedes,
            "status": self.status.value,
            "requirements": list(self.requirements),
            "assumptions": list(self.assumptions),
            "dependencies": list(self.dependencies),
            "steps": [item.to_dict() for item in self.ordered_steps()],
            "risks": list(self.risks),
            "permissions": [item.value for item in self.permissions],
            "verification_criteria": list(self.verification_criteria),
            "rollback": self.rollback,
            "tenant_id": self.tenant_id,
            "project_id": self.project_id,
            "task_id": self.task_id,
            "intent_id": self.intent_id,
            "created_at": self.created_at,
        }

    def validate(self) -> None:
        """Valide la structure contre le contrat, puis les invariants métier.

        Les deux familles de règles produisent la même erreur : pour un appelant, un plan est
        valide ou il ne l'est pas — la distinction schéma / invariants est interne au cœur.
        """
        try:
            validate("plan", self.to_dict())
        except ContractError as erreur:
            raise PlanInvalidError(
                "plan non conforme à son contrat",
                violations=list(erreur.context.get("violations", [])),
            ) from erreur
        violations = invariant_violations(self)
        if violations:
            raise PlanInvalidError("plan non conforme à ses invariants", violations=violations)


def invariant_violations(plan: Plan) -> list[str]:
    """Contrôles qu'un schéma ne peut pas exprimer : ordre, dépendances, rollback, version.

    Ces règles portent sur les relations entre étapes, pas sur la forme d'un document : elles
    doivent être vérifiées par du code, et le sont ici, une fois, pour tout le cœur.
    """
    violations: list[str] = []

    if not plan.steps:
        violations.append("un plan doit contenir au moins une étape")
    if not plan.verification_criteria:
        violations.append("un plan doit déclarer au moins un critère de vérification global")

    orders = [item.order for item in plan.steps]
    attendus = list(range(1, len(plan.steps) + 1))
    if sorted(orders) != attendus:
        violations.append(
            f"l'ordre des étapes doit être contigu à partir de 1 (reçu : {sorted(orders)})"
        )
    identifiants = [item.step_id for item in plan.steps]
    if len(set(identifiants)) != len(identifiants):
        violations.append("identifiants d'étape dupliqués")

    par_id = {item.step_id: item for item in plan.steps}
    for item in plan.steps:
        if not item.verification:
            violations.append(f"étape {item.step_id} sans critère de vérification")
        for dependance in item.depends_on:
            cible = par_id.get(dependance)
            if cible is None:
                violations.append(
                    f"étape {item.step_id} dépend d'une étape inconnue : {dependance}"
                )
            elif cible.order >= item.order:
                violations.append(
                    f"étape {item.step_id} dépend d'une étape non antérieure : {dependance}"
                )
        if item.risk_class in ROLLBACK_REQUIRED and not (item.rollback or plan.rollback):
            violations.append(
                f"étape {item.step_id} ({item.risk_class.value}) exige un rollback (étape ou plan)"
            )

    if plan.version < 1:
        violations.append("la version d'un plan commence à 1")
    if plan.version > 1 and not plan.supersedes:
        violations.append("une révision doit déclarer le plan qu'elle remplace")

    return violations


class Planner:
    """Crée, valide et révise des plans."""

    def create(
        self,
        objective: str,
        steps: Sequence[PlanStep],
        *,
        requirements: Sequence[str] | None = None,
        assumptions: Sequence[str] | None = None,
        dependencies: Sequence[str] | None = None,
        risks: Sequence[str] | None = None,
        verification_criteria: Sequence[str] | None = None,
        rollback: str | None = None,
        tenant_id: str | None = None,
        project_id: str | None = None,
        task_id: str | None = None,
        intent_id: str | None = None,
    ) -> Plan:
        """Crée un plan, numérote ses étapes dans l'ordre donné et le valide avant de le rendre."""
        if not objective or not objective.strip():
            raise PlanInvalidError("un plan sans objectif est refusé")
        numerotees = [
            PlanStep(
                step_id=item.step_id,
                order=index,
                description=item.description,
                expected_output=item.expected_output,
                risk_class=item.risk_class,
                verification=item.verification,
                depends_on=item.depends_on,
                rollback=item.rollback,
            )
            for index, item in enumerate(steps, start=1)
        ]
        plan = Plan(
            objective=objective.strip(),
            steps=numerotees,
            status=PlanStatus.DRAFT,
            requirements=list(requirements or []),
            assumptions=list(assumptions or []),
            dependencies=list(dependencies or []),
            risks=list(risks or []),
            rollback=rollback,
            verification_criteria=list(verification_criteria or []),
            tenant_id=tenant_id,
            project_id=project_id,
            task_id=task_id,
            intent_id=intent_id,
        )
        plan.validate()
        return plan

    def propose(self, plan: Plan) -> Plan:
        """Passe un plan de `DRAFT` à `PROPOSED` (il n'est pas encore approuvé)."""
        if plan.status is not PlanStatus.DRAFT:
            raise PlanInvalidError(
                "seul un plan à l'état DRAFT peut être proposé",
                status=plan.status.value,
            )
        plan.status = PlanStatus.PROPOSED
        plan.validate()
        return plan

    def approve(self, plan: Plan) -> Plan:
        """Marque un plan comme approuvé — l'approbation humaine elle-même est un autre mécanisme.

        Cette méthode **consigne** une approbation déjà obtenue ; elle ne l'accorde pas. Le
        mécanisme d'approbation (Human Gate) est enregistré séparément et rattaché par identifiant.
        """
        if plan.status not in (PlanStatus.DRAFT, PlanStatus.PROPOSED):
            raise PlanInvalidError(
                "seul un plan DRAFT ou PROPOSED peut être approuvé",
                status=plan.status.value,
            )
        plan.status = PlanStatus.APPROVED
        plan.validate()
        return plan

    def revise(self, plan: Plan, *, reason: str, **changes: Any) -> Plan:
        """Produit une nouvelle version d'un plan, sans réécrire la précédente.

        La version précédente est marquée `SUPERSEDED` (dans son propre enregistrement) et la
        nouvelle la référence par `supersedes`.
        """
        if not reason or not reason.strip():
            raise PlanInvalidError("une révision sans motif est refusée")
        nouveau = Plan(
            objective=changes.get("objective", plan.objective),
            steps=list(changes.get("steps", plan.steps)),
            version=plan.version + 1,
            supersedes=plan.plan_id,
            status=PlanStatus.DRAFT,
            requirements=list(changes.get("requirements", plan.requirements)),
            assumptions=list(changes.get("assumptions", plan.assumptions)),
            dependencies=list(changes.get("dependencies", plan.dependencies)),
            risks=[*list(changes.get("risks", plan.risks)), f"révision : {reason.strip()}"],
            rollback=changes.get("rollback", plan.rollback),
            verification_criteria=list(
                changes.get("verification_criteria", plan.verification_criteria)
            ),
            tenant_id=plan.tenant_id,
            project_id=plan.project_id,
            task_id=plan.task_id,
            intent_id=plan.intent_id,
        )
        numerotees = [
            PlanStep(
                step_id=item.step_id,
                order=index,
                description=item.description,
                expected_output=item.expected_output,
                risk_class=item.risk_class,
                verification=item.verification,
                depends_on=item.depends_on,
                rollback=item.rollback,
            )
            for index, item in enumerate(nouveau.steps, start=1)
        ]
        nouveau.steps = numerotees
        nouveau.validate()
        plan.status = PlanStatus.SUPERSEDED
        return nouveau
