# workspace/ — zone de travail

Espace de travail temporaire de CodiDev : brouillons, extraits, artefacts intermédiaires,
sorties de commandes conservées pour preuve.

## Règles

1. **Rien d'important ne reste ici.** Un livrable vit dans le dépôt (code, `docs/`,
   `tests/`, `memory/`) ; `workspace/` est un répertoire de passage.
2. **Aucun secret.** Ni `.env`, ni jeton, ni clé — même temporairement. Les secrets vivent
   hors du dépôt, sans exception.
3. **Purgeable.** Le contenu peut être supprimé sans perte de valeur ; ce qui doit survivre
   est promu ailleurs **avec sa preuve**.
4. **Nommage** : `AAAA-MM-JJ_<tache>_<objet>.<ext>` pour que l'origine reste lisible.

## Statut

`AVAILABLE` — le répertoire existe et est versionné (fichier `.gitkeep`). Il est vide à
l'installation : c'est l'état attendu, pas un défaut.
