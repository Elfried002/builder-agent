"""Adaptateurs vers les outils de sécurité externes (SAST, SCA, lint).

Chaque exécution produit un `ToolRun` qui distingue honnêtement :

* `EXECUTED` — l'outil a réellement tourné et sa sortie a été lue ;
* `NOT_EXECUTED` — l'outil est absent de l'environnement (jamais compté comme un succès) ;
* `FAILED` — l'outil a échoué ou produit une sortie illisible.

Aucun adaptateur n'invente de constatation : une sortie non analysable devient un échec d'outil,
pas une liste vide silencieuse.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path

from codidev.security.report import Finding, ToolRun
from codidev.statuses import Severity, ToolRunState

DEFAULT_TIMEOUT_SECONDS: int = 600

#: Correspondance préfixe de règle Ruff -> sévérité. Les règles de sécurité (`S…`) sont hautes.
RUFF_SEVERITY_BY_PREFIX: dict[str, Severity] = {
    "S": Severity.HIGH,
    "F": Severity.MEDIUM,
    "B": Severity.MEDIUM,
    "E": Severity.LOW,
    "W": Severity.LOW,
    "C4": Severity.INFO,
    "I": Severity.INFO,
    "UP": Severity.INFO,
    "RUF": Severity.INFO,
    "SIM": Severity.INFO,
}


def _severity_from_ruff_code(code: str) -> Severity:
    for prefix in sorted(RUFF_SEVERITY_BY_PREFIX, key=len, reverse=True):
        if code.startswith(prefix):
            return RUFF_SEVERITY_BY_PREFIX[prefix]
    return Severity.INFO


def _severity_from_name(name: str) -> Severity:
    try:
        return Severity(name.strip().upper())
    except ValueError:
        return Severity.MEDIUM


def resolve_executable(name: str) -> str | None:
    """Résout un exécutable : d'abord l'environnement Python courant, puis le `PATH`."""
    candidate = Path(sys.executable).parent / name
    if candidate.is_file():
        return str(candidate)
    return shutil.which(name)


def parse_ruff(payload: str, target: Path) -> list[Finding]:
    """Analyse la sortie JSON de `ruff check`."""
    data = json.loads(payload)
    findings: list[Finding] = []
    for item in data:
        code = str(item.get("code") or "")
        location = item.get("location") or {}
        findings.append(
            Finding(
                rule=f"ruff:{code}" if code else "ruff",
                severity=_severity_from_ruff_code(code),
                source=str(item.get("filename") or target),
                line=location.get("row"),
                column=location.get("column"),
                message=str(item.get("message") or ""),
            )
        )
    return findings


def parse_bandit(payload: str) -> list[Finding]:
    """Analyse la sortie JSON de `bandit`."""
    data = json.loads(payload)
    findings: list[Finding] = []
    for item in data.get("results", []):
        findings.append(
            Finding(
                rule=f"bandit:{item.get('test_id') or 'unknown'}",
                severity=_severity_from_name(str(item.get("issue_severity") or "MEDIUM")),
                source=str(item.get("filename") or ""),
                line=item.get("line_number"),
                message=(f"{item.get('test_name') or ''} — {item.get('issue_text') or ''}").strip(
                    " —"
                ),
            )
        )
    return findings


def parse_pip_audit(payload: str) -> list[Finding]:
    """Analyse la sortie JSON de `pip-audit`.

    `pip-audit` ne fournit pas de niveau de sévérité : toute vulnérabilité connue est remontée
    en `HIGH`, ce qui est explicite dans le message plutôt que deviné.
    """
    data = json.loads(payload)
    dependencies = data.get("dependencies", []) if isinstance(data, dict) else data
    findings: list[Finding] = []
    for dependency in dependencies or []:
        name = dependency.get("name", "?")
        version = dependency.get("version", "?")
        for vulnerability in dependency.get("vulns", []) or []:
            identifier = vulnerability.get("id") or "UNKNOWN"
            fixes = vulnerability.get("fix_versions") or []
            remediation = (
                f"correctif disponible : {', '.join(fixes)}" if fixes else "aucun correctif publié"
            )
            findings.append(
                Finding(
                    rule=f"pip-audit:{identifier}",
                    severity=Severity.HIGH,
                    source=f"{name}=={version}",
                    message=(
                        f"vulnérabilité connue {identifier} dans {name}=={version} ({remediation})"
                    ),
                )
            )
    return findings


@dataclass(frozen=True, slots=True)
class ToolSpec:
    """Spécification d'un outil externe : nom, construction de commande, analyseur."""

    name: str
    build_argv: Callable[[str, Path], list[str]]
    parse: Callable[[str, Path], list[Finding]]
    expected_exit_codes: frozenset[int]


TOOL_SPECS: dict[str, ToolSpec] = {
    "ruff": ToolSpec(
        name="ruff",
        build_argv=lambda exe, target: [exe, "check", "--output-format", "json", str(target)],
        parse=parse_ruff,
        expected_exit_codes=frozenset({0, 1}),
    ),
    "bandit": ToolSpec(
        name="bandit",
        build_argv=lambda exe, target: [exe, "-r", str(target), "-f", "json", "-q"],
        parse=lambda payload, _target: parse_bandit(payload),
        expected_exit_codes=frozenset({0, 1}),
    ),
    "pip-audit": ToolSpec(
        name="pip-audit",
        build_argv=lambda exe, _target: [exe, "-f", "json", "--progress-spinner", "off"],
        parse=lambda payload, _target: parse_pip_audit(payload),
        expected_exit_codes=frozenset({0, 1}),
    ),
}


def run_tool(
    name: str,
    target: Path,
    *,
    workdir: Path | None = None,
    timeout: int = DEFAULT_TIMEOUT_SECONDS,
) -> tuple[list[Finding], ToolRun]:
    """Exécute un outil de sécurité et renvoie ses constatations et la trace de son exécution."""
    if name not in TOOL_SPECS:
        raise KeyError(f"outil non pris en charge : {name!r} (connus : {sorted(TOOL_SPECS)})")
    spec = TOOL_SPECS[name]
    executable = resolve_executable(name)
    if executable is None:
        return [], ToolRun(
            tool=name,
            state=ToolRunState.NOT_EXECUTED,
            detail="outil absent de l'environnement : contrôle non effectué",
        )

    argv = spec.build_argv(executable, target)
    try:
        completed = subprocess.run(  # noqa: S603 — argv explicite, sans shell
            argv,
            cwd=str(workdir or target.parent),
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return [], ToolRun(
            tool=name,
            state=ToolRunState.FAILED,
            detail=f"délai dépassé après {timeout}s",
            command=tuple(argv),
        )
    except OSError as exc:
        return [], ToolRun(
            tool=name,
            state=ToolRunState.FAILED,
            detail=f"exécution impossible : {exc}",
            command=tuple(argv),
        )

    if completed.returncode not in spec.expected_exit_codes:
        detail = (completed.stderr or completed.stdout or "").strip()[:500]
        return [], ToolRun(
            tool=name,
            state=ToolRunState.FAILED,
            detail=f"code de sortie {completed.returncode} : {detail}",
            exit_code=completed.returncode,
            command=tuple(argv),
        )

    try:
        findings = spec.parse(completed.stdout, target)
    except (json.JSONDecodeError, AttributeError, TypeError) as exc:
        return [], ToolRun(
            tool=name,
            state=ToolRunState.FAILED,
            detail=f"sortie illisible : {exc}",
            exit_code=completed.returncode,
            command=tuple(argv),
        )

    return findings, ToolRun(
        tool=name,
        state=ToolRunState.EXECUTED,
        detail=f"{len(findings)} constatation(s)",
        exit_code=completed.returncode,
        command=tuple(argv),
    )


def run_tools(
    names: Sequence[str],
    target: Path,
    *,
    workdir: Path | None = None,
    timeout: int = DEFAULT_TIMEOUT_SECONDS,
) -> tuple[list[Finding], list[ToolRun]]:
    """Exécute plusieurs outils à la suite et agrège constatations et traces."""
    findings: list[Finding] = []
    runs: list[ToolRun] = []
    for name in names:
        tool_findings, run = run_tool(name, target, workdir=workdir, timeout=timeout)
        findings.extend(tool_findings)
        runs.append(run)
    return findings, runs
