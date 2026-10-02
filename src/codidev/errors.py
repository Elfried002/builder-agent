"""Exceptions de CodiDev.

Principe opposable : une erreur n'est jamais convertie en succès. Chaque exception porte un
`status` issu de `codidev.statuses.OperationStatus`, de sorte que l'appelant qui capture
l'exception dispose déjà du statut réel à consigner dans les preuves.
"""

from __future__ import annotations

from codidev.statuses import OperationStatus


class CodiDevError(Exception):
    """Racine des erreurs CodiDev."""

    status: OperationStatus = OperationStatus.FAILED

    def __init__(self, message: str, **context: object) -> None:
        super().__init__(message)
        self.message = message
        self.context: dict[str, object] = dict(context)

    def to_dict(self) -> dict[str, object]:
        return {
            "error": type(self).__name__,
            "message": self.message,
            "status": self.status.value,
            "context": self.context,
        }


class ContractError(CodiDevError):
    """Un document ne satisfait pas son contrat JSON Schema."""

    status = OperationStatus.BLOCKED


class SecretDetectedError(CodiDevError):
    """Un secret a été détecté là où il ne doit jamais y en avoir (dépôt, preuve, journal)."""

    status = OperationStatus.BLOCKED


class GateBlockedError(CodiDevError):
    """Le Security Gate a refusé l'opération."""

    status = OperationStatus.BLOCKED


class PolicyDeniedError(CodiDevError):
    """La politique a refusé l'action demandée."""

    status = OperationStatus.BLOCKED


class ApprovalRequiredError(CodiDevError):
    """L'action exige une approbation humaine qui n'a pas été accordée."""

    status = OperationStatus.WAITING_FOR_USER


class ChainIntegrityError(CodiDevError):
    """La chaîne de hachage d'un journal (preuves, audit) a été altérée."""

    status = OperationStatus.FAILED


class CapabilityNotDeclaredError(CodiDevError):
    """Capacité non déclarée demandée : point ouvert, jamais d'élargissement silencieux."""

    status = OperationStatus.NOT_EXECUTED
