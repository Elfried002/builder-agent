/**
 * Tests de la détection de secrets et du caviardage.
 * Invariants couverts : I-30 (idempotence), I-31 (non-valeurs), I-33 (détecteur jamais désactivé).
 *
 * Les valeurs sensibles sont construites par concaténation : ce fichier ne contient lui-même aucun
 * secret, sinon le scan du dépôt — qui est un test — se retournerait contre lui.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  containsRedactionMarker,
  isPlausibleSecret,
  looksLikeLiteralSecret,
  looksLikePassword,
  REDACTION_TOKEN,
  redact,
  redactionMark,
  redactStructure,
  SecretScanner,
  shannonEntropy,
} from '../src/security/secrets.js';
import { Severity } from '../src/statuses.js';

function scanner(): SecretScanner {
  return new SecretScanner();
}

function rulesOf(text: string): Set<string> {
  return new Set(
    scanner()
      .scanText(text, 'test')
      .map((finding) => finding.rule),
  );
}

/** Jeton GitHub factice : `gh` + `p_` + 40 caractères. */
function fakeGithubToken(suffix = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'): string {
  return `${'gh'}${'p_'}${suffix}`;
}

describe('détection par règle', () => {
  it('détecte un jeton GitHub et le situe', () => {
    const findings = scanner().scanText(`token: ${fakeGithubToken()}`, 'f.txt');
    expect(findings.some((finding) => finding.rule === 'github-token')).toBe(true);
    expect(findings[0]?.line).toBe(1);
    expect(findings[0]?.severity).toBe(Severity.Critical);
    expect(findings[0]?.excerpt ?? '').not.toContain(fakeGithubToken());
  });

  it('détecte un bloc de clé privée', () => {
    expect(rulesOf(`-----BEGIN ${'RSA PRIVATE KEY-----'}`).has('private-key-block')).toBe(true);
  });

  it('détecte une clé AWS', () => {
    expect(rulesOf(`${'AKIA'}${'Q7WERT9YU2IOP3AS'}`).has('aws-access-key-id')).toBe(true);
  });

  it('détecte une URL de base de données avec mot de passe', () => {
    const url = `${'postgres'}${'ql://'}app:${'s3cr3tP4ssw0rd'}@db.local/app`;
    expect(rulesOf(url).has('database-url-with-credentials')).toBe(true);
  });

  it('détecte un JWT', () => {
    const jwt = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxIn0', 'abcdefghijklmnop'].join('.');
    expect(rulesOf(jwt).has('json-web-token')).toBe(true);
  });

  it('détecte un jeton porteur', () => {
    const header = `Authorization: ${'Bearer '}${'abcdefghijklmnopqrstuvwxyz012345'}`;
    expect(rulesOf(header).has('bearer-token')).toBe(true);
  });

  it('détecte une affectation à un nom évocateur', () => {
    expect(rulesOf(`API_KEY = ${'"aB3xK9mQ2pL7vN4zR8tY1w"'}`).has('assigned-secret-value')).toBe(
      true,
    );
  });
});

describe('non-valeurs : ne pas signaler du bruit', () => {
  it('ignore une valeur de faible entropie', () => {
    expect(rulesOf(`token = ${'"'}${'a'.repeat(24)}${'"'}`).size).toBe(0);
  });

  it('ignore une valeur d’exemple', () => {
    expect(rulesOf(`password = ${'"changeme"'}`).size).toBe(0);
  });

  it('ignore le texte ordinaire', () => {
    const texte =
      'Le plan contient trois étapes et un critère de vérification.\n' +
      'tokenization du texte et répartition des rôles.\n';
    expect(rulesOf(texte).size).toBe(0);
  });

  it('ne traverse pas un accès d’attribut ni un appel', () => {
    // Cas réellement rencontrés : sans cette contrainte, du code légitime serait signalé.
    expect(rulesOf('const token = req.headers.authorization;').size).toBe(0);
    expect(rulesOf('hashed_password = pwd_context.hash(payload.password)').size).toBe(0);
    expect(rulesOf('secrets = parser.addArgument("secrets")').size).toBe(0);
    expect(rulesOf('allow_credentials = settings.allow_credentials').size).toBe(0);
  });

  it('ignore les gabarits d’interpolation', () => {
    expect(rulesOf(`DATABASE_URL=postgresql://app:\${DB_PASSWORD}@host:5432/db`).size).toBe(0);
    expect(rulesOf('password = {mot_de_passe_du_client}').size).toBe(0);
  });

  it('ignore un mot de passe masqué', () => {
    expect(rulesOf(`${'postgres'}://user:${'***'}@host:5432/db`).size).toBe(0);
  });
});

describe('caviardage', () => {
  it('retire le secret et garde le contexte', () => {
    const token = fakeGithubToken('C1d2E3f4G5h6I7j8K9l0M1n2O3p4Q5r6S7t8');
    const result = redact(`token=${token} // fin`);
    expect(result).not.toContain(token);
    expect(result).toContain(redactionMark('github-token'));
    expect(result).toContain('fin');
  });

  it('ne touche pas les valeurs saines', () => {
    const texte = `API_KEY = ${'"changeme"'}`;
    expect(redact(texte)).toBe(texte);
  });

  it('est idempotent : un texte caviardé ne déclenche plus rien (I-30)', () => {
    const url = `${'postgres'}${'ql://'}app:${'s3cr3tP4ssw0rd'}@db.local/app`;
    const uneFois = redact(url);
    expect(uneFois).not.toBe(url);
    expect(redact(uneFois)).toBe(uneFois);
    expect(scanner().scanText(uneFois, 'rapport')).toEqual([]);
  });

  it('un caviardage n’est jamais une détection (I-30)', () => {
    const marque = redactionMark('database-url-with-credentials');
    const ligne = `DATABASE_URL=postgresql://app:${marque}@db.local/app`;
    expect(scanner().scanText(ligne, 'rapport')).toEqual([]);
    expect(isPlausibleSecret(marque)).toBe(false);
    expect(containsRedactionMarker(marque)).toBe(true);
  });

  it('caviarde récursivement une structure', () => {
    const token = fakeGithubToken('D1e2F3g4H5i6J7k8L9m0N1o2P3q4R5s6T7u8');
    const payload = { commandes: [`git push ${token}`], notes: ['ok'] };
    const result = redactStructure(payload) as { commandes: string[]; notes: string[] };
    expect(JSON.stringify(result)).not.toContain(token);
    expect(result.notes).toEqual(['ok']);
  });

  it('laisse passer du code légitime sans le modifier', () => {
    const code = 'if (token && req.headers.authorization) { return token.split(" ")[1]; }';
    expect(redact(code)).toBe(code);
  });
});

describe('filtres unitaires', () => {
  it('juge la plausibilité d’une valeur', () => {
    expect(isPlausibleSecret('changeme')).toBe(false);
    expect(isPlausibleSecret('redacted')).toBe(false);
    expect(isPlausibleSecret('')).toBe(false);
    expect(isPlausibleSecret('aaaaaaaaaaaaaaaa')).toBe(false);
    expect(isPlausibleSecret('Aa1Bb2Cc3Dd4Ee5F')).toBe(true);
  });

  it('distingue un littéral secret d’une expression', () => {
    expect(looksLikeLiteralSecret('aB3xK9mQ2pL7vN4zR8tY1w')).toBe(true);
    expect(looksLikeLiteralSecret('req.headers.authorization')).toBe(false);
    expect(looksLikeLiteralSecret('security_sub')).toBe(false);
    expect(looksLikeLiteralSecret('aaaaaaaaaaaaaaaaaaaa')).toBe(false);
  });

  it('écarte les mots de passe masqués et d’exemple', () => {
    expect(looksLikePassword('***')).toBe(false);
    expect(looksLikePassword('changeme')).toBe(false);
    expect(looksLikePassword('${DB_PASSWORD}')).toBe(false);
    expect(looksLikePassword('s3cr3tP4ssw0rd')).toBe(true);
  });

  it('calcule correctement l’entropie de Shannon', () => {
    expect(shannonEntropy('')).toBe(0);
    expect(shannonEntropy('aaaa')).toBeCloseTo(0, 10);
    expect(shannonEntropy('abcd')).toBeCloseTo(2, 10);
    expect(shannonEntropy('Nq7Xk2Zp9Rt4')).toBeGreaterThan(3);
  });

  it('expose le jeton de caviardage', () => {
    expect(REDACTION_TOKEN).toBe('REDACTED');
  });
});

describe('scan d’arborescence', () => {
  it('trouve un secret dans un fichier et ignore un fichier sain', () => {
    const racine = mkdtempSync(join(tmpdir(), 'codidev-scan-'));
    mkdirSync(join(racine, 'src'), { recursive: true });
    writeFileSync(
      join(racine, 'src', 'config.ts'),
      `export const GITHUB_TOKEN = '${fakeGithubToken('E1f2G3h4I5j6K7l8M9n0O1p2Q3r4S5t6U7v8')}';\n`,
      'utf8',
    );
    writeFileSync(join(racine, 'sain.txt'), 'rien à signaler\n', 'utf8');

    const findings = scanner().scanTree(racine);
    expect(new Set(findings.map((finding) => finding.source))).toEqual(
      new Set([join(racine, 'src', 'config.ts')]),
    );
  });

  it('ignore les binaires', () => {
    const racine = mkdtempSync(join(tmpdir(), 'codidev-bin-'));
    const binaire = join(racine, 'image.png');
    writeFileSync(binaire, Buffer.from(`\x89PNG${fakeGithubToken()}`), 'binary');
    expect(scanner().scanFile(binaire)).toEqual([]);
  });
});
