/**
 * Security Gate : traduction d'un rapport de scan en verdict bloquant ou non.
 *
 * Règle par défaut :
 *
 *     CRITICAL -> BLOCK      HIGH   -> BLOCK
 *     MEDIUM   -> REVIEW     LOW    -> WARNING      INFO -> INFORMATIONAL
 *
 * Un prompt en langage naturel ne contourne jamais ce gate : il ne lit qu'un rapport de scan.
 * C'est ici, et nulle part ailleurs, qu'un agent apprend si son travail est publiable.
 */

import { GateOutcome, gateExitCode, Severity, severityRank } from '../statuses.js';
import type { Finding, SecurityReport } from './report.js';

export const ACTION_BLOCK = 'BLOCK';
export const ACTION_REVIEW = 'REVIEW';
export const ACTION_WARNING = 'WARNING';
export const ACTION_INFORMATIONAL = 'INFORMATIONAL';

export type GateAction =
  | typeof ACTION_BLOCK
  | typeof ACTION_REVIEW
  | typeof ACTION_WARNING
  | typeof ACTION_INFORMATIONAL;

export interface GatePolicy {
  readonly policyId: string;
  readonly actions: Readonly<Record<Severity, GateAction>>;
}

/** Politique par défaut : bloque sur CRITICAL et HIGH. */
export const DEFAULT_POLICY: GatePolicy = {
  policyId: 'security-gate@v1',
  actions: {
    CRITICAL: ACTION_BLOCK,
    HIGH: ACTION_BLOCK,
    MEDIUM: ACTION_REVIEW,
    LOW: ACTION_WARNING,
    INFO: ACTION_INFORMATIONAL,
  },
};

/** Politique exigeant une revue humaine dès la moindre sévérité LOW, sans bloquer la CI. */
export const STRICT_POLICY: GatePolicy = {
  policyId: 'security-gate-strict@v1',
  actions: {
    CRITICAL: ACTION_BLOCK,
    HIGH: ACTION_BLOCK,
    MEDIUM: ACTION_REVIEW,
    LOW: ACTION_REVIEW,
    INFO: ACTION_WARNING,
  },
};

export type PolicyName = 'default' | 'strict';

export function policyByName(name: PolicyName): GatePolicy {
  if (name === 'default') return DEFAULT_POLICY;
  if (name === 'strict') return STRICT_POLICY;
  throw new Error(`politique inconnue : ${String(name)}`);
}

export interface GateResult {
  readonly outcome: GateOutcome;
  readonly policyId: string;
  readonly exitCode: number;
  readonly reasons: readonly string[];
  readonly blocking: readonly Finding[];
  readonly incompleteTools: readonly string[];
}

/**
 * Évalue un rapport de scan et rend le verdict du gate.
 *
 * Un outil de sécurité qui n'a pas réellement été exécuté est signalé dans `incompleteTools` : le
 * verdict reste calculé sur ce qui a été observé, mais l'incomplétude est visible et ne peut pas
 * être confondue avec un contrôle réussi.
 */
export function evaluate(report: SecurityReport, policy: GatePolicy = DEFAULT_POLICY): GateResult {
  const actionFor = (severity: Severity): GateAction => policy.actions[severity];
  const blocking = report.findings.filter(
    (finding) => actionFor(finding.severity) === ACTION_BLOCK,
  );
  const review = report.findings.filter((finding) => actionFor(finding.severity) === ACTION_REVIEW);
  const incompleteTools = report.toolRuns
    .filter((run) => run.state !== 'EXECUTED')
    .map((run) => run.tool);

  const reasons: string[] = [];
  if (blocking.length > 0) {
    const worst = blocking.reduce<Severity>(
      (highest, finding) =>
        severityRank(finding.severity) > severityRank(highest) ? finding.severity : highest,
      blocking[0]?.severity ?? Severity.Info,
    );
    reasons.push(
      `${blocking.length} constatation(s) bloquante(s) (verdict BLOCK) — plus haute sévérité : ${worst}`,
    );
  }
  if (review.length > 0) {
    reasons.push(`${review.length} constatation(s) à revoir (verdict REVIEW)`);
  }
  if (incompleteTools.length > 0) {
    reasons.push(
      `outil(s) non exécuté(s), couverture incomplète : ${[...new Set(incompleteTools)].sort().join(', ')}`,
    );
  }
  if (report.suppressed.length > 0) {
    reasons.push(
      `${report.suppressed.length} constatation(s) supprimée(s) par exception revue ` +
        '(voir le rapport, jamais masquées)',
    );
  }
  if (reasons.length === 0) {
    reasons.push('aucune constatation au-dessus du seuil de revue');
  }

  const outcome =
    blocking.length > 0
      ? GateOutcome.Block
      : review.length > 0
        ? GateOutcome.Review
        : GateOutcome.Pass;

  return {
    outcome,
    policyId: policy.policyId,
    exitCode: gateExitCode(outcome),
    reasons,
    blocking,
    incompleteTools: [...new Set(incompleteTools)],
  };
}

/** Sérialisation du verdict, telle qu'elle apparaît dans un rapport. */
export function gateResultToJSON(result: GateResult): Record<string, unknown> {
  return {
    outcome: result.outcome,
    policy_id: result.policyId,
    exit_code: result.exitCode,
    reasons: [...result.reasons],
    blocking: [...result.blocking],
    incomplete_tools: [...result.incompleteTools],
  };
}
