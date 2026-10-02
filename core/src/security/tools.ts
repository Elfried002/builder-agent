/**
 * Adaptateurs vers les outils de sécurité du monde Node.js/TypeScript.
 *
 * Le Core Python enveloppait `ruff`, `bandit` et `pip-audit`. L'écosystème Node n'a pas les mêmes
 * outils : la couverture est ici assurée par `biome` (analyse statique et qualité du code) et
 * `npm audit` (dépendances). Un outil absent n'est **jamais** compté comme un contrôle réussi.
 *
 * Chaque exécution produit un `ToolRun` qui distingue honnêtement :
 *
 *   - `EXECUTED`     — l'outil a réellement tourné et sa sortie a été lue ;
 *   - `NOT_EXECUTED` — l'outil est absent de l'environnement ;
 *   - `FAILED`       — l'outil a échoué ou produit une sortie illisible.
 *
 * Aucun adaptateur n'invente de constatation : une sortie non analysable devient un échec d'outil,
 * pas une liste vide silencieuse.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Severity, ToolRunState } from '../statuses.js';
import type { Finding, ToolRun } from './report.js';

const execFileAsync = promisify(execFile);

export const DEFAULT_TIMEOUT_MS = 600_000;

/** Racine du paquet : premier ancêtre contenant un `package.json`. */
export function packageRoot(start: string = fileURLToPath(import.meta.url)): string {
  let dir = dirname(start);
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dirname(start);
}

/** Résout un exécutable : d'abord le `node_modules/.bin` du paquet, puis le `PATH`. */
export function resolveExecutable(name: string): string | null {
  const local = join(packageRoot(), 'node_modules', '.bin', name);
  if (existsSync(local)) return local;
  const pathEntries = (process.env.PATH ?? '').split(':').filter((entry) => entry.length > 0);
  for (const entry of pathEntries) {
    const candidate = join(entry, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const NPM_SEVERITY: Readonly<Record<string, Severity>> = {
  info: Severity.Info,
  low: Severity.Low,
  moderate: Severity.Medium,
  high: Severity.High,
  critical: Severity.Critical,
};

/** Analyse la sortie JSON de `npm audit --json`. */
export function parseNpmAudit(payload: string): Finding[] {
  const data = JSON.parse(payload) as {
    vulnerabilities?: Record<
      string,
      { severity?: string; via?: unknown[]; range?: string; fixAvailable?: unknown }
    >;
  };
  const findings: Finding[] = [];
  for (const [name, entry] of Object.entries(data.vulnerabilities ?? {})) {
    const severity = NPM_SEVERITY[String(entry.severity ?? '').toLowerCase()] ?? Severity.Medium;
    const identifiers = (entry.via ?? [])
      .map((item) =>
        typeof item === 'object' && item !== null ? (item as { url?: string }).url : item,
      )
      .filter((item): item is string => typeof item === 'string' && item.length > 0);
    const remediation =
      entry.fixAvailable === false || entry.fixAvailable === undefined
        ? 'aucun correctif publié'
        : 'correctif disponible';
    findings.push({
      rule: `npm-audit:${name}`,
      severity,
      source: `${name}@${String(entry.range ?? '?')}`,
      message: `vulnérabilité connue dans ${name} (${remediation})${identifiers.length > 0 ? ` — ${identifiers[0]}` : ''}`,
    });
  }
  return findings;
}

const BIOME_SEVERITY: Readonly<Record<string, Severity>> = {
  error: Severity.Medium,
  warning: Severity.Low,
  information: Severity.Info,
  hint: Severity.Info,
};

/** Analyse la sortie JSON de `biome check --reporter=json`. */
export function parseBiome(payload: string): Finding[] {
  const data = JSON.parse(payload) as {
    diagnostics?: {
      category?: string;
      severity?: string;
      description?: string;
      message?: string;
      location?: { path?: { file?: string }; span?: [number, number] | null };
    }[];
  };
  return (data.diagnostics ?? []).map((diagnostic) => {
    const category = String(diagnostic.category ?? 'biome');
    return {
      rule: `biome:${category}`,
      severity: BIOME_SEVERITY[String(diagnostic.severity ?? '').toLowerCase()] ?? Severity.Low,
      source: diagnostic.location?.path?.file ?? '<projet>',
      message: diagnostic.message ?? diagnostic.description ?? category,
    } satisfies Finding;
  });
}

export interface ToolSpec {
  readonly name: string;
  readonly buildArgv: (executable: string, target: string) => string[];
  readonly parse: (payload: string) => Finding[];
  /** Codes de sortie normaux : certains outils signalent « rien trouvé » par un code non nul. */
  readonly expectedExitCodes: readonly number[];
}

export const TOOL_SPECS: Readonly<Record<string, ToolSpec>> = {
  biome: {
    name: 'biome',
    buildArgv: (executable, target) => [
      executable,
      'check',
      target,
      '--reporter=json',
      '--max-diagnostics=500',
    ],
    parse: parseBiome,
    expectedExitCodes: [0, 1],
  },
  'npm-audit': {
    name: 'npm-audit',
    buildArgv: (executable) => [executable, 'audit', '--json'],
    parse: parseNpmAudit,
    expectedExitCodes: [0, 1],
  },
};

export interface RunToolOptions {
  readonly workdir?: string;
  readonly timeoutMs?: number;
}

/** Exécute un outil de sécurité et renvoie ses constatations et la trace de son exécution. */
export async function runTool(
  name: string,
  target: string,
  options: RunToolOptions = {},
): Promise<{ findings: Finding[]; run: ToolRun }> {
  const spec = TOOL_SPECS[name];
  if (spec === undefined) {
    throw new Error(
      `outil non pris en charge : ${name} (connus : ${Object.keys(TOOL_SPECS).join(', ')})`,
    );
  }
  const executableName = name === 'npm-audit' ? 'npm' : name;
  const executable = resolveExecutable(executableName);
  if (executable === null) {
    return {
      findings: [],
      run: {
        tool: name,
        state: ToolRunState.NotExecuted,
        detail: "outil absent de l'environnement : contrôle non effectué",
      },
    };
  }

  const argv = spec.buildArgv(executable, target);
  try {
    const { stdout } = await execFileAsync(argv[0] ?? '', argv.slice(1), {
      cwd: options.workdir ?? dirname(target),
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBuffer: 32 * 1024 * 1024,
    });
    return {
      findings: spec.parse(stdout),
      run: { tool: name, state: ToolRunState.Executed, exitCode: 0, command: argv },
    };
  } catch (error) {
    const failure = error as { code?: number | string; stdout?: string; stderr?: string };
    const exitCode = typeof failure.code === 'number' ? failure.code : null;
    if (exitCode !== null && spec.expectedExitCodes.includes(exitCode) && failure.stdout) {
      try {
        const findings = spec.parse(failure.stdout);
        return {
          findings,
          run: {
            tool: name,
            state: ToolRunState.Executed,
            detail: `${findings.length} constatation(s)`,
            exitCode,
            command: argv,
          },
        };
      } catch {
        // Sortie illisible malgré un code attendu : c'est un échec d'outil, pas un succès vide.
      }
    }
    const detail = (failure.stderr ?? '').trim().slice(0, 500);
    return {
      findings: [],
      run: {
        tool: name,
        state: ToolRunState.Failed,
        detail:
          exitCode === null
            ? `exécution impossible : ${detail}`
            : `code de sortie ${exitCode} : ${detail}`,
        ...(exitCode === null ? {} : { exitCode }),
        command: argv,
      },
    };
  }
}

/** Exécute plusieurs outils à la suite et agrège constatations et traces. */
export async function runTools(
  names: readonly string[],
  target: string,
  options: RunToolOptions = {},
): Promise<{ findings: Finding[]; runs: ToolRun[] }> {
  const findings: Finding[] = [];
  const runs: ToolRun[] = [];
  for (const name of names) {
    const result = await runTool(name, target, options);
    findings.push(...result.findings);
    runs.push(result.run);
  }
  return { findings, runs };
}
