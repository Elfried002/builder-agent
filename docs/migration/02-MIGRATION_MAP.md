# Cartographie de migration Python → TypeScript

**Objet :** correspondance composant → composant, invariant préservé, test qui le prouve.
**Principe :** la migration préserve le **comportement et les garanties**, pas la forme du code.

Légende — *Statut* : `PORTÉ` (existe en TS et testé) · `PROPOSÉ` (conçu, non écrit) ·
`NOT_EXECUTED` (pas encore commencé).

---

## 1. Correspondance des composants

| Composant Python | Composant TypeScript | Invariants préservés | Test de parité | Statut |
|---|---|---|---|---|
| `statuses.py` | `src/statuses.ts` | I-01…I-04, I-11 | Matrice de transitions et d'implications rejouée sur les deux vocabulaires | NOT_EXECUTED |
| `errors.py` | `src/errors.ts` | Statut réel porté par chaque erreur | Correspondance type d'erreur → statut, identique des deux côtés | NOT_EXECUTED |
| `hashing.py` | `src/hashing.ts` | Sérialisation canonique stable, chaînage | **Croisé** : le TS vérifie un journal produit par le Python | NOT_EXECUTED |
| `ids.ts` (nouveau) | `src/ids.ts` | Identifiants et horodatages | Format et unicité | NOT_EXECUTED |
| `journal.py` | `src/journal.ts` | I-27, I-28, I-29 | Altération, suppression, réordonnancement détectés | NOT_EXECUTED |
| `evidence/store.py` | `src/evidence.ts` | I-27…I-29, I-32 | Chaîne valide, caviardage à l'écriture | NOT_EXECUTED |
| `audit/ledger.py` | `src/audit.ts` | I-15, I-27 | Séquence strictement croissante, saut détecté | NOT_EXECUTED |
| `contracts/loader.py` | `src/contracts.ts` | Contrats = source de vérité partagée | **Les 13 schémas sont réutilisés à l'identique** | NOT_EXECUTED |
| `security/secrets.py` | `src/security/secrets.ts` | I-30, I-31, I-33 | Même corpus de cas ; idempotence du caviardage | NOT_EXECUTED |
| `security/report.py` | `src/security/report.ts` | Comptages, sévérité maximale | Structure du rapport | NOT_EXECUTED |
| `security/gate.py` | `src/security/gate.ts` | I-05, I-06 | Table sévérité → action, codes de sortie | NOT_EXECUTED |
| `security/allowlist.py` | `src/security/allowlist.ts` | I-32 | Exception sans correspondance = défaut | NOT_EXECUTED |
| `security/tools.py` | `src/security/tools.ts` | I-06 | Adaptateurs avec outils simulés | NOT_EXECUTED |
| `context/engine.py` | `src/context/engine.ts` | I-16…I-20 | Isolation tenant, provenance, rendu déterministe | NOT_EXECUTED |
| `planner/planner.py` | `src/planner/planner.ts` | I-21…I-26 | Matrice d'invariants de plan | NOT_EXECUTED |
| `decision/engine.py` | `src/decision/engine.ts` | I-07…I-10 | Sélection déterministe, motifs de rejet, obligations | NOT_EXECUTED |
| `task/engine.ts` | `src/task/engine.ts` | I-11…I-14 | Matrice de transitions + vérification obligatoire | NOT_EXECUTED |
| `agent/request.py` | `src/agent/request.ts` | I-36 | Tenant/acteur obligatoires, caviardage | NOT_EXECUTED |
| `agent/intent.py` | `src/agent/intent.ts` | I-34 | Intention non établie ⇒ question ouverte | NOT_EXECUTED |
| `agent/core.py` | `src/agent/core.ts` | I-34, I-35 | Cycle complet, statut `NOT_EXECUTED`, frontière | NOT_EXECUTED |
| *(sans équivalent)* | `src/llm/types.ts` | Le LLM n'a aucune autorité sur les outils | Voir §3 | NOT_EXECUTED |
| *(sans équivalent)* | `src/llm/deepseek.ts` | Clé jamais journalisée | Provider mocké, aucun appel réseau en test | NOT_EXECUTED |
| `cli.py` | `bin/codidev.ts` | — | Non prioritaire ; point d'entrée minimal | NOT_EXECUTED |

## 2. Décisions de conception TypeScript

| Sujet | Décision | Raison |
|---|---|---|
| Langage | TypeScript `strict`, ESM, cible Node 24 | Intégration directe dans Next.js ; pas de transpilation exotique |
| Types | `interface` + `type` + unions littérales ; aucun `enum` TS | Les `enum` TS ont une sémantique runtime surprenante et ne se sérialisent pas en JSON nativement |
| Validation | Contrats JSON Schema réutilisés tels quels, validateur hors ligne | Les schémas sont la source de vérité partagée pendant la parité |
| Erreurs | Classe de base portant un `OperationStatus` | Même invariant que Python : une erreur porte son statut réel |
| Journal | JSONL, mêmes règles de sérialisation canonique | Permet la **parité croisée** : le TS relit un journal Python |
| Tests | `vitest` | Rapide, ESM natif, aucune configuration de transpilation |
| Persistance | Système de fichiers derrière une interface `JournalSink` | Prépare D-B (Supabase) sans imposer une dépendance au cœur |
| LLM | Interface `LLMProvider` + providers interchangeables | Exigence d'architecture : DeepSeek initial, remplaçable |
| Outils | Aucun accès du LLM aux outils | Le LLM propose, le cœur décide, la politique tranche |

## 3. Couche LLM — ce qui est porté et ce qui est nouveau

Le Core Python **n'avait aucune couche LLM**. Elle est nouvelle, et son invariant principal est un
invariant de sécurité : **le LLM ne détient aucune autorité**.

| Élément | Rôle | Invariant |
|---|---|---|
| `LLMProvider` | Interface : `generate(request): Promise<LLMResponse>` | Aucun accès aux outils, aux fichiers ou au réseau du cœur |
| `LLMRequest` | messages, consignes système, contexte, sortie structurée, outils déclarés | Le contexte fourni est celui du Context Engine, jamais inventé par le provider |
| `LLMResponse` | texte, sortie structurée, usage, modèle, provider, latence | `usage` tracé pour l'audit et les quotas |
| `DeepSeekProvider` | appels HTTP au fournisseur | Clé lue dans l'environnement, jamais journalisée, jamais dans un test |
| `MockLLMProvider` | réponses scriptées | Permet tests unitaires, d'intégration et de parité sans clé ni réseau |
| `LLMRouter` | sélection du provider selon la configuration | Le cœur ne dépend d'aucun fournisseur nommé |
| `Proposal` | ce que le LLM peut produire : une **proposition** | Passe par politique → permission → Human Gate → outil |

## 4. Ordre d'exécution retenu

1. Socle : statuts, erreurs, hachage, identifiants, contrats.
2. Journaux : journal chaîné, preuves, audit.
3. Sécurité : secrets, rapport, gate, exceptions, outils.
4. Agentique : contexte, plan, décision, tâche.
5. LLM : types, provider simulé, provider DeepSeek, routeur.
6. Agent Core : cycle complet avec le LLM branché sur les seules étapes de raisonnement.
7. Tests : unitaires, intégration, sécurité, **parité croisée**.
8. Fixture Next.js, documentation, puis suppression du Python.

Chaque étape : implémentation → tests → lint → vérification, puis commit dédié.
