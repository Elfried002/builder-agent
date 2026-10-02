# ADR-0006 — Isolation d'exécution native, explicitement non équivalente à un conteneur

**Statut :** accepté (provisoire) · **Date :** 2026-10-02 · **Décideur :** propriétaire du dépôt

## Contexte

Le corpus exige que le code des projets soit traité comme non fiable
(`04_EXECUTION/02_WORKSPACE.md`). L'isolation de référence suppose des conteneurs. Or Docker
n'est pas installé et son installation exige des privilèges `sudo` non disponibles en mode non
interactif, donc une intervention manuelle du propriétaire.

## Décision

1. Démarrer avec une isolation **native** : répertoire de travail cloisonné, limites de
   ressources (`rlimits`), réseau coupé par défaut, exécution sans shell, listes blanches de
   commandes.
2. Cette isolation est **documentée comme non équivalente à un conteneur** : elle ne protège pas
   contre un noyau partagé ni contre une évasion par un binaire privilégié.
3. Aucune capacité ne sera décrite comme plus forte qu'elle ne l'est : les limites sont écrites
   dans la documentation utilisateur du module Workspace (Phase 3).
4. Le passage à Docker est une décision ultérieure, après intervention manuelle du propriétaire.

## Conséquences

- La Phase 3 peut avancer sans privilèges système.
- Le risque résiduel est nommé, pas dissimulé.
- Une partie de la Phase 3 devra être revue lors du passage à un conteneur.
