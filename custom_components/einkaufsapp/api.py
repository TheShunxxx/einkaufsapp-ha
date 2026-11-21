"""Kleiner Client für die API der Einkaufsapp (Bearer-Token, nur im Heimnetz)."""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from typing import Any

import aiohttp

_LOGGER = logging.getLogger(__name__)
TIMEOUT = aiohttp.ClientTimeout(total=20)


class EinkaufsappError(Exception):
    """Die App hat die Anfrage abgelehnt oder ist nicht erreichbar."""


class EinkaufsappAuthError(EinkaufsappError):
    """Token falsch, HA-Konto deaktiviert oder Anfrage nicht aus dem Heimnetz."""


class EinkaufsappClient:
    def __init__(self, session: aiohttp.ClientSession, url: str, token: str) -> None:
        self._session = session
        self._url = url.rstrip("/")
        self._headers = {"Authorization": f"Bearer {token}"}

    async def request(self, method: str, path: str, body: Any = None, params: dict | None = None) -> Any:
        try:
            async with self._session.request(method, f"{self._url}{path}", json=body, params=params,
                                             headers=self._headers, timeout=TIMEOUT) as response:
                text = await response.text()
                data = json.loads(text) if text else None
                if response.status in (401, 403):
                    raise EinkaufsappAuthError(_detail(data) or "Kein Zugriff auf die Einkaufsapp.")
                if response.status >= 400:
                    raise EinkaufsappError(_detail(data) or f"Die Einkaufsapp meldet Fehler {response.status}.")
                return data
        except (aiohttp.ClientError, TimeoutError) as err:
            raise EinkaufsappError(f"Die Einkaufsapp ist nicht erreichbar: {err}") from err
        except ValueError as err:
            raise EinkaufsappError("Die Einkaufsapp hat keine gültige Antwort geschickt.") from err

    async def get(self, path: str, **params: Any) -> Any:
        return await self.request("GET", path, params=params or None)

    async def versions(self) -> dict[str, int]:
        return await self.get("/api/versions")

    async def events(self) -> AsyncIterator[dict[str, int]]:
        """Liest den Ereignis-Strom /api/events und liefert die Versionen bei jeder Änderung."""
        timeout = aiohttp.ClientTimeout(total=None, sock_connect=15, sock_read=90)  # Lebenszeichen alle 20 s
        async with self._session.get(f"{self._url}/api/events", headers=self._headers,
                                     timeout=timeout) as response:
            if response.status in (401, 403):
                raise EinkaufsappAuthError("Kein Zugriff auf die Einkaufsapp.")
            if response.status >= 400:
                raise EinkaufsappError(f"Ereignis-Strom: Fehler {response.status}")
            event = None
            async for raw in response.content:
                line = raw.decode("utf-8").rstrip("\r\n")
                if line.startswith("event:"):
                    event = line[6:].strip()
                elif line.startswith("data:") and event == "versions":
                    try:
                        yield json.loads(line[5:].strip())
                    except ValueError:
                        _LOGGER.debug("Ungültige Ereignisdaten: %s", line)
                elif not line:
                    event = None


def _detail(data: Any) -> str | None:
    if isinstance(data, dict):
        detail = data.get("detail")
        if isinstance(detail, str):
            return detail
        if isinstance(detail, list) and detail:
            return "Ungültige Eingabe: " + "; ".join(str(d.get("msg", d)) for d in detail if isinstance(d, dict))
    return None
