# ADR-0003 — Toolchain Python isolée, hors dépôt et hors environnement de construction

**Statut :** accepté · **Date :** 2026-10-02 · **Décideur :** propriétaire du dépôt

## Contexte

Le serveur ne dispose pas d'accès `sudo` non interactif : toute installation système exigerait
une intervention manuelle. Les interpréteurs exposés par l'environnement de construction sont
exclus par ADR-0002. Il faut donc une toolchain reproductible, installable sans privilèges.

## Décision

1. Interpréteur **CPython 3.12 géré par `uv`**, installé en espace utilisateur.
2. Environnement virtuel dans `~/.local/share/codidev/venv` — **hors du dépôt**.
3. Dépendances **épinglées** dans `pyproject.toml` et **verrouillées** dans `uv.lock` (versionné).
4. Les rapports de vérification sont écrits hors du dépôt (`~/.local/share/codidev/artifacts/`).
5. Reproductibilité : `scripts/bootstrap_env.sh` recrée l'environnement à l'identique.
6. Aucune installation système, aucun `sudo`, aucun mot de passe demandé par le canal de
   communication.

## Conséquences

- Environnement reproductible et révocable ; le dépôt reste propre.
- Une montée de version est un changement de lockfile, donc un changement visible et revu.
- Les outils système (Docker, clients de base de données) restent hors périmètre tant qu'ils
  exigent des privilèges (voir ADR-0006).
