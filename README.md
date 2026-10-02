# CodiDev

CodiDev est un système d'ingénierie logicielle agentique : comprendre une demande, planifier le
travail, l'exécuter par des outils contrôlés, vérifier le résultat, le sécuriser, déployer les
projets autorisés et apprendre de l'expérience validée.

Boucle cœur : **Understand → Plan → Execute → Verify → Learn → Adapt → Improve**

- Spécification de référence (opposable) : [`docs/construction/CODIDEV_DOCUMENTATION/`](docs/construction/CODIDEV_DOCUMENTATION/)
- État réel du dépôt avant construction : [`docs/construction/CONSTRUCTION_ASSESSMENT.md`](docs/construction/CONSTRUCTION_ASSESSMENT.md)
- Plan de construction : [`docs/construction/BUILD_PLAN.md`](docs/construction/BUILD_PLAN.md)
- Rapport de Phase 0 et preuves d'exécution : [`docs/PHASE_0_REPORT.md`](docs/PHASE_0_REPORT.md)
- Décisions d'architecture : [`docs/adr/`](docs/adr/)
- Définition historique (agent v3.x, conservée, hors service) : [`legacy/agent-definition-v3/`](legacy/agent-definition-v3/)

## État : Phase 0 — Foundation

Ce dépôt contient le **cœur agentique** en construction. La Phase 0 livre ce qui est réellement
exécutable et vérifiable aujourd'hui, et rien de plus :

| Livrable Phase 0 | État |
|---|---|
| Vocabulaires canoniques (statuts, états de tâche, classes de risque, sévérités) | implémenté |
| 9 contrats JSON Schema (Action, ToolRequest, RiskClass, PolicyDecision, Approval, Evidence, AuditRecord, Task, SecurityAllowlist) | implémenté |
| Magasin de preuves append-only, chaîné par SHA-256, caviardé | implémenté |
| Journal d'audit append-only, chaîné et séquencé | implémenté |
| Détection de secrets (16 règles) + caviardage idempotent | implémenté |
| Security Gate (CRITICAL/HIGH → BLOCK) avec codes de sortie | implémenté |
| Exceptions de sécurité revues et traçables (ADR-0007) | implémenté |
| Adaptateurs SAST/SCA/lint (bandit, pip-audit, ruff) | implémenté |
| Interface en ligne de commande | implémenté |
| Tests | 127 tests réels |
| Agent Core, Execution, Connectors, Memory/Learning, plateforme | **Phases 1 à 8 — non commencées** |

Aucun module ne simule une capacité non implémentée : les sous-systèmes des phases suivantes
n'existent pas encore dans ce dépôt.

## Prérequis

- Python **3.12** (version isolée gérée par `uv`, hors de tout environnement tiers)
- `uv` pour créer l'environnement et reproduire les dépendances depuis `uv.lock`

Aucune dépendance système n'est requise. Aucun accès réseau n'est nécessaire pour valider les
contrats, écrire des preuves ou vérifier un journal.

## Installation de l'environnement

```bash
scripts/bootstrap_env.sh        # crée/rafraîchit l'environnement isolé, hors du dépôt
```

L'environnement est créé dans `~/.local/share/codidev/venv` et n'est jamais versionné.

## Utilisation

```bash
# Contrats
codidev contracts list
codidev contracts show evidence
codidev contracts validate evidence mon-document.json

# Sécurité : scan complet + verdict du gate (0 = PASS, 1 = REVIEW, 2 = BLOCK)
codidev security scan .
codidev security scan src/ --policy strict --json "$HOME/.local/share/codidev/artifacts/rapport.json"
codidev security secrets .
codidev security secrets . --no-allowlist   # ignore les exceptions revues, montre tout

# Journaux : intégrité de la chaîne de hachage
codidev journal verify artifacts/preuves.jsonl --contract evidence
codidev journal verify artifacts/audit.jsonl --contract audit_record
```

## Vérifier le dépôt

```bash
scripts/verify.sh          # lint, SAST, SCA, scan de secrets, tests, gate de sécurité
```

Le script échoue si un contrôle échoue. Un outil de sécurité absent est signalé comme
`NOT_EXECUTED` et n'est jamais compté comme un contrôle réussi.

## Exceptions de sécurité

Un scan peut légitimement rencontrer du bruit : documentations contenant des identifiants de
démonstration, exemples de configuration. La réponse n'est pas de désactiver une règle, mais de
déclarer une exception **revue, datée et justifiée** dans `.codidev-security-allowlist.json`
(ADR-0007). Une exception retire la constatation du verdict, jamais du rapport.

## Règles opposables

1. **Preuve sur affirmation** — un résultat non vérifié n'est jamais présenté comme terminé.
2. **Aucun secret** dans le dépôt, la mémoire, les journaux, les preuves ou les sorties console.
3. **Aucun contournement de politique** — le modèle propose, la politique décide.
4. **Aucun élargissement silencieux de périmètre**.
5. **Aucune capacité factice** — un module absent n'est pas simulé.

## Licence

MIT — voir [`LICENSE`](LICENSE).
