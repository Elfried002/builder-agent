/**
 * Exceptions de sécurité revues et traçables.
 *
 * Un scanner que l'on ne peut pas calmer sur du bruit finit désactivé, et un scanner désactivé ne
 * protège rien. La réponse n'est donc pas d'affaiblir les règles, mais de permettre des
 * **exceptions explicites** : chaque exception nomme une règle, cible un chemin, et porte une
 * justification, un auteur et une date de revue.
 *
 * Une exception ne masque jamais un problème : la constatation couverte reste présente dans le
 * rapport, avec la justification qui l'a levée.
 */

import { readFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';

import { validate } from '../contracts.js';
import { ContractError } from '../errors.js';
import type { Finding, SuppressedFinding } from './report.js';

/** Nom conventionnel du fichier d'exceptions à la racine d'un dépôt. */
export const ALLOWLIST_FILENAME = '.codidev-security-allowlist.json';

export interface AllowlistEntry {
  readonly rule: string;
  readonly path: string;
  readonly justification: string;
  readonly reviewedBy: string;
  readonly reviewedAt: string;
  readonly expiresAt?: string | null;
}

interface AllowlistDocument {
  readonly version: number;
  readonly entries: readonly {
    rule: string;
    path: string;
    justification: string;
    reviewed_by: string;
    reviewed_at: string;
    expires_at?: string | null;
  }[];
}

/**
 * Convertit un motif glob en expression régulière, avec la même sémantique que `fnmatch` côté
 * Python : `*` franchit les séparateurs de chemin, `?` vaut un caractère quelconque.
 *
 * Conserver cette sémantique est nécessaire pour que les exceptions existantes — rédigées et
 * revues côté Python — continuent de couvrir exactement les mêmes fichiers après migration.
 */
function globToRegExp(glob: string): RegExp {
  let source = '';
  for (const char of glob) {
    if (char === '*') source += '.*';
    else if (char === '?') source += '.';
    else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

/** Vrai si l'exception couvre une constatation : même règle et chemin correspondant. */
export function entryMatches(entry: AllowlistEntry, finding: Finding, root: string): boolean {
  if (finding.rule !== entry.rule) return false;
  const absolute = isAbsolute(finding.source) ? finding.source : join(root, finding.source);
  let candidate = relative(root, absolute);
  if (candidate.startsWith('..')) candidate = finding.source;
  return globToRegExp(entry.path).test(candidate.split('\\').join('/'));
}

/** Jeu d'exceptions revues. */
export class SecurityAllowlist {
  readonly entries: readonly AllowlistEntry[];
  readonly source: string | null;

  private constructor(entries: readonly AllowlistEntry[], source: string | null) {
    this.entries = entries;
    this.source = source;
  }

  static empty(): SecurityAllowlist {
    return new SecurityAllowlist([], null);
  }

  /** Charge un fichier d'exceptions ; un fichier absent vaut jeu vide. */
  static load(path: string): SecurityAllowlist {
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      return new SecurityAllowlist([], path);
    }
    let document: AllowlistDocument;
    try {
      document = JSON.parse(text) as AllowlistDocument;
    } catch (error) {
      throw new ContractError(`fichier d'exceptions illisible : ${path}`, {
        context: { cause: String(error) },
      });
    }
    validate('security_allowlist', document);
    const entries = document.entries.map((item) => ({
      rule: item.rule,
      path: item.path,
      justification: item.justification,
      reviewedBy: item.reviewed_by,
      reviewedAt: item.reviewed_at,
      expiresAt: item.expires_at ?? null,
    }));
    return new SecurityAllowlist(entries, path);
  }

  /** Charge les exceptions au plus proche du périmètre scanné. */
  static loadFor(target: string): SecurityAllowlist {
    return SecurityAllowlist.load(join(target, ALLOWLIST_FILENAME));
  }

  /** Première exception couvrant une constatation, ou `undefined`. */
  entryFor(finding: Finding, root: string): AllowlistEntry | undefined {
    return this.entries.find((entry) => entryMatches(entry, finding, root));
  }

  /** Sépare les constatations actives de celles couvertes par une exception. */
  partition(
    findings: readonly Finding[],
    root: string,
  ): { active: Finding[]; suppressed: SuppressedFinding[] } {
    const active: Finding[] = [];
    const suppressed: SuppressedFinding[] = [];
    for (const finding of findings) {
      const entry = this.entryFor(finding, root);
      if (entry === undefined) {
        active.push(finding);
        continue;
      }
      suppressed.push({
        finding,
        justification: entry.justification,
        reviewedBy: entry.reviewedBy,
        reviewedAt: entry.reviewedAt,
      });
    }
    return { active, suppressed };
  }

  toJSON(): Record<string, unknown> {
    return { source: this.source, entries: this.entries };
  }
}
