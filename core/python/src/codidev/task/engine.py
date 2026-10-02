"""Task Engine — machine à états observable.

`03_AGENT_CORE/04_TASK_ENGINE.md` définit les états d'une tâche et impose que **les transitions
significatives soient observables**. Trois règles sont appliquées par du code, pas par convention :

1. **Aucune transition hors table.** La table de `codidev.statuses` est la seule autorité.
2. **Aucune vérification sans vérification.** Passer à `VERIFIED` exige un résultat de vérification
   réellement exécuté et réussi ; une déclaration ne suffit pas.
3. **Aucun succès implicite.** `COMPLETED` n'est atteignable qu'après `VERIFIED`, parce que le
   corpus interdit de présenter comme terminé un résultat non vérifié.

Chaque transition est consignée dans l'historique de la tâche et, lorsque les journaux sont
fournis, dans les preuves et l'audit.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from codidev.contracts import validate
from codidev.errors import TaskTransitionError, VerificationRequiredError
from codidev.evidence.store import EvidenceStore, ValidationOutcome
from codidev.ids import new_id, utc_now_iso
from codidev.statuses import OperationStatus, RiskClass, TaskState, is_allowed_transition

#: Correspondance état de tâche → statut d'opération consigné dans les preuves.
_STATUS_BY_STATE: dict[TaskState, OperationStatus] = {
    TaskState.WAITING_FOR_USER: OperationStatus.WAITING_FOR_USER,
    TaskState.BLOCKED: OperationStatus.BLOCKED,
    TaskState.FAILED: OperationStatus.FAILED,
    TaskState.VERIFIED: OperationStatus.VERIFIED,
}

#: États finaux : aucune sortie possible.
TERMINAL_STATES: frozenset[TaskState] = frozenset({TaskState.COMPLETED, TaskState.CANCELLED})


def _was_verified(task: Task) -> bool:
    """Vrai si la tâche est réellement passée par `VERIFIED` au cours de son histoire.

    La table de transitions interdit déjà d'atteindre `READY` sans `VERIFIED` ; ce contrôle
    redondant protège l'invariant si la table évolue, plutôt que de faire confiance à un
    raisonnement sur le graphe.
    """
    return any(event.to_state is TaskState.VERIFIED for event in task.history)


@dataclass(frozen=True, slots=True)
class TaskEvent:
    """Transition observée : d'où, vers quoi, quand, pourquoi, par qui."""

    seq: int
    from_state: TaskState | None
    to_state: TaskState
    at: str
    reason: str | None = None
    actor: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "from": self.from_state.value if self.from_state else None,
            "to": self.to_state.value,
            "at": self.at,
            "reason": self.reason,
        }


@dataclass(slots=True)
class Task:
    """Tâche du Task Engine."""

    objective: str
    task_id: str = field(default_factory=lambda: new_id("task"))
    state: TaskState = TaskState.DRAFT
    risk_class: RiskClass = RiskClass.READ
    created_at: str = field(default_factory=utc_now_iso)
    updated_at: str = field(default_factory=utc_now_iso)
    tenant_id: str | None = None
    project_id: str | None = None
    plan_id: str | None = None
    decision_id: str | None = None
    history: list[TaskEvent] = field(default_factory=list)

    @property
    def is_terminal(self) -> bool:
        return self.state in TERMINAL_STATES

    def to_dict(self) -> dict[str, Any]:
        return {
            "task_id": self.task_id,
            "state": self.state.value,
            "objective": self.objective,
            "tenant_id": self.tenant_id,
            "project_id": self.project_id,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "history": [event.to_dict() for event in self.history],
        }

    def validate(self) -> None:
        """Valide la tâche contre son contrat."""
        validate("task", self.to_dict())


class TaskEngine:
    """Ouvre des tâches et n'autorise que les transitions légitimes."""

    def __init__(
        self,
        *,
        evidence: EvidenceStore | None = None,
        audit: Any | None = None,
        default_actor: str = "codidev-core",
    ) -> None:
        self.evidence = evidence
        self.audit = audit
        self.default_actor = default_actor

    def open(
        self,
        objective: str,
        *,
        tenant_id: str | None = None,
        project_id: str | None = None,
        plan_id: str | None = None,
        decision_id: str | None = None,
        risk_class: RiskClass = RiskClass.READ,
        actor: str | None = None,
    ) -> Task:
        """Ouvre une tâche à l'état `DRAFT` et consigne sa création."""
        if not objective or not objective.strip():
            raise TaskTransitionError("une tâche sans objectif est refusée")
        task = Task(
            objective=objective.strip(),
            tenant_id=tenant_id,
            project_id=project_id,
            plan_id=plan_id,
            decision_id=decision_id,
            risk_class=risk_class,
        )
        motif = "création de la tâche"
        self._record(
            task,
            TaskEvent(
                seq=0,
                from_state=None,
                to_state=TaskState.DRAFT,
                at=task.created_at,
                reason=motif,
                actor=actor or self.default_actor,
            ),
        )
        self._journal(task, None, TaskState.DRAFT, reason=motif, actor=actor, validation=None)
        task.validate()
        return task

    def transition(
        self,
        task: Task,
        target: TaskState,
        *,
        reason: str | None = None,
        actor: str | None = None,
        validation: ValidationOutcome | None = None,
    ) -> Task:
        """Applique une transition légitime, ou refuse en nommant la règle violée."""
        if task.is_terminal:
            raise TaskTransitionError(
                "une tâche terminée n'évolue plus",
                task_id=task.task_id,
                state=task.state.value,
            )
        if not is_allowed_transition(task.state, target):
            raise TaskTransitionError(
                "transition non autorisée",
                task_id=task.task_id,
                source=task.state.value,
                target=target.value,
            )
        if target is TaskState.VERIFIED and (
            validation is None or not validation.performed or not validation.passed
        ):
            raise VerificationRequiredError(
                "passer à VERIFIED exige une vérification réellement exécutée et réussie",
                task_id=task.task_id,
            )
        if target is TaskState.COMPLETED and not _was_verified(task):
            raise VerificationRequiredError(
                "une tâche ne peut être terminée que vérifiée",
                task_id=task.task_id,
                state=task.state.value,
            )

        previous = task.state
        task.state = target
        task.updated_at = utc_now_iso()
        self._record(
            task,
            TaskEvent(
                seq=len(task.history),
                from_state=previous,
                to_state=target,
                at=task.updated_at,
                reason=reason,
                actor=actor or self.default_actor,
            ),
        )
        self._journal(task, previous, target, reason=reason, actor=actor, validation=validation)
        task.validate()
        return task

    def _record(self, task: Task, event: TaskEvent) -> None:
        task.history.append(event)

    def _journal(
        self,
        task: Task,
        previous: TaskState | None,
        target: TaskState,
        *,
        reason: str | None,
        actor: str | None,
        validation: ValidationOutcome | None,
    ) -> None:
        """Consigne la transition dans les preuves et l'audit, si les journaux sont fournis."""
        status = _STATUS_BY_STATE.get(target, OperationStatus.EXECUTED)
        acteur = actor or self.default_actor
        evidence_id: str | None = None

        operation = (
            f"task.transition:{previous.value}->{target.value}"
            if previous is not None
            else f"task.open:{target.value}"
        )
        if self.evidence is not None:
            entry = self.evidence.record(
                operation,
                status,
                actor=acteur,
                tenant_id=task.tenant_id,
                project_id=task.project_id,
                resource=f"task:{task.task_id}",
                warnings=[reason] if reason else None,
                validation=validation,
                external_ids={"task_id": task.task_id},
            )
            evidence_id = str(entry["evidence_id"])

        if self.audit is not None:
            self.audit.record_action(
                actor=acteur,
                action=operation,
                resource=f"task:{task.task_id}",
                risk_class=task.risk_class,
                result=status,
                tenant_id=task.tenant_id,
                project_id=task.project_id,
                evidence_id=evidence_id,
            )
