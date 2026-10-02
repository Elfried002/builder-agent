/**
 * Preuve exécutable de la fixture Next.js.
 *
 * POURQUOI ce test existe : une fixture qui n'est jamais exécutée est décorative. Ce test lance
 * réellement `runCodidev.ts` avec le **provider simulé** — aucun appel réseau, aucune clé — et
 * vérifie qu'un cycle complet produit un statut `NOT_EXECUTED`, un plan `PROPOSED` et des journaux
 * intègres. Le gestionnaire de route est également sollicité directement, sans Next.js.
 */

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AUDIT_FILENAME, EVIDENCE_FILENAME, OperationStatus } from '../../../src/index.js';
import type { MockStep } from '../../../src/llm/index.js';
import { POST } from '../app/api/codidev/route.js';
import { runCodidev } from '../runCodidev.js';

/**
 * Clé factice : jamais réelle, jamais valide. Construite par concaténation pour qu'aucun secret,
 * même inoffensif, n'apparaisse en clair dans le fichier — un scanner de secrets ne doit pas avoir
 * à faire la différence entre un faux positif et une vraie fuite.
 */
function fakeToken(): string {
  return `${'gh'}${'p_'}${'Z1y2X3w4V5u6T7s8R9q0P1o2N3m4L5k6J7i8'}`;
}

/** Scénario complet : le modèle classe la demande, puis propose des étapes vérifiables. */
function fullScenario(): MockStep[] {
  return [
    {
      structured: {
        category: 'MODIFY_SOFTWARE',
        confidence: 0.9,
        statement: 'durcir la validation',
      },
    },
    {
      structured: {
        steps: [
          {
            description: 'ajouter la validation d’entrée',
            expected_output: 'entrée invalide refusée',
            verification: ['test unitaire rouge avant, vert après'],
          },
        ],
      },
    },
  ];
}

/** Scénario réduit au plan : utile quand l'intention est déjà établie par un signal explicite. */
function planOnlyScenario(): MockStep[] {
  return [
    {
      structured: {
        steps: [
          {
            description: 'vérifier l’état avant déploiement',
            expected_output: 'état connu',
            verification: ['santé du service relevée'],
          },
        ],
      },
    },
  ];
}

/** Environnement d'exécution piloté par le provider simulé : aucune clé, aucun réseau. */
function mockEnv(workspaceDir: string): Record<string, string> {
  return {
    CODIDEV_WORKSPACE_DIR: workspaceDir,
    CODIDEV_LLM_PROVIDER: 'mock',
    CODIDEV_LLM_MODEL: 'mock-model',
    CODIDEV_LLM_API_KEY_ENV: 'CODIDEV_DEEPSEEK_API_KEY',
    CODIDEV_LLM_BASE_URL: 'https://exemple.invalid',
  };
}

describe('fixture Next.js : le cœur est réellement exécuté côté serveur', () => {
  it('cycle complet via provider simulé → NOT_EXECUTED, plan PROPOSED, journaux intègres', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'codidev-nextjs-'));
    const summary = await runCodidev({
      text: 'durcir la validation des entrées',
      tenantId: 'tenant-demo',
      actor: 'user-demo',
      env: mockEnv(workspaceDir),
      mockSteps: fullScenario(),
      useLlmForPlan: true,
    });

    expect(summary.status).toBe(OperationStatus.NotExecuted);
    expect(summary.plan?.status).toBe('PROPOSED');
    expect(summary.plan?.stepCount).toBe(1);
    expect(summary.task?.state).toBe('PROPOSED');
    expect(summary.integrity.evidenceOk).toBe(true);
    expect(summary.integrity.auditOk).toBe(true);
    expect(summary.integrity.evidenceCount).toBeGreaterThan(0);
    expect(summary.integrity.auditCount).toBeGreaterThan(0);

    // Le fichier réellement écrit sur disque mémorise la frontière d'exécution et ne prétend
    // jamais qu'un travail a été vérifié.
    const evidence = readFileSync(join(workspaceDir, EVIDENCE_FILENAME), 'utf8');
    expect(evidence).toContain('NOT_EXECUTED');
    expect(evidence).not.toContain('VERIFIED');
    const audit = readFileSync(join(workspaceDir, AUDIT_FILENAME), 'utf8');
    expect(audit.length).toBeGreaterThan(0);
  });

  it('aucun secret fourni dans la demande n’atteint les journaux', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'codidev-nextjs-secret-'));
    const token = fakeToken();

    const summary = await runCodidev({
      text: `déployer avec ${token}`,
      tenantId: 'tenant-demo',
      actor: 'user-demo',
      hints: { action: 'deploy' },
      env: mockEnv(workspaceDir),
      mockSteps: planOnlyScenario(),
      useLlmForPlan: true,
    });

    expect(summary.intent.statement).not.toContain(token);
    expect(summary.intent.statement).toContain('REDACTED');

    const evidence = readFileSync(join(workspaceDir, EVIDENCE_FILENAME), 'utf8');
    const audit = readFileSync(join(workspaceDir, AUDIT_FILENAME), 'utf8');
    expect(evidence).not.toContain(token);
    expect(audit).not.toContain(token);
    expect(summary.integrity.evidenceOk).toBe(true);
    expect(summary.integrity.auditOk).toBe(true);
  });
});

describe('gestionnaire de route : branché sans Next.js', () => {
  it('refuse une demande incomplète (400) avant tout cycle', async () => {
    const request = new Request('http://localhost/api/codidev', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'sans tenant ni acteur' }),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error?: string };
    expect(payload.error).toBeDefined();
  });

  it('refuse un corps illisible (400) sans lever', async () => {
    const request = new Request('http://localhost/api/codidev', {
      method: 'POST',
      body: 'ceci n’est pas du JSON',
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });
});
