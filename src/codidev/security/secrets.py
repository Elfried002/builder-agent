"""Détection et caviardage de secrets.

Deux usages, une seule source de règles :

1. **Scan** — `SecretScanner` cherche des secrets dans un texte, un fichier ou une arborescence,
   et les remonte comme `Finding` situés.
2. **Caviardage** — `redact()` neutralise les secrets avant qu'ils n'entrent dans une preuve,
   un journal d'audit ou une sortie console (`07_SECURITY/04_SECRETS.md`).

Les valeurs d'exemple manifestement inoffensives (`changeme`, `example`, …) et les chaînes de
faible entropie sont ignorées : un scanner qui crie sur du bruit est un scanner que l'on
désactive, et un gate désactivé ne protège rien.
"""

from __future__ import annotations

import math
import re
from collections.abc import Callable, Iterable, Iterator
from dataclasses import dataclass
from functools import partial
from pathlib import Path

from codidev.security.report import Finding
from codidev.statuses import Severity

REDACTION_MARK: str = "[REDACTED:{rule}]"

#: Répertoires jamais parcourus lors d'un scan d'arborescence.
DEFAULT_SKIP_DIRS: frozenset[str] = frozenset(
    {
        ".git",
        ".hg",
        ".svn",
        ".venv",
        "venv",
        "node_modules",
        "__pycache__",
        ".mypy_cache",
        ".ruff_cache",
        ".pytest_cache",
        "dist",
        "build",
        ".tox",
        ".eggs",
    }
)

#: Extensions binaires ou volumineuses, ignorées (un scan de secrets porte sur du texte).
DEFAULT_SKIP_SUFFIXES: frozenset[str] = frozenset(
    {
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".webp",
        ".ico",
        ".pdf",
        ".zip",
        ".gz",
        ".tgz",
        ".bz2",
        ".xz",
        ".7z",
        ".rar",
        ".whl",
        ".so",
        ".dylib",
        ".dll",
        ".bin",
        ".exe",
        ".pyc",
        ".pyo",
        ".woff",
        ".woff2",
        ".ttf",
        ".eot",
        ".mp3",
        ".mp4",
        ".mov",
        ".webm",
        ".sqlite",
        ".sqlite3",
        ".db",
        ".lock",
    }
)

MAX_SCAN_BYTES: int = 2 * 1024 * 1024

#: Valeurs explicitement inoffensives : jamais signalées.
PLACEHOLDER_VALUES: frozenset[str] = frozenset(
    {
        "changeme",
        "change_me",
        "example",
        "examples",
        "placeholder",
        "redacted",
        "none",
        "null",
        "true",
        "false",
        "your_token_here",
        "your-token-here",
        "xxx",
        "todo",
        "fixme",
        "test",
        "dummy",
        "sample",
        "local",
        "dev",
        "development",
        "test-token",
    }
)

MIN_VALUE_ENTROPY: float = 2.5

#: Jeton présent dans un caviardage. Un texte déjà caviardé n'est jamais un secret : sans cette
#: garde, un rapport contenant `[REDACTED:…]` serait re-détecté à chaque republication.
REDACTION_SENTINEL: str = "REDACTED"

#: Valeurs de mot de passe manifestement factices, masquées ou d'exemple.
PLACEHOLDER_PASSWORDS: frozenset[str] = frozenset(
    {
        "***",
        "...",
        "xxx",
        "xxxx",
        "secret",
        "changeme",
        "change_me",
        "password",
        "passwd",
        "postgres",
        "mysql",
        "mariadb",
        "mongo",
        "mongodb",
        "redis",
        "root",
        "admin",
        "user",
        "username",
        "db",
        "database",
        "app",
        "demo",
        "dev",
        "local",
        "test",
        "example",
    }
)


@dataclass(frozen=True, slots=True)
class SecretRule:
    """Règle de détection : un motif, une sévérité, et éventuellement le groupe à caviarder."""

    name: str
    pattern: re.Pattern[str]
    severity: Severity
    description: str
    value_group: str | None = None
    value_filter: Callable[[str], bool] | None = None


def _rule(
    name: str,
    pattern: str,
    severity: Severity,
    description: str,
    value_group: str | None = None,
    value_filter: Callable[[str], bool] | None = None,
) -> SecretRule:
    return SecretRule(name, re.compile(pattern), severity, description, value_group, value_filter)


def shannon_entropy(value: str) -> float:
    """Entropie de Shannon (bits par caractère) d'une chaîne."""
    if not value:
        return 0.0
    counts: dict[str, int] = {}
    for char in value:
        counts[char] = counts.get(char, 0) + 1
    length = len(value)
    return -sum((count / length) * math.log2(count / length) for count in counts.values())


def contains_redaction_marker(value: str) -> bool:
    """Vrai si la valeur est déjà un caviardage produit par CodiDev."""
    return REDACTION_SENTINEL in value.upper()


def is_plausible_secret(value: str) -> bool:
    """Écarte les valeurs manifestement inoffensives ou trop peu entropiques."""
    stripped = value.strip().strip("\"'")
    if not stripped or stripped.lower() in PLACEHOLDER_VALUES:
        return False
    if contains_redaction_marker(stripped):
        return False
    if len(set(stripped)) <= 2:
        return False
    return shannon_entropy(stripped) >= MIN_VALUE_ENTROPY


def looks_like_literal_secret(value: str) -> bool:
    """Filtre de l'heuristique d'affectation : distingue un littéral secret d'une expression.

    Une valeur affectée à un nom évoquant un secret n'est signalée que si elle *ressemble* à un
    littéral : assez longue, entropique, sans séparateur de chemin ni d'accès d'attribut, et pas
    un simple identifiant en minuscules. Les formats réels (jetons GitHub, clés AWS, JWT, …) sont
    couverts par leurs règles dédiées : cette heuristique ne doit pas crier sur du code légitime.
    """
    candidate = value.strip().strip("\"'")
    if not is_plausible_secret(candidate):
        return False
    if any(char in candidate for char in "._/+"):
        return False
    if candidate.isalpha() and (candidate.islower() or candidate.isupper()):
        return False
    return shannon_entropy(candidate) >= 3.0


def looks_like_password(value: str) -> bool:
    """Filtre des mots de passe d'URL.

    Écarte les valeurs masquées (`***`) et les mots de passe d'exemple ou de développement
    (`postgres`, `changeme`, …) : un scan qui crie sur de la documentation de démonstration finit
    désactivé, et un scan désactivé ne protège rien.
    """
    candidate = value.strip()
    if not candidate or candidate.lower() in PLACEHOLDER_PASSWORDS:
        return False
    if contains_redaction_marker(candidate):
        return False
    if set(candidate) <= set("*."):
        return False
    if candidate.lower() in PLACEHOLDER_VALUES:
        return False
    # Gabarits d'interpolation (`{mot_de_passe}`, `${DB_PASSWORD}`, `<password>`) : ce ne sont pas
    # des valeurs, ce sont des emplacements. Les signaler produirait du bruit permanent.
    if any(char in candidate for char in "{}<>$%"):
        return False
    return len(candidate) >= 4


DEFAULT_RULES: tuple[SecretRule, ...] = (
    _rule(
        "private-key-block",
        r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----",
        Severity.CRITICAL,
        "Bloc de clé privée en clair.",
    ),
    _rule(
        "aws-access-key-id",
        r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b",
        Severity.CRITICAL,
        "Identifiant de clé d'accès AWS.",
    ),
    _rule(
        "aws-secret-access-key",
        r"(?i)\baws_?secret_?access_?key\b\s*[:=]\s*[\"']?(?P<value>[A-Za-z0-9/+=]{40})[\"']?",
        Severity.CRITICAL,
        "Clé d'accès secrète AWS.",
        value_group="value",
    ),
    _rule(
        "github-token",
        r"\bgh[pousr]_[A-Za-z0-9]{36,}\b",
        Severity.CRITICAL,
        "Jeton GitHub classique.",
    ),
    _rule(
        "github-fine-grained-token",
        r"\bgithub_pat_[A-Za-z0-9_]{22,}\b",
        Severity.CRITICAL,
        "Jeton GitHub à permissions fines.",
    ),
    _rule(
        "openai-key",
        r"\bsk-[A-Za-z0-9]{20,}\b",
        Severity.CRITICAL,
        "Clé d'API de type OpenAI.",
    ),
    _rule(
        "anthropic-key",
        r"\bsk-ant-[A-Za-z0-9_\-]{20,}\b",
        Severity.CRITICAL,
        "Clé d'API Anthropic.",
    ),
    _rule(
        "google-api-key",
        r"\bAIza[0-9A-Za-z_\-]{35}\b",
        Severity.CRITICAL,
        "Clé d'API Google.",
    ),
    _rule(
        "slack-token",
        r"\bxox[abprs]-[A-Za-z0-9\-]{10,}\b",
        Severity.CRITICAL,
        "Jeton Slack.",
    ),
    _rule(
        "slack-webhook",
        r"https://hooks\.slack\.com/services/[A-Za-z0-9/]{20,}",
        Severity.HIGH,
        "URL de webhook Slack (secret d'écriture).",
    ),
    _rule(
        "stripe-key",
        r"\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\b",
        Severity.CRITICAL,
        "Clé d'API Stripe.",
    ),
    _rule(
        "supabase-service-key",
        r"\bsbp_[A-Za-z0-9]{20,}\b",
        Severity.CRITICAL,
        "Jeton Supabase.",
    ),
    _rule(
        "database-url-with-credentials",
        r"(?i)\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|amqp)://"
        r"[^:@\s/]+:(?P<value>[^@\s/]{3,})@",
        Severity.CRITICAL,
        "URL de connexion contenant un mot de passe en clair.",
        value_group="value",
        value_filter=looks_like_password,
    ),
    _rule(
        "json-web-token",
        r"\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b",
        Severity.HIGH,
        "JWT en clair.",
    ),
    _rule(
        "bearer-token",
        r"(?i)\bBearer\s+(?P<value>[A-Za-z0-9._~+/=\-]{24,})",
        Severity.HIGH,
        "Jeton porteur en clair.",
        value_group="value",
    ),
    _rule(
        "assigned-secret-value",
        r"(?i)(?P<name>[A-Za-z0-9_.\-]{0,64}"
        r"(?:secret|token|password|passwd|api[_-]?key|apikey|access[_-]?key|private[_-]?key"
        r"|credential)[A-Za-z0-9_.\-]{0,64})"
        r"\s*[:=]\s*[\"']?(?P<value>[A-Za-z0-9_\-]{16,})[\"']?",
        Severity.HIGH,
        "Affectation d'une valeur à un nom évoquant un secret.",
        value_group="value",
        value_filter=looks_like_literal_secret,
    ),
)


class SecretScanner:
    """Scanner de secrets à règles fixes, sans dépendance externe ni accès réseau."""

    def __init__(
        self,
        rules: Iterable[SecretRule] = DEFAULT_RULES,
        *,
        max_line_length: int = 4000,
    ) -> None:
        self.rules: tuple[SecretRule, ...] = tuple(rules)
        self.max_line_length = max_line_length

    def scan_text(self, text: str, source: str) -> list[Finding]:
        """Scanne un texte : constatations situées (ligne, colonne, extrait caviardé)."""
        findings: list[Finding] = []
        for line_number, line in enumerate(text.splitlines(), start=1):
            if not line or len(line) > self.max_line_length:
                continue
            for rule in self.rules:
                for match in rule.pattern.finditer(line):
                    if rule.value_group:
                        candidate = match.groupdict().get(rule.value_group, "")
                        if rule.value_filter is not None and not rule.value_filter(candidate):
                            continue
                    start = match.start(rule.value_group) if rule.value_group else match.start()
                    column = start + 1
                    findings.append(
                        Finding(
                            rule=rule.name,
                            severity=rule.severity,
                            source=source,
                            line=line_number,
                            column=column,
                            message=rule.description,
                            excerpt=_redact_excerpt(line, match, rule),
                        )
                    )
        return findings

    def scan_file(self, path: Path) -> list[Finding]:
        """Scanne un fichier texte ; liste vide pour un binaire ou un fichier illisible."""
        findings: list[Finding] = []
        try:
            if path.stat().st_size > MAX_SCAN_BYTES:
                return findings
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            return findings
        return self.scan_text(text, str(path))

    def scan_tree(
        self,
        root: Path,
        *,
        skip_dirs: frozenset[str] = DEFAULT_SKIP_DIRS,
        skip_suffixes: frozenset[str] = DEFAULT_SKIP_SUFFIXES,
    ) -> list[Finding]:
        """Scanne récursivement une arborescence, en ignorant les répertoires et binaires connus."""
        findings: list[Finding] = []
        for path in iter_files(root, skip_dirs=skip_dirs, skip_suffixes=skip_suffixes):
            findings.extend(self.scan_file(path))
        return findings


def iter_files(
    root: Path,
    *,
    skip_dirs: frozenset[str] = DEFAULT_SKIP_DIRS,
    skip_suffixes: frozenset[str] = DEFAULT_SKIP_SUFFIXES,
) -> Iterator[Path]:
    """Itère les fichiers texte candidats d'une arborescence, de façon déterministe et triée."""
    if root.is_file():
        yield root
        return
    for path in sorted(root.rglob("*")):
        if any(part in skip_dirs for part in path.parts):
            continue
        if not path.is_file():
            continue
        if path.suffix.lower() in skip_suffixes:
            continue
        yield path


def _redact_excerpt(line: str, match: re.Match[str], rule: SecretRule) -> str:
    """Extrait de ligne où seule la valeur secrète est caviardée (jamais le secret en clair)."""
    if rule.value_group:
        start, end = match.span(rule.value_group)
        redacted = f"{line[:start]}{REDACTION_MARK.format(rule=rule.name)}{line[end:]}"
    else:
        redacted = (
            f"{line[: match.start()]}{REDACTION_MARK.format(rule=rule.name)}{line[match.end() :]}"
        )
    return redacted.strip()[:400]


def _redact_match(match: re.Match[str], rule: SecretRule) -> str:
    """Remplace la seule valeur secrète d'une correspondance par le marqueur de caviardage."""
    if rule.value_group:
        value = match.groupdict().get(rule.value_group, "")
        if rule.value_filter is not None and not rule.value_filter(value):
            return match.group(0)
        start, end = match.span(rule.value_group)
        offset = match.start()
        return (
            f"{match.group(0)[: start - offset]}"
            f"{REDACTION_MARK.format(rule=rule.name)}"
            f"{match.group(0)[end - offset :]}"
        )
    return REDACTION_MARK.format(rule=rule.name)


def redact(text: str, rules: Iterable[SecretRule] = DEFAULT_RULES) -> str:
    """Caviarde tous les secrets détectés dans un texte.

    Utilisé avant toute écriture dans une preuve, un journal d'audit ou une sortie console.
    """
    result = text
    for rule in rules:
        result = rule.pattern.sub(partial(_redact_match, rule=rule), result)
    return result


def redact_structure(value: object, rules: Iterable[SecretRule] = DEFAULT_RULES) -> object:
    """Caviarde récursivement toutes les chaînes d'une structure JSON-compatible."""
    if isinstance(value, str):
        return redact(value, rules)
    if isinstance(value, dict):
        return {key: redact_structure(item, rules) for key, item in value.items()}
    if isinstance(value, list):
        return [redact_structure(item, rules) for item in value]
    return value
