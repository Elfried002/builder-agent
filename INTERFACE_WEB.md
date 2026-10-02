# Interface web CodiDev — spécification produit

Document destiné à la construction de l'**interface web** de CodiDev. Il décrit le produit, les
écrans, le modèle de données et les contraintes. Le prompt prêt à coller pour un générateur
d'application (Lovable) est dans [`PROMPT_LOVABLE.md`](PROMPT_LOVABLE.md).

> Rappel de doctrine, valable aussi pour l'interface : **un résultat non vérifié n'est jamais
> présenté comme terminé**. L'interface ne doit jamais afficher un statut de succès qu'elle ne
> peut pas prouver par une donnée affichée à l'écran.

---

## 1. Le produit en une phrase

Un **poste de pilotage** pour lire, comprendre et suivre un agent d'ingénierie logicielle :
sa définition, ses compétences, ses exécutions, ses preuves et sa mémoire — sans jamais
exposer un secret.

CodiDev est **un agent indépendant** : aucune plateforme, aucun orchestrateur, aucune
identité externe. Son exécution produit des **artefacts** (fichiers) ; l'interface les rend
lisibles et navigables.

## 2. Utilisateurs

| Profil | Ce qu'il vient chercher |
|---|---|
| **Propriétaire / lead technique** | voir ce que l'agent a fait, avec quelle preuve, et ce qui reste ouvert |
| **Ingénieur** | consulter la définition (profil, prompt, compétences), rejouer les règles, vérifier l'état du dépôt |
| **Étudiant / apprenant** | comprendre comment un agent gouverné est construit et ce qu'on exige de lui |

## 3. Périmètre — ce que l'interface FAIT

1. **Voir la définition de l'agent** : identité, mission, modèle, outils, permissions, Human
   Gate, interdits, version.
2. **Explorer la bibliothèque de compétences** : 15 compétences normatives, texte complet,
   provenance, domaine associé.
3. **Lire les capacités** : 19 capacités réparties en 3 spécialités, avec la compétence et la
   **preuve attendue** pour chacune.
4. **Suivre les exécutions** : chaque opération avec son statut (`EXECUTED`, `NOT_EXECUTED`,
   `FAILED`, `BLOCKED`, `VERIFIED`), ses horodatages, ses commandes, ses fichiers créés/vérifiés.
5. **Afficher les preuves** : journal `evidence.json` lisible, filtrable, avec le détail des
   commandes réellement exécutées.
6. **Lire la mémoire** : entrées append-only par catégorie (`DECISION`, `CONVENTION`,
   `KNOWN-ISSUE`, `SECURITY-FINDING`, `ARCHITECTURE`, `DEPENDENCY`).
7. **Consulter l'état du dépôt** : résultat des contrôles (`verifier_depot.py`, suite de tests),
   version, changelog, points ouverts.

## 4. Hors périmètre (à ne pas construire ici)

- **Aucun moteur d'exécution** : l'interface lit et présente, elle n'exécute pas l'agent.
- **Aucun secret, jamais** : ni clé, ni jeton, ni `.env` — l'interface n'affiche que des
  indicateurs de présence (« présente », « non affichée »).
- **Aucune authentification** dans la première version (démo interne).
- **Aucun statut inventé** : si une donnée manque, l'écran affiche `UNKNOWN` / « non
  vérifiable » plutôt qu'une valeur plausible.

## 5. Écrans

### 5.1 Tableau de bord
- Bandeau : nom de l'agent, version, modèle, nombre de capacités / compétences, état des
  derniers contrôles.
- Compteurs d'exécutions par statut (`VERIFIED`, `EXECUTED`, `FAILED`, `NOT_EXECUTED`).
- Dernières opérations (5 à 10) avec horodatage et statut.
- Points ouverts (liste, avec compteur).

### 5.2 Définition de l'agent
- Identité : nom, identifiant, rôle, langue, licence.
- Modèle et paramètres : modèle, température, tours maximum.
- Outils déclarés, avec leur état de disponibilité **constaté** (`AVAILABLE` / `UNAVAILABLE`).
- Permissions (READ/WRITE/EXECUTE autorisés ; DELETE/DEPLOY/SEND sous autorisation explicite).
- Human Gate : les 7 déclencheurs, présentés comme des règles, pas comme des options.
- Renvoi vers le prompt système (lecture, avec sommaire des sections).

### 5.3 Capacités
- 19 capacités, groupées par spécialité (Full-Stack 9 · Architecture 4 · DevSecOps 6).
- Recherche et filtre par spécialité.
- Pour chaque capacité : compétences normatives associées + **preuve attendue**.

### 5.4 Compétences
- Grille des 15 compétences (domaine, intitulé, résumé).
- Vue de détail : texte complet du `SKILL.md`, provenance (catalogue ECC, révision), domaine.

### 5.5 Exécutions & preuves
- Table des opérations : nom, statut, début, fin, outils utilisés.
- Vue de détail : commandes exécutées (bloc monospace copiable), fichiers créés, fichiers
  vérifiés, contrôles de sécurité, erreurs, avertissements.
- Filtres par statut et par outil ; recherche plein texte.
- Bandeau d'avertissement explicite quand une opération est `NOT_EXECUTED` ou `FAILED`.

### 5.6 Mémoire
- Liste chronologique (append-only) avec badge de catégorie et **source** de chaque entrée.
- Une entrée sans source est affichée `HYPOTHESIS` (jamais comme un fait).
- Filtre par catégorie ; recherche.

### 5.7 Qualité du dépôt
- Résultat des contrôles : `verifier_depot.py` (15 contrôles), suite de tests (11 tests),
  avec horodatage et issue.
- Version et entrées de changelog.
- Points ouverts et blocages.

## 6. Modèle de données (contrat)

L'interface consomme des fichiers du dépôt. Chaque écran doit pouvoir tourner sur des données
statiques (`public/data/*.json`) puis, plus tard, sur un backend local.

| Source | Contenu | Écran |
|---|---|---|
| `agent/codidev.json` | identité, modèle, outils, permissions, gouvernance | 5.2 |
| `agent/codidev.prompt.md` | prompt système (Markdown) | 5.2 |
| `docs/CAPACITES.md` | 19 capacités → compétences → preuves | 5.3 |
| `skills/<nom>/SKILL.md` | 15 compétences, texte complet | 5.4 |
| `evidence.json` | journal des opérations et preuves | 5.5 |
| `memory/MEMORY.md` | journal mémoire append-only | 5.6 |
| `RAPPORT_EXECUTION.json` | rapport d'exécution (statuts, tests, blocages) | 5.1 / 5.7 |
| `CHANGELOG.md` | historique des versions | 5.7 |

### Statuts (vocabulaire fermé, à respecter à l'écran)

`DRAFT` · `ANALYZING` · `PROPOSED` · `HYPOTHESIS` · `USER_VALIDATION_REQUIRED` · `VALIDATED` ·
`IN_PROGRESS` · `EXECUTED` · `VERIFIED` · `READY` · `BLOCKED` · `FAILED` · `NOT_EXECUTED` ·
`CANCELLED`

Codes visuels suggérés : `VERIFIED` et `EXECUTED` en vert ; `IN_PROGRESS` en bleu ;
`HYPOTHESIS` et `PROPOSED` en ambre ; `FAILED` et `BLOCKED` en rouge ; `NOT_EXECUTED` et
`UNKNOWN` en gris. **`READY` sans preuve est interdit** : l'interface ne doit pas le proposer.

## 7. Direction visuelle

- **Outil de développeur** : sombre, dense, lisible — pas de marketing, pas d'illustration.
- Typographie sobre ; **police monospace** pour les commandes, chemins, identifiants et
  horodatages ISO.
- Couleurs réservées au **sens** (statut, alerte), jamais décoratives.
- Densité maîtrisée : listes denses + panneaux de détail, plutôt que de grandes cartes vides.
- États vides explicites (« aucune opération enregistrée », « aucune entrée de mémoire ») —
  jamais un écran blanc inexpliqué.
- Accessibilité : contraste AA, navigation clavier, focus visible, libellés de formulaires,
  `aria-label` sur les icônes ; le statut ne doit jamais reposer sur la seule couleur (ajouter
  le libellé).

## 8. Navigation

```
Tableau de bord · Définition · Capacités · Compétences · Exécutions · Mémoire · Qualité
```

Barre latérale persistante (repliable), fil d'Ariane, thème sombre par défaut, aucune page
« en construction ».

## 9. Contraintes techniques

- Application **front-end seule** : React + TypeScript + Tailwind (stack Lovable par défaut).
- Données de démonstration **versionnées dans le dépôt** (`public/data/`), copiées depuis les
  fichiers ci-dessus ; aucune donnée inventée qui ne corresponde pas à un fichier réel.
- Composants réutilisables : `StatutBadge`, `TableOperation`, `PanneauDetail`, `CarteCapacite`,
  `EntreeMemoire`, `BlocCommande`.
- Aucun appel réseau vers un service externe. Aucune télémétrie.
- Le contenu de l'interface est en **français**.

## 10. Critères d'acceptation

1. Les sept écrans existent et sont accessibles depuis la navigation.
2. Les compteurs du tableau de bord correspondent aux données de `evidence.json` (vérifiables
   à l'œil, ligne à ligne).
3. Chaque opération affiche ses commandes réelles et son statut exact.
4. Aucun écran n'affiche de valeur de secret ; les secrets ne sont représentés que par
   « présente / non affichée ».
5. Une opération `NOT_EXECUTED` ou `FAILED` est visuellement distincte et jamais présentée
   comme un succès.
6. Aucune entrée de mémoire sans source n'est affichée comme un fait.
7. L'application build sans erreur ni avertissement bloquant.
