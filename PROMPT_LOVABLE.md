# Prompt à coller dans Lovable

Ce prompt est prêt à l'emploi. Le dépôt GitHub contient les données réelles à afficher :
`https://github.com/Elfried002/codidev`.

---

## Prompt

```
Construis une application web React + TypeScript + Tailwind : le poste de pilotage de
« CodiDev », un agent autonome d'ingénierie logicielle. Interface en français, thème sombre,
sobre et dense, style outil de développeur (pas de marketing, pas d'illustrations).

Contexte et données : le dépôt GitHub https://github.com/Elfried002/codidev est la source de
vérité. Lis d'abord INTERFACE_WEB.md (spécification produit complète) puis récupère les
données depuis : agent/codidev.json (identité, modèle, outils, permissions, gouvernance),
docs/CAPACITES.md (19 capacités → compétences → preuves), skills/*/SKILL.md (15 compétences),
evidence.json (journal des opérations et preuves), memory/MEMORY.md (mémoire append-only),
RAPPORT_EXECUTION.json (rapport d'exécution), CHANGELOG.md (versions). Copie ces données dans
public/data/*.json et n'affiche que des valeurs présentes dans ces fichiers : si une donnée
manque, affiche « UNKNOWN » ou « non vérifiable », jamais une valeur plausible.

Sept écrans, avec barre latérale persistante et fil d'Ariane :
1. Tableau de bord — identité de l'agent, version, modèle, compteurs d'opérations par statut,
   dernières opérations, points ouverts.
2. Définition — identité, paramètres du modèle, outils déclarés avec leur disponibilité
   constatée (AVAILABLE / UNAVAILABLE), permissions (READ/WRITE/EXECUTE autorisés ;
   DELETE/DEPLOY/SEND sous autorisation explicite), les 7 déclencheurs de Human Gate, et
   lecture du prompt système par sections.
3. Capacités — les 19 capacités groupées en 3 spécialités (Full-Stack 9, Architecture 4,
   DevSecOps 6), avec recherche et, pour chacune, les compétences associées et la preuve
   attendue.
4. Compétences — grille des 15 compétences, vue de détail avec le texte complet et la
   provenance (catalogue ECC, révision).
5. Exécutions & preuves — table des opérations (nom, statut, début, fin, outils), vue de
   détail avec les commandes réellement exécutées en monospace copiable, fichiers créés,
   fichiers vérifiés, contrôles de sécurité, erreurs, avertissements ; filtres par statut et
   par outil, recherche.
6. Mémoire — journal chronologique avec badge de catégorie (DECISION, CONVENTION,
   KNOWN-ISSUE, SECURITY-FINDING, ARCHITECTURE, DEPENDENCY) et source de chaque entrée ;
   une entrée sans source doit être affichée comme HYPOTHESIS, jamais comme un fait.
7. Qualité du dépôt — résultat des contrôles (15 contrôles de cohérence, 11 tests), version et
   changelog, points ouverts et blocages.

Règles impératives :
- Règle de vérité : « un résultat non vérifié n'est jamais présenté comme terminé ». Ne jamais
  afficher un statut de succès qui ne corresponde pas à une donnée du dépôt.
- Statuts à utiliser tels quels : DRAFT, ANALYZING, PROPOSED, HYPOTHESIS,
  USER_VALIDATION_REQUIRED, VALIDATED, IN_PROGRESS, EXECUTED, VERIFIED, READY, BLOCKED,
  FAILED, NOT_EXECUTED, CANCELLED. Codes couleur : vert = VERIFIED/EXECUTED, bleu =
  IN_PROGRESS, ambre = HYPOTHESIS/PROPOSED, rouge = FAILED/BLOCKED, gris = NOT_EXECUTED/
  UNKNOWN. Le statut ne doit jamais reposer sur la seule couleur : toujours le libellé.
- Ne jamais afficher de secret : aucune clé, aucun jeton, aucun .env. Les secrets ne sont
  représentés que par « présente » ou « non affichée ».
- Aucun appel réseau externe, aucune télémétrie, aucun moteur d'exécution : l'application lit
  et présente, elle n'exécute rien.
- Commandes, chemins, identifiants et horodatages en police monospace.
- Accessibilité AA : contraste, navigation clavier, focus visible, aria-label sur les icônes.
- États vides explicites, jamais d'écran blanc.

Commence par le tableau de bord et la définition, puis les écrans de données. Le build doit
passer sans erreur.
```

---

## Après la première génération

- Vérifier le critère 2 de `INTERFACE_WEB.md` §10 : les compteurs affichés doivent correspondre
  ligne à ligne à `evidence.json`.
- Faire relire l'écran « Exécutions & preuves » : c'est celui qui porte la doctrine de preuve
  (statuts exacts, commandes réelles, distinction succès/échec).
- Pour brancher plus tard l'agent réellement : exposer `evidence.json`, `memory/MEMORY.md` et
  `RAPPORT_EXECUTION.json` en lecture seule via une petite API locale — sans jamais exposer de
  secret à l'interface.
