/* Grok Bot desk app (plan B). Plain JS, no framework, no build step.
   Data: public Supabase Storage under a secret path. The secret path is
   never in this file: it arrives once as #d=<path>, is saved to
   localStorage and the fragment is cleared. Every FOMO URL shown here is
   the exact string the desk wrote to the JSON (links.py); this file
   builds none. Read-only: settings, pause and mode change via Telegram. */
(function () {
  "use strict";

  const BASE = "https://udsmbgbgsnowsyxgpaos.supabase.co/storage/v1/object/public/desk/d/";
  const POLL_S = 15;
  const STALE_S = 90;
  const LS_D = "gb.d", LS_SEEN = "gb.seen";
  const AGENTS = ["scanner", "auditor", "analyst", "executor", "risk"];
  const NAMES = { scanner: "Scanner", auditor: "Auditor", analyst: "Analyst", executor: "Executor", risk: "Risk" };
  const COLORS = { scanner: "#64d2ff", auditor: "#0a84ff", analyst: "#ffd60a", executor: "#00d35a", risk: "#ff6b9a" };
  const LAYER_NAMES = ["Mint authority", "Freeze authority", "Dev wallet", "Top 10 holders", "Liquidity", "Pool age", "Bundles", "Delegations"];
  const RANGES = ["LIVE", "1H", "4H", "1D", "1W", "ALL"];
  const PUSH_KINDS = { bought: 1, sold: 1, stopped: 1, timeout: 1, trailed: 1, rejected: 1 };
  const reduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const S = {
    state: null, chart: null, activity: null,
    coins: {}, coinErr: {},
    lastOkTs: null, offline: false, loaded: false, noPath: false,
    nextPoll: 0, timer: 0, range: "LIVE",
    prevBal: null, auditShown: {}, auditRunning: {},
  };

  /* ---------- helpers ---------- */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fomo = (u) => (typeof u === "string" && u.indexOf("https://fomo.family/") === 0 ? u : null); // validate only, never build
  const num = (v) => (v == null || v === "" || isNaN(+v) ? null : +v);
  function usd(v, dp) {
    v = num(v); if (v == null) return "—";
    const s = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: dp == null ? 2 : dp, maximumFractionDigits: dp == null ? 2 : dp });
    return (v < 0 ? "-$" : "$") + s;
  }
  function compact(v) {
    v = num(v); if (v == null) return "n/a";
    const a = Math.abs(v);
    if (a >= 1e9) return "$" + (v / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return "$" + (v / 1e6).toFixed(2) + "M";
    if (a >= 1e3) return "$" + (v / 1e3).toFixed(1) + "K";
    return "$" + v.toFixed(2);
  }
  function price(v) {
    v = num(v); if (v == null) return "—";
    if (v === 0) return "$0";
    if (v >= 1) return "$" + v.toLocaleString("en-US", { maximumFractionDigits: 4 });
    const dp = Math.min(12, Math.max(2, -Math.floor(Math.log10(v)) + 3));
    return "$" + v.toFixed(dp);
  }
  function pct(v, signed) {
    v = num(v); if (v == null) return "—";
    return (signed && v > 0 ? "+" : "") + v.toFixed(2) + "%";
  }
  function hhmm(ts) {
    const t = Date.parse(ts); if (isNaN(t)) return "";
    return new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  }
  function hms(ts) {
    const t = typeof ts === "number" ? ts : Date.parse(ts); if (isNaN(t)) return "never";
    return new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  }
  function ageText(ts) {
    const t = Date.parse(ts); if (isNaN(t)) return null;
    const m = Math.max(0, (Date.now() - t) / 60000);
    if (m < 60) return Math.floor(m) + "m old";
    if (m < 48 * 60) return Math.floor(m / 60) + "h old";
    return Math.floor(m / 1440) + "d old";
  }
  const isoToTime = (s) => String(s || "").replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)/g, (m) => hhmm(m));
  const sign = (s) => { s = String(s || "").trim(); return s[0] === "+" ? "up" : (s[0] === "-" ? "down" : "muted"); };
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2600);
  }
  async function copy(text, msg) {
    try { await navigator.clipboard.writeText(text); toast(msg || "Copied"); }
    catch (_) { toast(text); }
  }
  const agentCard = (name) => ((S.state && S.state.agents) || []).find((a) => a.name === name) || null;
  const mode = () => String((S.state && S.state.mode) || "PAPER").toUpperCase();
  const paperPill = () => (mode() === "PAPER" ? '<span class="paper">PAPER</span>' : "");

  /* ---------- data path: #d= once, then localStorage ---------- */
  function takeFragment() {
    const h = location.hash || "";
    const m = h.match(/^#d=([^&]+)/);
    if (!m) return;
    let v = "";
    try { v = decodeURIComponent(m[1]); } catch (_) { v = ""; }
    if (/^[A-Za-z0-9_-]{32,128}$/.test(v)) savePath(v);
    history.replaceState(null, "", location.pathname + location.search + "#/home");
  }
  function savePath(v) { try { localStorage.setItem(LS_D, v); } catch (_) {} }
  // Accepts the whole private link or just the part after #d=
  function pastePath(raw) {
    raw = (raw || "").trim();
    const m = raw.match(/#d=([^&\s]+)/);
    let v = m ? m[1] : raw;
    try { v = decodeURIComponent(v); } catch (_) { return false; }
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(v)) return false;
    savePath(v); return true;
  }
  const dataPath = () => { try { return localStorage.getItem(LS_D); } catch (_) { return null; } };
  function dataUrl(file) {
    return BASE + encodeURIComponent(dataPath()) + "/" + file + "?t=" + Math.floor(Date.now() / 1000);
  }
  async function getJSON(file) {
    const r = await fetch(dataUrl(file), { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" });
    if (!r.ok) { const e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
    return r.json();
  }

  /* ---------- polling ---------- */
  async function poll() {
    clearTimeout(S.timer);
    if (!dataPath()) { S.noPath = true; S.loaded = true; render(); return; }
    S.noPath = false;
    try {
      const [st, ch, ac] = await Promise.all([getJSON("state.json"), getJSON("chart.json"), getJSON("activity.json")]);
      if (!st || typeof st !== "object" || !Array.isArray(st.agents)) throw new Error("bad state");
      S.state = st; S.chart = ch; S.activity = ac;
      S.lastOkTs = st.ts;
      const age = (Date.now() - Date.parse(st.ts)) / 1000;
      S.offline = !(age < STALE_S);
    } catch (e) {
      S.offline = true;
    }
    const m = routeMint();
    if (m && !S.offline) await loadCoin(m);
    S.loaded = true;
    S.nextPoll = Date.now() + POLL_S * 1000;
    render();
    S.timer = setTimeout(poll, POLL_S * 1000);
  }
  async function loadCoin(mint) {
    try { S.coins[mint] = await getJSON("coin/" + mint + ".json"); S.coinErr[mint] = null; }
    catch (e) { S.coinErr[mint] = e.status === 400 || e.status === 404 ? "missing" : "offline"; }
  }
  function bannerText() {
    const n = Math.max(0, Math.ceil((S.nextPoll - Date.now()) / 1000));
    return "Desk offline · retrying in " + n + "s · last update " + (S.lastOkTs ? hms(S.lastOkTs) : "never");
  }
  function banner() {
    if (S.noPath) return '<div class="banner offline-row" id="offline">No desk link on this phone yet · open your private link once</div>';
    return S.offline ? '<div class="banner offline-row" id="offline">' + esc(bannerText()) + "</div>" : "";
  }
  setInterval(() => { const b = $("#offline"); if (b && S.offline && !S.noPath) b.textContent = bannerText(); }, 1000);

  /* ---------- routing ---------- */
  function route() {
    const h = (location.hash || "#/home").replace(/^#\/?/, "");
    const [name, arg] = h.split("/");
    return { name: name || "home", arg: arg || null };
  }
  function routeMint() {
    const r = route();
    if (r.name === "coin") return r.arg;
    if (r.name === "audit") return r.arg || (S.state && S.state.audit_latest_mint) || null;
    return null;
  }
  const go = (h) => { location.hash = h; };
  window.addEventListener("hashchange", () => {
    if (/^#d=/.test(location.hash)) { takeFragment(); S.coins = {}; S.coinErr = {}; S.state = null; poll(); return; }
    const m = routeMint();
    render();
    window.scrollTo(0, 0);
    if (m && dataPath() && !S.coins[m]) loadCoin(m).then(render);
  });

  /* ---------- odometer ---------- */
  function odometer(value) {
    const s = usd(value);
    const prev = S.prevBal == null ? s : usd(S.prevBal);
    let html = "", k = 0;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      const pi = prev.length - (s.length - i);
      const pch = pi >= 0 ? prev[pi] : null;
      if (/\d/.test(ch)) {
        const from = pch && /\d/.test(pch) ? +pch : +ch;
        let col = "";
        for (let d = 0; d <= 9; d++) col += "<span>" + d + "</span>";
        html += '<span class="ch"><span class="col" data-from="' + from + '" data-to="' + ch + '" data-r="' + (s.length - 1 - i) + '" style="transform:translateY(' + (-from) + 'em)">' + col + "</span></span>";
      } else html += '<span class="ch">' + esc(ch) + "</span>";
      k++;
    }
    return '<span class="odo num" aria-label="' + esc(s) + '">' + html + "</span>";
  }
  function rollOdometer() {
    const cols = Array.from(document.querySelectorAll(".odo .col"));
    const changed = cols.filter((c) => c.dataset.from !== c.dataset.to).sort((a, b) => +a.dataset.r - +b.dataset.r);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      changed.forEach((c, i) => {
        if (reduced()) c.style.transition = "none";
        else c.style.transitionDelay = (i * 30) + "ms";
        c.style.transform = "translateY(" + (-c.dataset.to) + "em)";
      });
    }));
  }

  /* ---------- skeletons ---------- */
  const sk = (h, mt, w) => '<div class="sk" style="height:' + h + "px;margin-top:" + (mt || 0) + "px" + (w ? ";width:" + w : "") + '"></div>';
  function skHome() {
    return sk(66, 10, "70%") + sk(22, 12, "45%") + sk(240, 14) + sk(44, 8) + sk(28, 22, "50%") +
      '<div class="carousel" style="margin-top:10px"><div class="acard sk"></div></div>' + sk(28, 22, "50%") + sk(60, 10) + sk(60, 2) + sk(60, 2);
  }
  const skList = (n) => Array.from({ length: n }, (_, i) => sk(i ? 64 : 120, i ? 8 : 6)).join("");

  /* ---------- Home ---------- */
  function navHome() {
    const st = S.state || {};
    const h = (st.account && st.account.fomo_handle) || "";
    const ini = esc((h.replace(/^@/, "")[0] || "G").toUpperCase());
    const dot = unread() > 0 ? '<i class="dot"></i>' : "";
    return '<div class="nav"><button class="avatar" data-go="#/account" aria-label="Account"><span>' + ini + "</span></button>" +
      '<button class="brand" data-go="#/agents">Grok Bot<span class="chev">›</span></button>' +
      '<button class="iconbtn" id="searchbtn" aria-label="Search"><svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg></button>' +
      '<button class="iconbtn" id="bellbtn" aria-label="Notifications"><svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>' + dot + "</button></div>";
  }
  function unread() {
    const rows = (S.activity && S.activity.rows) || [];
    const seen = +(localStorage.getItem(LS_SEEN) || 0);
    return rows.filter((r) => PUSH_KINDS[r.kind] && +r.id > seen).length;
  }
  function markSeen() {
    const rows = (S.activity && S.activity.rows) || [];
    const max = Math.max(0, ...rows.map((r) => +r.id || 0));
    localStorage.setItem(LS_SEEN, String(max));
  }
  function markLabel(m) {
    const k = String(m.kind || "").toLowerCase();
    const v = String(m.value || "").split(/[·\/]/)[0].trim();
    if (k === "bought") return { text: m.title || ("Bought " + (m.name || "")), color: "#0a84ff" };
    if (k === "stopped" || /stop/.test(k)) {
      const p = String(m.subtitle || m.title || "").match(/-\d+(?:\.\d+)?%/);
      return { text: (p ? p[0] + " · " : "") + (v || ""), color: "#ff453a" };
    }
    if (!v) return null;
    return { text: v, color: v[0] === "-" ? "#ff453a" : "#00d35a" };
  }
  function viewHome() {
    if (!S.state) return navHome() + banner() + skHome();
    const st = S.state;
    const nb = num(st.night_start_balance) || num(st.starting_usd);
    const mult = nb ? num(st.balance) / nb : null;
    const today = num(st.today_pct);
    const running = (st.agents || []).filter((a) => !a.paused && a.status !== "stale" && a.status !== "error").length;
    const rows = activityRows().slice(0, 5);
    const rd = (S.chart && S.chart[S.range]) || { points: [], marks: [] };
    const empty = !rd.points || rd.points.length < 2;
    return navHome() + banner() +
      '<div class="balrow">' + odometer(st.balance) + paperPill() + "</div>" +
      '<div class="sub"><span class="' + (today == null ? "muted" : today >= 0 ? "up" : "down") + ' num">' + esc(pct(today, true)) + '</span><span class="muted">today</span>' +
      (mult != null ? '<span class="mult num">' + esc(mult.toFixed(2)) + "×</span>" : "") + "</div>" +
      '<div class="chartwrap"><canvas id="homechart"></canvas>' + (empty ? '<div class="chartempty">Waiting for the first trade</div>' : "") + "</div>" +
      '<div class="ranges">' + RANGES.map((r) => '<button data-range="' + r + '" class="' + (r === S.range ? "on" : "") + '">' + r + "</button>").join("") + "</div>" +
      '<div class="sechead"><h2>Agents <span class="muted">· ' + running + ' running</span></h2></div>' +
      '<div class="carousel" id="carousel">' + AGENTS.map(homeCard).join("") + "</div>" +
      '<div class="sechead"><h2>Activity</h2><button data-go="#/activity">See all</button></div>' +
      (rows.length ? '<div class="list">' + rows.map(actRow).join("") + "</div>" : '<div class="list"><div class="empty">Nothing yet tonight</div></div>');
  }

  /* ---------- agent cards (Home carousel) ---------- */
  function cardTop(name, a) {
    const status = a ? (a.paused ? "paused" : a.status === "stale" ? "stale" : "running") : "—";
    return '<div class="top"><div class="who"><i style="background:' + COLORS[name] + '"></i>' + NAMES[name] + '</div><span class="status ' + status + '"><i></i>' + status + "</span></div>";
  }
  function homeCard(name) {
    const a = agentCard(name) || {}, s = a.stats || {}, decs = a.decisions || [];
    let big = "", lbl = "", body = "";
    if (name === "scanner") {
      big = esc(s.pools != null ? s.pools : 0) + " pools"; lbl = "tonight";
      const feed = decs.slice(0, 4);
      body = feed.length ? '<ul class="feed">' + feed.map((d) => {
        const pass = d.verdict === "pass";
        return '<li class="' + (pass ? "passed" : "killed") + '"><span class="n">' + esc(d.name || "") + '</span><span class="r">' + esc(pass ? "→ auditor" : (d.reason || "killed")) + "</span></li>";
      }).join("") + "</ul>" : '<div class="muted">Listening for graduations</div>';
    } else if (name === "auditor") {
      big = esc(s.taken_apart || 0) + " taken apart"; lbl = esc(s.rejected || 0) + " rejected";
      const L = s.latest;
      const by = {}; ((L && L.layers) || []).forEach((x) => (by[x.n] = x));
      let next = null;
      if (L && L.verdict === "taking apart") for (let i = 1; i <= 8; i++) if (!by[i]) { next = i; break; }
      const strips = '<div class="strips">' + [1, 2, 3, 4, 5, 6, 7, 8].map((i) => {
        const x = by[i]; const c = x ? (x.pass === true ? "g" : x.pass === false ? "r" : "") : (i === next ? "w" : "");
        return '<div class="' + c + '" title="' + esc(LAYER_NAMES[i - 1]) + '"></div>';
      }).join("") + "</div>";
      const line = !L ? "No coin taken apart yet" : L.verdict === "taking apart" ? "taking apart " + esc(L.name || "") + "…" :
        L.verdict === "cleared" ? esc(L.name || "") + " · 8/8 → Executor" : esc(L.name || "") + " · " + esc(L.reason || "rejected");
      body = strips + '<div class="' + (L && L.verdict === "rejected" ? "down" : L && L.verdict === "cleared" ? "up" : "muted") + '">' + line + "</div>";
    } else if (name === "analyst") {
      big = "Scoring"; lbl = esc(s.scored || 0) + " scored" + (s.mode === "rules" ? " · rules" : "");
      const L = s.latest;
      body = '<div class="ringwrap"><canvas id="ring" data-score="' + esc(L && L.score != null ? L.score : "") + '" data-min="' + esc(s.min_score != null ? s.min_score : 70) + '"></canvas><div>' +
        (L ? '<div>' + esc(L.name || "") + '</div><div class="' + (L.pass ? "up" : "muted") + '">' + esc(L.pass ? "pass" : (L.reason || "reject")) + "</div>" : '<div class="muted">Waiting for a coin</div>') +
        '<div class="faint">green from ' + esc(s.min_score != null ? s.min_score : 70) + "</div></div></div>";
    } else if (name === "executor") {
      big = esc(s.trades || 0) + " trades";
      const L = s.latest;
      lbl = L && L.size_usd != null ? esc(usd(L.size_usd)) + " · " + esc(L.stack_pct != null ? L.stack_pct : s.stack_pct) + "% of stack" : esc(s.stack_pct != null ? s.stack_pct : "—") + "% of stack per ticket";
      const filled = L && /^(bought|filled|confirmed|open)$/i.test(L.status || "");
      const working = L && /^(pending|sent|signal|waiting)$/i.test(L.status || "");
      body = !L ? '<div class="bar"><div style="width:0"></div></div><div class="muted">No trades yet</div>' :
        filled ? '<div class="bar"><div style="width:100%"></div></div><div class="up">✓ Filled · ' + esc(L.name || "") + "</div>" :
        working ? '<div class="bar ind"><div></div></div><div class="muted">Executing… ' + esc(L.name || "") + "</div>" :
        '<div class="bar"><div style="width:0"></div></div><div class="muted">' + esc((L.name || "") + " · " + (L.status || "")) + "</div>";
    } else if (name === "risk") {
      big = "Guarding"; lbl = esc(s.open || 0) + " open";
      const L = s.latest;
      const what = !L ? '<div class="muted">No exits yet tonight</div>' :
        '<div class="' + (num(L.pnl_usd) >= 0 ? "up" : "down") + '">' + esc(/trail/i.test(L.exit_reason || "") ? "Trailed out" : /stop/i.test(L.exit_reason || "") ? "Stopped" : (L.exit_reason || "Exited")) + " · " + esc(L.name || "") + " · " + esc(usd(L.pnl_usd)) + "</div>";
      body = what + '<div class="pills"><span class="pill red">stop -' + esc(s.stop_pct) + '%</span><span class="pill green">trail ' + esc(s.trail_pct) + "%</span></div>";
    }
    const target = name === "auditor" ? "#/audit" : "#/agents";
    return '<button class="acard" data-go="' + target + '">' + cardTop(name, agentCard(name)) +
      '<div class="big num">' + big + '</div><div class="lbl">' + lbl + '</div><div class="body">' + body + "</div></button>";
  }

  /* ---------- Activity ---------- */
  // Every row the desk writes, migrations included (Activity tab).
  function allActivityRows() {
    return (S.activity && S.activity.rows) || [];
  }
  // Home preview: decisions only, so five graduations don't push them off.
  function activityRows() {
    return allActivityRows().filter((r) => r.kind !== "migration");
  }
  function kindLabel(k) {
    return String(k || "event").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  }
  function actRow(r) {
    const k = String(r.kind || "");
    const ag = String(r.agent || "").toLowerCase();
    const color = k === "bought" ? "#0a84ff" : k === "sold" || k === "trailed" ? "#00d35a" : k === "stopped" ? "#ff453a" :
      k.indexOf("scanner") === 0 || k === "migration" ? "#64d2ff" : k === "rejected" ? "#2c2c2e" : (COLORS[ag] || "#2c2c2e");
    let title = r.title || r.name || kindLabel(k), sub = isoToTime(r.subtitle || ""), val = r.value || "";
    if (k === "migration") { title = "Graduated " + (r.name || String(r.mint || "").slice(0, 8)); sub = "Scanner · new graduation"; val = "New"; }
    if (k === "scanner_kill") { sub = "Scanner · " + (r.subtitle || r.value || ""); val = "Killed"; }
    if (k === "scanner_pass") { sub = "Scanner · passed"; val = "→ auditor"; }
    if (k === "rejected" && !val) val = "Skipped";
    if (k === "auditor_pass" && !val) val = "→ analyst";
    if (k === "analyst_pass" && !val) val = "→ executor";
    if (val && val.length > 40) val = val.slice(0, 40) + "…";
    const an = NAMES[ag] || (ag ? ag[0].toUpperCase() + ag.slice(1) : "");
    if (an && k.indexOf("scanner") !== 0 && sub.indexOf(an) !== 0) sub = an + (sub ? " · " + sub : "");
    val = String(val).replace(/\s\/\s/g, " · ");
    const letter = esc((NAMES[ag] || title || "?")[0]);
    const tgt = ((k === "rejected" || k === "auditor_pass" || k === "analyst_pass") && (ag === "auditor" || ag === "analyst") && r.mint) ? "#/audit/" + r.mint : (r.mint ? "#/coin/" + r.mint : "");
    return '<button class="row"' + (tgt ? ' data-go="' + esc(tgt) + '"' : "") + '><span class="ico" style="background:' + color + ";color:" + (color === "#2c2c2e" ? "#fff" : "#000") + '">' + letter + "</span>" +
      '<span class="main"><div class="t">' + esc(title) + '</div><div class="s">' + esc(sub) + (r.ts && !/\d\d:\d\d/.test(sub) ? " · " + esc(hhmm(r.ts)) : "") + "</div></span>" +
      '<span class="v ' + (val === "Killed" || val === "Skipped" || val === "New" ? "muted" : /^→/.test(val) ? "up" : sign(val)) + ' num">' + esc(val) + "</span></button>";
  }
  function viewActivity() {
    const head = '<div class="largetitle">Activity</div>' + banner();
    if (!S.state && !S.activity) return head + skList(6);
    const rows = allActivityRows();
    return head + (rows.length ? '<div class="list">' + rows.map(actRow).join("") + "</div>" : '<div class="list"><div class="empty">Nothing yet tonight</div></div>') +
      (rows.length ? '<div class="note">Every graduation and every agent decision, newest first. Last ' + rows.length + ' rows' + (rows.length ? " (since " + esc(hhmm(rows[rows.length - 1].ts)) + ")" : "") + '. Older rows: send "status" to the bot.</div>' : "");
  }

  /* ---------- Agents tab ---------- */
  function viewAgents() {
    const head = '<div class="largetitle">Agents</div>' + banner();
    if (!S.state) return head + skList(5);
    const sv = S.state.settings_view || {};
    return head + AGENTS.map((name) => {
      const a = agentCard(name) || {};
      const status = a.paused ? "paused" : a.status === "stale" ? "stale" : "running";
      const locked = name === "risk" && S.state.risk_locked;
      const cmd = (sv[name] && sv[name].paused && sv[name].paused.command) || ((a.paused ? "resume " : "pause ") + name);
      const decs = a.decisions || [];
      return '<div class="fcard" id="agent-' + name + '"><div class="head"><span class="ico" style="background:' + COLORS[name] + '">' + NAMES[name][0] + '</span><span class="nm">' + NAMES[name] +
        '</span><button class="swbtn" data-cmd="' + esc(locked ? "" : cmd) + '" data-locked="' + (locked ? 1 : "") + '" aria-label="Pause or resume ' + NAMES[name] + '"><span class="switch ' + (a.paused ? "" : "on") + (locked ? " locked" : "") + '"></span></button></div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px"><span class="status ' + status + '"><i></i>' + status + " · " + esc(a.today_count || 0) + ' today</span><span class="cmd">' + esc(locked ? "locked: position open" : cmd) + "</span></div>" +
        (decs.length ? '<ul class="dec">' + decs.slice(0, 20).map((d) => {
          const u = fomo(d.coin_url);
          const v = String(d.verdict || "");
          const cls = /^(pass|cleared|bought|filled)$/i.test(v) ? "up" : /^(kill|reject|rejected|stop|stopped)$/i.test(v) ? "down" : "muted";
          return "<li><span class=\"tm\">" + esc(hhmm(d.ts)) + "</span><span>" + (u ? '<a class="coin" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(d.name || "coin") + "</a>" : esc(d.name || "—")) +
            '<span class="rs">' + esc(d.reason || "") + '</span></span><span class="vd ' + cls + '">' + esc(v) + "</span></li>";
        }).join("") + "</ul>" : '<div class="empty" style="padding:16px 0 4px">' + (name === "scanner" ? "Listening for graduations" : name === "auditor" ? "No coin taken apart yet" : "No decisions yet tonight") + "</div>") +
        '<button class="linkbtn" data-go="#/account/set-' + name + '">Settings ›</button></div>';
    }).join("");
  }

  /* ---------- Coin screen ---------- */
  function coinUrlFor(mint) {
    const c = S.coins[mint]; if (c && fomo(c.coin_url)) return c.coin_url;
    const rows = (S.activity && S.activity.rows) || [];
    const r = rows.find((x) => x.mint === mint && fomo(x.coin_url)); if (r) return r.coin_url;
    for (const a of ((S.state && S.state.agents) || [])) { const d = (a.decisions || []).find((x) => x.mint === mint && fomo(x.coin_url)); if (d) return d.coin_url; }
    return null;
  }
  function navBack(title, right) {
    return '<div class="nav"><button class="back" data-back="1">‹ Back</button><div class="navtitle">' + esc(title) + "</div>" + (right || "") + "</div>";
  }
  function viewCoin(mint) {
    const c = S.coins[mint], err = S.coinErr[mint];
    if (!c && !err) return navBack("Coin") + banner() + sk(34, 8, "60%") + sk(18, 8, "45%") + sk(66, 12, "70%") + sk(260, 14) + sk(120, 12) + sk(54, 18);
    if (!c) {
      const u = fomo(coinUrlFor(mint));
      return navBack("Coin") + banner() + '<div class="card"><div class="empty">' + (err === "missing" ? "This coin isn't on the desk tonight" : "Can't load this coin right now") + '</div><div class="faint" style="text-align:center;word-break:break-all;font-size:12px">' + esc(mint) + "</div></div>" +
        (u ? '<a class="cta ghost" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">Open on FOMO</a>' : "");
    }
    const st = c.stats || {}, pos = c.position, open = !!c.position_open, au = c.audit_summary;
    const name = c.name || c.symbol || mint.slice(0, 8);
    const shield = au ? '<span class="shield ' + (au.cleared ? "g" : au.rejected ? "r" : "") + '">◈ ' + esc(au.passed_layers) + "/8</span>" : '<span class="shield">◈ —/8</span>';
    const age = ageText(c.migrated_at || st.migrated_at);
    const sinceEntry = pos && num(pos.pct) != null ? '<div class="' + (pos.pct >= 0 ? "up" : "down") + ' num" style="font-size:17px">' + (pos.pct >= 0 ? "▲ " : "▼ ") + esc(Math.abs(pos.pct).toFixed(2)) + "% since entry</div>" : "";
    const u = fomo(c.coin_url);
    let posCard = "";
    if (pos) {
      posCard = '<div class="card"><div class="ttl">Your position · ' + esc(usd(pos.size_usd)) + ' in · Executor</div>' +
        '<div class="kv"><span class="muted">Entry</span><span class="num">' + esc(price(pos.entry_price)) + "</span></div>" +
        '<div class="kv"><span class="muted">P&amp;L</span><span class="num ' + sign(num(pos.unrealized_pnl_usd) >= 0 ? "+" : "-") + '">' + esc(open ? usd(pos.unrealized_pnl_usd) : usd(pos.pnl_usd)) + "</span></div>" +
        (open ? "" : '<div class="kv"><span class="muted">Closed</span><span>' + esc(pos.exit_reason || "closed") + "</span></div>") + "</div>";
      if (open) {
        const left = pos.timeout_at ? Math.max(0, Date.parse(pos.timeout_at) - Date.now()) : null;
        const lt = left == null ? "—" : Math.floor(left / 3600000) + "h " + Math.floor((left % 3600000) / 60000) + "m";
        posCard += '<div class="card"><div class="ttl">Exit</div>' +
          '<div class="kv"><span class="muted">Stop line</span><span class="num down">' + esc(price(pos.stop_price)) + (pos.stop_pct != null ? " · -" + esc(pos.stop_pct) + "%" : "") + "</span></div>" +
          '<div class="kv"><span class="muted">Trail line</span><span class="num">' + (pos.trail_price != null ? esc(price(pos.trail_price)) + " · " + esc(pos.trail_pct) + "%" : '<span class="faint">not armed</span>') + "</span></div>" +
          '<div class="kv"><span class="muted">Time left to timeout</span><span class="num">' + esc(lt) + "</span></div></div>";
      }
    }
    return navBack(c.symbol || name) + banner() +
      '<div class="coinhead"><h1>' + esc(name) + "</h1>" + paperPill() + shield + "</div>" +
      '<div class="muted">' + esc([c.symbol || "", c.chain || "Solana", age].filter(Boolean).join(" · ")) + "</div>" +
      '<div class="price num' + (String(price(c.price)).length > 11 ? " small" : "") + '">' + esc(price(c.price)) + "</div>" + sinceEntry +
      '<div class="candles chartwrap"><canvas id="candles"></canvas></div>' +
      '<div class="stats"><div><div class="k">Market cap</div><div class="vv num">' + esc(compact(st.market_cap)) + '</div></div><div><div class="k">Liquidity</div><div class="vv num">' + esc(compact(st.dex_liquidity_usd != null ? st.dex_liquidity_usd : st.liquidity_usd)) +
      '</div></div><div><div class="k">24h volume</div><div class="vv num">' + esc(compact(st.volume_h24)) + '</div></div><div><div class="k">Holders</div><div class="vv num">' + esc(st.holders != null ? st.holders : "n/a") + "</div></div></div>" +
      posCard +
      (au ? '<button class="linkbtn" data-go="#/audit/' + esc(mint) + '">Taken apart · ' + esc(au.passed_layers) + "/8 ›</button>" : (c.scan && c.scan.verdict === "kill" ? '<div class="note" style="padding-left:0">Scanner cut it · ' + esc(c.scan.reason || "") + "</div>" : "")) +
      (u ? '<a class="cta ' + (open ? "sell" : "") + '" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + (open ? "Sell on FOMO" : "Buy on FOMO") + "</a>" : "");
  }

  /* ---------- Auditor screen ---------- */
  function viewAudit(mintArg) {
    const mint = mintArg || (S.state && S.state.audit_latest_mint);
    if (!S.state && !mint) return navBack("Auditor") + banner() + '<div class="discs">' + LAYER_NAMES.map(() => '<div class="sk" style="height:26px;margin-top:4px;border-radius:50%"></div>').join("") + "</div>" + skList(3);
    if (!mint) return navBack("Auditor") + banner() + discsHtml({}, 0, null) + '<div class="empty">No coin taken apart yet</div>' + auditToggle();
    const c = S.coins[mint], err = S.coinErr[mint];
    if (!c && (err === "offline" || S.offline)) return navBack("Auditor") + banner() + discsHtml({}, 0, null) + '<div class="empty">Can\'t load this coin right now</div>' + auditToggle();
    if (!c && !err) return navBack("Auditor") + banner() + '<div class="discs">' + LAYER_NAMES.map(() => '<div class="sk" style="height:26px;margin-top:4px;border-radius:50%"></div>').join("") + "</div>" + skList(3);
    const layers = (c && c.layers) || [];
    const name = c ? (c.symbol || c.name || mint.slice(0, 8)) : mint.slice(0, 8);
    if (!layers.length) {
      return navBack("Auditor") + banner() + '<div class="coinhead"><h1>' + esc(name) + "</h1></div>" + discsHtml({}, 0, null) +
        '<div class="empty">No coin taken apart yet' + (c && c.scan && c.scan.verdict === "kill" ? "<br><span class=\"faint\">Scanner cut " + esc(name) + " first · " + esc(c.scan.reason || "") + "</span>" : "") + "</div>" + auditToggle() +
        (fomo(c && c.coin_url) ? '<a class="cta ghost" href="' + esc(c.coin_url) + '" target="_blank" rel="noopener noreferrer">Open on FOMO</a>' : "");
    }
    const by = {}; layers.forEach((L) => (by[L.layer] = L));
    const shown = S.auditShown[mint] == null ? (reduced() ? 8 : 0) : S.auditShown[mint];
    const au = c.audit_summary || {};
    const done = au.rejected || au.cleared;
    let verdict = "";
    if (shown >= 8 || (done && shown >= Math.max(...layers.map((l) => l.layer)))) {
      if (au.rejected) verdict = '<div class="verdict r">Rejected · ' + esc(au.reason || "") + '</div><div class="muted">Grok Bot won\'t buy ' + esc(name) + "</div>";
      else if (au.cleared) verdict = '<div class="verdict g">Cleared · 8/8 parts</div><div class="muted">Sent to Executor' + (c.signal && c.signal.size_usd != null ? " · " + esc(usd(c.signal.size_usd)) : "") + "</div>";
    }
    const rows = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => {
      const L = by[i]; const vis = L && i <= shown;
      const notChecked = !L && au.rejected;
      const ic = vis ? (L.pass === true ? '<span class="ok">✓</span>' : L.pass === false ? '<span class="bad">✕</span>' : '<span class="nc">–</span>') : notChecked && shown >= 8 ? '<span class="nc">–</span>' : '<span class="faint">·</span>';
      const val = vis ? esc(L.value_text || "") : notChecked && shown >= 8 ? '<span class="nc">not checked</span>' : "";
      return '<div class="kv"><span>' + ic + " " + esc((L && L.name) || LAYER_NAMES[i - 1]) + '</span><span class="val">' + val + "</span></div>";
    }).join("");
    return navBack("Auditor") + banner() + '<div class="coinhead"><h1>' + esc(name) + "</h1></div>" +
      discsHtml(by, shown, au) + '<div id="verdict">' + verdict + '</div><div class="card lrows" id="lrows">' + rows + "</div>" + auditToggle() +
      (fomo(c.coin_url) ? '<a class="cta ghost" href="' + esc(c.coin_url) + '" target="_blank" rel="noopener noreferrer">Open on FOMO</a>' : "");
  }
  function discsHtml(by, shown, au) {
    let h = '<div class="discs" id="discs">';
    for (let i = 1; i <= 8; i++) {
      const L = by[i];
      const cls = L && i <= shown ? (L.pass === true ? "g" : L.pass === false ? "r" : "nc") : (!L && au && au.rejected && shown >= 8 ? "nc" : "");
      h += '<div class="disc ' + cls + '" data-n="' + i + '">' + i + "</div>";
    }
    return h + '<div class="beam" id="beam"></div></div>';
  }
  function auditToggle() {
    const sv = (S.state && S.state.settings_view && S.state.settings_view.auditor && S.state.settings_view.auditor.enabled) || null;
    const on = sv ? !!sv.value : true;
    const cmd = on ? "set auditor_enabled to off" : "set auditor_enabled to on";
    return '<div class="card"><div class="kv" style="min-height:44px"><span>Take apart before buying</span><button class="swbtn" data-cmd="' + esc(cmd) + '"><span class="switch ' + (on ? "on" : "") + '"></span></button></div><div class="cmd">' + esc(cmd) + " · send it to the bot (asks twice)</div></div>";
  }
  async function runBeam(mint) {
    const c = S.coins[mint]; if (!c || !c.layers || !c.layers.length) return;
    if (S.auditRunning[mint]) return;
    const maxLayer = Math.max(...c.layers.map((l) => l.layer));
    const by = {}; c.layers.forEach((L) => (by[L.layer] = L));
    if (reduced()) { S.auditShown[mint] = 8; return; }
    S.auditRunning[mint] = true;
    try {
      let shown = S.auditShown[mint] || 0;
      while (shown < maxLayer) {
        const i = shown + 1;
        const beam = $("#beam"), disc = $('.disc[data-n="' + i + '"]');
        if (!beam || !disc || route().name !== "audit") break;
        beam.classList.add("on"); beam.classList.remove("wait");
        beam.style.top = (disc.offsetTop + disc.offsetHeight / 2 - 2) + "px";
        await new Promise((r) => setTimeout(r, 350));
        if (!by[i]) break;
        S.auditShown[mint] = shown = i;
        const d2 = $('.disc[data-n="' + i + '"]');
        if (d2) d2.classList.add(by[i].pass === true ? "g" : by[i].pass === false ? "r" : "nc");
        await new Promise((r) => setTimeout(r, 150));
      }
      const au = c.audit_summary || {};
      const beam = $("#beam");
      if (au.rejected || au.cleared) { S.auditShown[mint] = 8; if (beam) beam.classList.remove("on"); render(); }
      else if (beam && maxLayer < 8) {
        // Server slower than the beam: wait on the next layer, never guess it.
        const nd = $('.disc[data-n="' + (maxLayer + 1) + '"]');
        if (nd) { beam.style.top = (nd.offsetTop + nd.offsetHeight / 2 - 2) + "px"; beam.classList.add("on", "wait"); }
        render();
      }
    } finally { S.auditRunning[mint] = false; }
  }

  /* ---------- Account ---------- */
  const human = (k) => k.replace(/_/g, " ").replace(/\bpct\b/, "%").replace(/\busd\b/, "$").replace(/\bh1\b/, "1h").replace(/\bs$/, "(s)");
  function setRow(group, key, item, spec) {
    const full = group + "." + key;
    const v = item.value;
    let ctl = "";
    if (spec && spec.kind === "bool") ctl = '<span class="switch ' + (v ? "on" : "") + '"></span>';
    else if (spec && spec.kind === "enum" && spec.choices) ctl = '<span class="seg" style="width:150px">' + spec.choices.map((ch) => '<span class="' + (String(ch) === String(v) ? "on" : "") + '">' + esc(ch) + "</span>").join("") + "</span>";
    else ctl = '<input type="text" disabled value="' + esc(item.shown) + '" aria-label="' + esc(full) + '">';
    let slider = "";
    if (spec && spec.min != null && spec.max != null && num(v) != null && (spec.kind === "float" || spec.kind === "int")) {
      slider = '<input type="range" disabled min="' + esc(spec.min) + '" max="' + esc(spec.max) + '" step="' + (spec.kind === "int" ? 1 : "any") + '" value="' + esc(v) + '" aria-label="' + esc(full) + ' slider">';
    }
    return '<div class="set" data-copy="' + esc(item.command || "") + '"><div class="line"><span class="k">' + esc(human(key)) + "</span>" + ctl + "</div>" + slider +
      '<span class="cmd">' + esc(item.command || "") + (spec && spec.min != null ? '  <span class="faint">(' + esc(spec.min) + "–" + esc(spec.max) + ")</span>" : "") + "</span></div>";
  }
  function viewAccount(anchor) {
    const head = '<div class="largetitle">Account</div>' + banner();
    if (!S.state) return head + skList(6);
    const st = S.state, acc = st.account || {}, sv = st.settings_view || {}, spec = st.settings_spec || {};
    const prof = fomo(acc.profile_url), inv = fomo(acc.signup_url);
    const m = mode();
    const groups = ["scanner", "auditor", "analyst", "executor", "risk", "desk"];
    const stackCmd = (sv.desk && sv.desk.stack && sv.desk.stack.command) || "stack <usd>";
    return head +
      '<div class="group"><h3>Mode</h3><div class="list"><div class="set" data-copy="' + (m === "PAPER" ? "live" : "paper") + '"><div class="line"><span class="k">Trading mode</span><span class="seg" style="width:150px"><span class="' + (m === "PAPER" ? "on" : "") + '">PAPER</span><span class="' + (m === "LIVE" ? "on" : "") + '">LIVE</span></span></div>' +
      '<span class="cmd">' + esc(m === "PAPER" ? 'send "live" to the bot, then type LIVE to confirm' : 'send "paper" to the bot') + "</span></div>" +
      '<div class="set" data-copy="' + esc(stackCmd) + '"><div class="line"><span class="k">Stack</span><input type="text" disabled value="' + esc(usd(acc.stack)) + '"></div><span class="cmd">' + esc(stackCmd) + "</span></div></div>" +
      '<div class="note">Read-only here. Settings, pause and mode change through Telegram commands. Tap a row to copy its command.</div></div>' +
      '<div class="group"><h3>FOMO</h3><div class="list">' +
      (prof ? '<a class="row" href="' + esc(prof) + '" target="_blank" rel="noopener noreferrer"><span class="main"><div class="t">Your FOMO profile</div><div class="s">@' + esc(String(acc.fomo_handle || "").replace(/^@/, "")) + '</div></span><span class="chev">›</span></a>' : '<div class="row"><span class="main"><div class="t">Your FOMO profile</div><div class="s">set fomo_handle in Telegram</div></span></div>') +
      (inv ? '<button class="row" id="invite"><span class="main"><div class="t">Invite a friend</div><div class="s">Share your FOMO invite</div></span><span class="chev">›</span></button>' : "") + "</div></div>" +
      '<div class="group"><h3>Notifications</h3><div class="list">' +
      '<div class="row"><span class="main"><div class="t">Telegram</div></span><span class="v ' + (acc.telegram_connected ? "up" : "down") + '">' + (acc.telegram_connected ? "Connected" : "Not connected") + "</span></div>" +
      '<button class="row" data-copy="status"><span class="main"><div class="t">Send test push</div><div class="s">Send "status" to the bot in Telegram</div></span><span class="chev">›</span></button>' +
      '<div class="row"><span class="main"><div class="t">Web push</div><div class="s">Plan B has no push endpoint</div></span><span class="v muted">Telegram only</span></div></div></div>' +
      groups.map((g) => {
        const items = sv[g] || {};
        const keys = Object.keys(items).filter((k) => !(g === "desk" && (k === "mode" || k === "stack")));
        if (!keys.length) return "";
        return '<div class="group" id="set-' + g + '"><h3>' + esc(NAMES[g] || "Desk") + '</h3><div class="list">' + keys.map((k) => setRow(g, k, items[k], spec[g + "." + k])).join("") + "</div></div>";
      }).join("");
  }

  /* ---------- search ---------- */
  function openSearch() {
    const sh = document.createElement("div");
    sh.className = "sheet";
    sh.innerHTML = '<div class="bar2"><input id="q" type="search" placeholder="Name, symbol or mint" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="x">Cancel</button></div><div class="list" id="res" style="margin-top:12px"></div>';
    document.body.appendChild(sh);
    const q = $("#q", sh), res = $("#res", sh);
    const draw = () => {
      const s = q.value.trim().toLowerCase();
      const coins = (S.state && S.state.coins) || [];
      const hits = !s ? coins.slice(0, 20) : coins.filter((c) => [c.name, c.symbol, c.mint].some((x) => x && String(x).toLowerCase().indexOf(s) >= 0)).slice(0, 30);
      let html = hits.map((c) => '<button class="row" data-mint="' + esc(c.mint) + '"><span class="main"><div class="t">' + esc(c.symbol || c.name || c.mint.slice(0, 8)) + '</div><div class="s">' + esc(c.name || "") + " · " + esc(c.mint.slice(0, 4) + "…" + c.mint.slice(-4)) + '</div></span><span class="chev">›</span></button>').join("");
      if (!hits.length && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q.value.trim())) html = '<button class="row" data-mint="' + esc(q.value.trim()) + '"><span class="main"><div class="t">Open this mint</div></span><span class="chev">›</span></button>';
      res.innerHTML = html || '<div class="empty">' + (coins.length ? "No coin on the desk matches" : "No coins on the desk tonight") + "</div>";
    };
    q.addEventListener("input", draw); draw(); setTimeout(() => q.focus(), 50);
    sh.addEventListener("click", (e) => {
      const b = e.target.closest("[data-mint]");
      if (b) { sh.remove(); go("#/coin/" + b.dataset.mint); return; }
      if (e.target.closest(".x")) sh.remove();
    });
  }

  /* ---------- no data path ---------- */
  function viewNoPath() {
    return '<div class="largetitle">Grok Bot</div>' + banner() +
      '<div class="card"><div class="ttl">Open your private desk link once</div><div class="muted" style="margin-top:6px">This phone has no desk link saved yet. Open the private link Grok Bot sent you once (it ends in #d=…). The app keeps it on this phone and removes it from the address bar.</div></div>' +
      '<div class="card"><div class="ttl">Or paste it here</div><div class="muted" style="margin-top:6px">Copy the private link from the Grok Bot chat and paste it below.</div>' +
      '<input id="pastelink" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="https://…#d=…" style="width:100%;box-sizing:border-box;margin-top:10px;padding:12px;border-radius:10px;border:1px solid #3a3a3c;background:#1c1c1e;color:#fff;font-size:16px">' +
      '<button id="pastego" style="width:100%;margin-top:10px;padding:12px;border-radius:10px;border:0;background:#0a84ff;color:#fff;font-size:16px;font-weight:600">Open my desk</button>' +
      '<div id="pasteerr" class="muted" style="margin-top:8px;color:#ff453a"></div></div>';
  }

  /* ---------- render ---------- */
  function render() {
    const r = route();
    const view = $("#view");
    const car = $("#carousel"); const carX = car ? car.scrollLeft : 0;
    let html;
    if (S.noPath) html = viewNoPath();
    else if (r.name === "agents") html = viewAgents();
    else if (r.name === "activity") html = viewActivity();
    else if (r.name === "account") html = viewAccount(r.arg);
    else if (r.name === "coin" && r.arg) html = viewCoin(r.arg);
    else if (r.name === "audit") html = viewAudit(r.arg);
    else html = viewHome();
    view.innerHTML = html;
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.dataset.tab === (["agents", "activity", "account"].indexOf(r.name) >= 0 ? r.name : r.name === "home" ? "home" : "")));
    const car2 = $("#carousel"); if (car2) car2.scrollLeft = carX;
    // canvases
    const hc = $("#homechart");
    if (hc && S.state) {
      const rd = (S.chart && S.chart[S.range]) || { points: [], marks: [] };
      GBChart.line(hc, { points: rd.points, marks: rd.marks, startValue: num(S.state.night_start_balance) || num(S.state.starting_usd), markLabel: markLabel });
    }
    const ring = $("#ring");
    if (ring) GBChart.ring(ring, ring.dataset.score === "" ? null : +ring.dataset.score, +ring.dataset.min, "#ffd60a");
    const cc = $("#candles");
    if (cc && r.arg && S.coins[r.arg]) {
      const c = S.coins[r.arg];
      const lines = [];
      if (c.position_open && c.position && c.position.exit_line_price != null) lines.push({ price: c.position.exit_line_price, label: "Risk trailing stop", color: "#ff9f0a" });
      GBChart.candles(cc, { candles: c.candles, lines, fmtPrice: price, emptyText: "No price ticks yet" });
    }
    if ($(".odo")) { rollOdometer(); if (S.state) S.prevBal = S.state.balance; }
    if (r.name === "audit") { const m = routeMint(); if (m && S.coins[m]) setTimeout(() => runBeam(m), 30); }
    if (r.name === "account" && r.arg) { const el = document.getElementById(r.arg); if (el) el.scrollIntoView(); }
  }

  /* ---------- events ---------- */
  document.addEventListener("click", (e) => {
    const t = e.target;
    const tab = t.closest(".tab"); if (tab) { go("#/" + tab.dataset.tab); return; }
    const back = t.closest("[data-back]"); if (back) { if (history.length > 1) history.back(); else go("#/home"); return; }
    const sw = t.closest(".swbtn");
    if (sw) { if (sw.dataset.locked) toast("Risk is locked while a position is open"); else if (sw.dataset.cmd) copy(sw.dataset.cmd, 'Copied "' + sw.dataset.cmd + '" · send it to the bot'); return; }
    const cp = t.closest("[data-copy]"); if (cp && cp.dataset.copy) { copy(cp.dataset.copy, 'Copied "' + cp.dataset.copy + '" · send it to the bot'); return; }
    const g = t.closest("[data-go]"); if (g) { go(g.dataset.go); return; }
    const rg = t.closest("[data-range]"); if (rg) { S.range = rg.dataset.range; render(); return; }
    if (t.closest("#pastego")) {
      const i = $("#pastelink");
      if (pastePath(i && i.value)) { S.coins = {}; S.coinErr = {}; S.state = null; S.noPath = false; go("#/home"); poll(); }
      else { const er = $("#pasteerr"); if (er) er.textContent = "That doesn't look like the desk link. Paste the whole link from the chat."; }
      return;
    }
    if (t.closest("#searchbtn")) { openSearch(); return; }
    if (t.closest("#bellbtn")) { markSeen(); go("#/activity"); return; }
    if (t.closest("#invite")) {
      const u = fomo(S.state && S.state.account && S.state.account.signup_url); if (!u) return;
      if (navigator.share) navigator.share({ title: "FOMO", url: u }).catch(() => {});
      else copy(u, "Link copied");
    }
  });
  window.addEventListener("resize", () => { clearTimeout(render._r); render._r = setTimeout(render, 150); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && dataPath()) poll(); });

  /* ---------- boot ---------- */
  takeFragment();
  if (!location.hash) history.replaceState(null, "", location.pathname + location.search + "#/home");
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
  render();
  poll();
})();
