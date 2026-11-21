"""Einrichtung: Adresse der Einkaufsapp und Token (secrets/ha_token.txt im Projektordner der App)."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import EinkaufsappAuthError, EinkaufsappClient, EinkaufsappError
from .const import CONF_TOKEN, CONF_URL, DEFAULT_URL, DOMAIN


class EinkaufsappConfigFlow(ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def _check(self, url: str, token: str) -> str | None:
        client = EinkaufsappClient(async_get_clientsession(self.hass), url, token)
        try:
            await client.versions()
        except EinkaufsappAuthError:
            return "invalid_auth"
        except EinkaufsappError:
            return "cannot_connect"
        return None

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()
        errors: dict[str, str] = {}
        if user_input is not None:
            url = user_input[CONF_URL].strip().rstrip("/")
            token = user_input[CONF_TOKEN].strip()
            if not (error := await self._check(url, token)):
                return self.async_create_entry(title="Einkaufsapp", data={CONF_URL: url, CONF_TOKEN: token})
            errors["base"] = error
        schema = vol.Schema({
            vol.Required(CONF_URL, default=(user_input or {}).get(CONF_URL, DEFAULT_URL)): str,
            vol.Required(CONF_TOKEN): str,
        })
        return self.async_show_form(step_id="user", data_schema=schema, errors=errors)

    async def async_step_reauth(self, entry_data: Mapping[str, Any]) -> ConfigFlowResult:
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        entry = self._get_reauth_entry()
        errors: dict[str, str] = {}
        if user_input is not None:
            token = user_input[CONF_TOKEN].strip()
            if not (error := await self._check(entry.data[CONF_URL], token)):
                return self.async_update_reload_and_abort(entry, data_updates={CONF_TOKEN: token})
            errors["base"] = error
        return self.async_show_form(step_id="reauth_confirm", data_schema=vol.Schema({vol.Required(CONF_TOKEN): str}),
                                    errors=errors)
