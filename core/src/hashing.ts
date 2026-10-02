/**
 * Sérialisation canonique et chaînage cryptographique.
 *
 * Deux journaux du cœur (preuves, audit) sont append-only et chaînés : chaque enregistrement porte
 * le hachage du précédent, ce qui rend toute réécriture discrète détectable. La sérialisation doit
 * donc être **déterministe** — la même donnée produit toujours les mêmes octets — et **identique
 * entre implémentations**, faute de quoi un journal produit ici ne pourrait pas être vérifié
 * ailleurs.
 *
 * Contraintes explicites (elles sont testées) :
 *   - clés d'objet triées par ordre lexicographique, à tous les niveaux ;
 *   - aucun espace, aucun saut de ligne ;
 *   - caractères non ASCII préservés (pas d'échappement `\uXXXX` superflu) ;
 *   - valeurs non JSON (`undefined`, fonction, symbole, `NaN`, `Infinity`, grand entier hors
 *     plage sûre) **refusées** plutôt que silencieusement converties : un hachage calculé sur une
 *     valeur transformée ne prouverait rien.
 */

import { createHash } from 'node:crypto';

import { CodiDevError } from './errors.js';

/** Valeur de `prevHash` pour le premier enregistrement d'un journal (pas de prédécesseur). */
export const GENESIS_HASH = '0'.repeat(64);

function assertJsonSafe(value: unknown, path = '$'): void {
  if (value === null) return;
  const type = typeof value;
  if (type === 'string' || type === 'boolean') return;
  if (type === 'number') {
    if (!Number.isFinite(value as number)) {
      throw new CodiDevError('valeur non JSON : nombre non fini', { context: { path } });
    }
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new CodiDevError('valeur non JSON : entier hors plage sûre', { context: { path } });
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      assertJsonSafe(item, `${path}[${index}]`);
    }
    return;
  }
  if (type === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new CodiDevError('valeur non JSON : objet non simple', { context: { path } });
    }
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      assertJsonSafe(item, `${path}.${key}`);
    }
    return;
  }
  throw new CodiDevError(`valeur non JSON : ${type}`, { context: { path } });
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = canonicalize(source[key]);
    }
    return sorted;
  }
  return value;
}

/** Sérialise en JSON canonique : clés triées, séparateurs compacts, non-ASCII préservé. */
export function canonicalJson(payload: unknown): string {
  assertJsonSafe(payload);
  const text = JSON.stringify(canonicalize(payload));
  if (text === undefined) {
    throw new CodiDevError('sérialisation impossible : valeur non JSON à la racine');
  }
  return text;
}

/** Empreinte SHA-256 en hexadécimal minuscule. */
export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Empreinte SHA-256 du JSON canonique d'une structure. */
export function digest(payload: unknown): string {
  return sha256Hex(canonicalJson(payload));
}

/**
 * Calcule le hachage d'un enregistrement, en liant explicitement son prédécesseur.
 *
 * Le champ `hash` est exclu du calcul (il en est le résultat) ; `prevHash` est estampillé dans la
 * structure hachée afin qu'un simple recopiage de hachage ne suffise pas à réordonner ou
 * supprimer un maillon.
 */
export function chainedHash(
  record: Readonly<Record<string, unknown>>,
  prevHash: string,
  hashField = 'hash',
): string {
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key !== hashField) body[key] = value;
  }
  body.prev_hash = prevHash;
  return digest(body);
}
