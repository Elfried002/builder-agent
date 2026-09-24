# Bibliothèque de compétences — Builder Agent

15 compétences **normatives** : leur contenu fait partie du contrat de travail de l'agent.
Elles sont versionnées ici en textes complets, pour que la définition de Builder Agent reste
lisible, reproductible et auditable (les orchestrateurs n'ayant pas de chargeur de
compétences, le prompt système n'en porte qu'un digest).

## Index par domaine

### Conventions et qualité
- **`coding-standards`** — conventions transverses : nommage, lisibilité, immuabilité, revue de qualité.

### API
- **`api-design`** — nommage des ressources, codes de statut, pagination, filtrage, réponses d'erreur, versionnage, limitation de débit.
- **`fastapi-patterns`** — structure de projet, schémas Pydantic v2, injection de dépendances, handlers asynchrones, authentification/autorisation, couche de services transactionnelle, tests d'API.

### Backend
- **`backend-patterns`** — architecture backend, conception d'API, optimisation base de données, bonnes pratiques serveur (Node.js, Express, routes API Next.js).
- **`error-handling`** — gestion robuste des erreurs en TypeScript, Python et Go.

### Frontend
- **`frontend-patterns`** — React, Next.js, gestion d'état, performance, bonnes pratiques d'interface.
- **`react-performance`** — optimisation React/Next.js (adapté des bonnes pratiques d'ingénierie Vercel).
- **`frontend-a11y`** — HTML sémantique, ARIA, étiquetage des formulaires, navigation clavier, gestion du focus, lecteurs d'écran.

### Données
- **`database-migrations`** — changements de schéma, migrations de données, retours arrière, déploiements sans coupure (PostgreSQL, MySQL, ORM courants).

### Tests
- **`python-testing`** — stratégies pytest, TDD, fixtures, mocks, paramétrage, exigences de couverture.
- **`e2e-testing`** — Playwright, Page Object Model, configuration, intégration CI/CD, artefacts, tests instables.

### Industrialisation
- **`docker-patterns`** — images, Docker Compose, durcissement, sécurité des conteneurs, réseau, volumes, orchestration multi-services.
- **`deployment-patterns`** — CI/CD, conteneurisation, health checks, stratégies de retour arrière, listes de contrôle de mise en production.

### Architecture
- **`hexagonal-architecture`** — Ports & Adapters : frontières de domaine, inversion de dépendance, orchestration de cas d'usage testables.
- **`architecture-decision-records`** — consigner chaque décision d'architecture structurante sous forme d'ADR.

## Correspondance avec le profil

`agent/builder-agent.json` → `skills.retenues` doit lister exactement ces 15 compétences.
Toute divergence est signalée par `scripts/verifier_depot.py` (le profil est la référence de
ce que l'agent déclare porter ; la bibliothèque est la référence de ce qu'il peut appliquer).

## Provenance

| Champ | Valeur |
|---|---|
| Catalogue | ECC — `affaan-m/ECC` |
| Révision | `bf70150` |
| Format | `SKILL.md` par compétence (frontmatter `name` / `description` + corps) |

Les textes sont conservés tels qu'importés depuis le catalogue, sans réécriture.
