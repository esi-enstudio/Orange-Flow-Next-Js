from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ga_section_config import GaSectionConfig
from app.models.ga_filter import RetailerFilter, FilterTag


class GaSectionExclusionConfig:
    """Loads and provides exclusion configuration for GA Live sections.
    
    Used by both GaLiveQueryBuilder and Excel export to consistently
    apply product-code and retailer-tag exclusions per section.
    """

    def __init__(self, db: AsyncSession, house_id: int):
        self.db = db
        self.house_id = house_id
        self._configs: dict[str, dict] = {}
        self._excluded_retailers: dict[str, set[int]] = {}

    async def load(self):
        result = await self.db.execute(
            select(GaSectionConfig).where(GaSectionConfig.house_id == self.house_id)
        )
        for cfg in result.scalars().all():
            self._configs[cfg.section_key] = {
                "exclude_product_codes": cfg.exclude_product_codes or [],
                "exclude_retailer_tags": cfg.exclude_retailer_tags or [],
                "selected_employee_ids": cfg.selected_employee_ids or [],
            }

    async def load_for_section(self, section_key: str):
        result = await self.db.execute(
            select(GaSectionConfig).where(
                GaSectionConfig.house_id == self.house_id,
                GaSectionConfig.section_key == section_key,
            )
        )
        cfg = result.scalar_one_or_none()
        if cfg:
            self._configs[section_key] = {
                "exclude_product_codes": cfg.exclude_product_codes or [],
                "exclude_retailer_tags": cfg.exclude_retailer_tags or [],
                "selected_employee_ids": cfg.selected_employee_ids or [],
            }

    def get_excluded_product_codes(self, section_key: str) -> list[str]:
        cfg = self._configs.get(section_key)
        return cfg["exclude_product_codes"] if cfg else []

    def get_excluded_retailer_tags(self, section_key: str) -> list[str]:
        cfg = self._configs.get(section_key)
        return cfg["exclude_retailer_tags"] if cfg else []

    def get_selected_employee_ids(self, section_key: str) -> list[int]:
        cfg = self._configs.get(section_key)
        return cfg["selected_employee_ids"] if cfg else []

    async def get_excluded_retailer_ids(self, section_key: str) -> set[int]:
        tag_names = self.get_excluded_retailer_tags(section_key)
        all_excluded: set[int] = set()
        for tag_name in tag_names:
            ids = await self._load_excluded_retailers_by_tag(tag_name)
            all_excluded.update(ids)
        return all_excluded

    async def _load_excluded_retailers_by_tag(self, tag_name: str) -> set[int]:
        if tag_name not in self._excluded_retailers:
            result = await self.db.execute(
                select(RetailerFilter.retailer_id)
                .join(FilterTag, RetailerFilter.tag_id == FilterTag.id)
                .where(
                    FilterTag.name == tag_name,
                    RetailerFilter.house_id == self.house_id,
                )
            )
            self._excluded_retailers[tag_name] = {row[0] for row in result.all()}
        return self._excluded_retailers[tag_name]
