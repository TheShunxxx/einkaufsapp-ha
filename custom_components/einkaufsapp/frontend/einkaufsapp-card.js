/*
 * Einkaufsapp-Karte für Home Assistant (Lovelace Custom Card).
 *
 * Reines JavaScript ohne Build-Schritt und ohne Abhängigkeiten. Alle Daten kommen aus der Einkaufsapp über den
 * Websocket-Befehl „einkaufsapp/api“ der Integration; das Token bleibt in HA. Die Karte lädt neu, sobald sich der
 * Zustand von sensor.einkaufsapp_stand ändert (jede Änderung in der App) und nach jeder eigenen Änderung.
 *
 * Optionen: stand_entity (ohne Angabe sucht die Karte den Stand-Sensor der Integration selbst, auch wenn HA ihm
 * einen Bereich vorangestellt hat, z. B. sensor.kuche_einkaufsapp_stand), tab (mittag|abend|reste), title.
 */
(() => {
  const CARD = "einkaufsapp-card";
  const DEFAULT_STAND = "sensor.einkaufsapp_stand";

  /** Stand-Sensor der Integration finden: über das Entitäten-Register (Plattform einkaufsapp), sonst über den Namen. */
  function findStand(hass) {
    const ids = Object.keys(hass.states).filter((id) => id.startsWith("sensor.") && id.endsWith("einkaufsapp_stand"));
    const registry = hass.entities || {};
    const own = Object.keys(hass.states).find((id) => id.startsWith("sensor.") && registry[id]
      && registry[id].platform === "einkaufsapp" && hass.states[id].attributes
      && "versionen" in hass.states[id].attributes);
    return own || ids[0];
  }
  const DAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
  const DAYS_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
  const PLACES = { kuehlschrank: "Kühlschrank", gefrierschrank: "Gefrierschrank" };
  const TABS = { mittag: "Mittag", abend: "Abend", reste: "Reste" };
  const DINNER_TARGET = 3; // wie planner.DINNER_TARGET in der App
  const MAX_PORTIONS = 99;
  const NARROW = 600;

  // ---------- Hilfen ----------

  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
  const pad = (n) => String(n).padStart(2, "0");
  const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseDate = (s) => {
    const [y, m, d] = String(s).split("-").map(Number);
    return new Date(y, m - 1, d);
  };
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const today = () => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  };
  const mondayOf = (d) => addDays(d, -((d.getDay() + 6) % 7));
  const dayDiff = (a, b) => Math.round((b - a) / 864e5);
  const shortDate = (s) => {
    const d = parseDate(s);
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`;
  };
  const isoWeek = (d) => {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    const year = t.getUTCFullYear();
    return { week: Math.ceil(((t - Date.UTC(year, 0, 1)) / 864e5 + 1) / 7), year };
  };
  const num = (n) => String(Math.round(Number(n) * 100) / 100).replace(".", ",");
  const parseNum = (s) => parseFloat(String(s).replace(",", "."));
  const errText = (err) => (err && (err.message || err.error)) || String(err || "Unbekannter Fehler");
  const sameList = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  const svg = (inner) => `<svg viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;
  const ICON = {
    list: svg('<path d="M7,5H21V7H7V5M7,13V11H21V13H7M4,4.5A1.5,1.5 0 0,1 5.5,6A1.5,1.5 0 0,1 4,7.5A1.5,1.5 0 0,1 2.5,6A1.5,1.5 0 0,1 4,4.5M4,10.5A1.5,1.5 0 0,1 5.5,12A1.5,1.5 0 0,1 4,13.5A1.5,1.5 0 0,1 2.5,12A1.5,1.5 0 0,1 4,10.5M7,19V17H21V19H7M4,16.5A1.5,1.5 0 0,1 5.5,18A1.5,1.5 0 0,1 4,19.5A1.5,1.5 0 0,1 2.5,18A1.5,1.5 0 0,1 4,16.5Z"/>'),
    dice: svg('<rect x="3.5" y="3.5" width="17" height="17" rx="3.5" fill="none" stroke="currentColor" stroke-width="2"/>'
      + '<circle cx="8.5" cy="8.5" r="1.6"/><circle cx="15.5" cy="8.5" r="1.6"/><circle cx="12" cy="12" r="1.6"/>'
      + '<circle cx="8.5" cy="15.5" r="1.6"/><circle cx="15.5" cy="15.5" r="1.6"/>'),
    jar: svg('<path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" '
      + 'd="M8.5 2.5h7v3.5h-7zM7.5 6h9a2.5 2.5 0 0 1 2.5 2.5v10.5a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 19V8.5A2.5 2.5 0 0 1 7.5 6z"/>'
      + '<rect x="5" y="11" width="14" height="5" opacity=".35"/>'),
    close: svg('<path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/>'),
    pencil: svg('<path d="M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.12,5.12L18.87,8.87M3,17.25V21H6.75L17.81,9.93L14.06,6.18L3,17.25Z"/>'),
    dots: svg('<circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>'),
  };

  /** Ablauf-Kennzeichen eines Rests: [Text, Farbklasse]. */
  const expiry = (item) => {
    const n = item.days_left;
    if (n < 0) return ["abgelaufen", "red"];
    if (n === 0) return ["heute", "yellow"];
    if (n <= 2) return [`noch ${n} ${n === 1 ? "Tag" : "Tage"}`, "yellow"];
    if (n <= 4) return [`noch ${n} Tage`, "lightgreen"];
    return [`bis ${shortDate(item.expires_on)}`, "green"];
  };

  const STYLE = `
    :host { display: block; }
    [hidden] { display: none !important; }
    ha-card { display: block; padding: 12px 12px 10px; box-sizing: border-box; }
    ha-card:not(:defined) {
      background: var(--card-background-color, #fff); color: var(--primary-text-color, #212121);
      border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.2); font-family: var(--paper-font-body1_-_font-family, sans-serif);
    }
    button { font: inherit; color: inherit; }
    svg { width: 20px; height: 20px; fill: currentColor; display: block; }
    .title { font-size: 1.25em; font-weight: 500; margin: 0 2px 8px; }
    .head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
    .week { font-size: 1.05em; }
    .week b { font-weight: 600; }
    .nav { display: flex; align-items: center; gap: 4px; padding-left: 12px; border-left: 1px solid var(--divider-color, #ddd); }
    .nb, .gen, .add, .chip, .plain {
      border: 1px solid var(--divider-color, #ccc); background: transparent; border-radius: 8px;
      padding: 5px 10px; cursor: pointer; min-height: 32px; line-height: 1.2;
    }
    .nb { min-width: 32px; padding: 5px 8px; font-size: 1.1em; }
    .nb.txt { font-size: 0.95em; }
    .gen { margin-left: auto; background: var(--primary-color, #03a9f4); color: var(--text-primary-color, #fff); border-color: transparent; font-weight: 500; }
    button:disabled { opacity: .4; cursor: default; }
    .msg { margin: 8px 0 0; padding: 6px 10px; border-radius: 8px; font-size: .92em;
      background: color-mix(in srgb, var(--primary-color, #03a9f4) 12%, transparent); }
    .msg.err { background: color-mix(in srgb, var(--error-color, #db4437) 14%, transparent); color: var(--error-color, #db4437); }
    .msg.warn { background: color-mix(in srgb, var(--warning-color, #ffa600) 18%, transparent); }
    .tabs { display: flex; gap: 6px; margin: 12px 0 10px; flex-wrap: wrap; }
    .chip { border-radius: 16px; padding: 5px 14px; }
    .chip.on { background: var(--primary-color, #03a9f4); color: var(--text-primary-color, #fff); border-color: transparent; }
    .chip .due { display: inline-block; min-width: 16px; padding: 0 4px; margin-left: 4px; border-radius: 8px; font-size: .8em;
      background: var(--error-color, #db4437); color: #fff; text-align: center; }
    .rows { display: flex; flex-direction: column; gap: 6px; }
    .row { display: grid; grid-template-columns: 18px 132px minmax(0, 1fr) auto; align-items: center; gap: 8px;
      position: relative; border-radius: 10px; background: var(--card-background-color, #fff); }
    .row.dinner, .row.left { grid-template-columns: minmax(0, 1fr) auto; }
    .row.past { opacity: .45; }
    .row.busy { opacity: .6; }
    .row.today .wd { color: var(--primary-color, #03a9f4); font-weight: 600; }
    .grip { cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; text-align: center;
      color: var(--secondary-text-color, #888); letter-spacing: -3px; font-size: 1.1em; padding: 8px 0; }
    .grip.off { cursor: default; opacity: .3; }
    .when { display: flex; align-items: baseline; gap: 8px; white-space: nowrap; }
    .date { color: var(--secondary-text-color, #777); font-size: .9em; }
    .dish { border: none; text-align: left; cursor: pointer; border-radius: 8px; min-height: 36px; padding: 7px 10px;
      background: var(--secondary-background-color, rgba(127,127,127,.14)); font-style: italic; font-weight: 700;
      overflow-wrap: anywhere; min-width: 0; }
    .dish.empty { font-style: normal; font-weight: 400; color: var(--secondary-text-color, #888); }
    .dish.done { text-decoration: line-through; opacity: .55; }
    .dish .sub { font-weight: 400; font-style: normal; color: var(--secondary-text-color, #888); }
    .btns { display: flex; gap: 6px; }
    .sq { width: 36px; height: 36px; padding: 0; border: 1px solid var(--divider-color, #ccc); border-radius: 8px;
      background: transparent; color: var(--primary-color, #03a9f4); display: inline-grid; place-items: center;
      cursor: pointer; position: relative; flex: none; }
    .sq.red, .red-text { color: var(--error-color, #db4437); }
    .sq.on { background: color-mix(in srgb, var(--primary-color, #03a9f4) 14%, transparent); }
    .sq .tick { position: absolute; right: -4px; top: -4px; width: 15px; height: 15px; border-radius: 50%;
      background: var(--success-color, #43a047); color: #fff; font-size: 10px; line-height: 15px; text-align: center; font-style: normal; }
    .strip { grid-column: 1 / -1; display: flex; gap: 6px; justify-content: flex-end; flex-wrap: wrap; padding: 0 0 4px; }
    .strip .plain { display: inline-flex; align-items: center; gap: 6px; }
    .strip svg { width: 18px; height: 18px; }
    .row.drag { z-index: 3; pointer-events: none; box-shadow: 0 4px 14px rgba(0,0,0,.3); opacity: .95; }
    .row.over .dish { outline: 2px dashed var(--primary-color, #03a9f4); outline-offset: 1px; }
    .empty-note, .state { color: var(--secondary-text-color, #888); padding: 10px 4px; }
    .state.err { color: var(--primary-text-color); text-align: center; padding: 18px 8px; }
    .state.err b { display: block; font-size: 1.1em; margin-bottom: 4px; }
    .state.err .detail { color: var(--secondary-text-color, #888); font-size: .9em; margin-bottom: 10px; }
    .bar { display: flex; justify-content: flex-end; margin-top: 8px; }
    .add { color: var(--primary-color, #03a9f4); font-weight: 500; }
    .group { margin: 12px 2px 6px; font-weight: 600; color: var(--secondary-text-color, #777); font-size: .92em; }
    .group:first-child { margin-top: 2px; }
    .lname { font-style: normal; font-weight: 600; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; }
    .exp, .tag { font-size: .78em; font-weight: 500; padding: 1px 7px; border-radius: 10px; white-space: nowrap; font-style: normal; }
    .exp.red { background: var(--error-color, #db4437); color: #fff; }
    .exp.yellow { background: #f9c623; color: #3a2e00; }
    .exp.lightgreen { background: #b5e48c; color: #1f3a0a; }
    .exp.green { background: #43a047; color: #fff; }
    .tag { border: 1px solid var(--divider-color, #ccc); color: var(--secondary-text-color, #777); }
    .portions { display: flex; align-items: center; gap: 4px; }
    .portions .pv { min-width: 30px; text-align: center; font-variant-numeric: tabular-nums; }
    .portions .sq { font-size: 1.2em; }
    .foot { display: flex; justify-content: flex-end; gap: 10px; margin-top: 10px; font-size: .85em; color: var(--secondary-text-color, #888); }
    .foot a { color: var(--secondary-text-color, #888); text-decoration: none; }
    .foot a:hover { text-decoration: underline; color: var(--primary-color, #03a9f4); }

    .narrow .head { gap: 8px; }
    .narrow .nav { padding-left: 0; border-left: none; }
    .narrow .gen { margin-left: 0; }
    .narrow .row:not(.dinner):not(.left) { grid-template-columns: 14px 34px minmax(0, 1fr) auto; gap: 6px; }
    .narrow .when { flex-direction: column; gap: 0; align-items: flex-start; line-height: 1.2; }
    .narrow .date { font-size: .78em; }
    .narrow .sq { width: 32px; height: 32px; }
    .narrow .sq svg { width: 18px; height: 18px; }
    .narrow .btns { gap: 4px; }
    .narrow .dish { padding: 6px 8px; }

    dialog { border: none; padding: 0; border-radius: 16px; width: min(480px, calc(100vw - 24px)); max-height: min(82vh, 700px);
      background: var(--card-background-color, #fff); color: var(--primary-text-color, #212121); box-shadow: 0 10px 40px rgba(0,0,0,.4); }
    dialog[open] { display: flex; flex-direction: column; }
    dialog::backdrop { background: rgba(0,0,0,.45); }
    .dlg-in { display: flex; flex-direction: column; gap: 10px; padding: 16px; min-height: 0; flex: 1 1 auto; box-sizing: border-box; }
    .dlg-head { display: flex; align-items: center; gap: 8px; }
    .dlg-head h3 { margin: 0; font-size: 1.1em; font-weight: 600; flex: 1; }
    .x { border: none; background: transparent; cursor: pointer; padding: 4px; color: var(--secondary-text-color, #777); }
    input[type=search], input[type=text], input[type=number], input[type=date] {
      font: inherit; color: var(--primary-text-color, #212121); background: var(--secondary-background-color, rgba(127,127,127,.12));
      border: 1px solid var(--divider-color, #ccc); border-radius: 8px; padding: 8px 10px; box-sizing: border-box; width: 100%; min-width: 0; }
    input:focus { outline: 2px solid var(--primary-color, #03a9f4); outline-offset: -1px; }
    .list { overflow: auto; flex: 1 1 auto; min-height: 120px; margin: 0 -6px; padding: 0 6px; }
    .item { display: flex; align-items: center; gap: 4px; }
    .pick { flex: 1; display: flex; align-items: center; gap: 8px; text-align: left; border: none; background: transparent;
      padding: 9px 8px; border-radius: 8px; cursor: pointer; min-width: 0; overflow-wrap: anywhere; }
    .pick:hover, .pick:focus-visible { background: var(--secondary-background-color, rgba(127,127,127,.14)); }
    .pick.cur { background: color-mix(in srgb, var(--primary-color, #03a9f4) 14%, transparent); font-weight: 600; }
    .pick.special { color: var(--primary-color, #03a9f4); font-weight: 500; }
    .pick .stars { color: #f5b301; font-size: .8em; letter-spacing: 1px; white-space: nowrap; }
    .pick .muted { color: var(--secondary-text-color, #888); font-size: .85em; font-weight: 400; white-space: nowrap; }
    .rate-btn { border: none; background: transparent; cursor: pointer; color: var(--secondary-text-color, #999); padding: 6px; font-size: 1.05em; border-radius: 8px; }
    .rate-btn.has { color: #f5b301; }
    .rate { display: flex; align-items: center; gap: 2px; justify-content: flex-end; padding: 2px 6px 8px;
      font-size: .9em; color: var(--secondary-text-color, #777); }
    .rate button { border: none; background: transparent; cursor: pointer; font-size: 1.45em; padding: 0 3px; color: var(--divider-color, #bbb); line-height: 1; }
    .rate button.on { color: #f5b301; }
    .lgroup { font-size: .85em; font-weight: 600; color: var(--secondary-text-color, #777); margin: 10px 8px 2px; }
    .field { display: flex; flex-direction: column; gap: 4px; font-size: .92em; }
    .field > span, .field > label > span { color: var(--secondary-text-color, #777); }
    .stepper { display: flex; gap: 6px; align-items: center; }
    .stepper input { width: 90px; text-align: center; }
    .seg { display: flex; gap: 6px; flex-wrap: wrap; }
    .seg label { flex: 1; }
    .seg input { position: absolute; opacity: 0; pointer-events: none; }
    .seg span { display: block; text-align: center; padding: 8px; border-radius: 8px; border: 1px solid var(--divider-color, #ccc); cursor: pointer; }
    .seg input:checked + span { background: var(--primary-color, #03a9f4); color: var(--text-primary-color, #fff); border-color: transparent; }
    .seg input:focus-visible + span { outline: 2px solid var(--primary-color, #03a9f4); outline-offset: 2px; }
    .dlg-foot { display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; }
    .dlg-foot .left { margin-right: auto; }
    .primary { background: var(--primary-color, #03a9f4); color: var(--text-primary-color, #fff); border-color: transparent; font-weight: 500; }
    .danger { color: var(--error-color, #db4437); }
    .danger.sure { background: var(--error-color, #db4437); color: #fff; border-color: transparent; }
    .dlg-err { color: var(--error-color, #db4437); font-size: .9em; }
    .hint { font-size: .85em; color: var(--secondary-text-color, #888); }
  `;

  class EinkaufsappCard extends HTMLElement {
    constructor() {
      super();
      this._config = { stand_entity: DEFAULT_STAND, tab: "mittag" };
      this._tab = "mittag";
      this._week = mondayOf(today());
      this._plan = null;
      this._recipes = null;
      this._leftovers = null;
      this._loaded = false;
      this._error = null;
      this._seq = 0;
      this._busy = new Set();
      this._msg = null;
      this._msgTimer = null;
      this._menu = null;
      this._dlg = null;
      this._drag = null;
      this._renderPending = false;
      this._narrow = false;
      this._standSeen = undefined;
      this._app = null;

      const root = this.attachShadow({ mode: "open" });
      root.innerHTML = `<style>${STYLE}</style><ha-card><div class="wrap"></div></ha-card><dialog></dialog>`;
      this._wrap = root.querySelector(".wrap");
      this._dlgEl = root.querySelector("dialog");
      root.addEventListener("click", (e) => this._onClick(e));
      root.addEventListener("input", (e) => this._onInput(e));
      root.addEventListener("keydown", (e) => this._onKey(e));
      root.addEventListener("pointerdown", (e) => this._onPointerDown(e));
      this._dlgEl.addEventListener("submit", (e) => { e.preventDefault(); this._submitDialog(); });
      this._dlgEl.addEventListener("close", () => { this._dlg = null; this._dlgEl.innerHTML = ""; });
      this._onMove = (e) => this._dragMove(e);
      this._onUp = (e) => this._dragEnd(e, true);
      this._onCancel = (e) => this._dragEnd(e, false);
      this._resize = typeof ResizeObserver === "function" ? new ResizeObserver((entries) => {
        const width = entries[0].contentRect.width;
        const narrow = width > 0 && width < NARROW;
        if (narrow !== this._narrow) {
          this._narrow = narrow;
          setTimeout(() => this._render(), 0); // nicht im Observer selbst umbauen (Schleifenwarnung)
        }
      }) : null;
      this._render();
    }

    // ---------- Lovelace-Schnittstelle ----------

    static getStubConfig() {
      return {};
    }

    setConfig(config) {
      if (!config || typeof config !== "object") throw new Error("Ungültige Konfiguration der Einkaufsapp-Karte.");
      const tab = TABS[config.tab] ? config.tab : "mittag";
      const entity = typeof config.stand_entity === "string" && config.stand_entity ? config.stand_entity : DEFAULT_STAND;
      const changedEntity = entity !== this._config.stand_entity;
      this._config = { ...config, stand_entity: entity, stand_fixed: entity !== DEFAULT_STAND, tab };
      this._tab = tab;
      if (changedEntity) this._standSeen = undefined;
      this._render();
    }

    set hass(hass) {
      this._hass = hass;
      if (!this._config.stand_fixed && hass && hass.states && !hass.states[this._config.stand_entity]) {
        const found = findStand(hass);
        if (found && found !== this._config.stand_entity) {
          this._config = { ...this._config, stand_entity: found };
          this._standSeen = undefined;
        }
      }
      const state = hass && hass.states ? hass.states[this._config.stand_entity] : undefined;
      const app = state && state.attributes ? state.attributes.app : null;
      const stand = state ? state.state : "__fehlt__";
      let render = false;
      if (app !== this._app) {
        this._app = app;
        render = true;
      }
      if (this._hasEntity !== Boolean(state)) {
        this._hasEntity = Boolean(state);
        render = true;
      }
      if (stand !== this._standSeen) {
        this._standSeen = stand;
        this._load();
      } else if (render) {
        this._render();
      }
    }

    get hass() {
      return this._hass;
    }

    getCardSize() {
      return 8;
    }

    getGridOptions() {
      return { columns: 12, min_columns: 6 };
    }

    connectedCallback() {
      if (this._resize) this._resize.observe(this);
    }

    disconnectedCallback() {
      if (this._resize) this._resize.disconnect();
      if (this._drag) this._dragEnd(null, false);
    }

    // ---------- Daten ----------

    _weekIso() {
      return isoDate(this._week);
    }

    _api(method, path, body, params) {
      if (!this._hass || typeof this._hass.callWS !== "function") {
        return Promise.reject(new Error("Keine Verbindung zu Home Assistant."));
      }
      const msg = { type: "einkaufsapp/api", method, path };
      if (body !== undefined) msg.body = body;
      if (params) msg.params = params;
      return this._hass.callWS(msg);
    }

    async _load() {
      if (!this._hass) return;
      const seq = ++this._seq;
      const week = this._weekIso();
      try {
        const [plan, recipes, leftovers] = await Promise.all([
          this._api("GET", "/api/week-plan", undefined, { week_start: week }),
          this._api("GET", "/api/recipes"),
          this._api("GET", "/api/leftovers"),
        ]);
        if (seq !== this._seq) return;
        this._applyPlan(plan);
        this._recipes = Array.isArray(recipes) ? recipes : [];
        this._leftovers = leftovers && Array.isArray(leftovers.items) ? leftovers : { items: [], due: 0 };
        this._error = null;
      } catch (err) {
        if (seq !== this._seq) return;
        this._error = errText(err);
        if (this._plan || this._leftovers) this._toast(`Aktualisieren fehlgeschlagen: ${this._error}`, "err");
      }
      this._loaded = true;
      this._render();
      this._refreshDialog();
    }

    _applyPlan(plan) {
      if (plan && Array.isArray(plan.days) && plan.week_start === this._weekIso()) this._plan = plan;
    }

    _applyLeftovers(data) {
      if (data && Array.isArray(data.items)) this._leftovers = data;
    }

    _lunch() {
      return this._plan.days.map((d) => d.recipe_id ?? null);
    }

    _dinners() {
      return this._plan.dinners.map((d) => d.recipe_id);
    }

    _recipe(id) {
      return (this._recipes || []).find((r) => r.id === id);
    }

    async _savePlan(lunch, dinners) {
      const plan = await this._api("PUT", "/api/week-plan",
        { week_start: this._weekIso(), lunch, dinners, adjust_list: false });
      this._applyPlan(plan);
      return plan;
    }

    _suggest(extra, dinners) {
      return this._api("POST", "/api/week-plan/suggest", {
        week_start: this._weekIso(), lunch: this._lunch(), dinners: dinners || this._dinners(), ...extra,
      });
    }

    /** Führt eine Änderung aus: Zeile sperren, Meldung zeigen, danach neu laden. */
    async _run(key, fn) {
      if (this._busy.has(key) || this._busy.has("plan")) return;
      this._busy.add(key);
      this._render();
      try {
        const result = await fn();
        if (result) this._toast(typeof result === "string" ? result : result.text, result.kind);
      } catch (err) {
        this._toast(errText(err), "err");
      } finally {
        this._busy.delete(key);
        this._render();
        this._load();
      }
    }

    _toast(text, kind) {
      clearTimeout(this._msgTimer);
      this._msg = { text, kind: kind || "ok" };
      this._msgTimer = setTimeout(() => {
        this._msg = null;
        this._render();
      }, 5000);
      this._render();
    }

    _isBusy(key) {
      return this._busy.has("plan") || this._busy.has(key);
    }

    // ---------- Anzeige ----------

    _render() {
      if (!this._wrap) return;
      if (this._drag) {
        this._renderPending = true;
        return;
      }
      this._wrap.className = `wrap${this._narrow ? " narrow" : ""}`;
      this._wrap.innerHTML = this._html();
    }

    _html() {
      let h = this._config.title ? `<div class="title">${esc(this._config.title)}</div>` : "";
      h += this._headHtml();
      if (this._msg) h += `<div class="msg ${esc(this._msg.kind)}" role="status">${esc(this._msg.text)}</div>`;
      if (!this._loaded) {
        h += `<div class="state">Lade Einkaufsapp …</div>`;
      } else if (this._error && !this._plan && !this._leftovers) {
        h += `<div class="state err"><b>Einkaufsapp nicht erreichbar</b><div class="detail">${esc(this._error)}</div>`
          + (this._hasEntity ? "" : `<div class="detail">Der Sensor ${esc(this._config.stand_entity)} fehlt – ist die Integration eingerichtet?</div>`)
          + `<button class="plain" data-act="retry">Erneut versuchen</button></div>`;
      } else {
        h += this._tabsHtml();
        if (this._tab === "mittag") h += this._lunchHtml();
        else if (this._tab === "abend") h += this._dinnerHtml();
        else h += this._leftoversHtml();
      }
      h += this._footHtml();
      return h;
    }

    _headHtml() {
      const { week, year } = isoWeek(this._week);
      const current = this._weekIso() === isoDate(mondayOf(today()));
      const busy = this._busy.has("plan") || !this._plan;
      return `<div class="head">
        <div class="week">${current ? "Aktuelle Woche" : "Woche"}: <b>KW ${week} / ${year}</b></div>
        <div class="nav">
          <button class="nb" data-act="week" data-d="-1" title="Vorige Woche" aria-label="Vorige Woche">‹</button>
          <button class="nb txt" data-act="week" data-d="0" ${current ? "disabled" : ""}>Diese Woche</button>
          <button class="nb" data-act="week" data-d="1" title="Nächste Woche" aria-label="Nächste Woche">›</button>
        </div>
        <button class="gen" data-act="generate" ${busy ? "disabled" : ""}>Plan neu generieren</button>
      </div>`;
    }

    _tabsHtml() {
      const due = this._leftovers ? this._leftovers.due : 0;
      return `<div class="tabs" role="tablist">${Object.entries(TABS).map(([key, label]) => {
        const extra = key === "reste" && due ? `<span class="due" title="fällig">${due}</span>` : "";
        return `<button class="chip${this._tab === key ? " on" : ""}" role="tab" aria-selected="${this._tab === key}" data-act="tab" data-tab="${key}">${label}${extra}</button>`;
      }).join("")}</div>`;
    }

    _lunchHtml() {
      if (!this._plan) return `<div class="state">Lade Wochenplan …</div>`;
      const todayIso = isoDate(today());
      const rows = this._plan.days.map((day, i) => {
        const key = `d${i}`;
        const busy = this._isBusy(key);
        const dis = busy ? "disabled" : "";
        const has = Boolean(day.recipe_id);
        const cls = ["row", day.date < todayIso ? "past" : "", day.date === todayIso ? "today" : "", busy ? "busy" : ""].join(" ");
        const dish = has
          ? `<button class="dish" data-act="pick-lunch" data-day="${i}" ${dis}>${esc(day.recipe)}</button>`
          : `<button class="dish empty" data-act="pick-lunch" data-day="${i}" ${dis}>– kein Gericht –</button>`;
        const book = `<button class="sq${day.booked ? " on" : ""}" data-act="book-lunch" data-day="${i}" ${has && !busy ? "" : "disabled"}
            title="${day.booked ? "Als Rest eingebucht – nochmal einbuchen" : "Als Rest einbuchen"}" aria-label="Als Rest einbuchen">${ICON.jar}${day.booked ? '<i class="tick">✓</i>' : ""}</button>`;
        const pick = `<button class="sq" data-act="pick-lunch" data-day="${i}" ${dis} title="Gericht auswählen" aria-label="Gericht auswählen">${ICON.list}</button>`;
        const roll = `<button class="sq" data-act="roll-lunch" data-day="${i}" ${dis} title="Neu würfeln" aria-label="Neu würfeln">${ICON.dice}</button>`;
        const clear = `<button class="sq red" data-act="clear-lunch" data-day="${i}" ${has && !busy ? "" : "disabled"} title="Tag leeren" aria-label="Tag leeren">${ICON.close}</button>`;
        let btns;
        let strip = "";
        if (this._narrow) {
          const open = this._menu === key;
          btns = pick + book + `<button class="sq${open ? " on" : ""}" data-act="menu" data-key="${key}" ${dis} title="Mehr" aria-label="Mehr" aria-expanded="${open}">${ICON.dots}</button>`;
          if (open) {
            strip = `<div class="strip">
              <button class="plain" data-act="roll-lunch" data-day="${i}" ${dis}>${ICON.dice}Neu würfeln</button>
              <button class="plain red-text" data-act="clear-lunch" data-day="${i}" ${has && !busy ? "" : "disabled"}>${ICON.close}Tag leeren</button>
            </div>`;
          }
        } else {
          btns = pick + roll + book + clear;
        }
        const weekday = this._narrow ? DAYS_SHORT[i] : DAYS[i];
        return `<div class="${cls}" data-day="${i}">
          <span class="grip${has ? "" : " off"}" data-grip="${i}" title="Ziehen zum Tauschen" aria-hidden="true">⋮⋮</span>
          <div class="when"><span class="wd">${weekday}</span><span class="date">${shortDate(day.date)}</span></div>
          ${dish}<div class="btns">${btns}</div>${strip}
        </div>`;
      });
      return `<div class="rows">${rows.join("")}</div>`;
    }

    _dinnerHtml() {
      if (!this._plan) return `<div class="state">Lade Wochenplan …</div>`;
      const rows = this._plan.dinners.map((dinner) => {
        const key = `n${dinner.recipe_id}`;
        const busy = this._isBusy(key);
        const dis = busy ? "disabled" : "";
        const id = dinner.recipe_id;
        const name = `<button class="dish${dinner.done ? " done" : ""}" data-act="dinner-done" data-id="${id}" ${dis}
            aria-pressed="${dinner.done}" title="${dinner.done ? "Als offen markieren" : "Als gegessen abhaken"}">${esc(dinner.recipe)}</button>`;
        const roll = `<button class="sq" data-act="roll-dinner" data-id="${id}" ${dis} title="Neu würfeln" aria-label="Neu würfeln">${ICON.dice}</button>`;
        const book = `<button class="sq" data-act="book-dinner" data-id="${id}" ${dis} title="Als Rest einbuchen" aria-label="Als Rest einbuchen">${ICON.jar}</button>`;
        const remove = `<button class="sq red" data-act="remove-dinner" data-id="${id}" ${dis} title="Entfernen" aria-label="Entfernen">${ICON.close}</button>`;
        let btns;
        let strip = "";
        if (this._narrow) {
          const open = this._menu === key;
          btns = book + `<button class="sq${open ? " on" : ""}" data-act="menu" data-key="${key}" ${dis} title="Mehr" aria-label="Mehr" aria-expanded="${open}">${ICON.dots}</button>`;
          if (open) {
            strip = `<div class="strip">
              <button class="plain" data-act="roll-dinner" data-id="${id}" ${dis}>${ICON.dice}Neu würfeln</button>
              <button class="plain red-text" data-act="remove-dinner" data-id="${id}" ${dis}>${ICON.close}Entfernen</button>
            </div>`;
          }
        } else {
          btns = roll + book + remove;
        }
        return `<div class="row dinner${busy ? " busy" : ""}">${name}<div class="btns">${btns}</div>${strip}</div>`;
      });
      this._plan.rest_dinners.forEach((rest, index) => {
        const key = `r${rest.leftover_id}`;
        const busy = this._isBusy(key);
        const dis = busy ? "disabled" : "";
        const gone = !rest.available && !rest.done ? ` <span class="sub">(aufgebraucht)</span>` : "";
        rows.push(`<div class="row dinner${busy ? " busy" : ""}">
          <button class="dish${rest.done ? " done" : ""}" data-act="rest-done" data-index="${index}" ${dis}
            aria-pressed="${rest.done}" title="${rest.done ? "Als offen markieren" : "Als gegessen abhaken"}">${esc(rest.name)} <span class="sub">· Rest</span>${gone}</button>
          <div class="btns"><button class="sq red" data-act="remove-rest" data-id="${rest.leftover_id}" ${dis} title="Aus dem Plan nehmen" aria-label="Aus dem Plan nehmen">${ICON.close}</button></div>
        </div>`);
      });
      const empty = rows.length ? "" : `<div class="empty-note">Noch keine Abendessen geplant.</div>`;
      return `<div class="rows">${rows.join("")}</div>${empty}
        <div class="bar"><button class="add" data-act="add-dinner" ${this._isBusy("add") ? "disabled" : ""}>+ Abendessen</button></div>`;
    }

    _leftoversHtml() {
      const items = this._leftovers ? this._leftovers.items : [];
      let h = `<div class="bar" style="margin:0 0 4px"><button class="add" data-act="left-new">+ Rest einbuchen</button></div>`;
      for (const [place, label] of Object.entries(PLACES)) {
        const list = items.filter((item) => item.place === place);
        h += `<div class="group">${label} (${list.length})</div>`;
        if (!list.length) {
          h += `<div class="empty-note">Nichts da.</div>`;
          continue;
        }
        h += `<div class="rows">${list.map((item) => {
          const key = `l${item.id}`;
          const busy = this._isBusy(key);
          const dis = busy ? "disabled" : "";
          const [text, color] = expiry(item);
          const planned = item.planned ? `<span class="tag">eingeplant</span>` : "";
          return `<div class="row left${busy ? " busy" : ""}">
            <button class="dish lname" data-act="left-edit" data-id="${item.id}" ${dis} title="Bearbeiten">${esc(item.name)}<span class="exp ${color}">${esc(text)}</span>${planned}</button>
            <div class="btns portions">
              <button class="sq" data-act="left-step" data-id="${item.id}" data-d="-0.5" ${dis} title="Eine halbe Portion weniger" aria-label="Weniger">−</button>
              <span class="pv" title="Portionen">${num(item.portions)}</span>
              <button class="sq" data-act="left-step" data-id="${item.id}" data-d="0.5" ${dis} title="Eine halbe Portion mehr" aria-label="Mehr">+</button>
              <button class="sq" data-act="left-edit" data-id="${item.id}" ${dis} title="Bearbeiten" aria-label="Bearbeiten">${ICON.pencil}</button>
            </div>
          </div>`;
        }).join("")}</div>`;
      }
      return h;
    }

    _footHtml() {
      const parts = [];
      if (this._loaded && !this._hasEntity && !this._error) {
        parts.push(`<span>${esc(this._config.stand_entity)} fehlt – keine Aktualisierung von außen</span>`);
      }
      if (typeof this._app === "string" && /^https?:\/\//i.test(this._app)) {
        parts.push(`<a href="${esc(this._app)}" target="_blank" rel="noopener noreferrer">In der App öffnen ↗</a>`);
      }
      return parts.length ? `<div class="foot">${parts.join("")}</div>` : "";
    }

    // ---------- Bedienung ----------

    _onClick(e) {
      if (e.target === this._dlgEl) { // Klick auf den Hintergrund
        this._closeDialog();
        return;
      }
      const el = e.target.closest ? e.target.closest("[data-act]") : null;
      const inDialog = e.target.closest ? Boolean(e.target.closest("dialog")) : false;
      if (this._menu && !inDialog && !(el && el.dataset.act === "menu")) { // „⋯“-Menü schließt bei jedem anderen Klick
        this._menu = null;
        this._render();
      }
      if (!el || el.disabled) return;
      const act = el.dataset.act;
      const day = Number(el.dataset.day);
      const id = Number(el.dataset.id);

      switch (act) {
        case "retry":
          this._loaded = false;
          this._render();
          this._load();
          break;
        case "tab":
          this._tab = el.dataset.tab;
          this._render();
          break;
        case "week":
          this._shiftWeek(Number(el.dataset.d));
          break;
        case "generate":
          this._run("plan", () => this._generate());
          break;
        case "menu":
          this._menu = this._menu === el.dataset.key ? null : el.dataset.key;
          this._render();
          break;
        case "pick-lunch":
          this._openDialog({ kind: "pick", mode: "lunch", day, q: "", rate: null });
          this._render();
          break;
        case "roll-lunch":
          this._run(`d${day}`, async () => {
            const result = await this._suggest({ day });
            await this._savePlan(result.lunch, result.dinners);
            const recipe = this._recipe(result.lunch[day]);
            return recipe ? `${DAYS[day]}: ${recipe.name}` : null;
          });
          break;
        case "clear-lunch":
          this._run(`d${day}`, async () => {
            const lunch = this._lunch();
            lunch[day] = null;
            await this._savePlan(lunch, this._dinners());
          });
          break;
        case "book-lunch": {
          const d = this._plan.days[day];
          this._openDialog({ kind: "book", title: `Als Rest einbuchen · ${DAYS[day]}`, name: d.recipe || "",
            week: this._weekIso(), target: { day }, key: `d${day}` });
          this._render();
          break;
        }
        case "dinner-done": {
          const dinner = this._plan.dinners.find((x) => x.recipe_id === id);
          if (!dinner) break;
          this._run(`n${id}`, async () => {
            this._applyPlan(await this._api("POST", "/api/week-plan/dinner-done",
              { week_start: this._weekIso(), recipe_id: id, done: !dinner.done }));
          });
          break;
        }
        case "rest-done": {
          const rest = this._plan.rest_dinners[Number(el.dataset.index)];
          if (!rest) break;
          this._run(`r${rest.leftover_id}`, async () => {
            this._applyPlan(await this._api("POST", "/api/week-plan/rest-dinner-done",
              { week_start: this._weekIso(), leftover_id: rest.leftover_id, done: !rest.done }));
          });
          break;
        }
        case "roll-dinner":
          this._run(`n${id}`, async () => {
            const index = this._dinners().indexOf(id);
            const result = await this._suggest({ dinner: id });
            await this._savePlan(result.lunch, result.dinners);
            const recipe = this._recipe(result.dinners[index]);
            return recipe ? `Abendessen: ${recipe.name}` : null;
          });
          break;
        case "book-dinner": {
          const dinner = this._plan.dinners.find((x) => x.recipe_id === id);
          this._openDialog({ kind: "book", title: "Abendessen als Rest einbuchen", name: dinner ? dinner.recipe : "",
            week: this._weekIso(), target: { dinner: id }, key: `n${id}` });
          this._render();
          break;
        }
        case "remove-dinner":
          this._run(`n${id}`, async () => {
            await this._savePlan(this._lunch(), this._dinners().filter((x) => x !== id));
          });
          break;
        case "remove-rest":
          this._run(`r${id}`, async () => {
            this._applyPlan(await this._api("POST", "/api/week-plan/rest-dinner/remove",
              { week_start: this._weekIso(), leftover_id: id }));
          });
          break;
        case "add-dinner":
          this._openDialog({ kind: "pick", mode: "dinner", q: "", rate: null });
          this._render();
          break;
        case "left-step":
          this._run(`l${id}`, async () => {
            this._applyLeftovers(await this._api("POST", `/api/leftovers/${id}/portions`, { delta: Number(el.dataset.d) }));
          });
          break;
        case "left-edit": {
          const item = (this._leftovers.items || []).find((x) => x.id === id);
          if (item) this._openDialog({ kind: "edit", item: { ...item }, key: `l${id}` });
          break;
        }
        case "left-new":
          this._openDialog({ kind: "book", title: "Rest einbuchen", name: "", target: null, key: "newrest" });
          break;
        // ----- im Dialog -----
        case "dlg-close":
          this._closeDialog();
          break;
        case "choose":
          this._choose(id);
          break;
        case "choose-none":
          this._chooseNone();
          break;
        case "choose-random":
          this._chooseRandom();
          break;
        case "choose-rest":
          this._chooseRest(id);
          break;
        case "rate-open":
          if (this._dlg) {
            this._dlg.rate = this._dlg.rate === id ? null : id;
            this._renderPickList();
          }
          break;
        case "rate-set":
          this._rate(id, Number(el.dataset.v));
          break;
        case "step":
          this._step(Number(el.dataset.step));
          break;
        case "delete":
          this._deleteLeftover(el);
          break;
        default:
          break;
      }
    }

    _shiftWeek(delta) {
      this._week = delta === 0 ? mondayOf(today()) : addDays(this._week, 7 * delta);
      this._plan = null;
      this._menu = null;
      this._render();
      this._load();
    }

    async _generate() {
      const lunch = this._lunch();
      const dinners = this._dinners();
      const first = Math.min(Math.max(dayDiff(this._week, today()), 0), 7);
      const lunchFull = lunch.slice(first).every(Boolean);
      const dinnerFull = dinners.length + this._plan.rest_dinners.length >= DINNER_TARGET;
      if (lunchFull && dinnerFull) return "Alles schon geplant.";
      const result = await this._suggest({});
      const changed = !sameList(result.lunch, lunch) || !sameList(result.dinners, dinners);
      if (changed) await this._savePlan(result.lunch, result.dinners);
      if (result.missing > 0) {
        const n = result.missing;
        return { text: `${n} ${n === 1 ? "Platz blieb" : "Plätze blieben"} frei – nicht genug passende Rezepte`, kind: "warn" };
      }
      return changed ? "Plan generiert." : "Alles schon geplant.";
    }

    // ---------- Ziehen zum Tauschen (Maus und Touch) ----------

    _onPointerDown(e) {
      const grip = e.target.closest ? e.target.closest(".grip") : null;
      if (!grip || (e.button !== undefined && e.button > 0) || this._tab !== "mittag" || !this._plan) return;
      const from = Number(grip.dataset.grip);
      if (!this._plan.days[from] || !this._plan.days[from].recipe_id || this._busy.size) return;
      const row = grip.closest(".row");
      e.preventDefault();
      this._drag = { from, row, startY: e.clientY, over: null, pointer: e.pointerId };
      row.classList.add("drag");
      window.addEventListener("pointermove", this._onMove);
      window.addEventListener("pointerup", this._onUp);
      window.addEventListener("pointercancel", this._onCancel);
    }

    _dragMove(e) {
      const drag = this._drag;
      if (!drag || e.pointerId !== drag.pointer) return;
      e.preventDefault();
      drag.row.style.transform = `translateY(${e.clientY - drag.startY}px)`;
      const hit = this.shadowRoot.elementFromPoint(e.clientX, e.clientY);
      const target = hit && hit.closest ? hit.closest(".row[data-day]") : null;
      const over = target && target !== drag.row ? Number(target.dataset.day) : null;
      if (over !== drag.over) {
        this._wrap.querySelectorAll(".row.over").forEach((r) => r.classList.remove("over"));
        if (target && over !== null) target.classList.add("over");
        drag.over = over;
      }
    }

    _dragEnd(e, drop) {
      const drag = this._drag;
      if (!drag || (e && e.pointerId !== drag.pointer)) return;
      window.removeEventListener("pointermove", this._onMove);
      window.removeEventListener("pointerup", this._onUp);
      window.removeEventListener("pointercancel", this._onCancel);
      drag.row.classList.remove("drag");
      drag.row.style.transform = "";
      this._wrap.querySelectorAll(".row.over").forEach((r) => r.classList.remove("over"));
      this._drag = null;
      const pending = this._renderPending;
      this._renderPending = false;
      const { from, over: to } = drag;
      if (drop && to !== null && to !== from && this._plan) {
        this._run("plan", async () => {
          const lunch = this._lunch();
          [lunch[from], lunch[to]] = [lunch[to], lunch[from]];
          await this._savePlan(lunch, this._dinners());
          return `${DAYS[from]} und ${DAYS[to]} getauscht.`;
        });
      } else if (pending) {
        this._render();
      }
    }

    // ---------- Dialoge ----------

    _openDialog(state) {
      this._dlg = state;
      this._renderDialog();
      const dialog = this._dlgEl;
      if (!dialog.open) {
        try {
          dialog.showModal();
        } catch (err) {
          dialog.setAttribute("open", "");
        }
      }
      const fine = window.matchMedia && window.matchMedia("(pointer: fine)").matches;
      const focus = state.kind === "pick" ? (fine ? dialog.querySelector("input") : null)
        : dialog.querySelector(state.kind === "book" && !state.name ? "input[name=name]" : ".primary");
      if (focus) focus.focus();
    }

    _closeDialog() {
      if (this._dlgEl.open) this._dlgEl.close();
      this._dlg = null;
    }

    /** Nach dem Neuladen: nur die Liste im Auswahldialog auffrischen, Eingabefelder bleiben unberührt. */
    _refreshDialog() {
      if (this._dlg && this._dlg.kind === "pick") this._renderPickList();
    }

    _renderDialog() {
      const d = this._dlg;
      if (!d) return;
      if (d.kind === "pick") {
        const title = d.mode === "lunch"
          ? `Mittagessen · ${DAYS[d.day]}, ${this._plan ? shortDate(this._plan.days[d.day].date) : ""}`
          : "Abendessen hinzufügen";
        this._dlgEl.innerHTML = `<div class="dlg-in">
          <div class="dlg-head"><h3>${esc(title)}</h3><button type="button" class="x" data-act="dlg-close" aria-label="Schließen">${ICON.close}</button></div>
          <input type="search" class="search" placeholder="Suchen …" autocomplete="off" aria-label="Rezept suchen">
          <div class="dlg-err" hidden></div>
          <div class="list"></div>
        </div>`;
        this._renderPickList();
      } else if (d.kind === "book") {
        this._dlgEl.innerHTML = `<form class="dlg-in" novalidate>
          <div class="dlg-head"><h3>${esc(d.title)}</h3><button type="button" class="x" data-act="dlg-close" aria-label="Schließen">${ICON.close}</button></div>
          <label class="field"><span>Name</span><input type="text" name="name" maxlength="150" value="${esc(d.name)}" autocomplete="off"></label>
          ${this._portionsField(1, 0.5)}
          ${this._placeField("kuehlschrank")}
          <label class="field"><span>Haltbar bis <small>(leer = automatisch: Kühlschrank 3 Tage, Gefrierschrank 90 Tage)</small></span>
            <input type="date" name="expires"></label>
          <div class="dlg-err" hidden></div>
          <div class="dlg-foot"><button type="button" class="plain" data-act="dlg-close">Abbrechen</button><button type="submit" class="plain primary">Einbuchen</button></div>
        </form>`;
      } else if (d.kind === "edit") {
        const item = d.item;
        this._dlgEl.innerHTML = `<form class="dlg-in" novalidate>
          <div class="dlg-head"><h3>Rest bearbeiten</h3><button type="button" class="x" data-act="dlg-close" aria-label="Schließen">${ICON.close}</button></div>
          <label class="field"><span>Name</span><input type="text" name="name" maxlength="150" value="${esc(item.name)}" autocomplete="off"></label>
          ${this._portionsField(item.portions, 0)}
          ${this._placeField(item.place)}
          <label class="field"><span>Haltbar bis</span><input type="date" name="expires" value="${esc(item.expires_on)}"></label>
          <div class="hint">Gekocht am ${esc(shortDate(item.cooked_on))}${item.planned ? " · als Abendessen eingeplant" : ""}. 0 Portionen = aufgebraucht.</div>
          <div class="dlg-err" hidden></div>
          <div class="dlg-foot">
            <button type="button" class="plain danger left" data-act="delete">Löschen</button>
            <button type="button" class="plain" data-act="dlg-close">Abbrechen</button>
            <button type="submit" class="plain primary">Speichern</button>
          </div>
        </form>`;
      }
    }

    _portionsField(value, min) {
      return `<div class="field"><span>Portionen</span><div class="stepper">
        <button type="button" class="sq" data-act="step" data-step="-0.5" aria-label="Weniger">−</button>
        <input type="number" name="portions" step="0.5" min="${min}" max="${MAX_PORTIONS}" inputmode="decimal" value="${esc(value)}" aria-label="Portionen">
        <button type="button" class="sq" data-act="step" data-step="0.5" aria-label="Mehr">+</button>
      </div></div>`;
    }

    _placeField(current) {
      return `<div class="field"><span>Ort</span><div class="seg">${Object.entries(PLACES).map(([value, label]) =>
        `<label><input type="radio" name="place" value="${value}" ${value === current ? "checked" : ""}><span>${label}</span></label>`).join("")}
      </div></div>`;
    }

    _renderPickList() {
      const d = this._dlg;
      const list = this._dlgEl.querySelector(".list");
      if (!d || d.kind !== "pick" || !list) return;
      const q = d.q.trim().toLowerCase();
      const match = (name) => !q || String(name).toLowerCase().includes(q);
      const type = d.mode === "lunch" ? "Mittagessen" : "Abendessen";
      const recipes = (this._recipes || []).filter((r) => r.type === type && match(r.name));
      const current = d.mode === "lunch" && this._plan ? this._plan.days[d.day].recipe_id : null;
      const inPlan = new Set(this._plan ? this._dinners() : []);
      let h = `<button type="button" class="pick special" data-act="choose-random">🎲 Zufällig</button>`;
      if (d.mode === "lunch") h += `<button type="button" class="pick special" data-act="choose-none">– kein Gericht –</button>`;
      if (d.mode === "dinner") h += `<div class="lgroup">Rezepte</div>`;
      h += recipes.map((r) => {
        const stars = r.rating ? `<span class="stars" aria-label="${r.rating} Sterne">${"★".repeat(r.rating)}</span>` : "";
        const veggie = r.veggie ? `<span class="muted" title="vegetarisch">🌱</span>` : "";
        const planned = d.mode === "dinner" && inPlan.has(r.id) ? `<span class="muted">· im Plan</span>` : "";
        const cur = r.id === current || (d.mode === "dinner" && inPlan.has(r.id));
        let row = `<div class="item"><button type="button" class="pick${cur ? " cur" : ""}" data-act="choose" data-id="${r.id}">
          <span>${esc(r.name)}</span>${stars}${veggie}${planned}</button>
          <button type="button" class="rate-btn${r.rating ? " has" : ""}" data-act="rate-open" data-id="${r.id}" title="Bewerten" aria-label="${esc(r.name)} bewerten">${r.rating ? "★" : "☆"}</button></div>`;
        if (d.rate === r.id) {
          row += `<div class="rate">Bewerten:${[1, 2, 3, 4, 5].map((v) =>
            `<button type="button" class="${r.rating && v <= r.rating ? "on" : ""}" data-act="rate-set" data-id="${r.id}" data-v="${v}" aria-label="${v} Sterne">★</button>`).join("")}</div>`;
        }
        return row;
      }).join("");
      if (!recipes.length) h += `<div class="empty-note">Kein passendes Rezept.</div>`;
      if (d.mode === "dinner") {
        const rests = (this._leftovers ? this._leftovers.items : []).filter((x) => !x.planned && match(x.name));
        h += `<div class="lgroup">Reste</div>`;
        h += rests.map((x) => {
          const [text, color] = expiry(x);
          return `<div class="item"><button type="button" class="pick" data-act="choose-rest" data-id="${x.id}">
            <span>${esc(x.name)}</span><span class="exp ${color}">${esc(text)}</span>
            <span class="muted">${esc(PLACES[x.place] || x.place)} · ${num(x.portions)} P.</span></button></div>`;
        }).join("") || `<div class="empty-note">Keine freien Reste.</div>`;
      }
      const scroll = list.scrollTop;
      list.innerHTML = h;
      list.scrollTop = scroll;
    }

    _onInput(e) {
      if (e.target.classList && e.target.classList.contains("search") && this._dlg) {
        this._dlg.q = e.target.value;
        this._dlg.rate = null;
        this._renderPickList();
      }
    }

    _onKey(e) {
      if (e.key === "Enter" && e.target.classList && e.target.classList.contains("search")) {
        e.preventDefault();
        const first = this._dlgEl.querySelector(".list [data-act=choose], .list [data-act=choose-rest]");
        if (first) first.click();
      }
    }

    _dlgError(text) {
      const box = this._dlgEl.querySelector(".dlg-err");
      if (!box) return;
      box.textContent = text || "";
      box.hidden = !text;
    }

    _choose(id) {
      const d = this._dlg;
      if (!d || !this._plan) return;
      this._closeDialog();
      if (d.mode === "lunch") {
        this._run(`d${d.day}`, async () => {
          const lunch = this._lunch();
          lunch[d.day] = id;
          await this._savePlan(lunch, this._dinners());
        });
      } else {
        if (this._dinners().includes(id)) {
          this._toast("Dieses Abendessen steht schon im Plan.", "warn");
          return;
        }
        this._run("add", async () => {
          await this._savePlan(this._lunch(), [...this._dinners(), id]);
        });
      }
    }

    _chooseNone() {
      const d = this._dlg;
      if (!d || !this._plan) return;
      this._closeDialog();
      this._run(`d${d.day}`, async () => {
        const lunch = this._lunch();
        lunch[d.day] = null;
        await this._savePlan(lunch, this._dinners());
      });
    }

    _chooseRandom() {
      const d = this._dlg;
      if (!d || !this._plan) return;
      this._closeDialog();
      if (d.mode === "lunch") {
        this._run(`d${d.day}`, async () => {
          const result = await this._suggest({ day: d.day });
          await this._savePlan(result.lunch, result.dinners);
          const recipe = this._recipe(result.lunch[d.day]);
          return recipe ? `${DAYS[d.day]}: ${recipe.name}` : null;
        });
        return;
      }
      // Abendessen: Die App würfelt nur vorhandene Abendessen neu. Darum einen zufälligen Platzhalter anhängen und ihn
      // von der App ersetzen lassen; findet sie nichts anderes Passendes, bleibt der Platzhalter.
      this._run("add", async () => {
        const dinners = this._dinners();
        const pool = (this._recipes || []).filter((r) => r.type === "Abendessen" && !dinners.includes(r.id));
        if (!pool.length) throw new Error("Es gibt kein weiteres Abendessen.");
        const placeholder = pool[Math.floor(Math.random() * pool.length)].id;
        let result;
        try {
          result = await this._suggest({ dinner: placeholder }, [...dinners, placeholder]);
        } catch (err) {
          result = { lunch: this._lunch(), dinners: [...dinners, placeholder] };
        }
        await this._savePlan(result.lunch, result.dinners);
        const recipe = this._recipe(result.dinners[result.dinners.length - 1]);
        return recipe ? `Abendessen: ${recipe.name}` : null;
      });
    }

    _chooseRest(leftoverId) {
      this._closeDialog();
      this._run("add", async () => {
        this._applyPlan(await this._api("POST", "/api/week-plan/rest-dinner",
          { week_start: this._weekIso(), leftover_id: leftoverId }));
      });
    }

    async _rate(id, value) {
      const recipe = this._recipe(id);
      if (!recipe) return;
      const rating = recipe.rating === value ? null : value;
      try {
        await this._api("PUT", `/api/recipes/${id}/rating`, { rating });
        recipe.rating = rating;
        if (this._dlg) this._dlg.rate = null;
        this._dlgError("");
        this._renderPickList();
        this._toast(rating ? `„${recipe.name}“: ${rating} ${rating === 1 ? "Stern" : "Sterne"}` : `Bewertung von „${recipe.name}“ gelöscht`);
      } catch (err) {
        this._dlgError(errText(err));
      }
    }

    _step(delta) {
      const input = this._dlgEl.querySelector("input[name=portions]");
      if (!input) return;
      const min = Number(input.min) || 0;
      const value = parseNum(input.value);
      const next = Math.round(((Number.isFinite(value) ? value : 1) + delta) * 2) / 2;
      input.value = String(Math.min(MAX_PORTIONS, Math.max(min, next)));
    }

    _formValues() {
      const form = this._dlgEl.querySelector("form");
      const name = form.querySelector("input[name=name]").value.trim();
      const portions = parseNum(form.querySelector("input[name=portions]").value);
      const placeInput = form.querySelector("input[name=place]:checked");
      const expires = form.querySelector("input[name=expires]").value;
      return { name, portions, place: placeInput ? placeInput.value : "kuehlschrank", expires };
    }

    _submitDialog() {
      const d = this._dlg;
      if (!d || (d.kind !== "book" && d.kind !== "edit")) return;
      const v = this._formValues();
      if (!v.name) return this._dlgError("Bitte einen Namen eingeben.");
      const min = d.kind === "book" ? 0.5 : 0;
      if (!Number.isFinite(v.portions) || v.portions < min || v.portions > MAX_PORTIONS) {
        return this._dlgError(`Bitte ${num(min)} bis ${MAX_PORTIONS} Portionen angeben.`);
      }
      if (d.kind === "book") {
        const body = { name: v.name, portions: v.portions, place: v.place };
        if (v.expires) body.expires_on = v.expires;
        if (d.target && d.target.day !== undefined) Object.assign(body, { week_start: d.week, day: d.target.day });
        if (d.target && d.target.dinner !== undefined) Object.assign(body, { week_start: d.week, dinner_recipe_id: d.target.dinner });
        this._closeDialog();
        this._run(d.key, async () => {
          const result = await this._api("POST", "/api/leftovers", body);
          this._applyLeftovers(result && result.leftovers);
          if (result && result.plan) this._applyPlan(result.plan);
          return `„${v.name}“ eingebucht (${num(v.portions)} ${v.portions === 1 ? "Portion" : "Portionen"}, ${PLACES[v.place]})`;
        });
        return;
      }
      const item = d.item;
      const patch = {};
      if (v.name !== item.name) patch.name = v.name;
      if (Math.abs(v.portions - item.portions) > 1e-9) patch.portions = v.portions;
      if (v.place !== item.place) patch.place = v.place;
      if (v.expires && v.expires !== item.expires_on) patch.expires_on = v.expires;
      this._closeDialog();
      if (!Object.keys(patch).length) return;
      this._run(d.key, async () => {
        this._applyLeftovers(await this._api("PATCH", `/api/leftovers/${item.id}`, patch));
        return patch.portions === 0 ? `„${item.name}“ ist aufgebraucht.` : `„${v.name}“ gespeichert.`;
      });
    }

    _deleteLeftover(button) {
      const d = this._dlg;
      if (!d || d.kind !== "edit") return;
      if (!button.classList.contains("sure")) {
        button.classList.add("sure");
        button.textContent = "Wirklich löschen?";
        return;
      }
      const item = d.item;
      this._closeDialog();
      this._run(d.key, async () => {
        this._applyLeftovers(await this._api("DELETE", `/api/leftovers/${item.id}`));
        return `„${item.name}“ gelöscht.`;
      });
    }
  }

  if (!customElements.get(CARD)) {
    customElements.define(CARD, EinkaufsappCard);
  }
  window.customCards = window.customCards || [];
  if (!window.customCards.some((card) => card.type === CARD)) {
    window.customCards.push({
      type: CARD,
      name: "Einkaufsapp",
      description: "Wochenplan (Mittag und Abend) und Reste aus der Einkaufsapp: wählen, würfeln, tauschen, einbuchen.",
      preview: false,
    });
  }
})();
