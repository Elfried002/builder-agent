# Intégrer le CodiDev Core — guide pour Lovable

**Public :** l'équipe qui construit la plateforme CodiDev (interface, comptes, SaaS) avec Lovable.
**Objet :** comment intégrer le cœur, sans le reconstruire et sans réutiliser l'implémentation
Python.

---

## 0. En une phrase

Le **cœur** est le cerveau de CodiDev, écrit en **TypeScript/Node.js** dans le paquet
`@codidev/core` (`core/`). La **plateforme** l'importe **en processus**, comme une bibliothèque,
et lui passe des demandes. Le cœur ne s'interroge pas à distance : **il n'y a pas d'API HTTP**.

> **Langage officiel — à lire avant tout.** Le cœur supporté est **TypeScript/Node.js**. Le dossier
> `core/python/` contient l'implémentation **historique** (LEGACY) : elle reste exécutable pour les
> tests de **parité croisée**, mais **elle n'est plus le cœur**, elle n'évolue plus et ne doit
> **jamais** être importée, appelée ou copiée par la plateforme. Voir
> [ADR-0010](adr/ADR-0010-migration-du-coeur-vers-typescript.md).

---

## 1. Ce qu'est le cœur

C'est un paquet logiciel importable, sans serveur, sans dépendance web, sans dépendance à Hermes,
à Telegram ou à un runtime de construction.

- **Paquet :** `@codidev/core` · **Langage :** TypeScript `strict`, ESM · **Node :** `>= 22`
  (vérifié sur Node 24 LTS).
- **Dépendances d'exécution :** `ajv`, `ajv-formats` uniquement.
- **Contrats :** 13 JSON Schema neutres dans `core/schemas/`, réutilisables via
  `@codidev/core/schemas/*`.
- **Garanties :** statuts réels, journaux de preuves et d'audit chaînés SHA-256 et caviardés,
  isolation par tenant, gate de sécurité, séparation « le LLM propose / la politique décide ».

## 2. Ce que le cœur fait

| Domaine | Ce qu'il garantit |
|---|---|
| **Context Engine** | Assemble un contexte par couches avec provenance et niveau de confiance ; refuse un élément d'un autre tenant. |
| **Planner** | Produit un plan versionné : étapes ordonnées, risques, critères de vérification, rollback ; refuse un plan qui viole ses invariants. |
| **Decision Engine** | Examine des options, en sélectionne une de façon déterministe et tracée ; une politique `DENY` interdit toute sélection. |
| **Task Engine** | Ouvre une tâche dans une machine à états ; toute transition est journalisée ; `VERIFIED` exige une vérification réellement exécutée et réussie. |
| **Agent Core** | Coordonne `analyser → planifier → décider → engager une tâche` en un cycle unique. |
| **Preuves & audit** | Écrit `evidence.jsonl` et `audit.jsonl`, append-only, chaînés ; détecte toute altération, suppression ou réordonnancement. |
| **Sécurité** | Détecte des secrets, produit un rapport, calcule un verdict de gate (`PASS`/`REVIEW`/`BLOCK`), applique des exceptions revues. |
| **Couche LLM** | Abstraction `LLMProvider` ; provider `DeepSeek` (MVP) et provider `mock` (tests). Le LLM n'exécute jamais rien. |

## 3. Ce que le cœur ne fait PAS — responsabilité de la plateforme

Le cœur **ne fournit pas** et **ne doit pas** contenir :

- **Frontend / interface** : pages, composants, navigation, formulaires, historique affiché.
- **Dashboard / admin** : tableaux de bord, cockpit d'administration.
- **Supabase / base de données** : schéma, migrations, requêtes, stockage multi-tenant.
- **Authentification / authorization** : login, sessions, jetons, rôles, organisations.
- **Facturation / billing**, comptes, abonnements.
- **SaaS** : gestion des utilisateurs, préférences, quotas commerciaux, emails.
- **Backend applicatif hébergeant ces fonctions** et **emballage HTTP du cœur**.

Ces éléments appartiennent à la **plateforme** (Lovable), dans le même dépôt. Voir
[`CORE_PLATFORM_BOUNDARY.md`](CORE_PLATFORM_BOUNDARY.md).

Deux interdits opposables :

1. **Ne pas reconstruire un cœur concurrent.** Ne réimplémentez pas le contexte, la
   planification, la décision, les tâches, les preuves, l'audit ou la sécurité : importez-les.
2. **Ne pas réutiliser le Python.** `core/python/` est LEGACY. Aucun import Python, aucun
   sous-processus vers `codidev`, aucune copie de logique depuis `core/python/`.

## 4. Comment l'importer

Importez **uniquement** par la surface publique du paquet :

```ts
import { CodiDevCore, Request, OperationStatus } from '@codidev/core';
import planSchema from '@codidev/core/schemas/plan.json';
```

Le paquet est `private` (pas de registre public). Deux façons de le consommer :

- **Dépendance de workspace / `file:`** : `"@codidev/core": "file:./core"` dans le `package.json`
  de l'application, puis `npm install` ;
- **Alias de chemin** dans la configuration du bundler (`@codidev/core` → `core/src/index.ts` ou
  `core/dist/index.js`).

Le choix exact retenu pour le projet est celui de la fixture
[`../core/examples/nextjs-integration/`](../core/examples/nextjs-integration/) — consultez son
`README.md` : c'est la référence d'intégration, elle montre la configuration réelle, pas ce
document.

## 5. Comment l'initialiser

```ts
import { CodiDevCore } from '@codidev/core';

const core = CodiDevCore.create({
  workspaceDir: './.codidev',        // où vivent evidence.jsonl et audit.jsonl
  env: process.env,                  // l'environnement d'exécution (clé d'API comprise)
  defaultActor: 'codidev-core',      // facultatif
  // llm: null,                      // facultatif : désactive le LLM (cycle déterministe)
});
```

`CodiDevCore.create(...)` assemble les briques (contexte, plan, décision, tâche, preuves, audit,
provider LLM). Aucune brique n'est construite en dur : tout est injectable et remplaçable. Une
instance est créée **côté serveur**, une fois par processus, et réutilisée.

## 6. Comment lui transmettre une demande

```ts
const result = await core.run({
  text: 'corriger la validation des entrées',  // le texte est caviardé à l'entrée
  tenantId: 'tenant-a',                        // OBLIGATOIRE, fourni par la plateforme
  actor: 'user-1',                             // OBLIGATOIRE
  projectId: null,                             // facultatif
  hints: { action: 'fix', scope: 'module auth' }, // signaux structurés
});
```

- `tenantId` et `actor` sont **obligatoires** : une demande sans appartenance ni auteur est
  refusée (`RequestInvalidError`). Ils viennent de l'**authentification de la plateforme** — le
  cœur ne s'authentifie pas et ne vérifie aucun jeton.
- Les `hints` sont des **signaux structurés** : le cœur ne devine pas le langage naturel. Sans
  signal exploitable, il ne planifie pas et pose une **question ouverte** (`result.question`).

Résultat (`RunResult`) : `status`, `intent`, `plan`, `decisionId`, `task`, `question`,
`contextLayers`, `notes`. Chaque objet est **sérialisable et validé par contrat** : la plateforme
peut le stocker, l'afficher ou le transmettre sans connaître les internes du cœur.

Pour un contrôle plus fin, les moteurs sont accessibles directement (avancé) :

```ts
import { CodiDevCore, PolicyVerdict, option, step } from '@codidev/core';

const core = CodiDevCore.create({ workspaceDir: './.codidev' });

const result = await core.run(
  { text: 'corriger la validation des entrées', tenantId: 'tenant-a', actor: 'user-1' },
  {
    steps: [step('ajouter la validation', {
      expectedOutput: 'entrée invalide refusée',
      verification: ['test unitaire rouge avant, vert après'],
    })],
    objective: 'durcir la validation des entrées',
    options: [option('corriger la validation', { riskClass: 'LOW_WRITE', reversible: true })],
    policy: PolicyVerdict.allow({ policyId: 'tenant-a/default' }), // verdict de la plateforme
    verificationPlan: ['test unitaire rouge avant, vert après'],
    useLlmForPlan: false,
  },
);
```

**Frontière d'exécution.** Aujourd'hui le cœur **prépare, vérifie et gèle** une tâche : il
n'exécute **aucun outil** et renvoie le statut `NOT_EXECUTED`. C'est volontaire : rien n'est
revendiqué qui n'a pas été fait.

## 7. Comment configurer le LLM

Le LLM est **facultatif**. Sans lui, le cycle reste déterministe (signaux structurés + politique).
Avec lui, il n'intervient que là où le raisonnement génératif est nécessaire, et **jamais comme
autorité**.

Configuration par l'environnement d'exécution :

| Variable | Défaut |
|---|---|
| `CODIDEV_LLM_PROVIDER` | `deepseek` (ou `mock`) |
| `CODIDEV_LLM_MODEL` | `deepseek-chat` |
| `CODIDEV_LLM_API_KEY_ENV` | `CODIDEV_DEEPSEEK_API_KEY` — **nom de variable, pas une clé** |
| `CODIDEV_LLM_BASE_URL` | `https://api.deepseek.com/v1` |
| `CODIDEV_LLM_TIMEOUT_MS` / `_MAX_RETRIES` / `_MAX_TOKENS` / `_TEMPERATURE` | 60000 / 2 / 4096 / 0.2 |

Ou par configuration explicite (prioritaire sur l'environnement) :

```ts
const core = CodiDevCore.create({
  workspaceDir: './.codidev',
  llm: {
    provider: 'deepseek',
    model: 'deepseek-chat',
    apiKeyEnvVar: 'CODIDEV_DEEPSEEK_API_KEY', // nom de la variable, jamais la clé
    baseUrl: 'https://api.deepseek.com/v1',
    timeoutMs: 60_000,
    maxRetries: 2,
    maxTokens: 4_096,
    temperature: 0.2,
  },
});
```

Un provider inconnu **lève** : aucun repli silencieux. Voir `loadLLMConfigFromEnv`,
`describeLLMConfig` (description sûre à journaliser, jamais de clé) et `DEFAULT_LLM_CONFIG`.

### DeepSeek

DeepSeek est le **provider initial du MVP**, pas une dépendance structurelle. Le fournisseur ne
fait que **générer** : il ne détient aucun outil et ne peut rien exécuter. Sans clé, il refuse
d'appeler plutôt que de rendre une réponse vide ou inventée.

## 8. Comment fournir un provider

Le cœur dépend de l'interface `LLMProvider`, pas d'un fournisseur nommé :

```ts
import type { LLMProvider, LLMRequest, LLMResponse } from '@codidev/core';

class MonProvider implements LLMProvider {
  readonly name = 'mon-provider';
  readonly model = 'mon-modele';
  async generate(request: LLMRequest): Promise<LLMResponse> {
    // ... appelez votre fournisseur, puis retournez une LLMResponse complète
  }
}
```

Un provider qui exécuterait un outil par lui-même violerait la frontière de sécurité du cœur. Il
peut **déclarer** des outils et **proposer** un appel (`LLMToolCall`), jamais l'exécuter.

## 9. Comment protéger les secrets

- **Aucune clé dans le dépôt**, ni dans le code, ni dans la mémoire, ni dans les journaux, ni dans
  les preuves, ni dans une sortie console.
- La configuration ne porte que le **nom** de la variable d'environnement ; le provider lit la clé
  au moment de l'appel et ne la conserve jamais (il conserve un **lecteur** de clé, pas la clé).
- Toute réponse ou erreur du fournisseur est **caviardée** avant d'être propagée.
- Le texte des demandes est caviardé à l'entrée (`Request`), donc avant toute journalisation.
- `describeLLMConfig(config)` produit une description **sûre à journaliser** : elle n'inclut jamais
  de secret.

Côté plateforme : injectez la clé par l'environnement d'exécution du serveur (variables de
déploiement / secrets du fournisseur d'hébergement). Jamais dans un fichier `.env` versionné (le
`.gitignore` ignore `.env`), jamais dans du code client, jamais dans un log.

## 10. Comment utiliser le cœur côté serveur

Le cœur utilise les modules Node (`node:fs`, `node:path`, `node:url`). Il **ne doit pas** être
embarqué dans un bundle client.

- Appelez-le depuis des **Server Components**, **Server Actions**, **Route Handlers**, ou un
  processus serveur dédié — jamais depuis un composant client.
- Créez l'instance **côté serveur**, une fois par processus, et réutilisez-la.
- Le `workspaceDir` doit être accessible en écriture par le serveur pour les journaux.
- N'exposez **pas** le cœur derrière une API HTTP « juste pour lui parler » : la plateforme étant
  dans le même dépôt et le même runtime, l'appel est un import direct (ADR-0009).

## 11. Comment brancher les outils de la plateforme

État actuel, à ne pas anticiper :

- Le cœur **n'exécute aucun outil** dans cette phase (`NOT_EXECUTED`). L'Execution Engine et le
  Tool Router sont des phases ultérieures.
- La couche `security/tools.ts` fournit des **adaptateurs d'outils de sécurité** (exécution
  d'outils externes, distinction `EXECUTED` / `NOT_EXECUTED` / `FAILED`) — un outil absent n'est
  jamais compté comme un contrôle réussi.
- La couche LLM permet de **déclarer** des outils (`LLMToolDeclaration`) pour que le modèle puisse
  en **proposer** l'appel (`LLMToolCall`). L'exécution appartient au cœur, soumise à la politique,
  aux permissions et au Human Gate.

Règle de branchement : la plateforme fournit l'**identité** (tenant, acteur), la **politique**
(`ALLOW` / `DENY` / `REQUIRE_APPROVAL`) et les **approbations humaines** ; le cœur les consomme. Ne
donnez au LLM aucun accès direct à vos outils, votre base ou vos identifiants.

## 12. Interfaces STABLES vs INTERNES

**STABLES — à utiliser par la plateforme :**

| Surface | Contenu |
|---|---|
| `@codidev/core` | `CodiDevCore`, `AgentCore`, `Request`, moteurs (`ContextEngine`, `Planner`, `DecisionEngine`, `TaskEngine`), `EvidenceStore`, `AuditLedger` |
| `@codidev/core` (vocabulaires) | `OperationStatus`, `TaskState`, `RiskClass`, `Severity`, `GateOutcome`, `PolicyOutcome` |
| `@codidev/core` (LLM) | `LLMProvider`, `LLMRequest`, `LLMResponse`, `DeepSeekProvider`, `MockLLMProvider`, `createLLMProvider`, `loadLLMConfigFromEnv`, `describeLLMConfig` |
| `@codidev/core` (erreurs) | hiérarchie d'erreurs et statuts associés |
| `@codidev/core/schemas/*` | les 13 contrats JSON Schema |

**INTERNES — ne pas importer :**

- tout chemin profond dans `core/src/**` (ex. `core/src/agent/core.js`,
  `core/src/security/secrets.js`) en dehors de ce qui est réexporté par `src/index.ts` ;
- `dist/**` et les fichiers de construction (`tsconfig*`, `biome.json`, `vitest.config.ts`) ;
- **`core/python/**`** : implementation historique, jamais importée ;
- les tests, les rapports et les fixtures en tant que code de production.

Règle simple : **importez `@codidev/core` et `@codidev/core/schemas/*`, rien d'autre.** Si vous
avez besoin d'un élément qui n'y figure pas, demandez son exposition — ne dupliquez pas.

## 13. Comment tester l'intégration

Côté cœur :

```bash
cd core
npm run verify     # typecheck + lint + tests (244 tests verts)
```

Côté plateforme, testez l'intégration **sans clé ni réseau** avec le provider `mock` :

```ts
const core = CodiDevCore.create({
  workspaceDir: './.codidev-test',
  env: { CODIDEV_LLM_PROVIDER: 'mock' },   // aucun réseau, aucune clé
  mockSteps: [
    { structured: { category: 'MODIFY_SOFTWARE', confidence: 0.9, statement: 'durcir la validation' } },
    { structured: { steps: [ /* étapes attendues */ ] } },
  ],
});
```

Points à couvrir :

- une demande sans `tenantId` ou sans `actor` est **refusée** ;
- une demande sans signal exploitable produit une **question ouverte**, pas une invention ;
- une politique `DENY` produit un statut `BLOCKED` et aucune sélection ;
- l'intégrité des journaux (`await core.integrity()`) est vérifiable après un cycle ;
- aucun secret ne fuit dans `evidence.jsonl`, `audit.jsonl` ou les messages d'erreur.

La fixture [`../core/examples/nextjs-integration/`](../core/examples/nextjs-integration/) contient un
branchement Next.js complet et exécutable : `runCodidev.ts` (fonction serveur), `app/api/codidev/route.ts`
(route `POST`), `server-side-usage.md` et un test qui exécute réellement le cycle avec le provider
`mock`. Lancez-le depuis `core/` :

```bash
npx vitest run examples/nextjs-integration/tests/nextjs-fixture.test.ts
```

Suivez son `README.md` pour la configuration exacte.

## 14. Erreurs fréquentes à éviter

| Erreur | Correct |
|---|---|
| Importer `core/python/**` ou lancer `codidev` en sous-processus | Importer `@codidev/core` |
| Réécrire planification / décision / preuves côté plateforme | Appeler le cœur |
| Exposer le cœur derrière une API HTTP interne | Import direct (même dépôt, même runtime) |
| Appeler le cœur depuis un composant client | Côté serveur uniquement |
| Mettre la clé d'API dans du code ou un `.env` versionné | Environnement d'exécution / secrets du serveur |
| Laisser le LLM exécuter un outil | Le LLM propose ; le cœur et la politique décident |
| Authentifier ou vérifier un jeton dans le cœur | Authentification côté plateforme, `tenantId`/`actor` fournis |

## 15. Références

- Frontière cœur / plateforme : [`CORE_PLATFORM_BOUNDARY.md`](CORE_PLATFORM_BOUNDARY.md)
- Décision langage : [`adr/ADR-0010-migration-du-coeur-vers-typescript.md`](adr/ADR-0010-migration-du-coeur-vers-typescript.md)
- Le cœur est un paquet, pas un service : [`adr/ADR-0009-coeur-paquet-logiciel-et-frontiere-plateforme.md`](adr/ADR-0009-coeur-paquet-logiciel-et-frontiere-plateforme.md)
- README du paquet : [`../core/README.md`](../core/README.md)
- Cartographie de migration : [`migration/02-MIGRATION_MAP.md`](migration/02-MIGRATION_MAP.md)
- Fixture d'intégration Next.js : [`../core/examples/nextjs-integration/README.md`](../core/examples/nextjs-integration/README.md)
