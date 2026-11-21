"""Einrichtung, Sensoren, Todo-Liste, Dienste und Websocket gegen eine nachgebildete Einkaufsapp."""

from datetime import timedelta

import pytest
from homeassistant import config_entries
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.einkaufsapp.const import DOMAIN

URL = "http://app.test"
TOKEN = "geheim"


def monday(offset_weeks=0):
    today = dt_util.now().date()
    return today - timedelta(days=today.weekday()) + timedelta(weeks=offset_weeks)


def plan(start, lunch, dinners=()):
    return {
        "week_start": start.isoformat(),
        "days": [{"key": k, "date": (start + timedelta(days=i)).isoformat(), "recipe_id": rid,
                  "recipe": {1: "Chili", 2: "Curry", 3: "Pizza"}.get(rid), "booked": False, "cost": None}
                 for i, (k, rid) in enumerate(zip(
                     ("montag", "dienstag", "mittwoch", "donnerstag", "freitag", "samstag", "sonntag"), lunch))],
        "dinners": [{"recipe_id": rid, "recipe": "Suppe", "done": False, "cost": None} for rid in dinners],
        "rest_dinners": [],
    }


@pytest.fixture
def app(aioclient_mock):
    """Die Einkaufsapp als Attrappe: gleiche Pfade und Antwortformen wie das echte Backend."""
    this, nxt = monday(), monday(1)
    today_index = dt_util.now().date().weekday()
    lunch = [None] * 7
    lunch[today_index] = 1
    aioclient_mock.get(f"{URL}/api/versions", json={"list": 4, "plan": 2, "leftovers": 1, "recipes": 3})
    aioclient_mock.get(f"{URL}/api/week-plan?week_start={this.isoformat()}", json=plan(this, lunch, [5]))
    aioclient_mock.get(f"{URL}/api/week-plan?week_start={nxt.isoformat()}", json=plan(nxt, [2] + [None] * 6))
    aioclient_mock.get(f"{URL}/api/leftovers", json={"items": [
        {"id": 7, "name": "Chili", "portions": 2.5, "place": "kuehlschrank", "cooked_on": "2026-11-20",
         "expires_on": "2026-11-23", "days_left": 1, "planned": False, "recipe_id": 1, "source": "hand"},
        {"id": 8, "name": "Suppe", "portions": 1, "place": "gefrierschrank", "cooked_on": "2026-11-01",
         "expires_on": "2027-01-30", "days_left": 70, "planned": True, "recipe_id": None, "source": "hand"},
    ], "due": 1})
    aioclient_mock.get(f"{URL}/api/recipes", json=[
        {"id": 1, "name": "Chili", "type": "Mittagessen", "rating": None},
        {"id": 2, "name": "Curry", "type": "Mittagessen", "rating": 4},
    ])
    aioclient_mock.get(f"{URL}/api/list", json={"version": 4, "groups": [
        {"store": None, "items": [{"id": 11, "name": "Safran", "quantity": None, "unit": None, "note": None,
                                   "checked": False}]},
        {"store": {"id": 1, "name": "Aldi", "color": "#00f"}, "items": [
            {"id": 12, "name": "Milch", "quantity": 2, "unit": None, "note": None, "checked": False},
            {"id": 13, "name": "Mehl", "quantity": 1, "unit": "kg", "note": "Typ 405", "checked": True}]},
    ]})
    aioclient_mock.get(f"{URL}/api/events", status=503)  # Strom nicht verfügbar: Integration läuft trotzdem
    return aioclient_mock


async def setup(hass: HomeAssistant) -> MockConfigEntry:
    entry = MockConfigEntry(domain=DOMAIN, unique_id=DOMAIN, data={"url": URL, "token": TOKEN})
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


async def test_sensors_and_todo(hass: HomeAssistant, app) -> None:
    await setup(hass)
    assert hass.states.get("sensor.einkaufsapp_mittagessen_heute").state == "Chili"
    week = hass.states.get("sensor.einkaufsapp_wochenplan")
    assert week.state == f"KW {monday().isocalendar().week}"
    assert week.attributes["abendessen"] == [{"gericht": "Suppe", "erledigt": False, "rest": False}]
    reste = hass.states.get("sensor.einkaufsapp_reste")
    assert reste.state == "2" and reste.attributes["reste"][0]["ort"] == "Kühlschrank"
    assert hass.states.get("sensor.einkaufsapp_reste_fallig").state == "1"
    assert hass.states.get("sensor.einkaufsapp_stand").state == f"{dt_util.now().date().isoformat()} 4-2-1-3"
    # Die Todo-Liste zählt offene Einträge.
    assert hass.states.get("todo.einkaufsapp_einkaufsliste").state == "2"
    # Alle Anfragen tragen das Token.
    assert all(call[3]["Authorization"] == f"Bearer {TOKEN}" for call in app.mock_calls)


async def test_todo_writes_go_to_the_app(hass: HomeAssistant, app) -> None:
    await setup(hass)
    app.post(f"{URL}/api/list/items", json={})
    app.patch(f"{URL}/api/list/items/12", json={})
    app.delete(f"{URL}/api/list/items/11", json={})
    entity = "todo.einkaufsapp_einkaufsliste"
    await hass.services.async_call("todo", "add_item", {"item": "Butter"}, target={"entity_id": entity},
                                   blocking=True)
    await hass.services.async_call("todo", "update_item", {"item": "12", "status": "completed"},
                                   target={"entity_id": entity}, blocking=True)
    await hass.services.async_call("todo", "remove_item", {"item": ["11"]}, target={"entity_id": entity},
                                   blocking=True)
    sent = {(str(c[0]), str(c[1])): c[2] for c in app.mock_calls if c[0] != "GET"}
    assert sent[("POST", f"{URL}/api/list/items")] == {"name": "Butter", "source": "homeassistant"}
    assert sent[("PATCH", f"{URL}/api/list/items/12")] == {"checked": True}
    assert ("DELETE", f"{URL}/api/list/items/11") in sent


async def test_services(hass: HomeAssistant, app) -> None:
    await setup(hass)
    this = monday()
    app.post(f"{URL}/api/week-plan/suggest", json={"lunch": [3] * 7, "dinners": [5, 6, 7], "missing": 0})
    app.put(f"{URL}/api/week-plan", json={})
    app.post(f"{URL}/api/leftovers", json={})
    app.put(f"{URL}/api/recipes/2/rating", json={})
    assert not hass.services.has_service(DOMAIN, "plan_generieren")  # ganzer Plan nur in der App, mit Rückfrage
    await hass.services.async_call(DOMAIN, "tag_neu_wuerfeln", {"tag": "montag"}, blocking=True)
    await hass.services.async_call(DOMAIN, "rest_einbuchen", {"name": "Eintopf", "portionen": 1.5,
                                                              "ort": "gefrierschrank", "gekocht_am": "2026-11-02"}, blocking=True)
    await hass.services.async_call(DOMAIN, "gericht_bewerten", {"gericht": "curry", "sterne": 0}, blocking=True)
    sent = {(str(c[0]), str(c[1])): c[2] for c in app.mock_calls if c[0] != "GET"}
    assert sent[("POST", f"{URL}/api/week-plan/suggest")]["week_start"] == this.isoformat()
    assert sent[("PUT", f"{URL}/api/week-plan")] == {"week_start": this.isoformat(), "lunch": [3] * 7,
                                                     "dinners": [5, 6, 7]}
    assert sent[("POST", f"{URL}/api/leftovers")] == {"name": "Eintopf", "portions": 1.5, "place": "gefrierschrank",
                                                       "cooked_on": "2026-11-02"}
    assert sent[("PUT", f"{URL}/api/recipes/2/rating")] == {"rating": None}
    with pytest.raises(HomeAssistantError, match="gibt es in der Einkaufsapp nicht"):
        await hass.services.async_call(DOMAIN, "gericht_bewerten", {"gericht": "Gibtsnicht", "sterne": 3},
                                       blocking=True)


async def test_websocket_only_allowed_paths(hass: HomeAssistant, app) -> None:
    from unittest.mock import MagicMock

    from custom_components.einkaufsapp import ws_api

    await setup(hass)
    connection = MagicMock()

    async def ask(msg_id, method, path):
        ws_api(hass, connection, {"id": msg_id, "type": "einkaufsapp/api", "method": method, "path": path})
        await hass.async_block_till_done()

    await ask(1, "GET", "/api/recipes")
    msg_id, result = connection.send_result.call_args.args
    assert msg_id == 1 and result[1]["name"] == "Curry"
    await ask(2, "GET", "/api/users")
    assert connection.send_error.call_args.args[:2] == (2, "not_allowed")
    await ask(3, "POST", "/api/recipes")
    assert connection.send_error.call_args.args[:2] == (3, "not_allowed")
    await ask(4, "PUT", "/api/recipes/2/rating/../../users")
    assert connection.send_error.call_args.args[:2] == (4, "not_allowed")


async def test_config_flow(hass: HomeAssistant, aioclient_mock) -> None:
    aioclient_mock.get(f"{URL}/api/versions", status=401, json={"detail": "Bitte anmelden."})
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": config_entries.SOURCE_USER})
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {"url": URL + "/", "token": "x"})
    assert result["errors"] == {"base": "invalid_auth"}
    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{URL}/api/versions", json={"list": 0, "plan": 0, "leftovers": 0, "recipes": 0})
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {"url": URL + "/", "token": " x "})
    assert result["type"] == "create_entry" and result["data"] == {"url": URL, "token": "x"}
