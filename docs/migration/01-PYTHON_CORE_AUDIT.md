# Audit du Core Python — inventaire et invariants

**Date :** 2026-10-02 · **Objet :** audit de l'implémentation Python avant migration TypeScript
**Méthode :** inventaire généré depuis le disque, invariants vérifiés dans le code et couverts par
des tests exécutés. Aucune affirmation sans commande.

---

## 1. Inventaire réel

```
31 fichiers Python · 4 250 lignes de cœur · 204 tests collectés
13 contrats JSON Schema · 2 dépendances d'exécution (jsonschema, rfc3339-validator)
```

| Module | Lignes | Responsabilité |
|---|---|---|
| `statuses.py` | 170 | Vocabulaires canoniques : statuts d'opération, états de tâche + table de transitions, classes de risque, sévérités, verdicts de gate et de politique, état d'exécution d'outil |
| `errors.py` | 104 | Hiérarchie d'erreurs, chacune portant un `OperationStatus` réel |
| `hashing.py` | 49 | JSON canonique, SHA-256, hachage chaîné (`prev_hash` estampillé dans le corps haché) |
| `ids.py` | 21 | Identifiants préfixés, horodatages UTC RFC 3339 |
| `journal.py` | 190 | Journal JSONL append-only, chaîné, caviardé à l'écriture, vérifiable (`BROKEN_LINK`, `HASH_MISMATCH`, `CONTRACT_VIOLATION`, `MISSING`) |
| `contracts/loader.py` | 126 | Chargement des schémas, registre hors ligne pour les `$ref` absolus, validation, extraction d'énumérations |
| `evidence/store.py` | 95 | Magasin de preuves append-only, API `record(...)`, `ValidationOutcome` |
| `audit/ledger.py` | 75 | Journal d'audit à séquence strictement croissante, attribuée par le journal |
| `security/secrets.py` | 492 | 16 règles de détection, entropie de Shannon, filtres de plausibilité, caviardage idempotent |
| `security/report.py` | 111 | `Finding`, `ToolRun`, `SecurityReport` (comptages, sévérité maximale, outils non exécutés) |
| `security/gate.py` | 163 | Politique sévérité → action, verdict `PASS`/`REVIEW`/`BLOCK`, codes de sortie 0/1/2 |
| `security/allowlist.py` | 144 | Exceptions revues : règle + chemin + justification + auteur + date, validées par contrat |
| `security/tools.py` | 255 | Adaptateurs `ruff`, `bandit`, `pip-audit` ; distinction `EXECUTED`/`NOT_EXECUTED`/`FAILED` |
| `context/engine.py` | 294 | 9 couches, provenance, 4 niveaux de confiance, isolation tenant, rendu déterministe |
| `planner/planner.py` | 342 | Plans versionnés, invariants d'ordre/dépendances/vérification/rollback, révision |
| `decision/engine.py` | 287 | Options, sélection déterministe, motifs de rejet, politique autoritaire, obligations |
| `task/engine.py` | 260 | Machine à états, journalisation des transitions, vérification obligatoire |
| `agent/request.py` | 58 | Demande caviardée, signaux structurés, tenant et acteur obligatoires |
| `agent/intent.py` | 143 | Intention structurée ; analyseur déterministe (aucune devinette du langage naturel) |
| `agent/core.py` | 376 | Cycle `analyze → plan → decide → tâche`, frontière d'exécution, journalisation |
| `cli.py` | 261 | `version`, `contracts`, `security`, `journal` |

## 2. Invariants portés par le code

Chaque invariant est listé avec le mécanisme qui le fait tenir et le test qui le prouve. **C'est
cette liste qui définit la réussite de la migration** : ce qui doit survivre n'est pas la forme du
code, c'est cette colonne.

### 2.1 Statuts et vérité

| # | Invariant | Mécanisme | Test |
|---|---|---|---|
| I-01 | Seul `VERIFIED` implique une opération terminée ; `EXECUTED` ne l'implique jamais | `OperationStatus.implies_completion()` | `test_statuses.py::test_seul_verified_implique_une_operation_terminee`, `::test_executed_nest_pas_un_succes` |
| I-02 | `BLOCKED` et `FAILED` sont des échecs, `WAITING_FOR_USER` n'en est pas un | `is_failure()` | `test_statuses.py::test_bloque_et_echoue_sont_des_echecs_attente_nen_est_pas_un` |
| I-03 | Aucun statut « succès » implicite n'existe dans le vocabulaire | Énumération fermée | `test_statuses.py::test_pas_de_verification_sans_preuve_de_verification` |

### 2.2 Risque, approbation, politique

| # | Invariant | Mécanisme | Test |
|---|---|---|---|
| I-04 | 5 classes de risque exigent une approbation humaine ; 3 n'en exigent pas | `RiskClass.requires_human_approval()` | `test_statuses.py::test_classes_risquees_exigent_une_approbation` |
| I-05 | `CRITICAL` et `HIGH` bloquent ; `MEDIUM` demande revue ; `LOW`/`INFO` informent | `security/gate.py` politique par défaut | `test_gate.py::test_critique_bloque`, `::test_moyenne_demande_une_revue_sans_bloquer` |
| I-06 | Un outil de sécurité absent vaut `NOT_EXECUTED`, jamais « vert » | `ToolRun.state` | `test_gate.py::test_outil_non_execute_est_signale_dans_le_verdict` |
| I-07 | Un verdict `DENY` interdit toute sélection d'option | `DecisionEngine.choose` | `test_decision.py::test_la_politique_qui_refuse_interdit_toute_selection` |
| I-08 | Toute option écartée porte son motif de rejet | `Option.rejected_because` | `test_decision.py::test_le_risque_le_plus_faible_est_retenu_et_lautre_est_motivee` |
| I-09 | Une action engageante reste gatée même si la politique l'autorise | obligation `approval:human-gate` | `test_decision.py::test_une_option_risquee_impose_le_human_gate` |
| I-10 | Une décision sans plan de vérification est refusée | `minItems: 1` du contrat `decision` | `test_decision.py::test_une_decision_sans_plan_de_verification_est_refusee` |

### 2.3 Tâches

| # | Invariant | Mécanisme | Test |
|---|---|---|---|
| I-11 | Seules les transitions de la table canonique sont permises | `is_allowed_transition` | `test_statuses.py::test_transitions_interdites`, `test_task.py::test_transition_non_autorisee_refusee` |
| I-12 | `VERIFIED` exige une vérification réellement exécutée **et** réussie | `VerificationRequiredError` | `test_task.py::test_verification_sans_preuve_refusee`, `::test_verification_echouee_refusee`, `::test_verification_non_executee_refusee` |
| I-13 | `COMPLETED` est inatteignable sans `VERIFIED` dans l'historique | `_was_verified()` | `test_task.py::test_transitions_interdites`, `::test_une_tache_terminee_nevolue_plus` |
| I-14 | Toute transition, création comprise, est journalisée (preuves + audit) | `_journal()` appelé aussi par `open()` | `test_task.py::test_les_transitions_sont_consignees_dans_les_preuves` |
| I-15 | Chaque entrée d'audit porte son tenant quand il est connu | `_record(tenant_id=...)` | `test_agent_core.py::test_tout_le_cycle_est_consigne_et_verifiable` |

### 2.4 Contexte

| # | Invariant | Mécanisme | Test |
|---|---|---|---|
| I-16 | Un élément d'un autre tenant est **refusé** à l'insertion | `ContextBundle.add` | `test_context.py::test_element_dun_autre_tenant_refuse` |
| I-17 | Un élément tenant-scopé sans tenant est refusé ; seules les règles `SYSTEM` en sont dispensées | `TENANT_FREE_LAYERS` | `test_context.py::test_element_tenant_scope_sans_tenant_refuse`, `::test_regle_systeme_sans_tenant_acceptee` |
| I-18 | Un élément sans provenance est refusé | `make_item` | `test_context.py::test_element_sans_provenance_refuse` |
| I-19 | Un contenu de projet est `UNTRUSTED` et le rendu l'expose | `TrustLevel` + `render()` | `test_context.py::test_rendu_expose_couche_confiance_et_provenance` |
| I-20 | La confiance est ordonnée : `UNTRUSTED < UNVERIFIED < VERIFIED < TRUSTED` | `trust_rank` | `test_context.py::test_confiance_ordonnee_et_non_implicite` |

### 2.5 Plans

| # | Invariant | Mécanisme | Test |
|---|---|---|---|
| I-21 | Ordre des étapes contigu à partir de 1, sans doublon | `invariant_violations` | `test_planner.py::test_les_etapes_sont_numerotees_dans_lordre` |
| I-22 | Une dépendance doit exister et viser une étape **antérieure** | `invariant_violations` | `test_planner.py::test_dependance_vers_une_etape_ulterieure_refusee` |
| I-23 | Chaque étape porte au moins un critère de vérification | contrat + invariants | `test_planner.py::test_une_etape_sans_critere_est_refusee` |
| I-24 | Une étape destructive ou de déploiement exige un rollback | `ROLLBACK_REQUIRED` | `test_planner.py::test_etape_destructive_sans_rollback_refusee` |
| I-25 | Les permissions sont **dérivées** des étapes, jamais déclarées | `Plan.permissions` | `test_planner.py::test_permissions_derivees_des_etapes` |
| I-26 | Une révision produit une nouvelle version qui déclare l'ancienne ; l'historique n'est pas réécrit | `Planner.revise` | `test_planner.py::test_revision_produit_une_nouvelle_version_sans_reecrire_lancienne` |

### 2.6 Preuves, audit, secrets

| # | Invariant | Mécanisme | Test |
|---|---|---|---|
| I-27 | Toute écriture de journal est chaînée et toute altération est détectable | `chained_hash`, `verify()` | `test_evidence.py::test_alteration_du_contenu_est_detectee`, `::test_suppression_dun_maillon_est_detectee`, `test_audit.py::test_saut_de_sequence_detecte` |
| I-28 | Aucun journal n'offre de réécriture ni de suppression | absence d'API | `test_evidence.py::test_le_journal_ne_reecrit_jamais` |
| I-29 | Tout contenu écrit est caviardé avant persistance | `redact_structure` à l'append | `test_evidence.py::test_secret_caviarde_avant_ecriture`, `test_audit.py::test_secret_caviarde_dans_l_audit` |
| I-30 | Le caviardage est idempotent : un texte caviardé n'est plus détecté | `contains_redaction_marker` | `test_secrets.py::test_caviardage_idempotent`, `::test_un_caviardage_nest_jamais_detection` |
| I-31 | Les expressions de code, gabarits et valeurs masquées ne sont pas des secrets | filtres de plausibilité | `test_secrets.py::test_valeur_de_faible_entropie_non_signalee`, `::test_valeur_exemple_non_signalee`, `::test_texte_ordinaire_non_signale` |
| I-32 | Une exception de sécurité qui ne couvre plus rien est un défaut | test dédié | `test_repo_integrity.py::test_aucun_secret_non_revu_dans_le_depot` |
| I-33 | Le détecteur n'est jamais désactivé : sans exception, l'exemple documentaire est détecté | test dédié | `test_repo_integrity.py::test_le_detecteur_signale_toujours_les_exemples_non_revus` |

### 2.7 Agent Core et frontière

| # | Invariant | Mécanisme | Test |
|---|---|---|---|
| I-34 | Sans signal d'intention, le cœur **refuse de planifier** et pose une question ouverte | `Analysis.is_determined` | `test_agent_core.py::test_analyse_sans_signal_laisse_lintention_indeterminee`, `::test_planification_refusee_sur_intention_indeterminee` |
| I-35 | Le cycle ne revendique jamais une exécution : statut `NOT_EXECUTED`, aucune preuve `VERIFIED` | `EXECUTION_BOUNDARY` | `test_agent_core.py::test_le_cycle_nominal_ne_revendique_aucune_execution` |
| I-36 | Le tenant et l'acteur sont obligatoires sur toute demande | `Request.__post_init__` | `test_agent_core.py::test_demande_sans_tenant_refusee`, `::test_demande_sans_acteur_refusee` |
| I-37 | Le cœur ne référence aucun emplacement de plateforme | test structurel | `test_repo_integrity.py::test_le_core_ne_reference_aucun_emplacement_de_plateforme` |
| I-38 | Le cœur n'importe rien hors bibliothèque standard et dépendances déclarées | test structurel | `test_repo_integrity.py::test_le_core_nimporte_aucun_runtime_externe` |

## 3. Contrats et énumérations

13 schémas JSON Schema 2020-12, **indépendants du langage** : ils migrent tels quels et deviennent
la source de vérité partagée entre les deux implémentations pendant la phase de parité.

| Contrat | Énumérations portées |
|---|---|
| `risk_class` | 8 classes de risque |
| `action`, `tool_request`, `policy_decision`, `approval` | classes de risque, acteurs, rôles, issues de politique |
| `evidence` | 6 statuts d'opération ; `passed⇒performed` encodé par `if/then` |
| `audit_record` | 8 classes de risque, 6 statuts |
| `task` | 13 états |
| `intent` | 9 catégories |
| `context_bundle` | 9 couches, 4 niveaux de confiance |
| `plan` | 5 statuts de plan, 8 classes de risque |
| `decision` | 3 issues de politique, 8 classes de risque |
| `security_allowlist` | — |

## 4. Risques identifiés pour la migration

| # | Risque | Gravité | Traitement |
|---|---|---|---|
| R-01 | **Perte d'invariant silencieuse** : une traduction « syntaxique » omet une garde (ex. `passed⇒performed`). | Élevé | Le test de parité ne compare pas du texte : il réexécute la même matrice de cas sur les deux implémentations. |
| R-02 | **Caviardage non idempotent en TS** : les `RegExp` de JavaScript n'ont pas les mêmes classes ni le même comportement Unicode que `re` (pas de `\p{...}` sans le drapeau `u`, quantificateurs gourmands différents). | Élevé | Porter les règles une par une avec les mêmes cas de test, plus un test dédié d'idempotence. |
| R-03 | **Hachage non identique** : l'ordre des clés et la sérialisation doivent être stables pour que les chaînes soient comparables entre les deux implémentations. | Élevé | Tests de parité croisés : le TS doit vérifier un journal produit par le Python et inversement. |
| R-04 | **Fuite de clé LLM** dans les journaux, preuves ou erreurs d'un provider. | Élevé | Configuration par environnement uniquement, aucune clé en test, caviardage appliqué aux preuves, tests dédiés. |
| R-05 | **Le LLM devient autorité** : un provider qui exécute une action proposée. | Élevé | La couche LLM ne reçoit jamais d'accès aux outils : elle rend du texte ou une proposition structurée, le cœur décide. |
| R-06 | Mélange des dépendances avec Hermes. | Moyen | Node.js dédié, `node_modules` local au projet, aucun import du runtime de construction. |
| R-07 | Deux implémentations concurrentes qui divergent. | Moyen | La branche de migration supprime le Python à la fin ; tant qu'il existe, la parité est testée à chaque exécution. |
| R-08 | Différences de typage faibles (`any`, `unknown`) masquant des invariants. | Moyen | `strict: true`, `noUncheckedIndexedAccess`, aucune exception de lint sans justification écrite. |

## 5. Ce que la migration ne doit **pas** préserver

- La structure exacte des modules : le découpage peut s'améliorer.
- La CLI Python (`cli.py`) : son équivalent Node sera un point d'entrée minimal, pas un objectif.
- L'API Python (`snake_case`, dataclasses) : remplacée par des types et interfaces idiomatiques.
- Les 204 tests tels quels : réécrits par comportement, pas par ligne ; les invariants de la
  section 2 doivent chacun avoir un test côté TypeScript.
