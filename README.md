# CodiDev

CodiDev est un système d'ingénierie logicielle agentique : comprendre une demande, planifier le
travail, l'exécuter par des outils contrôlés, vérifier le résultat, le sécuriser, déployer les
projets autorisés et apprendre de l'expérience validée.

Boucle cœur : **Understand → Plan → Execute → Verify → Learn → Adapt → Improve**

**Un seul dépôt, un seul produit.** Le **cœur** est construit ici ; la **plateforme** (interface,
comptes, SaaS, Supabase, authentification) sera construite par Lovable dans ce même dépôt et
intégrera le cœur — voir [`docs/CORE_PLATFORM_BOUNDARY.md`](docs/CORE_PLATFORM_BOUNDARY.md).
Le cœur n'expose **aucune API** : c'est du code, importé par le projet.

## Structure du dépôt

```
codidev/
├── core/        cœur logiciel (construit ici) — paquet Python autonome, installable
├── legacy/      définition historique v3.x, préservée intégralement, hors service
├── docs/        corpus de référence, ADR, rapports, frontière Core/Platform
├── scripts/     bootstrap de l'environnement isolé, vérification complète
├── CHANGELOG.md · LICENSE · README.md
```

Les emplacements de la plateforme (`platform/`, `frontend/`, `supabase/`) **ne sont pas créés par
le cœur** : ils appartiennent à Lovable.

## Documentation

- Spécification de référence (opposable) : [`docs/construction/CODIDEV_DOCUMENTATION/`](docs/construction/CODIDEV_DOCUMENTATION/)
- Frontière cœur / plateforme : [`docs/CORE_PLATFORM_BOUNDARY.md`](docs/CORE_PLATFORM_BOUNDARY.md)
- État réel du dépôt avant construction : [`docs/construction/CONSTRUCTION_ASSESSMENT.md`](docs/construction/CONSTRUCTION_ASSESSMENT.md)
- Plan de construction : [`docs/construction/BUILD_PLAN.md`](docs/construction/BUILD_PLAN.md)
- Rapports et preuves d'exécution : [`docs/PHASE_0_REPORT.md`](docs/PHASE_0_REPORT.md) · [`docs/PHASE_1_REPORT.md`](docs/PHASE_1_REPORT.md)
- Décisions d'architecture : [`docs/adr/`](docs/adr/)
- Cœur : [`core/README.md`](core/README.md)
- Définition historique : [`legacy/agent-definition-v3/`](legacy/agent-definition-v3/)

## État : Phase 1 — Agent Core

| Livrable | État |
|---|---|
| Vocabulaires canoniques (statuts, états de tâche, classes de risque, sévérités) | implémenté |
| 13 contrats JSON Schema, validateur hors ligne | implémenté |
| Magasin de preuves et journal d'audit append-only, chaînés SHA-256, caviardés | implémenté |
| Détection de secrets (16 règles), gate (CRITICAL/HIGH → BLOCK), exceptions revues | implémenté |
| **Context Engine** — 9 couches, provenance, confiance, isolation tenant | implémenté |
| **Planner** — étapes ordonnées, risques, critères de vérification, rollback, révision versionnée | implémenté |
| **Decision Engine** — options, sélection tracée, politique autoritaire, obligations | implémenté |
| **Task Engine** — machine à états, transitions observables, vérification obligatoire | implémenté |
| **Agent Core** — coordination contexte → intention → plan → décision → tâche | implémenté |
| Interface en ligne de commande | implémenté |
| Tests | 204 tests réels |
| Execution Engine, Tool Router, Workspace, Connectors, Memory/Learning, Skills, Project/Git, plateforme | **Phases suivantes — non commencées** |

**Frontière actuelle, explicite :** le cœur s'arrête net à l'exécution. `AgentCore.run()` prépare,
vérifie et gèle une tâche ; il n'exécute **aucun outil** et le statut renvoyé est `NOT_EXECUTED`
tant que l'Execution Engine n'existe pas. Aucun module ne simule une capacité non implémentée.

## Prérequis

- Python **3.12** (version isolée gérée par `uv`, hors de tout environnement tiers)
- `uv` pour créer l'environnement et reproduire les dépendances depuis `core/uv.lock`

Aucune dépendance système. Aucun `sudo`. Aucun accès réseau nécessaire pour valider les contrats,
écrire des preuves ou vérifier un journal.

## Installation de l'environnement

```bash
scripts/bootstrap_env.sh        # crée/rafraîchit l'environnement isolé, hors du dépôt
```

L'environnement est créé dans `~/.local/share/codidev/venv` et n'est jamais versionné.

## Utilisation

```bash
# Contrats
codidev contracts list
codidev contracts show evidence
codidev contracts validate plan mon-plan.json

# Sécurité : scan complet + verdict du gate (0 = PASS, 1 = REVIEW, 2 = BLOCK)
codidev security scan .
codidev security scan core/src --policy strict --json "$HOME/.local/share/codidev/artifacts/rapport.json"
codidev security secrets .

# Journaux : intégrité de la chaîne de hachage
codidev journal verify preuves.jsonl --contract evidence
codidev journal verify audit.jsonl --contract audit_record
```

Le cœur s'utilise aussi directement depuis du code :

```python
from codidev.agent import AgentCore, Request

core = AgentCore()
run = core.run(
    Request(text="ajouter le module manquant", tenant_id="tenant-a", actor="user-1",
            hints={"intent_category": "MODIFY_SOFTWARE"}),
    steps=[...], options=[...], policy=verdict, verification_plan=[...],
)
```

## Vérifier le dépôt

```bash
scripts/verify.sh          # lint, format, secrets, SAST, SCA, tests, gate de sécurité
```

Le script échoue si un contrôle échoue. Un outil de sécurité absent est signalé comme
`NOT_EXECUTED` et n'est jamais compté comme un contrôle réussi.

## Exceptions de sécurité

Un scan peut légitimement rencontrer du bruit : documentations contenant des identifiants de
démonstration, exemples de configuration. La réponse n'est pas de désactiver une règle, mais de
déclarer une exception **revue, datée et justifiée** dans `.codidev-security-allowlist.json`
(ADR-0007). Une exception retire la constatation du verdict, jamais du rapport.

## Règles opposables

1. **Preuve sur affirmation** — un résultat non vérifié n'est jamais présenté comme terminé.
2. **Aucun secret** dans le dépôt, la mémoire, les journaux, les preuves ou les sorties console.
3. **Aucun contournement de politique** — le modèle propose, la politique décide.
4. **Aucun élargissement silencieux de périmètre**.
5. **Aucune capacité factice** — un module absent n'est pas simulé.
6. **Aucune API** — le cœur est du code intégré, pas un service à interroger.

## Licence

MIT — voir [`LICENSE`](LICENSE).
