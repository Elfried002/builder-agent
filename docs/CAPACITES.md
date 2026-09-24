# Capacités et spécialités — Builder Agent

Référence de routage : c'est cette liste qui est déclarée à l'orchestrateur
(`specialty: builder`, `capabilities[]`) et qui doit rester alignée sur le profil
[`agent/builder-agent.json`](../agent/builder-agent.json).

**19 capacités déclarées**, réparties en **3 spécialités**.

---

## Spécialité 1 — Full-Stack Engineering

| Capacité déclarée | Compétence normative | Preuve attendue |
|---|---|---|
| full-stack engineering | `frontend-patterns`, `backend-patterns` | application qui démarre, build vert, parcours utilisateur exercé |
| advanced programming | `coding-standards` | code lisible, immuable par défaut, revue passée |
| frontend patterns | `frontend-patterns` | composants, état et rendu conformes ; pas de logique métier dans la vue |
| react performance | `react-performance` | mesures avant/après, pas d'optimisation déclarative |
| frontend accessibility | `frontend-a11y` | HTML sémantique, ARIA, navigation clavier, focus |
| backend patterns | `backend-patterns` | couches séparées, requêtes bornées, pas de N+1 |
| api design | `api-design` | ressources nommées, codes de statut corrects, pagination, erreurs structurées |
| fastapi patterns | `fastapi-patterns` | structure de projet, schémas Pydantic v2, dépendances, tests d'API |
| error handling | `error-handling` | échecs explicites, aucune exception avalée, journalisation exploitable |

## Spécialité 2 — Software Architecture

| Capacité déclarée | Compétence normative | Preuve attendue |
|---|---|---|
| software architecture | `hexagonal-architecture`, `architecture-decision-records` | frontières explicites, décisions structurantes tracées en ADR |
| hexagonal architecture | `hexagonal-architecture` | domaine isolé, ports/adaptateurs, inversion de dépendance |
| architecture decision records | `architecture-decision-records` | une ADR par décision structurante (contexte, options, conséquence) |
| database migrations | `database-migrations` | migration réversible, sauvegarde avant changement destructif, zéro coupure |

## Spécialité 3 — DevSecOps

| Capacité déclarée | Compétence normative | Preuve attendue |
|---|---|---|
| devsecops | toutes | sécurité intégrée au flux, pas ajoutée après coup |
| docker patterns | `docker-patterns` | image minimale, secrets hors des couches, utilisateur non root |
| deployment patterns | `deployment-patterns` | CI/CD, health check, **chemin de retour arrière** testé |
| python testing | `python-testing` | pytest, fixtures, TDD : le test échoue avant le correctif |
| end-to-end testing | `e2e-testing` | Playwright, Page Object Model, artefacts en CI |
| coding standards | `coding-standards` | conventions nommage / lisibilité / qualité appliquées sans rappel |

---

## Règles issues des compétences, appliquées par défaut

Ces règles ne sont pas des préférences : elles font partie du contrat de travail de l'agent.

1. **Versions épinglées**, lockfile commité — aucune dépendance flottante.
2. **Aucun secret** dans le code, les images, les journaux ou les rapports.
3. **Migration réversible** avec sauvegarde avant tout changement destructif.
4. **Déploiement accompagné** d'un health check et d'un chemin de retour arrière.
5. **Le test échoue avant le correctif** — un test qui n'a jamais échoué ne prouve rien.
6. **Décision structurante = une ADR** consignée dans le dépôt.
7. **Dépendance justifiée** : provenance vérifiée, aucune bibliothèque inutile.

## Capacité absente = travail non revendiqué

Une capacité non déclarée ne doit pas être exercée silencieusement. Si la mission l'exige,
l'agent le signale comme **point ouvert** et demande validation avant d'élargir son périmètre
(voir [GOUVERNANCE.md](GOUVERNANCE.md)).
