"""Tests du Context Engine : provenance, confiance, isolation tenant, rendu."""

from __future__ import annotations

import pytest

from codidev.context import (
    ContextBundle,
    ContextEngine,
    ContextItem,
    ContextLayer,
    StaticProvider,
    TrustLevel,
    make_item,
    trust_rank,
)
from codidev.errors import ContextIsolationError


def _item(
    *,
    layer: ContextLayer = ContextLayer.PROJECT,
    trust: TrustLevel = TrustLevel.UNTRUSTED,
    source: str = "depot/README.md",
    content: str = "contenu du projet",
    tenant_id: str | None = "tenant-a",
) -> ContextItem:
    return make_item(layer=layer, trust=trust, source=source, content=content, tenant_id=tenant_id)


def test_element_sans_provenance_refuse() -> None:
    with pytest.raises(ContextIsolationError):
        make_item(
            layer=ContextLayer.PROJECT,
            trust=TrustLevel.TRUSTED,
            source="   ",
            content="contenu",
            tenant_id="tenant-a",
        )


def test_element_vide_refuse() -> None:
    with pytest.raises(ContextIsolationError):
        make_item(
            layer=ContextLayer.PROJECT,
            trust=TrustLevel.TRUSTED,
            source="source",
            content="  ",
            tenant_id="tenant-a",
        )


def test_contexte_sans_tenant_refuse() -> None:
    with pytest.raises(ContextIsolationError):
        ContextEngine().build(tenant_id="")


def test_element_dun_autre_tenant_refuse() -> None:
    bundle = ContextBundle(tenant_id="tenant-a")
    with pytest.raises(ContextIsolationError):
        bundle.add(_item(tenant_id="tenant-b"))
    assert bundle.items == []


def test_element_tenant_scope_sans_tenant_refuse() -> None:
    bundle = ContextBundle(tenant_id="tenant-a")
    with pytest.raises(ContextIsolationError):
        bundle.add(_item(tenant_id=None, layer=ContextLayer.PROJECT))


def test_regle_systeme_sans_tenant_acceptee() -> None:
    bundle = ContextBundle(tenant_id="tenant-a")
    bundle.add(_item(tenant_id=None, layer=ContextLayer.SYSTEM, trust=TrustLevel.TRUSTED))
    assert len(bundle.items) == 1


def test_un_secret_est_caviarde_a_lentree_du_contexte() -> None:
    token = "gh" + "p_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"
    item = _item(content=f"jeton détecté : {token}")
    assert token not in item.content
    assert "REDACTED" in item.content


def test_rendu_expose_couche_confiance_et_provenance() -> None:
    bundle = ContextBundle(tenant_id="tenant-a")
    bundle.add(_item(content="du texte de projet", source="depot/notes.md"))
    bundle.add(
        _item(
            layer=ContextLayer.SYSTEM,
            trust=TrustLevel.TRUSTED,
            source="politique:interdits",
            content="aucun secret dans le dépôt",
            tenant_id=None,
        )
    )
    texte = bundle.render()
    assert "### SYSTEM [TRUSTED] source=politique:interdits" in texte
    assert "### PROJECT [UNTRUSTED] source=depot/notes.md" in texte
    # L'ordre de rendu est celui des couches déclarées : SYSTEM avant PROJECT.
    assert texte.index("### SYSTEM") < texte.index("### PROJECT")


def test_rendu_deterministe() -> None:
    bundle = ContextBundle(tenant_id="tenant-a")
    bundle.add(_item(content="b"))
    bundle.add(_item(content="a", source="autre.md"))
    assert bundle.render() == bundle.render()


def test_le_contenu_non_fiable_est_identifiable() -> None:
    bundle = ContextBundle(tenant_id="tenant-a")
    bundle.add(_item(trust=TrustLevel.UNTRUSTED))
    bundle.add(
        _item(layer=ContextLayer.TOOL_RESULTS, trust=TrustLevel.VERIFIED, source="outil:pytest")
    )
    assert len(bundle.untrusted()) == 1
    assert bundle.untrusted()[0].trust is TrustLevel.UNTRUSTED


def test_confiance_ordonnee_et_non_implicite() -> None:
    assert (
        trust_rank(TrustLevel.UNTRUSTED)
        < trust_rank(TrustLevel.UNVERIFIED)
        < trust_rank(TrustLevel.VERIFIED)
        < trust_rank(TrustLevel.TRUSTED)
    )


def test_provider_statique_systeme_sans_tenant() -> None:
    provider = StaticProvider(
        name="politique",
        layer=ContextLayer.SYSTEM,
        trust=TrustLevel.TRUSTED,
        entries=(("interdits", "ne jamais publier un secret"),),
    )
    bundle = ContextEngine(providers=[provider]).build(tenant_id="tenant-a")
    assert len(bundle.items) == 1
    assert bundle.items[0].tenant_id is None
    assert bundle.items[0].source == "politique:interdits"


def test_provider_statique_tenant_scope_porte_le_tenant() -> None:
    provider = StaticProvider(
        name="tenant",
        layer=ContextLayer.TENANT,
        trust=TrustLevel.TRUSTED,
        entries=(("conventions", "français par défaut"),),
    )
    bundle = ContextEngine(providers=[provider]).build(tenant_id="tenant-a", project_id="p1")
    assert bundle.items[0].tenant_id == "tenant-a"
    assert bundle.items[0].project_id == "p1"


def test_contexte_valide_contre_son_contrat() -> None:
    bundle = ContextEngine().build(tenant_id="tenant-a", project_id="p1")
    bundle.add(_item())
    bundle.validate()


def test_contexte_conforme_au_schema_json() -> None:
    from codidev.contracts import is_valid

    bundle = ContextEngine().build(tenant_id="tenant-a")
    bundle.add(_item())
    assert is_valid("context_bundle", bundle.to_dict())


def test_layer_enum_alignee_sur_le_contrat() -> None:
    from codidev.contracts import schema_enum

    assert schema_enum("context_bundle", "#/properties/items/items/properties/layer") == [
        layer.value for layer in ContextLayer
    ]
    assert schema_enum("context_bundle", "#/properties/items/items/properties/trust") == [
        level.value for level in TrustLevel
    ]
