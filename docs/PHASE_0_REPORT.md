# CodiDev — Rapport de Phase 0 (Foundation)

> ⚠️ **RAPPORT HISTORIQUE.** Ce document décrit une étape passée de la construction du
> cœur, à l'époque où l'implémentation de référence était en Python. Il ne décrit **pas**
> l'état actuel : le CodiDev Core est aujourd'hui **TypeScript/Node.js** dans `core/`
> (voir [ADR-0010](../adr/ADR-0010-migration-du-coeur-vers-typescript.md)).

**Date :** 2026-10-02 (UTC)
**Branche :** `phase/00-foundation`
**Périmètre :** socle exécutable et vérifiable du cœur CodiDev
**Statut :** livré, vérifié par exécution réelle — **aucun push effectué**

Ce rapport ne contient que des résultats **réellement obtenus** sur le serveur de construction.
Chaque affirmation est accompagnée de la commande qui la produit.

---

## 1. Environnement isolé

| Élément | Valeur constatée | Commande |
|---|---|---|
| Gestionnaire de toolchain | `uv 0.12.22` (espace utilisateur, `~/.local/bin/uv`) | `uv --version` |
| Interpréteur | `Python 3.12.15` géré par uv | `venv/bin/python --version` |
| Base de l'interpréteur | `/home/babayaga/.local/share/uv/python/cpython-3.12.15-linux-x86_64-gnu` | `sys.base_prefix` |
| Environnement virtuel | `~/.local/share/codidev/venv` (hors dépôt) | `scripts/bootstrap_env.sh` |
| Aucun privilège système | aucune commande `sudo`, aucun mot de passe demandé | — |

Dépendances **épinglées** (`pyproject.toml`) et **verrouillées** (`uv.lock`, versionné) :

```
jsonschema v4.26.0
rfc3339-validator v0.1.4
bandit v1.9.1 (dev)
pip-audit v2.9.0 (dev)
pytest v9.0.3 (dev)
pytest-cov v7.1.0 (dev)
ruff v0.15.4 (dev)
```

## 2. Restructuration du dépôt (ADR-0001)

La définition historique a été déplacée sous `legacy/agent-definition-v3/`. Sa préservation est
**prouvée par exécution depuis son nouvel emplacement**, et non déclarée :

```
$ cd legacy/agent-definition-v3 && python3 -m unittest discover -s tests
Ran 15 tests in 0.016s

OK

$ cd legacy/agent-definition-v3 && python3 scripts/verifier_depot.py
Resultat : 15/15 controles verts, 0 echec(s), 0 avertissement(s)
```

Aucun fichier n'a été supprimé ni modifié : les 47 fichiers suivis du dépôt d'origine existent
toujours, à l'emplacement `legacy/agent-definition-v3/`.

## 3. Livrables du cœur

```
src/codidev/
├── statuses.py            vocabulaires canoniques + table des transitions de tâche
├── errors.py              hiérarchie d'erreurs portant un statut réel
├── hashing.py             JSON canonique + chaînage SHA-256
├── ids.py                 identifiants et horodatages UTC
├── journal.py             journal JSONL append-only, chaîné, caviardé, vérifiable
├── cli.py                 interface en ligne de commande
├── contracts/             9 contrats JSON Schema + validateur hors ligne
├── evidence/              magasin de preuves
├── audit/                 journal d'audit séquencé
└── security/              secrets, rapport, gate, outils externes, exceptions revues
```

- 2 344 lignes de Python dans `src/`.
- 9 contrats : `action`, `approval`, `audit_record`, `evidence`, `policy_decision`, `risk_class`,
  `security_allowlist`, `task`, `tool_request`.
- 127 tests.

Points d'invariant encodés et testés :

- `OperationStatus.implies_completion` n'est vraie que pour `VERIFIED` : une action exécutée n'est
  jamais présentée comme réussie.
- Une preuve ne peut pas déclarer `passed: true` avec `performed: false` (contrainte de schéma).
- Une transition de tâche absente de la table est refusée.
- Un outil de sécurité absent est `NOT_EXECUTED`, jamais « vert ».

## 4. Vérification complète (exécution réelle)

```
$ scripts/verify.sh
== lint (ruff check)              All checks passed!
== format (ruff format --check)   30 files already formatted
== SAST (bandit) + SCA (pip-audit) + secrets + lint agrégés par le gate
== contrats (auto-contrôle des schémas)   9 contrats disponibles
== tests (pytest)                 127 passed in 1.22s
VERT — aucun blocage, aucune revue requise
```

### Verdict du Security Gate

| Champ | Valeur |
|---|---|
| Verdict | `PASS` (code de sortie 0) |
| Politique | `security-gate@v1` |
| Constatations | `CRITICAL 0 · HIGH 0 · MEDIUM 0 · LOW 237 · INFO 3` |
| Supprimées par exception revue | 7 (présentes dans le rapport, jamais masquées) |
| Outils exécutés | `ruff` EXECUTED · `bandit` EXECUTED · `pip-audit` EXECUTED · aucun `NOT_EXECUTED` |

Les 240 constatations restantes sont de niveau `LOW`/`INFO` : `assert` dans les tests, usage
encadré de `subprocess`, longueur de ligne. Elles sont rapportées, non bloquantes par politique.

### Vulnérabilité réelle détectée et corrigée pendant la phase

Le premier passage du gate a **bloqué** sur `pip-audit:PYSEC-2026-1845` — `pytest==9.0.1`, corrigé
en `9.0.3`. Le gate n'est donc pas décoratif : il a trouvé un défaut réel dans notre propre
chaîne de dépendances avant toute publication.

## 5. Défauts de conception trouvés et corrigés pendant la phase

Ces points sont consignés parce qu'ils ont été trouvés par l'exécution, pas par relecture :

1. **Heuristique d'affectation de secret trop large** — elle signalait du code légitime
   (`token = req.headers.authorization`). Corrigé : le motif ne franchit plus un séparateur de
   chemin, et un filtre distingue un littéral d'une expression.
2. **Marqueur de caviardage re-détecté comme secret** — un rapport contenant `[REDACTED:…]` se
   re-signalait à chaque relecture. Corrigé : un texte déjà caviardé n'est plus jamais un secret
   (propriété testée : le caviardage est idempotent).
3. **Faux positifs documentaires** — les exemples d'identifiants de démonstration bloquaient le
   gate. Réponse : ADR-0007, exceptions revues et traçables, plutôt qu'affaiblissement des règles.
4. **Rapports re-scannés comme du code** — les rapports sont désormais écrits hors du dépôt, et le
   contrôle porte sur les fichiers **versionnés**.

## 6. Ce que la Phase 0 ne contient pas

Il n'existe aucun module, même vide, pour les sous-systèmes des phases suivantes : Agent Core
(Context/Planner/Decision/Task), Execution Engine, Tool Router, Project/Git Engine, connecteurs
GitHub/Supabase/Vercel, Memory/Learning/Skill Engine, couche de données, plateforme. Aucune
capacité n'est simulée ni annoncée.

## 7. Comment reproduire

```bash
scripts/bootstrap_env.sh     # recrée l'environnement isolé depuis uv.lock
scripts/verify.sh            # rejoue l'intégralité des contrôles ; doit finir sur VERT
```

## 8. Références

- Décisions : `docs/adr/ADR-0001` à `ADR-0008`
- Spécification opposable : `docs/construction/CODIDEV_DOCUMENTATION/`
- Évaluation initiale et plan : `docs/construction/CONSTRUCTION_ASSESSMENT.md`, `BUILD_PLAN.md`
