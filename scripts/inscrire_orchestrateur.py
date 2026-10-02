#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""inscrire_orchestrateur.py — inscrit CodiDev auprès d'un orchestrateur multi-agents.

CONTRAT VÉRIFIÉ (backend `app/api/agents.py` + `core/authentication.py`) :

    POST /api/v1/agents/enroll
    Authorization: Bearer <clé d'enregistrement>
    corps (ASCII) : runtime, client_instance_id, requested_name, capabilities[], version,
                    declared_role (facultatif)

    201 : agent_id, name, role, status, access_token, token_type, created_at
    401 : clé d'enregistrement refusée
    409 : identité de connecteur déjà enregistrée (réutiliser le jeton, ou révocation)
    429 : quota d'enregistrement atteint (ENROLL_RATE_LIMIT, défaut 10/heure)
    503 : orchestrateur logiquement hors ligne

RÈGLE DE VALIDITÉ : la clé d'enregistrement n'ouvre QUE `/enroll`. Une route de lecture
(`GET /agents`, `GET /agents/me`) exige un jeton d'AGENT et répond 401 à une clé pourtant
valide — elle ne prouve donc rien. La seule preuve est le `POST /enroll`, suivi d'une relecture
de l'identité attribuée (jamais du seul code HTTP).

Les capacités sont DÉRIVÉES du profil (`agent/codidev.json`), jamais recopiées à la main. Aucun
secret n'est imprimé : le script n'affiche que des indicateurs de présence, jamais une valeur.

Usage :
  python scripts/inscrire_orchestrateur.py --dry-run
  python scripts/inscrire_orchestrateur.py --url https://api.cvlynk.com
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
PROFIL = RACINE / "agent" / "codidev.json"
SPECIALITE = "builder"                      # contrat d'orchestration : ne pas renommer
NOM_DEMANDE = "CodiDev"
INSTANCE_DEFAUT = "hermes-codidev-01"
ROLE_DECLARE = "builder"
VERSION = "3.0.0"
VARIABLES_CLE = ("ORCHESTRATOR_REGISTRATION_KEY", "ORCHESTRATOR_API_KEY")

# Capacité déclarée -> compétence(s) normative(s) qui la portent.
# Toute compétence de `skills.retenues` doit apparaître ici : le script refuse de deviner.
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

# Capacités de niveau spécialité : elles décrivent l'agent, pas une compétence isolée.
CAPACITES_SPECIALITE = ["full-stack engineering"]


def env_par_defaut() -> Path:
    base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    return Path(base) / "hermes" / "orchestrator-agent" / ".env"


def lire_env(chemin: Path) -> dict[str, str]:
    chemin = Path(chemin)
    if not chemin.exists():
        return {}
    valeurs = {}
    for ligne in chemin.read_text(encoding="utf-8").splitlines():
        ligne = ligne.strip()
        if not ligne or ligne.startswith("#") or "=" not in ligne:
            continue
        nom, _, valeur = ligne.partition("=")
        valeurs[nom.strip()] = valeur.strip()
    return valeurs


def ecrire_env(chemin: Path, valeurs: dict[str, str]) -> None:
    chemin = Path(chemin)
    existant = chemin.read_text(encoding="utf-8").splitlines() if chemin.exists() else []
    noms = set(valeurs)
    restant = [l for l in existant if (l.split("=", 1)[0].strip() if "=" in l else "") not in noms]
    restant.extend(f"{nom}={valeur}" for nom, valeur in valeurs.items())
    chemin.parent.mkdir(parents=True, exist_ok=True)
    chemin.write_text("\n".join(l for l in restant if l.strip()) + "\n", encoding="utf-8")


def capacites_derivees(profil: dict) -> list[str]:
    retenues = list((profil.get("skills") or {}).get("retenues") or [])
    if not retenues:
        raise SystemExit("Profil sans skills.retenues : impossible de dériver les capacités.")
    inconnues = [nom for nom in retenues if nom not in CAPACITES_PAR_COMPETENCE]
    if inconnues:
        raise SystemExit(
            "Compétences sans capacité associée (mettre à jour CAPACITES_PAR_COMPETENCE) : "
            + ", ".join(inconnues)
        )
    capacites = list(CAPACITES_SPECIALITE)
    for nom in retenues:
        capacites.extend(CAPACITES_PAR_COMPETENCE[nom])
    return sorted(dict.fromkeys(capacites))


def charge_inscription(profil: dict, instance: str, nom: str, role: str) -> dict:
    return {
        "runtime": "hermes",
        "client_instance_id": instance,
        "requested_name": nom,
        "declared_role": role,
        "capabilities": capacites_derivees(profil),
        "version": VERSION,
    }


def appel(url: str, charge: dict | None, cle: str | None) -> tuple[int, dict]:
    donnees = json.dumps(charge, ensure_ascii=True).encode("ascii") if charge is not None else None
    requete = urllib.request.Request(url, data=donnees, method="POST" if donnees else "GET")
    requete.add_header("Accept", "application/json")
    if donnees:
        requete.add_header("Content-Type", "application/json")
    if cle:
        requete.add_header("Authorization", "Bearer " + cle)
    try:
        with urllib.request.urlopen(requete, timeout=60) as reponse:
            corps = reponse.read().decode("utf-8", "replace")
            return reponse.status, (json.loads(corps) if corps.strip() else {})
    except urllib.error.HTTPError as e:
        corps = e.read().decode("utf-8", "replace")
        try:
            return e.code, (json.loads(corps) if corps.strip() else {})
        except json.JSONDecodeError:
            return e.code, {"_brut": corps[:300]}
    except urllib.error.URLError as e:
        return 0, {"_reseau": str(e.reason)}


def message_erreur(statut: int, corps: dict) -> str:
    """Message exploitable, sans jamais exposer un secret."""
    detail = str(((corps or {}).get("error") or {}).get("message", ""))[:240]
    if statut == 0:
        return "orchestrateur injoignable (réseau)"
    if statut == 401:
        return "erreur d'authentification : clé d'enregistrement refusée"
    if statut == 400:
        return "demande invalide : " + (detail or "vérifier les champs envoyés")
    if statut == 409:
        return "identité de connecteur déjà enregistrée : " + detail
    if statut == 429:
        return "quota d'enregistrement atteint côté serveur : réessayer plus tard"
    if statut == 503:
        return "orchestrateur logiquement hors ligne : enregistrement refusé (action admin)"
    return f"refus HTTP {statut} : {detail or json.dumps(corps, ensure_ascii=True)[:200]}"


def main(argv=None) -> int:
    analyseur = argparse.ArgumentParser(description="Inscrit CodiDev auprès d'un orchestrateur.")
    analyseur.add_argument("--url", default="https://api.cvlynk.com")
    analyseur.add_argument("--instance", default=INSTANCE_DEFAUT)
    analyseur.add_argument("--nom", default=NOM_DEMANDE)
    analyseur.add_argument("--role", default=ROLE_DECLARE)
    analyseur.add_argument("--env-file", default=str(env_par_defaut()))
    analyseur.add_argument("--dry-run", action="store_true")
    args = analyseur.parse_args(argv)
    base = args.url.rstrip("/")

    profil = json.loads(PROFIL.read_text(encoding="utf-8"))
    charge = charge_inscription(profil, args.instance, args.nom, args.role)
    fichier_env = Path(args.env_file)
    valeurs = lire_env(fichier_env)
    cle = next((os.environ[n] for n in VARIABLES_CLE if os.environ.get(n)), None) \
        or next((valeurs[n] for n in VARIABLES_CLE if valeurs.get(n)), None)

    print("CodiDev — inscription auprès de l'orchestrateur")
    print(f"  cible        : {base}/api/v1/agents/enroll")
    print(f"  spécialité   : {SPECIALITE} (contrat d'orchestration, non renommé)")
    print(f"  nom demandé  : {args.nom} (le serveur reste maître du nom final)")
    print(f"  rôle déclaré : {args.role} (validé par le serveur dans sa liste autorisée)")
    print(f"  capacités    : {len(charge['capabilities'])} (dérivées du profil)")
    print(f"  instance     : {args.instance}")
    print(f"  clé d'enreg. : {'présente (non affichée)' if cle else 'ABSENTE'}")
    print(f"  .env         : {fichier_env}")

    if args.dry_run:
        print("\n  mode --dry-run : rien n'a été envoyé. Charge utile :")
        print(json.dumps(charge, ensure_ascii=True, indent=2))
        return 0

    if not cle:
        print("\n  BLOCKED : aucune clé d'enregistrement (environnement ou .env hors dépôt).")
        return 3

    statut, corps = appel(f"{base}/api/v1/agents/enroll", charge, cle)
    print(f"\n  POST /api/v1/agents/enroll : HTTP {statut}")
    if statut != 201:
        print("  -> " + message_erreur(statut, corps))
        return 4

    jeton = corps.get("access_token")
    print(f"    agent_id      : {corps.get('agent_id')}")
    print(f"    nom attribué  : {corps.get('name')}")
    print(f"    rôle attribué : {corps.get('role')}")
    print(f"    statut        : {corps.get('status')} (PENDING -> ONLINE après heartbeat)")
    if not jeton:
        print("  FAILED : le serveur n'a pas retourné de jeton d'accès.")
        return 5
    ecrire_env(fichier_env, {"ORCHESTRATOR_REGISTRATION_KEY": cle,
                             "ORCHESTRATOR_API_KEY": cle,
                             "ORCHESTRATOR_AGENT_TOKEN": jeton})
    print(f"    jeton d'agent : stocké sous ORCHESTRATOR_AGENT_TOKEN ({fichier_env}), non affiché")

    statut, identite = appel(f"{base}/api/v1/agents/me", None, jeton)
    print(f"\n  relecture GET /api/v1/agents/me : HTTP {statut}")
    if statut != 200:
        print("  -> erreur d'authentification à la relecture (aucune valeur affichée).")
        return 6
    for champ in ("agent_id", "name", "role", "status", "instance_id", "registered_at"):
        print(f"    {champ:14}: {identite.get(champ)}")
    capacites_serveur = identite.get("capabilities") or []
    aligne = sorted(capacites_serveur) == charge["capabilities"]
    print(f"    capabilities  : {len(capacites_serveur)} | alignement profil : "
          f"{'OUI' if aligne else 'NON'}")
    print("\n  Inscription confirmée par relecture. Le maintien en ligne relève du heartbeat.")
    return 0 if aligne else 7


if __name__ == "__main__":
    sys.exit(main())
