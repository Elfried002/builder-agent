# Changelog — CodiDev

Toutes les modifications notables de ce dépôt sont consignées ici.
Format : [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) · Versionnage sémantique.

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
