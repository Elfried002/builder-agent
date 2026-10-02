/**
 * Tests du vocabulaire canonique et des invariants opposables.
 * Invariants couverts : I-01, I-02, I-03, I-04, I-05 (table), I-11.
 */

import { describe, expect, it } from 'vitest';

import {
  GateOutcome,
  gateExitCode,
  impliesCompletion,
  isAllowedTransition,
  isFailure,
  OPERATION_STATUSES,
  OperationStatus,
  RISK_CLASSES,
  RiskClass,
  requiresHumanApproval,
  SEVERITIES,
  Severity,
  severityRank,
  TASK_STATES,
  TASK_TRANSITIONS,
  TaskState,
} from '../src/statuses.js';

describe('OperationStatus (I-01, I-02, I-03)', () => {
  it('seul VERIFIED implique une opération terminée', () => {
    expect(impliesCompletion(OperationStatus.Verified)).toBe(true);
    for (const status of OPERATION_STATUSES) {
      if (status !== OperationStatus.Verified) {
        expect(impliesCompletion(status)).toBe(false);
      }
    }
  });

  it('EXECUTED n’est pas un succès', () => {
    expect(impliesCompletion(OperationStatus.Executed)).toBe(false);
  });

  it('BLOCKED et FAILED sont des échecs, WAITING_FOR_USER n’en est pas un', () => {
    expect(isFailure(OperationStatus.Blocked)).toBe(true);
    expect(isFailure(OperationStatus.Failed)).toBe(true);
    expect(isFailure(OperationStatus.WaitingForUser)).toBe(false);
    expect(isFailure(OperationStatus.NotExecuted)).toBe(false);
  });

  it('aucun statut de succès implicite n’existe', () => {
    expect([...OPERATION_STATUSES].sort()).toEqual([
      'BLOCKED',
      'EXECUTED',
      'FAILED',
      'NOT_EXECUTED',
      'VERIFIED',
      'WAITING_FOR_USER',
    ]);
    expect(OPERATION_STATUSES).not.toContain('SUCCESS');
  });
});

describe('RiskClass (I-04)', () => {
  it('les huit classes de risque sont connues', () => {
    expect(RISK_CLASSES).toHaveLength(8);
  });

  it('cinq classes exigent une approbation, trois n’en exigent pas', () => {
    const attendues = new Set<RiskClass>([
      RiskClass.SensitiveWrite,
      RiskClass.Destructive,
      RiskClass.ExternalSideEffect,
      RiskClass.Deployment,
      RiskClass.SecuritySensitive,
    ]);
    for (const riskClass of RISK_CLASSES) {
      expect(requiresHumanApproval(riskClass)).toBe(attendues.has(riskClass));
    }
    expect(requiresHumanApproval(RiskClass.Read)).toBe(false);
    expect(requiresHumanApproval(RiskClass.Write)).toBe(false);
    expect(requiresHumanApproval(RiskClass.LowWrite)).toBe(false);
  });
});

describe('TaskState (I-11)', () => {
  it('les treize états sont connus', () => {
    expect(TASK_STATES).toHaveLength(13);
  });

  it('autorise le chemin nominal et refuse les raccourcis', () => {
    expect(isAllowedTransition(TaskState.Draft, TaskState.Analyzing)).toBe(true);
    expect(isAllowedTransition(TaskState.Executed, TaskState.Verifying)).toBe(true);
    expect(isAllowedTransition(TaskState.Verifying, TaskState.Verified)).toBe(true);
    expect(isAllowedTransition(TaskState.Verified, TaskState.Ready)).toBe(true);
    expect(isAllowedTransition(TaskState.Ready, TaskState.Completed)).toBe(true);

    expect(isAllowedTransition(TaskState.Draft, TaskState.Completed)).toBe(false);
    expect(isAllowedTransition(TaskState.Verified, TaskState.InProgress)).toBe(false);
    expect(isAllowedTransition(TaskState.Cancelled, TaskState.InProgress)).toBe(false);
    expect(isAllowedTransition(TaskState.Completed, TaskState.Ready)).toBe(false);
  });

  it('COMPLETED n’est jamais atteignable directement', () => {
    const sources = Object.entries(TASK_TRANSITIONS)
      .filter(([, targets]) => targets.includes(TaskState.Completed))
      .map(([source]) => source);
    expect(sources).toEqual([TaskState.Ready]);
  });

  it('les états finaux n’ont aucune sortie', () => {
    expect(TASK_TRANSITIONS.COMPLETED).toEqual([]);
    expect(TASK_TRANSITIONS.CANCELLED).toEqual([]);
  });
});

describe('Severity et GateOutcome (I-05)', () => {
  it('ordonne les sévérités', () => {
    expect([...SEVERITIES].sort((a, b) => severityRank(a) - severityRank(b))).toEqual([
      Severity.Info,
      Severity.Low,
      Severity.Medium,
      Severity.High,
      Severity.Critical,
    ]);
  });

  it('associe les codes de sortie du gate', () => {
    expect(gateExitCode(GateOutcome.Pass)).toBe(0);
    expect(gateExitCode(GateOutcome.Review)).toBe(1);
    expect(gateExitCode(GateOutcome.Block)).toBe(2);
  });
});
