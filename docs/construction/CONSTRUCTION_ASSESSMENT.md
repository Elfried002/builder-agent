# CodiDev — Construction Assessment

**Date :** 2026-10-02
**Auteur :** Hermes (environnement de construction)
**Référence :** `docs/construction/CODIDEV_DOCUMENTATION/` (corpus reçu, 83 fichiers, 15 sections 00→14)
**Statut :** ÉVALUATION — aucune ligne de code CodiDev écrite à ce stade

---

## 1. Environnement serveur (constaté, pas supposé)

| Élément | Valeur constatée | Preuve |
|---|---|---|
| OS | Ubuntu 24.04.5 LTS (noble), kernel 6.8.0-142 | `cat /etc/os-release`, `uname -a` |
| CPU / RAM | 4 vCPU / 7.8 Gi (6.6 dispo) | `nproc`, `free -h` |
| Disque | 96 Go, 78 Go libres (20 % utilisé) | `df -h /` |
| Utilisateur | `babayaga` (uid 1001, groupe `sudo`) | `id` |
| **sudo** | **mot de passe requis** (`sudo -n true` → échec) | test réel |
| Réseau | github.com HTTP 200, 93 ms | `curl -w` |
| Git | 2.43.0 | `git --version` |
| GitHub CLI | 2.102.0 | `gh --version` |
| Auth GitHub | **VERIFIED** — compte `Elfried002` | `gh auth status` |
| Scopes du jeton | `gist`, `read:org`, `repo`, `workflow` | `gh auth status` |
| Python | 3.14.7 (managé par Hermes) + 3.12.3 système (sans `pip`) | `python3 --version` |
| uv | 0.12.3 (userland, Hermes) | `uv --version` |
| Node / npm | 26.7.0 / 11.19.0 (managés par Hermes) | `node -v`, `npm -v` |
| Divers | ripgrep 15.2.0, ffmpeg 9.0.1, chromium, agent-browser | `~/.hermes/tools/` |
| **Absents** | **Docker, psql, Supabase CLI, Vercel CLI, unzip, pip système** | `which` → rien |

## 2. Accès au dépôt (constaté)

| Contrôle | Résultat |
|---|---|
| Dépôt | `github.com/Elfried002/codidev` — PUBLIC, création 2026-09-24, branche par défaut `main` |
| Permissions | `admin: true, push: true, maintain: true` |
| Dernier push distant | 2026-10-02T12:36:41Z (`193f31a` — « Journal de preuves et rapport d'execution ») |
| Clone local | `/home/babayaga/codidev` — arbre propre, aligné sur `origin/main` |
| Branches | `main` uniquement (aucune branche distante secondaire) |
| Commits | 8 au total, tous du 2026-10-02 |
| Contenu | 47 fichiers suivis, 544 Ko — **34 `.md`, 5 `.py`, 5 `.json`, 1 `.txt`, LICENSE, .gitignore** |
| Secrets versionnés | aucun (vérifié par `scripts/verifier_depot.py`) |

**Vérification d'exécution réelle (faite sur le serveur) :**
- `python3 -m unittest discover -s tests -v` → **15 tests, OK, 0 échec**
- `python3 scripts/verifier_depot.py` → **15/15 contrôles verts, 0 échec**

## 3. Nature réelle du dépôt actuel

Le dépôt contient **une définition d'agent hébergé par Hermes**, pas CodiDev.

- `agent/codidev.json` + `agent/codidev.prompt.md` — profil exécutable (modèle `deepseek-chat`, température 0.2, `max_turns` 24, 5 outils : `http_request`, `current_time`, `memory_write`, `memory_read`, `web_search`).
- `skills/` — 15 textes normatifs issus du catalogue tiers ECC (`affaan-m/ECC@bf70150`).
- `docs/` — architecture/capacités/gouvernance/exploitation de **cette définition**.
- `tests/test_definition.py` — teste la **cohérence documentaire**, pas un comportement logiciel.
- `scripts/verifier_depot.py` — préflight : profil, prompt, compétences, absence de secret.
- `integrations/agent-os/`, `archive/orchestrateur/` — ponts et artefacts historiques.
- `evidence.json`, `RAPPORT_EXECUTION.json` — journal de preuves d'**exécutions passées sur le PC Windows** (`git version 2.53.0.windows.3`, Docker 29.7.2), pas sur ce serveur.

**Conclusion : 0 % de l'architecture cible n'est implémenté.** Le dépôt est un paquet de spécification ; le corpus `CODIDEV_DOCUMENTATION` décrit un **produit logiciel** (Agent Core, Execution Engine, Tool Router, Security Gate, connecteurs, moteurs de mémoire/apprentissage, couche Supabase multi-tenant, plateforme UX). Ce sont deux objets différents.

## 4. Écarts (gap analysis)

| Sous-système exigé par le corpus | État réel | Écart |
|---|---|---|
| Agent Core (Context, Planner, Decision, Task Engine) | inexistant | **total** |
| Execution Engine + Tool Router (frontière de sécurité) | inexistant | **total** |
| Policy / Risk / Approval (classes READ→SECURITY_SENSITIVE) | prose de gouvernance seulement | **total** |
| Workspace / Sandboxing | inexistant (aucun Docker) | **total** |
| Evidence Model (structuré, machine) | `evidence.json` narratif, non schema-validé | **majeur** |
| Security : SAST/SCA/scan secrets/gate CRITICAL=BLOCK | 1 regex de secrets dans un script | **majeur** |
| Connectors GitHub / Supabase / Vercel | inexistants | **total** |
| Memory Engine + Provenance + Conflict resolution | `memory/MEMORY.md` (append-only manuel) | **majeur** |
| Learning Engine / Preferences / Skills dynamiques / Versioning-Rollback | inexistants (les 15 skills sont statiques et externes) | **total** |
| Data layer Supabase + RLS + multi-tenant | inexistant | **total** |
| Project / Git / Deployment Engine | inexistant (opérations Git manuelles) | **total** |
| Platform UX + Admin Cockpit | `INTERFACE_WEB.md` = spécification, aucun code | **total** |
| Observabilité / Audit / Limites de ressources | inexistant | **total** |
| Tests : unit → E2E, incl. injection/tenant-isolation | 15 tests documentaires | **majeur** |

## 5. Contradictions entre dépôt actuel et corpus cible

1. **Runtime.** Le dépôt actuel déclare `Runtime | Hermes`. Le corpus l'interdit : **ADR-002 — Hermes est l'environnement de construction, pas le runtime de CodiDev** ; `14_HERMES_CONSTRUCTION/02_IMPLEMENTATION_RULES.md` : « Do not create a runtime dependency on Hermes ».
2. **Langage / stack.** Le corpus ne tranche aucune stack d'implémentation. Le dépôt actuel n'oriente que vers un profil JSON consommé par Hermes.
3. **Compétences.** Le dépôt actuel possède 15 compétences **statiques importées d'un catalogue tiers** ; le corpus exige un **Skill Engine dynamique**, généré depuis l'expérience validée, versionné, réversible, tenant-scoped, sans autorité propre.
4. **Identité.** Le dépôt actuel insiste sur « agent indépendant, aucune plateforme » ; le corpus cible un **SaaS multi-tenant** (Supabase, RLS, rôles PLATFORM_ADMIN→VIEWER). La notion d'indépendance devient une propriété d'architecture, pas un mode de déploiement.
5. **Preuve.** Le corpus exige une preuve **structurée et vérifiable machine** ; le dépôt actuel produit de la prose JSON non validée par schéma.

Ce qui reste **réutilisable** (principe de migration du corpus, `00_VISION_GOVERNANCE/04`) : la discipline « preuve > affirmation », la gouvernance graduée + Human Gate, le journal mémoire append-only, les 15 textes de compétences (comme **corpus initial** du Skill Engine, pas comme autorité), la vérification par relecture, la politique secrets.

## 6. Risques et contraintes opposables

| # | Risque | Gravité | Mitigation proposée |
|---|---|---|---|
| R1 | **`sudo` exige un mot de passe** → aucune installation `apt` possible depuis ce contexte non interactif. Or Docker/psql/scanners en dépendent. | **BLOQUANT partiel** | Installer en **userland** (uv pour Python, npm pour Node) ; pour tout besoin système, fournir la commande exacte à exécuter par l'utilisateur lui-même. **Aucun mot de passe ne doit transiter par Telegram.** |
| R2 | **Runtime coupling** : Python 3.14.7 / Node 26.7.0 sont managés par Hermes ; bâtir dessus créerait la dépendance runtime interdite. | Élevé | Toolchain projet **isolée et versionnée** (uv-managed Python, `corepack`/Node local) dans le workspace, pas dans `~/.hermes/tools`. |
| R3 | **Sandboxing** : le corpus exige une isolation processus/réseau/FS des projets non fiables ; sans Docker ni sudo, l'isolation sera plus faible. | Élevé | Décision requise (voir Build Plan D4) : installer Docker (sudo) **ou** isolation best-effort documentée comme limite explicite. **Ne pas** prétendre à une sandbox forte si elle ne l'est pas. |
| R4 | **Dépôt public** → toute fuite est publique et permanente. | Élevé | Security gate avant chaque push (scan secrets + SAST), aucune clé dans le repo, `.gitignore` déjà solide. |
| R5 | **Dérive d'architecture** : le corpus est dense (83 docs) et prescriptif. | Moyen | ADR par décision structurante ; une phase = un incrément testé et documenté. |
| R6 | **Ressources** : 4 vCPU / 7.8 Go — insuffisant pour Supabase local + builds Vercel + sandbox simultanés. | Moyen | Développer les moteurs en local ; Supabase/Vercel = **connecteurs distants** via API, pas d'infra local lourde. |
| R7 | **Source de vérité documentaire** : le corpus vit hors du dépôt (archive `.zip`). | Moyen | Versionner le corpus dans `docs/construction/CODIDEV_DOCUMENTATION/` pour qu'il soit auditable et opposable. |
| R8 | **Secrets/scopes** : le jeton `gh` a `repo` + `workflow` (large). | Moyen | Usage strictement limité au dépôt CodiDev ; jamais copié dans le repo, la mémoire, les skills ou les logs. |

## 7. Ce qui est PRÊT, ce qui est BLOQUÉ

**PRÊT :** accès GitHub vérifié (admin/push), dépôt cloné et propre, corpus lu intégralement, tests et vérificateur existants verts, toolchain Python/Node/uv disponible en userland, réseau OK.

**BLOQUÉ / EN ATTENTE DE DÉCISION :** stack d'implémentation (D1), stratégie de restructuration du dépôt (D2), stratégie de toolchain isolée (D3), stratégie de sandbox sans sudo (D4).

**Aucun push, aucun commit, aucune installation** n'a été effectué. Le dépôt distant est inchangé (`193f31a`).
