"""Interface en ligne de commande de CodiDev (Phase 0 — Foundation).

Sous-commandes :

    codidev version
    codidev contracts list | show <contrat> | validate <contrat> <fichier.json>
    codidev security secrets <chemin> [--json <fichier>]
    codidev security scan <chemin> [--tools ruff,bandit,pip-audit] [--policy default|strict]
                                   [--json <fichier>] [--secrets-only]
    codidev journal verify <fichier.jsonl> [--contract evidence|audit_record]

Codes de sortie : 0 = PASS, 1 = REVIEW, 2 = BLOCK ou erreur d'usage.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from codidev import __version__
from codidev.audit import AuditLedger
from codidev.contracts import contract_path, iter_errors, list_contracts, load_schema
from codidev.errors import CodiDevError
from codidev.evidence import EvidenceStore
from codidev.journal import ChainedJournal
from codidev.security import (
    GatePolicy,
    SecretScanner,
    SecurityAllowlist,
    SecurityReport,
    evaluate,
    run_tools,
)

DEFAULT_TOOLS: tuple[str, ...] = ("ruff", "bandit", "pip-audit")

JOURNAL_CONTRACTS: dict[str, type[ChainedJournal]] = {
    "evidence": EvidenceStore,
    "audit_record": AuditLedger,
}


def _emit_json(payload: Any, destination: str | None) -> None:
    text = json.dumps(payload, indent=2, ensure_ascii=False, sort_keys=False)
    if destination:
        path = Path(destination)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text + "\n", encoding="utf-8")
        print(f"Rapport JSON écrit : {path}")
    else:
        print(text)


def _cmd_version(_args: argparse.Namespace) -> int:
    print(f"codidev {__version__}")
    return 0


def _cmd_contracts_list(args: argparse.Namespace) -> int:
    names = list_contracts()
    if args.json:
        _emit_json({"contracts": list(names)}, None)
        return 0
    print(f"{len(names)} contrats disponibles :")
    for name in names:
        schema = load_schema(name)
        print(f"  - {name:<16} {schema.get('title', ''):<16} {contract_path(name).name}")
    return 0


def _cmd_contracts_show(args: argparse.Namespace) -> int:
    _emit_json(load_schema(args.contract), None)
    return 0


def _cmd_contracts_validate(args: argparse.Namespace) -> int:
    path = Path(args.file)
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"BLOQUÉ — fichier illisible : {exc}", file=sys.stderr)
        return 2
    violations = iter_errors(args.contract, document)
    if violations:
        print(f"BLOQUÉ — {path} ne satisfait pas le contrat {args.contract!r} :", file=sys.stderr)
        for violation in violations:
            print(f"  - {violation}", file=sys.stderr)
        return 2
    print(f"OK — {path} satisfait le contrat {args.contract!r}")
    return 0


def _scan_secrets(target: Path) -> SecurityReport:
    report = SecurityReport(target=str(target))
    scanner = SecretScanner()
    if target.is_file():
        report.extend(scanner.scan_file(target))
    else:
        report.extend(scanner.scan_tree(target))
    return report


def _apply_allowlist(report: SecurityReport, target: Path, *, enabled: bool) -> None:
    """Retire du verdict les constatations couvertes par une exception revue, sans les masquer."""
    if not enabled:
        return
    allowlist = SecurityAllowlist.load_for(target)
    root = target if target.is_dir() else target.parent
    active, suppressed = allowlist.partition(report.findings, root=root)
    report.findings = active
    report.add_suppressed(suppressed)


def _cmd_security_secrets(args: argparse.Namespace) -> int:
    target = Path(args.path).resolve()
    report = _scan_secrets(target)
    _apply_allowlist(report, target, enabled=not args.no_allowlist)
    if args.json:
        _emit_json(report.to_dict(), None)
        return 0
    _print_findings(report, title=f"scan de secrets — {target}")
    return 2 if report.findings else 0


def _cmd_security_scan(args: argparse.Namespace) -> int:
    target = Path(args.path).resolve()
    report = _scan_secrets(target)

    if not args.secrets_only:
        tools = tuple(tool.strip() for tool in args.tools.split(",") if tool.strip())
        findings, runs = run_tools(tools, target, workdir=target if target.is_dir() else None)
        report.extend(findings)
        for run in runs:
            report.add_tool_run(run)

    _apply_allowlist(report, target, enabled=not args.no_allowlist)
    gate = evaluate(report, GatePolicy.by_name(args.policy))
    if args.json:
        _emit_json({"report": report.to_dict(), "gate": gate.to_dict()}, args.json)
    else:
        _print_findings(report, title=f"scan de sécurité — {target}")
        print()
        print(f"Gate ({gate.policy_id}) : {gate.outcome.value}  [code de sortie {gate.exit_code}]")
        for reason in gate.reasons:
            print(f"  - {reason}")
        for run in report.tool_runs:
            state = run.state.value
            print(f"  · outil {run.tool:<10} {state:<13} {run.detail}")
    return gate.exit_code


def _cmd_journal_verify(args: argparse.Namespace) -> int:
    factory = JOURNAL_CONTRACTS[args.contract]
    journal = factory(Path(args.file))
    report = journal.verify()
    if args.json:
        _emit_json(report.to_dict(), None)
    else:
        state = "OK" if report.ok else "ALTÉRÉ"
        print(f"{state} — {report.path} ({report.contract}, {report.count} entrées)")
        for issue in report.issues:
            print(f"  - [{issue.code}] entrée {issue.index} : {issue.detail}")
    return 0 if report.ok else 2


def _print_findings(report: SecurityReport, *, title: str) -> None:
    counts = report.counts_by_severity()
    print(f"{title}")
    print(
        "  constatations : "
        + ", ".join(f"{severity}={count}" for severity, count in counts.items())
    )
    if report.suppressed:
        print(f"  supprimées par exception revue : {len(report.suppressed)}")
        for item in report.suppressed:
            print(f"  ~ [{item.entry.rule}] {item.finding.source}:{item.finding.line}")
            print(f"      justification : {item.entry.justification}")
    if not report.findings:
        print("  aucune constatation")
        return
    for finding in report.findings:
        where = finding.source if finding.line is None else f"{finding.source}:{finding.line}"
        print(f"  - [{finding.severity.value:<8}] {finding.rule} — {where}")
        print(f"      {finding.message}")
        if finding.excerpt:
            print(f"      {finding.excerpt}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="codidev", description="CodiDev — cœur agentique")
    parser.add_argument("--version", action="version", version=f"codidev {__version__}")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("version", help="affiche la version").set_defaults(func=_cmd_version)

    contracts = subparsers.add_parser("contracts", help="contrats JSON Schema")
    contracts_sub = contracts.add_subparsers(dest="contracts_command", required=True)
    contracts_list = contracts_sub.add_parser("list", help="liste les contrats")
    contracts_list.add_argument("--json", action="store_true", help="sortie JSON")
    contracts_list.set_defaults(func=_cmd_contracts_list)
    contracts_show = contracts_sub.add_parser("show", help="affiche un schéma")
    contracts_show.add_argument("contract")
    contracts_show.set_defaults(func=_cmd_contracts_show)
    contracts_validate = contracts_sub.add_parser("validate", help="valide un document")
    contracts_validate.add_argument("contract")
    contracts_validate.add_argument("file")
    contracts_validate.set_defaults(func=_cmd_contracts_validate)

    security = subparsers.add_parser("security", help="contrôles de sécurité")
    security_sub = security.add_subparsers(dest="security_command", required=True)
    secrets = security_sub.add_parser("secrets", help="scan de secrets uniquement")
    secrets.add_argument("path")
    secrets.add_argument("--json", action="store_true", help="sortie JSON")
    secrets.add_argument(
        "--no-allowlist",
        action="store_true",
        help="ignore les exceptions revues et affiche toutes les constatations",
    )
    secrets.set_defaults(func=_cmd_security_secrets)
    scan = security_sub.add_parser("scan", help="scan complet et verdict du gate")
    scan.add_argument("path")
    scan.add_argument("--tools", default=",".join(DEFAULT_TOOLS))
    scan.add_argument("--policy", default="default", choices=["default", "strict"])
    scan.add_argument("--json", default=None, help="écrit le rapport dans ce fichier")
    scan.add_argument("--secrets-only", action="store_true", help="n'exécute aucun outil externe")
    scan.add_argument(
        "--no-allowlist",
        action="store_true",
        help="ignore les exceptions revues et évalue toutes les constatations",
    )
    scan.set_defaults(func=_cmd_security_scan)

    journal = subparsers.add_parser("journal", help="journaux chaînés (preuves, audit)")
    journal_sub = journal.add_subparsers(dest="journal_command", required=True)
    verify = journal_sub.add_parser("verify", help="vérifie l'intégrité d'un journal")
    verify.add_argument("file")
    verify.add_argument("--contract", default="evidence", choices=sorted(JOURNAL_CONTRACTS))
    verify.add_argument("--json", action="store_true", help="sortie JSON")
    verify.set_defaults(func=_cmd_journal_verify)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.func(args))
    except CodiDevError as error:
        print(f"BLOQUÉ — {error.message}", file=sys.stderr)
        if detail := error.context.get("violations"):
            for violation in detail:  # type: ignore[union-attr]
                print(f"  - {violation}", file=sys.stderr)
        return 2


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
