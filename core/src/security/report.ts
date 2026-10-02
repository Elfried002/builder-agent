/**
 * Modèle de rapport de sécurité : constatations, sévérités et exécutions d'outils.
 *
 * Aucune constatation n'est inventée : chaque `Finding` provient d'une règle réellement appliquée
 * ou d'une sortie d'outil réellement lue. Les structures sont de simples objets sérialisables —
 * un rapport doit pouvoir être écrit, relu et comparé sans dépendre du code qui l'a produit.
 */

import { Severity, severityRank, type ToolRunState } from '../statuses.js';

/** Constatation de sécurité située. */
export interface Finding {
  readonly rule: string;
  readonly severity: Severity;
  readonly source: string;
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
  /** Extrait de ligne caviardé : jamais le secret en clair. */
  readonly excerpt?: string;
}

/**
 * Trace d'exécution d'un outil de sécurité externe.
 *
 * `state` distingue explicitement l'exécution réelle (`EXECUTED`), l'absence d'outil
 * (`NOT_EXECUTED`) et l'échec (`FAILED`) : un outil indisponible n'est jamais compté comme vert.
 */
export interface ToolRun {
  readonly tool: string;
  readonly state: ToolRunState;
  readonly detail?: string;
  readonly exitCode?: number;
  readonly command?: readonly string[];
}

/** Constatation couverte par une exception revue, conservée pour la traçabilité. */
export interface SuppressedFinding {
  readonly finding: Finding;
  readonly justification: string;
  readonly reviewedBy: string;
  readonly reviewedAt: string;
}

/** Rapport agrégé d'une campagne de scan. */
export class SecurityReport {
  readonly target: string;
  readonly findings: Finding[] = [];
  readonly toolRuns: ToolRun[] = [];
  readonly suppressed: SuppressedFinding[] = [];

  constructor(target: string) {
    this.target = target;
  }

  addFinding(finding: Finding): void {
    this.findings.push(finding);
  }

  extend(findings: readonly Finding[]): void {
    this.findings.push(...findings);
  }

  addToolRun(run: ToolRun): void {
    this.toolRuns.push(run);
  }

  /** Consigne les constatations couvertes par une exception revue (jamais masquées). */
  addSuppressed(suppressed: readonly SuppressedFinding[]): void {
    this.suppressed.push(...suppressed);
  }

  countsBySeverity(): Record<Severity, number> {
    const counts = new Map<Severity, number>([
      [Severity.Info, 0],
      [Severity.Low, 0],
      [Severity.Medium, 0],
      [Severity.High, 0],
      [Severity.Critical, 0],
    ]);
    for (const finding of this.findings) {
      counts.set(finding.severity, (counts.get(finding.severity) ?? 0) + 1);
    }
    return {
      INFO: counts.get(Severity.Info) ?? 0,
      LOW: counts.get(Severity.Low) ?? 0,
      MEDIUM: counts.get(Severity.Medium) ?? 0,
      HIGH: counts.get(Severity.High) ?? 0,
      CRITICAL: counts.get(Severity.Critical) ?? 0,
    };
  }

  maxSeverity(): Severity | null {
    if (this.findings.length === 0) return null;
    return this.findings.reduce<Severity>(
      (highest, finding) =>
        severityRank(finding.severity) > severityRank(highest) ? finding.severity : highest,
      this.findings[0]?.severity ?? Severity.Info,
    );
  }

  toolsNotExecuted(): string[] {
    return this.toolRuns.filter((run) => run.state !== 'EXECUTED').map((run) => run.tool);
  }

  toJSON(): Record<string, unknown> {
    return {
      target: this.target,
      counts: this.countsBySeverity(),
      max_severity: this.maxSeverity(),
      findings: this.findings,
      tool_runs: this.toolRuns,
      tools_not_executed: this.toolsNotExecuted(),
      suppressed: this.suppressed,
    };
  }
}
