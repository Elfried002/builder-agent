# Mémoire de CodiDev

Politique de mémoire de l'agent. Elle est **opposable** : ce qui n'y est pas autorisé n'est pas
mémorisé, même si c'est utile sur le moment.

## Mémorisable

| Catégorie | Contenu type |
|---|---|
| `DECISION` | décision prise, avec sa justification et son impact |
| `CONVENTION` | règle de travail durable adoptée par le projet |
| `KNOWN-ISSUE` | problème connu, non résolu, avec sa portée |
| `SECURITY-FINDING` | constat de sécurité et son statut de remédiation |
| `ARCHITECTURE` | structure retenue et frontières posées |
| `DEPENDENCY` | dépendance, version épinglée, provenance |

## Jamais mémorisé

Mots de passe · jetons · clés d'API · clés privées · secrets · données personnelles sensibles.

Un secret qui apparaît dans une conversation ou une sortie de commande est **signalé**, jamais
recopié.

## Règle append-only

Une correction **ajoute** une entrée ; elle ne réécrit pas l'historique. Une entrée fausse est
corrigée par une entrée suivante qui la référence (`remplace: <id>`), afin que la trace reste
lisible dans le temps.

## Journal

Le journal vit dans [`MEMORY.md`](MEMORY.md). Format d'une entrée :

```
- [CATEGORIE] id — date — contenu  (source: <preuve>)
```

Sans `source`, une entrée est une hypothèse : elle doit être marquée `HYPOTHESIS`.
