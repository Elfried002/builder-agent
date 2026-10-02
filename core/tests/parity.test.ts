/**
 * Tests de **parité croisée** : les valeurs attendues ci-dessous ont été produites par
 * l'implémentation Python de référence, pas recalculées ici.
 *
 * Commande ayant produit ces vecteurs (implémentation Python, `core/python/`) :
 *
 *     cd core/python && python -c "
 *       from codidev.hashing import canonical_json, digest, chained_hash, GENESIS_HASH
 *       ..."
 *
 * Un test qui comparerait l'implémentation à elle-même ne prouverait rien : ce fichier vérifie
 * que les deux implémentations produisent **les mêmes octets**, donc que leurs journaux chaînés
 * sont mutuellement vérifiables. Sans cela, deux journaux « valides » pourraient être
 * incompatibles, et la preuve ne serait transférable d'une implémentation à l'autre.
 */

import { describe, expect, it } from 'vitest';

import { canonicalJson, chainedHash, digest, GENESIS_HASH, sha256Hex } from '../src/hashing.js';

/** Vecteurs de référence produits par l'implémentation Python (voir en-tête). */
const VECTEURS_PYTHON = {
  genesis: '0000000000000000000000000000000000000000000000000000000000000000',
  simple: {
    payload: { b: 2, a: 1, c: [3, 2, 1] },
    canonical: '{"a":1,"b":2,"c":[3,2,1]}',
    digest: 'cd36c2304f25be8bf976e83b14aacc918fdba619bfdb88195e3c14f48cd54ce6',
  },
  accents: {
    payload: { note: 'vérifié — accentué', n: 42 },
    canonical: '{"n":42,"note":"vérifié — accentué"}',
    digest: 'deb4f7175480f009b7f7efd66073befe231fa231f1d6b567a14af9ee54530c93',
  },
  record: {
    payload: {
      evidence_id: 'ev_00000000000000000000000000000000',
      operation: 'phase-0',
      status: 'VERIFIED',
      recorded_at: '2026-10-02T20:00:00Z',
    },
    canonical:
      '{"evidence_id":"ev_00000000000000000000000000000000","operation":"phase-0",' +
      '"recorded_at":"2026-10-02T20:00:00Z","status":"VERIFIED"}',
    digest: '7836b43495b452305924e6a3ab50ee0901bd4d6e883ede300d1ba1cb6ae94c1c',
    chained: '96392b61a320ade59b61733e4b2a29c086d586082ac309090ba649c5c7cb8f49',
  },
} as const;

describe('parité de la sérialisation canonique avec l’implémentation Python', () => {
  it('le hachage de genèse est identique', () => {
    expect(GENESIS_HASH).toBe(VECTEURS_PYTHON.genesis);
  });

  it('trie les clés et produit les mêmes octets', () => {
    const { canonical } = VECTEURS_PYTHON.simple;
    expect(canonicalJson(VECTEURS_PYTHON.simple.payload)).toBe(canonical);
    expect(digest(VECTEURS_PYTHON.simple.payload)).toBe(VECTEURS_PYTHON.simple.digest);
  });

  it('préserve les caractères non ASCII sans échappement superflu', () => {
    const { canonical, digest: expected } = VECTEURS_PYTHON.accents;
    expect(canonicalJson(VECTEURS_PYTHON.accents.payload)).toBe(canonical);
    expect(digest(VECTEURS_PYTHON.accents.payload)).toBe(expected);
  });

  it('produit un enregistrement chaîné identique bit à bit', () => {
    const { payload, canonical, digest: expected, chained } = VECTEURS_PYTHON.record;
    expect(canonicalJson(payload)).toBe(canonical);
    expect(digest(payload)).toBe(expected);
    expect(chainedHash(payload, GENESIS_HASH)).toBe(chained);
  });
});

describe('propriétés du chaînage', () => {
  it('exclut le champ `hash` du calcul et estampille `prev_hash`', () => {
    const base = { a: 1 };
    const avecHash = { a: 1, hash: 'peu importe' };
    expect(chainedHash(avecHash, GENESIS_HASH)).toBe(chainedHash(base, GENESIS_HASH));
  });

  it('dépend du maillon précédent', () => {
    const record = { a: 1 };
    const premier = chainedHash(record, GENESIS_HASH);
    const second = chainedHash(record, premier);
    expect(premier).not.toBe(second);
  });

  it('change dès qu’une valeur change', () => {
    const avant = chainedHash({ status: 'EXECUTED' }, GENESIS_HASH);
    const apres = chainedHash({ status: 'VERIFIED' }, GENESIS_HASH);
    expect(avant).not.toBe(apres);
  });

  it('refuse les valeurs non JSON plutôt que de les convertir en silence', () => {
    expect(() => canonicalJson({ a: undefined })).toThrowError(/non JSON/);
    expect(() => canonicalJson({ a: Number.NaN })).toThrowError(/non JSON/);
    expect(() => canonicalJson({ a: 2 ** 53 })).toThrowError(/non JSON/);
    expect(() => canonicalJson({ a: () => 1 })).toThrowError(/non JSON/);
    expect(() => canonicalJson({ a: new Date() })).toThrowError(/non JSON/);
  });

  it('calcule une empreinte SHA-256 conforme aux vecteurs standards', () => {
    // Vecteurs de référence publics, plus une valeur produite par l'implémentation Python.
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha256Hex('codidev')).toBe(
      '2dff162792da48ed03392326d9bac7fbc0fe04294725cf1a5bdc8a08c87de11c',
    );
  });
});
