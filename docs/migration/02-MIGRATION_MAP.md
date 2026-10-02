# Cartographie de migration Python → TypeScript

**Objet :** correspondance composant → composant, invariant préservé, test qui le prouve.
**Principe :** la migration préserve le **comportement et les garanties**, pas la forme du code.

Légende — *Statut* : `PORTÉ` (existe en TS et testé) · `PROPOSÉ` (conçu, non écrit) ·
`NOT_EXECUTED` (pas encore commencé).

> **État au 2026-10-02 :** le cœur TypeScript (`core/`, paquet `@codidev/core`) est l'implémentation
> **officielle**. Les composants ci-dessous marqués `PORTÉ` existent réellement dans `core/src/`
> et sont couverts par la suite de tests du paquet. Le cœur Python (`core/python/`) est conservé en
> quarantaine comme implémentation de référence pour la **parité croisée** ; il n'est plus
> l'implémentation supportée (voir [ADR-0010](../adr/ADR-0010-migration-du-coeur-vers-typescript.md)).
>
> Preuve : `cd core && npm test` → **15 fichiers de tests, 244 tests, 244 verts** (Node 24 LTS).
> Deux d'entre eux vérifient la parité croisée avec l'implémentation Python.

---

## 1. Correspondance des composants

| Composant Python | Composant TypeScript | Invariants préservés | Test de parité | Statut |
|---|---|---|---|---|
| `statuses.py` | `src/statuses.ts` | I-01…I-04, I-11 | Matrice de transitions et d'implications rejouée sur les deux vocabulaires | PORTÉ |
| `errors.py` | `src/errors.ts` | Statut réel porté par chaque erreur | Correspondance type d'erreur → statut, identique des deux côtés | PORTÉ |
| `hashing.py` | `src/hashing.ts` | Sérialisation canonique stable, chaînage | **Croisé** : le TS vérifie un journal produit par le Python | PORTÉ |
| `ids.ts` (nouveau) | `src/ids.ts` | Identifiants et horodatages | Format et unicité | PORTÉ |
| `journal.py` | `src/journal.ts` | I-27, I-28, I-29 | Altération, suppression, réordonnancement détectés | PORTÉ |
| `evidence/store.py` | `src/evidence.ts` | I-27…I-29, I-32 | Chaîne valide, caviardage à l'écriture | PORTÉ |
| `audit/ledger.py` | `src/audit.ts` | I-15, I-27 | Séquence strictement croissante, saut détecté | PORTÉ |
| `contracts/loader.py` | `src/contracts.ts` | Contrats = source de vérité partagée | **Les 13 schémas sont réutilisés à l'identique** | PORTÉ |
| `security/secrets.py` | `src/security/secrets.ts` | I-30, I-31, I-33 | Même corpus de cas ; idempotence du caviardage | PORTÉ |
| `security/report.py` | `src/security/report.ts` | Comptages, sévérité maximale | Structure du rapport | PORTÉ |
| `security/gate.py` | `src/security/gate.ts` | I-05, I-06 | Table sévérité → action, codes de sortie | PORTÉ |
| `security/allowlist.py` | `src/security/allowlist.ts` | I-32 | Exception sans correspondance = défaut | PORTÉ |
| `security/tools.py` | `src/security/tools.ts` | I-06 | Adaptateurs avec outils simulés | PORTÉ |
| `context/engine.py` | `src/context/engine.ts` | I-16…I-20 | Isolation tenant, provenance, rendu déterministe | PORTÉ |
| `planner/planner.py` | `src/planner/planner.ts` | I-21…I-26 | Matrice d'invariants de plan | PORTÉ |
| `decision/engine.py` | `src/decision/engine.ts` | I-07…I-10 | Sélection déterministe, motifs de rejet, obligations | PORTÉ |
| `task/engine.py` | `src/task/engine.ts` | I-11…I-14 | Matrice de transitions + vérification obligatoire | PORTÉ |
| `agent/request.py` | `src/agent/request.ts` | I-36 | Tenant/acteur obligatoires, caviardage | PORTÉ |
| `agent/intent.py` | `src/agent/intent.ts` | I-34 | Intention non établie ⇒ question ouverte | PORTÉ |
| `agent/core.py` | `src/agent/core.ts` | I-34, I-35 | Cycle complet, statut `NOT_EXECUTED`, frontière | PORTÉ |
| *(sans équivalent)* | `src/llm/types.ts` | Le LLM n'a aucune autorité sur les outils | Voir §3 | PORTÉ |
| *(sans équivalent)* | `src/llm/mock.ts` | Scénarios simulés, aucun réseau | Provider mocké utilisé par tous les tests | PORTÉ |
| *(sans équivalent)* | `src/llm/deepseek.ts` | Clé jamais journalisée | Provider mocké, aucun appel réseau en test | PORTÉ |
| *(sans équivalent)* | `src/llm/router.ts` | Le cœur ne dépend d'aucun fournisseur nommé | Sélection par configuration, aucun repli silencieux | PORTÉ |
| `cli.py` | `bin/codidev.ts` | — | Non prioritaire ; point d'entrée minimal | NOT_EXECUTED |
| *(sans équivalent)* | `src/index.ts` | Surface du paquet : `CodiDevCore`, `Request`, `AgentCore` | **Cycle complet d'intégration** exercé par `tests/integration.test.ts` | PORTÉ |
| *(sans équivalent)* | `examples/nextjs-integration/` | Fixture d'intégration Next.js : cycle serveur, route App Router, usage côté serveur | Exécutée par son propre test (`npx vitest run examples/nextjs-integration/tests/…`), hors `npm test` | PORTÉ |

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
invariant de sécurité : **le LLM ne détient aucune autorité**. Elle est désormais **PORTÉE** et
couverte par `core/tests/llm.test.ts` et `core/tests/integration.test.ts`.

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

1. Socle : statuts, erreurs, hachage, identifiants, contrats. — **fait**
2. Journaux : journal chaîné, preuves, audit. — **fait**
3. Sécurité : secrets, rapport, gate, exceptions, outils. — **fait**
4. Agentique : contexte, plan, décision, tâche. — **fait**
5. LLM : types, provider simulé, provider DeepSeek, routeur. — **fait**
6. Agent Core : cycle complet avec le LLM branché sur les seules étapes de raisonnement. — **fait**
7. Tests : unitaires, intégration, sécurité, **parité croisée**. — **fait** (244 tests)
8. Fixture Next.js, documentation, puis suppression du Python. — **en cours** (fixture et
   documentation écrites ; reste la suppression du Python après démonstration de parité).

Chaque étape : implémentation → tests → lint → vérification, puis commit dédié.
