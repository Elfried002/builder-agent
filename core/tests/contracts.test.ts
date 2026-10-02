/**
 * Tests des contrats : présence, forme, alignement avec les vocabulaires, résolution hors ligne.
 *
 * Les schémas sont neutres (`core/schemas/`) : ce fichier vérifie qu'ils décrivent exactement les
 * vocabulaires déclarés dans `statuses.ts`. Si l'un dérive, le test échoue — c'est ce qui empêche
 * un contrat et le code de se contredire en silence.
 */

import { describe, expect, it } from 'vitest';

import {
  CONTRACT_NAMES,
  contractPath,
  isValid,
  iterErrors,
  loadSchema,
  SCHEMA_DIR,
  schemaEnum,
  schemaFiles,
  validate,
} from '../src/contracts.js';
import { ContractError } from '../src/errors.js';
import { OPERATION_STATUSES, RISK_CLASSES, TASK_STATES } from '../src/statuses.js';

function actionValide(): Record<string, unknown> {
  return {
    action_id: 'act_0123456789abcdef',
    kind: 'WRITE',
    tool: 'file.write',
    target: 'src/app.ts',
    tenant_id: 'tenant-a',
    requested_at: '2026-10-02T20:00:00Z',
  };
}

describe('contrats', () => {
  it('expose les treize contrats attendus', () => {
    expect([...CONTRACT_NAMES]).toHaveLength(13);
    expect(schemaFiles()).toEqual([...CONTRACT_NAMES].map((name) => `${name}.json`).sort());
    expect(SCHEMA_DIR.endsWith('schemas')).toBe(true);
  });

  it('chaque schéma possède une identité et une forme vérifiable', () => {
    for (const name of CONTRACT_NAMES) {
      const schema = loadSchema(name);
      expect(String(schema.$schema)).toContain('2020-12/schema');
      expect(String(schema.$id)).toContain(`/${name}.json`);
      expect(schema.title).toBeTruthy();
      expect(schema.type).toBe('object');
      expect(schema.additionalProperties).toBe(false);
      expect(Array.isArray(schema.required)).toBe(true);
      expect(contractPath(name)).toContain(`${name}.json`);
    }
  });

  it('les énumérations des schémas sont alignées sur les vocabulaires', () => {
    expect(schemaEnum('action', '#/$defs/risk_class')).toEqual([...RISK_CLASSES]);
    expect(schemaEnum('policy_decision', '#/properties/risk_class')).toEqual([...RISK_CLASSES]);
    expect(schemaEnum('evidence', '#/properties/status')).toEqual([...OPERATION_STATUSES]);
    expect(schemaEnum('audit_record', '#/properties/result')).toEqual([...OPERATION_STATUSES]);
    expect(schemaEnum('task', '#/properties/state')).toEqual([...TASK_STATES]);
  });

  it('accepte un document conforme et refuse un document non conforme', () => {
    validate('action', actionValide());
    expect(isValid('action', actionValide())).toBe(true);

    const kindInconnu = { ...actionValide(), kind: 'TOTALEMENT_INCONNU' };
    expect(isValid('action', kindInconnu)).toBe(false);
    expect(iterErrors('action', kindInconnu).some((message) => message.includes('kind'))).toBe(
      true,
    );
  });

  it('signale un champ obligatoire manquant', () => {
    const incomplet = actionValide();
    delete incomplet.tool;
    expect(iterErrors('action', incomplet).some((message) => message.includes('tool'))).toBe(true);
  });

  it('refuse un champ supplémentaire', () => {
    expect(isValid('action', { ...actionValide(), champ_inconnu: true })).toBe(false);
  });

  it('refuse un horodatage non conforme', () => {
    expect(isValid('action', { ...actionValide(), requested_at: '02/10/2026 20:00' })).toBe(false);
  });

  it('résout les `$ref` absolus hors ligne', () => {
    const request = {
      request_id: 'req_0123456789abcdef',
      action: actionValide(),
      identity: { actor_id: 'user-1', actor_type: 'HUMAN', roles: ['MEMBER'] },
      tenant_id: 'tenant-a',
      resource_scope: ['src/app.ts'],
      created_at: '2026-10-02T20:00:00Z',
    };
    validate('tool_request', request);
    expect(
      isValid('tool_request', { ...request, action: { ...actionValide(), kind: 'NON' } }),
    ).toBe(false);
  });

  it('lève une erreur explicite pour un contrat inconnu', () => {
    expect(() => loadSchema('contrat_inexistant' as never)).toThrowError(ContractError);
  });

  it('porte les violations dans le contexte de l’erreur', () => {
    try {
      validate('action', { action_id: 'court' });
      expect.unreachable('la validation aurait dû échouer');
    } catch (error) {
      expect(error).toBeInstanceOf(ContractError);
      const violations = (error as ContractError).context.violations;
      expect(Array.isArray(violations)).toBe(true);
      expect((violations as string[]).length).toBeGreaterThanOrEqual(3);
    }
  });
});
