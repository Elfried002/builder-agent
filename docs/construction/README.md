# `docs/construction/` — documents de construction de la migration

> ⚠️ **DOCUMENTS HISTORIQUES.** Les documents de ce répertoire décrivent l'**état du dépôt AVANT la
> migration** vers le Core TypeScript et l'analyse de construction qui a préparé cette migration.
> Ils **ne décrivent pas** le Core actuel : celui-ci est en **TypeScript/Node.js** dans
> [`core/`](../../core/). **Exception :** le corpus `CODIDEV_DOCUMENTATION/` reste la **source de
> vérité fonctionnelle** du produit (spécification de référence), et non une description du code
> tel qu'il est aujourd'hui.

---

## Contenu

| Document | Nature | Statut |
|---|---|---|
| [`CONSTRUCTION_ASSESSMENT.md`](CONSTRUCTION_ASSESSMENT.md) | Évaluation de l'environnement et du dépôt **avant** toute ligne de code CodiDev | **Historique** — décrit l'état d'origine |
| [`BUILD_PLAN.md`](BUILD_PLAN.md) | Plan de construction initial et décisions D1→D5 (dont le choix de langage) | **Historique** — les décisions retenues ont évolué (voir ADR-0010 : le cœur est TypeScript) |
| [`CODIDEV_DOCUMENTATION/`](CODIDEV_DOCUMENTATION/) | Corpus de référence fonctionnelle (vision, produit, architecture, sécurité, DevSecOps…) | **Source de vérité fonctionnelle** — spécification de référence, pas une description du code |

## Comment lire ces documents

- `CONSTRUCTION_ASSESSMENT.md` et `BUILD_PLAN.md` reflètent un **moment** de la construction
  (2026-10-02). Ils comportent des hypothèses depuis tranchées différemment — par exemple le
  langage du cœur, choisi en TypeScript et non en Python
  ([ADR-0010](../../docs/adr/ADR-0010-migration-du-coeur-vers-typescript.md)).
- `CODIDEV_DOCUMENTATION/` décrit **ce que le produit doit être**, section par section. C'est la
  spécification que le Core implémente progressivement ; elle reste donc opposable, contrairement
  aux deux rapports ci-dessus.
- Pour l'état **actuel** du dépôt, lire le [`README.md`](../../README.md) racine et
  [`core/README.md`](../../core/README.md).
