# Rapport de migration — CodiDev Core : Python → TypeScript / Node.js

**Branche :** `phase/02-typescript-core` · **Poussé :** non · **`main` distant :** intact (`193f31a`)
**Date :** 2026-10-02

Ce rapport distingue systématiquement ce qui est **démontré par exécution** de ce qui **reste à
faire**. Aucune ligne ne présente une intention comme un résultat.

---

## A. Audit du Core Python

`docs/migration/01-PYTHON_CORE_AUDIT.md`

- **31 modules, 4 268 lignes de cœur, 2 458 lignes de tests, 204 tests** — inventaire généré depuis
  le disque, pas reconstitué de mémoire.
- **38 invariants** recensés (I-01…I-38), chacun avec son mécanisme et le test qui le prouve.
- **13 contrats JSON Schema** identifiés comme la partie réellement neutre du système.
- **8 risques de migration** identifiés, dont trois structurants : perte silencieuse d'invariant,
  divergence des expressions régulières de détection de secrets, incompatibilité des hachages.

## B. Architecture TypeScript

**5 794 lignes de cœur, 3 442 lignes de tests, 28 fichiers sources.**

```
core/
├── src/
│   ├── statuses.ts errors.ts hashing.ts ids.ts contracts.ts
│   ├── journal.ts evidence.ts audit.ts          journalisation chaînée
│   ├── security/  secrets report gate allowlist tools
│   ├── context/engine.ts                        isolation tenant, provenance, confiance
│   ├── planner/planner.ts                       plans versionnés, invariants, rollback
│   ├── decision/engine.ts                       options, motifs de rejet, politique autoritaire
│   ├── task/engine.ts                           machine à états, vérification obligatoire
│   ├── llm/  types mock deepseek router         abstraction LLM
│   ├── agent/  request intent core              cycle agentique
│   └── index.ts                                 surface publique : CodiDevCore
├── schemas/                                     13 contrats neutres et partagés
├── examples/nextjs-integration/                 fixture d'intégration
└── python/                                      implémentation de référence, en retrait
```

**Choix techniques et leurs raisons :** TypeScript strict (`noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `verbatimModuleSyntax`) ; **aucun `enum`** — les unions de littéraux se
sérialisent nativement, indispensable pour des documents validés et journalisés ; contrats JSON
Schema en dialecte 2020-12 validés par ajv avec résolution des `$ref` **entièrement hors ligne** ;
journalisation derrière l'interface `JournalSink`, les fichiers aujourd'hui, un support distant plus
tard, sans perdre le chaînage ; Biome pour lint et format ; Vitest pour les tests.

**Dépendances d'exécution : deux** (`ajv`, `ajv-formats`). Environnement Node **v24.21.0 LTS** dédié,
empreinte SHA-256 vérifiée contre la source officielle, installé hors Hermes et hors paquets
système. `npm audit` : 0 vulnérabilité.

**Le cœur n'est pas un service :** aucune API HTTP, aucun endpoint, aucune route, aucun écouteur.
Un test structurel le vérifie à chaque exécution (ADR-0009).

## C. Couche LLM — ce qui est nouveau

Le Core Python n'avait **aucune** couche LLM. Son invariant principal est un invariant de sécurité :

| Élément | Rôle |
|---|---|
| `LLMProvider` | Interface unique : `generate(request) → response`. Aucun accès aux outils, aux fichiers, au réseau du cœur |
| `LLMRequest` / `LLMResponse` | Messages, consignes système, contexte, sortie structurée, usage, modèle, latence, identifiant de corrélation |
| `DeepSeekProvider` | Provider initial du MVP. Erreurs **caviardées** avant propagation ; reprise **uniquement** sur erreur transitoire (réseau, 429, 5xx) |
| `MockLLMProvider` | Provider déterministe, sans réseau — aucun test ne dépend d'une clé |
| `router` | Un provider inconnu **lève** : aucun repli silencieux sur un autre fournisseur |

**Sécurité des clés, tenue par construction :** la configuration ne porte que le **nom** de la
variable d'environnement (`CODIDEV_DEEPSEEK_API_KEY` par défaut). Le provider ne conserve **pas**
l'environnement : il conserve une fonction qui lit la clé, ce qui rend une fuite par journalisation
structurellement impossible — `JSON.stringify` sur un provider journalisé n'expose rien.

**Le LLM n'a aucune autorité — et c'est testé, pas seulement écrit :** des étapes proposées sans
critère de vérification sont refusées ; une étape destructive sans rollback est refusée ; une
classification hors vocabulaire laisse la demande indéterminée ; la confiance inférée est plafonnée
à 0,7 ; aucun chemin ne rend `EXECUTED` ni `VERIFIED`.

## D. Migration — correspondance et différences

Correspondance complète : `docs/migration/02-MIGRATION_MAP.md`.

**Différences intentionnelles, assumées et testées :**

| # | Différence | Raison |
|---|---|---|
| D-1 | `EvidenceStore.record()` refuse `VERIFIED` sans validation réellement exécutée et réussie | Le Python ne l'appliquait qu'au Task Engine ; l'appliquer aussi au magasin ferme un contournement |
| D-2 | Le Task Engine reçoit les journaux par des **interfaces structurelles locales** | Il ne dépend d'aucun magasin concret : on peut le tester seul, et le remplacer sans le modifier |
| D-3 | Un adaptateur explicite traduit `null` → champ absent entre Task Engine et magasins | Les magasins valident leurs entrées par contrat ; faire céder un des deux côtés laisserait un `null` converti dans une preuve |
| D-4 | L'Agent Core **dérive** les critères de vérification du plan à partir des étapes | Le contrat les exige ; les inventer serait pire que les dériver |
| D-5 | Une décision sans option examinée reçoit une option dérivée du plan | L'action par défaut existe ; sa classe de risque est celle, **la plus grave**, de ses étapes réelles |
| D-6 | Parcours de tâche explicite `DRAFT → ANALYZING → PROPOSED` | Sauter à `PROPOSED` ferait mentir l'historique |
| D-7 | Le cœur **propose** un plan, il ne l'approuve jamais | L'approbation est un acte humain |
| D-8 | Outils de sécurité adaptés à l'écosystème Node (`biome`, `npm audit`) | `ruff`/`bandit`/`pip-audit` n'existent pas ici ; la couverture est équivalente par fonction, pas par outil |

## E. Tests — résultats réels

```
TypeScript : 242 tests verts / 15 fichiers     tsc --noEmit conforme
Python     : 204 tests verts                   biome : 49 fichiers, aucune erreur
npm run build vert — paquet importable (146 symboles exportés)
```

**Parité :** `docs/migration/03-PARITY_MATRIX.md`, **généré** par `scripts/parity_matrix.py` à partir
de l'exécution réelle des deux suites.

> **38 invariants — 38 `VERIFIED`, 0 `PARTIAL`, 0 `UNCOVERED`.**

**Parité croisée :** `scripts/verify_journal_python.py` fait relire par l'implémentation **Python**
un journal **produit par TypeScript** et recalcule chaque hachage. Ce n'est pas une comparaison de
code : c'est la vérification que les deux implémentations produisent les **mêmes octets**, donc que
leurs preuves sont mutuellement vérifiables. Ce test s'exécute à chaque `npm test`.

**Sécurité :** 16 règles de détection transposées une par une (JavaScript n'a ni les mêmes classes
de caractères ni le même traitement Unicode que Python) ; caviardage idempotent ; gate
CRITICAL/HIGH → BLOCK ; exceptions revues et tracées ; scan du code du cœur lui-même — aucun secret
non revu.

## F. Suppression du Python — `NOT_EXECUTED`, et volontairement

**Statut : préparée, non exécutée.** La condition posée par la mission est remplie (TypeScript
fonctionnel, responsabilités couvertes, parité démontrée). La suppression est retenue pour une
raison technique réelle, pas par prudence vague :

> Le test de parité croisée (`core/tests/integration.test.ts`, dernier bloc) **invoque l'interpréteur
> Python** pour relire un journal produit par TypeScript. Supprimer `core/python/` maintenant
> détruirait le test qui prouve la compatibilité des preuves — c'est-à-dire exactement la garantie
> qu'on cherche à conserver.

**Séquence correcte, avant toute suppression :**

1. produire et **figer** un journal de référence écrit par Python (`core/tests/fixtures/journal-python.jsonl`) ;
2. réécrire le test de parité croisée pour vérifier ce **fichier figé** au lieu d'invoquer Python ;
3. vérifier que le test passe sans Python ;
4. **alors** supprimer `core/python/` : modules, tests, `pyproject.toml`, `uv.lock`, configuration et
   scripts Python devenus exclusivement liés à cette implémentation ;
5. mettre à jour `scripts/bootstrap_env.sh`, `scripts/verify.sh` et la documentation ;
6. vérifier que la suite TypeScript reste entièrement verte **sans** le dossier Python.

La migration est donc **bloquée sur une étape de séquençage**, pas sur une incertitude technique.

## G. Dépôt

| Élément | État |
|---|---|
| Branche | `phase/02-typescript-core` |
| `main` local et distant | `193f31a` — **intact**, aucune fusion |
| Poussé | **non** — aucune opération distante effectuée |
| Commits | voir ci-dessous |
| Arbre de travail | modifications en cours (fixture Next.js et documentation, sous-agents) |

```
7d9fdfd test(core): add structural invariants and generate the parity matrix
f95ddb0 fix(core): wire the task engine to the evidence and audit journals
353bece feat(core): add agent core, package surface and cross-implementation parity
735f044 feat(core): add agentic core in TypeScript
b0e4bb3 feat(core): add journalling foundation in TypeScript
45204e3 feat(core): add LLM abstraction with DeepSeek provider
f1339dd feat(core): add security layer in TypeScript
66b795c feat(core): add TypeScript core foundation
8419e9c chore(core): quarantine Python core and share the contracts
c0b7fa7 Phase 1 — Agent Core   (Phase 1, Python)
3bc70d1 Phase 0 — Foundation   (Phase 0, Python)
```

## H. Intégration par Lovable

Voir `docs/LOVABLE_INTEGRATION.md`. En résumé :

- Le cœur est un **paquet TypeScript importable** (`@codidev/core`), pas un service : `CodiDevCore.create({ workspaceDir, env })` puis `core.run({ text, tenantId, actor, hints })`.
- **Côté serveur uniquement.** La clé d'API vit dans l'environnement d'exécution du serveur et n'est jamais transmise au navigateur.
- Lovable construit **autour** : frontend, dashboard, Supabase, authentification, plateforme. Le cœur ne contient rien de tout cela.
- Les interfaces **stables** sont la surface de `src/index.ts` ; tout ce qui n'y est pas exporté est **interne** et peut changer.
- La règle qui empêche la divergence : **ne pas reconstruire de cœur**. Un contrôle structurel en place interdit au cœur de référencer un emplacement de plateforme, et réciproquement la plateforme consomme le cœur par son point d'entrée.

## I. Risques restants

| Réf. | Statut | Objet |
|---|---|---|
| R-01 | `PROPOSED` | Suppression du Python : séquence définie (§F), non exécutée |
| R-02 | `NOT_EXECUTED` | Aucun appel réel à DeepSeek n'a été effectué : le provider est vérifié par `fetch` injecté et réponses simulées. Le premier appel réel reste à faire lors de l'intégration |
| R-03 | `UNKNOWN` | Comportement de DeepSeek sur les sorties structurées en conditions réelles : non observé. Le code refuse une sortie illisible plutôt que de l'accepter, mais la fréquence réelle est inconnue |
| R-04 | `NOT_EXECUTED` | Adaptateurs `biome`/`npm audit` : le chemin d'exécution nominal (outil présent, code de sortie 0/1) n'a été exercé qu'avec des sorties analysées hors ligne, pas sur une campagne complète |
| R-05 | `PROPOSED` | Fixture Next.js et documentation : produites, en cours de vérification |
| R-06 | `UNKNOWN` | Performance et coût d'un cycle complet avec le vrai modèle : non mesurés |
| R-07 | `EXECUTED` | Aucun commit n'est poussé : le travail n'a **aucune** existence sur GitHub à ce stade |
