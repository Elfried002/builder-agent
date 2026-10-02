# archive/orchestrateur — documents historiques

Ces fichiers sont **archivés** : ils racontent une période révolue de l'histoire de CodiDev (à
l'époque nommé Builder Agent), celle où l'agent était inscrit comme agent d'une plateforme
d'orchestration multi-agents.

| Fichier | Ce que c'est |
|---|---|
| `evidence-orchestrateur.json` | journal de preuves de l'inscription, du heartbeat et de la présence sur l'orchestrateur |
| `RAPPORT_INSTALLATION-orchestrateur.json` | rapport d'installation de cette période (identité de plateforme, tests, git) |

**Pourquoi c'est archivé et non supprimé** : la traçabilité. Les identités attribuées par la
plateforme (`agt_…`), les horodatages et les commandes réellement exécutées sont des faits
datés ; les effacer reviendrait à réécrire l'historique.

**Ce que cela ne change pas** : CodiDev est un **agent indépendant**. Il n'est plus inscrit
auprès d'un orchestrateur, n'émet plus de heartbeat, et son exécution ne dépend d'aucune
plateforme. Aucun secret n'est conservé dans ce dépôt (les identifiants ont été mis en
quarantaine hors du dépôt).

**Ne pas réutiliser ces fichiers comme documentation d'exploitation** : ils décrivent un
dispositif qui n'est plus en service. Voir [`../../AGENT_SPEC.md`](../../AGENT_SPEC.md) §19 pour
l'exécution autonome, et [`../../DESCRIPTION.md`](../../DESCRIPTION.md) pour la description à
jour.
