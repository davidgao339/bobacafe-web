# -*- coding: utf-8 -*-
"""
Two-Echelon semantic layer — single source of truth for item classification.

Used by:
  - scripts/two_echelon_phase1_classify.py (one-time dim upgrade)
  - scripts/sync_d1_to_databricks_tabular.py (nightly sync; keeps item_class
    and product_id intact across CREATE OR REPLACE TABLE rebuilds)

Pure Python, no SQL / network calls — rules are encoded here exactly once.

Classes (approved 2026-11-10, plans/two-echelon-inventory-model.md):
  finished        WHS produced, transferred to stores; 1:1 with dim_product
  intermediate    WHS produced AND consumed as ingredient (e.g. tapioca pearls)
  whs_only        purchased raw, WHS production only
  store_only      store consumable, never in WHS BOM
  dual_use        store-stocked AND WHS production input
"""

import re

INTERMEDIATE_OVERRIDES = {
    'Тапиока в шариках',      # warehouse-made pearls, store drink component
}
STORE_ONLY_OVERRIDES = {
    'Подложка для корн-дога',       # cardboard base, product_type corndogs is wrong
    'Контейнер для моти с крышкой',  # packaging, product_type mochi is wrong
}
DUAL_USE_NAMES = {
    'Молоко', 'Сахар', 'Сгущенка', 'Порошок банан',
    'Топпинг клубника', 'Кокосовая стружка',
}
# no dim_product row / no recipe / no stock — repair or retire, do not force
DEAD_FLAGS = {
    'Корн-дог Сникерс сладкий',  # no recipe, 0 stock, lone POS sale — no dim_product row
    'Моти клубника',             # no refs at all — upcoming flavor?
}
# explicit product_id pins where dim_product spelling differs (verified 2026-11-10)
NAME_PRODUCT_ID_PINS = {
    'Блинчики вареная сгущенка (2шт)': 117,   # dim: Блинчики с вареной сгущенкой (2шт)
    'Блинчики клубника': 176,                  # dim: Блинчики клубника(2шт)
    'Блинчики крем-сыр (2шт)': 119,            # dim: Блинчики с крем-сыром (2шт)
    'Блинчики нутелла (2шт)': 121,             # dim: Блинчики с нутеллой (2шт)
    'Блинчики орео (2шт)': 122,                # dim: Блинчики с орео (2шт)
    'Корн-дог сыр': 108,                       # dim: Корн-дог с сыром
    'Моти банан-шоколад': 370,                 # dim: Моти Банан в шоколаде
    'Тапиока в шариках': 447,                  # created in identity-plan phase 0
}
FINISHED_PRODUCT_TYPES = {'mochi', 'pancakes', 'corndogs'}

STORE_VISIBLE_CLASSES = ('finished', 'intermediate', 'store_only', 'dual_use')
WHS_VISIBLE_CLASSES = ('whs_only', 'dual_use', 'intermediate', 'finished')
LINK_CLASSES = ('finished', 'intermediate')


def norm(name):
    """Normalize a product/item name for matching (case, ё, whitespace)."""
    return re.sub(r"\s+", " ", str(name or '').lower().replace('ё', 'е')).strip()


def classify_item(name, product_type, whs_only, prod_refs, retail_refs):
    """Return (item_class, is_dead_flag) for one dim_ingredients item."""
    wh = (whs_only or '') if isinstance(whs_only, str) else ('true' if whs_only else '')
    name_s = str(name or '').strip()
    if name_s in DEAD_FLAGS:
        return 'finished', True   # keep SKU class; flagged for repair/retire in reports
    if name_s in INTERMEDIATE_OVERRIDES:
        return 'intermediate', False
    if name_s in DUAL_USE_NAMES:
        return 'dual_use', False
    if name_s in STORE_ONLY_OVERRIDES:
        return 'store_only', False
    if product_type in FINISHED_PRODUCT_TYPES:
        return 'finished', False
    if wh in ('true', '1'):
        return 'whs_only', False
    if prod_refs > 0 and retail_refs == 0:
        return 'whs_only', False
    return 'store_only', False


def build_product_index(db_products):
    """From dim_product rows (dicts with product_id, product_ru, is_active)
    build (active_by_name, any_by_name) name->product_id maps."""
    active_by_name, any_by_name = {}, {}
    for p in db_products:
        pid = int(p["product_id"])
        key = norm(p.get("product_ru"))
        if not key:
            continue
        active = str(p.get("is_active", "")).lower() in ("true", "1") or p.get("is_active") is True
        if active:
            active_by_name.setdefault(key, pid)
        any_by_name.setdefault(key, pid)
    return active_by_name, any_by_name


def link_product(name, active_by_name, any_by_name):
    """Return (product_id, link_source) — pinned wins, then exact active dim
    match, then any dim match, else (None, 'MISSING')."""
    name_s = str(name or '').strip()
    if name_s in NAME_PRODUCT_ID_PINS:
        return NAME_PRODUCT_ID_PINS[name_s], 'pinned'
    pid = active_by_name.get(norm(name_s))
    if pid:
        return pid, 'active-dim'
    pid = any_by_name.get(norm(name_s))
    if pid:
        return pid, 'dim-any'
    return None, 'MISSING'
