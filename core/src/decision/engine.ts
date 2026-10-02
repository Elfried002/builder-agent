/**
 * Decision Engine — choix tracé entre options, sous contrainte de politique.
 *
 * Une décision importante enregistre intention, exigences, contraintes, sources, options
 * examinées, option retenue, risques, permissions requises, résultat de politique et plan de
 * vérification. Le motif est **exposable** ; le raisonnement privé n'est pas un artefact du
 * produit.
 *
 * Deux règles opposables sont appliquées ici, par du code et non par convention :
 *
 * 1. **La politique décide, pas la préférence.** Un verdict `DENY` interdit toute sélection : la
 *    décision est enregistrée, motivée, et aucun choix n'est retenu.
 * 2. **Aucune option écartée n'est passée sous silence.** Chaque option non retenue porte son motif
 *    de rejet (`rejectedBecause`).
 */

import { validate } from '../contracts.js';
import { ContractError } from '../errors.js';
import { newId, utcNowIso } from '../ids.js';
import { PolicyOutcome, RISK_CLASSES, RiskClass, requiresHumanApproval } from '../statuses.js';

/** Obligation ajoutée dès qu'un verdict exige une approbation humaine. */
export const HUMAN_GATE_OBLIGATION = 'approval:human-gate';

/**
 * Option examinée par le Decision Engine.
 *
 * Les champs qui étaient optionnels côté référence sont ici requis mais **nullables** : le contrat
 * de décision les déclare explicitement (y compris `null`) et un champ obligatoire évite toute
 * ambiguïté entre « absent » et « non renseigné ».
 */
export interface Option {
  readonly optionId: string;
  readonly description: string;
  readonly riskClass: RiskClass;
  readonly reversible: boolean;
  readonly expectedOutcome: string | null;
  readonly selected: boolean;
  readonly rejectedBecause: string | null;
}

/** Paramètres de construction d'une option ; les valeurs par défaut suivent la référence. */
export interface OptionInit {
  readonly riskClass?: RiskClass;
  readonly reversible?: boolean;
  readonly expectedOutcome?: string | null;
  readonly optionId?: string;
}

/** Construit une option. Défaut de risque `WRITE`, réversible : le choix le plus prudent. */
export function option(description: string, init: OptionInit = {}): Option {
  return {
    optionId: init.optionId ?? newId('opt'),
    description,
    riskClass: init.riskClass ?? RiskClass.Write,
    reversible: init.reversible ?? true,
    expectedOutcome: init.expectedOutcome ?? null,
    selected: false,
    rejectedBecause: null,
  };
}

/** Copie d'une option avec son sort dans la décision (retenue ou écartée). */
function withOutcome(item: Option, selected: boolean, rejectedBecause: string | null): Option {
  return { ...item, selected, rejectedBecause };
}

/** Verdict d'une politique sur une action ou une décision. */
export interface PolicyVerdict {
  readonly outcome: PolicyOutcome;
  readonly policyId: string;
  readonly reasons: readonly string[];
  readonly obligations: readonly string[];
}

/** Paramètres d'un verdict `ALLOW`. */
export interface PolicyAllowInit {
  readonly policyId: string;
  readonly reason?: string;
}

/** Paramètres d'un verdict `DENY` / `REQUIRE_APPROVAL`. */
export interface PolicyRefusalInit {
  readonly policyId: string;
  readonly reason: string;
}

/**
 * Fabriques de verdicts. Le type et la valeur partagent le même nom : en TypeScript les espaces de
 * noms sont séparés, ce qui reproduit l'API de la référence (`PolicyVerdict.allow(...)`) tout en
 * conservant un type structurel.
 */
export const PolicyVerdict = {
  allow(init: PolicyAllowInit): PolicyVerdict {
    return {
      outcome: PolicyOutcome.Allow,
      policyId: init.policyId,
      reasons: [init.reason ?? 'conforme à la politique'],
      obligations: [],
    };
  },
  deny(init: PolicyRefusalInit): PolicyVerdict {
    return {
      outcome: PolicyOutcome.Deny,
      policyId: init.policyId,
      reasons: [init.reason],
      obligations: [],
    };
  },
  requireApproval(init: PolicyRefusalInit): PolicyVerdict {
    return {
      outcome: PolicyOutcome.RequireApproval,
      policyId: init.policyId,
      reasons: [init.reason],
      obligations: [HUMAN_GATE_OBLIGATION],
    };
  },
} as const;

/** Champs sérialisables d'une option, tels qu'attendus par le contrat `decision`. */
function optionToDict(item: Option): Record<string, unknown> {
  return {
    option_id: item.optionId,
    description: item.description,
    expected_outcome: item.expectedOutcome,
    risk_class: item.riskClass,
    reversible: item.reversible,
    selected: item.selected,
    rejected_because: item.rejectedBecause,
  };
}

/** Init de construction d'un enregistrement de décision. */
export interface DecisionRecordInit {
  readonly intent: string;
  readonly options: readonly Option[];
  readonly policyOutcome: PolicyOutcome;
  readonly risks: readonly string[];
  readonly requiredPermissions: readonly RiskClass[];
  readonly verificationPlan: readonly string[];
  readonly decisionId?: string;
  readonly selectedOptionId?: string | null;
  readonly rationale?: string | null;
  readonly policyId?: string | null;
  readonly obligations?: readonly string[];
  readonly requirements?: readonly string[];
  readonly constraints?: readonly string[];
  readonly sources?: readonly string[];
  readonly planId?: string | null;
  readonly tenantId?: string | null;
  readonly projectId?: string | null;
  readonly decidedAt?: string;
}

/** Décision structurante : ce qui a été décidé, pourquoi, et à quelles conditions. */
export class DecisionRecord {
  readonly decisionId: string;
  readonly intent: string;
  readonly options: readonly Option[];
  readonly risks: readonly string[];
  readonly requiredPermissions: readonly RiskClass[];
  readonly verificationPlan: readonly string[];
  readonly selectedOptionId: string | null;
  readonly rationale: string | null;
  readonly policyOutcome: PolicyOutcome;
  readonly policyId: string | null;
  readonly obligations: readonly string[];
  readonly requirements: readonly string[];
  readonly constraints: readonly string[];
  readonly sources: readonly string[];
  readonly planId: string | null;
  readonly tenantId: string | null;
  readonly projectId: string | null;
  readonly decidedAt: string;

  constructor(init: DecisionRecordInit) {
    this.decisionId = init.decisionId ?? newId('dec');
    this.intent = init.intent;
    this.options = init.options;
    this.risks = init.risks;
    this.requiredPermissions = init.requiredPermissions;
    this.verificationPlan = init.verificationPlan;
    this.selectedOptionId = init.selectedOptionId ?? null;
    this.rationale = init.rationale ?? null;
    this.policyOutcome = init.policyOutcome;
    this.policyId = init.policyId ?? null;
    this.obligations = init.obligations ?? [];
    this.requirements = init.requirements ?? [];
    this.constraints = init.constraints ?? [];
    this.sources = init.sources ?? [];
    this.planId = init.planId ?? null;
    this.tenantId = init.tenantId ?? null;
    this.projectId = init.projectId ?? null;
    this.decidedAt = init.decidedAt ?? utcNowIso();
  }

  /** Option retenue, ou `null` si la politique a refusé. */
  get selected(): Option | null {
    if (this.selectedOptionId === null) return null;
    return this.options.find((item) => item.optionId === this.selectedOptionId) ?? null;
  }

  /** Vrai si une approbation humaine est requise avant toute exécution. */
  get requiresHumanGate(): boolean {
    return (
      this.policyOutcome === PolicyOutcome.RequireApproval ||
      this.obligations.includes(HUMAN_GATE_OBLIGATION)
    );
  }

  /** Représentation conforme au contrat `decision`. */
  toDict(): Record<string, unknown> {
    return {
      decision_id: this.decisionId,
      intent: this.intent,
      requirements: [...this.requirements],
      constraints: [...this.constraints],
      sources: [...this.sources],
      options: this.options.map((item) => optionToDict(item)),
      selected_option_id: this.selectedOptionId,
      rationale: this.rationale,
      risks: [...this.risks],
      required_permissions: [...this.requiredPermissions],
      policy_outcome: this.policyOutcome,
      policy_id: this.policyId,
      obligations: [...this.obligations],
      verification_plan: [...this.verificationPlan],
      plan_id: this.planId,
      tenant_id: this.tenantId,
      project_id: this.projectId,
      decided_at: this.decidedAt,
    };
  }

  /** Valide la décision contre son contrat et lève `ContractError` sinon. */
  validate(): void {
    validate('decision', this.toDict());
  }
}

/** Entrée de `DecisionEngine.decide`. */
export interface DecideInput {
  readonly intent: string;
  readonly options: readonly Option[];
  readonly policy: PolicyVerdict;
  readonly verificationPlan: readonly string[];
  readonly requirements?: readonly string[];
  readonly constraints?: readonly string[];
  readonly sources?: readonly string[];
  readonly risks?: readonly string[];
  readonly planId?: string | null;
  readonly tenantId?: string | null;
  readonly projectId?: string | null;
}

/** Résultat du choix : option retenue (ou aucune), sort de chaque option, motif exposable. */
export interface DecisionChoice {
  readonly selected: Option | null;
  readonly options: readonly Option[];
  readonly rationale: string;
}

/**
 * Sélectionne une option sous contrainte de politique, et trace le reste.
 *
 * L'ordre de préférence est **déterministe** : risque le plus faible, puis réversibilité, puis
 * identifiant — ce dernier critère rend le résultat reproductible à entrées égales.
 */
export class DecisionEngine {
  decide(input: DecideInput): DecisionRecord {
    // Une décision sans option n'est pas une décision : le contrat impose déjà `minItems: 1`, on
    // refuse donc avant de calculer, pour ne jamais produire un enregistrement trompeur.
    if (input.options.length === 0) {
      throw new ContractError('une décision sans option examinée n’est pas une décision', {
        context: { contract: 'decision', rule: 'options.minItems' },
      });
    }

    const choice = DecisionEngine.choose(input.options, input.policy);

    // Les permissions requises suivent l'option retenue ; en l'absence de sélection, elles
    // exposent ce qui était demandé plutôt que de disparaître.
    const permissions: RiskClass[] = [];
    const permissionSources = choice.selected === null ? input.options : [choice.selected];
    for (const item of permissionSources) {
      if (!permissions.includes(item.riskClass)) permissions.push(item.riskClass);
    }

    // Une action engageante reste gatée même si la politique l'autorise : la classe de risque est
    // une autorité indépendante du verdict.
    const obligations = [...input.policy.obligations];
    if (
      choice.selected !== null &&
      requiresHumanApproval(choice.selected.riskClass) &&
      !obligations.includes(HUMAN_GATE_OBLIGATION)
    ) {
      obligations.push(HUMAN_GATE_OBLIGATION);
    }

    const record = new DecisionRecord({
      intent: input.intent,
      options: choice.options,
      policyOutcome: input.policy.outcome,
      risks: [...(input.risks ?? []), ...input.policy.reasons],
      requiredPermissions: permissions,
      verificationPlan: input.verificationPlan,
      selectedOptionId: choice.selected === null ? null : choice.selected.optionId,
      rationale: choice.rationale,
      policyId: input.policy.policyId,
      obligations,
      requirements: input.requirements ?? [],
      constraints: input.constraints ?? [],
      sources: input.sources ?? [],
      planId: input.planId ?? null,
      tenantId: input.tenantId ?? null,
      projectId: input.projectId ?? null,
    });
    record.validate();
    return record;
  }

  /**
   * Choisit une option de façon déterministe et explique le sort de chacune.
   *
   * Un verdict `DENY` interdit toute sélection : toutes les options sont alors motivées du même
   * refus, et aucune n'est retenue.
   */
  static choose(options: readonly Option[], policy: PolicyVerdict): DecisionChoice {
    if (policy.outcome === PolicyOutcome.Deny) {
      const motif = policy.reasons[0] ?? 'refusée par la politique';
      const rejected = options.map((item) => withOutcome(item, false, `politique : ${motif}`));
      return {
        selected: null,
        options: rejected,
        rationale: `aucune option retenue — politique : ${motif}`,
      };
    }

    const ranked = [...options].sort((a, b) => {
      const byRisk = riskRank(a.riskClass) - riskRank(b.riskClass);
      if (byRisk !== 0) return byRisk;
      const byReversibility = (a.reversible ? 0 : 1) - (b.reversible ? 0 : 1);
      if (byReversibility !== 0) return byReversibility;
      return a.optionId < b.optionId ? -1 : a.optionId > b.optionId ? 1 : 0;
    });
    const retained = ranked[0];
    if (retained === undefined) {
      // Défensif : la liste non vide est garantie par `decide` ; on refuse plutôt que d'inventer.
      throw new ContractError('aucune option à sélectionner', {
        context: { rule: 'options.minItems' },
      });
    }

    // On préserve l'ordre d'entrée des options dans le résultat : le lecteur retrouve la décision
    // telle qu'elle a été posée, seule l'option retenue change de statut.
    const result: Option[] = [];
    for (const item of options) {
      if (item.optionId === retained.optionId) {
        result.push(withOutcome(item, true, null));
        continue;
      }
      let rejectedBecause: string;
      if (riskRank(item.riskClass) > riskRank(retained.riskClass)) {
        rejectedBecause = `risque supérieur (${item.riskClass} > ${retained.riskClass})`;
      } else if (!item.reversible && retained.reversible) {
        rejectedBecause = 'non réversible alors qu’une option réversible de risque égal existe';
      } else {
        rejectedBecause = 'équivalente à une option retenue au même niveau de risque';
      }
      result.push(withOutcome(item, false, rejectedBecause));
    }

    let rationale =
      `option retenue : risque le plus faible (${retained.riskClass})` +
      (retained.reversible ? ', réversible' : ', non réversible');
    if (policy.outcome === PolicyOutcome.RequireApproval) {
      rationale += ` — sous réserve d’approbation (${policy.policyId})`;
    }
    return { selected: retained, options: result, rationale };
  }
}

/** Rang d'une classe de risque dans l'échelle canonique (`READ` = 0 … `SECURITY_SENSITIVE` = 7). */
function riskRank(riskClass: RiskClass): number {
  return RISK_CLASSES.indexOf(riskClass);
}
