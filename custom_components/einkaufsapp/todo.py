"""Die Einkaufsliste als HA-Todo-Liste: abhaken, hinzufügen, entfernen, alles direkt in der App."""

from __future__ import annotations

from homeassistant.components.todo import TodoItem, TodoItemStatus, TodoListEntity, TodoListEntityFeature
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .api import EinkaufsappError
from .entity import EinkaufsappEntity


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, add: AddEntitiesCallback) -> None:
    add([ShoppingList(entry.runtime_data)])


def amount(item: dict) -> str:
    quantity, unit = item.get("quantity"), item.get("unit")
    if quantity is None:
        return ""
    text = f"{quantity:g}".replace(".", ",") if isinstance(quantity, float) else str(quantity)
    return f"{text} {unit}" if unit else f"{text}×"


class ShoppingList(EinkaufsappEntity, TodoListEntity):
    _attr_icon = "mdi:cart-outline"
    _attr_supported_features = (TodoListEntityFeature.CREATE_TODO_ITEM | TodoListEntityFeature.UPDATE_TODO_ITEM
                                | TodoListEntityFeature.DELETE_TODO_ITEM)

    def __init__(self, coordinator) -> None:
        super().__init__(coordinator, "einkaufsliste", "Einkaufsliste")

    @property
    def todo_items(self) -> list[TodoItem] | None:
        data = (self.coordinator.data or {}).get("list")
        if data is None:
            return None
        items = []
        for group in data["groups"]:
            store = (group.get("store") or {}).get("name") or "Noch zuordnen"
            for item in group["items"]:
                details = " · ".join(part for part in (amount(item), store, item.get("note")) if part)
                items.append(TodoItem(
                    uid=str(item["id"]), summary=item["name"], description=details or None,
                    status=TodoItemStatus.COMPLETED if item["checked"] else TodoItemStatus.NEEDS_ACTION,
                ))
        return items

    async def _call(self, method: str, path: str, body=None) -> None:
        try:
            await self.coordinator.client.request(method, path, body)
        except EinkaufsappError as err:
            raise HomeAssistantError(str(err)) from err
        await self.coordinator.async_reload_areas({"list"})

    async def async_create_todo_item(self, item: TodoItem) -> None:
        await self._call("POST", "/api/list/items", {"name": item.summary, "source": "homeassistant"})

    async def async_update_todo_item(self, item: TodoItem) -> None:
        # Nur Abhaken und wieder Öffnen; Namen ändert man in der App (der Artikel steckt dahinter).
        await self._call("PATCH", f"/api/list/items/{item.uid}",
                         {"checked": item.status == TodoItemStatus.COMPLETED})

    async def async_delete_todo_items(self, uids: list[str]) -> None:
        for uid in uids:
            try:
                await self.coordinator.client.request("DELETE", f"/api/list/items/{uid}")
            except EinkaufsappError as err:
                raise HomeAssistantError(str(err)) from err
        await self.coordinator.async_reload_areas({"list"})
