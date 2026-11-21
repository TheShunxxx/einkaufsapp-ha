"""Gemeinsame Basis: alle Entitäten hängen am Gerät „Einkaufsapp“."""

from __future__ import annotations

from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import CONF_URL, DOMAIN
from .coordinator import EinkaufsappCoordinator


class EinkaufsappEntity(CoordinatorEntity[EinkaufsappCoordinator]):
    _attr_has_entity_name = True

    def __init__(self, coordinator: EinkaufsappCoordinator, key: str, name: str) -> None:
        super().__init__(coordinator)
        entry = coordinator.config_entry
        self._attr_unique_id = f"{entry.entry_id}_{key}"
        self._attr_name = name
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)}, name="Einkaufsapp", manufacturer="Einkaufsapp",
            entry_type=DeviceEntryType.SERVICE, configuration_url=entry.data[CONF_URL],
        )
