"""Sensoren: Wochenplan, Mittagessen heute/morgen, Reste, fällige Reste und der Stand (für die Karte)."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.util import dt as dt_util

from .const import PLACES
from .entity import EinkaufsappEntity


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, add: AddEntitiesCallback) -> None:
    coordinator = entry.runtime_data
    add([
        WeekPlanSensor(coordinator), LunchSensor(coordinator, 0), LunchSensor(coordinator, 1),
        LeftoversSensor(coordinator), DueLeftoversSensor(coordinator), StateSensor(coordinator),
    ])


def plan_days(plan: dict | None) -> list[dict]:
    return [{"tag": d["key"], "datum": d["date"], "gericht": d["recipe"]} for d in (plan or {}).get("days", [])]


def plan_dinners(plan: dict | None) -> list[dict]:
    plan = plan or {}
    return ([{"gericht": d["recipe"], "erledigt": d["done"], "rest": False} for d in plan.get("dinners", [])]
            + [{"gericht": r["name"], "erledigt": r["done"], "rest": True} for r in plan.get("rest_dinners", [])])


def leftover_attrs(item: dict) -> dict[str, Any]:
    return {"id": item["id"], "gericht": item["name"], "portionen": item["portions"],
            "ort": PLACES.get(item["place"], item["place"]), "gekocht_am": item["cooked_on"],
            "haltbar_bis": item["expires_on"], "tage_uebrig": item["days_left"], "eingeplant": item["planned"]}


class WeekPlanSensor(EinkaufsappEntity, SensorEntity):
    _attr_icon = "mdi:calendar-week"

    def __init__(self, coordinator) -> None:
        super().__init__(coordinator, "wochenplan", "Wochenplan")

    @property
    def native_value(self) -> str | None:
        start = (self.coordinator.data or {}).get("week_start")
        return f"KW {date.fromisoformat(start).isocalendar().week}" if start else None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        data = self.coordinator.data or {}
        return {"woche_ab": data.get("week_start"), "tage": plan_days(data.get("plan")),
                "abendessen": plan_dinners(data.get("plan")),
                "naechste_woche": {"tage": plan_days(data.get("next_plan")),
                                   "abendessen": plan_dinners(data.get("next_plan"))}}


class LunchSensor(EinkaufsappEntity, SensorEntity):
    """Mittagessen heute (offset 0) oder morgen (offset 1); morgen kann schon in der nächsten Woche liegen."""

    _attr_icon = "mdi:silverware-fork-knife"

    def __init__(self, coordinator, offset: int) -> None:
        key, name = ("mittagessen_heute", "Mittagessen heute") if offset == 0 else ("mittagessen_morgen",
                                                                                      "Mittagessen morgen")
        super().__init__(coordinator, key, name)
        self._offset = offset

    @property
    def native_value(self) -> str | None:
        data = self.coordinator.data or {}
        target = (dt_util.now().date() + timedelta(days=self._offset)).isoformat()
        for plan in (data.get("plan"), data.get("next_plan")):
            for day in (plan or {}).get("days", []):
                if day["date"] == target:
                    return day["recipe"]
        return None


class LeftoversSensor(EinkaufsappEntity, SensorEntity):
    _attr_icon = "mdi:fridge-outline"
    _attr_native_unit_of_measurement = "Reste"

    def __init__(self, coordinator) -> None:
        super().__init__(coordinator, "reste", "Reste")

    @property
    def native_value(self) -> int | None:
        leftovers = (self.coordinator.data or {}).get("leftovers")
        return len(leftovers["items"]) if leftovers else None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        leftovers = (self.coordinator.data or {}).get("leftovers") or {"items": []}
        return {"reste": [leftover_attrs(item) for item in leftovers["items"]]}


class DueLeftoversSensor(EinkaufsappEntity, SensorEntity):
    """Wie der rote Zähler in der App: abgelaufen, heute oder morgen fällig."""

    _attr_icon = "mdi:clock-alert-outline"
    _attr_native_unit_of_measurement = "Reste"

    def __init__(self, coordinator) -> None:
        super().__init__(coordinator, "reste_faellig", "Reste fällig")

    @property
    def native_value(self) -> int | None:
        leftovers = (self.coordinator.data or {}).get("leftovers")
        return leftovers["due"] if leftovers else None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        leftovers = (self.coordinator.data or {}).get("leftovers") or {"items": []}
        return {"reste": [leftover_attrs(i) for i in leftovers["items"] if i["days_left"] <= 1]}


class StateSensor(EinkaufsappEntity, SensorEntity):
    """Datum und Versionen je Bereich; die Karte lädt neu, sobald sich der Wert ändert. Das Datum gehört dazu,
    damit die Karte auch nach Mitternacht („heute“, neue Woche) neu lädt, ohne dass sich in der App etwas änderte."""

    _attr_icon = "mdi:sync"
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, coordinator) -> None:
        super().__init__(coordinator, "stand", "Stand")

    @property
    def native_value(self) -> str | None:
        versions = (self.coordinator.data or {}).get("versions")
        if not versions:
            return None
        numbers = "-".join(str(versions.get(area, 0)) for area in ("list", "plan", "leftovers", "recipes"))
        return f"{dt_util.now().date().isoformat()} {numbers}"

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        data = self.coordinator.data or {}
        return {"versionen": data.get("versions"), "app": self.coordinator.config_entry.data.get("url")}
