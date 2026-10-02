"""Chargement, indexation et validation des contrats JSON Schema de CodiDev.

Les contrats sont des fichiers JSON Schema 2020-12 auto-suffisants, résolus **hors ligne** via
un `referencing.Registry` : valider un document ne dépend d'aucun accès réseau.
"""

from __future__ import annotations

import json
from functools import cache
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

from codidev.errors import ContractError

SCHEMA_DIR: Path = Path(__file__).resolve().parent / "schemas"
SCHEMA_BASE_URI: str = "https://codidev.local/schemas/"


def _schema_paths() -> dict[str, Path]:
    """Index `nom_de_contrat -> fichier de schéma`."""
    return {path.stem: path for path in sorted(SCHEMA_DIR.glob("*.json"))}


def list_contracts() -> tuple[str, ...]:
    """Noms des contrats disponibles, triés."""
    return tuple(_schema_paths())


def _require_known(name: str) -> Path:
    paths = _schema_paths()
    if name not in paths:
        raise ContractError(
            f"contrat inconnu : {name!r}",
            available=list(paths),
        )
    return paths[name]


def contract_path(name: str) -> Path:
    """Chemin du fichier de schéma d'un contrat."""
    return _require_known(name)


@cache
def load_schema(name: str) -> dict[str, Any]:
    """Charge le schéma JSON d'un contrat (résultat mis en cache)."""
    path = _require_known(name)
    try:
        schema = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ContractError(
            f"schéma illisible : {path.name}",
            detail=str(exc),
        ) from exc
    if not isinstance(schema, dict):
        raise ContractError(f"schéma non-objet : {path.name}", type=type(schema).__name__)
    return schema


@cache
def _registry() -> Registry:
    """Registre hors ligne de tous les schémas, pour résoudre les `$ref` absolus."""
    resources = []
    for name, _path in _schema_paths().items():
        document = load_schema(name)
        resource = Resource.from_contents(document, default_specification=DRAFT202012)
        resources.append((document.get("$id", f"{SCHEMA_BASE_URI}{name}.json"), resource))
    return Registry().with_resources(resources)


@cache
def validator_for(name: str) -> Draft202012Validator:
    """Validateur JSON Schema d'un contrat, avec vérification des formats (date-time, …)."""
    schema = load_schema(name)
    return Draft202012Validator(  # type: ignore[return-value]
        schema,
        registry=_registry(),
        format_checker=FormatChecker(),
    )


def iter_errors(name: str, instance: Any) -> list[str]:
    """Messages d'erreur lisibles pour une instance, dans l'ordre des erreurs du schéma."""
    validator = validator_for(name)
    messages: list[str] = []
    for error in sorted(validator.iter_errors(instance), key=lambda err: list(err.absolute_path)):
        location = "/".join(str(part) for part in error.absolute_path) or "<racine>"
        messages.append(f"{location}: {error.message}")
    return messages


def validate(name: str, instance: Any) -> None:
    """Valide une instance contre un contrat et lève `ContractError` si elle est invalide."""
    messages = iter_errors(name, instance)
    if messages:
        raise ContractError(
            f"document non conforme au contrat {name!r}",
            contract=name,
            violations=messages,
        )


def is_valid(name: str, instance: Any) -> bool:
    """Vrai si l'instance satisfait le contrat."""
    return not iter_errors(name, instance)


def schema_enum(name: str, pointer: str) -> list[str]:
    """Liste `enum` désignée par un pointeur JSON (`#/$defs/risk_class`) dans un schéma."""
    node: Any = load_schema(name)
    if pointer.startswith("#/"):
        for part in pointer[2:].split("/"):
            if not isinstance(node, dict) or part not in node:
                raise ContractError(f"pointeur introuvable : {pointer}", contract=name)
            node = node[part]
    if not isinstance(node, dict) or "enum" not in node:
        raise ContractError(f"aucun `enum` au pointeur : {pointer}", contract=name)
    values = node["enum"]
    if not all(isinstance(value, str) for value in values):
        raise ContractError(f"`enum` non textuel : {pointer}", contract=name)
    return list(values)
