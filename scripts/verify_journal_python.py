#!/usr/bin/env python3
"""Vérifie un journal JSONL produit par le Core TypeScript, avec l'implémentation Python.

C'est la preuve de parité la plus forte disponible pendant la migration : elle ne compare pas du
code, elle vérifie que **les deux implémentations produisent les mêmes octets**. Un journal écrit
par l'une doit être reconnu intègre par l'autre — sans quoi les preuves ne seraient pas
transférables, et « chaîné » ne voudrait rien dire de plus que « écrit par moi ».

Usage :
    python scripts/verify_journal_python.py CHEMIN.jsonl

Sortie : un objet JSON sur la sortie standard, décodable par l'appelant.
    {"ok": bool, "count": int, "issues": [{"index": int, "code": str, "detail": str}]}

Code de sortie : 0 si le journal est intègre, 1 sinon. Aucune écriture, aucune modification.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "core" / "python" / "src"))

from codidev.hashing import GENESIS_HASH, chained_hash, canonical_json  # noqa: E402


def verify(path: Path) -> dict[str, object]:
    issues: list[dict[str, object]] = []
    if not path.is_file():
        return {"ok": False, "count": 0, "issues": [{"index": -1, "code": "MISSING", "detail": str(path)}]}

    expected_prev = GENESIS_HASH
    count = 0
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError as error:
                issues.append({"index": count, "code": "CONTRACT_VIOLATION", "detail": str(error)})
                count += 1
                continue

            declared_prev = record.get("prev_hash")
            if declared_prev != expected_prev:
                issues.append(
                    {
                        "index": count,
                        "code": "BROKEN_LINK",
                        "detail": f"prev_hash attendu {expected_prev[:12]}…, trouvé {str(declared_prev)[:12]}…",
                    }
                )

            recomputed = chained_hash(record, str(declared_prev or ""))
            if recomputed != record.get("hash"):
                issues.append(
                    {
                        "index": count,
                        "code": "HASH_MISMATCH",
                        "detail": f"hachage recalculé {recomputed[:12]}… différent de {str(record.get('hash'))[:12]}…",
                    }
                )

            # Le JSON canonique doit être reproductible : si les octets diffèrent, les hachages
            # d'une implémentation ne sont pas vérifiables par l'autre.
            try:
                canonical_json(record)
            except (TypeError, ValueError) as error:
                issues.append(
                    {"index": count, "code": "CONTRACT_VIOLATION", "detail": str(error)}
                )

            expected_prev = str(record.get("hash"))
            count += 1

    return {"ok": len(issues) == 0, "count": count, "issues": issues}


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(json.dumps({"ok": False, "count": 0, "issues": [{"index": -1, "code": "USAGE", "detail": "attendu : CHEMIN.jsonl"}]}))
        return 2
    report = verify(Path(argv[1]))
    print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
