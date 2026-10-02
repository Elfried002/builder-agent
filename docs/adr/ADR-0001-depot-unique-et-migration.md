# ADR-0001 — Dépôt unique, cœur à la racine, historique préservé

**Statut :** accepté · **Date :** 2026-10-02 · **Décideur :** propriétaire du dépôt

## Contexte

`CODIDEV_DOCUMENTATION/00_VISION_GOVERNANCE/03_DECISIONS.md` (ADR-001) impose que CodiDev soit
**un seul produit, dans un seul dépôt**. Le dépôt existant contenait une définition d'agent
hébergé (profil, prompt, 15 compétences ECC, gouvernance en prose) occupant la racine, sans
aucun rapport avec l'architecture décrite par le corpus (Agent Core, Execution, Security,
Connectors, Memory/Learning, plateforme).

## Décision

1. Le cœur CodiDev occupe la **racine** du dépôt (`src/codidev/`, `tests/`, `pyproject.toml`).
2. La définition historique est déplacée **intégralement et sans suppression** sous
   `legacy/agent-definition-v3/`, avec ses tests et son vérificateur.
3. La préservation est **prouvée**, pas déclarée : les 15 tests et les 15 contrôles de la
   définition historique s'exécutent depuis leur nouvel emplacement (voir
   `docs/PHASE_0_REPORT.md`).

## Conséquences

- Un seul dépôt, une seule vérité, aucune duplication de code.
- L'historique reste auditable et réactivable ; rien n'est réécrit ni supprimé.
- Un second dépôt ultérieur pour la couche produit violerait cet ADR : la couche produit devra
  être construite dans ce même dépôt.
