# ADR-0007 — Exceptions de sécurité revues plutôt qu'affaiblissement des règles

**Statut :** accepté · **Date :** 2026-10-02 · **Décideur :** propriétaire du dépôt

## Contexte

Un rapport de sécurité contient des extraits de code : relu au scan suivant, il se re-signale
lui-même. De même, une documentation peut contenir des identifiants de démonstration. La réponse
naïve — élargir les heuristiques jusqu'à ce que plus rien ne remonte — transforme un détecteur en
décor : un scan qui crie sur du bruit finit désactivé, et un scan désactivé ne protège rien.

## Décision

1. Les règles ne sont pas affaiblies pour faire taire un cas particulier.
2. Un fichier `.codidev-security-allowlist.json`, versionné et validé par contrat, porte les
   exceptions : **règle + chemin + justification + auteur + date de revue**.
3. Une constatation couverte reste **présente dans le rapport**, avec sa justification ; elle
   quitte le verdict, jamais le rapport.
4. Le verdict mentionne explicitement le nombre de constatations supprimées.
5. Une entrée qui ne couvre plus rien est un défaut : un test échoue si une exception de secrets
   ne correspond à aucune constatation.
6. Les cibles générées (rapports) ne sont pas relues : elles sont écrites hors du dépôt, et le
   contrôle porte sur les fichiers **versionnés**.

## Conséquences

- Le gate reste exigeant et utilisable : les faux positifs coûtent une revue explicite, pas une
  règle désactivée.
- Chaque exception est datée et attribuable, donc auditable et révisable.
