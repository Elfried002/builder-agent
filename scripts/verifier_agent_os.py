#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
verifier_agent_os.py — verifie l'enregistrement de Builder Agent sur une console Agent OS.

Principe : la relecture fait preuve, pas le code HTTP de l'ecriture.

  1. relecture  : GET /api/agents — la fiche existe, avec le bon modele, les bons outils, enabled ;
  2. execution  : POST /api/agents/:id/run — objectif inerte, lecture du CORPS de la reponse
                  (status, turns, error), car HTTP 200 peut accompagner `status: "error"`.

Le jeton est lu dans l'environnement et n'est jamais affiche. Le corps envoye est en ASCII pur
(un caractere non-ASCII fait repondre 400 a un backend FastAPI).

Usage :
  export AGENT_OS_ADMIN_TOKEN=...
  python scripts/verifier_agent_os.py --base-url http://127.0.0.1:3000
  python scripts/verifier_agent_os.py --base-url http://127.0.0.1:3000 --run
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
VARIABLES_JETON = ("AGENT_OS_ADMIN_TOKEN", "ADMIN_TOKEN")
OBJECTIF_INERTE = (
    "Reponds uniquement par le texte READY-OK. N'ecris aucun fichier, n'appelle aucun service, "
    "ne modifie rien : c'est une execution de controle."
)


def lire_jeton() -> str | None:
    for nom in VARIABLES_JETON:
        valeur = (__import__("os").environ.get(nom) or "").strip()
        if valeur:
            return valeur
    return None


def requete(url: str, jeton: str, charge: dict | None = None) -> tuple[int, dict]:
    donnees = json.dumps(charge, ensure_ascii=True).encode("ascii") if charge is not None else None
    r = urllib.request.Request(url, data=donnees, method="POST" if donnees else "GET")
    r.add_header("Authorization", f"Bearer {jeton}")
    if donnees:
        r.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(r, timeout=180) as reponse:
        corps = reponse.read().decode("utf-8", "replace")
        return reponse.status, (json.loads(corps) if corps.strip() else {})


def main(argv=None) -> int:
    analyseur = argparse.ArgumentParser(description="Verifie Builder Agent sur une console Agent OS.")
    analyseur.add_argument("--base-url", default="http://127.0.0.1:3000")
    analyseur.add_argument("--nom", default=None, help="nom a retrouver (defaut : celui du profil)")
    analyseur.add_argument("--run", action="store_true", help="lance une execution de controle")
    analyseur.add_argument("--objectif", default=OBJECTIF_INERTE)
    args = analyseur.parse_args(argv)
    base = args.base_url.rstrip("/")

    profil = json.loads((RACINE / "agent" / "builder-agent.json").read_text(encoding="utf-8"))
    nom = args.nom or profil["name"]
    jeton = lire_jeton()
    if not jeton:
        print("ECHEC : jeton admin absent (AGENT_OS_ADMIN_TOKEN).", file=sys.stderr)
        return 2

    # --- 1. relecture ---------------------------------------------------------
    try:
        statut, liste = requete(f"{base}/api/agents", jeton)
    except urllib.error.HTTPError as erreur:
        print(f"ECHEC : GET /api/agents -> HTTP {erreur.code}", file=sys.stderr)
        return 1
    except urllib.error.URLError as erreur:
        print(f"ECHEC : console injoignable ({erreur.reason})", file=sys.stderr)
        return 1

    agents = liste if isinstance(liste, list) else liste.get("agents", [])
    fiche = next((a for a in agents if a.get("name") == nom), None)
    print(f"Relecture de GET /api/agents (HTTP {statut}, {len(agents)} agent(s) declare(s)) :")
    if not fiche:
        print(f"  ECHEC : aucune fiche au nom « {nom} ».")
        return 1

    attendus = {
        "model": profil.get("model"),
        "temperature": profil.get("temperature"),
        "max_turns": profil.get("max_turns"),
        "enabled": bool(profil.get("enabled", True)),
    }
    print(f"  id        : {fiche.get('id')}")
    print(f"  nom       : {fiche.get('name')}")
    print(f"  modele    : {fiche.get('model')}")
    print(f"  outils    : {', '.join(fiche.get('tools') or [])}")
    print(f"  enabled   : {fiche.get('enabled')}")
    print(f"  cle LLM   : {'presente' if fiche.get('has_api_key') else 'ABSENTE'}")

    ecarts = []
    for champ, attendu in attendus.items():
        recu = fiche.get(champ)
        if recu != attendu:
            ecarts.append(f"{champ} : attendu {attendu!r}, recu {recu!r}")
    outils_fiche = set(fiche.get("tools") or [])
    outils_profil = set(profil.get("tools") or [])
    if outils_fiche != outils_profil:
        perdus = sorted(outils_profil - outils_fiche)
        ecarts.append(f"outils perdus au filtrage serveur : {', '.join(perdus) or 'aucun'}")

    if ecarts:
        print("  ECHEC : ecarts entre le profil et la fiche :")
        for ecart in ecarts:
            print(f"    - {ecart}")
        return 1
    print("  OK : la fiche correspond au profil (modele, outils, enabled).")

    if not args.run:
        print("\nRelecture seule. Ajouter --run pour une execution de controle.")
        return 0

    # --- 2. execution de controle --------------------------------------------
    identifiant = fiche.get("id")
    try:
        statut, resultat = requete(
            f"{base}/api/agents/{identifiant}/run", jeton, {"objective": args.objectif}
        )
    except urllib.error.HTTPError as erreur:
        if erreur.code == 409:
            print("\nExecution sautee (HTTP 409) : verrou anti-chevauchement. Ce n'est pas une erreur de l'agent.")
            return 0
        print(f"\nECHEC : execution -> HTTP {erreur.code}", file=sys.stderr)
        return 1

    etat = resultat.get("status")
    print(f"\nExecution de controle (HTTP {statut}) :")
    print(f"  status      : {etat}")
    print(f"  turns       : {resultat.get('turns')}")
    print(f"  costUsd     : {resultat.get('costUsd')}")
    print(f"  durationMs  : {resultat.get('durationMs')}")
    if resultat.get("error"):
        print(f"  erreur      : {resultat['error']}")
        print("\nECHEC : l'agent est enregistre mais ne travaille pas.")
        return 1
    if etat != "success":
        print(f"\nECHEC : statut inattendu « {etat} » (attendu « success »).")
        return 1
    print("\nOK : agent enregistre ET operationnel (execution reelle reussie).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
