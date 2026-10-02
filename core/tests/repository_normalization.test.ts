/**
 * Tests de non-régression du dépôt : la description du Core reste unique et à jour.
 *
 * Ces contrôles ne portent pas sur le comportement du Core mais sur la **documentation** qui le
 * décrit. Ils échouent si une ancienne description du Core — un « cœur Python », ou un « agent
 * autonome hébergé par un runtime externe » comme Hermes — réapparaît dans les documents qui font
 * autorité. Sans ce garde-fou, une régression documentaire passerait inaperçue : le code resterait
 * correct alors que la description du produit redeviendrait fausse.
 *
 * Le test lit le dépôt directement, sans dépendre de `scripts/verify.sh` : un clone de la branche
 * dépourvu des scripts échoue quand même si l'ancienne description revient.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const CORE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = dirname(CORE_ROOT);

/** Lit un fichier du dépôt par son chemin relatif à la racine. */
function readRepoFile(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), 'utf8');
}

/**
 * Motifs interdits dans les documents qui font autorité.
 *
 * Chacun vise une **ancienne** description du Core, de façon assez précise pour ne pas crier sur un
 * texte légitime. Des motifs larges comme « Python » seul seraient inutilisables : le dépôt cite
 * légitimement le Python historique pour dire qu'il a été retiré, et un contrôle qui se déclenche
 * sur du texte correct finit désactivé.
 *
 * - `| Runtime | Hermes |` : l'identité tabulée de l'ancienne définition d'agent, qui présentait
 *   Hermes comme le runtime du produit.
 * - « le cœur est du Python » : la phrase de `docs/CORE_PLATFORM_BOUNDARY.md` d'avant migration.
 * - « cœur agentique Python » : variante désignant le Python comme le cœur officiel.
 * - « agent autonome hébergé par Hermes » / « hébergé par Hermes » : l'ancienne description d'un
 *   agent piloté par un runtime externe.
 */
const MOTIFS_INTERDITS: ReadonlyArray<{ motif: RegExp; description: string }> = [
  { motif: /\|\s*runtime\s*\|\s*hermes/i, description: 'identité tabulée « Runtime | Hermes »' },
  { motif: /le c[œo]ur est (?:du|en) python/i, description: '« le cœur est du Python »' },
  { motif: /c[œo]ur agentique (?:en )?python/i, description: '« cœur agentique Python »' },
  {
    motif: /agent autonome h[ée]berg[ée] par hermes/i,
    description: '« agent autonome hébergé par Hermes »',
  },
  {
    motif: /h[ée]berg[ée] par hermes/i,
    description: '« hébergé par Hermes » — runtime externe',
  },
];

/** Vérifie qu'aucun motif interdit n'apparaît dans le contenu donné. */
function offenses(contenu: string): string[] {
  return MOTIFS_INTERDITS.filter(({ motif }) => motif.test(contenu)).map(
    ({ description }) => description,
  );
}

describe('normalisation du dépôt — description du Core', () => {
  it('le README racine ne présente aucune ancienne description du Core', () => {
    expect(offenses(readRepoFile('README.md'))).toEqual([]);
  });

  it('le README racine affirme que le Core est en TypeScript', () => {
    // Le mot est exigé, pas la phrase exacte : la formulation peut évoluer, la langue non.
    expect(readRepoFile('README.md')).toContain('TypeScript');
  });

  it('docs/LOVABLE_INTEGRATION.md affirme le TypeScript et aucune ancienne description', () => {
    const contenu = readRepoFile('docs/LOVABLE_INTEGRATION.md');
    expect(contenu).toContain('TypeScript');
    expect(offenses(contenu)).toEqual([]);
  });

  it('legacy/ porte un README qui marque l’archive', () => {
    const chemin = join(REPO_ROOT, 'legacy', 'README.md');
    expect(existsSync(chemin)).toBe(true);
    const contenu = readFileSync(chemin, 'utf8');
    expect(contenu.toLowerCase()).toContain('archive');
    expect(contenu).toContain('Core');
  });

  it('core/python n’existe pas — une seule implémentation du Core', () => {
    // Doublon volontaire du contrôle de `scripts/verify.sh`, pour que l'invariant tienne même si
    // les scripts ne sont pas présents dans le clone.
    expect(existsSync(join(CORE_ROOT, 'python'))).toBe(false);
  });
});
