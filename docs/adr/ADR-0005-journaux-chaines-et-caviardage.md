# ADR-0005 — Preuves et audit append-only, chaînés par hachage, caviardés à l'écriture

**Statut :** accepté · **Date :** 2026-10-02 · **Décideur :** propriétaire du dépôt

## Contexte

Le corpus exige des preuves vérifiables, un audit inaltérable par un tenant ordinaire, et
l'interdiction absolue des secrets dans les journaux. Un journal en texte libre ne satisfait
aucune des trois exigences : il est réécrivable silencieusement et rien n'empêche d'y écrire un
secret.

## Décision

1. Deux journaux JSONL **append-only** : preuves (`evidence`) et audit (`audit_record`).
2. Chaque enregistrement porte `prev_hash` et `hash` (SHA-256 sur JSON canonique, `prev_hash`
   inclus) : modifier, réordonner ou supprimer un maillon est **détectable**.
3. La séquence d'audit est attribuée par le journal, jamais par l'appelant ; sa continuité est
   vérifiée.
4. **Tout** enregistrement est caviardé avant écriture.
5. Aucune API de mise à jour ou de suppression n'existe.
6. Un texte déjà caviardé n'est plus jamais détecté comme secret (propriété testée), sans quoi
   chaque republication d'un rapport se re-signalerait elle-même.

## Conséquences

- `codidev journal verify` prouve l'intégrité d'un journal, ou nomme le maillon altéré.
- Un secret ne peut pas entrer dans une preuve : il est neutralisé à la source.
- Le caviardage reste **visible** (`[REDACTED:règle]`) : on ne perd pas l'information qu'un
  secret a été vu, on perd seulement sa valeur.
