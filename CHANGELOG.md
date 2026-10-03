# Changelog — CodiDev

Toutes les modifications notables de ce dépôt sont consignées ici.
Format : [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) · Versionnage sémantique.

## [Non publié]

### Ajouté

- **Contrats injectables** : `registerContracts({ schemas, validators? })` fournit les contrats
  sans lecture disque (runtimes hébergés sans système de fichiers). `createContractAjv(code?)`
  expose l'instance Ajv du cœur pour produire des validateurs précompilés (Ajv standalone) hors
  ligne, là où la génération de code à l'exécution est interdite.
- **`MemoryJournalSink`** : support de journal en mémoire pour les tests isolés.
- **`CodiDevCore`** accepte `evidenceSink` / `auditSink` (`JournalSink`). Sans eux, les journaux
  restent des fichiers dans `workspaceDir` (comportement inchangé).

### Modifié

- `SCHEMA_DIR` ne lève plus d'erreur au chargement du module lorsqu'aucun répertoire de contrats
  n'existe : il vaut `''` et la première lecture disque lève `ContractError`.

## [0.2.0] — Phase 1 : Agent Core

Construction du cerveau de CodiDev : contexte, planification, décision, tâches, coordination.
Le cœur reste du **code** — aucune API, aucun service (ADR-0009).

### Ajouté

- **Context Engine** (`codidev.context`) : 9 couches de contexte, provenance obligatoire,
  classification de confiance (`TRUSTED`/`VERIFIED`/`UNVERIFIED`/`UNTRUSTED`), rendu déterministe
  exposant couche, confiance et source, et **isolation tenant vérifiée à l'insertion** : un
  élément d'un autre tenant est refusé, un élément tenant-scopé sans tenant aussi.
- **Planner** (`codidev.planner`) : plan versionné (objectif, exigences, hypothèses, dépendances,
  étapes ordonnées, risques, permissions, critères de vérification, rollback). Invariants
  contrôlés par code : ordre contigu, dépendances antérieures existantes, critère de vérification
  par étape, rollback obligatoire pour les étapes destructives/déploiement, permissions dérivées
  des étapes. Révision = nouvelle version qui déclare celle qu'elle remplace, sans réécriture.
- **Decision Engine** (`codidev.decision`) : options examinées, sélection déterministe (risque le
  plus faible, puis réversibilité), motifs de rejet pour chaque option écartée, politique
  autoritaire — un verdict `DENY` interdit toute sélection — et obligation `approval:human-gate`
  dès qu'une approbation est requise ou qu'une classe de risque l'impose.
- **Task Engine** (`codidev.task`) : machine à états adossée à la table canonique, historique
  observable, refus des transitions illégales, **vérification réelle obligatoire** avant
  `VERIFIED`, et `COMPLETED` inatteignable sans `VERIFIED` dans l'historique.
- **Agent Core** (`codidev.agent`) : `analyze` → `plan` → `decide` → tâche, avec `Request`
  caviardée, analyse d'intention **structurée** (les signaux manquants deviennent des questions
  ouvertes, jamais des suppositions) et journalisation complète dans les preuves et l'audit.
- **4 contrats** supplémentaires : `intent`, `context_bundle`, `plan`, `decision` (13 au total).

### Frontière explicite

- `AgentCore.run()` s'arrête à la **frontière d'exécution** : statut `NOT_EXECUTED`, tâche gelée
  à `PROPOSED`, `WAITING_FOR_USER` ou `BLOCKED` selon la politique. Aucun outil n'est exécuté et
  aucune exécution n'est revendiquée : l'Execution Engine appartient à une phase ultérieure.
- Le cœur ne référence aucun emplacement de plateforme ; un test le vérifie (ADR-0009).

### Modifié

- **Structure du dépôt** : le cœur devient un paquet autonome sous `core/`
  (`core/pyproject.toml`, `core/uv.lock`, `core/src/codidev/`, `core/tests/`, `core/LICENSE`,
  `core/README.md`), installable indépendamment. Les scripts de projet restent à la racine et
  opèrent sur `core/`.

### Documentation

- `docs/CORE_PLATFORM_BOUNDARY.md` : frontière cœur / plateforme, surfaces de contact, et
  **décisions d'intégration en attente** (traversée de frontière de langage, persistance des
  journaux, authentification, propriété de l'approbation).
- `docs/adr/ADR-0009-coeur-paquet-logiciel-et-frontiere-plateforme.md`
- `docs/PHASE_1_REPORT.md` : preuves d'exécution de la phase.

---

## [0.1.0] — Phase 0 : Foundation

Première phase de construction du cœur CodiDev, conforme à
`docs/construction/CODIDEV_DOCUMENTATION/`. Rien n'est déclaré terminé sans exécution réelle.

### Ajouté

- **Vocabulaires canoniques** (`codidev.statuses`) : statuts d'opération, états de tâche et
  table des transitions autorisées, classes de risque, sévérités, verdicts de gate et de
  politique. `OperationStatus.implies_completion` n'est vraie que pour `VERIFIED` : une action
  exécutée n'est jamais une action réussie.
- **8 contrats JSON Schema 2020-12** (`codidev.contracts`) : `action`, `tool_request`,
  `risk_class`, `policy_decision`, `approval`, `evidence`, `audit_record`, `task`. Résolution
  hors ligne des `$ref` via un registre local.
- **Magasin de preuves** (`codidev.evidence`) : append-only, chaîné par SHA-256, validé par
  contrat, caviardé avant écriture.
- **Journal d'audit** (`codidev.audit`) : append-only, chaîné, à séquence strictement croissante,
  avec vérification de la continuité.
- **Détection de secrets** (`codidev.security.secrets`) : 16 règles (clés privées, jetons GitHub,
  AWS, Google, Slack, Stripe, Supabase, URL de base de données avec mot de passe, JWT, jetons
  porteurs, affectations à nom évocateur) plus filtrage par entropie, et caviardage récursif.
- **Security Gate** (`codidev.security.gate`) : politique par défaut `CRITICAL → BLOCK`,
  `HIGH → BLOCK`, `MEDIUM → REVIEW`, `LOW → WARNING`, `INFO → INFORMATIONAL`, avec codes de
  sortie 0/1/2 et politique `strict` disponible.
- **Adaptateurs d'outils** (`codidev.security.tools`) : `ruff`, `bandit`, `pip-audit`, avec
  distinction explicite `EXECUTED` / `NOT_EXECUTED` / `FAILED`.
- **Interface en ligne de commande** (`codidev`) : `contracts`, `security`, `journal`, `version`.
- **Tests réels** (`tests/`) : contrats, chaînage, altération détectée, caviardage, gate,
  adaptateurs, cohérence entre les schémas et les vocabulaires Python.
- **ADR-0001 à ADR-0006** : dépôt unique, séparation construction/runtime, baseline de sécurité,
  contrats comme frontière, journalisation chaînée, isolation d'exécution.

### Modifié

- **Restructuration du dépôt.** La définition d'agent v3.1.0 qui occupait la racine est
  déplacée **intégralement et sans suppression** sous `legacy/agent-definition-v3/`. Ses tests
  (15) et son vérificateur (15 contrôles) passent depuis leur nouvel emplacement ; cette
  exécution est la preuve que la préservation est réelle et non déclarative.
- Le coeur CodiDev occupe désormais la racine du dépôt conformément à ADR-0001 et ADR-0002.

### Sécurité

- **Vulnérabilité réelle détectée et corrigée** : `pip-audit` a signalé `PYSEC-2026-1845` sur
  `pytest==9.0.1` ; dépendance portée à `9.0.3`. Le gate a bloqué avant correction.
- **Exceptions de sécurité revues** (`.codidev-security-allowlist.json`) : règle, chemin,
  justification, auteur et date de revue. Une constatation couverte quitte le verdict, jamais le
  rapport ; une exception qui ne couvre plus rien fait échouer un test (ADR-0007).
- Filtrage par entropie et par nature de valeur : les expressions de code, les gabarits
  d'interpolation et les mots de passe masqués ne sont plus signalés.
- Caviardage **idempotent** : un texte déjà caviardé n'est plus jamais détecté comme secret.

### Notes

- Aucun push n'a été effectué au moment de cette entrée : le contrôle final revient au
  propriétaire du dépôt.
- Toolchain isolée : CPython 3.12 géré par `uv`, environnement dans `~/.local/share/codidev/`,
  dépendances épinglées dans `pyproject.toml` et verrouillées dans `uv.lock`.
- 127 tests ; gate de sécurité `PASS` ; lint et format verts. Preuves d'exécution :
  `docs/PHASE_0_REPORT.md`.
