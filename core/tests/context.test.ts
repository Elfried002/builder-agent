/**
 * Tests du Context Engine : provenance, confiance, isolation tenant, rendu.
 * Invariants couverts : I-16, I-17, I-18, I-19, I-20.
 *
 * Les valeurs sensibles sont construites par concaténation : ce fichier ne contient lui-même aucun
 * secret, sinon le scan du dépôt se retournerait contre lui.
 */

import { describe, expect, it } from 'vitest';
import {
  ContextBundle,
  ContextEngine,
  type ContextItem,
  ContextLayer,
  LAYER_RENDER_ORDER,
  makeItem,
  StaticProvider,
  TENANT_FREE_LAYERS,
  TRUST_LEVELS,
  TrustLevel,
  trustRank,
} from '../src/context/engine.js';
import { isValid, schemaEnum } from '../src/contracts.js';
import { ContextIsolationError } from '../src/errors.js';

interface ItemOverrides {
  readonly layer?: ContextLayer;
  readonly trust?: TrustLevel;
  readonly source?: string;
  readonly content?: string;
  readonly tenantId?: string | null;
  readonly projectId?: string | null;
}

/** Élément de contexte de test ; `tenantId` explicite `null` est honoré, pas remplacé. */
function testItem(overrides: ItemOverrides = {}): ContextItem {
  return makeItem({
    layer: overrides.layer ?? ContextLayer.Project,
    trust: overrides.trust ?? TrustLevel.Untrusted,
    source: overrides.source ?? 'depot/README.md',
    content: overrides.content ?? 'contenu du projet',
    tenantId: overrides.tenantId === undefined ? 'tenant-a' : overrides.tenantId,
    projectId: overrides.projectId ?? null,
  });
}

describe('isolation tenant (I-16, I-17)', () => {
  it("refuse un élément d'un autre tenant et n'écrit rien (I-16)", () => {
    const bundle = new ContextBundle({ tenantId: 'tenant-a' });
    expect(() => bundle.add(testItem({ tenantId: 'tenant-b' }))).toThrow(ContextIsolationError);
    expect(bundle.items).toHaveLength(0);
  });

  it('refuse un élément tenant-scopé sans tenant (I-17)', () => {
    const bundle = new ContextBundle({ tenantId: 'tenant-a' });
    expect(() => bundle.add(testItem({ tenantId: null, layer: ContextLayer.Project }))).toThrow(
      ContextIsolationError,
    );
    expect(bundle.items).toHaveLength(0);
  });

  it('accepte une règle SYSTEM sans tenant, seule couche dispensée (I-17)', () => {
    const bundle = new ContextBundle({ tenantId: 'tenant-a' });
    bundle.add(testItem({ tenantId: null, layer: ContextLayer.System, trust: TrustLevel.Trusted }));
    expect(bundle.items).toHaveLength(1);
    expect(bundle.items[0]?.tenantId).toBeNull();
    expect([...TENANT_FREE_LAYERS]).toEqual([ContextLayer.System]);
  });

  it('refuse un contexte sans tenant', () => {
    expect(() => new ContextEngine().build({ tenantId: '' })).toThrow(ContextIsolationError);
  });
});

describe('provenance et caviardage (I-18)', () => {
  it('refuse un élément sans provenance (I-18)', () => {
    expect(() =>
      makeItem({
        layer: ContextLayer.Project,
        trust: TrustLevel.Trusted,
        source: '   ',
        content: 'contenu',
        tenantId: 'tenant-a',
      }),
    ).toThrow(ContextIsolationError);
  });

  it('refuse un élément vide', () => {
    expect(() =>
      makeItem({
        layer: ContextLayer.Project,
        trust: TrustLevel.Trusted,
        source: 'source',
        content: '  ',
        tenantId: 'tenant-a',
      }),
    ).toThrow(ContextIsolationError);
  });

  it("caviarde un secret à l'entrée du contexte", () => {
    const token = `${'gh'}${'p_'}A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8`;
    const element = testItem({ content: `jeton détecté : ${token}` });
    expect(element.content).not.toContain(token);
    expect(element.content).toContain('REDACTED');
  });
});

describe('confiance (I-19, I-20)', () => {
  it('expose couche, confiance et provenance dans le rendu (I-19)', () => {
    const bundle = new ContextBundle({ tenantId: 'tenant-a' });
    bundle.add(testItem({ content: 'du texte de projet', source: 'depot/notes.md' }));
    bundle.add(
      testItem({
        layer: ContextLayer.System,
        trust: TrustLevel.Trusted,
        source: 'politique:interdits',
        content: 'aucun secret dans le dépôt',
        tenantId: null,
      }),
    );
    const texte = bundle.render();
    expect(texte).toContain('### SYSTEM [TRUSTED] source=politique:interdits');
    expect(texte).toContain('### PROJECT [UNTRUSTED] source=depot/notes.md');
    // L'ordre de rendu est celui des couches déclarées : SYSTEM avant PROJECT.
    expect(texte.indexOf('### SYSTEM')).toBeLessThan(texte.indexOf('### PROJECT'));
  });

  it('ordonne strictement les niveaux de confiance (I-20)', () => {
    expect(trustRank(TrustLevel.Untrusted)).toBeLessThan(trustRank(TrustLevel.Unverified));
    expect(trustRank(TrustLevel.Unverified)).toBeLessThan(trustRank(TrustLevel.Verified));
    expect(trustRank(TrustLevel.Verified)).toBeLessThan(trustRank(TrustLevel.Trusted));
  });

  it('identifie le contenu non fiable', () => {
    const bundle = new ContextBundle({ tenantId: 'tenant-a' });
    bundle.add(testItem());
    bundle.add(
      testItem({
        layer: ContextLayer.ToolResults,
        trust: TrustLevel.Verified,
        source: 'outil:pytest',
        content: 'sortie vérifiée',
      }),
    );
    expect(bundle.untrusted()).toHaveLength(1);
    expect(bundle.untrusted()[0]?.trust).toBe(TrustLevel.Untrusted);
  });
});

describe('rendu déterministe', () => {
  it('produit le même texte pour un même contexte', () => {
    const bundle = new ContextBundle({ tenantId: 'tenant-a' });
    bundle.add(testItem({ content: 'b' }));
    bundle.add(testItem({ content: 'a', source: 'autre.md' }));
    expect(bundle.render()).toBe(bundle.render());
  });

  it('respecte l’ordre déclaré des couches', () => {
    const bundle = new ContextBundle({ tenantId: 'tenant-a' });
    bundle.add(testItem({ layer: ContextLayer.LearnedKnowledge, content: 'savoir' }));
    bundle.add(testItem({ layer: ContextLayer.Tenant, content: 'conventions' }));
    bundle.add(testItem({ layer: ContextLayer.System, trust: TrustLevel.Trusted, tenantId: null }));
    const positions = LAYER_RENDER_ORDER.map((layer) =>
      bundle.render().indexOf(`### ${layer}`),
    ).filter((position) => position >= 0);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });
});

describe('providers (I-17)', () => {
  it('un provider SYSTEM ne rattache aucun tenant', () => {
    const provider = new StaticProvider({
      name: 'politique',
      layer: ContextLayer.System,
      trust: TrustLevel.Trusted,
      entries: [['interdits', 'ne jamais publier un secret']],
    });
    const bundle = new ContextEngine([provider]).build({ tenantId: 'tenant-a' });
    expect(bundle.items).toHaveLength(1);
    expect(bundle.items[0]?.tenantId).toBeNull();
    expect(bundle.items[0]?.source).toBe('politique:interdits');
  });

  it('un provider tenant-scopé porte le tenant et le projet', () => {
    const provider = new StaticProvider({
      name: 'tenant',
      layer: ContextLayer.Tenant,
      trust: TrustLevel.Trusted,
      entries: [['conventions', 'français par défaut']],
    });
    const bundle = new ContextEngine([provider]).build({
      tenantId: 'tenant-a',
      projectId: 'p1',
    });
    expect(bundle.items[0]?.tenantId).toBe('tenant-a');
    expect(bundle.items[0]?.projectId).toBe('p1');
  });
});

describe('conformité au contrat', () => {
  it('valide un contexte assemblé', () => {
    const bundle = new ContextEngine().build({ tenantId: 'tenant-a', projectId: 'p1' });
    bundle.add(testItem());
    expect(() => bundle.validate()).not.toThrow();
  });

  it('est conforme au schéma JSON', () => {
    const bundle = new ContextEngine().build({ tenantId: 'tenant-a' });
    bundle.add(testItem());
    expect(isValid('context_bundle', bundle.toDict())).toBe(true);
  });

  it('aligne couches et niveaux de confiance sur le contrat', () => {
    expect(schemaEnum('context_bundle', '#/properties/items/items/properties/layer')).toEqual([
      ...LAYER_RENDER_ORDER,
    ]);
    expect(schemaEnum('context_bundle', '#/properties/items/items/properties/trust')).toEqual([
      ...TRUST_LEVELS,
    ]);
  });
});
