import sys

import pytest
import pytest_socket

pytest_plugins = "pytest_homeassistant_custom_component"

if sys.platform == "win32":
    # Unter Windows braucht schon die Event-Loop ein lokales Socket-Paar, das pytest-socket sonst sperrt.
    # HTTP-Anfragen an die App fängt aioclient_mock trotzdem ab.
    pytest_socket.disable_socket = lambda *args, **kwargs: None
    # aiodns braucht unter Windows eine SelectorEventLoop; im Test reicht der einfache Resolver.
    import aiohttp
    import homeassistant.helpers.aiohttp_client as aiohttp_client
    import aiohttp.connector
    aiohttp_client.AsyncResolver = aiohttp.ThreadedResolver
    aiohttp.connector.DefaultResolver = aiohttp.ThreadedResolver


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    yield


@pytest.fixture(autouse=True)
def without_frontend(hass):
    """Ohne das große Paket home-assistant-frontend: frontend/http gelten als geladen, die Karte wird nicht
    angemeldet (register_frontend ist ein reiner Aufruf an HA und hier nicht Gegenstand der Tests)."""
    from unittest.mock import patch
    hass.config.components.update({"frontend", "http"})
    with patch("custom_components.einkaufsapp.register_frontend"):
        yield
