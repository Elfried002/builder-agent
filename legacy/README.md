# `legacy/` — archive historique

> ⚠️ **ARCHIVE HISTORIQUE.** Ce répertoire contient une **archive antérieure au Core TypeScript**
> de CodiDev. Il **n'est pas** le CodiDev Core et ne le décrit pas. **Rien** de son contenu ne doit
> être importé, copié, exécuté ou réutilisé dans le produit. Le Core canonique est
> [`core/`](../core/) (TypeScript/Node.js, paquet `@codidev/core`).

---

## Ce que contient cette archive

`agent-definition-v3/` est une ancienne **définition d'agent** (« Builder Agent », renommée
« CodiDev » v3) destinée à être **hébergée par un runtime externe** (Hermes), avec ses scripts
d'enregistrement sur une console Agent OS et ses artefacts d'orchestrateur. Elle décrit un agent
autonome piloté par une plateforme, ce que CodiDev **n'est plus** : le Core est désormais un paquet
logiciel TypeScript importé en processus, sans API HTTP et sans runtime de construction associé.

## Pourquoi elle est conservée

Pour la **traçabilité** : cette archive documente l'état antérieur du dépôt et permet de comprendre
l'origine des idées (gouvernance, Human Gate, preuves, compétences) reprises par le Core actuel.
Elle est figée : elle n'évolue plus et ne doit pas servir de référence d'implémentation.

## Références actuelles

- Core officiel : [`core/`](../core/) — TypeScript/Node.js, `@codidev/core`.
- Frontière cœur / plateforme : [`docs/CORE_PLATFORM_BOUNDARY.md`](../docs/CORE_PLATFORM_BOUNDARY.md).
- Intégration plateforme (Lovable) : [`docs/LOVABLE_INTEGRATION.md`](../docs/LOVABLE_INTEGRATION.md).
- Décision de migration : [`docs/adr/ADR-0010-migration-du-coeur-vers-typescript.md`](../docs/adr/ADR-0010-migration-du-coeur-vers-typescript.md).
