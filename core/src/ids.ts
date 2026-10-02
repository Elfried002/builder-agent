/**
 * Identifiants et horodatages canoniques.
 *
 * Les identifiants sont préfixés par la nature de l'objet et suffixés par 32 caractères
 * hexadécimaux, comme dans l'implémentation de référence : un identifiant doit rester lisible
 * dans un journal et stable dans un contrat.
 */

import { randomUUID } from 'node:crypto';

/** Identifiant unique lisible, préfixé par la nature de l'objet (`ev`, `dec`, `req`, …). */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

/** Instant courant au format RFC 3339 (UTC, suffixe `Z`), accepté par `format: date-time`. */
export function utcNowIso(): string {
  return new Date().toISOString();
}
