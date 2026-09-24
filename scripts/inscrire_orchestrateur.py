#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
inscrire_orchestrateur.py — inscrit Builder Agent aupres d'un orchestrateur multi-agents
(API v1 : `POST /api/v1/agents/register`, champs `specialty`, `capabilities[]`, `metadata{}`).

Les capacites sont DERIVEES du profil `agent/builder-agent.json` (description, objectif et
`skills.retenues`), pas des outils du runtime : l'agent doit se declarer sur ce qu'il est,
sinon le routage des taches par l'orchestrateur est brouille.

Regles appliquees :
  - corps en ASCII pur (un caractere non-ASCII fait repondre 400 a un backend FastAPI) ;
  - corps d'inscription limite aux METADONNEES : aucun worker, aucun heartbeat, aucune
    execution de tache tiree de la file ;
  - la cle d'enregistrement (si la plateforme en exige une) est lue dans l'environnement,
    n'est jamais affichee, et reste un secret distinct du jeton d'agent ;
  - la verification se fait par relecture de `GET /api/v1/agents`, jamais par le code HTTP.

Usage :
  python scripts/inscrire_orchestrateur.py --dry-run
  python scripts/inscrire_orchestrateur.py --url https://api.exemple.com
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
SPECIALITE = "builder"
VARIABLES_CLE = ("ORCHESTRATOR_REGISTRATION_KEY", "REGISTRATION_KEY")

# Capacite declaree -> competence(s) normative(s) qui la portent.
# Toute competence de `skills.retenues` doit apparaitre ici : le script refuse de deviner.
CAPACITES_PAR_COMPETENCE: dict[str, list[str]] = {
    "coding-standards": ["advanced programming", "coding standards"],
    "api-design": ["api design"],
    "fastapi-patterns": ["fastapi patterns"],
    "backend-patterns": ["backend patterns"],
    "error-handling": ["error handling"],
    "frontend-patterns": ["frontend patterns"],
    "react-performance": ["react performance"],
    "frontend-a11y": ["frontend accessibility"],
    "database-migrations": ["database migrations"],
    "python-testing": ["python testing"],
    "e2e-testing": ["end-to-end testing"],
    "docker-patterns": ["docker patterns"],
    "deployment-patterns": ["deployment patterns", "devsecops"],
    "hexagonal-architecture": ["hexagonal architecture", "software architecture"],
    "architecture-decision-records": ["architecture decision records"],
}

# Capacites de niveau specialite : elles decrivent l'agent, pas une competence isolee.
CAPACITES_SPECIALITE = ["full-stack engineering"]


def capacites_derivees(profil: dict) -> list[str]:
    retenues = list((profil.get("skills") or {}).get("retenues") or [])
    if not retenues:
        raise SystemExit("Profil sans skills.retenues : impossible de deriver les capacites.")

    inconnues = [nom for nom in retenues if nom not in CAPACITES_PAR_COMPETENCE]
    if inconnues:
        raise SystemExit(
            "Competences sans capacite associee (mettre a jour CAPACITES_PAR_COMPETENCE) : "
            + ", ".join(inconnues)
        )

    capacites = list(CAPACITES_SPECIALITE)
    for nom in retenues:
        capacites.extend(CAPACITES_PAR_COMPETENCE[nom])
    return sorted(dict.fromkeys(capacites))


def charge_inscription(profil: dict, instance: str, contact: str) -> dict:
    return {
        "specialty": SPECIALITE,
        "capabilities": capacites_derivees(profil),
        "metadata": {
            "name": profil.get("name", "Builder Agent"),
            "version": "1.0.0",
            "instance_id": instance,
            "contact": contact,
            "mode": "assiste",
            "objective": profil.get("objective", ""),
            "skills_catalogue": (profil.get("skills") or {}).get("catalogue", ""),
            "note": (
                "Inscription de metadonnees seulement : aucun heartbeat, aucune execution "
                "automatique de taches. Toute execution est subordonnee a une autorisation "
                "explicite et respecte la gouvernance de l'agent (Human Gate, perimetre negatif)."
            ),
        },
    }


def appel(url: str, charge: dict | None, cle: str | None) -> tuple[int, dict]:
    donnees = json.dumps(charge, ensure_ascii=True).encode("ascii") if charge is not None else None
    r = urllib.request.Request(url, data=donnees, method="POST" if donnees else "GET")
    r.add_header("Content-Type", "application/json")
    if cle:
        r.add_header("X-Registration-Key", cle)
    with urllib.request.urlopen(r, timeout=60) as reponse:
        corps = reponse.read().decode("utf-8", "replace")
        return reponse.status, (json.loads(corps) if corps.strip() else {})


def main(argv=None) -> int:
    analyseur = argparse.ArgumentParser(description="Inscrit Builder Agent aupres d'un orchestrateur.")
    analyseur.add_argument("--url", default="https://api.cvlynk.com")
    analyseur.add_argument("--instance", default="hermes-builder-agent-01")
    analyseur.add_argument("--contact", default="")
    analyseur.add_argument("--dry-run", action="store_true")
    args = analyseur.parse_args(argv)
    base = args.url.rstrip("/")

    profil = json.loads((RACINE / "agent" / "builder-agent.json").read_text(encoding="utf-8"))
    charge = charge_inscription(profil, args.instance, args.contact)
    cle = next((os.environ.get(nom) for nom in VARIABLES_CLE if os.environ.get(nom)), None)

    print("Builder Agent — inscription aupres de l'orchestrateur")
    print(f"  cible        : {base}/api/v1/agents/register")
    print(f"  specialite   : {charge['specialty']}")
    print(f"  capacites    : {len(charge['capabilities'])}")
    print(f"  instance     : {args.instance}")
    print(f"  cle d'enreg. : {'fournie (masquee)' if cle else 'non fournie'}")

    if args.dry_run:
        print("\n  charge utile (mode --dry-run, rien n'a ete envoye) :")
        print(json.dumps(charge, ensure_ascii=True, indent=2))
        return 0

    try:
        statut, corps = appel(f"{base}/api/v1/agents/register", charge, cle)
        print(f"\n  inscription  : HTTP {statut}")
        for champ in ("agent_id", "agent_name", "specialty", "status", "message"):
            if corps.get(champ) is not None:
                print(f"    {champ:11}: {corps[champ]}")

        identifiant = corps.get("agent_id")
        statut, liste = appel(f"{base}/api/v1/agents", None, cle)
        agents = liste.get("agents", []) if isinstance(liste, dict) else liste
        trouve = next((a for a in agents if a.get("agent_id") == identifiant), None)
        print(f"\n  verification par relecture ({len(agents)} agent(s) declare(s)) :")
        for agent in agents:
            marque = "  <-- le notre" if agent.get("agent_id") == identifiant else ""
            print(
                f"    - {str(agent.get('agent_id')):<16} {str(agent.get('agent_name', '')):<16} "
                f"{str(agent.get('specialty')):<10} {agent.get('status')}{marque}"
            )
        if not trouve:
            print("\n  ECHEC : la relecture ne retrouve pas l'agent inscrit.")
            return 1
        print("\n  OK : inscription confirmee par relecture.")
        return 0
    except urllib.error.HTTPError as erreur:
        print(f"\n  ECHEC : HTTP {erreur.code} — {erreur.read().decode('utf-8', 'replace')[:300]}",
              file=sys.stderr)
        return 1
    except urllib.error.URLError as erreur:
        print(f"\n  ECHEC : orchestrateur injoignable ({erreur.reason})", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
