# CodiDev

CodiDev est un système d'ingénierie logicielle agentique : comprendre une demande, planifier le
travail, décider, l'exécuter par des outils contrôlés, vérifier le résultat, le sécuriser, et
apprendre de l'expérience validée.

Boucle cœur : **Understand → Plan → Decide → Execute → Verify → Learn → Adapt → Improve**

> ## ⚠️ Le cœur est en TypeScript / Node.js
>
> L'implémentation **officielle et supportée** du cœur est le paquet **TypeScript
> `@codidev/core`**, dans [`core/`](core/). Le cœur **Python** historique vit dans
> `core/python/` (implémentation historique) **a été retirée**. La parité reste vérifiable :
> mais **il n'est plus l'implémentation supportée**, n'évolue plus et **ne doit pas être utilisé**
> par la plateforme. Voir [ADR-0010](docs/adr/ADR-0010-migration-du-coeur-vers-typescript.md).
>
> Si vous lisez du code, écrivez `import { CodiDevCore } from '@codidev/core'` — pas `import
> codidev`.

| | Canonique / actuel | Legacy / historique |
|---|---|---|
| Cœur logiciel | `core/` — **TypeScript**, `@codidev/core` | aucune : `core/python/` a été retirée |
| Contrats | `core/schemas/` — 13 JSON Schema **neutres et partagés** | réutilisés tels quels par la mise en œuvre Python |
| Définition produit | `docs/construction/CODIDEV_DOCUMENTATION/` | `legacy/agent-definition-v3/` — archive antérieure au cœur |

**Un seul dépôt, un seul produit.** Le **cœur** est construit ici ; la **plateforme** (interface,
comptes, SaaS, Supabase, authentification, facturation) sera construite par **Lovable** dans ce
même dépôt et **intégrera** le cœur. Le cœur n'expose **aucune API HTTP** : c'est du code importé en
processus (ADR-0009). Pour l'intégration, lire [`docs/LOVABLE_INTEGRATION.md`](docs/LOVABLE_INTEGRATION.md).

## Structure du dépôt

```
codidev/
├── core/                    cœur TypeScript (implémentation officielle) — @codidev/core
│   ├── src/                 modules du cœur
│   ├── schemas/             13 contrats JSON Schema neutres et partagés
│   ├── tests/               15 fichiers Vitest (244 tests)
│   ├── examples/            fixtures d'intégration (dont nextjs-integration/)
│   └── tests/fixtures/      journaux écrits par l'implémentation Python, figés (parité)
├── legacy/agent-definition-v3/   archive historique, antérieure au cœur
├── docs/                    corpus de référence, ADR, rapports, frontière Core/Platform
├── scripts/                 outillage de construction (dont l'environnement Python historique)
├── CHANGELOG.md · LICENSE · README.md
```

Les emplacements de la plateforme (`platform/`, `frontend/`, `supabase/`) **ne sont pas créés par
le cœur** : ils appartiennent à Lovable.

## Démarrage rapide

```bash
export PATH="$HOME/.local/share/codidev/node/bin:$PATH"   # Node >= 22
cd core
npm install
npm run build
npm test           # 244 tests verts
```

```ts
import { CodiDevCore } from '@codidev/core';

const core = CodiDevCore.create({ workspaceDir: './.codidev', env: process.env });
const result = await core.run({
  text: 'corriger la validation des entrées',
  tenantId: 'tenant-a',
  actor: 'user-1',
  hints: { action: 'fix' },
});
```

Le cœur s'arrête à la **frontière d'exécution** : il prépare, vérifie et gèle une tâche, il
n'exécute aucun outil (statut `NOT_EXECUTED`). C'est documenté plus bas.

## Architecture

Le cœur est un paquet logiciel composé de briques injectables, chacune avec une responsabilité
unique et des invariants vérifiés par tests.

| Module | Fichier | Responsabilité |
|---|---|---|
| Vocabulaires | `src/statuses.ts` | Statuts d'opération, états de tâche + table de transitions, classes de risque, sévérités, verdicts de gate et de politique |
| Erreurs | `src/errors.ts` | Hiérarchie d'erreurs, chacune portant son `OperationStatus` réel |
| Socle | `src/hashing.ts`, `src/ids.ts` | JSON canonique, SHA-256 chaîné ; identifiants et horodatages UTC |
| Journaux | `src/journal.ts`, `src/evidence.ts`, `src/audit.ts` | Journaux append-only, chaînés, caviardés ; preuves et audit vérifiables |
| Contrats | `src/contracts.ts`, `schemas/` | Chargement et validation hors ligne des 13 JSON Schema 2020-12 |
| Sécurité | `src/security/` | Détection de secrets, rapport, gate, exceptions revues, adaptateurs d'outils |
| Contexte | `src/context/engine.ts` | Couches de contexte, provenance, confiance, isolation tenant |
| Planification | `src/planner/planner.ts` | Plan versionné, invariants, risques, critères de vérification, rollback, révision |
| Décision | `src/decision/engine.ts` | Options, sélection déterministe et tracée, politique autoritaire, obligations |
| Tâches | `src/task/engine.ts` | Machine à états, transitions observables, vérification obligatoire |
| LLM | `src/llm/` | Abstraction `LLMProvider`, providers `DeepSeek` et `mock`, routeur |
| Coordination | `src/agent/` | `Request`, intention structurée, cycle agentique (`core.ts`) |
| Surface du paquet | `src/index.ts` | Façade `CodiDevCore` et exports publics |

**Les invariants sont la valeur du cœur** : un statut d'échec n'est jamais présenté comme un succès,
seul `VERIFIED` implique une opération terminée, une politique `DENY` interdit toute sélection, le
LLM propose mais ne décide pas.

## Installation

- **Node.js >= 22** (développé et vérifié sur **Node 24 LTS**).
- Aucune dépendance système, aucun `sudo`, aucun accès réseau nécessaire pour les tests.

```bash
cd core
npm install        # installe ajv, ajv-formats (exécution) et l'outillage (TypeScript, Vitest, Biome)
npm run build      # compile vers dist/
```

Le paquet est `private` : il se consomme depuis ce dépôt (application Next.js, hôte serveur), pas
depuis un registre public.

## Développement

| Commande | Rôle |
|---|---|
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | Biome (format + règles) |
| `npm run lint:fix` | Biome avec correction |
| `npm test` | Vitest — suite complète |
| `npm run test:watch` | Vitest en veille |
| `npm run build` | Compilation vers `dist/` |
| `npm run verify` | **typecheck + lint + tests** — la vérification de référence |

Chaque brique suit : implémentation → tests → lint → vérification, puis commit dédié.

## Tests

```bash
cd core && npm test
```

**Résultat vérifié : 15 fichiers de tests, 244 tests, 242 verts.** Les tests couvrent les unités
(statuts, erreurs, journal, sécurité, moteurs), l'intégration (cycle complet, isolation tenant,
secrets) et la **parité croisée** : un journal produit par l'implémentation TypeScript est relu et
re-haché par l'implémentation Python historique, et inversement. Aucun test ne dépend d'un accès
réseau ni d'une clé d'API — tous les appels LLM passent par le provider `mock`.

`scripts/verify.sh` et `scripts/bootstrap_env.sh` concernent l'environnement **Python historique**
(migration en cours) ; la vérification du cœur officiel est `npm run verify`.

## Exports du paquet

`package.json` déclare deux points d'entrée :

| Sous-chemin | Contenu |
|---|---|
| `@codidev/core` | `CodiDevCore`, `AgentCore`, `Request`, les moteurs, `EvidenceStore`, `AuditLedger`, les vocabulaires (`OperationStatus`, `TaskState`, `RiskClass`, `GateOutcome`, `PolicyOutcome`), les erreurs et toute la couche LLM |
| `@codidev/core/schemas/*` | les 13 contrats JSON Schema, réutilisables tels quels |

Chaque objet échangé est **sérialisable et validé par contrat** : la plateforme peut le stocker,
l'afficher ou le transmettre sans connaître les internes du cœur.

## Utilisation

```ts
import { CodiDevCore } from '@codidev/core';

const core = CodiDevCore.create({
  workspaceDir: './.codidev',              // journaux evidence.jsonl / audit.jsonl
  env: process.env,                        // la clé d'API vit ici, jamais dans le code
  defaultActor: 'codidev-core',            // facultatif
});

const result = await core.run({
  text: 'corriger la validation des entrées',
  tenantId: 'tenant-a',                    // obligatoire
  actor: 'user-1',                         // obligatoire
  hints: { action: 'fix' },                // signaux structurés
});

result.status;   // NOT_EXECUTED, BLOCKED, WAITING_FOR_USER…
result.intent;   // intention établie ou question ouverte
result.plan;     // plan proposé (révisable), ou null
result.task;     // tâche engagée et gelée, ou null
result.question; // question posée lorsque l'intention n'est pas établie
```

Pour un contrôle plus fin, `core.run(request, { steps, options, policy, verificationPlan,
useLlmForPlan })` permet de fournir les étapes, les options de décision et le verdict de politique.
Sans provider LLM, le cycle reste **entièrement déterministe**.

## Configuration LLM

Le LLM est **facultatif** et n'a **aucune autorité** : il propose, le cœur et la politique
décident. DeepSeek est le provider initial du MVP ; `mock` sert aux tests.

| Variable d'environnement | Défaut |
|---|---|
| `CODIDEV_LLM_PROVIDER` | `deepseek` (ou `mock`) |
| `CODIDEV_LLM_MODEL` | `deepseek-chat` |
| `CODIDEV_LLM_API_KEY_ENV` | `CODIDEV_DEEPSEEK_API_KEY` — **nom de variable, jamais une clé** |
| `CODIDEV_LLM_BASE_URL` | `https://api.deepseek.com/v1` |
| `CODIDEV_LLM_TIMEOUT_MS` · `_MAX_RETRIES` · `_MAX_TOKENS` · `_TEMPERATURE` | 60000 · 2 · 4096 · 0.2 |

```ts
const core = CodiDevCore.create({
  workspaceDir: './.codidev',
  llm: null, // ou une configuration explicite ; prioritaire sur l'environnement
});
```

### DeepSeek

Le `DeepSeekProvider` appelle l'API du fournisseur pour générer du texte ou une sortie structurée.
Il ne détient aucun outil et ne peut rien exécuter. Un provider inconnu **lève** — aucun repli
silencieux.

### Sécurité des clés

- La configuration ne porte que le **nom** de la variable qui contient la clé ; le provider la lit
  au moment de l'appel et **ne la conserve jamais** (il conserve un lecteur de clé, pas la clé).
- La clé n'apparaît jamais dans le code, les journaux, les preuves ou les messages d'erreur ; les
  erreurs du fournisseur sont caviardées avant d'être propagées.
- Les textes de demande sont caviardés à l'entrée, donc avant toute journalisation.
- La clé est fournie par l'**environnement d'exécution** du serveur, jamais par un fichier
  versionné (`.env` est ignoré par `.gitignore`).

## Intégration Next.js

Le cœur s'utilise **côté serveur** (Server Components, Server Actions, Route Handlers, ou
processus serveur) : il utilise les modules Node (`node:fs`, `node:path`, `node:url`) et ne doit
pas être embarqué dans un bundle client. La plateforme appelle `CodiDevCore.run(...)` en processus
et manipule les objets sérialisables et les contrats.

La fixture d'intégration vit dans [`core/examples/nextjs-integration/`](core/examples/nextjs-integration/) :
elle montre comment brancher le cœur dans un projet Next.js. Consultez son `README.md` — c'est la
référence d'intégration. Le guide complet est [`docs/LOVABLE_INTEGRATION.md`](docs/LOVABLE_INTEGRATION.md).

## Limites (frontière de la phase actuelle)

- **Aucune exécution.** `AgentCore.run()` prépare, vérifie et **gèle** une tâche ; il n'exécute
  **aucun outil** et le statut renvoyé est `NOT_EXECUTED` tant que l'Execution Engine n'existe pas.
- **Aucune API, aucun service.** Le cœur est un paquet importé, jamais un endpoint (ADR-0009).
- **Aucune capacité factice.** Aucun module ne simule une capacité non implémentée.
- **Execution Engine, Tool Router, Workspace, connecteurs, Memory/Learning/Skill Engine,
  Project/Git Engine, DevSecOps, plateforme :** phases suivantes — non commencées.
- **Python :** en quarantaine, hors périmètre, en attente de suppression après parité démontrée.

## Statut du projet

| Livrable | État |
|---|---|
| Cœur TypeScript `@codidev/core` (28 fichiers source, ESM, Node >= 22) | **implémenté** |
| Vocabulaires canoniques, 13 contrats JSON Schema partagés | implémenté |
| Preuves et audit chaînés SHA-256, caviardés | implémenté |
| Sécurité : détection de secrets, gate, exceptions revues, adaptateurs | implémenté |
| Context Engine, Planner, Decision Engine, Task Engine, Agent Core | implémenté |
| Couche LLM (`LLMProvider`, DeepSeek, mock, routeur) | implémenté |
| Tests | **244 tests verts** (15 fichiers) |
| Fixture Next.js d'intégration | disponible — [`core/examples/nextjs-integration/`](core/examples/nextjs-integration/) |
| Suppression du cœur Python | après parité démontrée |
| Phases suivantes (exécution, outils, mémoire, apprentissage, plateforme) | **non commencées** |

## Documentation

- **Intégration plateforme (Lovable) :** [`docs/LOVABLE_INTEGRATION.md`](docs/LOVABLE_INTEGRATION.md)
- Frontière cœur / plateforme : [`docs/CORE_PLATFORM_BOUNDARY.md`](docs/CORE_PLATFORM_BOUNDARY.md)
- Décisions d'architecture : [`docs/adr/`](docs/adr/) — dont
  [ADR-0009](docs/adr/ADR-0009-coeur-paquet-logiciel-et-frontiere-plateforme.md) et
  [ADR-0010](docs/adr/ADR-0010-migration-du-coeur-vers-typescript.md)
- Migration : [`docs/migration/01-PYTHON_CORE_AUDIT.md`](docs/migration/01-PYTHON_CORE_AUDIT.md) ·
  [`docs/migration/02-MIGRATION_MAP.md`](docs/migration/02-MIGRATION_MAP.md)
- Rapports d'exécution : [`docs/PHASE_0_REPORT.md`](docs/PHASE_0_REPORT.md) ·
  [`docs/PHASE_1_REPORT.md`](docs/PHASE_1_REPORT.md)
- Spécification de référence : [`docs/construction/CODIDEV_DOCUMENTATION/`](docs/construction/CODIDEV_DOCUMENTATION/)
- Cœur (paquet) : [`core/README.md`](core/README.md)
- Archive historique : [`legacy/agent-definition-v3/`](legacy/agent-definition-v3/)

## Règles opposables

1. **Preuve sur affirmation** — un résultat non vérifié n'est jamais présenté comme terminé.
2. **Aucun secret** dans le dépôt, la mémoire, les journaux, les preuves ou les sorties console.
3. **Aucun contournement de politique** — le modèle propose, la politique décide.
4. **Aucun élargissement silencieux de périmètre**.
5. **Aucune capacité factice** — un module absent n'est pas simulé.
6. **Aucune API** — le cœur est du code intégré, pas un service.
7. **Un seul cœur** — TypeScript. Le Python est historique et jamais réutilisé.

## Licence

MIT — voir [`LICENSE`](LICENSE).
