"""Konstanten der Einkaufsapp-Integration."""

from datetime import timedelta

DOMAIN = "einkaufsapp"
CONF_URL = "url"
CONF_TOKEN = "token"
DEFAULT_URL = "http://"  # Adresse der App im Heimnetz, z. B. http://192.168.1.20:8080

# Rückfall, falls der Ereignis-Strom abreißt; normal kommen Änderungen sofort über /api/events.
UPDATE_INTERVAL = timedelta(minutes=30)
STREAM_RETRY_MIN = 5
STREAM_RETRY_MAX = 120

AREAS = ("list", "plan", "leftovers", "recipes")
DAY_KEYS = ("montag", "dienstag", "mittwoch", "donnerstag", "freitag", "samstag", "sonntag")
UNITS = ("Stück", "Packung", "g", "kg", "ml", "l")  # wie models.UNITS in der App
PLACES = {"kuehlschrank": "Kühlschrank", "gefrierschrank": "Gefrierschrank"}

FRONTEND_URL = "/einkaufsapp-frontend"
CARD_FILENAME = "einkaufsapp-card.js"
