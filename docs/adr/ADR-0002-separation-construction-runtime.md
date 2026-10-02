# ADR-0002 — Séparation stricte entre l'environnement de construction et le runtime

**Statut :** accepté · **Date :** 2026-10-02 · **Décideur :** propriétaire du dépôt

## Contexte

Le corpus est explicite : `00_VISION_GOVERNANCE/03_DECISIONS.md` (ADR-002) et
`14_HERMES_CONSTRUCTION/02_IMPLEMENTATION_RULES.md` interdisent toute dépendance runtime à
l'environnement de construction. Or l'environnement de construction (Hermes) expose ses propres
interpréteurs Python et Node ; bâtir le cœur dessus créerait précisément la dépendance interdite,
de façon invisible jusqu'au jour où l'environnement change.

## Décision

1. Le cœur n'importe **que** la bibliothèque standard Python et ses dépendances déclarées.
2. Aucune dépendance à un chemin, un binaire, une configuration ou un service de l'environnement
   de construction.
3. Un test échoue si un import hors de cette liste apparaît dans `src/` (`tests/test_repo_integrity.py`).
4. Le cœur n'est ni piloté par, ni intégré à, un orchestrateur externe ni à un canal de
   messagerie : ce sont des exclusions explicites du périmètre.

## Conséquences

- Le cœur est exécutable partout où Python 3.12 et le lockfile sont disponibles.
- La construction peut changer d'environnement sans toucher une ligne du cœur.
- Coût : la toolchain doit être installée explicitement (voir ADR-0003).
