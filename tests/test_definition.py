"""Tests réels de la définition de CodiDev.

Exécution : python -m unittest discover -s tests -v

Ces tests ne testent pas « le code de l'agent » (il n'y en a pas) mais la **définition** :
profil, prompt, compétences, gouvernance, documents obligatoires, sécurité. Ils échouent si la
définition dérive — c'est leur unique raison d'être.
"""

from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
PROFIL = RACINE / "agent" / "codidev.json"
PROMPT = RACINE / "agent" / "codidev.prompt.md"

CAPACITES_ATTENDUES = 19
COMPETENCES_ATTENDUES = 15
OUTILS_AUTORISES = {"http_request", "current_time", "memory_write", "memory_read", "web_search"}
SECTIONS_PROMPT = (
    "## Mission", "## Workflow", "## Contraintes", "## Permissions", "## Human Gate",
    "## Frontière de sécurité", "## Arrêt", "## En cas d'échec", "## Preuves",
    "## Format de sortie", "## Mémoire",
)
SECRET_MOTIFS = (
    r"sk-[A-Za-z0-9]{16,}",              # clé OpenAI-like
    r"gh[pousr]_[A-Za-z0-9]{20,}",       # jeton GitHub
    r"Bearer\s+[A-Za-z0-9._~+/=-]{24,}",  # jeton en clair
)
FICHIERS_OBLIGATOIRES = (
    "README.md", "DESCRIPTION.md", "AGENT_SPEC.md", "SOUL.md", "SKILL.md", "CHANGELOG.md",
    "LICENSE", "docs/ARCHITECTURE.md", "docs/CAPACITES.md", "docs/GOUVERNANCE.md",
    "docs/EXPLOITATION.md", "skills/README.md", "memory/README.md", "memory/MEMORY.md",
    "scripts/verifier_depot.py", "scripts/inscrire_orchestrateur.py",
    "scripts/enregistrer_agent_os.py", "scripts/verifier_agent_os.py",
)


def profil() -> dict:
    return json.loads(PROFIL.read_text(encoding="utf-8"))


class TestProfil(unittest.TestCase):
    def test_profil_parse_et_identite(self):
        p = profil()
        self.assertEqual(p["name"], "CodiDev")
        self.assertEqual(p["system_prompt_file"], "codidev.prompt.md")

    def test_prompt_existe_et_sections(self):
        self.assertTrue(PROMPT.is_file(), f"{PROMPT} absent")
        texte = PROMPT.read_text(encoding="utf-8")
        for section in SECTIONS_PROMPT:
            self.assertIn(section, texte, f"section manquante dans le prompt : {section}")

    def test_outils_en_liste_blanche(self):
        outils = set(profil()["tools"])
        self.assertEqual(outils, OUTILS_AUTORISES)
        self.assertEqual(len(profil()["tools"]), len(outils), "outil déclaré en double")

    def test_permissions_gouvernance(self):
        perms = profil()["gouvernance"]["permissions"]
        for elevee in ("DELETE", "DEPLOY", "SEND"):
            self.assertIn("autorisation explicite", perms[elevee].lower())
        self.assertEqual(len(profil()["gouvernance"]["human_gate"]), 7)


class TestCompetences(unittest.TestCase):
    def test_quinze_competences_presentes(self):
        retenues = profil()["skills"]["retenues"]
        self.assertEqual(len(retenues), COMPETENCES_ATTENDUES)
        for nom in retenues:
            self.assertTrue((RACINE / "skills" / nom / "SKILL.md").is_file(), f"compétence absente : {nom}")

    def test_profil_et_disque_alignes(self):
        disque = sorted(p.name for p in (RACINE / "skills").iterdir() if p.is_dir())
        self.assertEqual(sorted(profil()["skills"]["retenues"]), disque)

    def test_provenance_declaree(self):
        self.assertIn("ECC", profil()["skills"]["catalogue"])


class TestCapacites(unittest.TestCase):
    def test_capacites_comptees_et_reparties(self):
        """19 capacités : le total est recomposé par script, jamais recopié de mémoire."""
        carte = {
            "full-stack engineering": 1, "advanced programming": 1, "frontend patterns": 1,
            "react performance": 1, "frontend accessibility": 1, "backend patterns": 1,
            "api design": 1, "fastapi patterns": 1, "error handling": 1,
            "software architecture": 1, "hexagonal architecture": 1,
            "architecture decision records": 1, "database migrations": 1,
            "devsecops": 1, "docker patterns": 1, "deployment patterns": 1,
            "python testing": 1, "end-to-end testing": 1, "coding standards": 1,
        }
        self.assertEqual(sum(carte.values()), CAPACITES_ATTENDUES)
        doc = (RACINE / "docs" / "CAPACITES.md").read_text(encoding="utf-8")
        self.assertIn(f"**{CAPACITES_ATTENDUES} capacités déclarées**", doc)


class TestDocumentsEtSecurite(unittest.TestCase):
    def test_fichiers_obligatoires(self):
        for relatif in FICHIERS_OBLIGATOIRES:
            self.assertTrue((RACINE / relatif).is_file(), f"fichier obligatoire absent : {relatif}")

    def test_aucun_secret_dans_le_depot(self):
        suspects = []
        for chemin in RACINE.rglob("*"):
            if not chemin.is_file() or ".git/" in chemin.as_posix():
                continue
            if chemin.suffix.lower() in {".png", ".jpg", ".ico", ".pdf", ".zip"}:
                continue
            if chemin.name in {"README.md"} and chemin.parent == RACINE / "memory":
                continue
            try:
                texte = chemin.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                continue
            for motif in SECRET_MOTIFS:
                for trouve in re.findall(motif, texte):
                    suspects.append(f"{chemin.relative_to(RACINE)} :: {trouve[:24]}…")
        self.assertEqual(suspects, [], f"secret potentiel détecté : {suspects}")

    def test_gitignore_couvre_les_secrets(self):
        contenu = (RACINE / ".gitignore").read_text(encoding="utf-8")
        for motif in (".env", "*.token", "*.key"):
            self.assertIn(motif, contenu)


if __name__ == "__main__":
    unittest.main(verbosity=2)
