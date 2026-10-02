/**
 * Tests du socle de journalisation : journal chaîné, support de journalisation, preuves, audit.
 *
 * Ces tests portent les invariants de sécurité du socle (I-27 à I-29, I-15) : toute altération est
 * détectable, aucune API de réécriture ni de suppression n'existe, tout contenu est caviardé
 * avant persistance, et la séquence d'audit est attribuée par le journal lui-même. Ils vérifient
 * aussi que le chaînage survit au remplacement du support (`JournalSink`).
 */

import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AuditLedger } from '../src/audit.js';
import { ContractError, VerificationRequiredError } from '../src/errors.js';
import { EvidenceStore, newEvidenceId, ValidationOutcome } from '../src/evidence.js';
import { GENESIS_HASH } from '../src/hashing.js';
import { FileJournalSink, type JournalSink } from '../src/journal.js';
import { OperationStatus, RiskClass } from '../src/statuses.js';

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'codidev-journal-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function evidencePath(name = 'preuves.jsonl'): string {
  return join(directory, name);
}

function auditPath(name = 'audit.jsonl'): string {
  return join(directory, name);
}

/** Accès sûr à une ligne : `noUncheckedIndexedAccess` interdit de supposer sa présence. */
function line(lines: readonly string[], index: number): string {
  const value = lines[index];
  if (value === undefined) throw new Error(`ligne absente : ${index}`);
  return value;
}

async function readLines(path: string): Promise<string[]> {
  const text = await readFile(path, 'utf8');
  return text.split('\n').filter((value) => value.length > 0);
}

async function collect(source: AsyncIterable<string>): Promise<string[]> {
  const items: string[] = [];
  for await (const item of source) items.push(item);
  return items;
}

function recordEvidence(store: EvidenceStore, operation = 'vérification') {
  return store.record(operation, OperationStatus.Executed, {
    actor: 'acteur-test',
    resource: 'src/codidev',
    commands: ['pytest -q'],
  });
}

function recordAudit(ledger: AuditLedger, action = 'scan') {
  return ledger.recordAction({
    actor: 'acteur-test',
    action,
    resource: 'src/codidev',
    riskClass: RiskClass.Read,
    result: OperationStatus.Executed,
    tenantId: 'tenant-a',
  });
}

describe('journal chaîné — preuves', () => {
  it('le premier enregistrement part du genesis', async () => {
    const store = new EvidenceStore(evidencePath());
    const record = await recordEvidence(store);
    expect(record.prev_hash).toBe(GENESIS_HASH);
    expect(String(record.hash)).toHaveLength(64);
  });

  it('chaîne deux enregistrements', async () => {
    const store = new EvidenceStore(evidencePath());
    const first = await recordEvidence(store, 'opération-1');
    const second = await recordEvidence(store, 'opération-2');
    expect(second.prev_hash).toBe(first.hash);
    expect(await store.count()).toBe(2);
  });

  it("valide une chaîne intacte sans signaler d'anomalie", async () => {
    const store = new EvidenceStore(evidencePath());
    for (let index = 0; index < 5; index += 1) {
      await recordEvidence(store, `opération-${index}`);
    }
    const report = await store.verify();
    expect(report.ok).toBe(true);
    expect(report.count).toBe(5);
    expect(report.issues).toEqual([]);
  });

  it('signale un journal absent', async () => {
    const store = new EvidenceStore(evidencePath('absent.jsonl'));
    const report = await store.verify();
    expect(report.ok).toBe(false);
    expect(report.issues[0]?.code).toBe('MISSING');
  });

  it('I-27 : détecte une altération du contenu (HASH_MISMATCH)', async () => {
    const path = evidencePath();
    const store = new EvidenceStore(path);
    await recordEvidence(store, 'opération-1');
    await recordEvidence(store, 'opération-2');

    const lines = await readLines(path);
    const tampered = JSON.parse(line(lines, 1)) as Record<string, unknown>;
    tampered.operation = 'opération-modifiée';
    await writeFile(path, `${[line(lines, 0), JSON.stringify(tampered)].join('\n')}\n`, 'utf8');

    const report = await store.verify();
    expect(report.ok).toBe(false);
    expect(report.issues.some((issue) => issue.code === 'HASH_MISMATCH')).toBe(true);
  });

  it('I-27 : détecte la suppression d’un maillon (BROKEN_LINK)', async () => {
    const path = evidencePath();
    const store = new EvidenceStore(path);
    for (let index = 0; index < 3; index += 1) {
      await recordEvidence(store, `opération-${index}`);
    }
    const lines = await readLines(path);
    await writeFile(path, `${[line(lines, 0), line(lines, 2)].join('\n')}\n`, 'utf8');

    const report = await store.verify();
    expect(report.ok).toBe(false);
    expect(report.issues.some((issue) => issue.code === 'BROKEN_LINK')).toBe(true);
  });

  it('I-27 : détecte le réordonnancement des maillons', async () => {
    const path = evidencePath();
    const store = new EvidenceStore(path);
    for (let index = 0; index < 3; index += 1) {
      await recordEvidence(store, `opération-${index}`);
    }
    const lines = await readLines(path);
    await writeFile(
      path,
      `${[line(lines, 1), line(lines, 0), line(lines, 2)].join('\n')}\n`,
      'utf8',
    );

    expect((await store.verify()).ok).toBe(false);
  });

  it('I-29 : caviarde un secret avant écriture', async () => {
    const token = `gh${'p_'}D1e2F3g4H5i6J7k8L9m0N1o2P3q4R5s6T7u8`;
    const store = new EvidenceStore(evidencePath());
    const record = await store.record('push', OperationStatus.Executed, {
      commands: [`git remote set-url origin https://${token}@github.com/x/y.git`],
    });
    const stored = await store.lastRecord();
    expect(stored).toBeDefined();
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(stored?.hash).toBe(record.hash);
  });

  it('refuse un enregistrement non conforme au contrat, sans rien écrire', async () => {
    const path = evidencePath();
    const store = new EvidenceStore(path);
    await expect(store.append({ evidence_id: 'ev_invalide' })).rejects.toBeInstanceOf(
      ContractError,
    );
    expect(await store.count()).toBe(0);
    await expect(stat(path)).rejects.toBeDefined();
  });

  it('refuse un statut inconnu', async () => {
    const store = new EvidenceStore(evidencePath());
    await expect(
      store.append({
        evidence_id: 'ev_0123456789abcdef',
        operation: 'opération',
        status: 'SUCCESS',
        recorded_at: '2026-10-02T20:00:00Z',
      }),
    ).rejects.toBeInstanceOf(ContractError);
  });

  it('attache les critères de validation quand ils sont fournis', async () => {
    const store = new EvidenceStore(evidencePath());
    const outcome = new ValidationOutcome(
      ['les tests passent', 'aucun secret détecté'],
      true,
      true,
    );
    const record = await store.record('phase-0', OperationStatus.Verified, {
      validation: outcome,
    });
    const validation = record.validation as Record<string, unknown>;
    expect(validation.passed).toBe(true);
    expect(validation.criteria).toEqual(['les tests passent', 'aucun secret détecté']);
  });

  it('le contrat refuse un `passed` sans `performed`', async () => {
    const store = new EvidenceStore(evidencePath());
    await expect(
      store.append({
        evidence_id: 'ev_0123456789abcdef',
        operation: 'opération',
        status: 'VERIFIED',
        recorded_at: '2026-10-02T20:00:00Z',
        validation: { criteria: ['un critère'], performed: false, passed: true },
      }),
    ).rejects.toBeInstanceOf(ContractError);
  });

  it('refuse de consigner VERIFIED sans validation réellement réussie', async () => {
    const store = new EvidenceStore(evidencePath());
    await expect(store.record('opération', OperationStatus.Verified)).rejects.toBeInstanceOf(
      VerificationRequiredError,
    );
    await expect(
      store.record('opération', OperationStatus.Verified, {
        validation: new ValidationOutcome(['un critère'], false, false),
      }),
    ).rejects.toBeInstanceOf(VerificationRequiredError);
    expect(await store.count()).toBe(0);
  });

  it('I-28 : ne réécrit jamais — seul `append` existe et le fichier ne fait que croître', async () => {
    const path = evidencePath();
    const store = new EvidenceStore(path);
    await recordEvidence(store, 'opération-1');
    const sizeBefore = (await stat(path)).size;
    await recordEvidence(store, 'opération-2');
    expect((await stat(path)).size).toBeGreaterThan(sizeBefore);
    expect(await store.count()).toBe(2);
    expect('delete' in store).toBe(false);
    expect('update' in store).toBe(false);
  });

  it('produit un identifiant de preuve préfixé', () => {
    expect(newEvidenceId()).toMatch(/^ev_[0-9a-f]{32}$/);
    expect(EvidenceStore.newEvidenceId()).toMatch(/^ev_[0-9a-f]{32}$/);
  });
});

describe('journal chaîné — audit', () => {
  it('démarre la séquence à 0 et la fait croître', async () => {
    const ledger = new AuditLedger(auditPath());
    const first = await recordAudit(ledger, 'action-1');
    const second = await recordAudit(ledger, 'action-2');
    expect(first.seq).toBe(0);
    expect(second.seq).toBe(1);
    expect(first.prev_hash).toBe(GENESIS_HASH);
    expect(second.prev_hash).toBe(first.hash);
  });

  it('attribue la séquence elle-même : un appelant ne peut pas l’imposer', async () => {
    const ledger = new AuditLedger(auditPath());
    const record = await ledger.append({
      seq: 999,
      timestamp: '2026-10-02T20:00:00Z',
      actor: 'acteur-test',
      action: 'test',
      resource: 'dépôt',
      risk_class: 'READ',
      result: 'EXECUTED',
    });
    expect(record.seq).toBe(0);
  });

  it('valide une chaîne d’audit intacte', async () => {
    const ledger = new AuditLedger(auditPath());
    for (let index = 0; index < 4; index += 1) {
      await recordAudit(ledger, `action-${index}`);
    }
    const report = await ledger.verify();
    expect(report.ok).toBe(true);
    expect(report.count).toBe(4);
  });

  it('I-27 : détecte un saut de séquence', async () => {
    const path = auditPath();
    const ledger = new AuditLedger(path);
    for (let index = 0; index < 3; index += 1) {
      await recordAudit(ledger, `action-${index}`);
    }
    const lines = await readLines(path);
    await writeFile(path, `${[line(lines, 0), line(lines, 2)].join('\n')}\n`, 'utf8');

    const report = await ledger.verify();
    expect(report.ok).toBe(false);
    const codes = new Set(report.issues.map((issue) => issue.code));
    expect(codes.has('BROKEN_LINK') || codes.has('SEQUENCE_GAP')).toBe(true);
  });

  it('I-27 : détecte une altération du résultat consigné', async () => {
    const path = auditPath();
    const ledger = new AuditLedger(path);
    await recordAudit(ledger, 'action-1');
    await recordAudit(ledger, 'action-2');

    const lines = await readLines(path);
    const tampered = JSON.parse(line(lines, 0)) as Record<string, unknown>;
    tampered.result = 'VERIFIED';
    await writeFile(path, `${[JSON.stringify(tampered), line(lines, 1)].join('\n')}\n`, 'utf8');

    expect((await ledger.verify()).issues.some((issue) => issue.code === 'HASH_MISMATCH')).toBe(
      true,
    );
  });

  it('refuse une classe de risque inconnue', async () => {
    const ledger = new AuditLedger(auditPath());
    await expect(
      ledger.append({
        seq: 0,
        timestamp: '2026-10-02T20:00:00Z',
        actor: 'acteur-test',
        action: 'test',
        resource: 'dépôt',
        risk_class: 'TRES_RISQUE',
        result: 'EXECUTED',
      }),
    ).rejects.toBeInstanceOf(ContractError);
  });

  it('porte le tenant quand il est connu (I-15)', async () => {
    const ledger = new AuditLedger(auditPath());
    const record = await recordAudit(ledger);
    expect(record.tenant_id).toBe('tenant-a');
  });

  it('I-29 : caviarde un secret dans l’audit', async () => {
    const token = `gh${'p_'}E1f2G3h4I5j6K7l8M9n0O1p2Q3r4S5t6U7v8`;
    const ledger = new AuditLedger(auditPath());
    const record = await ledger.recordAction({
      actor: 'acteur-test',
      action: 'git push',
      resource: `https://${token}@github.com/Elfried002/codidev.git`,
      riskClass: RiskClass.ExternalSideEffect,
      result: OperationStatus.WaitingForUser,
    });
    expect(JSON.stringify(record)).not.toContain(token);
    expect(record.risk_class).toBe('EXTERNAL_SIDE_EFFECT');
  });
});

describe('support de journalisation (JournalSink)', () => {
  it('FileJournalSink expose existence, lecture ligne à ligne et ajout', async () => {
    const path = join(directory, 'nested', 'journal.jsonl');
    const sink = new FileJournalSink(path);
    expect(await sink.exists()).toBe(false);

    await sink.appendLine('{"a":1}');
    await sink.appendLine('{"a":2}');

    expect(await sink.exists()).toBe(true);
    expect(await collect(sink.readLines())).toEqual(['{"a":1}', '{"a":2}']);
  });

  it('le chaînage survit au remplacement du support par une implémentation mémoire', async () => {
    class MemoryJournalSink implements JournalSink {
      readonly location = '<mémoire>';
      readonly lines: string[] = [];

      async exists(): Promise<boolean> {
        return this.lines.length > 0;
      }

      async *readLines(): AsyncIterable<string> {
        for (const line of this.lines) yield line;
      }

      async appendLine(line: string): Promise<void> {
        this.lines.push(line);
      }
    }

    const sink = new MemoryJournalSink();
    const store = new EvidenceStore(sink);
    const first = await recordEvidence(store, 'opération-1');
    const second = await recordEvidence(store, 'opération-2');

    expect(second.prev_hash).toBe(first.hash);
    const report = await store.verify();
    expect(report.ok).toBe(true);
    expect(report.count).toBe(2);
    expect(report.path).toBe('<mémoire>');
  });
});
