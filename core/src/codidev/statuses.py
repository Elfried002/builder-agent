"""Vocabulaires canoniques de CodiDev.

Source unique de vérité pour les états, classes de risque et niveaux de sévérité.
Ces valeurs sont référencées par les contrats JSON Schema (`codidev/contracts/schemas/`)
et ne doivent jamais être dupliquées en littéraux ailleurs.

Règle opposable (`00_VISION_GOVERNANCE/01_PRINCIPLES.md`, #15) :
    « A failed or blocked action is never reported as successful. »
Elle est encodée ici par `OperationStatus.implies_completion`, qui n'est vraie que pour
`VERIFIED` — jamais pour `EXECUTED`.
"""

from __future__ import annotations

from enum import StrEnum


class OperationStatus(StrEnum):
    """Statut réel d'une opération (`13_OPERATIONS/01_ERROR_HANDLING.md`).

    `EXECUTED` signifie « l'action a été exécutée », pas « le résultat est conforme ».
    Seul `VERIFIED` atteste que les critères de vérification ont été satisfaits.
    """

    NOT_EXECUTED = "NOT_EXECUTED"
    BLOCKED = "BLOCKED"
    FAILED = "FAILED"
    WAITING_FOR_USER = "WAITING_FOR_USER"
    EXECUTED = "EXECUTED"
    VERIFIED = "VERIFIED"

    def implies_completion(self) -> bool:
        """Vrai uniquement lorsque les critères de vérification ont été satisfaits."""
        return self is OperationStatus.VERIFIED

    def is_failure(self) -> bool:
        """`BLOCKED` et `FAILED` sont des échecs ; `WAITING_FOR_USER` est une attente."""
        return self in (OperationStatus.BLOCKED, OperationStatus.FAILED)


class TaskState(StrEnum):
    """États du Task Engine (`03_AGENT_CORE/04_TASK_ENGINE.md`)."""

    DRAFT = "DRAFT"
    ANALYZING = "ANALYZING"
    PROPOSED = "PROPOSED"
    WAITING_FOR_USER = "WAITING_FOR_USER"
    IN_PROGRESS = "IN_PROGRESS"
    BLOCKED = "BLOCKED"
    FAILED = "FAILED"
    EXECUTED = "EXECUTED"
    VERIFYING = "VERIFYING"
    VERIFIED = "VERIFIED"
    READY = "READY"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


#: Transitions autorisées du Task Engine. Toute transition absente de cette table est refusée.
TASK_TRANSITIONS: dict[TaskState, frozenset[TaskState]] = {
    TaskState.DRAFT: frozenset({TaskState.ANALYZING, TaskState.CANCELLED}),
    TaskState.ANALYZING: frozenset(
        {TaskState.PROPOSED, TaskState.BLOCKED, TaskState.FAILED, TaskState.CANCELLED}
    ),
    TaskState.PROPOSED: frozenset(
        {TaskState.WAITING_FOR_USER, TaskState.IN_PROGRESS, TaskState.BLOCKED, TaskState.CANCELLED}
    ),
    TaskState.WAITING_FOR_USER: frozenset({TaskState.IN_PROGRESS, TaskState.CANCELLED}),
    TaskState.IN_PROGRESS: frozenset(
        {TaskState.BLOCKED, TaskState.FAILED, TaskState.EXECUTED, TaskState.CANCELLED}
    ),
    TaskState.BLOCKED: frozenset({TaskState.IN_PROGRESS, TaskState.FAILED, TaskState.CANCELLED}),
    TaskState.FAILED: frozenset({TaskState.IN_PROGRESS, TaskState.CANCELLED}),
    TaskState.EXECUTED: frozenset({TaskState.VERIFYING, TaskState.FAILED}),
    TaskState.VERIFYING: frozenset({TaskState.VERIFIED, TaskState.FAILED, TaskState.BLOCKED}),
    TaskState.VERIFIED: frozenset({TaskState.READY}),
    TaskState.READY: frozenset({TaskState.COMPLETED}),
    TaskState.COMPLETED: frozenset(),
    TaskState.CANCELLED: frozenset(),
}


def is_allowed_transition(source: TaskState, target: TaskState) -> bool:
    """Indique si `source -> target` figure dans la table des transitions autorisées."""
    return target in TASK_TRANSITIONS[source]


class RiskClass(StrEnum):
    """Classes d'action (`00_VISION_GOVERNANCE/02_GOVERNANCE.md`)."""

    READ = "READ"
    LOW_WRITE = "LOW_WRITE"
    WRITE = "WRITE"
    SENSITIVE_WRITE = "SENSITIVE_WRITE"
    DESTRUCTIVE = "DESTRUCTIVE"
    EXTERNAL_SIDE_EFFECT = "EXTERNAL_SIDE_EFFECT"
    DEPLOYMENT = "DEPLOYMENT"
    SECURITY_SENSITIVE = "SECURITY_SENSITIVE"

    def requires_human_approval(self) -> bool:
        """Classes dont la moindre occurrence exige un Human Gate explicite."""
        return self in (
            RiskClass.SENSITIVE_WRITE,
            RiskClass.DESTRUCTIVE,
            RiskClass.EXTERNAL_SIDE_EFFECT,
            RiskClass.DEPLOYMENT,
            RiskClass.SECURITY_SENSITIVE,
        )


class Severity(StrEnum):
    """Niveaux de sévérité d'une constatation de sécurité (`07_SECURITY/03_SECURITY_GATE.md`)."""

    INFO = "INFO"
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"

    @property
    def rank(self) -> int:
        return _SEVERITY_RANK[self]


_SEVERITY_RANK: dict[Severity, int] = {
    Severity.INFO: 0,
    Severity.LOW: 1,
    Severity.MEDIUM: 2,
    Severity.HIGH: 3,
    Severity.CRITICAL: 4,
}


class GateOutcome(StrEnum):
    """Verdict du Security Gate."""

    PASS = "PASS"
    REVIEW = "REVIEW"
    BLOCK = "BLOCK"

    @property
    def exit_code(self) -> int:
        """Code de sortie conventionnel : 0 = PASS, 1 = REVIEW, 2 = BLOCK."""
        return _GATE_EXIT_CODES[self]


_GATE_EXIT_CODES: dict[GateOutcome, int] = {
    GateOutcome.PASS: 0,
    GateOutcome.REVIEW: 1,
    GateOutcome.BLOCK: 2,
}


class PolicyOutcome(StrEnum):
    """Issue d'une décision de politique."""

    ALLOW = "ALLOW"
    DENY = "DENY"
    REQUIRE_APPROVAL = "REQUIRE_APPROVAL"


class ToolRunState(StrEnum):
    """État réel d'exécution d'un outil de sécurité externe.

    Un outil absent ou en échec est `NOT_EXECUTED` / `FAILED` — jamais « silencieusement vert ».
    """

    EXECUTED = "EXECUTED"
    NOT_EXECUTED = "NOT_EXECUTED"
    FAILED = "FAILED"
