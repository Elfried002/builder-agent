# ADR-0010 — Le cœur passe en TypeScript/Node.js ; le Python devient historique

**Statut :** accepté · **Date :** 2026-10-02 · **Décideur :** propriétaire du dépôt
**Complète :** ADR-0009 (le cœur est un paquet logiciel, pas un service)
**Remplace :** le choix de langage de facto de la Phase 0/1 (cœur Python)

## Contexte

Le cœur de CodiDev a d'abord été construit en **Python** (paquet `codidev`, 31 fichiers, 204
tests, aujourd'hui retiré). La mission de construction a ensuite fixé un objectif différent : le cœur
doit être intégré **dans le projet final construit par Lovable**, une application Web moderne dont
la pile attendue est **TypeScript / Node.js / React / Next.js**.

Un processus Node.js **ne peut pas importer un paquet Python en processus**. La frontière de
langage imposait donc un mécanisme de traversée (hôte Python embarqué, ou cœur lancé en
sous-processus ligne de commande, ou réécriture). Les options A1 et A2 du document
[`../CORE_PLATFORM_BOUNDARY.md`](../CORE_PLATFORM_BOUNDARY.md) (D-A) maintenaient un couplage
d'exécution, une surface de communication à maintenir et une chaîne d'outils double — pour un
produit qui doit rester un **seul dépôt, un seul produit**.

Le cœur a en conséquence été **réécrit en TypeScript** dans `core/` (paquet `@codidev/core`), en
préservant les invariants et les contrats plutôt que la forme du code. La parité a été démontrée
(38 invariants, matrice générée par exécution) **avant** que l'implémentation Python ne soit
**retirée du dépôt** : TypeScript en est désormais la **seule** implémentation officielle. La
garantie de compatibilité des preuves subsiste sous forme de journaux écrits par l'ancienne
implémentation, figés dans `core/tests/fixtures/` et relus à chaque exécution des tests — une
preuve reste vérifiable par l'implémentation qui, elle, existe toujours.

État vérifié de l'implémentation TypeScript à la date de cette décision :

- `core/` : Node >= 22 (développé et vérifié sur Node 24 LTS), ESM, TypeScript `strict` ;
- `npm run verify` = typecheck + lint (Biome) + tests (Vitest) ; **244 tests verts**, 15 fichiers ;
- dépendances d'exécution : `ajv`, `ajv-formats` uniquement ;
- 13 contrats JSON Schema **neutres** partagés dans `core/schemas/` ;
- aucune API HTTP, aucun endpoint, aucun service (ADR-0009) ;
- aucune dépendance à Hermes, à Telegram ni à aucun runtime de construction.

## Décision

1. **TypeScript/Node.js est l'implémentation officielle unique du cœur.** `core/` est le cœur ;
   il est intégré en tant que paquet (`@codidev/core`) importé par l'application, jamais interrogé
   à distance.
2. Les **contrats sont partagés et neutres** : les 13 JSON Schema vivent dans `core/schemas/` et
   ne dépendent d'aucune implémentation. C'est la source de vérité commune pendant la parité.
3. La **couche LLM** est un composant officiel du cœur TypeScript : abstraction `LLMProvider`,
   provider `DeepSeek` (MVP) et provider `mock` (tests). Le cœur ne dépend d'aucun fournisseur
   nommé ; la clé d'API vit exclusivement dans l'**environnement d'exécution** et n'apparaît ni
   dans le code, ni dans les journaux, ni dans les preuves.
4. Le **Python a été mis en quarantaine** dans `core/python/` pendant la migration : conservé et
   exécutable, mais sans évolution de fonctionnalité, afin que la parité puisse être **démontrée**
   plutôt qu'affirmée. Il a ensuite été **retiré** une fois cette démonstration faite.
5. Le **runtime Node est dédié** et hors Hermes : Hermes est un outil de construction, pas une
   dépendance du produit. L'environnement d'exécution du cœur est un Node >= 22 standard.
6. Toute nouvelle fonctionnalité du cœur s'écrit **en TypeScript**, jamais en Python.

## Alternatives écartées

| Alternative | Pourquoi écartée |
|---|---|
| **Garder le cœur Python** | Impose une traversée de frontière de langage vers une application Node/Next.js, et donc un mécanisme d'exécution supplémentaire à maintenir. Contredit l'objectif d'intégration directe du produit unique. |
| **Deux implémentations concurrentes** (Python + TypeScript, toutes deux évolutives) | Deux cerveaux à faire diverger, deux suites de tests, deux interprétations des mêmes invariants. Le risque de désynchronisation du comportement — en particulier des garanties de sécurité — est inacceptable pour un cœur dont la valeur est la preuve. |
| **Une API HTTP intermédiaire** | Déjà refusée par ADR-0009 : le cœur est du code, pas un service. Une API rouvrirait la surface réseau, l'authentification, le déploiement et la latence que la frontière cherche à éviter. |
| **Hôte Python embarqué / cœur en sous-processus** (A1/A2 de D-A) | Soutenable techniquement, mais maintient une chaîne Python dans le produit final, un protocole de communication à définir et deux runtimes à déployer. Coût permanent pour un bénéfice qui disparaît si le cœur est réécrit. |

## Conséquences

- **Suppression du Python : faite.** `core/python/` a été retiré après démonstration de la parité.
  La garantie de compatibilité des preuves lui survit : les journaux qu'il a produits sont figés
  dans `core/tests/fixtures/` et relus à chaque exécution de la suite de tests.
- **Contrats dans `core/schemas/`.** Les schémas sont neutres et partagés : ils survivent au
  changement d'implémentation et définissent ce qui entre et sort du cœur.
- **Environnement Node dédié hors Hermes.** Le développement et la vérification du cœur
  nécessitent un Node >= 22 ; cet environnement n'est pas une dépendance du produit, seulement un
  outil de construction.
- **Surface publique TypeScript.** L'intégration passe par la façade `CodiDevCore`
  (`core/src/index.ts`) et ses objets sérialisables, documentés dans
  [`../LOVABLE_INTEGRATION.md`](../LOVABLE_INTEGRATION.md). Cette surface est distincte des
  modules internes du cœur.
- **Documentation et outillage.** La frontière Core/Platform, le plan de construction et ce
  document désignent désormais TypeScript comme cible ; un lecteur qui cherche encore `import
  codidev` doit être redirigé vers le paquet TypeScript.
- **Vérification opposable.** La preuve d'acceptation est mesurable : `cd core && npm run verify`
  doit être vert, et les tests de parité croisée doivent relire les journaux de l'implémentation
  Python tant qu'elle existe.
