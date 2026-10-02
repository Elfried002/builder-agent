# Appeler le cœur depuis le serveur

## La frontière, en une phrase

Le cœur CodiDev est une **bibliothèque serveur**. Il ne tourne jamais dans le navigateur et la clé
d'API ne quitte jamais le processus serveur.

## Pourquoi cette frontière

- **Le cœur lit et écrit des journaux** (`evidence.jsonl`, `audit.jsonl`) via le système de
  fichiers : un navigateur n'y a pas accès, et ne doit pas y avoir accès.
- **La clé d'API vit dans l'environnement du serveur.** `runCodidev.ts` ne reçoit que le nom de la
  variable qui la porte (`CODIDEV_LLM_API_KEY_ENV`) ; la valeur est résolue par le provider au
  moment de l'appel. Exposer un module qui référence `process.env` au navigateur reviendrait à
  publier la clé.
- **Une demande porte un tenant et un acteur obligatoires.** Ces valeurs viennent de la session
  serveur (ou d'un en-tête authentifié), jamais d'un client non vérifié.

## Depuis un composant serveur (React Server Component)

Un composant serveur s'exécute sur le serveur : il peut appeler la fonction directement.

```ts
// app/page.tsx  (composant serveur)
import { runCodidev } from '../../runCodidev.js';

export default async function Page() {
  const summary = await runCodidev({
    text: 'durcir la validation des entrées',
    tenantId: 'tenant-a',      // à dériver de la session, jamais du client
    actor: 'user-1',           // idem
    useLlmForPlan: true,
  });

  // `summary.status` vaut NOT_EXECUTED : le cœur propose, il n'exécute pas.
  return <pre>{JSON.stringify(summary, null, 2)}</pre>;
}
```

Le composant n'a **pas besoin** d'être marqué `'use client'`, et ne doit pas l'être : le code du
cœur ne doit pas être embarqué dans le bundle navigateur.

## Depuis le gestionnaire de route

`app/api/codidev/route.ts` est le chemin HTTP classique. C'est le même appel (`runCodidev`), avec
une validation d'entrée en amont pour refuser tôt une demande incomplète.

```sh
curl -sS -X POST http://localhost:3000/api/codidev \
  -H 'content-type: application/json' \
  -d '{"text":"durcir la validation","tenantId":"tenant-a","actor":"user-1"}'
```

## Ce que l'appelant doit retenir du résultat

| Champ | Signification |
| --- | --- |
| `status` | `NOT_EXECUTED` : un plan a été proposé, rien n'a été exécuté. `WAITING_FOR_USER` : une question ou une approbation est requise. `BLOCKED` : la politique a refusé. |
| `plan.status` | `PROPOSED` : le plan est une proposition révisable, jamais un compte rendu. |
| `task.state` | État réel de la tâche engagée (`PROPOSED`, `WAITING_FOR_USER`, …). |
| `notes` | Porte explicitement la frontière d'exécution. |
| `integrity` | Intégrité des journaux, re-vérifiée après le cycle. |

## Erreurs

Une erreur du cœur n'est jamais convertie en succès. Le gestionnaire de route renvoie le motif et
un statut HTTP d'échec ; l'appelant ne doit pas présenter un échec comme un résultat.
