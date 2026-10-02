# CodiDev Core — implémentation Python (en migration)

> **Statut : `LEGACY / HISTORICAL` — implémentation en cours de retrait.**
> L'implémentation **officielle** du CodiDev Core est **TypeScript / Node.js**, dans `core/`.
> Ce paquet Python a servi à établir et prouver les invariants du cœur ; il est conservé le temps
> de la migration, afin que la parité soit **testée** et non affirmée, puis il sera supprimé.

## Pourquoi il existe encore

`docs/migration/01-PYTHON_CORE_AUDIT.md` recense 38 invariants que le cœur doit garantir, et
`docs/migration/02-MIGRATION_MAP.md` associe chacun à son composant TypeScript et à son test de
parité. Tant que cette parité n'est pas démontrée par exécution, supprimer cette implémentation
détruirait la seule référence prouvée.

## Ce qu'il contient

Le cœur agentique : vocabulaires canoniques, contrats (désormais partagés dans `core/schemas/`),
journaux de preuves et d'audit chaînés, sécurité (détection de secrets, gate, exceptions revues),
Context Engine, Planner, Decision Engine, Task Engine, Agent Core.

**Il ne contient pas** de couche LLM : celle-ci est nouvelle et n'existe qu'en TypeScript.

## Exécution

```bash
../../scripts/bootstrap_env.sh                    # environnement isolé (CPython 3.12 via uv)
cd core/python && ../../scripts/verify.sh         # lint, format, secrets, SAST, SCA, tests, gate
```

Environnement dans `~/.local/share/codidev/venv-docs` n'est pas utilisé : le même environnement
`~/.local/share/codidev/venv` sert les deux implémentations tant que la migration dure.

## Contrats

Les 13 schémas JSON sont **neutres** et partagés : `core/schemas/`. Les deux implémentations
valident exactement les mêmes documents, ce qui rend la parité vérifiable de l'extérieur.
