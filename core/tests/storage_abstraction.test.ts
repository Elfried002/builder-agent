/**
 * Tests de l'abstraction de stockage : contrats injectables, validateurs précompilés,
 * journal en mémoire et cœur assemblé sur des supports fournis par l'appelant.
 *
 * Le comportement par défaut (contrats lus sur disque, journaux fichiers) reste couvert par les
 * autres fichiers de test, qui ne sont pas modifiés.
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import standaloneModule from 'ajv/dist/standalone/index.js';

import { describe, expect, it } from 'vitest';
import {
  AUDIT_FILENAME,
  AuditLedger,
  CONTRACT_NAMES,
  CodiDevCore,
  CodiDevError,
  ContractError,
  type ContractName,
  type ContractValidator,
  createContractAjv,
  EVIDENCE_FILENAME,
  EvidenceStore,
  isValid,
  iterErrors,
  loadSchema,
  MemoryJournalSink,
  OperationStatus,
  RiskClass,
  registerContracts,
  TaskState,
} from '../src/index.js';
import type { MockStep } from '../src/llm/index.js';

type StandaloneCode = (ajv: unknown, refs: Record<string, string>) => string;
const standaloneCode = ((standaloneModule as unknown as { default?: StandaloneCode }).default ??
  (standaloneModule as unknown as StandaloneCode)) as StandaloneCode;

/** Module ESM de validateurs précompilés, construit avec la même instance Ajv que le cœur. */
function buildStandaloneValidators(): string {
  const refs: Record<string, string> = {};
  for (const name of CONTRACT_NAMES) {
    const schema = loadSchema(name);
    refs[name] =
      typeof schema.$id === 'string' ? schema.$id : `https://codidev.local/schemas/${name}.json`;
  }
  return standaloneCode(createContractAjv({ source: true, esm: true }), refs);
}

function schemasFromDisk(): Record<ContractName, Record<string, unknown>> {
  const out = {} as Record<ContractName, Record<string, unknown>>;
  for (const name of CONTRACT_NAMES) out[name] = structuredClone(loadSchema(name));
  return out;
}

const ACTION_VALIDE = {
  action_id: 'act_0123456789abcdef',
  kind: 'WRITE',
  tool: 'file.write',
  target: 'src/app.ts',
  tenant_id: 'tenant-a',
  requested_at: '2026-10-02T20:00:00Z',
};

function scenario(): MockStep[] {
  return [
    { structured: { category: 'MODIFY_SOFTWARE', confidence: 0.9, statement: 'durcir' } },
    {
      structured: {
        steps: [
          {
            description: 'ajouter la validation',
            expected_output: 'entrée invalide refusée',
            verification: ['test unitaire'],
          },
        ],
      },
    },
  ];
}

function coreOptions() {
  return {
    env: {},
    llm: {
      provider: 'mock' as const,
      model: 'mock-model',
      apiKeyEnvVar: 'CODIDEV_DEEPSEEK_API_KEY',
      baseUrl: 'https://exemple.invalid',
      timeoutMs: 1000,
      maxRetries: 0,
      maxTokens: 1024,
      temperature: 0,
    },
    mockSteps: scenario(),
  };
}

describe('MemoryJournalSink', () => {
  it('absent tant que rien n’est écrit, puis lecture dans l’ordre d’écriture', async () => {
    const sink = new MemoryJournalSink('memory://test');
    expect(sink.location).toBe('memory://test');
    expect(await sink.exists()).toBe(false);
    await sink.appendLine('{"a":1}');
    await sink.appendLine('  ');
    await sink.appendLine('{"a":2}');
    expect(await sink.exists()).toBe(true);
    const lus: string[] = [];
    for await (const ligne of sink.readLines()) lus.push(ligne);
    expect(lus).toEqual(['{"a":1}', '{"a":2}']);
  });

  it('lines() rend une copie : l’appelant ne peut pas réécrire le journal', async () => {
    const sink = new MemoryJournalSink();
    await sink.appendLine('x');
    const copie = sink.lines() as string[];
    copie.push('y');
    expect(sink.lines()).toEqual(['x']);
  });

  it('preuves chaînées sur support mémoire : intègres, puis altération détectée', async () => {
    const sink = new MemoryJournalSink();
    const store = new EvidenceStore(sink);
    await store.record('op.a', OperationStatus.Executed, { actor: 'u1' });
    await store.record('op.b', OperationStatus.NotExecuted);
    const rapport = await store.verify();
    expect(rapport.ok).toBe(true);
    expect(rapport.count).toBe(2);

    const lignes = sink.lines().map((l) => l.replace('"op.a"', '"op.z"'));
    const altere = await new EvidenceStore(
      new MemoryJournalSink('memory://altere', lignes),
    ).verify();
    expect(altere.ok).toBe(false);
    expect(altere.issues.some((issue) => issue.code === 'HASH_MISMATCH')).toBe(true);
  });

  it('journal mémoire vide signalé MISSING, comme un fichier absent', async () => {
    const rapport = await new AuditLedger(new MemoryJournalSink()).verify();
    expect(rapport.issues.map((issue) => issue.code)).toEqual(['MISSING']);
  });

  it('audit sur support mémoire : séquence imposée par le journal', async () => {
    const ledger = new AuditLedger(new MemoryJournalSink());
    const base = {
      actor: 'u1',
      action: 'x',
      resource: 'r',
      riskClass: RiskClass.Read,
      result: OperationStatus.Executed,
    };
    const a = await ledger.recordAction(base);
    const b = await ledger.recordAction(base);
    expect([a.seq, b.seq]).toEqual([0, 1]);
    expect((await ledger.verify()).ok).toBe(true);
  });
});

describe('CodiDevCore avec supports fournis', () => {
  it('cycle complet sans système de fichiers : preuves et audit dans les supports fournis', async () => {
    const evidenceSink = new MemoryJournalSink('memory://evidence');
    const auditSink = new MemoryJournalSink('memory://audit');
    const core = new CodiDevCore({ ...coreOptions(), evidenceSink, auditSink });
    expect(core.workspaceDir).toBe('');

    const resultat = await core.run(
      { text: 'durcir la validation', tenantId: 'tenant-a', actor: 'user-1' },
      { useLlmForPlan: true },
    );
    expect(resultat.status).toBe(OperationStatus.NotExecuted);
    expect(resultat.task?.state).toBe(TaskState.Proposed);
    expect(evidenceSink.lines().length).toBeGreaterThan(0);
    expect(auditSink.lines().length).toBeGreaterThan(0);

    const integrite = await core.integrity();
    expect(integrite.evidence.ok).toBe(true);
    expect(integrite.audit.ok).toBe(true);
    expect(integrite.evidence.path).toBe('memory://evidence');
  });

  it('un seul support fourni : l’autre reste un fichier dans workspaceDir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'codidev-mixte-'));
    const auditSink = new MemoryJournalSink();
    const core = new CodiDevCore({ ...coreOptions(), workspaceDir: dir, auditSink });
    await core.run({ text: 'durcir', tenantId: 'tenant-a', actor: 'u' }, { useLlmForPlan: true });
    expect(existsSync(join(dir, EVIDENCE_FILENAME))).toBe(true);
    expect(existsSync(join(dir, AUDIT_FILENAME))).toBe(false);
    expect(auditSink.lines().length).toBeGreaterThan(0);
  });

  it('ni support ni workspaceDir : erreur explicite', () => {
    expect(() => new CodiDevCore({ ...coreOptions() })).toThrowError(CodiDevError);
  });
});

describe('contrats injectés', () => {
  it('registerContracts refuse un ensemble incomplet', () => {
    const schemas = schemasFromDisk() as Partial<Record<ContractName, Record<string, unknown>>>;
    delete schemas.task;
    expect(() =>
      registerContracts({ schemas: schemas as Record<ContractName, Record<string, unknown>> }),
    ).toThrowError(ContractError);
  });

  it('schémas fournis sans validateurs : validation identique à la lecture disque', () => {
    const avant = iterErrors('action', { ...ACTION_VALIDE, kind: 'NOPE' });
    registerContracts({ schemas: schemasFromDisk() });
    expect(isValid('action', ACTION_VALIDE)).toBe(true);
    expect(iterErrors('action', { ...ACTION_VALIDE, kind: 'NOPE' })).toEqual(avant);
  });

  it('un validateur fourni est réellement utilisé', () => {
    const refuseTout: ContractValidator = Object.assign(() => false, {
      errors: [
        { instancePath: '/x', message: 'refus injecté', params: {}, keyword: 'k', schemaPath: '#' },
      ],
    });
    registerContracts({ schemas: schemasFromDisk(), validators: { action: refuseTout } });
    expect(iterErrors('action', ACTION_VALIDE)).toEqual(['x: refus injecté {}']);
    registerContracts({ schemas: schemasFromDisk() });
    expect(isValid('action', ACTION_VALIDE)).toBe(true);
  });

  it('validateurs précompilés (standalone) : mêmes verdicts et mêmes messages que Ajv', async () => {
    const reference = {
      ok: iterErrors('action', ACTION_VALIDE),
      ko: iterErrors('action', { ...ACTION_VALIDE, kind: 'NOPE', requested_at: 'hier' }),
      tache: iterErrors('task', {}),
    };
    const source = buildStandaloneValidators();
    expect(source).not.toContain('new Function');
    // Le code standalone contient des `require` (ajv, ajv-formats) résolus depuis l'emplacement
    // du fichier : on l'écrit dans le paquet pour résoudre les dépendances épinglées du cœur, et
    // non un éventuel `node_modules` situé au-dessus du répertoire temporaire du système.
    const paquet = fileURLToPath(new URL('..', import.meta.url));
    const dossier = mkdtempSync(join(paquet, '.standalone-'));
    const fichier = join(dossier, 'validators.mjs');
    writeFileSync(fichier, source);
    let module: Record<string, ContractValidator>;
    try {
      module = (await import(pathToFileURL(fichier).href)) as Record<string, ContractValidator>;
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
    const validators: Partial<Record<ContractName, ContractValidator>> = {};
    for (const name of CONTRACT_NAMES) {
      const validator = module[name];
      expect(typeof validator).toBe('function');
      if (validator !== undefined) validators[name] = validator;
    }
    registerContracts({ schemas: schemasFromDisk(), validators });
    expect(iterErrors('action', ACTION_VALIDE)).toEqual(reference.ok);
    expect(iterErrors('action', { ...ACTION_VALIDE, kind: 'NOPE', requested_at: 'hier' })).toEqual(
      reference.ko,
    );
    expect(iterErrors('task', {})).toEqual(reference.tache);
    expect(reference.ko.length).toBeGreaterThan(0);
  });
});
