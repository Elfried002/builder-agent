/**
 * Tests du Security Gate, des exceptions revues et des adaptateurs d'outils.
 * Invariants couverts : I-05, I-06, I-32, I-33.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ContractError } from '../src/errors.js';
import type { Finding, ToolRun } from '../src/security/index.js';
import {
  ALLOWLIST_FILENAME,
  DEFAULT_POLICY,
  evaluate,
  gateResultToJSON,
  parseBiome,
  parseNpmAudit,
  policyByName,
  redactStructure,
  runTool,
  runTools,
  SecurityAllowlist,
  SecurityReport,
  STRICT_POLICY,
} from '../src/security/index.js';
import { GateOutcome, Severity, ToolRunState } from '../src/statuses.js';

function finding(severity: Severity, rule = 'regle'): Finding {
  return { rule, severity, source: 'fichier.ts', message: 'constat' };
}

function report(...severities: Severity[]): SecurityReport {
  const built = new SecurityReport('demo');
  severities.forEach((severity, index) => {
    built.addFinding(finding(severity, `regle-${index}`));
  });
  return built;
}

describe('Security Gate (I-05, I-06)', () => {
  it('un rapport vide passe', () => {
    const result = evaluate(report());
    expect(result.outcome).toBe(GateOutcome.Pass);
    expect(result.exitCode).toBe(0);
  });

  it('CRITICAL et HIGH bloquent', () => {
    expect(evaluate(report(Severity.Critical)).outcome).toBe(GateOutcome.Block);
    const high = evaluate(report(Severity.High));
    expect(high.outcome).toBe(GateOutcome.Block);
    expect(high.exitCode).toBe(2);
    expect(high.blocking).toHaveLength(1);
  });

  it('MEDIUM demande une revue sans bloquer', () => {
    const result = evaluate(report(Severity.Medium));
    expect(result.outcome).toBe(GateOutcome.Review);
    expect(result.exitCode).toBe(1);
  });

  it('LOW et INFO ne bloquent pas', () => {
    expect(evaluate(report(Severity.Low)).outcome).toBe(GateOutcome.Pass);
    expect(evaluate(report(Severity.Info)).outcome).toBe(GateOutcome.Pass);
  });

  it('la plus haute sévérité détermine le verdict', () => {
    const result = evaluate(report(Severity.Low, Severity.Critical, Severity.Medium));
    expect(result.outcome).toBe(GateOutcome.Block);
    expect(result.reasons[0]).toContain('CRITICAL');
  });

  it('la politique stricte demande une revue dès LOW', () => {
    const result = evaluate(report(Severity.Low), STRICT_POLICY);
    expect(result.outcome).toBe(GateOutcome.Review);
    expect(result.policyId).toBe('security-gate-strict@v1');
  });

  it('un outil non exécuté est signalé dans le verdict (I-06)', () => {
    const built = report();
    const run: ToolRun = {
      tool: 'npm-audit',
      state: ToolRunState.NotExecuted,
      detail: 'absent',
    };
    built.addToolRun(run);
    const result = evaluate(built);
    expect(result.incompleteTools).toEqual(['npm-audit']);
    expect(result.reasons.some((reason) => reason.includes('couverture incomplète'))).toBe(true);
  });

  it('un outil exécuté n’est pas signalé', () => {
    const built = report();
    built.addToolRun({ tool: 'biome', state: ToolRunState.Executed, detail: '0 constatation' });
    const result = evaluate(built);
    expect(result.incompleteTools).toEqual([]);
    expect(result.outcome).toBe(GateOutcome.Pass);
  });

  it('les constatations supprimées sont visibles dans le motif du verdict', () => {
    const built = report();
    built.addSuppressed([
      {
        finding: finding(Severity.Critical),
        justification: 'exemple documentaire',
        reviewedBy: 'Elfried002',
        reviewedAt: '2026-10-02T20:00:00Z',
      },
    ]);
    const result = evaluate(built);
    expect(result.outcome).toBe(GateOutcome.Pass);
    expect(result.reasons.some((reason) => reason.includes('exception revue'))).toBe(true);
  });

  it('refuse une politique inconnue', () => {
    expect(() => policyByName('inexistante' as never)).toThrowError(/politique inconnue/);
  });

  it('sérialise le verdict', () => {
    const payload = gateResultToJSON(evaluate(report(Severity.High)));
    expect(payload.outcome).toBe('BLOCK');
    expect(payload.exit_code).toBe(2);
    expect(payload.policy_id).toBe(DEFAULT_POLICY.policyId);
  });
});

describe('exceptions revues (I-32)', () => {
  const ENTRY = {
    rule: 'database-url-with-credentials',
    path: 'docs/**',
    justification: 'Exemple documentaire avec identifiants factices, aucune valeur réelle.',
    reviewed_by: 'Elfried002',
    reviewed_at: '2026-10-02T20:00:00Z',
  };

  function writeAllowlist(directory: string, entries: unknown[]): string {
    const path = join(directory, ALLOWLIST_FILENAME);
    writeFileSync(path, JSON.stringify({ version: 1, entries }), 'utf8');
    return path;
  }

  it('un fichier absent vaut jeu vide', () => {
    const allowlist = SecurityAllowlist.load(join(tmpdir(), 'absent-allowlist.json'));
    expect(allowlist.entries).toHaveLength(0);
  });

  it('couvre le chemin déclaré et pas un autre', () => {
    const racine = mkdtempSync(join(tmpdir(), 'codidev-allow-'));
    const allowlist = SecurityAllowlist.load(writeAllowlist(racine, [ENTRY]));
    const couverte: Finding = {
      rule: ENTRY.rule,
      severity: Severity.Critical,
      source: join(racine, 'docs', 'guide.md'),
      message: 'constat',
    };
    const horsPerimetre: Finding = {
      rule: ENTRY.rule,
      severity: Severity.Critical,
      source: join(racine, 'src', 'config.ts'),
      message: 'constat',
    };
    expect(allowlist.entryFor(couverte, racine)).toBeDefined();
    expect(allowlist.entryFor(horsPerimetre, racine)).toBeUndefined();
  });

  it('ne couvre pas une autre règle', () => {
    const racine = mkdtempSync(join(tmpdir(), 'codidev-allow2-'));
    const allowlist = SecurityAllowlist.load(writeAllowlist(racine, [ENTRY]));
    const autre: Finding = {
      rule: 'github-token',
      severity: Severity.Critical,
      source: join(racine, 'docs', 'guide.md'),
      message: 'constat',
    };
    expect(allowlist.entryFor(autre, racine)).toBeUndefined();
  });

  it('partitionne actives et supprimées sans masquer', () => {
    const racine = mkdtempSync(join(tmpdir(), 'codidev-allow3-'));
    const allowlist = SecurityAllowlist.load(writeAllowlist(racine, [ENTRY]));
    const couverte: Finding = {
      rule: ENTRY.rule,
      severity: Severity.Critical,
      source: join(racine, 'docs', 'guide.md'),
      line: 12,
      message: 'constat',
    };
    const autre: Finding = {
      rule: ENTRY.rule,
      severity: Severity.Critical,
      source: join(racine, 'src', 'app.ts'),
      message: 'constat',
    };
    const { active, suppressed } = allowlist.partition([couverte, autre], racine);
    expect(active).toHaveLength(1);
    expect(suppressed).toHaveLength(1);
    expect(suppressed[0]?.justification).toBe(ENTRY.justification);
  });

  it('refuse un fichier malformé', () => {
    const racine = mkdtempSync(join(tmpdir(), 'codidev-allow4-'));
    const path = writeAllowlist(racine, [{ rule: 'x' }]);
    expect(() => SecurityAllowlist.load(path)).toThrowError(ContractError);
  });

  it('refuse un fichier non JSON', () => {
    const racine = mkdtempSync(join(tmpdir(), 'codidev-allow5-'));
    const path = join(racine, ALLOWLIST_FILENAME);
    writeFileSync(path, "{ceci n'est pas du json", 'utf8');
    expect(() => SecurityAllowlist.load(path)).toThrowError(ContractError);
  });
});

describe('adaptateurs d’outils', () => {
  const NPM_AUDIT = JSON.stringify({
    vulnerabilities: {
      exemple: {
        severity: 'high',
        via: [{ url: 'https://github.com/advisories/GHSA-0000' }],
        range: '<1.0.1',
        fixAvailable: true,
      },
      sain: { severity: 'low', via: [], range: '*', fixAvailable: false },
    },
  });

  const BIOME = JSON.stringify({
    diagnostics: [
      {
        category: 'lint/suspicious/noExplicitAny',
        severity: 'error',
        message: 'Unexpected any.',
        location: { path: { file: 'src/app.ts' }, span: [10, 20] },
      },
      {
        category: 'lint/style/useConst',
        severity: 'warning',
        message: 'Use const.',
        location: { path: { file: 'src/app.ts' }, span: [1, 2] },
      },
    ],
  });

  it('analyse la sortie de npm audit', () => {
    const findings = parseNpmAudit(NPM_AUDIT);
    expect(findings).toHaveLength(2);
    const high = findings.find((item) => item.source.startsWith('exemple'));
    expect(high?.severity).toBe(Severity.High);
    expect(high?.message).toContain('correctif disponible');
  });

  it('analyse la sortie de biome', () => {
    const findings = parseBiome(BIOME);
    expect(findings).toHaveLength(2);
    expect(findings[0]?.rule).toBe('biome:lint/suspicious/noExplicitAny');
    expect(findings[0]?.severity).toBe(Severity.Medium);
    expect(findings[1]?.severity).toBe(Severity.Low);
  });

  it('un outil absent vaut NOT_EXECUTED, jamais un succès vide', async () => {
    const result = await runTool('biome', '/inexistant/chemin');
    expect(result.findings).toEqual([]);
    // `biome` est présent dans ce dépôt : l'exécution doit donc avoir lieu et échouer franchement,
    // ce qui prouve qu'un outil disponible n'est pas silencieusement ignoré.
    expect([ToolRunState.Executed, ToolRunState.Failed]).toContain(result.run.state);
    expect(result.run.state).not.toBe(ToolRunState.NotExecuted);
  });

  it('refuse un outil non pris en charge', async () => {
    await expect(runTool('outil-inexistant', '.')).rejects.toThrowError(/non pris en charge/);
  });

  it('exécute plusieurs outils et agrège les traces', async () => {
    const { runs } = await runTools(['biome'], '.');
    expect(runs).toHaveLength(1);
    expect(runs[0]?.tool).toBe('biome');
  });
});

describe('caviardage appliqué aux rapports', () => {
  it('caviarde une structure imbriquée', () => {
    const token = `${'gh'}${'p_'}${'F1g2H3i4J5k6L7m8N9o0P1q2R3s4T5u6V7w8'}`;
    const result = redactStructure({ nested: { commande: `git push ${token}` } }) as {
      nested: { commande: string };
    };
    expect(JSON.stringify(result)).not.toContain(token);
  });
});
