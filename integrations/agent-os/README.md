# integrations/ — ponts optionnels (hors définition de l'agent)

Ces scripts branchent CodiDev sur des outils externes. Ils **ne font pas partie** de la
définition de l'agent : CodiDev est indépendant et pleinement exécutable sans eux. Ils sont
conservés parce qu'ils restent utiles le jour où l'on veut publier la fiche de l'agent sur un
outil d'administration.

| Fichier | Rôle |
|---|---|
| `agent-os/enregistrer_agent_os.py` | publie la fiche de l'agent sur une console d'administration locale (`POST /api/agents`), avec `--dry-run` |
| `agent-os/verifier_agent_os.py` | relecture de la fiche publiée, puis exécution de contrôle |

Règles appliquées :

- **Aucun secret dans le dépôt.** Le jeton d'administration se lit dans l'environnement et
  n'est jamais affiché (seul un indicateur de présence est imprimé).
- **Vérification par relecture** : un `201` ne prouve pas qu'un agent fonctionne ; on relit la
  fiche, puis on exécute un contrôle.
- Ces scripts ne sont **pas** requis par `scripts/verifier_depot.py` ni par la suite de tests :
  leur absence ne dégrade pas CodiDev.

> Ne pas confondre avec l'orchestrateur multi-agents dont CodiDev a été détaché (voir
> [`../archive/orchestrateur/`](../archive/orchestrateur/)) : ces scripts-ci visent une console
> d'administration locale, et restent optionnels.
