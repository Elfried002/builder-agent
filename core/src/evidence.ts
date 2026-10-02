/**
 * Journal de preuves (`04_EXECUTION/03_EVIDENCE.md`).
 *
 * Une entrée de preuve décrit une opération **réellement** exécutée, avec son statut réel. Le
 * magasin n'offre ni réécriture ni suppression : une correction ajoute une entrée.
 *
 * Trois garanties sont tenues ici :
 *
 *   - la chaîne et le caviardage hérités du journal chaîné (I-27, I-29) ;
 *   - le contrat `evidence` impose que `passed` soit faux si `validation.performed` est faux :
 *     on ne peut pas déclarer une vérification réussie sans l'avoir exécutée ;
 *   - une preuve ne peut pas être consignée `VERIFIED` sans validation réellement exécutée et
 *     réussie. Le statut d'une opération est celui qui a été observé, jamais un succès supposé.
 */

import { VerificationRequiredError } from './errors.js';
import { newId, utcNowIso } from './ids.js';
import { ChainedJournal, type JournalRecord, type JournalSink, type Redactor } from './journal.js';
import { OperationStatus } from './statuses.js';

const EVIDENCE_CONTRACT = 'evidence';

/** Critères de vérification attachés à une preuve. */
export class ValidationOutcome {
  readonly criteria: readonly string[];
  readonly performed: boolean;
  readonly passed: boolean;

  constructor(criteria: readonly string[], performed: boolean, passed: boolean) {
    this.criteria = criteria;
    this.performed = performed;
    this.passed = passed;
  }

  toJson(): Record<string, unknown> {
    return {
      criteria: [...this.criteria],
      performed: this.performed,
      passed: this.passed,
    };
  }
}

/** Identifiant de preuve, préfixé `ev`. */
export function newEvidenceId(): string {
  return newId('ev');
}

/** Champs facultatifs d'une entrée de preuve. */
export interface EvidenceRecordOptions {
  readonly actor?: string;
  readonly tenantId?: string;
  readonly projectId?: string;
  readonly tool?: string;
  readonly resource?: string;
  readonly commands?: readonly string[];
  readonly files?: readonly string[];
  readonly tests?: readonly Record<string, unknown>[];
  readonly security?: readonly Record<string, unknown>[];
  readonly errors?: readonly string[];
  readonly warnings?: readonly string[];
  readonly externalIds?: Readonly<Record<string, string>>;
  readonly validation?: ValidationOutcome;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly evidenceId?: string;
}

/** Vrai si la collection optionnelle doit être consignée : ni `undefined`, ni vide. */
function hasContent(value: unknown): boolean {
  if (value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (value !== null && typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

/** Magasin de preuves append-only, chaîné et validé par contrat. */
export class EvidenceStore extends ChainedJournal {
  constructor(sink: JournalSink | string, redactor?: Redactor) {
    super(
      sink,
      redactor === undefined
        ? { contract: EVIDENCE_CONTRACT }
        : { contract: EVIDENCE_CONTRACT, redactor },
    );
  }

  /** Identifiant de preuve (même valeur que la fabrique de module, exposée pour parité). */
  static newEvidenceId(): string {
    return newEvidenceId();
  }

  /**
   * Construit et ajoute une entrée de preuve.
   *
   * `status` est consigné tel quel : le magasin ne dégrade ni ne promeut un statut. En revanche,
   * `VERIFIED` exige une validation exécutée **et** réussie — sans quoi la preuve serait un
   * succès déclaré, pas un succès observé.
   */
  async record(
    operation: string,
    status: OperationStatus,
    options: EvidenceRecordOptions = {},
  ): Promise<JournalRecord> {
    if (status === OperationStatus.Verified) {
      const outcome = options.validation;
      if (outcome === undefined || !outcome.performed || !outcome.passed) {
        throw new VerificationRequiredError(
          'consigner une preuve VERIFIED exige une validation réellement exécutée et réussie',
          { context: { operation } },
        );
      }
    }

    const record: Record<string, unknown> = {
      evidence_id: options.evidenceId ?? newEvidenceId(),
      operation,
      status,
      recorded_at: utcNowIso(),
    };

    const scalars: ReadonlyArray<readonly [string, unknown]> = [
      ['actor', options.actor],
      ['tenant_id', options.tenantId],
      ['project_id', options.projectId],
      ['tool', options.tool],
      ['resource', options.resource],
      ['started_at', options.startedAt],
      ['completed_at', options.completedAt],
    ];
    for (const [key, value] of scalars) {
      if (value !== undefined) record[key] = value;
    }

    const collections: ReadonlyArray<readonly [string, unknown]> = [
      ['commands', options.commands],
      ['files', options.files],
      ['tests', options.tests],
      ['security', options.security],
      ['errors', options.errors],
      ['warnings', options.warnings],
      ['external_ids', options.externalIds],
    ];
    for (const [key, value] of collections) {
      if (hasContent(value)) record[key] = value;
    }

    if (options.validation !== undefined) {
      record.validation = options.validation.toJson();
    }

    return this.append(record);
  }
}
