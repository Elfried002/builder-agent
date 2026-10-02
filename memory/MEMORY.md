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

- [OPEN-POINT] opn-001 — 2026-10-02 — L'ancienne identité plateforme (Builder Agent) subsiste
  côté orchestrateur ; sa révocation est une action d'administration (elle n'est pas disponible
  avec le seul jeton d'agent).  (source: `docs/EXPLOITATION.md`, routes d'administration)
