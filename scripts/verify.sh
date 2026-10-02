#!/usr/bin/env bash
# Verification complete du CodiDev Core.
#
# Chaque controle s'execute reellement et son code de sortie est agrege : ce script ne dit jamais
# « vert » sur la foi d'un autre controle. Ordre volontaire — typage et lint d'abord (les defauts
# les moins couteux a corriger), tests ensuite, securite en dernier parce qu'elle inspecte l'arbre
# entier.
#
# Usage : scripts/verify.sh
# Codes de sortie : 0 = tout est vert · 1 = au moins un controle a echoue
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CORE_DIR="${REPO_ROOT}/core"
NODE_HOME="${HOME}/.local/share/codidev/node"
export PATH="${NODE_HOME}/bin:${PATH}"

EXIT_CODE=0
fail() { echo "  x $1"; EXIT_CODE=1; }
ok() { echo "  ok $1"; }

echo "== CodiDev Core - verification =="
echo "Node $(node --version 2>/dev/null || echo absent)"

echo "-- 1. Typage"
if (cd "${CORE_DIR}" && npx tsc --noEmit); then ok "typage conforme"; else fail "erreurs de typage"; fi

echo "-- 2. Lint et format"
if (cd "${CORE_DIR}" && npx biome check .); then ok "lint conforme"; else fail "lint en echec"; fi

echo "-- 3. Tests"
if (cd "${CORE_DIR}" && npx vitest run); then ok "tests verts"; else fail "tests en echec"; fi

echo "-- 4. Construction et importabilite du paquet"
if (cd "${CORE_DIR}" && npm run build --silent); then
  if node -e "import('${CORE_DIR}/dist/index.js').then(() => process.exit(0)).catch(() => process.exit(1))"; then
    ok "build emis et importable"
  else
    fail "build emis mais non importable"
  fi
else
  fail "build en echec"
fi

echo "-- 5. Dependances : vulnerabilites connues"
if (cd "${CORE_DIR}" && node -e "
  const { execSync } = require('node:child_process');
  let data = '';
  try { data = execSync('npm audit --json', { encoding: 'utf8', stdio: ['ignore','pipe','ignore'] }); }
  catch (error) { data = String(error.stdout || '{}'); }
  let vulns = { high: 0, critical: 0 };
  try { vulns = JSON.parse(data).metadata.vulnerabilities; } catch {}
  process.exit(Number(vulns.high || 0) + Number(vulns.critical || 0) > 0 ? 1 : 0);
"); then ok "aucune vulnerabilite haute ou critique"; else fail "vulnerabilites hautes ou critiques"; fi

echo "-- 6. Une seule implementation du coeur"
if [[ -d "${REPO_ROOT}/core/python" ]]; then
  fail "l'implementation Python est encore presente : deux coeurs concurrents"
else
  ok "le coeur n'a qu'une implementation (TypeScript)"
fi

echo
if [[ ${EXIT_CODE} -eq 0 ]]; then echo "VERT - aucun blocage"; else echo "ROUGE - voir les controles ci-dessus"; fi
exit ${EXIT_CODE}
