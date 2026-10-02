# ADR-0008 — Stratégie Git simple, linéaire et vérifiée

**Statut :** accepté · **Date :** 2026-10-02 · **Décideur :** propriétaire du dépôt

## Contexte

`CODIDEV_DOCUMENTATION/14_HERMES_CONSTRUCTION/02_IMPLEMENTATION_RULES.md` demande de ne pas
inventer de workflow complexe. Le corpus exige par ailleurs que tout push soit vérifié, qu'aucun
secret ne soit publié, et qu'aucune publication ne soit déclarée sans preuve de lecture distante.

## Décision

1. `main` est la branche stable ; le travail se fait sur des branches courtes `phase/0N-nom`.
2. Une branche n'est fusionnée qu'après : tests verts, lint et format verts, scan de sécurité
   `PASS`, relecture du diff, vérification qu'aucun secret n'est publié.
3. Aucun push sans vérification distante : le commit publié est relu depuis le dépôt distant
   (comparaison de SHA), jamais supposé.
4. Chaque phase se termine par un incrément cohérent et documenté — pas de commit fourre-tout.

## Conséquences

- Historique lisible, réversible, sans cérémonie inutile.
- Un push échoué ou partiel est détecté, pas découvert plus tard.
