#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
verifier_depot.py — controle de coherence du depot Builder Agent.

Verifie, sans reseau et sans secret :
  1. le profil `agent/builder-agent.json` (JSON valide, champs obligatoires, bornes) ;
  2. le prompt systeme pointe par `system_prompt_file` (existe, taille, sections obligatoires) ;
  3. la liste `skills.retenues` face aux competences presentes dans `skills/` ;
  4. chaque competence : `SKILL.md` avec frontmatter `name` / `description` ;
  5. les outils declares face a la liste blanche des orchestrateurs connus (filtrage silencieux) ;
  6. la gouvernance : permissions, Human Gate, interdits ;
  7. l'absence de secret en clair dans les fichiers versionnes.

Usage :
  python scripts/verifier_depot.py
  python scripts/verifier_depot.py --racine C:/chemin/vers/builder-agent
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

# Liste blanche des outils de la console Agent OS (lib/tools.ts : TOOL_DEFS / TOOL_NAMES).
# Tout nom absent de cette liste est supprime en silence cote serveur.
OUTILS_CONNUS = {
    "http_request",
    "web_search",
    "memory_write",
    "memory_read",
    "current_time",
}

CHAMPS_PROFIL_OBLIGATOIRES = (
    "name",
    "description",
    "objective",
    "system_prompt_file",
    "model",
    "temperature",
    "max_turns",
    "tools",
    "enabled",
)

SECTIONS_PROMPT = {
    "Mission": ("## Mission",),
    "Workflow": ("## Workflow",),
    "Contraintes": ("## Contraintes",),
    "Permissions": ("## Permissions",),
    "Human Gate": ("## Human Gate",),
    "Frontiere de securite": (
        "## Frontière de sécurité",
        "## Frontiere de sécurité",
        "## Frontière de securite",
        "## Frontiere de securite",
    ),
    "Conditions d'arret": ("## Arrêt", "## Arret"),
    "Comportement d'echec": ("## En cas d'échec", "## En cas d'echec"),
    "Preuves": ("## Preuves",),
    "Format de sortie": ("## Format de sortie",),
    "Memoire": ("## Mémoire", "## Memoire"),
}

# Motifs de secrets : cle d'API, jeton GitHub, cle privee, entete d'autorisation, affectation.
MOTIFS_SECRETS = (
    (re.compile(r"\bsk-[A-Za-z0-9_\-]{20,}"), "cle de type sk-..."),
    (re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}"), "jeton GitHub"),
    (re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}"), "jeton GitHub fine-grained"),
    (re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "cle AWS"),
    (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"), "cle privee PEM"),
    (re.compile(r"\bBearer\s+[A-Za-z0-9_\-\.]{24,}"), "jeton Bearer en clair"),
    (
        re.compile(
            r"(?i)\b(api[_-]?key|secret|token|password|passwd|mot[_-]?de[_-]?passe)\b\s*[:=]\s*"
            r"[\"']([^\"'\s]{16,})[\"']"
        ),
        "affectation de secret",
    ),
)

PLACEHOLDERS = (
    "xxx", "your", "votre", "exemple", "example", "placeholder", "changeme", "a-completer",
    "todo", "dummy", "fake", "<", ">", "...", "$", "****", "abcd1234", "secret_", "mon_",
)

FICHIERS_IGNORES = {".git", "__pycache__", "node_modules", ".venv", "venv"}
EXTENSIONS_TEXTE = {
    ".md", ".json", ".py", ".txt", ".yml", ".yaml", ".toml", ".ini", ".cfg", ".sh",
    ".ts", ".tsx", ".js", ".jsx", ".env", ".example", "",
}


class Controle:
    def __init__(self) -> None:
        self.echecs: list[str] = []
        self.avertissements: list[str] = []
        self.numeros = 0

    def ok(self, titre: str, detail: str = "") -> None:
        self.numeros += 1
        suffixe = f" — {detail}" if detail else ""
        print(f"  [{self.numeros:02d}] OK   {titre}{suffixe}")

    def ko(self, titre: str, detail: str) -> None:
        self.numeros += 1
        print(f"  [{self.numeros:02d}] KO   {titre} — {detail}")
        self.echecs.append(f"{titre} : {detail}")

    def attention(self, titre: str, detail: str) -> None:
        self.numeros += 1
        print(f"  [{self.numeros:02d}] !    {titre} — {detail}")
        self.avertissements.append(f"{titre} : {detail}")


def lire_profil(racine: Path, c: Controle) -> dict | None:
    chemin = racine / "agent" / "builder-agent.json"
    if not chemin.is_file():
        c.ko("Profil present", f"fichier absent : {chemin}")
        return None
    try:
        profil = json.loads(chemin.read_text(encoding="utf-8"))
    except json.JSONDecodeError as erreur:
        c.ko("Profil : JSON valide", str(erreur))
        return None
    c.ok("Profil : JSON valide", "agent/builder-agent.json")

    manquants = [champ for champ in CHAMPS_PROFIL_OBLIGATOIRES if champ not in profil]
    if manquants:
        c.ko("Profil : champs obligatoires", f"manquants : {', '.join(manquants)}")
    else:
        c.ok("Profil : champs obligatoires", f"{len(CHAMPS_PROFIL_OBLIGATOIRES)} champs")

    tours = profil.get("max_turns")
    if isinstance(tours, int) and 1 <= tours <= 40:
        c.ok("Profil : max_turns dans la borne", f"1..40 (valeur {tours})")
    else:
        c.ko("Profil : max_turns dans la borne", f"attendu 1..40, recu {tours!r}")

    temperature = profil.get("temperature")
    if isinstance(temperature, (int, float)) and 0 <= temperature <= 2:
        c.ok("Profil : temperature", str(temperature))
    else:
        c.ko("Profil : temperature", f"attendu 0..2, recu {temperature!r}")

    outils = profil.get("tools") or []
    inconnus = [outil for outil in outils if outil not in OUTILS_CONNUS]
    if inconnus:
        c.ko(
            "Profil : outils reconnus",
            f"seraient supprimes en silence par la plateforme : {', '.join(inconnus)}",
        )
    else:
        c.ok("Profil : outils reconnus", f"{len(outils)} outils, tous dans la liste blanche")

    return profil


def verifier_prompt(racine: Path, profil: dict, c: Controle) -> str | None:
    nom = profil.get("system_prompt_file")
    if not nom:
        c.ko("Prompt : system_prompt_file", "champ absent")
        return None
    chemin = (racine / "agent" / nom).resolve()
    if not chemin.is_file():
        c.ko("Prompt : fichier present", f"introuvable : {chemin}")
        return None
    texte = chemin.read_text(encoding="utf-8")
    c.ok("Prompt : fichier present", f"{chemin.name} ({len(texte)} caracteres)")

    if len(texte) < 2000:
        c.attention(
            "Prompt : taille",
            f"{len(texte)} caracteres — un prompt trop court perd la gouvernance",
        )
    else:
        c.ok("Prompt : taille suffisante", f"{len(texte)} caracteres")

    absentes = [
        nom_section
        for nom_section, variantes in SECTIONS_PROMPT.items()
        if not any(variante in texte for variante in variantes)
    ]
    if absentes:
        c.ko("Prompt : sections obligatoires", f"absentes : {', '.join(absentes)}")
    else:
        c.ok("Prompt : sections obligatoires", f"{len(SECTIONS_PROMPT)} sections")

    return texte


def verifier_competences(racine: Path, profil: dict, c: Controle) -> list[str]:
    dossier = racine / "skills"
    if not dossier.is_dir():
        c.ko("Competences : dossier present", f"introuvable : {dossier}")
        return []

    profil_skills = profil.get("skills") or {}
    retenues = list(profil_skills.get("retenues") or [])
    sur_disque = sorted(
        enfant.name for enfant in dossier.iterdir() if enfant.is_dir() and (enfant / "SKILL.md").is_file()
    )

    manquantes = sorted(set(retenues) - set(sur_disque))
    en_trop = sorted(set(sur_disque) - set(retenues))
    if manquantes:
        c.ko("Competences : retenues presentes", f"absentes du disque : {', '.join(manquantes)}")
    if en_trop:
        c.ko("Competences : pas d'orpheline", f"presentes mais non declarees : {', '.join(en_trop)}")
    if not manquantes and not en_trop:
        c.ok("Competences : profil == disque", f"{len(sur_disque)} competences alignees")

    invalides = []
    for nom in sur_disque:
        texte = (dossier / nom / "SKILL.md").read_text(encoding="utf-8")
        if not re.search(r"(?m)^name:\s*\S+", texte) or not re.search(r"(?m)^description:\s*\S+", texte):
            invalides.append(nom)
    if invalides:
        c.ko("Competences : frontmatter", f"sans name/description : {', '.join(invalides)}")
    else:
        c.ok("Competences : frontmatter", "name et description dans chaque SKILL.md")

    catalogue = profil_skills.get("catalogue")
    if catalogue:
        c.ok("Competences : provenance declaree", str(catalogue))
    else:
        c.attention("Competences : provenance declaree", "champ skills.catalogue absent")

    return sur_disque


def verifier_gouvernance(profil: dict, c: Controle) -> None:
    gouvernance = profil.get("gouvernance") or {}
    permissions = gouvernance.get("permissions") or {}
    attendus = {"READ", "WRITE", "EXECUTE", "DELETE", "DEPLOY", "SEND"}
    absents = sorted(attendus - set(permissions))
    if absents:
        c.ko("Gouvernance : permissions", f"non declarees : {', '.join(absents)}")
    else:
        elevees = [
            nom for nom in ("DELETE", "DEPLOY", "SEND")
            if "explicite" not in str(permissions.get(nom, "")).lower()
        ]
        if elevees:
            c.ko(
                "Gouvernance : permissions elevees bornees",
                f"sans autorisation explicite : {', '.join(elevees)}",
            )
        else:
            c.ok("Gouvernance : permissions", "DELETE/DEPLOY/SEND sous autorisation explicite")

    portes = gouvernance.get("human_gate") or []
    if len(portes) >= 5:
        c.ok("Gouvernance : Human Gate", f"{len(portes)} declencheurs")
    else:
        c.ko("Gouvernance : Human Gate", f"{len(portes)} declencheur(s), 5 attendus au minimum")

    interdits = gouvernance.get("interdits") or []
    if len(interdits) >= 5:
        c.ok("Gouvernance : interdits", f"{len(interdits)} interdits")
    else:
        c.ko("Gouvernance : interdits", f"{len(interdits)} interdit(s), 5 attendus au minimum")


def est_placeholder(valeur: str) -> bool:
    bas = valeur.lower()
    return any(marqueur in bas for marqueur in PLACEHOLDERS)


def verifier_secrets(racine: Path, c: Controle) -> None:
    trouves: list[str] = []
    examines = 0
    for chemin in sorted(racine.rglob("*")):
        if not chemin.is_file():
            continue
        if FICHIERS_IGNORES & set(chemin.parts):
            continue
        if chemin.suffix.lower() not in EXTENSIONS_TEXTE:
            continue
        examines += 1
        try:
            contenu = chemin.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for ligne_numero, ligne in enumerate(contenu.splitlines(), start=1):
            for motif, etiquette in MOTIFS_SECRETS:
                correspondance = motif.search(ligne)
                if correspondance and not est_placeholder(correspondance.group(0)):
                    trouves.append(
                        f"{chemin.relative_to(racine)}:{ligne_numero} ({etiquette})"
                    )

    if trouves:
        c.ko("Secrets : aucun secret versionne", "; ".join(trouves[:10]))
    else:
        c.ok("Secrets : aucun secret versionne", f"{examines} fichiers analyses")


def main(argv=None) -> int:
    analyseur = argparse.ArgumentParser(description="Controle de coherence du depot Builder Agent.")
    analyseur.add_argument(
        "--racine",
        default=str(Path(__file__).resolve().parent.parent),
        help="racine du depot (defaut : dossier parent de scripts/)",
    )
    args = analyseur.parse_args(argv)
    racine = Path(args.racine).resolve()

    print(f"Builder Agent — controle du depot : {racine}\n")
    c = Controle()

    profil = lire_profil(racine, c)
    if profil:
        verifier_prompt(racine, profil, c)
        noms = verifier_competences(racine, profil, c)
        verifier_gouvernance(profil, c)
        print(
            f"\n  Identite : {profil.get('name')} | modele {profil.get('model')} | "
            f"{len(profil.get('tools') or [])} outils | {len(noms)} competences normatives"
        )
    verifier_secrets(racine, c)

    print(
        f"\n  Resultat : {c.numeros - len(c.echecs) - len(c.avertissements)}/{c.numeros} controles verts, "
        f"{len(c.echecs)} echec(s), {len(c.avertissements)} avertissement(s)"
    )
    for echec in c.echecs:
        print(f"    ECHEC : {echec}")
    for avertissement in c.avertissements:
        print(f"    AVERTISSEMENT : {avertissement}")
    return 1 if c.echecs else 0


if __name__ == "__main__":
    sys.exit(main())
