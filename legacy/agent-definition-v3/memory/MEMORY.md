# MEMORY.md — journal de CodiDev

Journal append-only. Une correction s'ajoute, elle ne réécrit pas l'historique.

Format : `- [CATEGORIE] id — date — contenu  (source: <preuve>)`

---

- [ARCHITECTURE] arch-001 — 2026-09-24 — Définition de l'agent en trois couches : profil
  exécutable (`agent/codidev.json`), prompt système (`agent/codidev.prompt.md`), bibliothèque
  normative (`skills/`). Les orchestrateurs n'ayant pas de chargeur de compétences, le prompt ne
  porte qu'un digest.  (source: `docs/ARCHITECTURE.md` §1-2)

- [CONVENTION] conv-001 — 2026-09-24 — Un enregistrement réussi (HTTP 201) ne vaut pas agent
  opérationnel : preuve = relecture de la fiche puis exécution de contrôle.  (source:
  `docs/EXPLOITATION.md` §3-4)

- [SECURITY-FINDING] sec-001 — 2026-09-30 — La clé d'enregistrement de l'orchestrateur n'ouvre
  que `POST /api/v1/agents/enroll` ; la valider par une route de lecture produit un faux `401`.
  Contrôle corrigé, règle écrite dans `docs/EXPLOITATION.md`.  (source: `core/authentication.py`
  du backend, `require_enrollment_key`)

- [DECISION] dec-001 — 2026-10-02 — Renommage de l'agent **Builder Agent → CodiDev** (spec
  v3.0.0, annexe A). La spécialité de routage `builder` est conservée : c'est un contrat
  d'orchestration, pas un nom d'agent. Anciennes identités conservées au seul titre de
  l'historique dans `CHANGELOG.md`.  (source: `CHANGELOG.md` [3.0.0], `git grep`)

- [CONVENTION] conv-002 — 2026-10-02 — Toute écriture est suivie d'une vérification physique
  (`test -f`, `ls -lh`, `stat`) et tout test porte l'état `EXECUTED` / `NOT_EXECUTED` / `FAILED`.
  (source: `SKILL.md` règles 6 et 7)

- [DECISION] dec-002 — 2026-10-02 — **CodiDev est un agent indépendant** : détaché de
  l'orchestrateur multi-agents (tâche de heartbeat supprimée, identifiants mis en quarantaine
  hors du dépôt, script d'inscription retiré du dépôt). Son exécution ne dépend d'aucune
  plateforme ; les artefacts de la période « orchestrateur » sont archivés sous
  `archive/orchestrateur/`.  (source: `CHANGELOG.md` [3.1.0], `archive/orchestrateur/README.md`)

- [CONVENTION] conv-003 — 2026-10-02 — Toute interface (web ou console) applique la même règle
  que l'agent : **aucun statut de succès sans preuve affichable**, aucun secret représenté
  autrement que par « présente / non affichée », et une donnée manquante s'affiche `UNKNOWN`
  plutôt que par une valeur plausible.  (source: `INTERFACE_WEB.md` §1, §10)

- [OPEN-POINT] opn-001 — 2026-10-02 — L'identité de plateforme précédemment attribuée
  (`agt_ff4e15a6d9524dfc`, ainsi que `agt_b73d0513a3f346b2` et `agt_5a0af0d2ce044545`) subsiste
  dans le registre de l'orchestrateur. CodiDev n'y émet plus rien ; la **révocation définitive**
  est une action d'administration (elle exige une session admin, le jeton d'agent répond `401`).
  (source: appel réel `POST /api/v1/agents/{agent_id}/revoke` -> 401 avec jeton d'agent)

- [ARCHITECTURE] arch-002 — 2026-10-02 — L'interface web est un **poste de pilotage en lecture
  seule** sur les artefacts de l'agent (définition, compétences, exécutions, preuves, mémoire) :
  pas de moteur d'exécution, pas d'authentification dans la première version, données de
  démonstration versionnées dans le dépôt.  (source: `INTERFACE_WEB.md` §3-4, §9)
