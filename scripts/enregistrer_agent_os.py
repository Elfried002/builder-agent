#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
enregistrer_agent_os.py — enregistre Builder Agent sur une console Agent OS.

Contrat : `POST /api/agents` avec `Authorization: Bearer <ADMIN_TOKEN>` et les champs
`name`, `description`, `system_prompt`, `objective`, `model`, `base_url`, `temperature`,
`max_turns`, `tools`, `schedule`, `enabled`. Reponse attendue : 201 + `{id}`.

Le jeton est lu dans l'environnement (ou dans un fichier .env hors du depot) et n'est
JAMAIS affiche : seule une empreinte masquee est imprimee.

PRECISION : un 201 ne prouve pas que l'agent fonctionne. Verifier ensuite avec
`verifier_agent_os.py` (relecture de la fiche + execution reelle).

Usage :
  export AGENT_OS_ADMIN_TOKEN=...
  python scripts/enregistrer_agent_os.py --base-url http://127.0.0.1:3000 --dry-run
  python scripts/enregistrer_agent_os.py --base-url http://127.0.0.1:3000
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
VARIABLES_JETON = ("AGENT_OS_ADMIN_TOKEN", "ADMIN_TOKEN")


def lire_jeton(env_file: Path | None) -> str | None:
    for nom in VARIABLES_JETON:
        valeur = os.environ.get(nom)
        if valeur:
            return valeur.strip()
    if env_file and env_file.is_file():
        for ligne in env_file.read_text(encoding="utf-8", errors="ignore").splitlines():
            ligne = ligne.strip()
            if not ligne or ligne.startswith("#") or "=" not in ligne:
                continue
            cle, _, valeur = ligne.partition("=")
            if cle.strip() in VARIABLES_JETON:
                return valeur.strip().strip('"').strip("'")
    return None


def masquer(secret: str | None) -> str:
    if not secret:
        return "(absent)"
    return f"****{secret[-4:]}" if len(secret) > 8 else "(trop court)"


def construire_charge(racine: Path) -> dict:
    chemin_profil = racine / "agent" / "builder-agent.json"
    profil = json.loads(chemin_profil.read_text(encoding="utf-8"))

    nom_prompt = profil.get("system_prompt_file")
    if not nom_prompt:
        raise SystemExit("Profil invalide : champ system_prompt_file absent.")
    chemin_prompt = (chemin_profil.parent / nom_prompt).resolve()
    if not chemin_prompt.is_file():
        raise SystemExit(f"Prompt systeme introuvable : {chemin_prompt}")
    prompt = chemin_prompt.read_text(encoding="utf-8")

    return {
        "name": profil["name"],
        "description": profil["description"],
        "objective": profil["objective"],
        "system_prompt": prompt,
        "model": profil.get("model"),
        "base_url": profil.get("base_url"),
        "temperature": profil.get("temperature"),
        "max_turns": profil.get("max_turns"),
        "tools": profil.get("tools") or [],
        "schedule": profil.get("schedule") or "",
        "enabled": bool(profil.get("enabled", True)),
    }


def poster(base: str, charge: dict, jeton: str) -> tuple[int, dict]:
    donnees = json.dumps(charge, ensure_ascii=False).encode("utf-8")
    requete = urllib.request.Request(f"{base}/api/agents", data=donnees, method="POST")
    requete.add_header("Content-Type", "application/json; charset=utf-8")
    requete.add_header("Authorization", f"Bearer {jeton}")
    with urllib.request.urlopen(requete, timeout=60) as reponse:
        corps = reponse.read().decode("utf-8", "replace")
        return reponse.status, (json.loads(corps) if corps.strip() else {})


def main(argv=None) -> int:
    analyseur = argparse.ArgumentParser(description="Enregistre Builder Agent sur une console Agent OS.")
    analyseur.add_argument("--base-url", default="http://127.0.0.1:3000")
    analyseur.add_argument("--env-file", default=None, help="fichier .env hors depot contenant le jeton")
    analyseur.add_argument("--dry-run", action="store_true", help="imprime la charge utile sans envoyer")
    args = analyseur.parse_args(argv)
    base = args.base_url.rstrip("/")

    charge = construire_charge(RACINE)
    jeton = lire_jeton(Path(args.env_file) if args.env_file else None)

    print("Builder Agent — enregistrement sur Agent OS")
    print(f"  cible              : {base}/api/agents")
    print(f"  agent              : {charge['name']}")
    print(f"  modele             : {charge['model']} (temperature {charge['temperature']}, max_turns {charge['max_turns']})")
    print(f"  outils declares    : {', '.join(charge['tools'])}")
    print(f"  system_prompt      : {len(charge['system_prompt'])} caracteres")
    print(f"  jeton admin        : {masquer(jeton)}")

    if args.dry_run:
        apercu = {cle: valeur for cle, valeur in charge.items() if cle != "system_prompt"}
        apercu["system_prompt"] = f"<{len(charge['system_prompt'])} caracteres, non imprime>"
        print("\n  charge utile (mode --dry-run, rien n'a ete envoye) :")
        print(json.dumps(apercu, ensure_ascii=False, indent=2))
        return 0

    if not jeton:
        print("\n  ECHEC : jeton admin absent (AGENT_OS_ADMIN_TOKEN ou --env-file).", file=sys.stderr)
        return 2

    try:
        statut, corps = poster(base, charge, jeton)
    except urllib.error.HTTPError as erreur:
        detail = erreur.read().decode("utf-8", "replace")[:300]
        print(f"\n  ECHEC : HTTP {erreur.code} — {detail}", file=sys.stderr)
        return 1
    except urllib.error.URLError as erreur:
        print(f"\n  ECHEC : console injoignable ({erreur.reason})", file=sys.stderr)
        return 1

    identifiant = corps.get("id") or corps.get("agent_id")
    print(f"\n  reponse            : HTTP {statut} — id {identifiant}")
    print("  ATTENTION : un 201 ne prouve pas que l'agent fonctionne.")
    print(f"  verifier           : python scripts/verifier_agent_os.py --base-url {base} --run")
    return 0


if __name__ == "__main__":
    sys.exit(main())
