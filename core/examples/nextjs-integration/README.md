# Fixture d'intégration Next.js — Core CodiDev

Cette fixture montre **comment une application Next.js / Lovable consomme le cœur TypeScript**
(`@codidev/core`). Elle est volontairement minimale : un cycle serveur, une route, un test qui
l'exécute réellement.

## À quoi sert cette fixture

- Montrer le point d'entrée réel de l'intégration : `CodiDevCore`, sa configuration, un cycle
  `run()`.
- Montrer où passe la **frontière serveur / navigateur** : le cœur tourne côté serveur, jamais
  dans le navigateur, et la clé d'API ne quitte jamais le serveur.
- Fournir un exemple de gestionnaire de route App Router qui **n'importe rien de Next.js** au
  niveau de son corps (uniquement `Request` / `Response` du Web API), afin qu'il reste vérifié par
  `tsc` sans installer Next.js.
- Prouver par un test exécutable que la fixture n'est pas décorative.

## Ce qu'elle ne fait pas

- **Aucun frontend**, aucun dashboard, aucune page React.
- **Aucune authentification**, aucun Supabase, aucune base de données, aucune couche SaaS.
- **Aucun outil exécuté** : le cœur s'arrête à la frontière d'exécution (`NOT_EXECUTED`) ; il
  produit un plan `PROPOSED`, pas un travail accompli.
- **Aucune clé** : la configuration vient de l'environnement d'exécution.

## Contenu

| Fichier | Rôle |
| --- | --- |
| `runCodidev.ts` | Fonction serveur : instancie le cœur depuis l'environnement et exécute un cycle. N'importe rien de Next.js. |
| `app/api/codidev/route.ts` | Gestionnaire de route (`POST /api/codidev`). Le seul élément propre à Next.js est l'emplacement du fichier et l'export `POST`. |
| `tests/nextjs-fixture.test.ts` | Exécute réellement `runCodidev.ts` avec le provider simulé (aucun réseau, aucune clé). |
| `server-side-usage.md` | Comment appeler le cœur depuis un composant serveur, et où est la frontière. |

## Lancer la fixture

Depuis `core/` (le paquet `@codidev/core`) :

```sh
# Le test exécutable de la fixture (provider simulé, hors ligne).
npx vitest run examples/nextjs-integration/tests/nextjs-fixture.test.ts

# Vérification de types et de style sur la fixture.
npx tsc --noEmit
npx biome check examples
```

## Configuration

Le module lit sa configuration dans l'environnement d'exécution :

| Variable | Rôle | Défaut |
| --- | --- | --- |
| `CODIDEV_WORKSPACE_DIR` | Répertoire des journaux `evidence.jsonl` / `audit.jsonl`. | `./.codidev` |
| `CODIDEV_LLM_PROVIDER` | `deepseek` ou `mock`. | `deepseek` |
| `CODIDEV_LLM_MODEL` | Nom du modèle. | `deepseek-chat` |
| `CODIDEV_LLM_API_KEY_ENV` | **Nom** de la variable qui porte la clé d'API. | `CODIDEV_DEEPSEEK_API_KEY` |
| `CODIDEV_LLM_BASE_URL` | URL de base du provider. | `https://api.deepseek.com/v1` |

Le cœur ne reçoit jamais la clé : il reçoit le **nom** de la variable et la résout lui-même au
moment de l'appel. C'est pourquoi aucun secret n'a besoin d'apparaître dans le code de la fixture,
et pourquoi la fixture fonctionne hors ligne avec `CODIDEV_LLM_PROVIDER=mock`.

## Ce que renvoie un cycle

`runCodidev` renvoie un résumé sérialisable : statut d'opération, intention, plan, décision, tâche,
notes et **rapport d'intégrité des journaux**. Tant que l'intégrité n'est pas vérifiée, le cycle
n'est pas présenté comme fiable.
