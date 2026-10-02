"""Exceptions de sécurité revues et traçables.

Un scanner que l'on ne peut pas calmer sur du bruit finit désactivé, et un scanner désactivé ne
protège rien. La réponse n'est donc pas d'affaiblir les règles, mais de permettre des **exceptions
explicites** : chaque exception nomme une règle, cible un chemin, et porte une justification, un
auteur et une date de revue.

Une exception ne masque jamais un problème : la constatation couverte reste présente dans le
rapport, avec la justification qui l'a levée.
"""

from __future__ import annotations

import fnmatch
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from codidev.contracts import validate
from codidev.errors import ContractError
from codidev.security.report import Finding

#: Nom conventionnel du fichier d'exceptions à la racine d'un dépôt.
ALLOWLIST_FILENAME = ".codidev-security-allowlist.json"


@dataclass(frozen=True, slots=True)
class AllowlistEntry:
    """Exception déclarée."""

    rule: str
    path: str
    justification: str
    reviewed_by: str
    reviewed_at: str
    expires_at: str | None = None

    def matches(self, finding: Finding, *, root: Path) -> bool:
        """Vrai si l'exception couvre une constatation : même règle et chemin correspondant."""
        if finding.rule != self.rule:
            return False
        try:
            relative = Path(finding.source).resolve().relative_to(root.resolve())
        except ValueError:
            relative = Path(finding.source)
        return fnmatch.fnmatch(relative.as_posix(), self.path)

    def to_dict(self) -> dict[str, Any]:
        return {
            "rule": self.rule,
            "path": self.path,
            "justification": self.justification,
            "reviewed_by": self.reviewed_by,
            "reviewed_at": self.reviewed_at,
            "expires_at": self.expires_at,
        }


@dataclass(frozen=True, slots=True)
class SuppressedFinding:
    """Constatation couverte par une exception, conservée pour la traçabilité."""

    finding: Finding
    entry: AllowlistEntry

    def to_dict(self) -> dict[str, Any]:
        return {
            "finding": self.finding.to_dict(),
            "justification": self.entry.justification,
            "reviewed_by": self.entry.reviewed_by,
            "reviewed_at": self.entry.reviewed_at,
        }


@dataclass(slots=True)
class SecurityAllowlist:
    """Jeu d'exceptions revues."""

    entries: list[AllowlistEntry] = field(default_factory=list)
    source: Path | None = None

    @classmethod
    def empty(cls) -> SecurityAllowlist:
        return cls()

    @classmethod
    def load(cls, path: Path) -> SecurityAllowlist:
        """Charge un fichier d'exceptions ; un fichier absent vaut jeu vide."""
        if not path.is_file():
            return cls(entries=[], source=path)
        try:
            document = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ContractError(
                f"fichier d'exceptions illisible : {path}", detail=str(exc)
            ) from exc
        validate("security_allowlist", document)
        entries = [
            AllowlistEntry(
                rule=item["rule"],
                path=item["path"],
                justification=item["justification"],
                reviewed_by=item["reviewed_by"],
                reviewed_at=item["reviewed_at"],
                expires_at=item.get("expires_at"),
            )
            for item in document["entries"]
        ]
        return cls(entries=entries, source=path)

    @classmethod
    def load_for(cls, target: Path) -> SecurityAllowlist:
        """Charge les exceptions au plus proche du périmètre scanné."""
        base = target if target.is_dir() else target.parent
        candidate = base / ALLOWLIST_FILENAME
        return cls.load(candidate)

    def entry_for(self, finding: Finding, *, root: Path) -> AllowlistEntry | None:
        """Première exception couvrant une constatation, ou `None`."""
        for entry in self.entries:
            if entry.matches(finding, root=root):
                return entry
        return None

    def partition(
        self, findings: list[Finding], *, root: Path
    ) -> tuple[list[Finding], list[SuppressedFinding]]:
        """Sépare les constatations actives de celles couvertes par une exception."""
        active: list[Finding] = []
        suppressed: list[SuppressedFinding] = []
        for finding in findings:
            entry = self.entry_for(finding, root=root)
            if entry is None:
                active.append(finding)
            else:
                suppressed.append(SuppressedFinding(finding=finding, entry=entry))
        return active, suppressed

    def to_dict(self) -> dict[str, Any]:
        return {
            "source": str(self.source) if self.source else None,
            "entries": [entry.to_dict() for entry in self.entries],
        }
