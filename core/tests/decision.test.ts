/**
 * Tests du Decision Engine : politique autoritaire, options tracées, obligations.
 * Invariants couverts : I-07, I-08, I-09, I-10.
 */

import { describe, expect, it } from 'vitest';

import { isValid } from '../src/contracts.js';
import type { Option } from '../src/decision/engine.js';
import {
  DecisionEngine,
  HUMAN_GATE_OBLIGATION,
  option,
  PolicyVerdict,
} from '../src/decision/engine.js';
import { ContractError } from '../src/errors.js';
import { PolicyOutcome, RiskClass } from '../src/statuses.js';

/** Deux options de risque et de réversibilité différents, pour départager le choix. */
function jeuOptions(): Option[] {
  return [
    option('réécrire le module de zéro', {
      riskClass: RiskClass.Destructive,
      reversible: false,
      expectedOutcome: 'module neuf',
      optionId: 'opt_reecrire',
    }),
    option('corriger le module existant', {
      riskClass: RiskClass.Write,
      reversible: true,
      expectedOutcome: 'module corrigé',
      optionId: 'opt_corriger',
    }),
  ];
}

describe('DecisionEngine — invariants I-07 à I-10', () => {
  it('I-07 : un verdict DENY interdit toute sélection', () => {
    const verdict = PolicyVerdict.deny({
      policyId: 'politique@v1',
      reason: 'périmètre non autorisé',
    });
    const record = new DecisionEngine().decide({
      intent: 'modifier le module',
      options: jeuOptions(),
      policy: verdict,
      verificationPlan: ['les tests passent'],
    });

    expect(record.selectedOptionId).toBeNull();
    expect(record.selected).toBeNull();
    // I-08 : aucune option écartée n'est passée sous silence.
    expect(record.options.every((item) => item.rejectedBecause !== null)).toBe(true);
    expect(record.rationale).toContain('périmètre non autorisé');
  });

  it('I-08 : le risque le plus faible est retenu et l’autre est motivée', () => {
    const record = new DecisionEngine().decide({
      intent: 'modifier le module',
      options: jeuOptions(),
      policy: PolicyVerdict.allow({ policyId: 'politique@v1' }),
      verificationPlan: ['les tests passent'],
    });

    expect(record.selectedOptionId).toBe('opt_corriger');
    const rejetee = record.options.find((item) => item.optionId === 'opt_reecrire');
    expect(rejetee?.selected).toBe(false);
    expect(rejetee?.rejectedBecause).toContain('risque supérieur');
  });

  it('la réversibilité départage à risque égal', () => {
    const record = new DecisionEngine().decide({
      intent: 'modifier',
      options: [
        option('modifier sur place', {
          riskClass: RiskClass.Write,
          reversible: false,
          optionId: 'opt_a',
        }),
        option('modifier avec sauvegarde', {
          riskClass: RiskClass.Write,
          reversible: true,
          optionId: 'opt_b',
        }),
      ],
      policy: PolicyVerdict.allow({ policyId: 'politique@v1' }),
      verificationPlan: ['vérifier'],
    });

    expect(record.selectedOptionId).toBe('opt_b');
    const rejetee = record.options.find((item) => item.optionId === 'opt_a');
    expect(rejetee?.rejectedBecause).toContain('réversible');
  });

  it('un verdict qui exige une approbation ajoute l’obligation', () => {
    const verdict = PolicyVerdict.requireApproval({
      policyId: 'politique@v1',
      reason: 'action engageante',
    });
    const record = new DecisionEngine().decide({
      intent: 'déployer',
      options: [option('déployer', { riskClass: RiskClass.Write, optionId: 'opt_deployer' })],
      policy: verdict,
      verificationPlan: ['health check vert'],
    });

    expect(record.policyOutcome).toBe(PolicyOutcome.RequireApproval);
    expect(record.obligations).toContain(HUMAN_GATE_OBLIGATION);
    expect(record.requiresHumanGate).toBe(true);
  });

  it('I-09 : une option risquée impose le human gate même si la politique autorise', () => {
    const record = new DecisionEngine().decide({
      intent: 'purger',
      options: [
        option('purger la table', {
          riskClass: RiskClass.Destructive,
          reversible: false,
          optionId: 'opt_purge',
        }),
      ],
      policy: PolicyVerdict.allow({ policyId: 'politique@v1' }),
      verificationPlan: ['la table est vide'],
    });

    expect(record.obligations).toContain(HUMAN_GATE_OBLIGATION);
    expect(record.requiresHumanGate).toBe(true);
  });

  it('les permissions requises suivent l’option retenue', () => {
    const record = new DecisionEngine().decide({
      intent: 'modifier',
      options: jeuOptions(),
      policy: PolicyVerdict.allow({ policyId: 'politique@v1' }),
      verificationPlan: ['vérifier'],
    });

    expect(record.requiredPermissions).toEqual([RiskClass.Write]);
  });

  it('en l’absence de sélection, les permissions exposées sont celles demandées', () => {
    const record = new DecisionEngine().decide({
      intent: 'modifier',
      options: jeuOptions(),
      policy: PolicyVerdict.deny({ policyId: 'politique@v1', reason: 'refus' }),
      verificationPlan: ['vérifier'],
    });

    expect(record.requiredPermissions).toContain(RiskClass.Write);
    expect(record.requiredPermissions).toContain(RiskClass.Destructive);
  });

  it('I-10 : une décision sans plan de vérification est refusée', () => {
    expect(() =>
      new DecisionEngine().decide({
        intent: 'modifier',
        options: jeuOptions(),
        policy: PolicyVerdict.allow({ policyId: 'politique@v1' }),
        verificationPlan: [],
      }),
    ).toThrow(ContractError);
  });

  it('une décision sans option examinée est refusée', () => {
    expect(() =>
      new DecisionEngine().decide({
        intent: 'modifier',
        options: [],
        policy: PolicyVerdict.allow({ policyId: 'politique@v1' }),
        verificationPlan: ['vérifier'],
      }),
    ).toThrow(ContractError);
  });

  it('le choix est déterministe à entrées égales', () => {
    const moteur = new DecisionEngine();
    const input = {
      intent: 'modifier',
      options: jeuOptions(),
      policy: PolicyVerdict.allow({ policyId: 'politique@v1' }),
      verificationPlan: ['vérifier'],
    };
    const premier = moteur.decide(input);
    const second = moteur.decide(input);

    expect(premier.selectedOptionId).toBe(second.selectedOptionId);
    expect(premier.rationale).toBe(second.rationale);
  });

  it('le motif est exposable : il est présent dans la sérialisation, jamais un raisonnement privé', () => {
    const record = new DecisionEngine().decide({
      intent: 'modifier',
      options: jeuOptions(),
      policy: PolicyVerdict.allow({ policyId: 'politique@v1' }),
      verificationPlan: ['vérifier'],
    });

    expect(typeof record.rationale).toBe('string');
    expect(record.rationale).not.toBe('');
    expect(record.toDict().rationale).toBe(record.rationale);
    expect(record.rationale).toContain('risque le plus faible');
  });

  it('une décision conforme est valide au contrat', () => {
    const record = new DecisionEngine().decide({
      intent: 'modifier',
      options: jeuOptions(),
      policy: PolicyVerdict.allow({ policyId: 'politique@v1' }),
      verificationPlan: ['vérifier'],
      sources: ['docs/construction/CODIDEV_DOCUMENTATION/03_AGENT_CORE/03_DECISION_ENGINE.md'],
    });

    expect(isValid('decision', record.toDict())).toBe(true);
  });

  it('les motifs de politique sont conservés dans les risques', () => {
    const verdict = PolicyVerdict.requireApproval({
      policyId: 'politique@v1',
      reason: 'action engageante',
    });
    const record = new DecisionEngine().decide({
      intent: 'déployer',
      options: [option('déployer', { riskClass: RiskClass.Write, optionId: 'opt_d' })],
      policy: verdict,
      verificationPlan: ['health check'],
    });

    expect(record.risks).toContain('action engageante');
  });
});
