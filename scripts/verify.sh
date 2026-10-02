#!/usr/bin/env bash
#
# Vérification complète du dépôt CodiDev : lint, format, SAST, SCA, secrets, tests, gate.
#
# Chaque étape est exécutée réellement et son code de sortie est respecté. Un outil absent est
# signalé comme NOT_EXECUTED par le scan de sécurité et n'est jamais compté comme un succès.
#
# Les rapports sont écrits HORS du dépôt : un rapport contient des extraits de code et ne doit ni
# être versionné, ni être relu comme du code source au scan suivant.
#
# Codes de sortie : 0 = tout est vert, 1 = revue requise, 2 = bloqué.
#
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CODI_VENV_DIR="${CODI_VENV_DIR:-$HOME/.local/share/codidev/venv}"
CODI_ARTIFACTS="${CODI_ARTIFACTS:-$HOME/.local/share/codidev/artifacts}"
CODI="${CODI_VENV_DIR}/bin/codidev"
PYTEST="${CODI_VENV_DIR}/bin/pytest"
RUFF="${CODI_VENV_DIR}/bin/ruff"
EXIT_CODE=0

say() { printf '\n== %s\n' "$*"; }

if [[ ! -x "$CODI" ]]; then
  printf 'ERREUR — environnement absent. Exécuter d abord : scripts/bootstrap_env.sh\n' >&2
  exit 2
fi

mkdir -p "$CODI_ARTIFACTS"

say "lint (ruff check)"
if ! "$RUFF" check "$REPO_ROOT/src" "$REPO_ROOT/tests"; then
  EXIT_CODE=2
fi

say "format (ruff format --check)"
if ! "$RUFF" format --check "$REPO_ROOT/src" "$REPO_ROOT/tests"; then
  EXIT_CODE=2
fi

say "SAST (bandit) + SCA (pip-audit) + secrets + lint agrégés par le gate"
"$CODI" security scan "$REPO_ROOT" \
  --json "$CODI_ARTIFACTS/security-report.json" \
  --policy "${CODI_POLICY:-default}"
GATE_CODE=$?
if [[ $GATE_CODE -gt $EXIT_CODE ]]; then
  EXIT_CODE=$GATE_CODE
fi

say "contrats (auto-contrôle des schémas)"
"$CODI" contracts list

say "tests (pytest)"
if ! "$PYTEST" -q; then
  EXIT_CODE=2
fi

say "résultat"
printf 'rapport : %s/security-report.json\n' "$CODI_ARTIFACTS"
case $EXIT_CODE in
  0) printf 'VERT — aucun blocage, aucune revue requise\n' ;;
  1) printf 'REVUE REQUISE — consulter le rapport\n' ;;
  *) printf 'BLOQUÉ — consulter le rapport\n' ;;
esac
exit $EXIT_CODE
