"""Sérialisation canonique et chaînage cryptographique.

Deux journaux de CodiDev (preuves, audit) sont append-only et chaînés : chaque enregistrement
porte le hachage de l'enregistrement précédent, ce qui rend toute réécriture discrète
détectable. La sérialisation doit donc être **déterministe** : la même donnée produit toujours
les mêmes octets, indépendamment de l'ordre des clés ou de la plateforme.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

#: Valeur de `prev_hash` pour le premier enregistrement d'un journal (pas de prédécesseur).
GENESIS_HASH = "0" * 64


def canonical_json(payload: Any) -> bytes:
    """Sérialise en JSON canonique : clés triées, séparateurs compacts, UTF-8 préservé."""
    return json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")


def sha256_hex(data: bytes) -> str:
    """Empreinte SHA-256 en hexadécimal minuscule."""
    return hashlib.sha256(data).hexdigest()


def digest(payload: Any) -> str:
    """Empreinte SHA-256 du JSON canonique d'une structure."""
    return sha256_hex(canonical_json(payload))


def chained_hash(record: dict[str, Any], prev_hash: str, *, hash_field: str = "hash") -> str:
    """Calcule le hachage d'un enregistrement, en liant explicitement son prédécesseur.

    Le champ `hash` est exclu du calcul (il en est le résultat) ; `prev_hash` est estampillé
    dans la structure hachée afin qu'un simple recopiage de hachage ne suffise pas à
    réordonner ou supprimer un maillon.
    """
    body = {key: value for key, value in record.items() if key != hash_field}
    body["prev_hash"] = prev_hash
    return digest(body)
