"""Fixtures partagées."""

from __future__ import annotations

import shutil
import subprocess
from collections.abc import Iterator
from pathlib import Path

import pytest

from codidev.audit import AuditLedger
from codidev.evidence import EvidenceStore


@pytest.fixture
def evidence_path(tmp_path: Path) -> Path:
    return tmp_path / "preuves.jsonl"


@pytest.fixture
def audit_path(tmp_path: Path) -> Path:
    return tmp_path / "audit.jsonl"


@pytest.fixture
def store(evidence_path: Path) -> EvidenceStore:
    return EvidenceStore(evidence_path)


@pytest.fixture
def ledger(audit_path: Path) -> AuditLedger:
    return AuditLedger(audit_path)


@pytest.fixture
def core_root() -> Path:
    """Racine du cœur : le paquet `codidev`, ses contrats et ses tests."""
    return Path(__file__).resolve().parent.parent


@pytest.fixture
def repo_root() -> Path:
    """Racine du dépôt Git : cœur, documentation, historique et emplacements plateforme."""
    core = Path(__file__).resolve().parent.parent
    git = shutil.which("git")
    if git is not None:
        result = subprocess.run(  # noqa: S603 — argv fixe, sans shell, aucun entrant externe
            [git, "rev-parse", "--show-toplevel"],
            cwd=core,
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode == 0 and result.stdout.strip():
            return Path(result.stdout.strip())
    return core.parent


@pytest.fixture
def fake_secret_lines() -> Iterator[dict[str, str]]:
    """Secrets factices, construits par concaténation pour ne jamais exister en clair ici."""
    yield {
        "github": "gh" + "p_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8",
        "openai": "sk" + "-" + "Zq3Wm8Rt5Yp2Kd7Vb4Nx6Lc9",
        "aws": "AKIA" + "Q7WERT9YU2IOP3AS",
        "db": "postgres" + "ql://" + "app" + ":" + "s3cr3tP4ssw0rd" + "@db.local/app",
    }
