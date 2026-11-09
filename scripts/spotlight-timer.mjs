const ID = "player-spotlight-timer";
const DEFAULT_LAYOUT = { x: 120, y: 80, pinned: false, docked: false, dockTo: "controls", vpos: "below", hgrow: "right" };

const L = (key, data) => game.i18n.format(`SPOTLIGHT.${key}`, data ?? {});
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fmt = s => {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
};

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
}
const icon = cls => h("i", { class: cls });

class SpotlightTimer {
  constructor() {
    this.layout = { ...DEFAULT_LAYOUT, ...game.settings.get(ID, "layout") };
    this.timers = foundry.utils.deepClone(game.settings.get(ID, "timers"));
    this.timers.acc ??= {};
    this.hover = false;
    this.settingsOpen = false;
    this.dragging = false;
    this.saveTimers = foundry.utils.debounce(() => game.settings.set(ID, "timers", this.timers), 400);
    this.saveLayout = foundry.utils.debounce(() => game.settings.set(ID, "layout", this.layout), 400);
    this.build();
    this.interval = setInterval(() => this.refresh(), 1000);
    window.addEventListener("resize", () => this.position());
  }

  /* ---------- data ---------- */
  get warn() { return game.settings.get(ID, "warnMinutes") * 60; }
  get max() { return game.settings.get(ID, "maxMinutes") * 60; }
  get players() { return game.users.filter(u => u.active && !u.isGM); }
  get elapsed() { return this.timers.running ? (Date.now() - this.timers.since) / 1000 : 0; }
  get revealed() { return this.hover || this.settingsOpen || this.dragging; }

  // Each player's idle time = acc[id] + time elapsed in the current running stretch.
  idle(id) {
    if (!(id in this.timers.acc)) this.timers.acc[id] = -this.elapsed;
    return this.timers.acc[id] + this.elapsed;
  }
  level(t) { return t >= this.max ? 2 : t >= this.warn ? 1 : 0; }

  toggleRunning() {
    const t = this.timers;
    if (t.running) {
      const e = this.elapsed;
      for (const k in t.acc) t.acc[k] += e;
      t.running = false;
    } else {
      t.running = true;
      t.since = Date.now();
    }
    this.saveTimers();
    this.refresh();
  }
  resetPlayer(id) {
    this.timers.acc[id] = -this.elapsed;
    this.saveTimers();
    this.refresh();
  }
  resetAll() {
    for (const u of this.players) this.timers.acc[u.id] = -this.elapsed;
    this.saveTimers();
    this.refresh();
  }
  setLayout(patch) {
    Object.assign(this.layout, patch);
    this.saveLayout();
    this.build();
  }

  /* ---------- DOM ---------- */
  dockMenu() {
    return this.layout.dockTo === "sidebar"
      ? document.querySelector("#sidebar-tabs menu") ?? document.querySelector("#sidebar-tabs")
      : document.querySelector("#scene-controls-layers") ?? document.querySelector("#scene-controls menu");
  }

  destroyDom() {
    this.root?.remove();
    this.dockLi?.remove();
    this.root = this.dockLi = this.dockBtn = null;
  }

  build() {
    this.destroyDom();
    this.mode = this.layout.docked && this.dockMenu() ? "docked" : "floating";
    this.chips = h("div", { class: "st-chips" });
    this.bar = this.buildBar();
    this.settings = this.buildSettings();

    if (this.mode === "floating") {
      const widget = h("div", { class: "st-widget" }, h("div", { class: "st-stack" }, this.bar, this.chips), this.settings);
      this.root = h("div", { id: "spotlight-timer", class: "st-root st-floating" }, widget);
      this.bindHover(widget);
    } else {
      this.root = h("div", { id: "spotlight-timer", class: `st-root st-flyout st-dock-${this.layout.dockTo}` },
        // Chips sit level with the dock icon; with no chips shown, the bar takes that row.
        h("div", { class: "st-stack" }, this.chips, this.bar), this.settings);
      this.bindHover(this.root);
    }
    document.body.append(this.root);
    if (this.mode === "docked") this.ensureDock();
    this.buildChips();
  }

  ensureDock() {
    if (!this.layout.docked) return;
    if (this.mode !== "docked") return this.build();
    const menu = this.dockMenu();
    if (!menu) return;
    if (this.dockLi?.isConnected && menu.contains(this.dockLi)) return this.position();
    this.dockLi?.remove();
    this.dockBtn = h("button", {
      type: "button",
      class: "st-dock-btn ui-control icon fa-solid fa-hourglass-half",
      "data-tooltip": L("Title"),
      "aria-label": L("Title"),
      onClick: () => { this.hover = !this.hover; this.refresh(); }
    });
    this.dockLi = h("li", { class: "st-dock-li" }, this.dockBtn);
    menu.append(this.dockLi);
    this.bindHover(this.dockBtn);
    this.refresh();
  }

  bindHover(el) {
    el.addEventListener("mouseenter", () => {
      clearTimeout(this._leave);
      if (!this.hover) { this.hover = true; this.refresh(); }
    });
    el.addEventListener("mouseleave", () => {
      clearTimeout(this._leave);
      this._leave = setTimeout(() => { this.hover = false; this.refresh(); }, 200);
    });
  }

  buildBar() {
    const btn = (cls, title, fn, extra = "") =>
      h("button", { type: "button", class: `st-btn ${extra}`, "data-tooltip": title, "aria-label": title, onClick: fn }, icon(cls));
    this.playBtn = btn("fa-solid fa-play", L("Resume"), () => this.toggleRunning());
    const reset = btn("fa-solid fa-arrow-rotate-left", L("ResetAll"), () => this.resetAll());
    const gear = btn("fa-solid fa-gear", L("Configure"), () => { this.settingsOpen = !this.settingsOpen; this.refresh(); }, "st-plain");

    if (this.mode === "docked") {
      const undock = btn("fa-solid fa-up-right-from-square", L("Undock"), () => this.setLayout({ docked: false }));
      return h("div", { class: "st-bar st-panel" }, this.playBtn, reset, undock, gear);
    }

    this.grip = h("div", { class: "st-grip", "data-tooltip": L("Drag") }, icon("fa-solid fa-grip-vertical"));
    this.grip.addEventListener("pointerdown", e => this.startDrag(e));
    this.pinBtn = btn("fa-solid fa-thumbtack", L("Pin"), () => this.setLayout({ pinned: !this.layout.pinned }));
    const toSidebar = this.layout.dockTo === "sidebar";
    const dock = btn("fa-solid fa-right-to-bracket", toSidebar ? L("DockSidebar") : L("DockControls"),
      () => { this.settingsOpen = false; this.hover = false; this.setLayout({ docked: true }); }, toSidebar ? "" : "st-flip");
    const extras = h("div", { class: "st-extras" }, h("span", { class: "st-sep" }), this.pinBtn, dock, gear);
    return h("div", { class: "st-bar st-panel" }, this.grip, this.playBtn, reset, extras);
  }

  buildChips() {
    if (!this.chips) return;
    this.chipEls = new Map();
    this.order = "";
    this.chips.replaceChildren();
    for (const u of this.players) {
      const time = h("span", { class: "st-time" });
      const color = u.color?.css ?? u.color ?? "#999";
      const el = h("button", {
        type: "button", class: "st-chip",
        "data-tooltip": L("ResetPlayer", { name: u.name }),
        onClick: () => this.resetPlayer(u.id)
      }, h("span", { class: "st-dot", style: `background:${color}` }), h("span", { class: "st-name" }, u.name), time);
      this.chipEls.set(u.id, { el, time });
    }
    this.refresh();
  }

  buildSettings() {
    const num = key => {
      const input = h("input", { type: "number", min: "0.5", step: "0.5", value: game.settings.get(ID, key) });
      input.addEventListener("change", () => {
        const v = parseFloat(input.value);
        if (v > 0) game.settings.set(ID, key, v);
      });
      return h("div", { class: "st-num" }, input, h("span", {}, L("Minutes")));
    };
    const seg = (key, opts) => h("div", { class: "st-seg" }, opts.map(([val, ic, label]) =>
      h("button", {
        type: "button",
        class: `st-seg-btn${this.layout[key] === val ? " st-active" : ""}`,
        onClick: () => this.setLayout({ [key]: val })
      }, icon(ic), h("span", {}, label))));
    const field = (label, control, hint) => h("div", { class: "st-field" },
      h("div", { class: "st-field-row" }, h("label", {}, label), control),
      hint ? h("p", { class: "st-hint" }, hint) : null);

    const fields = [
      field([h("span", { class: "st-swatch st-swatch-warn" }), L("WarnAfter")], num("warnMinutes"), L("WarnHint")),
      field([h("span", { class: "st-swatch st-swatch-over" }), L("Maximum")], num("maxMinutes"), L("MaxHint"))
    ];
    if (this.mode === "floating") {
      fields.push(
        field(L("ChipsPos"), seg("vpos", [["below", "fa-solid fa-arrow-down", L("Below")], ["above", "fa-solid fa-arrow-up", L("Above")]])),
        field(L("Grow"), seg("hgrow", [["left", "fa-solid fa-arrow-left", L("Left")], ["right", "fa-solid fa-arrow-right", L("Right")]]))
      );
    }
    fields.push(field(L("DockTo"), seg("dockTo", [["controls", "fa-solid fa-screwdriver-wrench", L("Tools")], ["sidebar", "fa-solid fa-table-columns", L("Sidebar")]])));

    const close = h("button", { type: "button", class: "st-btn st-plain", "aria-label": L("Close"),
      onClick: () => { this.settingsOpen = false; this.refresh(); } }, icon("fa-solid fa-xmark"));
    return h("section", { class: "st-settings st-panel", hidden: true },
      h("header", { class: "st-settings-head" }, icon("fa-solid fa-hourglass-half"), h("span", {}, L("Title")), close),
      h("div", { class: "st-settings-body" }, fields));
  }

  startDrag(ev) {
    if (this.layout.pinned || ev.button !== 0) return;
    ev.preventDefault();
    const sx = ev.clientX, sy = ev.clientY, ox = this.layout.x, oy = this.layout.y;
    this.dragging = true;
    this.root.classList.add("st-dragging");
    const move = e => {
      this.layout.x = clamp(ox + e.clientX - sx, 0, window.innerWidth);
      this.layout.y = clamp(oy + e.clientY - sy, 0, window.innerHeight);
      this.position();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      this.dragging = false;
      this.root?.classList.remove("st-dragging");
      this.saveLayout();
      this.refresh();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  }

  /* ---------- render loop ---------- */
  refresh() {
    if (!this.root) return;
    const players = this.players;
    if (players.length !== this.chipEls?.size || players.some(u => !this.chipEls.has(u.id))) return this.buildChips();

    const rows = players.map(u => { const t = this.idle(u.id); return { id: u.id, t, lvl: this.level(t) }; })
      .sort((a, b) => b.t - a.t);
    const top = Math.max(0, ...rows.map(r => r.lvl));
    const reveal = this.revealed;

    let anyVisible = false;
    for (const r of rows) {
      const c = this.chipEls.get(r.id);
      c.time.textContent = fmt(r.t);
      c.el.classList.toggle("st-warn", r.lvl === 1);
      c.el.classList.toggle("st-over", r.lvl === 2);
      c.el.hidden = !(reveal || r.lvl > 0);
      anyVisible ||= !c.el.hidden;
    }
    // Only touch DOM order when it actually changes, so clicks aren't interrupted.
    const order = rows.map(r => r.id).join();
    if (order !== this.order) {
      this.order = order;
      for (const r of rows) this.chips.append(this.chipEls.get(r.id).el);
    }
    this.chips.hidden = !anyVisible;

    const cl = this.root.classList;
    cl.toggle("st-hover", reveal);
    cl.toggle("st-revealed", reveal || top > 0);
    cl.toggle("st-lvl-warn", top === 1);
    cl.toggle("st-lvl-over", top === 2);
    this.root.style.setProperty("--st-idle-opacity", game.settings.get(ID, "idleOpacity"));

    const running = this.timers.running;
    this.playBtn.firstChild.className = running ? "fa-solid fa-pause" : "fa-solid fa-play";
    this.playBtn.dataset.tooltip = running ? L("Pause") : L("Resume");
    if (this.pinBtn) {
      this.pinBtn.classList.toggle("st-active", this.layout.pinned);
      this.pinBtn.dataset.tooltip = this.layout.pinned ? L("Unpin") : L("Pin");
      this.grip.hidden = this.layout.pinned;
    }
    this.settings.hidden = !this.settingsOpen;

    if (this.dockBtn) {
      this.dockBtn.classList.toggle("st-lvl-warn", top === 1);
      this.dockBtn.classList.toggle("st-lvl-over", top === 2);
      this.dockBtn.classList.toggle("active", reveal);
    }
    this.position();
  }

  position() {
    if (!this.root) return;
    if (this.mode === "floating") {
      const { x, y, vpos, hgrow } = this.layout;
      this.root.style.left = `${x}px`;
      this.root.style.top = `${y}px`;
      this.root.classList.toggle("st-above", vpos === "above");
      this.root.classList.toggle("st-left", hgrow === "left");
      // Settings open on the side away from the chips, unless there isn't room.
      const up = vpos === "above" ? window.innerHeight - y < 380 : y >= 380;
      this.root.classList.toggle("st-settings-up", up);
    } else if (this.dockBtn?.isConnected) {
      const r = this.dockBtn.getBoundingClientRect();
      this.root.style.top = `${r.top}px`;
      // Docked buttons match the dock icon's size so the row lines up with it.
      this.root.style.setProperty("--st-dock-size", `${r.height}px`);
      if (this.layout.dockTo === "sidebar") {
        this.root.style.left = "";
        this.root.style.right = `${window.innerWidth - r.left + 6}px`;
      } else {
        this.root.style.right = "";
        this.root.style.left = `${r.right + 6}px`;
      }
    }
  }
}

/* ---------- hooks ---------- */
Hooks.once("init", () => {
  const refresh = () => game.spotlightTimer?.refresh();
  game.settings.register(ID, "warnMinutes", {
    name: "SPOTLIGHT.Settings.Warn", hint: "SPOTLIGHT.Settings.WarnHint",
    scope: "world", config: true, type: Number, default: 10, onChange: refresh
  });
  game.settings.register(ID, "maxMinutes", {
    name: "SPOTLIGHT.Settings.Max", hint: "SPOTLIGHT.Settings.MaxHint",
    scope: "world", config: true, type: Number, default: 20, onChange: refresh
  });
  game.settings.register(ID, "idleOpacity", {
    name: "SPOTLIGHT.Settings.Opacity", hint: "SPOTLIGHT.Settings.OpacityHint",
    scope: "client", config: true, type: Number, default: 0.2,
    range: { min: 0.05, max: 1, step: 0.05 }, onChange: refresh
  });
  game.settings.register(ID, "layout", { scope: "client", config: false, type: Object, default: DEFAULT_LAYOUT });
  game.settings.register(ID, "timers", { scope: "client", config: false, type: Object, default: { running: false, since: 0, acc: {} } });
});

Hooks.once("ready", () => {
  if (!game.user.isGM) return;
  game.spotlightTimer = new SpotlightTimer();
});

Hooks.on("userConnected", () => game.spotlightTimer?.buildChips());
Hooks.on("updateUser", () => game.spotlightTimer?.buildChips());
Hooks.on("renderSceneControls", () => game.spotlightTimer?.ensureDock());
Hooks.on("renderSidebar", () => game.spotlightTimer?.ensureDock());
Hooks.on("collapseSidebar", () => setTimeout(() => game.spotlightTimer?.position(), 50));
