# Frontière Core ↔ Platform

Document de référence de la séparation entre le **cœur** (construit ici) et la **plateforme**
(construite par Lovable, dans le même dépôt). Il décrit ce que chaque partie possède, par où
elles se touchent, et **les décisions qui restent à prendre** — celles-là ne sont pas tranchées
ici.

---

## 1. Ce que le cœur possède

| Domaine | Composant | Emplacement |
|---|---|---|
| Coordination du cycle | Agent Core (`analyze` → `plan` → `decide` → tâche) | `core/src/codidev/agent/` |
| Contexte | Context Engine : couches, provenance, confiance, isolation tenant | `core/src/codidev/context/` |
| Planification | Planner : étapes ordonnées, risques, critères, rollback, révision | `core/src/codidev/planner/` |
| Décision | Decision Engine : options, sélection tracée, politique, obligations | `core/src/codidev/decision/` |
| Exécution des tâches | Task Engine : machine à états, transitions observables | `core/src/codidev/task/` |
| Contrats | 13 JSON Schema, validateur hors ligne | `core/src/codidev/contracts/` |
| Preuves | Journal chaîné, append-only, caviardé | `core/src/codidev/evidence/` |
| Audit | Journal chaîné, séquencé | `core/src/codidev/audit/` |
| Sécurité | Secrets, gate, adaptateurs SAST/SCA, exceptions revues | `core/src/codidev/security/` |

**Non construit à ce stade** (phases ultérieures) : Execution Engine, Tool Router, Workspace,
connectors, Memory/Learning/Skill Engine, Project/Git Engine, DevSecOps.

## 2. Ce que la plateforme possède (Lovable)

Interface, navigation, comptes et organisations, tableaux de bord, paramètres, préférences
d'interface, historique présenté à l'utilisateur, authentification, données SaaS, Supabase,
facturation le cas échéant — **et le backend applicatif qui héberge ces fonctions**.

Le cœur **ne crée pas** ces emplacements et n'écrit pas leur code.

## 3. Par où les deux se touchent

Trois surfaces, et trois seulement :

1. **Objets Python.** La plateforme construit une `Request` (texte + signaux + tenant + acteur)
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

### D-A — Traversée de frontière de langage *(bloquant)*

Le cœur est du **Python**. Si la plateforme de Lovable est une application **TypeScript/Node**
avec un frontend React, alors un processus Node **ne peut pas importer un paquet Python** :
il faut un mécanisme de traversée. Trois options :

| Option | Description | Ce que cela implique |
|---|---|---|
| **A1 — Hôte Python** | La plateforme embarque un service Python dans le même dépôt, qui importe le cœur et l'appelle en processus. Le backend de la plateforme (TS) s'adresse à cet hôte. | Respecte « le cœur est du code du projet ». Ouvre la question : qui écrit l'hôte — le cœur ou la plateforme ? |
| **A2 — Cœur en sous-processus** | La plateforme lance le cœur comme commande locale (`codidev …`) et lit ses sorties JSON. | Aucune couche nouvelle, mais impose un protocole de ligne de commande stable et des allers-retours par processus. |
| **A3 — Réécriture** | Le cœur est porté en TypeScript. | Contredit l'architecture : le cerveau est construit ici, en Python. |

**Recommandation, non décision :** A1 si la plateforme est JS/TS, avec l'hôte écrit **côté
plateforme** (c'est de la logique de plateforme : exposer ses propres fonctions à son propre
frontend). Le cœur resterait un paquet importé, sans API propre.

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
