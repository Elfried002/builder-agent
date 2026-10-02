#!/usr/bin/env bash
# Environnement de construction du CodiDev Core (TypeScript / Node.js).
#
# Le coeur n'utilise que son propre environnement Node.js, installe hors des paquets systeme et
# hors du runtime de l'agent de construction : melanger les dependances rendrait la
# reproductibilite impossible et exposerait le coeur a des ruptures qu'il ne controle pas.
#
# Usage : scripts/bootstrap_env.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CORE_DIR="${REPO_ROOT}/core"
NODE_HOME="${HOME}/.local/share/codidev/node"

if [[ ! -x "${NODE_HOME}/bin/node" ]]; then
  echo "Node.js dedie absent : ${NODE_HOME}/bin/node" >&2
  echo "Installer la version LTS officielle dans ce repertoire, en verifiant l'empreinte SHA-256" >&2
  echo "contre la source officielle (voir README.md)." >&2
  exit 1
fi

export PATH="${NODE_HOME}/bin:${PATH}"
echo "Node.js      : $(node --version) ($(command -v node))"
echo "npm          : $(npm --version)"
echo "Version requise : >= 22 (developpe et verifie sur Node 24 LTS)"

cd "${CORE_DIR}"
if [[ -f package-lock.json ]]; then
  # `npm ci` installe exactement le contenu du verrou : un environnement reproductible ne se
  # construit pas sur des versions resolues au moment de l'installation.
  npm ci
else
  npm install
fi

echo
echo "Environnement pret. Verification complete : scripts/verify.sh"
