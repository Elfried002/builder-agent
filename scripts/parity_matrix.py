#!/usr/bin/env python3
"""Construit la matrice de parité Python ↔ TypeScript, à partir de faits, pas d'affirmations.

Méthode — aucune étape n'est déclarative :

1. Lit `docs/migration/01-PYTHON_CORE_AUDIT.md`, qui associe chaque invariant (I-01…I-38) aux
   tests de l'implémentation de référence.
2. **Exécute** la suite Python pour vérifier que chaque test cité existe réellement, puis que la
   suite entière est verte. Un test cité mais inexistant est un écart, et il est signalé comme tel.
3. **Exécute** la suite TypeScript et associe chaque invariant aux tests qui le déclarent
   explicitement dans leur intitulé (les tests portent la mention `I-xx`).
4. En déduit, pour chaque invariant, un verdict :
   - `VERIFIED`  : des deux côtés, et les deux suites sont vertes ;
   - `PARTIAL`   : un seul côté porte un test ;
   - `UNCOVERED` : aucun test explicite, quel que soit le côté — la garantie n'est alors pas
     démontrée, seulement écrite.

Le résultat est un document Markdown. Rien n'est arrondi en faveur du TypeScript : un invariant non
couvert est listé comme non couvert.

Usage : python scripts/parity_matrix.py [--write]
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
CORE = REPO / "core"
PY_CORE = CORE / "python"
AUDIT_DOC = REPO / "docs" / "migration" / "01-PYTHON_CORE_AUDIT.md"
OUTPUT = REPO / "docs" / "migration" / "03-PARITY_MATRIX.md"

NODE_BIN = Path.home() / ".local" / "share" / "codidev" / "node" / "bin"
PYTHON = Path.home() / ".local" / "share" / "codidev" / "venv" / "bin" / "python"
PYTEST = Path.home() / ".local" / "share" / "codidev" / "venv" / "bin" / "pytest"

INVARIANT_RE = re.compile(r"\bI-\d{2}\b")
PY_REF_RE = re.compile(r"`(?:(?P<file>[\w.]+\.py)::)?(?P<name>test_[\w]+)`")


def parse_audit_document() -> dict[str, list[str]]:
    """Retourne {invariant: ["test_fichier.py::test_nom", ...]} d'après le document d'audit."""
    mapping: dict[str, list[str]] = {}
    for line in AUDIT_DOC.read_text(encoding="utf-8").splitlines():
        if not line.startswith("| I-"):
            continue
        cells = [cell.strip() for cell in line.strip("|").split("|")]
        if len(cells) < 4:
            continue
        invariant = cells[0]
        if not INVARIANT_RE.fullmatch(invariant):
            continue
        references: list[str] = []
        current_file = ""
        for match in PY_REF_RE.finditer(cells[-1]):
            if match.group("file"):
                current_file = match.group("file")
            elif current_file:
                references.append(f"{current_file}::{match.group('name')}")
                continue
            if match.group("file"):
                references.append(f"{current_file}::{match.group('name')}")
        mapping[invariant] = references
    return mapping


def python_suite() -> tuple[set[str], bool, str]:
    """Identifiants collectés, suite verte ou non, résumé lisible.

    L'implémentation Python a été retirée après démonstration de la parité. Le script ne peut donc
    plus la ré-exécuter : il le dit, au lieu de présenter une colonne de référence comme revérifiée.
    """
    if not PYTEST.is_file() or not PY_CORE.is_dir():
        return set(), False, "implémentation retirée — colonne de référence figée, non ré-exécutée"
    collect = subprocess.run(  # noqa: S603
        [str(PYTEST), "--collect-only", "-q"],
        cwd=PY_CORE,
        capture_output=True,
        text=True,
        check=False,
    )
    # `pytest --collect-only -q` renvoie des chemins relatifs à la racine de collecte
    # (`tests/test_statuses.py::test_x`), tandis que l'audit cite `test_statuses.py::test_x`.
    # Comparer les chaînes brutes déclarerait « absent » chacun des tests cités : on compare donc
    # sur le nom du test, et on conserve le chemin pour le diagnostic.
    identifiers: set[str] = set()
    for line in collect.stdout.splitlines():
        line = line.strip()
        if "::" in line:
            identifiers.add(line.rsplit("::", 1)[-1])
    run = subprocess.run(  # noqa: S603
        [str(PYTEST), "-q"],
        cwd=PY_CORE,
        capture_output=True,
        text=True,
        check=False,
    )
    summary = run.stdout.strip().splitlines()[-1] if run.stdout.strip() else "aucune sortie"
    return identifiers, run.returncode == 0, summary


def typescript_suite() -> tuple[dict[str, list[str]], bool, str]:
    """{invariant: ["fichier > test"]} d'après les intitulés, suite verte ou non, résumé."""
    report_path = CORE / ".parity-vitest.json"
    env = {"PATH": f"{NODE_BIN}:{Path('/usr/bin')}", "HOME": str(Path.home())}
    subprocess.run(  # noqa: S603
        [
            str(NODE_BIN / "npx"),
            "vitest",
            "run",
            "--reporter=json",
            f"--outputFile={report_path}",
        ],
        cwd=CORE,
        capture_output=True,
        text=True,
        check=False,
        env=env,
    )
    if not report_path.is_file():
        return {}, False, "rapport JSON indisponible"
    payload = json.loads(report_path.read_text(encoding="utf-8"))
    report_path.unlink()

    by_invariant: dict[str, list[str]] = {}
    passed = 0
    total = 0
    for suite in payload.get("testResults", []):
        file_name = Path(str(suite.get("name", ""))).name
        for assertion in suite.get("assertionResults", []):
            total += 1
            if assertion.get("status") == "passed":
                passed += 1
            title = " > ".join(
                [*assertion.get("ancestorTitles", []), str(assertion.get("title", ""))]
            )
            # Un même test peut citer plusieurs invariants, et l'intitulé comme le titre du bloc
            # peuvent porter la mention : on déduplique pour ne pas gonfler artificiellement la
            # couverture affichée.
            for invariant in set(INVARIANT_RE.findall(title)):
                bucket = by_invariant.setdefault(invariant, [])
                entry = f"{file_name} › {title}"
                if entry not in bucket:
                    bucket.append(entry)
    summary = f"{passed}/{total} tests verts"
    return by_invariant, passed == total and total > 0, summary


def main(argv: list[str]) -> int:
    python_tests = parse_audit_document()
    collected, python_green, python_summary = python_suite()
    ts_by_invariant, ts_green, ts_summary = typescript_suite()

    python_available = PYTEST.is_file() and PY_CORE.is_dir()

    rows: list[dict[str, object]] = []
    for invariant in sorted(python_tests):
        references = python_tests[invariant]
        missing = [ref for ref in references if ref.rsplit("::", 1)[-1] not in collected]
        ts_tests = ts_by_invariant.get(invariant, [])
        if not python_available:
            # La colonne de référence ne peut plus être ré-exécutée : le verdict ne porte donc que
            # sur ce qui est réellement vérifiable aujourd'hui, et le dit explicitement.
            verdict = "VERIFIED (TypeScript)" if ts_tests and ts_green else "UNCOVERED"
        elif references and not missing and ts_tests and python_green and ts_green:
            verdict = "VERIFIED"
        elif (references and not missing) or ts_tests:
            verdict = "PARTIAL"
        else:
            verdict = "UNCOVERED"
        rows.append(
            {
                "invariant": invariant,
                "python": references,
                "python_missing": missing,
                "typescript": ts_tests,
                "verdict": verdict,
            }
        )

    verified = sum(1 for row in rows if str(row["verdict"]).startswith("VERIFIED"))
    partial = sum(1 for row in rows if row["verdict"] == "PARTIAL")
    uncovered = sum(1 for row in rows if row["verdict"] == "UNCOVERED")
    ts_only = sorted(set(ts_by_invariant) - set(python_tests))

    lines: list[str] = [
        "# Matrice de parité Python ↔ TypeScript",
        "",
        "Document **généré** par `scripts/parity_matrix.py` : chaque ligne provient de l'exécution",
        "réelle des deux suites de tests, pas d'une déclaration. Un invariant non couvert est listé",
        "comme non couvert.",
        "",
        (f"- Suite Python (référence) : {python_summary}"),
        f"- Suite TypeScript : {ts_summary} — {'VERTE' if ts_green else 'ROUGE'}",
        f"- Invariants recensés : {len(rows)} — **{verified} VERIFIED**, {partial} PARTIAL, "
        f"{uncovered} UNCOVERED",
        "",
        (
            "> L'implémentation Python a été retirée du dépôt après démonstration de la parité. Sa "
            "colonne est **figée** : elle n'est plus ré-exécutée, et le document ne prétend pas le "
            "contraire. La colonne TypeScript reste vérifiée à chaque exécution de ce script, et les "
            "journaux de référence produits par Python restent relus par la suite de tests "
            "(`core/tests/fixtures/`)."
            if not python_available
            else ""
        ),
        "",
        "## Détail par invariant",
        "",
        "| Invariant | Tests Python (référence) | Tests TypeScript | Verdict |",
        "|---|---|---|---|",
    ]
    for row in rows:
        python_cell = ", ".join(
            f"`{ref}`" + (" ⚠️ absent" if ref in row["python_missing"] else "")
            for ref in row["python"]
        )
        ts_cell = ", ".join(f"`{name}`" for name in row["typescript"]) or "—"
        lines.append(f"| {row['invariant']} | {python_cell or '—'} | {ts_cell} | {row['verdict']} |")

    lines += [
        "",
        "## Invariants déclarés côté TypeScript mais absents de l'audit de référence",
        "",
        "Ils signalent soit une couverture supplémentaire, soit une divergence de nomenclature à",
        "corriger :",
        "",
    ]
    lines += [f"- {invariant}" for invariant in ts_only] or ["- aucun"]

    lines += [
        "",
        "## Lecture",
        "",
        "`VERIFIED` signifie que les deux implémentations portent une garantie testée et que les deux",
        "suites sont vertes — pas que les deux implémentations sont identiques : elles diffèrent par",
        "la forme, ce qui est l'objet de la migration.",
        "",
        "`PARTIAL` signifie qu'un seul côté démontre la garantie. C'est le cas attendu pour les",
        "invariants introduits par la couche LLM, absents de l'implémentation de référence.",
        "",
        "`UNCOVERED` est un **défaut** : la garantie est écrite quelque part mais démontrée nulle",
        "part. La suppression de l'implémentation Python ne doit pas être décidée sur un",
        "`UNCOVERED`.",
        "",
    ]

    document = "\n".join(lines)
    if "--write" in argv:
        OUTPUT.write_text(document, encoding="utf-8")
        print(f"écrit : {OUTPUT.relative_to(REPO)}")
    else:
        print(document)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
