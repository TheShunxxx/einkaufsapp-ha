"""Hält den Stand der Einkaufsapp in HA aktuell.

Die App ist die einzige Datenquelle. Der Ereignis-Strom /api/events meldet bei jeder Änderung die Versionen je
Bereich; neu geladen wird nur, was sich geändert hat. Zusätzlich alle 30 Minuten und kurz nach Mitternacht
(neuer Tag: „heute“, Ablauf der Reste, neue Woche) ein vollständiger Abgleich.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import date, timedelta
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import ConfigEntryAuthFailed
from homeassistant.helpers.event import async_track_time_change
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.util import dt as dt_util

from .api import EinkaufsappAuthError, EinkaufsappClient, EinkaufsappError
from .const import AREAS, DOMAIN, STREAM_RETRY_MAX, STREAM_RETRY_MIN, UPDATE_INTERVAL

_LOGGER = logging.getLogger(__name__)

# Bereich in der App → Teile des Stands, die danach neu geladen werden.
# Plan und Reste hängen aneinander (Rest-Abendessen, „eingeplant“), Rezeptnamen stehen im Plan.
RELOAD = {
    "list": {"list"},
    "plan": {"plan", "leftovers"},
    "leftovers": {"leftovers", "plan"},
    "recipes": {"recipes", "plan"},
}


def monday(day: date) -> date:
    return day - timedelta(days=day.weekday())


class EinkaufsappCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    def __init__(self, hass: HomeAssistant, entry: ConfigEntry, client: EinkaufsappClient) -> None:
        super().__init__(hass, _LOGGER, name=DOMAIN, update_interval=UPDATE_INTERVAL, config_entry=entry)
        self.client = client
        self._stream_task: asyncio.Task | None = None
        self._unsub_midnight = None

    # ---------- Laden ----------

    async def _fetch(self, parts: set[str], data: dict[str, Any]) -> dict[str, Any]:
        data = dict(data)
        if "plan" in parts:
            start = monday(dt_util.now().date())
            data["week_start"] = start.isoformat()
            data["plan"], data["next_plan"] = await asyncio.gather(
                self.client.get("/api/week-plan", week_start=start.isoformat()),
                self.client.get("/api/week-plan", week_start=(start + timedelta(weeks=1)).isoformat()),
            )
        if "leftovers" in parts:
            data["leftovers"] = await self.client.get("/api/leftovers")
        if "recipes" in parts:
            data["recipes"] = await self.client.get("/api/recipes")
        if "list" in parts:
            data["list"] = await self.client.get("/api/list")
        return data

    async def _async_update_data(self) -> dict[str, Any]:
        try:
            data = await self._fetch({"plan", "leftovers", "recipes", "list"}, self.data or {})
            data["versions"] = await self.client.versions()
            return data
        except EinkaufsappAuthError as err:
            raise ConfigEntryAuthFailed(str(err)) from err
        except EinkaufsappError as err:
            raise UpdateFailed(str(err)) from err

    async def async_reload_areas(self, areas: set[str], versions: dict[str, int] | None = None) -> None:
        """Lädt die Teile nach, die zu den geänderten Bereichen gehören, und meldet den neuen Stand."""
        parts = set().union(*(RELOAD[a] for a in areas if a in RELOAD)) if areas else set()
        if not parts or self.data is None:
            return
        try:
            data = await self._fetch(parts, self.data)
            data["versions"] = versions or await self.client.versions()
        except EinkaufsappAuthError:
            self.config_entry.async_start_reauth(self.hass)
            return
        except EinkaufsappError as err:
            _LOGGER.warning("Einkaufsapp: Nachladen fehlgeschlagen: %s", err)
            return
        self.async_set_updated_data(data)

    # ---------- Ereignis-Strom ----------

    @callback
    def async_start(self) -> None:
        entry = self.config_entry
        self._stream_task = entry.async_create_background_task(self.hass, self._listen(), f"{DOMAIN}_events")
        self._unsub_midnight = async_track_time_change(self.hass, self._midnight, hour=0, minute=0, second=30)

    async def async_stop(self) -> None:
        if self._unsub_midnight:
            self._unsub_midnight()
            self._unsub_midnight = None
        if self._stream_task:
            self._stream_task.cancel()
            self._stream_task = None

    async def _midnight(self, _now) -> None:
        await self.async_request_refresh()

    async def _listen(self) -> None:
        delay = STREAM_RETRY_MIN
        while True:
            try:
                async for versions in self.client.events():
                    delay = STREAM_RETRY_MIN
                    known = (self.data or {}).get("versions") or {}
                    changed = {area for area in AREAS if versions.get(area) != known.get(area)}
                    if changed:
                        await self.async_reload_areas(changed, versions)
            except asyncio.CancelledError:
                raise
            except EinkaufsappAuthError:
                _LOGGER.warning("Einkaufsapp: Ereignis-Strom ohne Zugriff, bitte Token prüfen")
                self.config_entry.async_start_reauth(self.hass)
                return
            except Exception as err:  # noqa: BLE001 - jede Störung: später neu verbinden
                _LOGGER.debug("Einkaufsapp: Ereignis-Strom unterbrochen: %s", err)
            await asyncio.sleep(delay)
            delay = min(delay * 2, STREAM_RETRY_MAX)
