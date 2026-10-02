"""Identifiants et horodatages canoniques."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime


def new_id(prefix: str) -> str:
    """Identifiant unique lisible, préfixé par la nature de l'objet (`ev`, `dec`, `req`, …)."""
    return f"{prefix}_{uuid.uuid4().hex}"


def utc_now() -> datetime:
    """Instant courant, en UTC et conscient du fuseau."""
    return datetime.now(UTC)


def utc_now_iso() -> str:
    """Instant courant au format RFC 3339 (UTC, suffixe `Z`), accepté par `format: date-time`."""
    return utc_now().isoformat().replace("+00:00", "Z")
