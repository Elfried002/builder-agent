"""Tests de la détection de secrets et du caviardage.

Les valeurs sensibles sont construites par concaténation : ce fichier ne contient lui-même aucun
secret, sinon le scan du dépôt — qui est un test — se retournerait contre lui.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from codidev.security import (
    REDACTION_MARK,
    SecretScanner,
    is_plausible_secret,
    redact,
    redact_structure,
    shannon_entropy,
)


def _scanner() -> SecretScanner:
    return SecretScanner()


def _rules_of(text: str) -> set[str]:
    return {finding.rule for finding in _scanner().scan_text(text, "test")}


def test_jeton_github_detecte() -> None:
    token = "gh" + "p_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"
    findings = _scanner().scan_text(f"token: {token}", "f.txt")
    assert any(finding.rule == "github-token" for finding in findings)
    assert findings[0].line == 1
    assert token not in findings[0].excerpt


def test_cle_privee_detectee() -> None:
    assert "private-key-block" in _rules_of("-----BEGIN " + "RSA PRIVATE KEY-----")


def test_cle_aws_detectee() -> None:
    assert "aws-access-key-id" in _rules_of("AKIA" + "Q7WERT9YU2IOP3AS")


def test_url_de_base_de_donnees_avec_mot_de_passe_detectee() -> None:
    url = "postgres" + "ql://" + "app" + ":" + "s3cr3tP4ssw0rd" + "@db.local/app"
    assert "database-url-with-credentials" in _rules_of(url)


def test_jwt_detecte() -> None:
    jwt = ".".join(["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxIn0", "abcdefghijklmnop"])
    assert "json-web-token" in _rules_of(jwt)


def test_jeton_porteur_detecte() -> None:
    header = "Authorization: " + "Bearer " + "abcdefghijklmnopqrstuvwxyz012345"
    assert "bearer-token" in _rules_of(header)


def test_affectation_a_nom_evocateur_detectee() -> None:
    line = "API_KEY = " + '"aB3xK9mQ2pL7vN4zR8tY1w"'
    assert "assigned-secret-value" in _rules_of(line)


def test_valeur_de_faible_entropie_non_signalee() -> None:
    assert _rules_of("token = " + '"' + "a" * 24 + '"') == set()


def test_valeur_exemple_non_signalee() -> None:
    assert _rules_of("password = " + '"changeme"') == set()


def test_texte_ordinaire_non_signale() -> None:
    texte = (
        "Le plan contient trois étapes et un critère de vérification.\n"
        "tokenization du texte et répartition des rôles.\n"
    )
    assert _rules_of(texte) == set()


def test_fichier_binaire_ignore(tmp_path: Path) -> None:
    binaire = tmp_path / "image.png"
    binaire.write_bytes(b"\x89PNG\r\n\x1a\n" + b"gh" + b"p_" + b"A" * 40)
    assert _scanner().scan_file(binaire) == []


def test_scan_arborescence_trouve_les_secrets(tmp_path: Path) -> None:
    (tmp_path / "config.py").write_text(
        "GITHUB_TOKEN = " + '"gh' + "p_" + "B1c2D3e4F5g6H7i8J9k0L1m2N3o4P5q6R7s8" + '"\n',
        encoding="utf-8",
    )
    (tmp_path / "sain.txt").write_text("rien à signaler\n", encoding="utf-8")
    findings = _scanner().scan_tree(tmp_path)
    sources = {finding.source for finding in findings}
    assert sources == {str(tmp_path / "config.py")}
    assert "github-token" in {finding.rule for finding in findings}


def test_caviardage_retire_le_secret_et_garde_le_contexte() -> None:
    token = "gh" + "p_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"
    redacted = redact(f"token={token} // fin")
    assert token not in redacted
    assert REDACTION_MARK.format(rule="github-token") in redacted
    assert "fin" in redacted


def test_caviardage_ne_touche_pas_les_valeurs_saines() -> None:
    texte = "API_KEY = " + '"changeme"'
    assert redact(texte) == texte


def test_caviardage_idempotent() -> None:
    """Un texte déjà caviardé ne doit plus rien déclencher : sinon tout rapport se re-signale."""
    url = "postgres" + "ql://" + "app" + ":" + "s3cr3tP4ssw0rd" + "@db.local/app"
    une_fois = redact(url)
    assert une_fois != url
    assert redact(une_fois) == une_fois
    assert _scanner().scan_text(une_fois, "rapport") == []


def test_un_caviardage_nest_jamais_detection() -> None:
    marque = REDACTION_MARK.format(rule="database-url-with-credentials")
    ligne = "DATABASE_URL=" + "postgres" + "ql://" + "app" + ":" + marque + "@db.local/app"
    assert _scanner().scan_text(ligne, "rapport") == []
    assert not is_plausible_secret(marque)


def test_caviardage_recursif_dune_structure() -> None:
    token = "gh" + "p_" + "C1d2E3f4G5h6I7j8K9l0M1n2O3p4Q5r6S7t8"
    payload = {"commandes": [f"git push {token}"], "notes": ["ok"]}
    result = redact_structure(payload)
    assert token not in str(result)
    assert result["notes"] == ["ok"]


@pytest.mark.parametrize(
    ("valeur", "attendu"),
    [
        ("changeme", False),
        ("redacted", False),
        ("", False),
        ("aaaaaaaaaaaaaaaa", False),
        ("Aa1Bb2Cc3Dd4Ee5F", True),
    ],
)
def test_plausibilite_dune_valeur(valeur: str, attendu: bool) -> None:
    assert is_plausible_secret(valeur) is attendu


def test_entropie_de_shannon() -> None:
    assert shannon_entropy("") == 0.0
    assert shannon_entropy("aaaa") == pytest.approx(0.0)
    assert shannon_entropy("abcd") == pytest.approx(2.0)
    assert shannon_entropy("Nq7Xk2Zp9Rt4") > 3.0
