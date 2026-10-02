#!/usr/bin/env bash
#
# Crée ou rafraîchit l'environnement Python isolé de CodiDev.
#
# Contraintes respectées :
#   - aucune dépendance système, aucun `sudo` ;
#   - l'environnement vit HORS du dépôt et HORS de tout environnement tiers ;
#   - les versions sont celles épinglées dans pyproject.toml et verrouillées dans uv.lock.
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CODI_UV_BIN="${CODI_UV_BIN:-$HOME/.local/bin/uv}"
CODI_VENV_DIR="${CODI_VENV_DIR:-$HOME/.local/share/codidev/venv}"
CODI_PYTHON_VERSION="${CODI_PYTHON_VERSION:-3.12}"

say() { printf '%s\n' "$*"; }

if [[ ! -x "$CODI_UV_BIN" ]]; then
  say "ERREUR — 'uv' est introuvable à l'emplacement attendu : $CODI_UV_BIN"
  say "Installation attendue (aucun sudo) :"
  say "  curl -LsSf https://astral.sh/uv/install.sh | UV_INSTALL_DIR=\"\$HOME/.local/bin\" UV_NO_MODIFY_PATH=1 sh"
  exit 2
fi

say "uv        : $("$CODI_UV_BIN" --version)"
say "dépôt     : $REPO_ROOT"
say "environnement : $CODI_VENV_DIR"

say "→ installation de CPython ${CODI_PYTHON_VERSION} (géré par uv, hors environnement tiers)"
"$CODI_UV_BIN" python install "$CODI_PYTHON_VERSION"

if [[ -x "$CODI_VENV_DIR/bin/python" ]]; then
  say "→ environnement existant conservé"
else
  say "→ création de l'environnement"
  mkdir -p "$(dirname "$CODI_VENV_DIR")"
  "$CODI_UV_BIN" venv --python "$CODI_PYTHON_VERSION" "$CODI_VENV_DIR"
fi

say "→ synchronisation depuis uv.lock (dépendances épinglées)"
(
  cd "$REPO_ROOT"
  UV_PROJECT_ENVIRONMENT="$CODI_VENV_DIR" "$CODI_UV_BIN" sync --locked
)

say "→ versions installées"
UV_PROJECT_ENVIRONMENT="$CODI_VENV_DIR" "$CODI_UV_BIN" tree --depth 1 2>/dev/null || true

say "OK — environnement prêt : $CODI_VENV_DIR"
say "Utiliser : $CODI_VENV_DIR/bin/codidev --help"
