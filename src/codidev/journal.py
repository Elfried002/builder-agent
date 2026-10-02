"""Journal JSONL append-only, chaîné par hachage.

Base commune aux preuves et à l'audit. Deux propriétés sont garanties et vérifiables :

1. **Append-only** — aucune API de réécriture ni de suppression n'existe ; seule l'ajout est
   offert, et chaque écriture est suivie d'un `flush` + `fsync`.
2. **Chaînage** — chaque enregistrement porte `prev_hash` (hachage du précédent) et `hash`
   (hachage de son propre contenu, `prev_hash` inclus). Modifier, réordonner ou supprimer un
   maillon invalide la chaîne et `verify()` le détecte.

Toute chaîne écrite est d'abord caviardée : un secret ne peut pas entrer dans un journal
(`07_SECURITY/04_SECRETS.md`).
"""

from __future__ import annotations

import json
import os
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from codidev.contracts import iter_errors, validate
from codidev.hashing import GENESIS_HASH, canonical_json, chained_hash
from codidev.security.secrets import redact_structure


@dataclass(frozen=True, slots=True)
class IntegrityIssue:
    """Anomalie détectée lors de la vérification d'un journal."""

    index: int
    code: str
    detail: str

    def to_dict(self) -> dict[str, Any]:
        return {"index": self.index, "code": self.code, "detail": self.detail}


@dataclass(slots=True)
class IntegrityReport:
    """Résultat de vérification d'un journal."""

    path: Path
    contract: str
    count: int
    issues: list[IntegrityIssue] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.issues

    def to_dict(self) -> dict[str, Any]:
        return {
            "path": str(self.path),
            "contract": self.contract,
            "count": self.count,
            "ok": self.ok,
            "issues": [issue.to_dict() for issue in self.issues],
        }


class ChainedJournal:
    """Journal append-only d'enregistrements conformes à un contrat et chaînés par hachage."""

    contract: str = ""

    def __init__(
        self,
        path: Path | str,
        *,
        contract: str | None = None,
        redactor: Callable[[object], object] = redact_structure,
    ) -> None:
        self.path = Path(path)
        self.contract = contract or self.contract
        if not self.contract:
            raise ValueError("un contrat est requis pour un journal chaîné")
        self._redactor = redactor
        self.path.parent.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------ lecture

    def records(self) -> Iterator[dict[str, Any]]:
        """Itère les enregistrements du journal, dans l'ordre d'écriture."""
        if not self.path.exists():
            return
        with self.path.open("r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                yield json.loads(line)

    def last_hash(self) -> str:
        """Hachage du dernier enregistrement, ou `GENESIS_HASH` si le journal est vide."""
        last: dict[str, Any] | None = None
        for record in self.records():
            last = record
        if last is None:
            return GENESIS_HASH
        return str(last.get("hash") or GENESIS_HASH)

    def last_record(self) -> dict[str, Any] | None:
        """Dernier enregistrement écrit, ou `None`."""
        last: dict[str, Any] | None = None
        for record in self.records():
            last = record
        return last

    def count(self) -> int:
        """Nombre d'enregistrements."""
        return sum(1 for _ in self.records())

    # ------------------------------------------------------------------ écriture

    def append(self, record: dict[str, Any]) -> dict[str, Any]:
        """Caviarde, chaîne, valide puis ajoute un enregistrement au journal (sans réécriture)."""
        if not isinstance(record, dict):
            raise TypeError("un enregistrement de journal doit être un objet JSON")

        candidate = dict(self._redactor(dict(record)))  # type: ignore[arg-type]
        candidate.pop("prev_hash", None)
        candidate.pop("hash", None)
        self._prepare(candidate)

        prev_hash = self.last_hash()
        candidate["prev_hash"] = prev_hash
        candidate["hash"] = chained_hash(candidate, prev_hash)

        validate(self.contract, candidate)

        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(canonical_json(candidate).decode("utf-8"))
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        return candidate

    def _prepare(self, candidate: dict[str, Any]) -> None:
        """Point d'extension : ajuste l'enregistrement avant calcul du hachage."""

    # ------------------------------------------------------------------ vérification

    def verify(self) -> IntegrityReport:
        """Recalcule la chaîne entière et signale la première anomalie de chaque type."""
        report = IntegrityReport(path=self.path, contract=self.contract, count=0)
        expected_prev = GENESIS_HASH
        for index, record in enumerate(self.records()):
            report.count += 1
            if record.get("prev_hash") != expected_prev:
                report.issues.append(
                    IntegrityIssue(
                        index=index,
                        code="BROKEN_LINK",
                        detail=(
                            f"prev_hash attendu {expected_prev[:12]}…, "
                            f"trouvé {str(record.get('prev_hash'))[:12]}…"
                        ),
                    )
                )
            recomputed = chained_hash(record, str(record.get("prev_hash") or ""))
            if recomputed != record.get("hash"):
                report.issues.append(
                    IntegrityIssue(
                        index=index,
                        code="HASH_MISMATCH",
                        detail=(
                            f"hachage recalculé {recomputed[:12]}… différent de "
                            f"l'hachage consigné {str(record.get('hash'))[:12]}…"
                        ),
                    )
                )
            violations = iter_errors(self.contract, record)
            for violation in violations:
                report.issues.append(
                    IntegrityIssue(index=index, code="CONTRACT_VIOLATION", detail=violation)
                )
            self._check(record, index, report)
            expected_prev = str(record.get("hash") or "")

        if not self.path.exists() and report.count == 0:
            report.issues.append(
                IntegrityIssue(index=0, code="MISSING", detail=f"journal absent : {self.path}")
            )
        return report

    def _check(self, record: dict[str, Any], index: int, report: IntegrityReport) -> None:
        """Point d'extension : vérifications propres au type de journal."""
