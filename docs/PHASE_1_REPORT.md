# CodiDev — Rapport de Phase 1 (Agent Core)

**Date :** 2026-10-02 (UTC) · **Branche :** `phase/00-foundation` (suite du travail) ·
**Périmètre :** le cerveau de CodiDev, et lui seul
**Statut :** livré et vérifié par exécution réelle — **aucun push effectué**

Ce rapport ne contient que des résultats réellement obtenus. Chaque affirmation de la section 5
est reproductible par `scripts/verify.sh`.

---

## 1. Correction d'architecture appliquée

L'instruction initiale évoquait une « couche API consommable par la plateforme ». Cette
interprétation est **abandonnée** : le cœur n'est pas un backend.

**Vérification faite avant de continuer** — recherche de toute couche HTTP ou serveur dans le
cœur :

```
imports http / socket / wsgiref / socketserver  → AUCUN
frameworks web déclarés (fastapi, flask, …)     → AUCUN
dépendances déclarées                           → jsonschema, rfc3339-validator (2)
console scripts exposés                         → codidev (CLI locale)
```

Rien de tel n'avait été construit, et rien de tel ne sera construit. Décision consignée :
**ADR-0009 — le cœur est un paquet logiciel, pas un service**.

## 2. Structure du dépôt

```
codidev/
├── core/          ← cœur, paquet Python autonome (construit ici)
│   ├── pyproject.toml · uv.lock · LICENSE · README.md
│   ├── src/codidev/{agent,context,planner,decision,task,contracts,evidence,audit,security}
│   └── tests/
├── legacy/agent-definition-v3/    définition historique préservée (15/15 tests toujours verts)
├── docs/{adr,construction,PHASE_*_REPORT.md,CORE_PLATFORM_BOUNDARY.md}
└── scripts/{bootstrap_env.sh,verify.sh}
```

Aucun emplacement de plateforme (`platform/`, `frontend/`, `supabase/`) n'a été créé : vérifié,
ces dossiers n'existent pas. Un test échoue si le code du cœur **référence** un tel emplacement.

## 3. Ce qui a été construit

| Composant | Fichier | Ce qu'il garantit |
|---|---|---|
| Context Engine | `core/src/codidev/context/engine.py` | 9 couches, provenance obligatoire, 4 niveaux de confiance, rendu déterministe exposant source et confiance, **isolation tenant refusée à l'insertion** |
| Planner | `core/src/codidev/planner/planner.py` | plan versionné, ordre contigu, dépendances antérieures, critère de vérification par étape, rollback obligatoire pour destructif/déploiement, permissions dérivées ; révision sans réécriture |
| Decision Engine | `core/src/codidev/decision/engine.py` | options tracées, sélection déterministe, motif de rejet pour chaque option écartée, politique autoritaire (`DENY` ⇒ aucune sélection), obligation `approval:human-gate` |
| Task Engine | `core/src/codidev/task/engine.py` | table canonique des transitions, historique observable, refus des transitions illégales, **vérification réelle exigée** avant `VERIFIED`, `COMPLETED` impossible sans `VERIFIED` |
| Agent Core | `core/src/codidev/agent/{core,intent,request}.py` | cycle `analyze → plan → decide → tâche`, `Request` caviardée, intention **structurée** (aucune devinette du langage naturel), journalisation complète |

Volume : **4 250 lignes** de code du cœur, **2 457 lignes** de tests.
Contrats : **13** JSON Schema (`intent`, `context_bundle`, `plan`, `decision` ajoutés).

## 4. Frontière de la phase — ce que le cœur ne fait pas

`AgentCore.run()` prépare, vérifie et **gèle** une tâche. Il n'exécute aucun outil.

| Situation | Statut renvoyé | État de la tâche |
|---|---|---|
| Politique refuse | `BLOCKED` | `BLOCKED` |
| Approbation humaine requise | `WAITING_FOR_USER` | `WAITING_FOR_USER` |
| Intention non établie | `WAITING_FOR_USER` | aucune tâche créée |
| Plan prêt, à exécuter | `NOT_EXECUTED` | `PROPOSED` |

Le troisième cas mérite d'être souligné : sans signal explicite, le cœur **refuse de planifier**
et pose une question ouverte. Il ne devine pas la nature d'une demande en langage naturel, et ne
prétend pas le faire — un test le verrouille, et un autre vérifie qu'aucune preuve ne porte le
statut `VERIFIED`.

## 5. Vérification réelle

```
$ scripts/verify.sh
== lint (ruff check)                All checks passed!
== format (ruff format --check)     47 files already formatted
== SAST + SCA + secrets + lint      gate : PASS
== contrats                         13 contrats disponibles
== tests (pytest)                   204 passed in 2.73s
VERT — aucun blocage, aucune revue requise

$ cd legacy/agent-definition-v3 && python3 -m unittest discover -s tests
Ran 15 tests — OK
$ cd legacy/agent-definition-v3 && python3 scripts/verifier_depot.py
15/15 controles verts, 0 echec(s)
```

Outils de sécurité réellement exécutés : `ruff`, `bandit`, `pip-audit` — aucun `NOT_EXECUTED`.

## 6. Défauts trouvés et corrigés pendant la phase

Consignés parce qu'ils ont été trouvés par l'exécution, pas par relecture :

1. **Audit sans tenant.** Les entrées `agent.plan` et `agent.decide` étaient journalisées sans
   `tenant_id`, alors que le plan et la décision le connaissent. Un test a échoué sur
   l'invariant « toute entrée d'audit porte son tenant ». Corrigé : `_record()` prend l'identité
   explicitement, et les appelants fournissent le tenant réel.
2. **Création de tâche non journalisée.** La création écrivait un événement d'historique mais
   aucune preuve ni entrée d'audit — l'observabilité était partielle dès le premier instant de la
   tâche. Corrigé : toute transition, y compris la création, alimente les deux journaux.
3. **Garde `COMPLETED` trop stricte et mal placée.** Le contrôle exigeait l'état immédiatement
   précédent `VERIFIED`, alors que le chemin est `VERIFIED → READY → COMPLETED`. Corrigé : le
   contrôle porte sur l'**histoire** de la tâche, ce qui est le vrai invariant.
4. **Deux types d'erreur pour un plan invalide.** Une violation de schéma levait `ContractError`
   et une violation d'invariant `PlanInvalidError`, selon l'ordre des contrôles. Corrigé : pour
   l'appelant, un plan est valide ou il ne l'est pas.
5. **Interfaces inutilisables par un tiers.** `ContextProvider` et `IntentAnalyzer` déclaraient
   des attributs modifiables, ce qui rendait un dataclass gelé non conforme au protocole ;
   plusieurs signatures exigeaient `list[str]` là où un `Sequence[str]` suffit. Corrigé : ce sont
   exactement les frictions qu'un intégrateur rencontrerait.
6. **Contrôle de couplage trop grossier.** Le premier test « aucune référence à la plateforme »
   signalait une règle de détection de secret nommée `supabase`. Corrigé : le contrôle porte sur
   les imports et les chemins, pas sur les mentions.

## 7. Frontière Core ↔ Platform

Documentée dans [`CORE_PLATFORM_BOUNDARY.md`](CORE_PLATFORM_BOUNDARY.md) : ce que le cœur
possède, ce que la plateforme possède, les trois surfaces de contact (objets Python, contrats,
journaux), et **quatre décisions d'intégration restant à trancher** — traversée de frontière de
langage, persistance des journaux, frontière de l'authentification, propriété de l'approbation.

Ces décisions engagent l'architecture au-delà du cœur : elles sont soumises au propriétaire, pas
tranchées ici.

## 8. Comment reproduire

```bash
scripts/bootstrap_env.sh     # environnement isolé depuis core/uv.lock
scripts/verify.sh            # tous les contrôles ; doit finir sur VERT
```

## 9. Références

- Décisions : `docs/adr/ADR-0001` à `ADR-0009`
- Frontière : `docs/CORE_PLATFORM_BOUNDARY.md`
- Cœur : `core/README.md` · Spécification : `docs/construction/CODIDEV_DOCUMENTATION/`
