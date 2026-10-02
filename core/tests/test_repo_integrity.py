"""Tests d'intégrité du dépôt lui-même.

Ces tests opposent le dépôt à ses propres règles : aucun secret versionné, préservation réelle de
la définition historique, et absence de couplage runtime interdit par les ADR-0002/0003/0004.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

from codidev.security import Finding, SecretScanner, SecurityAllowlist
from codidev.security.secrets import DEFAULT_RULES

#: Termes dont la présence dans `src/` signalerait un couplage interdit par une ADR.
INTERDITS_DANS_SRC = (
    "multi-agent-orchestrator",
    "multi_agent_orchestrator",
    "telegram",
)


def _tracked_files(repo_root: Path) -> list[Path]:
    """Fichiers réellement versionnés — la question posée est « qu'est-ce qui est publié ? »."""
    git = shutil.which("git")
    if git is None:  # pragma: no cover - git est requis partout ailleurs dans le projet
        pytest.skip("git absent de l'environnement")
    result = subprocess.run(  # noqa: S603 — argv fixe, sans shell, aucun entrant externe
        [git, "ls-files"],
        cwd=repo_root,
        capture_output=True,
        text=True,
        check=True,
    )
    return [repo_root / line for line in result.stdout.splitlines() if line.strip()]


def _scan_tracked(repo_root: Path) -> list[Finding]:
    scanner = SecretScanner()
    findings: list[Finding] = []
    for path in _tracked_files(repo_root):
        findings.extend(scanner.scan_file(path))
    return findings


def test_aucun_secret_non_revu_dans_le_depot(repo_root: Path) -> None:
    """Aucun fichier versionné ne contient de secret, une fois les exceptions revues appliquées."""
    findings = _scan_tracked(repo_root)
    allowlist = SecurityAllowlist.load_for(repo_root)
    active, suppressed = allowlist.partition(findings, root=repo_root)
    rapport = "\n".join(
        f"{finding.source}:{finding.line} [{finding.rule}] {finding.excerpt}" for finding in active
    )
    assert active == [], f"secret non revu détecté dans le dépôt :\n{rapport}"

    # Chaque exception visant une règle du scanner de secrets doit couvrir une constatation
    # réelle : une exception devenue inutile doit être retirée pour que le jeu reste exact.
    regles_du_scanner = {rule.name for rule in DEFAULT_RULES}
    attendues = [entry for entry in allowlist.entries if entry.rule in regles_du_scanner]
    assert len(suppressed) == len(attendues), (
        "une exception de secrets ne correspond à aucune constatation : "
        f"{len(suppressed)} supprimée(s) pour {len(attendues)} exception(s) déclarée(s)"
    )


def test_le_detecteur_signale_toujours_les_exemples_non_revus(repo_root: Path) -> None:
    """Sans le jeu d'exceptions, les exemples documentaires restent détectés.

    Ce test protège contre l'affaiblissement silencieux des règles : le filtre d'exceptions ne
    doit pas devenir un détecteur désactivé.
    """
    findings = _scan_tracked(repo_root)
    assert any(finding.rule == "database-url-with-credentials" for finding in findings)


def test_toute_exception_porte_une_justification(repo_root: Path) -> None:
    allowlist = SecurityAllowlist.load_for(repo_root)
    assert allowlist.entries, "le dépôt doit déclarer ses exceptions de façon explicite"
    for entry in allowlist.entries:
        assert len(entry.justification) >= 20, entry.rule
        assert entry.reviewed_by
        assert entry.reviewed_at


def test_la_definition_historique_est_preservee(repo_root: Path) -> None:
    legacy = repo_root / "legacy" / "agent-definition-v3"
    attendus = (
        "README.md",
        "AGENT_SPEC.md",
        "SOUL.md",
        "SKILL.md",
        "DESCRIPTION.md",
        "CHANGELOG.md",
        "LICENSE",
        ".gitignore",
        "agent/codidev.json",
        "agent/codidev.prompt.md",
        "docs/ARCHITECTURE.md",
        "docs/CAPACITES.md",
        "docs/GOUVERNANCE.md",
        "docs/EXPLOITATION.md",
        "memory/MEMORY.md",
        "scripts/verifier_depot.py",
        "tests/test_definition.py",
        "evidence.json",
        "RAPPORT_EXECUTION.json",
        "archive/orchestrateur/README.md",
        "integrations/agent-os/README.md",
    )
    manquants = [relatif for relatif in attendus if not (legacy / relatif).is_file()]
    assert manquants == [], f"éléments historiques manquants : {manquants}"
    assert len(list((legacy / "skills").glob("*/SKILL.md"))) == 15


def test_le_core_est_autonome_dans_core(core_root: Path, repo_root: Path) -> None:
    """Le cœur est un paquet autonome, intégrable tel quel dans le projet final."""
    assert (core_root / "pyproject.toml").is_file()
    assert (core_root / "uv.lock").is_file()
    assert (core_root / "LICENSE").is_file()
    assert (core_root / "src" / "codidev" / "__init__.py").is_file()
    assert (core_root / "tests" / "test_contracts.py").is_file()
    # Aucun fichier de code du cœur ne traîne à la racine du dépôt : la racine est réservée au
    # projet dans son ensemble (documentation, historique, emplacements plateforme).
    assert not (repo_root / "src").exists()
    assert not (repo_root / "pyproject.toml").exists()


def test_le_corpus_de_reference_est_versionne(repo_root: Path) -> None:
    corpus = repo_root / "docs" / "construction" / "CODIDEV_DOCUMENTATION"
    assert corpus.is_dir()
    assert len(list(corpus.rglob("*.md"))) == 83
    assert (corpus / "MANIFEST.md").is_file()


def test_aucun_couplage_runtime_interdit_dans_src(core_root: Path, repo_root: Path) -> None:
    src = core_root / "src"
    trouves: list[str] = []
    for chemin in sorted(src.rglob("*.py")):
        contenu = chemin.read_text(encoding="utf-8").lower()
        for terme in INTERDITS_DANS_SRC:
            if terme in contenu:
                trouves.append(f"{chemin.relative_to(repo_root)} :: {terme}")
    assert trouves == [], f"couplage interdit détecté : {trouves}"


def test_le_core_ne_reference_aucun_emplacement_de_plateforme(core_root: Path) -> None:
    """Le cœur ignore la plateforme (ADR-0009) : il ne la nomme, ne l'importe, ne la suppose pas.

    Le contrôle porte sur les références du cœur, pas sur l'existence des dossiers : la plateforme
    sera construite plus tard dans ce même dépôt.
    """
    # Le contrôle porte sur les dépendances réelles — imports et chemins — et non sur une simple
    # mention : une règle de détection de secret nommée d'après un fournisseur n'est pas un
    # couplage.
    import re

    importation = re.compile(r"^\s*(?:import|from)\s+(platform|frontend|supabase|lovable)\b")
    chemin_plateforme = re.compile(r"[\"'](?:\.\./)*(?:platform|frontend|supabase|lovable)/")
    trouves: list[str] = []
    for fichier in sorted((core_root / "src").rglob("*.py")):
        for numero, ligne in enumerate(fichier.read_text(encoding="utf-8").splitlines(), 1):
            if importation.search(ligne) or chemin_plateforme.search(ligne):
                trouves.append(f"{fichier.relative_to(core_root)}:{numero}")
    assert trouves == [], f"couplage à un emplacement de plateforme dans le cœur : {trouves}"


def test_le_core_nimporte_aucun_runtime_externe(core_root: Path) -> None:
    """Le cœur ne dépend que de la bibliothèque standard et de ses deux dépendances déclarées.

    ADR-0002 : aucune dépendance runtime à l'environnement de construction.
    """
    import sys

    src = core_root / "src"
    autorisees = set(sys.stdlib_module_names) | {"codidev", "jsonschema", "referencing"}
    importees: set[str] = set()
    for chemin in sorted(src.rglob("*.py")):
        for ligne in chemin.read_text(encoding="utf-8").splitlines():
            ligne = ligne.strip()
            if ligne.startswith("import ") or ligne.startswith("from "):
                importees.add(ligne.split()[1].split(".")[0])
    inattendues = importees - autorisees
    assert inattendues == set(), f"import inattendu dans src/ : {sorted(inattendues)}"


def test_les_artefacts_de_verification_ne_sont_pas_versionnes(repo_root: Path) -> None:
    ignore = (repo_root / ".gitignore").read_text(encoding="utf-8")
    for motif in (".env", "*.token", "*.key", "artifacts/", "*.evidence.jsonl"):
        assert motif in ignore, f"motif d'exclusion absent : {motif}"
