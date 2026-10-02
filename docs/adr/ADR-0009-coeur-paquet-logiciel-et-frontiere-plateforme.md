# ADR-0009 — Le cœur est un paquet logiciel, pas un service ; frontière Core / Platform

**Statut :** accepté · **Date :** 2026-10-02 · **Décideur :** propriétaire du dépôt
**Remplace :** la partie de l'instruction de Phase 0 évoquant une « couche API pour Lovable »

## Contexte

Une première instruction laissait entendre que le cœur devrait exposer une API destinée à une
plateforme construite séparément. L'architecture réelle est l'inverse :

- **Hermes construit le cerveau de CodiDev** — raisonnement, planification, décision, exécution,
  outils, sécurité, mémoire, apprentissage, skills, preuves, audit ;
- **Lovable construit la plateforme** — interface, comptes, SaaS, Supabase, authentification,
  paramètres — puis **intègre le cœur** dans le projet final ;
- le cœur et la plateforme vivent dans **le même dépôt** et forment **un seul produit**.

Il ne doit donc exister **aucune couche d'API intermédiaire** dont le seul rôle serait de
permettre à la plateforme de « parler » au cœur.

## Décision

1. Le cœur est un **paquet Python autonome** installable (`pip install -e core/`), importable
   (`import codidev`), sans serveur, sans endpoint, sans dépendance web.
2. Sa surface publique est faite d'**objets et de fonctions** : `AgentCore`, `ContextEngine`,
   `Planner`, `DecisionEngine`, `TaskEngine`, `EvidenceStore`, `AuditLedger`, et de **13 contrats
   JSON Schema** qui décrivent tout ce qui entre et sort.
3. Le cœur **ignore tout de la plateforme** : aucun import, aucune référence, aucune hypothèse sur
   l'interface, la base de données, l'authentification ou le mode de déploiement.
4. La structure du dépôt sépare les responsabilités sans les mélanger :
   `core/` (construit ici) · `legacy/` (définition historique préservée) · `docs/`, `scripts/`
   (projet) · les emplacements de la plateforme **ne sont pas créés par le cœur**.
5. Ce qui est **documenté** n'est pas ce qui est **créé** : ce document décrit la frontière pour
   rendre l'intégration possible ; il ne l'occupe pas.

## Conséquences

- Aucun travail d'« API pour Lovable » n'est produit, et aucun ne sera produit.
- L'intégration se fait par le code : la plateforme importe le cœur, appelle ses fonctions et
  manipule ses contrats.
- Les questions d'architecture d'intégration qui découlent de cette frontière — notamment la
  traversée de frontière de langage — sont **documentées comme points à trancher**, pas décidées
  unilatéralement : voir [`../CORE_PLATFORM_BOUNDARY.md`](../CORE_PLATFORM_BOUNDARY.md).
- Vérification opposable : un test échoue si `core/` importe quoi que ce soit hors bibliothèque
   standard et dépendances déclarées, et un test échoue si le code du cœur référence un
   emplacement de plateforme (`platform`, `frontend`, `supabase`, `lovable`). Le contrôle porte
   sur les **références du cœur**, pas sur l'existence des dossiers : Lovable les créera, et un
   test d'absence deviendrait alors un faux positif.
