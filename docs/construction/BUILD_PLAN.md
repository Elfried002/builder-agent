# CodiDev — Build Plan

**Date :** 2026-10-02
**Auteur :** Hermes (environnement de construction)
**Objet :** plan de construction de l'architecture décrite par `docs/construction/CODIDEV_DOCUMENTATION/`
**Statut :** **EN ATTENTE D'APPROBATION** — aucune implémentation ne démarre avant validation des décisions D1→D5
**Prérequis satisfaits :** bootstrap serveur, Git 2.43.0, GitHub CLI 2.102.0 authentifié (`Elfried002`, admin/push), dépôt cloné, corpus lu intégralement.

---

## 1. Décisions à trancher avant la Phase 1 (Human Gate — décision d'architecture majeure)

### D1 — Langage du cœur agentique
| Option | Avantages | Inconvénients |
|---|---|---|
| **A. Python 3.12 (isolé via uv)** *(recommandé)* | Déjà présent sur le serveur ; SDK MCP mature ; écosystème tests/scanners (pytest, ruff, bandit, pip-audit, detect-secrets) ; concision pour les moteurs ; pas de build step | Moins direct pour la future UI Next.js |
| B. TypeScript / Node | Aligne cœur et produit SaaS (Supabase JS, Vercel) | Toolchain Hermes-managée (couplage R2) ; build step ; écosystème sécurité moins riche |

**Recommandation : A**, avec des **contrats d'interface indépendants du langage** (JSON Schema) pour que la couche plateforme (UI/Next.js) puisse être ajoutée plus tard sans réécriture.

### D2 — Restructuration du dépôt
Le dépôt actuel est une définition d'agent (spécification) ; l'architecture cible est un produit logiciel.
- **Option A** *(recommandé)* : déplacer la définition existante sous `legacy/agent-definition-v3/` (préservée, intacte, non supprimée), et faire du cœur CodiDev la racine (`src/codidev/`, `tests/`, `docs/`).
- Option B : tout sous `core/` en cohabitation avec les fichiers actuels à la racine.
- Option C : nouveau dépôt séparé — **exclu** : ADR-001 impose un dépôt unique.

### D3 — Toolchain isolée (contrainte R1/R2)
`sudo` exige un mot de passe → pas d'`apt`. **Recommandé :** Python isolé géré par **uv** dans `~/.local/share/codidev/venv` (hors `~/.hermes/tools`), dépendances épinglées + lockfile commité. Node local via `corepack` si une UI devient nécessaire. Aucun paquet système sans que l'utilisateur exécute lui-même la commande.

### D4 — Isolation d'exécution (contrainte R3)
- **Option A** : installer Docker → nécessite `sudo` (mot de passe, action utilisateur) + ~2 Go de RAM en fonctionnement. Isolation forte.
- **Option B** *(recommandé pour la Phase 3)* : isolation **best-effort** native — répertoire workspace cloisonné, `rlimits` (CPU/RAM/PIDs/disque), réseau coupé par défaut, `subprocess` sans shell, listes blanches de commandes — **explicitement documentée comme non équivalente à du conteneur**.
- Option C : A puis B en repli.
> Règle : aucune isolation ne sera *déclarée* plus forte qu'elle ne l'est réellement.

### D5 — Stratégie Git (simple, documentée, réversible)
`main` = branche unique stable ; branches courtes `phase/0N-<nom>` ; merge après : tests verts → scan secrets → SAST → revue du diff. Pas de workflow complexe inventé. Chaque merge = un incrément cohérent. **Push uniquement après vérification distante (relecture du sha).**

---

## 2. Ordre de construction (corpus `14_HERMES_CONSTRUCTION/01_BUILD_ORDER.md`)

Chaque phase suit : **Read → Analyze → Plan → Implement → Test → Security Check → Verify → Document**, et se termine par un commit cohérent + preuve.

### Phase 0 — Foundation
- Restructuration D2 ; toolchain D3 ; `pyproject.toml` épinglé + lockfile ; arborescence modulaire ; configuration typée (env, jamais de secret en dur).
- **Contrats** JSON Schema : Action, ToolRequest, RiskClass, PolicyDecision, Approval, Evidence, AuditRecord, TaskState.
- Journal **Evidence** structuré (+ validateur de schéma) et **Audit**.
- **Security baseline** : scanner de secrets (bloquant), lint, SAST, SCA.
- Harnais de tests (unit + intégration) et `Makefile`/scripts de vérification reproductibles.
- ADR-001…00N consignant D1→D5 et la migration du dépôt existant.
- **Sortie :** squelette réel, contracts versionnés, gate qui échoue vraiment, 100 % vert. Aucune capacité factice.

### Phase 1 — Agent Core
`Context Engine` (couches SYSTEM→LEARNED_KNOWLEDGE, provenance + niveau de confiance), `Planner` (objectif, hypothèses, étapes, risques, critères de vérification, rollback), `Decision Engine` (options → risque → politique → décision tracée, sans chain-of-thought privé), `Task Engine` (machine à états DRAFT→COMPLETED/CANCELLED, transitions observables).
- **Tests :** transitions illégales rejetées, contexte cross-tenant interdit, traçabilité des décisions.

### Phase 2 — Execution
`Tool Router` comme **frontière de sécurité** : Tool Request → Identity → Tenant → Resource Scope → Risk → Policy → Approval → Tool → Evidence. Classes READ / LOW_WRITE / WRITE / SENSITIVE_WRITE / DESTRUCTIVE / EXTERNAL_SIDE_EFFECT / DEPLOYMENT / SECURITY_SENSITIVE. `Workspace` (D4), `Execution Engine` (aucun chemin LLM→outil non contrôlé).
- **Tests :** tentative de contournement de politique, action destructive sans approbation → BLOCKED, sortie d'erreur ≠ succès.

### Phase 3 — Engineering (Project / Git)
`Project Engine` (détection langage/framework/PM/build/DB/CI au lieu de supposition), `Git Engine` (status/diff/branch/stage/commit/push encadrés : test → scan secrets → SAST → gate → approbation → commit → push).
- **Tests :** refus de push si secret, refus de push si tests rouges, vérification distante obligatoire.

### Phase 4 — Security
Architecture sécurité complète, threat model outillé, `Code Scanning` (secrets, SAST, SCA, config, IaC, conteneurs), **Security Gate** (CRITICAL→BLOCK, HIGH→BLOCK/REVIEW, MEDIUM→REVIEW, LOW→WARNING), gestion des secrets, **self-protection de l'agent** (injection, poisoning, agency excessive).
- **Tests :** plan de sécurité `12_TESTING_QUALITY/01` — injection directe/indirecte (README, commentaires), métadonnées de paquet malveillantes, sortie MCP malveillante, fuite de secret, appel d'outil non autorisé, action destructive sans approbation.

### Phase 5 — Connectors
Interface `Connector` générique (Connect→Authenticate→Authorize→Test→Enable→Use→Disable→Revoke), puis **GitHub → Supabase → Vercel**. Credentials hors dépôt, scopes minimaux, redaction dans logs et preuves.
- **Tests :** connecteur désactivé inutilisable, scope dépassé rejeté, redaction effective.

### Phase 6 — Memory & Learning
`Memory Architecture` (scopes GLOBAL→SESSION, catégories DECISION…FEEDBACK, jamais de secret), provenance, résolution de conflits (instruction explicite courante > préférence explicite récente > préférence tenant confirmée > convention projet > historique > défaut global), `Learning Engine` (observation→preuve→candidat→évaluation→activation→version→mesure→rollback), `Preference Engine`, **Skill Engine dynamique** (skills = conseil, jamais autorité), versioning + rollback.
- **Tests :** plan `12_TESTING_QUALITY/02` — isolation tenant de l'apprentissage, priorité au feedback explicite, non-escalade de permission par une skill, rollback d'une skill dégradée.

### Phase 7 — Platform contracts
Contrats d'interface de la plateforme : entités Supabase (users→evaluations), RLS multi-tenant, rôles PLATFORM_ADMIN→VIEWER, surfaces UX (Chat/Projects/Tasks/Files/Connectors/Deployments/Activity/Settings) et Admin Cockpit — **contrats et schémas**, pas d'implémentation UI prématurée.

### Phase 8 — Hardening
Observabilité, gestion d'erreurs (NOT_EXECUTED/BLOCKED/FAILED/WAITING_FOR_USER/EXECUTED/VERIFIED), limites de ressources et quotas, audit inaltérable, tests de charge, puis **démonstration end-to-end exigée** (`14_HERMES_CONSTRUCTION/04_REQUIRED_DEMO.md`) : Tenant A construit un dashboard SaaS sur la boucle complète, un second projet démontre les préférences apprises, Tenant B ne reçoit rien de A.

---

## 3. Definition of Done (corpus `14_HERMES_CONSTRUCTION/03`)

Aucun sous-système n'est déclaré terminé sans : exécution réelle, plan, politique, sandbox, moteurs projet/Git, tests, scanner + gate de sécurité, preuves, connecteurs, mémoire, isolation tenant, apprentissage, skills dynamiques, versioning/rollback, défenses poisoning et injection, protection des secrets, audit, observabilité, démonstration end-to-end et documentation.

## 4. Règles de conduite appliquées en permanence

- Preuve > affirmation ; aucune réussite déclarée sans preuve ; aucun échec converti en succès.
- Aucune capacité factice, aucun contournement de politique, aucune skill traitée comme autorité.
- Aucun secret dans le dépôt, la mémoire, les skills, les logs, les preuves ou Telegram.
- Aucune installation sans approbation ; aucun push sans vérification distante du commit.
- Aucune modification de l'environnement Hermes, des services existants, du pare-feu ou du reverse proxy.

## 5. Prochaine action demandée

Valider **D1 → D5** (ou les corriger). Dès validation : démarrer la **Phase 0 — Foundation** et livrer le premier incrément vérifié (squelette + contrats + sécurité baseline + tests verts), sans push tant que le gate n'est pas vert et le plan approuvé.
