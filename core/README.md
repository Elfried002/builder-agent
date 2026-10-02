# @codidev/core — CodiDev Core

Cœur logiciel de CodiDev, écrit en **TypeScript / Node.js**. Ce paquet est le cerveau du produit :
il comprend une demande, la planifie, la décide, engage une tâche, la journalise et la sécurise.

Ce paquet est **importable**, pas interrogeable : il n'expose **aucune API HTTP**, aucun endpoint,
aucun service. La plateforme (construite par Lovable) l'importe en processus comme n'importe quelle
bibliothèque du projet — voir [`../docs/CORE_PLATFORM_BOUNDARY.md`](../docs/CORE_PLATFORM_BOUNDARY.md)
et [`../docs/LOVABLE_INTEGRATION.md`](../docs/LOVABLE_INTEGRATION.md).

> **Langage officiel.** Le cœur est en **TypeScript/Node.js**, et c'est sa **seule**
> implémentation : l'implémentation Python historique a été retirée du dépôt après démonstration
> de la parité (voir [ADR-0010](../docs/adr/ADR-0010-migration-du-coeur-vers-typescript.md)).
> Les journaux qu'elle a produits sont figés dans `tests/fixtures/` et relus à chaque exécution
> des tests : la garantie que les preuves restent mutuellement vérifiables est conservée.

## État vérifié

- **249 tests verts**, 16 fichiers de tests (`cd core && npm test`).
- `npm run verify` = typecheck + lint + tests.
- Node **>= 22**, développé et vérifié sur **Node 24 LTS** ; ESM.
- Dépendances d'exécution : **`ajv` et `ajv-formats`** uniquement.
- **13 contrats JSON Schema** neutres et partagés dans [`schemas/`](schemas/).
- Aucune dépendance à Hermes, à Telegram ni à un runtime de construction.

## Installation

Depuis la racine du dépôt :

```bash
export PATH="$HOME/.local/share/codidev/node/bin:$PATH"   # Node >= 22
cd core
npm install            # uniquement si node_modules est absent
npm run build          # produit dist/
```

Le paquet est `private` : il se consomme depuis ce dépôt (application Next.js, hôte serveur), pas
depuis un registre public.

## Scripts

| Script | Rôle |
|---|---|
| `npm run typecheck` | `tsc --noEmit` sur `src/` et `tests/` |
| `npm run lint` | `biome check .` (format + règles, `noExplicitAny` interdit) |
| `npm run lint:fix` | `biome check --write .` |
| `npm test` | `vitest run` — suite complète |
| `npm run test:watch` | `vitest` en mode veille |
| `npm run build` | `tsc -p tsconfig.build.json` → `dist/` |
| `npm run verify` | `typecheck && lint && test` — la vérification complète |

Un test ne dépend **jamais** d'un accès réseau ni d'une clé d'API : tous les appels LLM sont
simulés (provider `mock`). La configuration Vitest le documente explicitement.

## Structure du paquet

```
core/
├── src/
│   ├── index.ts          surface publique du paquet (`CodiDevCore`, `Request`, `AgentCore`)
│   ├── statuses.ts       vocabulaires canoniques (statuts, états, risques, sévérités, verdicts)
│   ├── errors.ts         hiérarchie d'erreurs, chacune portant son `OperationStatus`
│   ├── hashing.ts        JSON canonique, SHA-256, hachage chaîné
│   ├── ids.ts            identifiants préfixés, horodatages UTC
│   ├── journal.ts        journal JSONL append-only, chaîné, caviardé (`JournalSink`)
│   ├── evidence.ts       magasin de preuves append-only (`EvidenceStore`)
│   ├── audit.ts          journal d'audit séquencé et chaîné (`AuditLedger`)
│   ├── contracts.ts      chargement + validation hors ligne des 13 schémas
│   ├── context/engine.ts Context Engine : couches, provenance, confiance, isolation tenant
│   ├── planner/planner.ts Planner : plan versionné, invariants, rollback, révision
│   ├── decision/engine.ts Decision Engine : options, sélection tracée, politique, obligations
│   ├── task/engine.ts    Task Engine : machine à états, transitions journalisées
│   ├── agent/            Agent Core : `request.ts`, `intent.ts`, `core.ts`
│   ├── security/         `secrets`, `report`, `gate`, `allowlist`, `tools`
│   └── llm/              `types`, `mock`, `deepseek`, `router` (abstraction `LLMProvider`)
├── schemas/              13 contrats JSON Schema 2020-12, neutres et partagés
├── tests/                16 fichiers Vitest (unitaires, intégration, sécurité, parité)
├── dist/                 sortie compilée (générée)
├── package.json · tsconfig.json · tsconfig.build.json · biome.json · vitest.config.ts
└── tests/fixtures/       journaux écrits par l'implémentation Python, figés
```

## Exports du paquet

Les deux points d'entrée déclarés dans `package.json` :

| Sous-chemin | Contenu |
|---|---|
| `@codidev/core` | La surface logicielle : `CodiDevCore` (façade), `AgentCore`, `Request`, moteurs, statuts, erreurs, sécurité, couche LLM |
| `@codidev/core/schemas/*` | Les 13 contrats JSON Schema, réutilisables tels quels |

Le point d'entrée principal réexporte, entre autres : `CodiDevCore`, `AgentCore`, `Request`,
`ContextEngine`, `Planner`, `DecisionEngine`, `TaskEngine`, `EvidenceStore`, `AuditLedger`,
`OperationStatus`, `TaskState`, `RiskClass`, `GateOutcome`, `PolicyOutcome`, et l'ensemble de la
couche `llm/` (`LLMProvider`, `DeepSeekProvider`, `MockLLMProvider`, `createLLMProvider`,
`loadLLMConfigFromEnv`, `describeLLMConfig`…).

## Utilisation

```ts
import { CodiDevCore } from '@codidev/core';

const core = CodiDevCore.create({
  workspaceDir: './.codidev',   // journaux evidence.jsonl / audit.jsonl
  env: process.env,             // la clé d'API vit ici, jamais dans le code
});

const result = await core.run({
  text: 'corriger la validation des entrées',
  tenantId: 'tenant-a',         // obligatoire
  actor: 'user-1',              // obligatoire
  hints: { action: 'fix' },     // signaux structurés
});

// result.status, result.intent, result.plan, result.task, result.question, result.notes
```

Sans provider LLM configuré, le cycle reste **entièrement déterministe** : l'abstraction est
facultative, les signaux structurés suffisent. L'appel direct aux moteurs (`AgentCore.analyze`,
`.plan`, `.decide`) reste possible pour un contrôle plus fin.

## Configuration LLM

Le cœur ne dépend d'aucun fournisseur nommé : il dépend de l'interface `LLMProvider`. DeepSeek est
le provider initial du MVP, `mock` sert aux tests.

| Variable d'environnement | Défaut |
|---|---|
| `CODIDEV_LLM_PROVIDER` | `deepseek` (ou `mock`) |
| `CODIDEV_LLM_MODEL` | `deepseek-chat` |
| `CODIDEV_LLM_API_KEY_ENV` | `CODIDEV_DEEPSEEK_API_KEY` — **nom de variable, jamais une clé** |
| `CODIDEV_LLM_BASE_URL` | `https://api.deepseek.com/v1` |
| `CODIDEV_LLM_TIMEOUT_MS` · `_MAX_RETRIES` · `_MAX_TOKENS` · `_TEMPERATURE` | 60000 · 2 · 4096 · 0.2 |

**Sécurité des clés.** La configuration ne porte que le **nom** de la variable qui contient la
clé ; le provider la lit au moment de l'appel. La clé n'apparaît ni dans un type, ni dans un
journal, ni dans une preuve, ni dans un message d'erreur (le provider ne conserve qu'un **lecteur**
de clé, jamais la clé). Toute réponse ou erreur du fournisseur est caviardée avant d'être propagée.
Sans clé, le provider refuse d'appeler plutôt que de rendre une réponse inventée.

```bash
# jamais dans un fichier versionné ; fournie par l'environnement d'exécution
export CODIDEV_DEEPSEEK_API_KEY='***'   # valeur réelle fournie hors dépôt
```

## Tests et build

```bash
npm test        # 249 tests, aucun réseau, aucune clé
npm run verify  # typecheck + lint + tests — la référence avant commit
npm run build   # dist/ prêt à consommer
```

Les tests couvrent les unités (statuts, erreurs, journal, sécurité, moteurs), l'intégration
(cycle complet, isolation tenant, secrets) et la **parité croisée** : un journal produit par
l'implémentation TypeScript est relu et re-haché par l'implémentation Python historique, et
inversement. Deux journaux « valides » mais incompatibles échoueraient ce test.

## Frontière de cette phase

`AgentCore.run()` **prépare, vérifie et gèle** une tâche : il n'exécute **aucun outil**. Le statut
renvoyé est `NOT_EXECUTED` tant que l'Execution Engine n'existe pas. Aucun module ne simule une
capacité non implémentée.

## Licence

MIT — voir [`LICENSE`](LICENSE).
