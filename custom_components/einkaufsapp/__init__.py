"""Einkaufsapp in Home Assistant: Wochenplan, Reste, Rezepte und Einkaufsliste direkt aus der App.

Die App ist die einzige Datenquelle; HA speichert nichts selbst. Gelesen und geschrieben wird über die API der App
mit dem HA-Token, Änderungen meldet der Ereignis-Strom der App sofort (coordinator.py).
Die Dashboard-Karte spricht über den Websocket-Befehl „einkaufsapp/api“ mit der App, damit das Token in HA bleibt.
"""

from __future__ import annotations

import logging
import re
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError
import homeassistant.helpers.config_validation as cv
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.typing import ConfigType
from homeassistant.util import dt as dt_util

from .api import EinkaufsappClient, EinkaufsappError
from .const import CARD_FILENAME, CONF_TOKEN, CONF_URL, DAY_KEYS, DOMAIN, FRONTEND_URL, UNITS
from .coordinator import EinkaufsappCoordinator, monday

_LOGGER = logging.getLogger(__name__)
PLATFORMS = [Platform.SENSOR, Platform.TODO]
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)
VERSION = "0.1.3"

type EinkaufsappConfigEntry = ConfigEntry[EinkaufsappCoordinator]

# Was die Karte über den Websocket-Befehl erreichen darf (Methode, Pfad). Keine Benutzerverwaltung, kein Admin.
ALLOWED = [
    ("GET", r"/api/(week-plan|leftovers|recipes|recipes/\d+|list|versions|undo)"),
    ("PUT", r"/api/week-plan"),
    ("POST", r"/api/week-plan/(suggest|list-impact|dinner-done|ingredients|transfer|rest-dinner|rest-dinner/remove"
             r"|rest-dinner-done)"),
    ("POST", r"/api/leftovers"),
    ("PATCH", r"/api/leftovers/\d+"),
    ("POST", r"/api/leftovers/\d+/portions"),
    ("DELETE", r"/api/leftovers/\d+"),
    ("PUT", r"/api/recipes/\d+/rating"),
    ("POST", r"/api/list/items"),
    ("PATCH", r"/api/list/items/\d+"),
    ("DELETE", r"/api/list/items/\d+"),
    ("POST", r"/api/(undo|redo)"),
]


def allowed(method: str, path: str) -> bool:
    return any(method == m and re.fullmatch(pattern, path) for m, pattern in ALLOWED)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    websocket_api.async_register_command(hass, ws_api)
    register_services(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: EinkaufsappConfigEntry) -> bool:
    client = EinkaufsappClient(async_get_clientsession(hass), entry.data[CONF_URL], entry.data[CONF_TOKEN])
    coordinator = EinkaufsappCoordinator(hass, entry, client)
    await coordinator.async_config_entry_first_refresh()
    entry.runtime_data = coordinator
    coordinator.async_start()
    entry.async_on_unload(coordinator.async_stop)
    await register_frontend(hass)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: EinkaufsappConfigEntry) -> bool:
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)


async def register_frontend(hass: HomeAssistant) -> None:
    """Die Karte einmal ausliefern und auf jeder Seite laden (auch ohne Eintrag unter „Ressourcen“)."""
    store = hass.data.setdefault(DOMAIN, {})
    if store.get("frontend"):
        return
    await hass.http.async_register_static_paths(
        [StaticPathConfig(FRONTEND_URL, str(Path(__file__).with_name("frontend")), False)])
    add_extra_js_url(hass, f"{FRONTEND_URL}/{CARD_FILENAME}?v={VERSION}")
    store["frontend"] = True


def coordinator_of(hass: HomeAssistant) -> EinkaufsappCoordinator:
    for entry in hass.config_entries.async_entries(DOMAIN):
        if entry.state is ConfigEntryState.LOADED:
            return entry.runtime_data
    raise HomeAssistantError("Die Einkaufsapp ist nicht eingerichtet oder gerade nicht erreichbar.")


async def call(coordinator: EinkaufsappCoordinator, method: str, path: str, body: Any = None,
               params: dict | None = None) -> Any:
    try:
        return await coordinator.client.request(method, path, body, params)
    except EinkaufsappError as err:
        raise HomeAssistantError(str(err)) from err


# ---------- Websocket für die Karte ----------

@websocket_api.websocket_command({
    vol.Required("type"): "einkaufsapp/api",
    vol.Required("method"): vol.In(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    vol.Required("path"): str,
    vol.Optional("body"): vol.Any(dict, list, None),
    vol.Optional("params"): {str: vol.Any(str, int, float, bool)},
})
@websocket_api.async_response
async def ws_api(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    method, path = msg["method"], msg["path"]
    if not allowed(method, path):
        connection.send_error(msg["id"], "not_allowed", f"{method} {path} ist für die Karte nicht freigegeben.")
        return
    try:
        coordinator = coordinator_of(hass)
        result = await call(coordinator, method, path, msg.get("body"), msg.get("params"))
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "app_error", str(err))
        return
    connection.send_result(msg["id"], result)


# ---------- Dienste für Automationen ----------

def week_of(call_data: dict) -> date:
    return monday(call_data.get("woche") or dt_util.now().date())


async def current_plan(coordinator: EinkaufsappCoordinator, start: date) -> tuple[list, list]:
    plan = await call(coordinator, "GET", "/api/week-plan", params={"week_start": start.isoformat()})
    return [d["recipe_id"] for d in plan["days"]], [d["recipe_id"] for d in plan["dinners"]]


async def save_suggestion(coordinator: EinkaufsappCoordinator, start: date, body: dict) -> dict:
    lunch, dinners = await current_plan(coordinator, start)
    result = await call(coordinator, "POST", "/api/week-plan/suggest",
                        {"week_start": start.isoformat(), "lunch": lunch, "dinners": dinners, **body})
    if result["lunch"] != lunch or result["dinners"] != dinners:
        await call(coordinator, "PUT", "/api/week-plan",
                   {"week_start": start.isoformat(), "lunch": result["lunch"], "dinners": result["dinners"]})
    return result


async def find_recipe(coordinator: EinkaufsappCoordinator, name: str) -> dict:
    recipes = await call(coordinator, "GET", "/api/recipes")
    wanted = name.strip().casefold()
    found = next((r for r in recipes if r["name"].casefold() == wanted), None)
    if found is None:
        raise HomeAssistantError(f"Das Rezept „{name}“ gibt es in der Einkaufsapp nicht.")
    return found


def register_services(hass: HomeAssistant) -> None:
    async def generate(service: ServiceCall) -> None:
        await save_suggestion(coordinator_of(hass), week_of(service.data), {})

    async def reroll(service: ServiceCall) -> None:
        await save_suggestion(coordinator_of(hass), week_of(service.data),
                              {"day": DAY_KEYS.index(service.data["tag"])})

    async def book(service: ServiceCall) -> None:
        body = {"name": service.data["name"], "portions": service.data["portionen"], "place": service.data["ort"]}
        if expires := service.data.get("haltbar_bis"):
            body["expires_on"] = expires.isoformat()
        if cooked := service.data.get("gekocht_am"):
            body["cooked_on"] = cooked.isoformat()
        await call(coordinator_of(hass), "POST", "/api/leftovers", body)

    async def rate(service: ServiceCall) -> None:
        coordinator = coordinator_of(hass)
        recipe = await find_recipe(coordinator, service.data["gericht"])
        stars = service.data["sterne"]
        await call(coordinator, "PUT", f"/api/recipes/{recipe['id']}/rating", {"rating": stars or None})

    async def add_item(service: ServiceCall) -> None:
        body = {"name": service.data["name"], "source": "homeassistant"}
        if "menge" in service.data:
            body["quantity"] = service.data["menge"]
        if unit := service.data.get("einheit"):
            body["unit"] = unit
        await call(coordinator_of(hass), "POST", "/api/list/items", body)

    week = {vol.Optional("woche"): cv.date}
    hass.services.async_register(DOMAIN, "plan_generieren", generate, schema=vol.Schema(week))
    hass.services.async_register(DOMAIN, "tag_neu_wuerfeln", reroll,
                                 schema=vol.Schema({vol.Required("tag"): vol.In(DAY_KEYS), **week}))
    hass.services.async_register(DOMAIN, "rest_einbuchen", book, schema=vol.Schema({
        vol.Required("name"): cv.string,
        vol.Required("portionen"): vol.All(vol.Coerce(float), vol.Range(min=0.5, max=99)),
        vol.Required("ort"): vol.In(["kuehlschrank", "gefrierschrank"]),
        vol.Optional("haltbar_bis"): cv.date,
        vol.Optional("gekocht_am"): cv.date,
    }))
    hass.services.async_register(DOMAIN, "gericht_bewerten", rate, schema=vol.Schema({
        vol.Required("gericht"): cv.string,
        vol.Required("sterne"): vol.All(vol.Coerce(int), vol.Range(min=0, max=5)),
    }))
    hass.services.async_register(DOMAIN, "artikel_hinzufuegen", add_item, schema=vol.Schema({
        vol.Required("name"): cv.string,
        vol.Optional("menge"): vol.All(vol.Coerce(float), vol.Range(min=0.01, max=10000)),
        vol.Optional("einheit"): vol.In(UNITS),
    }))
