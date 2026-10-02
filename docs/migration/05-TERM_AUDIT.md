# Audit terminologique — vocabulaire historique vs vocabulaire courant

**Date :** 2026-10-02
**Branche :** `phase/03-repository-normalization`
**Objet :** recenser les termes hérités de l'ère pré-migration (Python, Hermes, Agent OS, Telegram,
Builder Agent, orchestrateur) dans le dépôt normalisé, pour vérifier qu'aucun ne présente plus le
Core comme ce qu'il n'est pas.

**Méthode (commandes réellement exécutées) :**

```bash
git grep -i -F -- "<terme>" -- .            # occurrences (fichiers suivis par Git)
git grep -i -F -- "<terme>" -- core/        # idem, par zone : core/ docs/ legacy/ scripts/ racine
```

Les comptes sont des **lignes** contenant le terme (insensible à la casse), sur les fichiers suivis
par Git. Une ligne contenant deux fois le terme ne compte qu'une fois. Les chiffres de référence de
la mission (Python 327, Telegram 12, DeepSeek 120, orchestrator 13…) correspondent à cette méthode.

**Classification :**

| Code | Sens |
|---|---|
| `CURRENT` | Décrit l'état **actuel** du Core (TypeScript, provider DeepSeek). |
| `HISTORICAL` | Décrit un état **passé**, présenté comme tel (migration, retrait du Python, parité). |
| `LEGACY` | Appartient à l'**archive** `legacy/` (bandeau historique ajouté). |
| `INCORRECT` | Présente une ancienne description **comme si elle était actuelle** → danger. |
| `SAFE` | Occurrence **neutre ou défensive** (négation, interdiction, garde-fou de test). |

---

## 1. Occurrences par terme et par zone

| TERME | core/ | docs/ | legacy/ | racine | scripts/ | TOTAL |
|---|---:|---:|---:|---:|---:|---:|
| Python | 49 | 94 | 136 | 15 | 33 | **327** |
| Hermes | 3 | 43 | 29 | 0 | 0 | **75** |
| Agent OS | 0 | 0 | 9 | 0 | 0 | **9** |
| agent-os | 0 | 1 | 13 | 0 | 0 | **14** |
| Telegram | 3 | 9 | 0 | 0 | 0 | **12** |
| Builder Agent | 0 | 1 | 9 | 0 | 0 | **10** |
| builder-agent | 0 | 0 | 13 | 0 | 0 | **13** |
| Multi-Agent Orchestrator | 0 | 3 | 0 | 0 | 0 | **3** |
| orchestrator | 2 | 6 | 5 | 0 | 0 | **13** |
| DeepSeek | 81 | 24 | 6 | 9 | 0 | **120** |
| TypeScript | 77 | 86 | 104 | 12 | 15 | **294** |

> Les bandeaux historiques ajoutés par cette mission (`legacy/`, `docs/construction/`) contiennent
> volontairement les mots « Builder Agent », « TypeScript » et « Core » : ils expliquent pourquoi
> l'archive n'est pas le Core actuel.

---

## 2. Audit détaillé (échantillon représentatif)

| TERME | FICHIER | CONTEXTE (extrait court) | CLASSIFICATION | ACTION |
|---|---|---|---|---|
| **Python** | `core/src/security/secrets.ts` | « Portage de `core/python/src/codidev/security/secrets.py` » | `HISTORICAL` | Conserver : commentaire de provenance, pas une dépendance. |
| **Python** | `docs/LOVABLE_INTEGRATION.md` | « il n'existe plus de cœur Python à importer, appeler ou copier » | `CURRENT` | Conserver : met explicitement en garde contre l'ancien cœur. |
| **Python** | `legacy/agent-definition-v3/DESCRIPTION.md` | « `python -m unittest discover -s tests -v` → 11 tests » | `LEGACY` | Conserver (archive) — bandeau ajouté en tête. |
| **Python** | `README.md` (racine) | « **Python :** en quarantaine… en attente de suppression après parité démontrée » (l. 262) | `INCORRECT` | Signaler : incohérent avec le retrait déjà effectif (l. 12). Hors périmètre d'édition de cette mission. |
| **Python** | `scripts/parity_matrix.py` | « Construit la matrice de parité Python ↔ TypeScript » | `HISTORICAL` | Conserver : outil de parité, ne réintroduit pas le Python. |
| **Hermes** | `core/README.md` | « Aucune dépendance à Hermes, à Telegram ni à un runtime de construction. » | `SAFE` | Conserver : négation explicite. |
| **Hermes** | `core/tests/repo_integrity.test.ts` | `interdits = ['hermes', 'telegram', 'multi-agent-orchestrator', …]` | `SAFE` | Conserver : garde-fou de non-dépendance. |
| **Hermes** | `docs/adr/ADR-0009-…` | « **Hermes construit le cerveau de CodiDev** » | `CURRENT` | Conserver : Hermes = environnement de construction, pas runtime. |
| **Hermes** | `legacy/agent-definition-v3/README.md` | « \| Runtime \| Hermes \| » | `LEGACY` | Conserver (archive) — bandeau ajouté. |
| **Agent OS** | `legacy/agent-definition-v3/DESCRIPTION.md` | « enregistrement sur une console Agent OS (`POST /api/agents`) » | `LEGACY` | Conserver (archive) — bandeau ajouté. |
| **Agent OS** | `legacy/agent-definition-v3/integrations/agent-os/` | scripts `enregistrer_agent_os.py` / `verifier_agent_os.py` | `LEGACY` | Conserver (archive), hors service. |
| **agent-os** | `docs/construction/CONSTRUCTION_ASSESSMENT.md` | « `integrations/agent-os/`, `archive/orchestrateur/` — ponts et artefacts historiques » | `HISTORICAL` | Conserver : inventaire d'archive. |
| **Telegram** | `core/README.md` | « Aucune dépendance à Hermes, à Telegram… » | `SAFE` | Conserver : négation. |
| **Telegram** | `docs/construction/CODIDEV_DOCUMENTATION/` | « Telegram is excluded. » / « No Telegram. » | `CURRENT` | Conserver : exclusion imposée par la spécification. |
| **Builder Agent** | `legacy/agent-definition-v3/CHANGELOG.md` | « Renommage de l'agent : Builder Agent → CodiDev » | `LEGACY` | Conserver (archive) — bandeau ajouté. |
| **Builder Agent** | `docs/construction/CODIDEV_DOCUMENTATION/00_VISION_GOVERNANCE/04_…` | « The existing Builder Agent documentation describes Hermes runtime… » | `HISTORICAL` | Conserver : décrit l'état **avant** migration. |
| **builder-agent** | `legacy/agent-definition-v3/CHANGELOG.md` | « `agent/builder-agent.json` → `agent/codidev.json` » | `LEGACY` | Conserver (archive). |
| **Multi-Agent Orchestrator** | `docs/construction/CODIDEV_DOCUMENTATION/00_VISION_GOVERNANCE/03_DECISIONS.md` | « The separate Multi-Agent Orchestrator is excluded. » | `CURRENT` | Conserver : exclusion imposée. |
| **Multi-Agent Orchestrator** | `docs/construction/CODIDEV_DOCUMENTATION/README.md` | « No external multi-agent orchestrator. » | `CURRENT` | Conserver : exclusion imposée. |
| **orchestrator** | `core/tests/repo_integrity.test.ts` | `'multi-agent-orchestrator'`, `'multi_agent_orchestrator'` | `SAFE` | Conserver : garde-fou. |
| **orchestrator** | `docs/construction/CODIDEV_DOCUMENTATION/01_PRODUCT/02_SCOPE.md` | « Out of scope: … the separate multi-agent orchestrator » | `CURRENT` | Conserver : hors périmètre par décision. |
| **orchestrator** | `legacy/agent-definition-v3/evidence.json` | « `rm codidev_heartbeat_kit.py orchestrator_builder_heartbeat.py` » | `LEGACY` | Conserver (archive), hors service. |
| **DeepSeek** | `core/src/llm/deepseek.ts` | « Provider DeepSeek — provider initial du MVP. » | `CURRENT` | Conserver : provider actuel. |
| **DeepSeek** | `core/README.md` | « `CODIDEV_DEEPSEEK_API_KEY` — **nom de variable, jamais une clé** » | `CURRENT` | Conserver : configuration actuelle, aucune clé en clair. |
| **DeepSeek** | `README.md` (racine) | « DeepSeek est le provider initial du MVP » | `CURRENT` | Conserver. |
| **DeepSeek** | `docs/LOVABLE_INTEGRATION.md` | « provider `DeepSeek` (MVP) et provider `mock` (tests) » | `CURRENT` | Conserver. |
| **TypeScript** | `README.md` (racine) | « Le cœur est en **TypeScript / Node.js** » | `CURRENT` | Protégé par `repository_normalization.test.ts`. |
| **TypeScript** | `docs/LOVABLE_INTEGRATION.md` | « Langage officiel — Le cœur est TypeScript/Node.js » | `CURRENT` | Protégé par `repository_normalization.test.ts`. |
| **TypeScript** | `docs/adr/ADR-0010-…` | « Le cœur passe en TypeScript/Node.js ; le Python devient historique » | `CURRENT` | Conserver : décision fondatrice. |
| **TypeScript** | `docs/CORE_PLATFORM_BOUNDARY.md` | « A3 — Réécriture… **Contredit l'architecture** : le cerveau est construit ici, en Python » | `INCORRECT` | Signaler : présuppose un cœur Python (voir § 3). |
| **TypeScript** | `legacy/agent-definition-v3/INTERFACE_WEB.md` | « React + TypeScript + Tailwind (stack Lovable par défaut) » | `LEGACY` | Conserver (archive). |
| **TypeScript** | `core/package-lock.json` | « `"typescript": "^7.0.2"` » | `CURRENT` | Conserver : outillage du Core. |

---

## 3. Zones où une occurrence dangereuse subsiste

Toutes les occurrences `LEGACY` sont neutralisées par le bandeau d'archive
(`legacy/README.md` + en-têtes). Les occurrences `SAFE` sont défensives (négations, garde-fous).
**Une zone `INCORRECT` subsiste**, hors du périmètre d'édition de cette mission (qui ne touche ni
`docs/CORE_PLATFORM_BOUNDARY.md` ni le corps du README racine) :

1. **`docs/CORE_PLATFORM_BOUNDARY.md` — danger principal.** Ce document présente encore le cœur
   **au présent comme du Python** :
   - l. 66 : « Le cœur est du **Python** » ;
   - l. 14-22 : chemins de l'ancienne arborescence Python `core/src/codidev/...` (le Core actuel est
     `core/src/agent/`, `core/src/planner/`, etc. — sans segment `codidev/`) ;
   - l. 39 : « **Objets Python.** La plateforme construit une `Request` … » ;
   - l. 74 : « **A3 — Réécriture** … Contredit l'architecture : le cerveau est construit ici, en
     Python ».
   Toute la section 5 « DÉCISIONS EN ATTENTE — D-A (traversée de frontière de langage) » découle de
   cette prémisse périmée (le langage est tranché : TypeScript, cf. ADR-0010). Ce fichier est
   **référencé par le README racine et `core/README.md`** comme document de référence de la
   frontière : c'est donc la zone la plus à risque.

2. **`README.md` (racine) — incohérences résiduelles (secondaires).** Le haut du fichier annonce le
   retrait du Python (l. 12), mais deux passages le décrivent encore comme présent :
   - l. 262 : « **Python :** en quarantaine, hors périmètre, en attente de suppression après parité
     démontrée. » ;
   - l. 276 : « Suppression du cœur Python | après parité démontrée » ;
   - l. 145 : « `scripts/verify.sh` … concernent l'environnement **Python historique** (migration en
     cours) ».
   Ces phrases sont **stale** (le Python est déjà retiré), mais elles ne présentent pas le Core
   comme Python : elles ne déclenchent pas le test anti-régression, qui reste donc précis plutôt que
   bruyant. À aligner lors d'une passe documentaire dédiée.

3. **`docs/PHASE_1_REPORT.md:34`** — « `core/` ← cœur, paquet **Python** autonome (construit ici) ».
   Rapport de phase **daté** (HISTORICAL) : à conserver comme trace, mais il ne décrit pas l'état
   actuel. Un bandeau de tête y serait utile lors d'une passe dédiée.

**Rien de dangereux ne subsiste dans `core/`, ni dans `docs/LOVABLE_INTEGRATION.md`** : ces zones
sont `CURRENT` ou `SAFE`, et les deux dernières sont désormais verrouillées par
`core/tests/repository_normalization.test.ts`.
