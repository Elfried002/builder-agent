"""Agent Core — coordination du cycle de travail du cœur.

`03_AGENT_CORE/00_AGENT_CORE.md` : l'Agent Core coordonne la compréhension de l'intention, la
construction du contexte, la planification, le contrôle des décisions, l'exécution des tâches et
la production de réponses appuyées par des preuves.

**Frontière de cette phase.** Le cœur s'arrête à la frontière d'exécution : l'Execution Engine
n'est pas construit. `AgentCore.run()` prépare, vérifie et gèle une tâche — il **n'exécute aucun
outil** et ne prétend pas l'avoir fait. Le statut renvoyé est `NOT_EXECUTED` tant qu'aucun moteur
d'exécution n'existe, `WAITING_FOR_USER` si une approbation est requise, `BLOCKED` si la politique
refuse.

Ce module **n'est pas une API** : c'est du code appelé en processus, par le projet lui-même.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from codidev.agent.intent import IntentAnalyzer, IntentRecord, StructuredIntentAnalyzer
from codidev.agent.request import Request
from codidev.audit.ledger import AuditLedger
from codidev.context.engine import ContextBundle, ContextEngine, ContextItem
from codidev.decision.engine import DecisionEngine, DecisionRecord, Option, PolicyVerdict
from codidev.evidence.store import EvidenceStore, ValidationOutcome
from codidev.ids import new_id, utc_now_iso
from codidev.planner.planner import Plan, Planner, PlanStep
from codidev.statuses import OperationStatus, PolicyOutcome, RiskClass, TaskState
from codidev.task.engine import Task, TaskEngine

#: Frontière déclarée : ce que le cœur ne fait pas encore, dit explicitement.
EXECUTION_BOUNDARY = (
    "frontière d'exécution : l'Execution Engine (Tool Router, Workspace, exécution contrôlée) "
    "n'est pas construit — aucune action n'a été exécutée"
)


@dataclass(frozen=True, slots=True)
class Analysis:
    """Résultat de la phase de compréhension : intention, contexte, incertitudes."""

    request_id: str
    intent: IntentRecord
    context: ContextBundle
    analysis_id: str = field(default_factory=lambda: new_id("anal"))
    created_at: str = field(default_factory=utc_now_iso)

    @property
    def open_questions(self) -> tuple[str, ...]:
        """Questions dont la réponse change le travail."""
        return self.intent.open_questions

    @property
    def is_determined(self) -> bool:
        """Vrai si l'intention est établie : une intention inconnue ne se planifie pas."""
        return self.intent.confidence > 0 and not self.intent.open_questions

    def to_dict(self) -> dict[str, Any]:
        return {
            "analysis_id": self.analysis_id,
            "request_id": self.request_id,
            "intent": self.intent.to_dict(),
            "context": self.context.to_dict(),
            "open_questions": list(self.open_questions),
            "created_at": self.created_at,
        }


@dataclass(slots=True)
class CoreRun:
    """Trace complète d'un cycle de travail du cœur, jusqu'à sa frontière."""

    request_id: str
    status: OperationStatus
    analysis: Analysis | None = None
    plan: Plan | None = None
    decision: DecisionRecord | None = None
    task_id: str | None = None
    task_state: TaskState | None = None
    boundary: str | None = None
    notes: list[str] = field(default_factory=list)
    evidence_ids: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "request_id": self.request_id,
            "status": self.status.value,
            "analysis_id": self.analysis.analysis_id if self.analysis else None,
            "plan_id": self.plan.plan_id if self.plan else None,
            "decision_id": self.decision.decision_id if self.decision else None,
            "task_id": self.task_id,
            "task_state": self.task_state.value if self.task_state else None,
            "boundary": self.boundary,
            "notes": list(self.notes),
            "evidence_ids": list(self.evidence_ids),
        }


class AgentCore:
    """Coordonne contexte → intention → plan → décision → tâche, et s'arrête à l'exécution."""

    def __init__(
        self,
        *,
        context: ContextEngine | None = None,
        planner: Planner | None = None,
        decisions: DecisionEngine | None = None,
        analyzer: IntentAnalyzer | None = None,
        evidence: EvidenceStore | None = None,
        audit: AuditLedger | None = None,
        actor: str = "codidev-core",
    ) -> None:
        self.context = context or ContextEngine()
        self.planner = planner or Planner()
        self.decisions = decisions or DecisionEngine()
        self.analyzer: IntentAnalyzer = analyzer or StructuredIntentAnalyzer()
        self.evidence = evidence
        self.audit = audit
        self.actor = actor
        self.tasks = TaskEngine(evidence=evidence, audit=audit, default_actor=actor)

    # ------------------------------------------------------------------ phases

    def analyze(
        self,
        request: Request,
        *,
        items: list[ContextItem] | None = None,
    ) -> Analysis:
        """Comprend la demande : contexte isolé puis intention structurée."""
        bundle = self.context.build(
            tenant_id=request.tenant_id,
            project_id=request.project_id,
            request_id=request.request_id,
            items=items or [],
        )
        intent = self.analyzer.analyze(request, context=bundle)
        intent.validate()
        analysis = Analysis(request_id=request.request_id, intent=intent, context=bundle)
        self._record(
            "agent.analyze",
            OperationStatus.EXECUTED,
            tenant_id=request.tenant_id,
            project_id=request.project_id,
            resource=f"request:{request.request_id}",
            external_ids={"analysis_id": analysis.analysis_id, "intent_id": intent.intent_id},
            warnings=list(analysis.open_questions),
        )
        return analysis

    def plan(self, analysis: Analysis, *, steps: list[PlanStep], **kwargs: Any) -> Plan:
        """Planifie le travail et refuse de planifier une intention non établie."""
        if not analysis.is_determined:
            self._record(
                "agent.plan",
                OperationStatus.BLOCKED,
                tenant_id=analysis.context.tenant_id,
                project_id=analysis.context.project_id,
                resource=f"analysis:{analysis.analysis_id}",
                errors=["intention non établie : planification refusée"],
            )
            raise ValueError(
                "intention non établie : fournir les signaux manquants avant de planifier"
            )
        plan = self.planner.create(
            objective=analysis.intent.statement,
            steps=steps,
            tenant_id=analysis.context.tenant_id,
            project_id=analysis.context.project_id,
            intent_id=analysis.intent.intent_id,
            **kwargs,
        )
        self._record(
            "agent.plan",
            OperationStatus.EXECUTED,
            tenant_id=plan.tenant_id,
            project_id=plan.project_id,
            resource=f"plan:{plan.plan_id}",
            external_ids={"plan_id": plan.plan_id},
            warnings=[EXECUTION_BOUNDARY],
        )
        return plan

    def decide(
        self,
        plan: Plan,
        *,
        options: list[Option],
        policy: PolicyVerdict,
        verification_plan: list[str],
        **kwargs: Any,
    ) -> DecisionRecord:
        """Prend la décision d'engagement du plan, sous contrainte de politique."""
        decision = self.decisions.decide(
            intent=plan.objective,
            options=options,
            policy=policy,
            verification_plan=verification_plan,
            plan_id=plan.plan_id,
            tenant_id=plan.tenant_id,
            project_id=plan.project_id,
            **kwargs,
        )
        statut = (
            OperationStatus.BLOCKED
            if decision.policy_outcome is PolicyOutcome.DENY
            else OperationStatus.EXECUTED
        )
        self._record(
            "agent.decide",
            statut,
            tenant_id=decision.tenant_id,
            project_id=decision.project_id,
            resource=f"decision:{decision.decision_id}",
            external_ids={"decision_id": decision.decision_id},
            warnings=list(decision.obligations),
        )
        return decision

    def open_task(self, decision: DecisionRecord, plan: Plan, *, actor: str | None = None) -> Task:
        """Ouvre la tâche correspondant à la décision retenue."""
        task = self.tasks.open(
            decision.intent,
            tenant_id=plan.tenant_id,
            project_id=plan.project_id,
            plan_id=plan.plan_id,
            decision_id=decision.decision_id,
            risk_class=plan.permissions[0] if plan.permissions else RiskClass.READ,
            actor=actor or self.actor,
        )
        return task

    # ------------------------------------------------------------------ cycle complet

    def run(
        self,
        request: Request,
        *,
        steps: list[PlanStep],
        options: list[Option],
        policy: PolicyVerdict,
        verification_plan: list[str],
        items: list[ContextItem] | None = None,
        plan_kwargs: dict[str, Any] | None = None,
        decision_kwargs: dict[str, Any] | None = None,
    ) -> CoreRun:
        """Déroule le cycle complet du cœur et s'arrête net à la frontière d'exécution.

        La tâche est conduite jusqu'à l'état qui traduit la réalité : `BLOCKED` si la politique
        refuse, `WAITING_FOR_USER` si une approbation est requise, `PROPOSED` sinon — et dans tous
        les cas **aucune exécution n'est revendiquée**.
        """
        run = CoreRun(request_id=request.request_id, status=OperationStatus.NOT_EXECUTED)

        analysis = self.analyze(request, items=items)
        run.analysis = analysis
        if not analysis.is_determined:
            run.status = OperationStatus.WAITING_FOR_USER
            run.notes.extend(analysis.open_questions)
            run.boundary = "intention non établie : aucune planification, aucune exécution"
            self._record(
                "agent.run",
                OperationStatus.WAITING_FOR_USER,
                tenant_id=request.tenant_id,
                project_id=request.project_id,
                resource=f"request:{request.request_id}",
                warnings=list(analysis.open_questions),
            )
            return run

        plan = self.plan(analysis, steps=steps, **(plan_kwargs or {}))
        plan = self.planner.propose(plan)
        run.plan = plan

        decision = self.decide(
            plan,
            options=options,
            policy=policy,
            verification_plan=verification_plan,
            **(decision_kwargs or {}),
        )
        run.decision = decision

        task = self.tasks.open(
            decision.intent,
            tenant_id=plan.tenant_id,
            project_id=plan.project_id,
            plan_id=plan.plan_id,
            decision_id=decision.decision_id,
            risk_class=plan.permissions[0] if plan.permissions else RiskClass.READ,
            actor=self.actor,
        )
        self.tasks.transition(task, TaskState.ANALYZING, reason="analyse terminée")
        self.tasks.transition(task, TaskState.PROPOSED, reason=f"décision {decision.decision_id}")
        run.task_id = task.task_id

        if decision.policy_outcome is PolicyOutcome.DENY:
            self.tasks.transition(task, TaskState.BLOCKED, reason="refus de la politique")
            run.status = OperationStatus.BLOCKED
            run.notes.extend(decision.risks)
        elif decision.requires_human_gate:
            self.tasks.transition(
                task, TaskState.WAITING_FOR_USER, reason="approbation humaine requise"
            )
            run.status = OperationStatus.WAITING_FOR_USER
            run.notes.append("approbation humaine requise avant toute exécution")
        else:
            run.status = OperationStatus.NOT_EXECUTED
            run.notes.append(EXECUTION_BOUNDARY)

        run.task_state = task.state
        run.boundary = EXECUTION_BOUNDARY
        self._record(
            "agent.run",
            run.status,
            tenant_id=request.tenant_id,
            project_id=request.project_id,
            resource=f"task:{task.task_id}",
            external_ids={
                "analysis_id": analysis.analysis_id,
                "plan_id": plan.plan_id,
                "decision_id": decision.decision_id,
                "task_id": task.task_id,
            },
            warnings=list(run.notes),
        )
        return run

    # ------------------------------------------------------------------ journalisation

    def _record(
        self,
        operation: str,
        status: OperationStatus,
        *,
        tenant_id: str | None = None,
        project_id: str | None = None,
        resource: str | None = None,
        errors: list[str] | None = None,
        warnings: list[str] | None = None,
        external_ids: dict[str, str] | None = None,
    ) -> None:
        """Consigne une opération du cœur dans les preuves et l'audit, s'ils sont fournis."""
        evidence_id: str | None = None
        if self.evidence is not None:
            entry = self.evidence.record(
                operation,
                status,
                actor=self.actor,
                tenant_id=tenant_id,
                project_id=project_id,
                resource=resource,
                errors=errors,
                warnings=warnings,
                external_ids=external_ids,
            )
            evidence_id = str(entry["evidence_id"])
        if self.audit is not None:
            self.audit.record_action(
                actor=self.actor,
                action=operation,
                resource=resource or operation,
                risk_class=(
                    RiskClass.WRITE if status is OperationStatus.BLOCKED else RiskClass.READ
                ),
                result=status,
                tenant_id=tenant_id,
                project_id=project_id,
                evidence_id=evidence_id,
            )

    @staticmethod
    def verification(*criteria: str, passed: bool = True) -> ValidationOutcome:
        """Résultat de vérification pratique, à attacher aux transitions qui l'exigent."""
        return ValidationOutcome(criteria=tuple(criteria), performed=True, passed=passed)
