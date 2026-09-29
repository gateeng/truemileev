// TrueMile EV — the public page: theme, splash, and the 3D carousel of app screens.
// No outside dependency; every icon below is drawn inline for the same reason. Loaded as a module:
// whether the watch and Android Auto are marked "soon" comes from lib/launch.js (both ship on launch day).

import { LAUNCH } from "./lib/launch.js";

(function () {
  const $  = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ── theme: the system's, with the clock only as a fallback ────────────────────────────
  // No switch and nothing remembered - the browser already knows what the reader wants, and every
  // phone flips itself at sunset. The clock only answers for a browser that states no preference at
  // all (06:00-18:00 light, dark after), which is the rare case, not the rule.
  function clockTheme() {
    const h = new Date().getHours();
    return (h >= 6 && h < 18) ? "light" : "dark";
  }
  function systemTheme() {
    if (window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
    if (window.matchMedia("(prefers-color-scheme: light)").matches) return "light";
    return null;
  }
  let theme = systemTheme() || clockTheme();
  document.documentElement.setAttribute("data-theme", theme);
  // Follow the system live, and redraw the screens so they follow with it.
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", e => {
    theme = e.matches ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", theme);
    build();
  });

  // ── the six (plus Auto), in the app's own bottom-bar order and its own colours ─────────────
  const SCREENS = [
    {
      key: "board", label: "Board", color: "var(--c-board)",
      headline: "One screen, every number",
      lede: "A glance tells you what the car actually costs you — every mile, every kilowatt-hour, every dollar, day by day and drive by drive.",
      detail: "Cost per mile and cost per kWh come from what you actually paid for the energy, charge by charge, at the price on the day. Lifetime sits next to this month — total spent, savings against gas, mi/kWh and MPGe, average speed, drive count, the energy regen handed back, what climate control took — and your last drives sit underneath. Nothing here is typed in; it's measured off the car and added up.",
      bullets: ["Cost per mile from what you paid", "Lifetime and monthly totals side by side", "Regen recovered and climate cost, measured"],
    },
    {
      key: "charge", label: "Charge", color: "var(--c-charge)",
      headline: "Every charge, accounted for",
      lede: "Watch the energy land in real time, then keep the receipt for good.",
      detail: "Plugged in, the screen follows power, energy delivered and state of charge as they climb; unplugged, it sits idle and waits. When the session ends you get the summary — kWh delivered, what it cost, the rate, the charge you arrived and left with, how long you stood there. Open any past session and its own power curve is there, sampled from your car while it charged, not copied off a spec sheet.",
      bullets: ["Live power, energy and charge state", "Cost, rate and duration per session", "Every session's own power curve"],
    },
    {
      key: "live", label: "Live", color: "var(--c-live)",
      headline: "The drive, as it happens",
      lede: "See what your right foot costs you at the moment it costs it.",
      detail: "The power gauge swings up under acceleration and falls through zero into regen, so energy going out and energy coming back are one continuous motion. Around it sit speed, state of charge, range, pack and cabin temperature and 12-volt health — and you choose which readouts fill the tiles, because what matters on a mountain pass isn't what matters in traffic. It all comes straight off the adapter, live; when the link drops the gauge falls to zero instead of holding a stale number.",
      bullets: ["Power gauge reads acceleration and regen", "Choose which readouts fill the tiles", "Pack, cabin and 12-volt health"],
    },
    {
      key: "map", label: "Map", color: "var(--c-map)",
      headline: "Where you are, where you're going",
      lede: "Where you've been is drawn on the map; where you can get to is planned on what your car actually does.",
      detail: "Three faces on one map: the charge locations you've really used, past trips drawn along the roads you actually took, and navigation with your saved places. Plan a route and the stops are sized from your measured range in today's conditions and your car's own charging curve. It tells you where you'd stop, for how long, and what charge you'd arrive with, before you pull out of the driveway.",
      bullets: ["Charge locations you've actually used", "Past trips drawn as you drove them", "Stops and arrival charge, planned ahead"],
    },
    {
      key: "report", label: "Report", color: "var(--c-report)",
      headline: "Proof you can hand over",
      lede: "When someone wants the driving in writing — an accountant, a client, you next April — it's already written.",
      detail: "Filter by vehicle, category and date range, and the totals for that window come back with the drives behind them. Export the list as CSV, the period as a PDF, or business mileage as a PDF that carries its own verification page. Every row is a drive the app recorded while it was happening, so the total isn't a claim — it's a sum.",
      bullets: ["Filter by vehicle, category, date range", "CSV, period PDF, mileage PDF", "Business report with verification page"],
    },
    {
      key: "wear", label: "Wear", color: "var(--c-wear)", soon: LAUNCH.watchSoon,
      headline: "Your car, on your wrist",
      lede: "What the car knows shouldn't be stuck in a phone at the bottom of a bag.",
      detail: "The Wear OS app shows what the phone knows: battery and range, today's drives and what they cost, and your lifetime totals. Plug in and it turns into a charging face with the charge climbing; park, and Find My Car points you back to where the car stopped. A tile and a watch-face complication keep the numbers a glance away. It comes from Google Play with the phone app, and it is part of Max.",
      bullets: ["Battery and range on your wrist", "The charge in progress", "Find My Car", "A tile and a complication"],
    },
    {
      key: "auto", label: "Auto", color: "var(--c-auto)", soon: LAUNCH.autoSoon,
      headline: "Android Auto",
      lede: "Find a charger and watch the charge, on the car's own screen.",
      detail: "With your phone on Android Auto, TrueMile lists charging locations near you and the places you have bookmarked. Open one for the station's details, and a tap starts navigation, without picking up the phone. While the truck charges, the car shows the charge live: rate, energy received and battery. A Max feature.",
      bullets: ["Charging locations", "Bookmarks", "Station details", "Navigation", "The live charging screen"],
    },
  ];

  // ── icons (inline; nothing loads from anywhere) ────────────────────────────────────────────
  const ICON = {
    board: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    charge: '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/>',
    live: '<path d="M12 21a9 9 0 1 1 9-9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 12l5-3" fill="none" stroke="currentColor" stroke-width="2"/>',
    map: '<path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z"/>',
    report: '<rect x="3" y="12" width="4" height="9" rx="1"/><rect x="10" y="7" width="4" height="14" rx="1"/><rect x="17" y="3" width="4" height="18" rx="1"/>',
    wear: '<rect x="7" y="6" width="10" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 6V3h6v3M9 18v3h6v-3" fill="none" stroke="currentColor" stroke-width="2"/>',
    auto: '<path d="M5 16V11l2-5h10l2 5v5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="8" cy="16" r="2"/><circle cx="16" cy="16" r="2"/><path d="M3 16h18" fill="none" stroke="currentColor" stroke-width="2"/>',
    gear: '<path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm8.4 5-.1-3 2-1.6-2-3.4-2.4 1a8 8 0 0 0-2.6-1.5L15 2.5h-4l-.4 2.5A8 8 0 0 0 8 6.5l-2.4-1-2 3.4 2 1.6a8 8 0 0 0 0 3l-2 1.6 2 3.4 2.4-1a8 8 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a8 8 0 0 0 2.6-1.5l2.4 1 2-3.4-2-1.6z"/>',
    chev: '<path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2"/>',
  };
  const svg = (k, cls) =>
    `<svg viewBox="0 0 24 24" fill="currentColor" class="${cls || ""}" aria-hidden="true">${ICON[k]}</svg>`;

  // ── real screenshots, when they are there ──────────────────────────────────────────────────
  // assets/shots/<key>-<theme>.png, e.g. board-dark.png. A missing file falls back to the drawn
  // screen below, so the page never shows a broken image and dropping a PNG in is the whole job.
  // Charge and Map take -1/-2/-3 suffixes for their several faces.
  const shot = (key, i) => {
    const n = (i === undefined || i === null) ? "" : "-" + (i + 1);
    return `assets/shots/${key}${n}-${theme}.png`;
  };
  // The drawn screen shows FIRST and the photo hides it once it has actually loaded - the other way
  // round leaves an empty frame for as long as the 404 takes.
  //
  // Charge and Map cycle through several faces, so they look for charge-2-dark.png first and fall
  // back to a plain charge-dark.png: one screenshot per screen is enough, and per-face files are
  // only worth taking if he wants each face to be its own photo.
  //
  // A path that 404s is remembered, because the centred screen re-renders every few seconds as it
  // cycles and an unremembered miss would fetch the same missing file again on every tick.
  // [paths] replaces the per-theme names for a screen that has one fixed capture (the car's).
  const missing = new Set();
  const framed = (key, i, drawn, cls, paths) => `
    <img class="shot" alt="" loading="lazy" data-try="${(paths || [shot(key, i), shot(key, null)]).join("|")}">
    <div class="fallback ${cls || "screen"}">${drawn}</div>`;

  // A phone frame takes the shape of the screenshot it shows. The captures are 540 wide but of
  // different heights (the tour crops the status bar and, on some screens, more), and a fixed frame
  // left a strip under the shorter ones that lifted the app's bottom bar off the frame's bottom edge
  // (owner 9/29). Fitted, the frame is the picture plus the bezel, so the bottom bar sits on the
  // bottom edge. Which files have loaded is remembered: Charge and Map re-render every few seconds
  // as they cycle, and a known file fits the new frame before the (cached) image even reports in.
  const loaded = new Set();
  function fit(img, path) {
    if (!loaded.has(path)) return;
    const phone = img.closest(".phone");
    if (phone) phone.classList.add("fit");
    const f = img.parentNode.querySelector(".fallback");
    if (f) f.style.display = "none";
  }

  function wireShots(root) {
    $$(".shot", root).forEach(img => {
      const paths = img.dataset.try.split("|").filter((p, i, a) => a.indexOf(p) === i && !missing.has(p));
      if (!paths.length) { img.remove(); return; }
      let at = 0;
      img.onload = () => { loaded.add(paths[at]); fit(img, paths[at]); };
      img.onerror = () => {
        missing.add(paths[at]);
        if (++at < paths.length) img.src = paths[at]; else img.remove();
      };
      fit(img, paths[0]);
      img.src = paths[0];
    });
  }

  // ── the drawn screens (the fallback, and what shows until screenshots land) ────────────────
  // The app's own bottom bar: the connection bolt on the left, the five labelled tabs with the current
  // one in its colour's pill, the Settings gear on the right - so a drawn screen (Live, until its
  // capture lands) reads like the photographed ones.
  const TAB = { board: "Board", charge: "Charge", live: "Live", map: "Map", report: "Report" };
  const navbar = (on) => `<div class="navbar">` +
    `<span class="nb-end">${svg("charge")}</span>` +
    Object.keys(TAB).map(k => `<span class="nb-tab${k === on ? " on" : ""}" style="--c:var(--c-${k})">` +
      `${svg(k)}<i>${TAB[k]}</i></span>`).join("") +
    `<span class="nb-end">${svg("gear")}</span></div>`;

  const inner = (on, body) => `
      <div class="status"><span>7:04</span><span>5G</span></div>
      <div class="body">${body}</div>
      ${navbar(on)}`;

  const phone = (key, sub, on, body) =>
    `<div class="phone">${framed(key, sub, inner(on, body))}</div>`;

  const tile = (k, v, cls) => `<div class="t"><div class="k">${k}</div><div class="v ${cls || ""}">${v}</div></div>`;
  const liveTile = (k, v, cls, id) => `<div class="t"><div class="k">${k}</div><div class="v ${cls || ""}" data-n="${id}">${v}</div></div>`;

  const BODY = {
    board: () => `
      <div class="g2">
        ${liveTile("cost / mile", "$0.141", "green", "cpm")}
        ${liveTile("mi / kWh", "2.46", "cyan", "eff")}
        ${liveTile("total spent", "$1,533", "", "spent")}
        ${liveTile("saved", "$981", "green", "saved")}
      </div>
      <div class="g3">
        ${liveTile("drives", "485", "", "trips")}
        ${liveTile("charged", "4,944", "cyan", "kwh")}
        ${liveTile("MPGe", "83", "", "mpge")}
      </div>
      <div class="t"><div class="k">last drive</div>
        <div class="listrow"><span>09/17 19:11</span><span class="cyan" data-n="last">177.1 mi</span></div>
        <div class="listrow"><span>09/17 12:19</span><span class="cyan">14.6 mi</span></div>
      </div>`,
    charge: [
      () => `<div class="t"><div class="k">charging now</div><div class="v cyan" data-n="kw">48.2 kW</div></div>
        <div class="bar-s"><i style="width:62%"></i></div>
        <div class="g2">${liveTile("charge", "62%", "cyan", "soc")}${liveTile("added", "31.4 kWh", "", "added")}</div>
        <div class="g2">${tile("rate", "$0.33/kWh")}${liveTile("cost", "$10.36", "", "cost")}</div>`,
      () => `<div class="t"><div class="k">plugged in</div><div class="v muted">idle</div></div>
        <div class="bar-s"><i style="width:80%"></i></div>
        <div class="g2">${tile("charge", "80%")}${tile("since", "12 min")}</div>
        <div class="t"><div class="k">waiting for power</div><div class="v muted" style="font-size:9px">the session resumes on its own</div></div>`,
      () => `<div class="t"><div class="k">session complete</div><div class="v green">54.8 kWh</div></div>
        <div class="g2">${tile("cost", "$18.11")}${tile("rate", "$0.331")}</div>
        <div class="g2">${tile("arrived", "18%")}${tile("left at", "82%")}</div>
        <div class="t"><div class="k">time</div><div class="v">41 min</div></div>`,
      () => `<div class="t"><div class="k">power curve</div>
          <svg viewBox="0 0 100 34" style="width:100%;height:34px">
            <polyline points="2,30 12,8 26,7 44,12 62,19 80,25 98,29" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--cyan)"/>
          </svg></div>
        <div class="g3">${tile("peak", "149 kW")}${tile("avg", "97 kW")}${tile("taper", "62%")}</div>
        <div class="listrow"><span>Electrify America</span><span>09/14</span></div>`,
    ],
    live: () => `
      <div style="display:flex;justify-content:center;padding:2px 0">
        <svg viewBox="0 0 100 100" style="width:98px;height:98px">
          <circle cx="50" cy="50" r="40" fill="none" stroke="var(--line)" stroke-width="9"
            stroke-dasharray="220 251" stroke-linecap="round" transform="rotate(112.5 50 50)"/>
          <circle cx="50" cy="50" r="40" fill="none" stroke="var(--blue)" stroke-width="9"
            stroke-dasharray="62 251" stroke-linecap="round" transform="rotate(-90 50 50)" data-n="accel"/>
          <text x="50" y="47" text-anchor="middle" fill="currentColor" font-size="20" font-weight="800" data-n="mph">62</text>
          <text x="50" y="61" text-anchor="middle" fill="var(--muted)" font-size="8">MPH</text>
        </svg>
      </div>
      <div class="g3">${liveTile("charge", "78%", "green", "lsoc")}${liveTile("range", "212 mi", "", "range")}${liveTile("power", "38 kW", "blue", "pw")}</div>
      <div class="g2">${tile("pack", "78 °F")}${tile("cabin", "70 °F")}</div>`,
    map: [
      () => `<div style="position:relative;flex:1;border-radius:9px;overflow:hidden">
        <div class="mapbg"></div>
        <span class="pin" style="background:var(--green);left:26%;top:30%"></span>
        <span class="pin" style="background:var(--green);left:62%;top:52%"></span>
        <span class="pin" style="background:var(--green);left:44%;top:71%"></span>
        <div style="position:absolute;left:6px;bottom:6px" class="t"><div class="k">charges here</div><div class="v green">86</div></div>
      </div>`,
      () => `<div style="position:relative;flex:1;border-radius:9px;overflow:hidden">
        <div class="mapbg"></div>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%">
          <polyline points="12,86 28,66 40,60 56,38 72,28 88,14" fill="none" stroke="var(--cyan)" stroke-width="3"/>
        </svg>
        <div style="position:absolute;left:6px;bottom:6px" class="t"><div class="k">this drive</div><div class="v cyan">177.1 mi</div></div>
      </div>`,
      () => `<div style="position:relative;flex:1;border-radius:9px;overflow:hidden">
        <div class="mapbg"></div>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%">
          <polyline points="50,92 50,58 62,40 62,8" fill="none" stroke="var(--green)" stroke-width="3"/>
        </svg>
        <div style="position:absolute;left:6px;right:6px;bottom:6px" class="t">
          <div class="k">work · arrival charge</div><div class="v green">68%</div></div>
      </div>`,
    ],
    report: () => `
      <div class="g3">
        <div class="t"><div class="k">vehicle</div><div class="v" style="font-size:8px">F-150</div></div>
        <div class="t"><div class="k">category</div><div class="v" style="font-size:8px">Business</div></div>
        <div class="t"><div class="k">range</div><div class="v" style="font-size:8px">Sep 10-17</div></div>
      </div>
      <div class="g3">${liveTile("drives", "28", "", "rtrips")}${liveTile("distance", "612 mi", "", "rmi")}${liveTile("cost", "$86.40", "green", "rcost")}</div>
      <div class="t"><div class="k">drives</div>
        <div class="listrow"><span>Sep 17 · 177.1 mi</span><span>$18.61</span></div>
        <div class="listrow"><span>Sep 16 · 23.5 mi</span><span>$3.17</span></div>
        <div class="listrow"><span>Sep 15 · 12.1 mi</span><span>$1.92</span></div>
      </div>
      <div class="row"><span class="t" style="flex:1;text-align:center"><span class="k cyan">CSV</span></span>
        <span class="t" style="flex:1;text-align:center"><span class="k cyan">PDF</span></span>
        <span class="t" style="flex:1;text-align:center"><span class="k cyan">MILEAGE</span></span></div>`,
  };

  const MOCK = {
    board:  () => phone("board", null, "board", BODY.board()),
    charge: BODY.charge.map((b, i) => () => phone("charge", i, "charge", b())),
    live:   () => phone("live", null, "live", BODY.live()),
    map:    BODY.map.map((b, i) => () => phone("map", i, "map", b())),
    report: () => phone("report", null, "report", BODY.report()),

    wear: () => `<div class="watch"><div class="face" style="position:relative;overflow:hidden">
        ${framed("wear", null, `
          <div style="font-size:27px;font-weight:800;color:var(--green)" data-n="wsoc">78%</div>
          <div style="font-size:9px;color:var(--muted)">212 mi est</div>
          <div style="height:1px;width:64px;background:var(--line);margin:5px 0"></div>
          <div style="font-size:11px;font-weight:700" data-n="wmi">14.6 mi</div>
          <div style="font-size:8px;color:var(--muted)">today</div>`,
          "screen")}
      </div></div>`,

    // The car's own screen, not a phone (owner 9/18). What ships on launch day is the production car
    // app (CAR_FULL_SCOPE=false): its menu is Charging Locations and Bookmarks, plus Charging while the
    // truck charges; the rows and their subtitles are auto/poi/PoiScreens.kt's. No live dashboard.
    // A Desktop Head Unit capture of that menu replaces the drawing once it is in assets/shots/
    // (shots/README.md: car-launch-menu.png).
    auto: () => `<div class="head"><div class="unit">
        <div class="vents"><i></i><i></i></div>
        <div class="display" style="margin-top:6px;position:relative">
          ${framed("auto", null, `
            <div class="hbar"><span class="aa-title">TrueMile</span></div>
            <div class="aa-list">
              <div class="aa-row"><span><b>Charging Locations</b><i>Chargers near you</i></span>${svg("chev")}</div>
              <div class="aa-row"><span><b>Bookmarks</b><i>Saved places</i></span>${svg("chev")}</div>
              <div class="aa-row"><span><b>Charging</b><i>Live rate, received and battery</i></span>${svg("chev")}</div>
            </div>`, "screen", ["assets/shots/car-launch-menu.png"])}
        </div>
      </div></div>`,
  };

  // ── build ──────────────────────────────────────────────────────────────────────────────────
  const ring = $("#ring"), nav = $("#appnav"), readout = $("#readout");
  const N = SCREENS.length;
  const step = 360 / N;
  let active = 0, radius = 240;
  const subIndex = {};

  function slideInner(s) {
    const m = MOCK[s.key];
    if (Array.isArray(m)) {
      const i = subIndex[s.key] || 0;
      return m[i]() + `<div class="dots">${m.map((_, j) =>
        `<i class="${j === i ? "on" : ""}"></i>`).join("")}</div>`;
    }
    return m();
  }

  function build() {
    const w = window.innerWidth < 640 ? 186 : 214;
    radius = Math.round(w / 2 / Math.tan(Math.PI / N)) + 34;
    ring.innerHTML = SCREENS.map((s, i) => `
      <div class="slide" data-key="${s.key}" style="transform:rotateY(${i * step}deg) translateZ(${radius}px)">
        ${slideInner(s)}
      </div>`).join("");
    wireShots(ring);
    nav.innerHTML = SCREENS.map((s, i) => `
      <button role="tab" aria-selected="${i === active}" data-i="${i}" style="--c:${s.color}"
              class="${s.soon ? "soon" : ""}" aria-label="${s.label}${s.soon ? ", coming soon" : ""}">
        ${svg(s.key)}<span>${s.label}</span>
      </button>`).join("");
    $$("#appnav button").forEach(b => b.onclick = () => select(Number(b.dataset.i)));
    turn();
    write();
  }

  function turn() {
    ring.style.transform = `translateZ(-${radius}px) rotateY(${-active * step}deg)`;
    $$(".slide", ring).forEach((el, i) => {
      const d = Math.min(Math.abs(i - active), N - Math.abs(i - active));
      el.dataset.far = d === 0 ? "0" : "1";
    });
  }

  function select(i) {
    active = ((i % N) + N) % N;
    $$("#appnav button").forEach(b => b.setAttribute("aria-selected", String(Number(b.dataset.i) === active)));
    turn();
    write();
  }

  // The write-up for whichever screen is at the front.
  function write() {
    const s = SCREENS[active];
    readout.innerHTML = `
      <div class="fade-in">
        <h2>${s.headline}</h2>
        <p class="lede">${s.lede}</p>
        <p class="detail">${s.detail}</p>
        <ul>${s.bullets.map(b => `<li>${b}</li>`).join("")}</ul>
      </div>`;
  }

  // ── the numbers move, but only on the screen you are looking at ────────────────────────────
  const jitter = (v, pct) => v * (1 + (Math.random() - 0.5) * pct);
  function tick() {
    const slide = $$(".slide", ring)[active];
    if (!slide) return;
    const set = (id, fn) => { const el = $(`[data-n="${id}"]`, slide); if (el) fn(el); };
    set("mph", el => el.textContent = Math.round(jitter(62, 0.22)));
    set("accel", el => el.setAttribute("stroke-dasharray", `${Math.round(jitter(62, 0.5))} 251`));
    set("pw", el => el.textContent = Math.round(jitter(38, 0.6)) + " kW");
    set("lsoc", el => el.textContent = (77 + Math.round(Math.random())) + "%");
    set("range", el => el.textContent = Math.round(jitter(212, 0.04)) + " mi");
    set("kw", el => el.textContent = jitter(48.2, 0.16).toFixed(1) + " kW");
    set("soc", el => el.textContent = Math.round(jitter(62, 0.06)) + "%");
    set("added", el => el.textContent = jitter(31.4, 0.05).toFixed(1) + " kWh");
    set("cost", el => el.textContent = "$" + jitter(10.36, 0.05).toFixed(2));
    set("cpm", el => el.textContent = "$" + jitter(0.141, 0.06).toFixed(3));
    set("eff", el => el.textContent = jitter(2.46, 0.05).toFixed(2));
    set("spent", el => el.textContent = "$" + Math.round(jitter(1533, 0.01)).toLocaleString("en-US"));
    set("saved", el => el.textContent = "$" + Math.round(jitter(981, 0.02)));
    set("trips", el => el.textContent = 480 + Math.round(Math.random() * 9));
    set("kwh", el => el.textContent = Math.round(jitter(4944, 0.004)).toLocaleString("en-US"));
    set("mpge", el => el.textContent = Math.round(jitter(83, 0.05)));
    set("rtrips", el => el.textContent = 24 + Math.round(Math.random() * 8));
    set("rmi", el => el.textContent = Math.round(jitter(612, 0.06)) + " mi");
    set("rcost", el => el.textContent = "$" + jitter(86.4, 0.06).toFixed(2));
    set("wsoc", el => el.textContent = (77 + Math.round(Math.random())) + "%");
    set("wmi", el => el.textContent = jitter(14.6, 0.08).toFixed(1) + " mi");
  }

  // Charge and Map hold several faces; they advance only while centred.
  function cycleSub() {
    const s = SCREENS[active];
    const m = MOCK[s.key];
    if (!Array.isArray(m)) return;
    subIndex[s.key] = ((subIndex[s.key] || 0) + 1) % m.length;
    const slide = $$(".slide", ring)[active];
    if (slide) { slide.innerHTML = slideInner(s); wireShots(slide); }
  }

  // ── splash — every load, tap to skip, never when motion is reduced ─────────────────────────
  // ── splash: the app's own, beat for beat ───────────────────────────────────────
  // Ported from ui/SplashScreen.kt (ElectronSplashScreen). 22 electrons bounce the full screen
  // while two colliders glide in from opposite edges and meet dead centre; white flash, the bolt
  // snaps on, the icon springs in, the wordmark rises. Every duration and colour below is the
  // Kotlin's, not an approximation:
  //   t=0      22 electrons, r 10-22px scaled by width, #00B0FF / #00E676 alternating,
  //            glow circle at 2.2r alpha .22 under a solid core
  //   t=1200   flash to alpha .85 over 90ms; bolt snaps to full opacity
  //   t=1400   electrons fade over 300ms; icon springs 0 -> 1; bolt fades over 220ms
  //   t=1580   name + tagline fade in over 700ms, rising 36px; icon pulses 1 -> 1.14 / 480ms
  //   t=3180   hand off
  const SPLASH = { collide: 1200, bolt: 200, name: 180, hold: 650 + 50 + 900 };

  function splash() {
    const el = $("#splash");
    if (!el) return;
    const close = () => { el.classList.add("gone"); stop = true; };
    if (reduced) { el.classList.add("gone"); return; }

    const cv = $("#splashCanvas"), ctx = cv && cv.getContext("2d");
    let stop = false;
    if (ctx) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = cv.width = Math.round(innerWidth * dpr);
      const h = cv.height = Math.round(innerHeight * dpr);
      cv.style.width = innerWidth + "px";
      cv.style.height = innerHeight + "px";
      const cx = w / 2, cy = h / 2;
      const s = Math.max(w / 1080, 0.7);        // the Kotlin's own width scale
      const rnd = Math.random;

      const parts = [];
      for (let i = 0; i < 22; i++) {
        const r = (10 + rnd() * 12) * s;
        const a = rnd() * Math.PI * 2;
        const spd = (0.34 + rnd() * 0.34) * Math.max(w / 1080, 0.65);
        parts.push({
          x: r + rnd() * (w - 2 * r), y: r + rnd() * (h - 2 * r),
          vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
          c: i % 2 === 0 ? "#00B0FF" : "#00E676", r: r, hit: false,
        });
      }
      // Two colliders, bearings 100°-260° apart, starting off-screen along them.
      const base = rnd() * Math.PI * 2;
      const sep = (100 + rnd() * 160) * Math.PI / 180;
      const L = Math.hypot(w, h) * 0.6;
      [base, base + sep].forEach((a, k) => {
        const sx = cx + L * Math.cos(a), sy = cy + L * Math.sin(a);
        parts.push({ x: sx, y: sy, sx: sx, sy: sy, r: 22 * s,
                     c: k === 0 ? "#00B0FF" : "#00E676", hit: true });
      });

      let t0 = 0, last = 0;
      const draw = (now) => {
        if (stop) return;
        if (!t0) { t0 = now; last = now; }
        const t = now - t0;
        const dt = Math.min(Math.max(now - last, 1), 40);
        last = now;
        ctx.clearRect(0, 0, w, h);
        for (const e of parts) {
          if (e.hit) {
            const p = Math.min(t / SPLASH.collide, 1);
            const ease = p * p * (3 - 2 * p);       // smoothstep, as in the Kotlin
            e.x = e.sx + (cx - e.sx) * ease;
            e.y = e.sy + (cy - e.sy) * ease;
          } else {
            e.x += e.vx * dt; e.y += e.vy * dt;
            if (e.x < e.r) { e.x = e.r; e.vx = -e.vx; }
            if (e.x > w - e.r) { e.x = w - e.r; e.vx = -e.vx; }
            if (e.y < e.r) { e.y = e.r; e.vy = -e.vy; }
            if (e.y > h - e.r) { e.y = h - e.r; e.vy = -e.vy; }
          }
          ctx.globalAlpha = 0.22;
          ctx.fillStyle = e.c;
          ctx.beginPath(); ctx.arc(e.x, e.y, e.r * 2.2, 0, 6.2832); ctx.fill();
          ctx.globalAlpha = 1;
          ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, 6.2832); ctx.fill();
        }
        if (t < SPLASH.collide + 400) requestAnimationFrame(draw);
      };
      requestAnimationFrame(draw);
    }

    const at = (ms, fn) => setTimeout(() => { if (!stop) fn(); }, ms);
    at(SPLASH.collide, () => el.classList.add("hit"));                       // flash + bolt
    at(SPLASH.collide + SPLASH.bolt, () => el.classList.add("icon"));        // icon springs in
    at(SPLASH.collide + SPLASH.bolt + SPLASH.name, () => el.classList.add("named"));
    at(SPLASH.collide + SPLASH.bolt + SPLASH.name + SPLASH.hold, close);

    el.addEventListener("click", close);
    document.addEventListener("keydown", close, { once: true });
  }

  // ── go ─────────────────────────────────────────────────────────────────────────────────────
  splash();
  build();


  document.addEventListener("keydown", e => {
    if (e.key === "ArrowRight") select(active + 1);
    if (e.key === "ArrowLeft")  select(active - 1);
  });
  let rt;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(build, 200); });

  if (!reduced) {
    setInterval(tick, 1400);
    setInterval(cycleSub, 3200);
  }
})();
