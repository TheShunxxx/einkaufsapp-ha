# Einkaufsapp für Home Assistant

Zeigt die Einkaufsapp in Home Assistant und bedient sie von dort: Wochenplan (Mittag und Abend), Reste, Sterne für
Gerichte und die Einkaufsliste. Die App bleibt die einzige Datenquelle. Home Assistant speichert nichts selbst und
braucht keine Webhooks: Es liest und schreibt direkt über die API der App, und die App meldet jede Änderung sofort
über ihren Ereignis-Strom (`/api/events`). Was man in HA einträgt, steht sofort in der App, und umgekehrt.

## Voraussetzungen
- Einkaufsapp ab dem Stand vom 21.11.2026 (Token-Zugang, Ereignis-Strom, Würfeln).
- Home Assistant 2025.7 oder neuer, im selben Heimnetz wie die App. Über einen Reverse-Proxy (Header wie X-Forwarded-For) lehnt die App das Token ab.
- Das Token: Datei `secrets/ha_token.txt` im Projektordner der Einkaufsapp (wird beim Deploy automatisch angelegt).

## Installation (HACS)
1. HACS → ⋮ → *Benutzerdefinierte Repositories* → dieses Repository, Kategorie *Integration*.
2. „Einkaufsapp“ herunterladen, Home Assistant neu starten.
3. *Einstellungen → Geräte & Dienste → Integration hinzufügen → Einkaufsapp*.
4. Adresse der App im Heimnetz (z. B. `http://192.168.1.20:8080`) und Token eintragen.

In der App erscheint danach in der Benutzerverwaltung das Konto „Home Assistant“. Deaktiviert man es dort, ist der
Zugang sofort gesperrt; HA fragt dann nach einem neuen Token.

## Was die Integration anlegt
Ordnet man das Gerät beim Einrichten einem Bereich zu, setzt HA dessen Namen davor (z. B. `sensor.kuche_einkaufsapp_reste`).
Die Karte findet ihren Sensor trotzdem selbst.

| Entität | Inhalt |
|---|---|
| `sensor.einkaufsapp_wochenplan` | „KW 47“, Attribute: Tage, Abendessen, nächste Woche |
| `sensor.einkaufsapp_mittagessen_heute` / `_morgen` | Gericht des Tages |
| `sensor.einkaufsapp_reste` | Anzahl Reste, Attribut `reste` (Ort, Portionen, haltbar bis, Tage übrig) |
| `sensor.einkaufsapp_reste_fallig` | Reste, die abgelaufen sind oder heute/morgen ablaufen (wie der rote Zähler in der App) |
| `sensor.einkaufsapp_stand` | Versionen je Bereich (Diagnose; die Karte lädt bei Änderung neu) |
| `todo.einkaufsapp_einkaufsliste` | Die Einkaufsliste: abhaken, hinzufügen, entfernen; auch per Sprachassistent |

## Dienste
| Dienst | Zweck |
|---|---|
| `einkaufsapp.plan_generieren` | freie Tage ab heute und Abendessen bis 3 würfeln (Regeln der App: Typ, Klasse, Sterne, letzte Wochen) |
| `einkaufsapp.tag_neu_wuerfeln` | ein Mittagessen ersetzen |
| `einkaufsapp.rest_einbuchen` | Rest einbuchen; ohne Datum rechnet die App die Haltbarkeit |
| `einkaufsapp.gericht_bewerten` | Sterne 1–5 setzen, 0 löscht |
| `einkaufsapp.artikel_hinzufuegen` | Artikel auf die Einkaufsliste |

Beispiel: Push, wenn morgen nichts geplant ist.
```yaml
triggers:
  - trigger: time
    at: "18:00:00"
conditions:
  - condition: state
    entity_id: sensor.einkaufsapp_mittagessen_morgen
    state: "unknown"
actions:
  - action: notify.mobile_app_mein_telefon
    data:
      message: "Für morgen ist noch kein Mittagessen geplant."
```

## Dashboard-Karte
Die Karte wird automatisch geladen, unter *Ressourcen* muss nichts eingetragen werden.
```yaml
type: custom:einkaufsapp-card
tab: mittag        # mittag | abend | reste
```
Rezepte anlegen und bearbeiten geht nur in der App (das HA-Konto hat keine Admin-Rechte); die Karte verlinkt dorthin.

## Aktualisierung
Änderungen kommen sofort über den Ereignis-Strom. Reißt er ab, verbindet sich die Integration selbst neu
(5 s bis 2 min Wartezeit) und gleicht beim Wiederverbinden alles ab. Zusätzlich gleicht sie alle 30 Minuten und
kurz nach Mitternacht ab (neuer Tag, Ablauf der Reste, neue Woche).

## Entwicklung
```powershell
python -m venv .venv
.venv\Scripts\python -m pip install pytest-homeassistant-custom-component
.venv\Scripts\python -m pytest
```
