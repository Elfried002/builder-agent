# Frontière Core ↔ Platform

Document de référence de la séparation entre le **cœur** (construit ici) et la **plateforme**
(construite par Lovable, dans le même dépôt). Il décrit ce que chaque partie possède, par où
elles se touchent, et **les décisions qui restent à prendre** — celles-là ne sont pas tranchées
ici.

---

## 1. Ce que le cœur possède

| Domaine | Composant | Emplacement |
|---|---|---|
| Coordination du cycle | Agent Core (`analyze` → `plan` → `decide` → tâche) | `core/src/agent/` |
| Contexte | Context Engine : couches, provenance, confiance, isolation tenant | `core/src/context/` |
| Planification | Planner : étapes ordonnées, risques, critères, rollback, révision | `core/src/planner/` |
| Décision | Decision Engine : options, sélection tracée, politique, obligations | `core/src/decision/` |
| Exécution des tâches | Task Engine : machine à états, transitions observables | `core/src/task/` |
| Contrats | 13 JSON Schema, validateur hors ligne | `core/schemas/` (13 contrats neutres) et `core/src/contracts.ts` |
| Preuves | Journal chaîné, append-only, caviardé | `core/src/evidence.ts` |
| Audit | Journal chaîné, séquencé | `core/src/audit.ts` |
| Sécurité | Secrets, gate, adaptateurs SAST/SCA, exceptions revues | `core/src/security/` |

**Non construit à ce stade** (phases ultérieures) : Execution Engine, Tool Router, Workspace,
connectors, Memory/Learning/Skill Engine, Project/Git Engine, DevSecOps.

## 2. Ce que la plateforme possède (Lovable)

Interface, navigation, comptes et organisations, tableaux de bord, paramètres, préférences
d'interface, historique présenté à l'utilisateur, authentification, données SaaS, Supabase,
facturation le cas échéant — **et le backend applicatif qui héberge ces fonctions**.

Le cœur **ne crée pas** ces emplacements et n'écrit pas leur code.

## 3. Par où les deux se touchent

Trois surfaces, et trois seulement :

1. **Objets du cœur.** La plateforme construit une `Request` (type TypeScript) (texte + signaux + tenant + acteur)
   et appelle `AgentCore.run(...)` ; elle reçoit `Analysis`, `Plan`, `DecisionRecord`, `Task`,
   `CoreRun`.
2. **Contrats JSON Schema.** Tout ce qui entre et sort est sérialisable et validé : la plateforme
   peut stocker, afficher ou transmettre ces documents sans connaître les internes du cœur.
3. **Journaux.** Preuves et audit sont des journaux chaînés : la plateforme les présente ou les
   archive, elle ne les réécrit pas.

Rien d'autre. Le cœur ne connaît ni Supabase, ni HTTP, ni interface.

## 4. Ce que la plateforme doit fournir au cœur

| Élément | Rôle |
|---|---|
| `tenant_id` | Identité de tenant, fournie par la plateforme qui authentifie. Le cœur ne s'authentifie pas. |
| `actor` | Identité de l'auteur de la demande, pour les journaux. |
| Signaux d'intention | `intent_category`, `constraints`… Le cœur ne devine pas le langage naturel. |
| Verdict de politique | Une décision `ALLOW` / `DENY` / `REQUIRE_APPROVAL` selon les règles du tenant. |
| Approbation | Le cœur produit `WAITING_FOR_USER` et une obligation `approval:human-gate` ; la plateforme recueille l'approbation et la transmet. |

## 5. DÉCISIONS EN ATTENTE (à trancher par le propriétaire)

Ces points sont **nécessaires** à l'intégration et ne peuvent pas être décidés sans arbitrage :
chacun engage l'architecture au-delà du cœur.

### D-A — Frontière de langage : **tranchée**

Le cœur était initialement écrit en **Python**, et la question ouverte était de savoir comment une
plateforme TypeScript/Node pourrait l'utiliser — un processus Node ne pouvant pas importer un paquet
Python. Trois options avaient été posées : héberger un service Python, appeler le cœur en
sous-processus, ou porter le cœur en TypeScript.

**Décision : le cœur a été porté en TypeScript/Node.js** (voir
[ADR-0010](adr/ADR-0010-migration-du-coeur-vers-typescript.md)). La frontière de langage n'existe
donc **plus** : la plateforme et le cœur partagent le même langage et le même runtime, et le cœur
s'importe **directement**, en processus, comme n'importe quelle bibliothèque.

| Ce qui a été écarté | Pourquoi |
|---|---|
| Hôte Python dans le dépôt | Maintenait deux runtimes, deux chaînes d'outils et une surface de communication à maintenir — pour un produit qui doit rester un seul dépôt, un seul produit |
| Cœur en sous-processus | Imposait un protocole de ligne de commande stable et des allers-retours entre processus là où un appel de fonction suffit |
| Interface HTTP | Aurait transformé le cœur en service : une surface d'attaque, une couche de sérialisation et un déploiement supplémentaires, sans bénéfice pour une intégration en processus |

**Conséquence pour la plateforme :** aucune traversée à concevoir. `import { CodiDevCore } from
'@codidev/core'` suffit, côté serveur.

### D-B — Persistance des preuves et de l'audit

Aujourd'hui les journaux sont des fichiers JSONL locaux, chaînés par hachage. En SaaS
multi-tenant, ils devraient probablement vivre dans Supabase, par tenant.

- **Question :** le cœur doit-il définir un point d'extension de journalisation (une interface
  `JournalSink`) que la plateforme implémente, ou rester sur des fichiers et laisser la
  plateforme les importer ?
- **Contrainte :** le chaînage par hachage et l'absence de réécriture doivent survivre au
  changement de support, sinon la propriété de preuve disparaît.

### D-C — Frontière de l'authentification

Le cœur reçoit `tenant_id` et `actor` en confiance, de la plateforme qui authentifie.

- **Question :** confirmer que le cœur ne doit **jamais** authentifier ni vérifier un jeton
  lui-même (séparation authentification / autorisation, `09_DATA_SUPABASE/02_AUTHORIZATION.md`).
- **Position actuelle du cœur :** oui, il fait confiance à l'identité fournie et n'accorde aucune
  permission par lui-même ; la politique reste externe et autoritaire (ADR-008 du corpus).

### D-D — Qui possède l'approbation humaine

Le cœur produit l'état `WAITING_FOR_USER` et l'obligation `approval:human-gate`, et le contrat
`approval` décrit une approbation (portée, auteur, date, expiration).

- **Question :** l'approbation est-elle recueillie et conservée par la plateforme (interface,
  Supabase), le cœur ne faisant que la consommer ? Et qui décide de l'expiration ?

---

## 6. Ce qui reste interdit dans tous les cas

- Aucun endpoint HTTP, aucun microservice dont le rôle serait d'exposer le cœur.
- Aucune dépendance du cœur à l'interface, à Supabase, à l'authentification ou au déploiement.
- Aucune duplication du cerveau dans la plateforme.
- Aucun emplacement de plateforme créé par le cœur.
