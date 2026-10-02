# Journaux de référence — produits par l'implémentation Python

Ces deux fichiers ne sont **pas** des données de test inventées : ce sont des journaux réellement
écrits par l'implémentation **Python** du cœur, figés ici pour que la parité reste vérifiable
**après** la suppression de cette implémentation.

## Pourquoi les figer

Le cœur chaîne ses preuves et son audit : chaque enregistrement porte le hachage du précédent.
« Chaîné » ne veut rien dire si le chaînage ne vaut que pour l'implémentation qui l'a écrit — il
faut qu'une seconde implémentation puisse relire le journal et recalculer les mêmes hachages.

Tant que l'implémentation Python existait, cette vérification était un test qui invoquait
l'interpréteur Python. Supprimer le dossier Python aurait donc détruit le test qui prouve la
compatibilité des preuves. Figer les journaux conserve la garantie : `core/tests/integration.test.ts`
les relit avec l'implémentation TypeScript et exige que la chaîne soit intègre.

## Contenu

| Fichier | Enregistrements | Ce qu'il prouve |
|---|---|---|
| `evidence-python.jsonl` | 2 | Une preuve `NOT_EXECUTED` et une preuve `VERIFIED` (validation exécutée et réussie) |
| `audit-python.jsonl` | 2 | Deux actions d'audit, séquence strictement croissante, tenant renseigné |

Les deux contiennent un **jeton factice construit par concaténation** fourni dans un avertissement :
il a été **caviardé à l'écriture** par l'implémentation Python. Les fichiers ne contiennent donc
aucun secret en clair — et le test le vérifie, puisque c'est précisément la garantie à conserver.

## Provenance

Produits par un script exécuté dans `core/python/` avec l'environnement isolé du cœur :

```
python -  # écrit depuis core/python, sortie vers core/tests/fixtures/
  EvidenceStore(...).record("core.run", NOT_EXECUTED, ...)
  AuditLedger(...).record_action(...)
  EvidenceStore(...).record("parity.reference", VERIFIED, validation=performed+passed)
```

Sortie de production : `preuves : 2 | audit : 2`, chaînes sans anomalie, jeton absent du fichier,
marque de caviardage présente.

## Ne pas régénérer

Ces fichiers sont des **archives**. Les régénérer demanderait l'implémentation Python, qui est
retirée ; et les réécrire avec l'implémentation TypeScript leur ferait perdre exactement ce qu'ils
prouvent. Si un jour ils doivent changer, la question à se poser n'est pas « comment les
régénérer » mais « quelle garantie a été perdue pour qu'ils ne soient plus valides ».
