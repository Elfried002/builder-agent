# Changelog

Toutes les modifications notables de Builder Agent sont consignées ici.
Format : [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) · versionnage sémantique.

## [3.0.0] — 2026-10-02

### Modifié
- **Renommage de l'agent : Builder Agent → CodiDev** (annexe A de la spécification v3.0.0).
  Fichiers renommés : `agent/builder-agent.json` → `agent/codidev.json`,
  `agent/builder-agent.prompt.md` → `agent/codidev.prompt.md`. 51 remplacements dans les
  fichiers actifs ; la spécialité de routage `builder` est **conservée** (contrat
  d'orchestration). Les anciennes identités ne subsistent que dans l'historique de ce fichier.
- **Contrat d'orchestrateur corrigé** : `scripts/inscrire_orchestrateur.py` passe de
  `POST /api/v1/agents/register` (route jamais exposée par le serveur) au contrat **vérifié**
  `POST /api/v1/agents/enroll` avec `Authorization: Bearer <clé d'enregistrement>`,
  `requested_name` obligatoire et traitement explicite de `401 / 409 / 429 / 503`.

### Ajouté
- `SOUL.md` (nature, vertus, interdits de langage) · `AGENT_SPEC.md` (spécification complète) ·
  `SKILL.md` (dix règles opérationnelles) · `tests/test_definition.py` (suite réelle) ·
  `memory/` (`README.md` + `MEMORY.md`, append-only) · `workspace/` · `evidence.json` (journal
  de preuves) · `codidev_real_execution_test.txt` (test d'exécution réelle, §22).

### Vérifié (preuves réelles)
- `python -m unittest discover -s tests -v` → **11 tests, OK** ;
- `python scripts/verifier_depot.py` → **15/15 contrôles verts**, 0 secret sur 39 fichiers ;
- inscription réelle : `POST /api/v1/agents/enroll` → **201**, identité `agt_ff4e15a6d9524dfc`,
  nom attribué **CodiDev**, rôle `builder`, 19 capacités alignées sur le profil ;
- présence : **5/5 échantillons ONLINE** (`GET /api/v1/agents/me`, `last_seen_at` progressant).

## [1.0.1] — 2026-09-30

### Ajouté
- **`DESCRIPTION.md`** — description complète et opposable de l'agent : identité, mission,
  3 spécialités et 19 capacités, 15 compétences normatives, workflow en 7 phases, gouvernance,
  format de sortie, composition de la définition, exploitation, frontière de sécurité, état
  vérifié sur l'orchestrateur, points ouverts.

### Corrigé
- **README** — total de capacités ramené de 20 à **19** (aligné sur `docs/CAPACITES.md` et sur
  le registre de l'orchestrateur) ; `agent_id` plateforme mis à jour vers l'identité attribuée
  au réenregistrement du 2026-09-30.

### Notes
- L'identité `agt_5a0af0d2ce044545` (2026-09-24) est **caduque** : son jeton a été refusé le
  2026-09-30 et le serveur n'en conservait plus la trace. Un jeton d'agent ne se récupère pas,
  il se renouvelle par un réenregistrement (`POST /api/v1/agents/enroll`).
- Rappel de contrat : la clé d'enregistrement n'ouvre **que** `/enroll` ; la valider par une
  route de lecture (`GET /agents`, `GET /agents/me`) produit un faux `401`.

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
