# ADR-0004 — Contrats JSON Schema comme frontière entre les sous-systèmes

**Statut :** accepté · **Date :** 2026-10-02 · **Décideur :** propriétaire du dépôt

## Contexte

Le corpus exige que chaque module ait des responsabilités, entrées et sorties explicites, et que
la politique soit autoritaire **en dehors** du prompt (ADR-008 du corpus). Des structures
implicites, construites au fil du code, rendraient cette frontière invérifiable.

## Décision

1. Neuf contrats JSON Schema 2020-12 versionnés : `action`, `tool_request`, `risk_class`,
   `policy_decision`, `approval`, `evidence`, `audit_record`, `task`, `security_allowlist`.
2. Les schémas sont **auto-suffisants** et résolus hors ligne : valider ne dépend d'aucun réseau.
3. Les énumérations des schémas sont **alignées sur les vocabulaires Python** et un test échoue
   si l'un dérive de l'autre.
4. Toute écriture structurante (preuve, audit) est validée contre son contrat **avant** d'être
   persistée : un document non conforme ne peut pas entrer dans un journal.

## Conséquences

- Le modèle ne peut pas « proposer » une action hors vocabulaire : la classe de risque, le statut
  ou le verdict sont contraints par le schéma.
- Ajouter un contrat ou une valeur est un changement visible, testé et revu.
