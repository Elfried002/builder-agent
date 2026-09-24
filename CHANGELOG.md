# Changelog

Toutes les modifications notables de Builder Agent sont consignées ici.
Format : [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) · versionnage sémantique.

## [1.0.0] — 2026-09-24

### Ajouté
- **Définition exécutable de l'agent** : `agent/builder-agent.json` (profil) et
  `agent/builder-agent.prompt.md` (prompt système v1.0) — rôle, mission, périmètre, workflow
  en 7 phases, contraintes, permissions graduées, Human Gate, conditions d'arrêt, comportement
  d'échec, preuves, format de sortie, politique mémoire.
- **Bibliothèque normative** : 15 compétences (textes complets) — conventions, API, backend,
  frontend, données, tests, industrialisation, architecture.
- **Gouvernance** : permissions READ/WRITE/EXECUTE autorisées ; DELETE/DEPLOY/SEND sur
  autorisation explicite ; 7 déclencheurs de Human Gate ; 6 interdits ; mode autonome borné.
- **Identité déclarée** : spécialité `builder`, instance `hermes-builder-agent-01`,
  19 capacités réparties en 3 spécialités (Full-Stack Engineering, Software Architecture,
  DevSecOps) ; outillage LLM `deepseek-chat`, 5 outils, 24 tours.
- **Outillage d'exploitation** :
  - `scripts/verifier_depot.py` — cohérence du dépôt (profil, compétences, outils, prompt) et
    détection de secrets ;
  - `scripts/enregistrer_agent_os.py` — enregistrement sur une console Agent OS ;
  - `scripts/verifier_agent_os.py` — vérification par relecture + exécution de contrôle ;
  - `scripts/inscrire_orchestrateur.py` — inscription (métadonnées) sur un orchestrateur
    multi-agents, capacités dérivées du profil.
- **Documentation** : README, `docs/ARCHITECTURE.md`, `docs/CAPACITES.md`,
  `docs/GOUVERNANCE.md`, `docs/EXPLOITATION.md`, `skills/README.md`.

### Notes
- Un enregistrement réussi (HTTP 201) ne vaut pas agent opérationnel : la preuve est la
  relecture de la fiche puis une exécution réelle.
