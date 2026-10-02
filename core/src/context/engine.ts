/**
 * Context Engine — construction, provenance et isolation du contexte.
 *
 * Porté de `core/python/src/codidev/context/engine.py`. Neuf couches de contexte, chacune portant
 * sa provenance, sa portée et sa classification de confiance ; le contexte inter-tenant est
 * interdit à l'insertion, et le contrat `context_bundle` le refuse aussi côté schéma.
 *
 * Principe opposable : la confiance ne s'élève jamais toute seule. Un contenu de projet reste
 * `UNTRUSTED` — potentiellement hostile — tant qu'un outil ne l'a pas réellement vérifié.
 */

import { validate } from '../contracts.js';
import { ContextIsolationError } from '../errors.js';
import { newId, utcNowIso } from '../ids.js';
import { redact } from '../security/secrets.js';

/** Couches de contexte, dans l'ordre de rendu déclaré par le contrat. */
export const ContextLayer = {
  System: 'SYSTEM',
  Tenant: 'TENANT',
  User: 'USER',
  Project: 'PROJECT',
  Task: 'TASK',
  Session: 'SESSION',
  ExternalData: 'EXTERNAL_DATA',
  ToolResults: 'TOOL_RESULTS',
  LearnedKnowledge: 'LEARNED_KNOWLEDGE',
} as const;
export type ContextLayer = (typeof ContextLayer)[keyof typeof ContextLayer];

/**
 * Ordre de rendu déterministe : le même contexte produit toujours le même texte. L'ordre suit
 * celui des clés déclarées ci-dessus, qui est aussi celui de l'énumération du contrat.
 */
export const LAYER_RENDER_ORDER: readonly ContextLayer[] = Object.values(ContextLayer);

/** Classification de confiance d'un élément de contexte. */
export const TrustLevel = {
  Trusted: 'TRUSTED',
  Verified: 'VERIFIED',
  Unverified: 'UNVERIFIED',
  Untrusted: 'UNTRUSTED',
} as const;
export type TrustLevel = (typeof TrustLevel)[keyof typeof TrustLevel];

export const TRUST_LEVELS: readonly TrustLevel[] = Object.values(TrustLevel);

/**
 * Rang de confiance : `UNTRUSTED < UNVERIFIED < VERIFIED < TRUSTED`. On compare des rangs nommés
 * plutôt que l'ordre alphabétique ou l'ordre de déclaration : une hausse de confiance doit rester
 * une décision explicite, jamais un effet de bord du tri d'une énumération.
 */
const TRUST_RANK: Readonly<Record<TrustLevel, number>> = {
  UNTRUSTED: 0,
  UNVERIFIED: 1,
  VERIFIED: 2,
  TRUSTED: 3,
};

/** Rang de confiance, pour comparer sans ambiguïté. */
export function trustRank(level: TrustLevel): number {
  return TRUST_RANK[level];
}

/**
 * Seules ces couches peuvent porter des éléments sans appartenance à un tenant : ce sont des
 * règles du système, pas des données de client. Tout le reste est tenant-scopé, sans exception.
 */
export const TENANT_FREE_LAYERS: ReadonlySet<ContextLayer> = new Set([ContextLayer.System]);

/** Élément de contexte situé : couche, confiance, provenance, portée. */
export interface ContextItem {
  readonly itemId: string;
  readonly layer: ContextLayer;
  readonly trust: TrustLevel;
  readonly source: string;
  readonly content: string;
  readonly tenantId: string | null;
  readonly projectId: string | null;
  readonly createdAt: string;
}

/** Représentation sérialisable d'un élément, alignée sur le contrat `context_bundle`. */
export function contextItemToDict(item: ContextItem): Record<string, unknown> {
  return {
    item_id: item.itemId,
    layer: item.layer,
    trust: item.trust,
    source: item.source,
    content: item.content,
    tenant_id: item.tenantId,
    project_id: item.projectId,
    created_at: item.createdAt,
  };
}

/** Champs d'un élément de contexte ; `tenantId` et `projectId` sont optionnels (couches système). */
export interface MakeItemOptions {
  readonly layer: ContextLayer;
  readonly trust: TrustLevel;
  readonly source: string;
  readonly content: string;
  readonly tenantId?: string | null;
  readonly projectId?: string | null;
}

/**
 * Construit un élément de contexte caviardé, horodaté et identifié.
 *
 * La provenance est vérifiée avant tout : un bloc sans source serait indiscernable d'une
 * instruction du système — c'est précisément le vecteur d'injection indirecte. Le caviardage est
 * appliqué à l'entrée, jamais à la sortie : ce qui n'entre pas ici n'existe nulle part ensuite.
 */
export function makeItem(options: MakeItemOptions): ContextItem {
  const { layer, trust, source, content } = options;
  if (source.trim() === '') {
    throw new ContextIsolationError('un élément de contexte sans provenance est refusé', {
      context: { layer },
    });
  }
  if (content.trim() === '') {
    throw new ContextIsolationError('un élément de contexte vide est refusé', {
      context: { layer },
    });
  }
  return {
    itemId: newId('ctx'),
    layer,
    trust,
    source: source.trim(),
    content: redact(content),
    tenantId: options.tenantId ?? null,
    projectId: options.projectId ?? null,
    createdAt: utcNowIso(),
  };
}

/** Champs d'un bundle de contexte. */
export interface ContextBundleFields {
  readonly tenantId: string;
  readonly bundleId?: string;
  readonly createdAt?: string;
  readonly projectId?: string | null;
  readonly taskId?: string | null;
}

/** Contexte assemblé pour une tâche, isolé par tenant. */
export class ContextBundle {
  readonly tenantId: string;
  readonly bundleId: string;
  readonly createdAt: string;
  readonly projectId: string | null;
  readonly taskId: string | null;
  readonly items: ContextItem[] = [];

  constructor(fields: ContextBundleFields) {
    this.tenantId = fields.tenantId;
    this.bundleId = fields.bundleId ?? newId('ctxb');
    this.createdAt = fields.createdAt ?? utcNowIso();
    this.projectId = fields.projectId ?? null;
    this.taskId = fields.taskId ?? null;
  }

  /**
   * Ajoute un élément après vérification de l'isolation tenant.
   *
   * Un élément d'un autre tenant, ou un élément tenant-scopé sans tenant, est **refusé** : le
   * contexte inter-tenant n'est pas une règle de bonne conduite, c'est une impossibilité.
   */
  add(item: ContextItem): ContextItem {
    if (item.tenantId !== this.tenantId) {
      if (item.tenantId !== null) {
        throw new ContextIsolationError("élément de contexte d'un autre tenant refusé", {
          context: {
            bundleTenant: this.tenantId,
            itemTenant: item.tenantId,
            layer: item.layer,
          },
        });
      }
      if (!TENANT_FREE_LAYERS.has(item.layer)) {
        throw new ContextIsolationError('élément tenant-scopé sans tenant refusé', {
          context: { layer: item.layer, bundleTenant: this.tenantId },
        });
      }
    }
    this.items.push(item);
    return item;
  }

  /** Ajoute plusieurs éléments, en rejetant le premier qui viole l'isolation. */
  extend(items: Iterable<ContextItem>): void {
    for (const item of items) this.add(item);
  }

  /** Éléments d'une couche, dans l'ordre d'insertion. */
  byLayer(layer: ContextLayer): ContextItem[] {
    return this.items.filter((item) => item.layer === layer);
  }

  /** Éléments non fiables : contenu de projet, données externes. */
  untrusted(): ContextItem[] {
    return this.items.filter((item) => item.trust === TrustLevel.Untrusted);
  }

  /**
   * Rend le contexte en texte déterministe, en exposant provenance et confiance.
   *
   * Le lecteur — humain ou modèle — voit **d'où** vient chaque bloc et **à quel point** il est
   * fiable. Masquer la provenance rendrait le contenu de projet indiscernable d'une instruction du
   * système : c'est exactement le vecteur d'injection indirecte.
   */
  render(): string {
    const lines: string[] = [];
    for (const layer of LAYER_RENDER_ORDER) {
      for (const item of this.byLayer(layer)) {
        lines.push(`### ${layer} [${item.trust}] source=${item.source}`);
        lines.push(item.content);
        lines.push('');
      }
    }
    return lines.join('\n').trim();
  }

  toDict(): Record<string, unknown> {
    return {
      bundle_id: this.bundleId,
      tenant_id: this.tenantId,
      project_id: this.projectId,
      task_id: this.taskId,
      created_at: this.createdAt,
      items: this.items.map(contextItemToDict),
    };
  }

  /** Valide le contexte assemblé contre son contrat. */
  validate(): void {
    validate('context_bundle', this.toDict());
  }
}

/** Options passées à un provider lors de la collecte. */
export interface ProviderItemsOptions {
  readonly tenantId: string;
  readonly projectId?: string | null;
  readonly requestId?: string | null;
}

/**
 * Source de contexte. Une implémentation réelle est fournie : `StaticProvider`. Les attributs sont
 * déclarés en lecture seule : un provider immuable satisfait l'interface sans qu'on exige de lui
 * qu'il soit modifiable.
 */
export interface ContextProvider {
  readonly name: string;
  readonly layer: ContextLayer;
  readonly trust: TrustLevel;
  items(options: ProviderItemsOptions): Iterable<ContextItem>;
}

/** Champs d'un provider statique. */
export interface StaticProviderFields {
  readonly name: string;
  readonly layer: ContextLayer;
  readonly trust: TrustLevel;
  readonly entries: readonly (readonly [string, string])[];
}

/**
 * Provider de contexte statique : règles système, conventions de tenant, préférences.
 *
 * Chaque entrée est un couple (provenance, contenu). Le contenu passe par le caviardage, comme tout
 * élément de contexte. Une couche SYSTEM n'est jamais rattachée à un tenant : y attacher un tenant
 * transformerait une règle globale en donnée client.
 */
export class StaticProvider implements ContextProvider {
  readonly name: string;
  readonly layer: ContextLayer;
  readonly trust: TrustLevel;
  readonly entries: readonly (readonly [string, string])[];

  constructor(fields: StaticProviderFields) {
    this.name = fields.name;
    this.layer = fields.layer;
    this.trust = fields.trust;
    this.entries = fields.entries;
  }

  items(options: ProviderItemsOptions): ContextItem[] {
    const scopedTenant = TENANT_FREE_LAYERS.has(this.layer) ? null : options.tenantId;
    return this.entries.map(([source, content]) =>
      makeItem({
        layer: this.layer,
        trust: this.trust,
        source: `${this.name}:${source}`,
        content,
        tenantId: scopedTenant,
        projectId: scopedTenant === null ? null : (options.projectId ?? null),
      }),
    );
  }
}

/** Options de construction d'un bundle. */
export interface BuildContextOptions {
  readonly tenantId: string;
  readonly projectId?: string | null;
  readonly taskId?: string | null;
  readonly requestId?: string | null;
  readonly items?: readonly ContextItem[];
}

/** Assemble un contexte isolé à partir de providers et d'éléments explicites. */
export class ContextEngine {
  readonly providers: readonly ContextProvider[];

  constructor(providers: readonly ContextProvider[] = []) {
    this.providers = [...providers];
  }

  /** Construit un contexte : providers d'abord, éléments explicites ensuite. */
  build(options: BuildContextOptions): ContextBundle {
    const tenantId = options.tenantId;
    if (!tenantId) {
      throw new ContextIsolationError('un contexte sans tenant est refusé');
    }
    const bundle = new ContextBundle({
      tenantId,
      projectId: options.projectId ?? null,
      taskId: options.taskId ?? null,
    });
    for (const provider of this.providers) {
      bundle.extend(
        provider.items({
          tenantId,
          projectId: options.projectId ?? null,
          requestId: options.requestId ?? null,
        }),
      );
    }
    bundle.extend(options.items ?? []);
    return bundle;
  }

  /**
   * Construit puis valide le contexte contre le contrat (raccourci explicite). Comme la référence,
   * ce raccourci part d'un moteur sans provider : les éléments viennent des options.
   */
  static buildAndValidate(options: BuildContextOptions): ContextBundle {
    const bundle = new ContextEngine().build(options);
    bundle.validate();
    return bundle;
  }
}
