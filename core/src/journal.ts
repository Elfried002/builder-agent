/**
 * Journal JSONL append-only, chaîné par hachage.
 *
 * Base commune aux preuves et à l'audit. Deux propriétés sont garanties et vérifiables :
 *
 * 1. **Append-only** — aucune API de réécriture ni de suppression n'existe ; seule l'ajout est
 *    offert, et chaque écriture est suivie d'un `fsync`.
 * 2. **Chaînage** — chaque enregistrement porte `prev_hash` (hachage du précédent) et `hash`
 *    (hachage de son propre contenu, `prev_hash` inclus). Modifier, réordonner ou supprimer un
 *    maillon invalide la chaîne et `verify()` le détecte.
 *
 * Toute chaîne écrite est d'abord caviardée : un secret ne peut pas entrer dans un journal
 * (`07_SECURITY/04_SECRETS.md`).
 *
 * Le support de persistance est une interface (`JournalSink`) : le chaînage ne dépend pas du
 * système de fichiers et survivra au passage à un support distant (D-B, Supabase). Toutes les
 * opérations sont asynchrones parce qu'un support distant le sera.
 */

import { createReadStream } from 'node:fs';
import { mkdir, open, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';

import { type ContractName, iterErrors, validate } from './contracts.js';
import { CodiDevError } from './errors.js';
import { canonicalJson, chainedHash, GENESIS_HASH } from './hashing.js';
import { redactStructure } from './security/secrets.js';

/** Enregistrement de journal : un objet JSON dont les clés sont libres, validé par contrat. */
export type JournalRecord = Record<string, unknown>;

/** Fonction de caviardage appliquée avant tout calcul de hachage et toute persistance. */
export type Redactor = (value: unknown) => unknown;

/** Code d'anomalie relevée lors de la vérification d'un journal. */
export type IntegrityIssueCode =
  | 'BROKEN_LINK'
  | 'HASH_MISMATCH'
  | 'CONTRACT_VIOLATION'
  | 'SEQUENCE_GAP'
  | 'MISSING';

/** Anomalie détectée lors de la vérification d'un journal. */
export interface IntegrityIssue {
  readonly index: number;
  readonly code: IntegrityIssueCode;
  readonly detail: string;
}

/** Résultat de la vérification d'un journal. */
export interface IntegrityReport {
  readonly path: string;
  readonly contract: ContractName;
  readonly count: number;
  readonly issues: readonly IntegrityIssue[];
  readonly ok: boolean;
}

/** Représentation sérialisable d'un rapport d'intégrité. */
export function integrityReportToJson(report: IntegrityReport): Record<string, unknown> {
  return {
    path: report.path,
    contract: report.contract,
    count: report.count,
    ok: report.ok,
    issues: report.issues.map((issue) => ({
      index: issue.index,
      code: issue.code,
      detail: issue.detail,
    })),
  };
}

/**
 * Support de journalisation remplaçable (« sink »).
 *
 * Le contrat est volontairement minimal — existence, lecture ligne à ligne, ajout d'une ligne —
 * afin qu'un support distant puisse l'implémenter sans hériter des détails du système de
 * fichiers. Le chaînage, lui, reste porté par `ChainedJournal` et ne dépend pas du support.
 */
export interface JournalSink {
  /** Emplacement lisible du support, repris dans les rapports d'intégrité. */
  readonly location: string;
  /** Vrai si le support contient déjà un journal persistant. */
  exists(): Promise<boolean>;
  /** Itère les lignes non vides du journal, dans l'ordre d'écriture. */
  readLines(): AsyncIterable<string>;
  /** Ajoute une ligne à la fin du journal, sans jamais réécrire l'existant. */
  appendLine(line: string): Promise<void>;
}

/** Support de journalisation sur le système de fichiers (un fichier JSONL). */
export class FileJournalSink implements JournalSink {
  readonly location: string;

  constructor(path: string) {
    this.location = path;
  }

  /**
   * Existence du fichier. On teste le fichier précisément : un répertoire au même chemin n'est
   * pas un journal, et le signaler comme présent ferait taire le défaut `MISSING`.
   */
  async exists(): Promise<boolean> {
    try {
      const info = await stat(this.location);
      return info.isFile();
    } catch {
      return false;
    }
  }

  async *readLines(): AsyncIterable<string> {
    if (!(await this.exists())) return;
    const stream = createReadStream(this.location, { encoding: 'utf8' });
    const reader = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
    try {
      for await (const raw of reader) {
        const line = raw.trim();
        if (line.length > 0) yield line;
      }
    } finally {
      reader.close();
    }
  }

  /**
   * Ajout d'une ligne. Le répertoire parent est créé à la demande, et `fsync` est appelé avant
   * de rendre la main : une écriture annoncée comme faite doit survivre à une coupure.
   */
  async appendLine(line: string): Promise<void> {
    await mkdir(dirname(this.location), { recursive: true });
    const handle = await open(this.location, 'a');
    try {
      await handle.write(`${line}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}

/** Options de construction d'un journal chaîné. */
export interface ChainedJournalOptions {
  readonly contract: ContractName;
  readonly redactor?: Redactor;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Journal append-only d'enregistrements conformes à un contrat et chaînés par hachage. */
export class ChainedJournal {
  readonly contract: ContractName;
  readonly sink: JournalSink;
  readonly #redactor: Redactor;

  constructor(sink: JournalSink | string, options: ChainedJournalOptions) {
    this.sink = typeof sink === 'string' ? new FileJournalSink(sink) : sink;
    this.contract = options.contract;
    this.#redactor = options.redactor ?? redactStructure;
  }

  // ------------------------------------------------------------------ lecture

  /** Itère les enregistrements du journal, dans l'ordre d'écriture. */
  async *records(): AsyncIterable<JournalRecord> {
    for await (const line of this.sink.readLines()) {
      const parsed: unknown = JSON.parse(line);
      if (!isPlainRecord(parsed)) {
        throw new CodiDevError('enregistrement de journal non-objet', {
          context: { journal: this.sink.location },
        });
      }
      yield parsed;
    }
  }

  /** Dernier enregistrement écrit, ou `undefined` si le journal est vide. */
  async lastRecord(): Promise<JournalRecord | undefined> {
    let last: JournalRecord | undefined;
    for await (const record of this.records()) {
      last = record;
    }
    return last;
  }

  /** Hachage du dernier enregistrement, ou `GENESIS_HASH` si le journal est vide. */
  async lastHash(): Promise<string> {
    const last = await this.lastRecord();
    if (last === undefined) return GENESIS_HASH;
    const hash = last.hash;
    return typeof hash === 'string' && hash.length > 0 ? hash : GENESIS_HASH;
  }

  /** Nombre d'enregistrements. */
  async count(): Promise<number> {
    let total = 0;
    for await (const _record of this.records()) {
      total += 1;
    }
    return total;
  }

  // ------------------------------------------------------------------ écriture

  /**
   * Caviarde, chaîne, valide puis ajoute un enregistrement au journal (sans réécriture).
   *
   * Le caviardage précède le hachage : le hachage porte donc sur ce qui est réellement persisté,
   * et un secret ne peut ni être écrit ni figé dans un hachage.
   */
  async append(record: JournalRecord): Promise<JournalRecord> {
    const redacted = this.#redactor({ ...record });
    if (!isPlainRecord(redacted)) {
      throw new CodiDevError('le caviardage doit préserver un objet JSON');
    }
    const candidate: Record<string, unknown> = { ...redacted };
    // Les champs de chaînage sont recalculés par le journal : un appelant ne peut pas les imposer.
    delete candidate.prev_hash;
    delete candidate.hash;
    await this.prepare(candidate);

    const prevHash = await this.lastHash();
    candidate.prev_hash = prevHash;
    candidate.hash = chainedHash(candidate, prevHash);

    validate(this.contract, candidate);

    await this.sink.appendLine(canonicalJson(candidate));
    return candidate;
  }

  // ------------------------------------------------------------------ points d'extension

  /** Ajuste l'enregistrement avant le calcul du hachage (ex. : attribution d'une séquence). */
  protected async prepare(_candidate: Record<string, unknown>): Promise<void> {
    // Point d'extension : le journal générique ne modifie rien.
  }

  /** Vérifications propres au type de journal, appelées pour chaque maillon. */
  protected check(_record: JournalRecord, _index: number, _issues: IntegrityIssue[]): void {
    // Point d'extension : le journal générique n'ajoute aucune vérification.
  }

  // ------------------------------------------------------------------ vérification

  /** Recalcule la chaîne entière et signale la première anomalie de chaque type. */
  async verify(): Promise<IntegrityReport> {
    const issues: IntegrityIssue[] = [];
    let count = 0;
    let expectedPrev = GENESIS_HASH;
    for await (const record of this.records()) {
      const index = count;
      const declaredPrev = record.prev_hash;
      const prevForHash =
        declaredPrev === undefined || declaredPrev === null ? '' : String(declaredPrev);
      if (declaredPrev !== expectedPrev) {
        issues.push({
          index,
          code: 'BROKEN_LINK',
          detail: `prev_hash attendu ${expectedPrev.slice(0, 12)}…, trouvé ${String(declaredPrev).slice(0, 12)}…`,
        });
      }
      const recomputed = chainedHash(record, prevForHash);
      if (recomputed !== record.hash) {
        issues.push({
          index,
          code: 'HASH_MISMATCH',
          detail: `hachage recalculé ${recomputed.slice(0, 12)}… différent de l'hachage consigné ${String(record.hash).slice(0, 12)}…`,
        });
      }
      for (const violation of iterErrors(this.contract, record)) {
        issues.push({ index, code: 'CONTRACT_VIOLATION', detail: violation });
      }
      this.check(record, index, issues);
      expectedPrev = record.hash === undefined ? '' : String(record.hash);
      count += 1;
    }

    if (!(await this.sink.exists()) && count === 0) {
      issues.push({
        index: 0,
        code: 'MISSING',
        detail: `journal absent : ${this.sink.location}`,
      });
    }

    return {
      path: this.sink.location,
      contract: this.contract,
      count,
      issues,
      ok: issues.length === 0,
    };
  }
}
