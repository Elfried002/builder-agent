/**
 * Journal d'audit (`13_OPERATIONS/03_AUDIT.md`).
 *
 * Consigne qui, pour quel tenant et quel projet, a fait quoi, sur quelle ressource, quand, à quel
 * niveau de risque, avec quelle décision de politique, quelle approbation, quel outil, quel
 * résultat et quelle preuve. Le journal est append-only, chaîné par hachage, et numéroté de façon
 * strictement croissante.
 *
 * Le numéro de séquence est attribué par le journal lui-même, jamais par l'appelant : une
 * séquence fournie de l'extérieur est ignorée. La continuité depuis 0 est revérifiée à la lecture
 * (I-27), de sorte qu'un saut ou une suppression soit détecté.
 */

import { utcNowIso } from './ids.js';
import {
  ChainedJournal,
  type IntegrityIssue,
  type JournalRecord,
  type JournalSink,
  type Redactor,
} from './journal.js';
import type { OperationStatus, RiskClass } from './statuses.js';

const AUDIT_CONTRACT = 'audit_record';

/** Champs d'une entrée d'audit. */
export interface AuditActionOptions {
  readonly actor: string;
  readonly action: string;
  readonly resource: string;
  readonly riskClass: RiskClass;
  /** Statut réel du résultat ; une opération au statut incertain n'est pas promue `VERIFIED`. */
  readonly result: OperationStatus | string;
  readonly tenantId?: string;
  readonly projectId?: string;
  readonly policyDecisionId?: string;
  readonly approvalId?: string;
  readonly tool?: string;
  readonly evidenceId?: string;
  readonly timestamp?: string;
}

/** Journal d'audit append-only, chaîné et à séquence strictement croissante. */
export class AuditLedger extends ChainedJournal {
  constructor(sink: JournalSink | string, redactor?: Redactor) {
    super(
      sink,
      redactor === undefined
        ? { contract: AUDIT_CONTRACT }
        : { contract: AUDIT_CONTRACT, redactor },
    );
  }

  /**
   * Impose la séquence : `seq` vient du journal, jamais de l'appelant. Le recalcul se fait à
   * partir du dernier enregistrement réellement persisté, ce qui rend la numérotation infalsifiable
   * par l'entrée.
   */
  protected override async prepare(candidate: Record<string, unknown>): Promise<void> {
    const last = await this.lastRecord();
    candidate.seq = last === undefined ? 0 : Number(last.seq) + 1;
    candidate.timestamp = candidate.timestamp ?? utcNowIso();
  }

  /** Vérifie la continuité de la séquence depuis 0. */
  protected override check(record: JournalRecord, index: number, issues: IntegrityIssue[]): void {
    if (record.seq !== index) {
      issues.push({
        index,
        code: 'SEQUENCE_GAP',
        detail: `seq attendu ${index}, trouvé ${JSON.stringify(record.seq)}`,
      });
    }
  }

  /** Construit et ajoute une entrée d'audit. */
  async recordAction(options: AuditActionOptions): Promise<JournalRecord> {
    const record: Record<string, unknown> = {
      // `seq` est un gabarit : il est toujours réattribué par `prepare`.
      seq: 0,
      timestamp: options.timestamp ?? utcNowIso(),
      actor: options.actor,
      action: options.action,
      resource: options.resource,
      risk_class: options.riskClass,
      result: options.result,
    };

    const optional: ReadonlyArray<readonly [string, unknown]> = [
      ['tenant_id', options.tenantId],
      ['project_id', options.projectId],
      ['policy_decision_id', options.policyDecisionId],
      ['approval_id', options.approvalId],
      ['tool', options.tool],
      ['evidence_id', options.evidenceId],
    ];
    for (const [key, value] of optional) {
      if (value !== undefined) record[key] = value;
    }

    return this.append(record);
  }
}
