/**
 * Tests du Planner : invariants, permissions dérivées, révision versionnée.
 * Invariants couverts : I-21, I-22, I-23, I-24, I-25, I-26.
 */

import { describe, expect, it } from 'vitest';

import { isValid, schemaEnum } from '../src/contracts.js';
import { PlanInvalidError } from '../src/errors.js';
import {
  invariantViolations,
  Plan,
  Planner,
  PlanStatus,
  type PlanStep,
  step,
} from '../src/planner/planner.js';
import { RISK_CLASSES, RiskClass, requiresHumanApproval } from '../src/statuses.js';

function planner(): Planner {
  return new Planner();
}

function planSimple(instance: Planner): Plan {
  const etapeAnalyse = step('analyser le dépôt', {
    expectedOutput: 'inventaire des fichiers',
    verification: ['la liste des fichiers est produite'],
    riskClass: RiskClass.Read,
  });
  const etapeEcriture = step('écrire le module manquant', {
    expectedOutput: 'module ajouté et testé',
    verification: ['les tests du module passent'],
    riskClass: RiskClass.Write,
    dependsOn: [etapeAnalyse.stepId],
  });
  return instance.create('ajouter le module manquant', [etapeAnalyse, etapeEcriture], {
    verificationCriteria: ['les tests passent', 'le lint est vert'],
    requirements: ['Python 3.12'],
    assumptions: ['le dépôt est accessible'],
  });
}

/** Extrait les violations portées par une `PlanInvalidError`, ou relaie l'erreur inattendue. */
function violationsOf(error: unknown): string[] {
  if (error instanceof PlanInvalidError) {
    const raw = error.context.violations;
    return Array.isArray(raw) ? raw.map((value) => String(value)) : [];
  }
  throw error;
}

/** Exécute une production attendue en échec et renvoie ses violations. */
function catchViolations(run: () => unknown): string[] {
  try {
    run();
  } catch (error) {
    return violationsOf(error);
  }
  throw new Error('une erreur de plan était attendue, aucune n’a été levée');
}

describe('ordre et numérotation des étapes (I-21)', () => {
  it('numérote les étapes dans l’ordre donné', () => {
    const plan = planSimple(planner());
    expect(plan.steps.map((item) => item.order)).toEqual([1, 2]);
  });

  it('refuse un ordre non contigu', () => {
    const base = planSimple(planner());
    const casse = new Plan({
      objective: base.objective,
      steps: base.steps.map((item, index) => ({ ...item, order: index === 1 ? 3 : 1 })),
      verificationCriteria: base.verificationCriteria,
    });
    expect(invariantViolations(casse).some((value) => value.includes('contigu'))).toBe(true);
  });

  it('refuse des identifiants d’étape dupliqués', () => {
    const instance = planner();
    const etape = step('faire', {
      expectedOutput: 'x',
      verification: ['ok'],
      stepId: 'step_duplique',
    });
    expect(() =>
      instance.create('objectif', [etape, etape], { verificationCriteria: ['global'] }),
    ).toThrow(PlanInvalidError);
  });
});

describe('dépendances (I-22)', () => {
  it('refuse une dépendance vers une étape non antérieure', () => {
    const instance = planner();
    const premiere = step('un', { expectedOutput: 'a', verification: ['ok'] });
    const seconde = step('deux', {
      expectedOutput: 'b',
      verification: ['ok'],
      dependsOn: [premiere.stepId],
    });
    // Ordre inversé : la seconde devient la première et dépend d'une étape ultérieure.
    expect(() =>
      instance.create('objectif', [seconde, premiere], { verificationCriteria: ['global'] }),
    ).toThrow(PlanInvalidError);
  });

  it('refuse une dépendance vers une étape inconnue', () => {
    const instance = planner();
    const etape = step('faire', {
      expectedOutput: 'x',
      verification: ['ok'],
      dependsOn: ['step_inexistant'],
    });
    const violations = catchViolations(() =>
      instance.create('objectif', [etape], { verificationCriteria: ['global'] }),
    );
    expect(violations.some((value) => value.includes('inconnue'))).toBe(true);
  });
});

describe('critères de vérification (I-23)', () => {
  it('refuse un plan sans critère de vérification global', () => {
    const instance = planner();
    expect(() =>
      instance.create('objectif', [step('faire', { expectedOutput: 'x', verification: ['y'] })], {
        verificationCriteria: [],
      }),
    ).toThrow(PlanInvalidError);
  });

  it('refuse une étape sans critère de vérification', () => {
    const instance = planner();
    expect(() =>
      instance.create('objectif', [step('faire', { expectedOutput: 'x', verification: [] })], {
        verificationCriteria: ['global'],
      }),
    ).toThrow(PlanInvalidError);
  });
});

describe('rollback des étapes risquées (I-24)', () => {
  const risques: readonly RiskClass[] = [
    RiskClass.Destructive,
    RiskClass.Deployment,
    RiskClass.SensitiveWrite,
  ];

  it('exige un rollback pour DESTRUCTIVE, DEPLOYMENT et SENSITIVE_WRITE', () => {
    for (const riskClass of risques) {
      const violations = catchViolations(() =>
        planner().create(
          'agir',
          [step('agir', { expectedOutput: 'fait', verification: ['ok'], riskClass })],
          { verificationCriteria: ['ok'] },
        ),
      );
      expect(violations.some((value) => value.includes('rollback'))).toBe(true);
    }
  });

  it('accepte un rollback déclaré au niveau du plan', () => {
    for (const riskClass of risques) {
      const plan = planner().create(
        'agir',
        [step('agir', { expectedOutput: 'fait', verification: ['ok'], riskClass })],
        { verificationCriteria: ['ok'], rollback: 'restaurer la sauvegarde du 2026-10-01' },
      );
      expect(plan.rollback).not.toBeNull();
    }
  });

  it('accepte un rollback déclaré au niveau de l’étape', () => {
    const plan = planner().create(
      'déployer',
      [
        step('déployer en production', {
          expectedOutput: 'service en ligne',
          verification: ['health check vert'],
          riskClass: RiskClass.Deployment,
          rollback: 'redéployer la version précédente',
        }),
      ],
      { verificationCriteria: ['health check vert'] },
    );
    expect(plan.requiresApproval).toBe(true);
  });
});

describe('permissions dérivées (I-25)', () => {
  it('dérive les permissions de l’union des classes de risque des étapes', () => {
    const plan = planSimple(planner());
    expect(plan.permissions).toEqual([RiskClass.Read, RiskClass.Write]);
  });

  it('ne reflète que les classes réellement présentes dans les étapes', () => {
    const plan = planSimple(planner());
    for (const permission of plan.permissions) {
      expect(plan.steps.some((item) => item.riskClass === permission)).toBe(true);
    }
    expect(plan.permissions.every((value) => RISK_CLASSES.includes(value))).toBe(true);
  });

  it('dérive aussi la nécessité d’approbation des étapes', () => {
    const plan = planSimple(planner());
    expect(plan.requiresApproval).toBe(
      plan.steps.some((item) => requiresHumanApproval(item.riskClass)),
    );
  });
});

describe('révision versionnée (I-26)', () => {
  it('produit une nouvelle version sans réécrire l’ancienne', () => {
    const instance = planner();
    const origine = planSimple(instance);
    const nouvelle = instance.revise(origine, { reason: "dépendance découverte à l'exécution" });

    expect(nouvelle.version).toBe(2);
    expect(nouvelle.supersedes).toBe(origine.planId);
    expect(nouvelle.planId).not.toBe(origine.planId);
    expect(origine.status).toBe(PlanStatus.Superseded);
    expect(nouvelle.status).toBe(PlanStatus.Draft);
    expect(nouvelle.risks.some((risque) => risque.includes('révision'))).toBe(true);
  });

  it('refuse une révision sans motif', () => {
    const instance = planner();
    expect(() => instance.revise(planSimple(instance), { reason: '   ' })).toThrow(
      PlanInvalidError,
    );
  });

  it('invalide une version > 1 qui ne déclare pas ce qu’elle remplace', () => {
    const plan = planSimple(planner());
    const orpheline = new Plan({
      objective: plan.objective,
      steps: plan.steps,
      version: 3,
      supersedes: null,
      verificationCriteria: plan.verificationCriteria,
    });
    expect(invariantViolations(orpheline).some((value) => value.includes('remplace'))).toBe(true);
  });
});

describe('cycle de vie et validation', () => {
  it('seul un brouillon peut être proposé', () => {
    const instance = planner();
    const plan = instance.propose(planSimple(instance));
    expect(plan.status).toBe(PlanStatus.Proposed);
    expect(() => instance.propose(plan)).toThrow(PlanInvalidError);
  });

  it('lève le même type d’erreur pour une violation de schéma', () => {
    const violations = catchViolations(() =>
      planner().create('objectif', [step('', { expectedOutput: 'x', verification: ['ok'] })], {
        verificationCriteria: ['global'],
      }),
    );
    expect(violations.length).toBeGreaterThan(0);
  });

  it('lève le même type d’erreur pour une violation d’invariant', () => {
    expect(() =>
      planner().create('objectif', [step('faire', { expectedOutput: 'x', verification: ['ok'] })]),
    ).toThrow(PlanInvalidError);
  });

  it('refuse un plan sans objectif', () => {
    expect(() =>
      planner().create('   ', [step('faire', { expectedOutput: 'x', verification: ['ok'] })], {
        verificationCriteria: ['global'],
      }),
    ).toThrow(PlanInvalidError);
  });

  it('est conforme au contrat', () => {
    const plan = planSimple(planner());
    expect(isValid('plan', plan.toDict())).toBe(true);
  });

  it('aligne les classes de risque des étapes sur le contrat', () => {
    expect(schemaEnum('plan', '#/properties/steps/items/properties/risk_class')).toEqual([
      ...RISK_CLASSES,
    ]);
  });
});

describe('étapes typées', () => {
  it('expose les champs d’une étape dans leur forme sérialisable', () => {
    const etape: PlanStep = step('faire', {
      expectedOutput: 'résultat',
      verification: ['critère'],
      riskClass: RiskClass.LowWrite,
    });
    expect(etape.order).toBe(0);
    expect(etape.riskClass).toBe(RiskClass.LowWrite);
    expect(etape.rollback).toBeNull();
  });
});
