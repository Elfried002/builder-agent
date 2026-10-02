# CodiDev Core

Cœur logiciel de CodiDev : l'intelligence d'ingénierie logicielle du produit. Ce paquet est
**autonome** et destiné à être intégré tel quel dans le projet final — il n'est pas un service,
et il n'expose **aucune API réseau**.

## Ce que ce paquet est, et ce qu'il n'est pas

| C'est | Ce n'est pas |
|---|---|
| Le cerveau de CodiDev : contexte, planification, décision, tâches, exécution, outils, sécurité, mémoire, apprentissage, skills, preuves | Une API HTTP, un microservice, un backend à interroger |
| Un paquet Python importable (`import codidev`) et installable (`pip install -e core/`) | Un serveur, un démon, une file de tâches distante |
| Une bibliothèque d'interfaces logicielles : modules, fonctions, contrats JSON Schema | Une couche d'adaptation destinée à masquer le cœur |

Le cœur est conçu pour être **appelé depuis du code** : la plateforme (interface, SaaS, données)
l'importe et l'utilise en processus, comme n'importe quelle bibliothèque du projet.

## Frontière avec la plateforme

**Périmètre de construction : ce paquet, et rien d'autre.** Hermes construit le cœur logiciel.
Tout le reste — interface, navigation, comptes, SaaS, Supabase, authentification, paramètres,
données utilisateur — appartient à la plateforme et sera construit **par Lovable**, dans le même
dépôt. Hermes ne crée pas ces emplacements, ne les ébauche pas et n'écrit pas leur code.

| Responsabilité | Propriétaire | Emplacement |
|---|---|---|
| Raisonnement agentique, planification, décision, exécution, outils, sécurité, mémoire, apprentissage, skills, preuves, audit | **Cœur** | `core/` |
| Interface, comptes, SaaS, Supabase, authentification, paramètres | **Lovable** | non créé par le cœur |

Ce qui est **documenté** ici n'est pas ce qui est **créé** : le cœur décrit la frontière pour que
l'intégration soit possible, il ne l'occupe pas. Les limites, y compris les points restant à
trancher, sont dans [`../docs/CORE_PLATFORM_BOUNDARY.md`](../docs/CORE_PLATFORM_BOUNDARY.md).

## Ce que la plateforme peut appeler

Le cœur expose des **objets et des fonctions**, pas des routes :

```python
from codidev.agent import AgentCore, Request
from codidev.evidence import EvidenceStore
from codidev.audit import AuditLedger

core = AgentCore(evidence=EvidenceStore(...), audit=AuditLedger(...))
analysis = core.analyze(req)          # comprendre une demande → contexte, intention, hypothèses
plan = core.plan(analysis)            # planifier → étapes, risques, critères de vérification
decision = core.decide(plan, options) # décider → option retenue, politique, obligations
task = core.open_task(decision)       # ouvrir une tâche exécutable
```

Chaque objet renvoyé est **sérialisable et validé par contrat** : la plateforme peut le stocker,
l'afficher ou le transmettre sans connaître les internes du cœur, et sans que le cœur connaisse
la plateforme.

## Installation et développement

```bash
../scripts/bootstrap_env.sh     # environnement isolé (CPython 3.12 via uv), hors du dépôt
../scripts/verify.sh            # lint, format, secrets, SAST, SCA, tests, gate
```

Environnement créé dans `~/.local/share/codidev/venv`. Aucune dépendance système, aucun `sudo`.

## Dépendances

Deux dépendances d'exécution, épinglées et verrouillées dans `uv.lock` :

- `jsonschema` — validation des contrats du cœur ;
- `rfc3339-validator` — vérification réelle du format `date-time` (sans quoi `format:` dans un
  schéma JSON n'est vérifié par rien).

## Structure du paquet

```
core/src/codidev/
├── agent/        Agent Core : coordination du cycle de travail
├── context/      Context Engine : couches, provenance, confiance, isolation tenant
├── planner/      Planner : plan, étapes, risques, critères de vérification, rollback
├── decision/     Decision Engine : options, choix tracé, politique, permissions
├── task/         Task Engine : machine à états, transitions observables, historique
├── contracts/    13 contrats JSON Schema + validateur hors ligne
├── evidence/     preuves append-only, chaînées, caviardées
├── audit/        journal d'audit séquencé et chaîné
└── security/     détection de secrets, gate, adaptateurs d'outils, exceptions revues
```

## Licence

MIT — voir [`LICENSE`](LICENSE).
