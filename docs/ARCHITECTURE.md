# Architecture — CodiDev

Comment l'agent est composé, ce qui vit où, et pourquoi.

---

## 1. Décomposition

```
Spécification de l'agent
        │
        ├── profil exécutable   agent/codidev.json   (modèle, outils, permissions, gouvernance)
        └── prompt système      agent/codidev.prompt.md   (rôle, workflow, contraintes, sortie)
                    │
                    │  digest normatif (règles applicables, quelques lignes)
                    ▼
        bibliothèque de compétences   skills/<compétence>/SKILL.md   (textes complets, chargés à la demande)
                    │
                    ▼
        exécution locale (Hermes)                    ──► TASK REPORT
```

Trois couches, chacune avec un rôle distinct :

1. **Profil** — ce qui est *branché* sur l'agent : modèle, point d'entrée LLM, température,
   nombre de tours, liste d'outils, planification, activation, métadonnées de gouvernance.
2. **Prompt système** — ce que l'agent *est* : rôle, périmètre, workflow en 7 phases,
   permissions graduées, Human Gate, interdits, arrêt, comportement d'échec, preuves, format
   de sortie, politique mémoire.
3. **Bibliothèque de compétences** — la *norme technique* : 15 compétences, textes complets,
   versionnées dans ce dépôt. Le prompt n'en porte qu'un digest.

## 2. Pourquoi les compétences ne sont pas dans le prompt

Le runtime n'a en général **pas de chargeur de compétences** : au mieux un
prompt système, une mémoire et une liste d'outils. Deux chemins sont donc utilisés ensemble :

- un **digest normatif** dans le prompt système (règles applicables en quelques lignes :
  versions épinglées et lockfile commité, aucun secret dans le code/images/journaux, migration
  réversible avec sauvegarde, health check et chemin de retour arrière, test qui échoue avant
  le correctif, ADR pour toute décision structurante) ;
- les **textes complets** dans la bibliothèque locale, chargés à la demande, référencés dans
  le profil (`skills.catalogue`, `skills.bibliotheque_locale`, `skills.retenues`).

Mesure retenue : un prompt de 6 à 8 Ko pour une quinzaine de compétences est acceptable ;
y coller 180 Ko ne l'est pas — cela pousse **dehors** les instructions de gouvernance
(Human Gate, périmètre négatif, format de sortie), qui sont les premières à disparaître.

## 3. Chaîne d'exécution

1. Le runtime résout le profil, charge le prompt système, expose la liste d'outils.
2. Le serveur **filtre les outils** contre sa propre liste blanche : tout nom inconnu est
   supprimé **en silence**. Le profil ne doit donc déclarer que des outils réellement exposés
   (`scripts/verifier_depot.py` contrôle ce point).
3. L'agent exécute le workflow en 7 phases, consigne les décisions durables en mémoire.
4. Chaque tâche se termine par un **TASK REPORT** et un statut
   `SUCCESS | PARTIAL | BLOCKED | FAILED`.

## 4. Ce qui est versionné ici, et ce qui ne l'est pas

| Élément | Emplacement |
|---|---|
| Définition de l'agent | `agent/` — versionnée, source de vérité |
| Compétences normatives | `skills/` — versionnées, textes complets |
| Gouvernance | `agent/codidev.json` (machine) + `docs/GOUVERNANCE.md` (lisible) |
| Secrets (jeton admin, clé d'enregistrement, jeton d'agent, clé LLM) | **hors du dépôt** — environnement ou `.env.local` |
| Identité | celle de la définition (`codidev`) — agent indépendant, aucune plateforme |

## 5. Exécution locale et intégrations optionnelles

CodiDev s'exécute **localement** (runtime Hermes) à partir de sa seule définition : profil,
prompt système, bibliothèque de compétences, gouvernance. Aucune inscription, aucun heartbeat,
aucune identité de plateforme n'est requis pour l'exécuter.

| Chemin | Contenu |
|---|---|
| `scripts/verifier_depot.py` | préflight local : profil, prompt, compétences, outils, absence de secret |
| `integrations/agent-os/` | **optionnel** : publication de la fiche sur une console d'administration locale |
| `archive/orchestrateur/` | artefacts historiques d'une période révolue (aucun dispositif en service) |

Dans tous les cas, **la vérification se fait par relecture**, jamais par le code HTTP d'une
réponse d'écriture. Détails et pièges : [`EXPLOITATION.md`](EXPLOITATION.md).
