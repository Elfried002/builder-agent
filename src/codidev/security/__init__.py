"""Sécurité CodiDev : détection de secrets, rapport, gate, outils externes.

La sécurité n'est pas une autorité du modèle : elle lit des faits observés
(`07_SECURITY/05_AGENT_SELF_PROTECTION.md` — « The LLM is not the security authority »).
"""

from __future__ import annotations

from codidev.security.allowlist import (
    ALLOWLIST_FILENAME,
    AllowlistEntry,
    SecurityAllowlist,
    SuppressedFinding,
)
from codidev.security.gate import (
    ACTION_BLOCK,
    ACTION_INFORMATIONAL,
    ACTION_REVIEW,
    ACTION_WARNING,
    GatePolicy,
    GateResult,
    evaluate,
)
from codidev.security.report import Finding, SecurityReport, ToolRun
from codidev.security.secrets import (
    DEFAULT_RULES,
    REDACTION_MARK,
    SecretRule,
    SecretScanner,
    is_plausible_secret,
    looks_like_literal_secret,
    looks_like_password,
    redact,
    redact_structure,
    shannon_entropy,
)
from codidev.security.tools import TOOL_SPECS, resolve_executable, run_tool, run_tools

__all__ = [
    "ACTION_BLOCK",
    "ACTION_INFORMATIONAL",
    "ACTION_REVIEW",
    "ACTION_WARNING",
    "ALLOWLIST_FILENAME",
    "DEFAULT_RULES",
    "REDACTION_MARK",
    "TOOL_SPECS",
    "AllowlistEntry",
    "Finding",
    "GatePolicy",
    "GateResult",
    "SecretRule",
    "SecretScanner",
    "SecurityAllowlist",
    "SecurityReport",
    "SuppressedFinding",
    "ToolRun",
    "evaluate",
    "is_plausible_secret",
    "looks_like_literal_secret",
    "looks_like_password",
    "redact",
    "redact_structure",
    "resolve_executable",
    "run_tool",
    "run_tools",
    "shannon_entropy",
]
