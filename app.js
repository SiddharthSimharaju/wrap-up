/* Wrap up: UI. Depends on lib.js (WrapLib). No network access: the page's CSP blocks it. */
"use strict";
const { MONTHS, MIN_PER_VIDEO } = WrapLib;
const CFG = window.APP_CONFIG || {};

/* Public figures (secondary sources, 2026): ~2.7B monthly users, ~500M in India, ~1B hours watched a day.
   Everything derived from them is labeled "est." in the UI. */
const BM = { globalUsers: 2.7e9, indiaUsers: 500e6, globalDailyHours: 1e9, sigma: 1.1 };
BM.avgWatchHrsYear = BM.globalDailyHours / BM.globalUsers * 365;                 // ~135 hours per user per year
BM.medianWatchesYear = BM.avgWatchHrsYear * 60 / MIN_PER_VIDEO;                  // ~1,160 videos per user per year

const PERSONAS = {
  "Music": ["The Soundtrack Addict", "Every moment has a playlist."],
  "Gaming": ["The Controller Gremlin", "You watch games like others watch cricket."],
  "Tech": ["The Gadget Goblin", "Specs, benchmarks, teardowns."],
  "News": ["The Headline Hunter", "You watch the news to argue about it."],
  "Comedy": ["The Meme Historian", "If it's funny, you've seen it."],
  "Sports": ["The Armchair Athlete", "Highlights are your cardio."],
  "Learning": ["The Rabbit Hole Scholar", "You came for one answer and left with a degree."],
  "Movies & TV": ["The Cinephile", "Trailers, scenes and breakdowns."],
  "Food & Lifestyle": ["The Couch Explorer", "Recipes, travel and routines from your sofa."],
  "Other": ["The Eclectic Explorer", "No algorithm can box you in."]
};
const COL = ["#ff7a1a", "#ffa24d", "#ffc58a", "#9a9a9a", "#666"];
const ICON = {
  vid: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M10 9.5l5 2.5-5 2.5z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  chan: '<rect x="3" y="7" width="18" height="12" rx="2"/><path d="M8 3l4 4 4-4"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  genre: '<circle cx="12" cy="12" r="9"/><path d="M12 3v9l6.4 6.4"/>',
  rank: '<path d="M5 20V11M12 20V4M19 20v-6"/>'
};
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/* ---------- helpers ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = n => Math.round(n).toLocaleString("en-IN");
const compact = n => n >= 1e9 ? (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B" : n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M" : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K" : String(Math.round(n));
const ord = n => { const v = n % 100; return n + (["th", "st", "nd", "rd"][(v - 20) % 10] || ["th", "st", "nd", "rd"][v] || "th"); };
const ic = k => `<svg viewBox="0 0 24 24">${ICON[k]}</svg>`;
const hr12 = h => (h % 12 || 12) + (h < 12 ? "am" : "pm");
const fmtDate = t => new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const fmtDay = k => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }); };
function smooth(p) { if (p.length < 2) return ""; let d = `M${p[0][0]},${p[0][1]}`; for (let i = 1; i < p.length; i++) { const [x0, y0] = p[i - 1], [x1, y1] = p[i], mx = (x0 + x1) / 2; d += ` C${mx},${y0} ${mx},${y1} ${x1},${y1}`; } return d; }
function toast(m) { const t = $("toast"); t.textContent = m; t.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("on"), 3600); }

/* ---------- state + storage ---------- */
const KEY = "wrapup:v1";
const S = { data: { watch: null, search: null }, kind: "watch", sums: null, subs: null, sel: "all", mode: "none", savedAt: 0, notes: [] };
let busy = false, shareGen = 0;
function setData(data, subs, mode) {
  S.data = { watch: data.watch || null, search: data.search || null }; S.subs = subs;
  S.kind = S.data.watch ? "watch" : "search"; S.sums = S.data[S.kind]; S.mode = mode; S.sel = pickDefault(S.sums); S.savedAt = 0;
}
function setKind(k) { if (!S.data[k]) return; S.kind = k; S.sums = S.data[k]; S.sel = pickDefault(S.sums); }
const TXT = {
  watch: { unit: "videos", one: "video", act: "watched", chan: "Channels watched", top: "Top channels", topShort: "Who I watch", vids: "Most watched videos", col: "Plays" },
  search: { unit: "searches", one: "search", act: "searched", chan: "Different topics", top: "Top search terms", topShort: "What I search", vids: "Most repeated searches", col: "Times" }
};
function save() { try { localStorage.setItem(KEY, JSON.stringify({ v: 2, savedAt: Date.now(), subs: S.subs, data: S.data })); return true; } catch (_) { return false; } }
function loadSaved() { try { const raw = localStorage.getItem(KEY); return raw ? WrapLib.cleanStore(JSON.parse(raw)) : null; } catch (_) { return null; } }
function clearStored() { try { localStorage.removeItem(KEY); } catch (_) {} }
function pickDefault(sums) { const y = sums.years.find(y => sums.by[y].count >= 200); return y ? String(y) : "all"; }

/* ---------- derived numbers ---------- */
function derive(v, subs) {
  const hours = v.count * MIN_PER_VIDEO / 60;
  const perYear = v.year === "all" ? v.count / (v.spanYears || 1) : v.count;
  const p = WrapLib.lnCdf(perYear, BM.medianWatchesYear, BM.sigma);
  const topPct = Math.max(.1, (1 - p) * 100);
  const topic = (v.topics[0] && v.topics[0][0]) || "Other";
  const hrTotals = Array(24).fill(0); v.heat.forEach(r => r.forEach((c, h) => { hrTotals[h] += c; }));
  const peak = hrTotals.indexOf(Math.max(...hrTotals));
  const dowTotals = v.heat.map(r => r.reduce((a, b) => a + b, 0));
  const chips = [];
  if (v.nightPct >= 35) chips.push("Night owl"); else if (peak >= 5 && peak <= 9) chips.push("Early bird");
  if (v.weekendPct >= 35) chips.push("Weekend binger");
  return {
    hours, perYear, pct: p, topPct, topLbl: topPct < 1 ? topPct.toFixed(1) : String(Math.round(topPct)),
    rankNum: Math.max(1, Math.round(BM.indiaUsers * topPct / 100)), topic, persona: PERSONAS[topic] || PERSONAS.Other,
    hrTotals, peak, busiestDow: dowTotals.indexOf(Math.max(...dowTotals)), chips, yearLabel: v.year === "all" ? "all time" : String(v.year), subs
  };
}
function view() { return S.sums.by[S.sel] || S.sums.by.all; }

/* ---------- charts ---------- */
function bars(vals, labels) {
  const W = 300, H = 140, mx = Math.max(...vals, 1), n = vals.length, bw = 5, gap = n > 1 ? (W - n * bw) / (n - 1) : 0;
  const r = vals.map((v, i) => { const h = Math.max(v ? 3 : 0, v / mx * (H - 24)); return `<rect x="${i * (bw + gap)}" y="${H - 10 - h}" width="${bw}" height="${h}" rx="1" fill="#ff7a1a"/>`; }).join("");
  return `<svg class="bars" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><line x1="0" x2="${W}" y1="${H - 9.5}" y2="${H - 9.5}" stroke="#333"/>${r}</svg><div class="axis"><span>${esc(labels[0] || "")}</span><span>${esc(labels[labels.length - 1] || "")}</span></div>`;
}
function lineChart(series) {
  const vals = series.values, labels = series.labels, W = 900, H = 300, L = 46, R = 12, T = 14, B = 32;
  const mx = Math.max(...vals, 4), step = Math.max(1, Math.ceil(mx / 5)), top = step * 5, n = vals.length;
  const X = i => L + (n > 1 ? i / (n - 1) : .5) * (W - L - R), Y = v => T + (1 - v / top) * (H - T - B);
  const grid = [0, 1, 2, 3, 4, 5].map(k => { const y = Y(k * step); return `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="#272727" stroke-dasharray="3 5"/><text x="${L - 10}" y="${y + 4}" text-anchor="end" font-size="12" fill="#707070">${compact(k * step)}</text>`; }).join("");
  const xl = labels.map((l, i) => `<text x="${X(i)}" y="${H - 8}" text-anchor="middle" font-size="12" fill="#a0a0a0">${esc(l)}</text>`).join("");
  const pts = vals.map((v, i) => [X(i), Y(v)]), d = smooth(pts);
  const area = pts.length > 1 ? `<path d="${d} L${X(n - 1)},${Y(0)} L${X(0)},${Y(0)} Z" fill="url(#ag)"/>` : "";
  const dots = pts.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="#151515" stroke="#ff7a1a" stroke-width="2"/>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" role="img" aria-label="Videos watched over time"><defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff7a1a" stop-opacity=".28"/><stop offset="1" stop-color="#ff7a1a" stop-opacity="0"/></linearGradient></defs>${grid}${xl}${area}<path d="${d}" fill="none" stroke="#ff7a1a" stroke-width="2.4"/>${dots}</svg>`;
}
function heatmap(v) {
  const order = [1, 2, 3, 4, 5, 6, 0], max = Math.max(...v.heat.flat(), 1);
  let h = `<div class="heat" role="img" aria-label="Heatmap of when you watch, by weekday and hour"><div></div>${Array.from({ length: 24 }, (_, i) => `<span class="hh">${i % 6 === 0 ? hr12(i).replace("am", "a").replace("pm", "p") : ""}</span>`).join("")}`;
  for (const wd of order) {
    h += `<div class="hl">${DAYS[wd]}</div>`;
    for (let hr = 0; hr < 24; hr++) { const c = v.heat[wd][hr]; h += `<i style="opacity:${(.07 + .93 * Math.pow(c / max, .55)).toFixed(2)}" title="${DAYS[wd]} ${hr12(hr)}: ${fmt(c)} videos"></i>`; }
  }
  return h + "</div>";
}

/* ---------- render ---------- */
function setView(which) {
  $("gate").style.display = which === "gate" ? "grid" : "none"; $("how").style.display = which === "gate" ? "block" : "none";
  $("dash").style.display = which === "dash" ? "block" : "none";
  $("acct").style.display = which === "dash" && S.mode !== "shared" ? "" : "none";
  $("makeown").style.display = which === "dash" && S.mode === "shared" ? "" : "none";
  $("back").style.display = which === "gate" && S.sums && S.mode !== "shared" ? "" : "none";
}
function render() {
  const v = view(), d = derive(v, S.subs), shared = S.mode === "shared", T = TXT[S.kind], isS = S.kind === "search", Cap = s => s[0].toUpperCase() + s.slice(1);
  const delta = (cur, prev, suffix) => { if (!prev) return `${suffix.alt || "&nbsp;"}`; const p = (cur - prev) / prev * 100; return `<span class="${p >= 0 ? "up" : "dn"}">${p >= 0 ? "▲" : "▼"} ${Math.abs(p).toFixed(0)}%</span> ${suffix.text}`; };
  const prev = v.prev, vs = v.year === "all" ? "" : "vs last year";
  const kp = [
    ["vid", isS ? "Searches" : "Videos watched", "", fmt(v.count), delta(v.count, prev && prev.count, { text: vs, alt: `${fmt(v.uniqueVideos)} different ${isS ? "queries" : "videos"}` })],
    isS ? ["clock", "Searches a day", "", (v.count / Math.max(v.activeDays, 1)).toFixed(1), "on days you search"]
      : ["clock", "Hours watched", '<span class="tag">est.</span>', fmt(d.hours), `${(d.hours / 24).toFixed(1)} days of nonstop video`],
    ["chan", T.chan, "", fmt(v.uniqueChannels), delta(v.uniqueChannels, prev && prev.channels, { text: vs, alt: `${fmt(v.rewatches)} repeats` })],
    ["cal", "Active days", "", fmt(v.activeDays), `Longest streak: ${fmt(v.longestStreak)} days`]
  ].map(k => `<div class="card"><div class="ch"><div class="ico">${ic(k[0])}</div>${k[1]}${k[2]}</div><div class="val">${k[3]}</div><div class="dl">${k[4]}</div>${bars(v.series.values, v.series.labels)}</div>`).join("");

  const tt = v.topics.reduce((a, t) => a + t[1], 0) || 1;
  let acc = 0; const topics = v.topics.slice(0, 5).map(t => ({ name: t[0], pct: t[1] / tt * 100 }));
  const stops = topics.map((t, i) => { const s = `${COL[i]} ${acc}% ${acc + t.pct}%`; acc += t.pct; return s; }); if (acc < 99.5) stops.push(`#272727 ${acc}% 100%`);
  const donut = `<div class="donutwrap"><div class="donut" style="background:conic-gradient(${stops.join(",")})"></div><div class="lg">${topics.map((t, i) => `<div><i style="background:${COL[i]}"></i>${esc(t.name)}<span>${t.pct.toFixed(0)}%</span></div>`).join("")}</div></div>`;
  const libs = v.topChannels.slice(0, 6).map(([n, c]) => `<div class="lib"><div class="ic">${esc((Array.from(n)[0] || "?").toUpperCase())}</div><div><div class="n">${esc(n)}</div>${isS ? `<div class="btns"><span class="btn sm">in ${fmt(c)} searches</span></div>` : `<div class="btns"><span class="btn sm">${fmt(c)} videos</span><span class="btn sm">${(c / v.count * 100).toFixed(0)}% of watching</span></div>`}</div></div>`).join("");
  const rows =v.topVideos.slice(0, 8).map(([t, ch, c]) => `<tr><td><span class="t">${esc(t)}</span><span class="s">${esc(ch)}</span></td><td><span class="chip ${c > 1 ? "o" : ""}">${fmt(c)}×</span></td></tr>`).join("");
  const peakShare = v.count ? d.hrTotals[d.peak] / v.count * 100 : 0;
  const facts = [
    v.busiest && [fmt(v.busiest.count), `${T.unit} on your busiest day, ${fmtDay(v.busiest.date)}`],
    [`${fmt(v.longestStreak)} days`, `longest streak of ${isS ? "searching" : "watching"} every day`],
    [`${(v.rewatches / v.count * 100).toFixed(0)}%`, isS ? "of your searches were repeats" : "of your watches were rewatches"],
    [`${v.nightPct.toFixed(0)}%`, `of ${isS ? "searching" : "watching"} happens after 10pm`],
    [(v.count / Math.max(v.activeDays, 1)).toFixed(1), `${T.unit} on a day you ${isS ? "search" : "watch"}`],
    !isS && [`${fmt(d.hours / 2.5)}`, "Bollywood films back to back (est.)"],
    !isS && [`${fmt(d.hours / 3.5)}`, "IPL matches back to back (est.)"],
    v.first && v.first.title && [fmtDate(v.first.t), `first ${T.one}${v.year === "all" ? "" : " of " + v.year}: ${v.first.title}`]
  ].filter(Boolean).slice(0, 6);
  const yrOpts = ['<option value="all">All time</option>'].concat(S.sums.years.map(y => `<option value="${y}">${y}</option>`)).join("");
  const kindSel = !shared && S.data.watch && S.data.search ? `<select class="sel" id="kind" aria-label="Data type"><option value="watch">Watching</option><option value="search">Searching</option></select>` : "";
  const rankCard = isS
    ? `<div class="card"><div class="ch"><div class="ico">${ic("rank")}</div>Your searching</div>
      <div class="lab">Searches in ${esc(d.yearLabel)}</div><div class="big">${fmt(v.count)}</div><div class="sub">${fmt(v.uniqueVideos)} different queries</div>
      <div class="rows"><div><span>Active days</span><b>${fmt(v.activeDays)}</b></div><div><span>Per active day</span><b>${(v.count / Math.max(v.activeDays, 1)).toFixed(1)}</b></div><div><span>Longest streak</span><b>${fmt(v.longestStreak)} days</b></div>${S.subs != null ? `<div><span>Your subscriptions</span><b>${fmt(S.subs)}</b></div>` : ""}</div></div>`
    : `<div class="card"><div class="ch"><div class="ico">${ic("rank")}</div>Rank in India<span class="tag">est.</span></div>
      <div class="lab">About ${compact(BM.indiaUsers)} Indian YouTube users</div><div class="big">Top ${d.topLbl}%</div><div class="sub">Roughly #${fmt(d.rankNum)} in India</div>
      <div class="gauge"><span style="left:${Math.min(95, Math.max(5, d.pct * 100))}%">${ord(Math.round(d.pct * 100))} percentile</span></div>
      <div class="scale"><span>Casual</span><span>Regular</span><span>Superfan</span></div>
      <div class="rows"><div><span>Your videos${v.year === "all" ? " per year" : ""}</span><b>${fmt(d.perYear)}</b></div><div><span>Typical viewer (est.)</span><b>${fmt(BM.medianWatchesYear)}</b></div>
      ${S.subs != null ? `<div><span>Your subscriptions</span><b>${fmt(S.subs)}</b></div>` : ""}<div><span>Share of YouTube's watch time (est.)</span><b>1 in ${compact(BM.globalDailyHours * 365 / Math.max(d.hours / (v.year === "all" ? (v.spanYears || 1) : 1), 1))}</b></div></div></div>`;
  const badge = S.mode === "demo" ? '<span class="live demo"><i></i><span>Demo data</span></span>' : shared ? '<span class="live demo"><i></i><span>Shared wrap</span></span>' : `<span class="live"><i></i><span>${S.savedAt ? "Saved on this device" : "Not saved"}</span></span>`;

  $("dash").innerHTML = `${shared ? '<div class="banner">You\'re viewing a shared wrap. It contains only summary stats, no video titles or history.</div>' : ""}
  <h1 class="title">${v.year === "all" ? (isS ? "Your YouTube searches, all time" : "Your YouTube, all time") : `Your ${esc(v.year)} on YouTube${isS ? " (searches)" : ""}`}</h1>
  ${S.notes && S.notes.length && !shared ? `<div class="banner">${S.notes.map(esc).join(" ")}</div>` : ""}
  <div class="bar">${kindSel}${shared ? "" : `<select class="sel" id="yr" aria-label="Year">${yrOpts}</select>`}${badge}<span>${fmt(v.count)} ${T.unit}${S.subs != null ? ` · ${fmt(S.subs)} subscriptions` : ""}</span></div>
  <div class="grid">${kp}</div>

  <h2 id="stand">Where you stand</h2>
  <div class="g3">
    ${rankCard}
    <div class="card"><div class="ch"><div class="ico">${ic("genre")}</div>Top topics<span class="tag">est.</span></div>${donut}
      <div class="rows"><div><span>Top topic</span><b>${esc(d.topic)}</b></div><div><span>Top 3 combined</span><b>${topics.slice(0, 3).reduce((a, t) => a + t.pct, 0).toFixed(0)}%</b></div><div><span>Different videos</span><b>${fmt(v.uniqueVideos)}</b></div></div></div>
    <div class="card"><div class="ch"><div class="ico">${ic("vid")}</div>Viewer type</div>
      <div class="lab">Your style</div><div class="big" style="font-size:36px">${esc(d.persona[0])}</div><div class="sub">${esc(d.persona[1])}</div>
      <div class="chips"><span class="chip o">${esc(d.topic)} fan</span>${d.chips.map(c => `<span class="chip">${esc(c)}</span>`).join("")}</div>
      <div class="rows"><div><span>Peak hour</span><b>${hr12(d.peak)}</b></div><div><span>Busiest weekday</span><b>${DAYS[d.busiestDow]}</b></div><div><span>Weekend share</span><b>${v.weekendPct.toFixed(0)}%</b></div><div><span>Rewatches</span><b>${fmt(v.rewatches)}</b></div></div></div>
  </div>

  <h2 id="channels">${T.top}</h2><div class="libs">${libs}</div>
  ${rows ? `<h2 id="videos">${T.vids}</h2><div class="card" style="padding:8px"><div class="tw"><table><thead><tr><th>${isS ? "Search" : "Video"}</th><th>${T.col}</th></tr></thead><tbody>${rows}</tbody></table></div></div>` : ""}

  <h2 id="when">When you watch</h2>
  <div class="g2"><div class="card"><div class="lab" style="margin-bottom:var(--s2)">Videos by weekday and hour (your local time)</div>${heatmap(v)}</div>
    <div class="card"><div class="ch"><div class="ico">${ic("clock")}</div>Your rhythm</div><div class="big">${hr12(d.peak)}</div><div class="sub">is your prime time, with ${peakShare.toFixed(0)}% of all your watching</div>
      <div class="rows"><div><span>After 10pm</span><b>${v.nightPct.toFixed(0)}%</b></div><div><span>Weekends</span><b>${v.weekendPct.toFixed(0)}%</b></div><div><span>Busiest weekday</span><b>${DAYS[d.busiestDow]}</b></div></div></div></div>

  <h2 id="time">Over time</h2>
  <div class="card"><div class="lab" style="margin-bottom:var(--s3)">Videos watched ${v.year === "all" ? "per year" : "per month"}</div>${lineChart(v.series)}</div>

  <h2>Fun facts</h2><div class="facts">${facts.map(f => `<div class="fact"><b>${esc(f[0])}</b><span>${esc(f[1])}</span></div>`).join("")}</div>

  <h2 id="share">Share your wrap</h2><div class="shares" id="shares"></div>
  <div class="card soc"><div><b>Send it to someone</b><span class="sub">Download a card, or copy a link that opens this wrap for anyone. The link holds your summary stats only: no video titles and no history. Nothing is uploaded anywhere.</span></div>
    <div class="socbtns"><button class="btn pri" id="slink">Copy share link</button><a class="btn" id="sx" target="_blank" rel="noopener noreferrer">Post on X</a><a class="btn" id="sw" target="_blank" rel="noopener noreferrer">WhatsApp</a><a class="btn" id="sl" target="_blank" rel="noopener noreferrer">LinkedIn</a></div></div>

  <div class="foot" id="foot"><b>About the data.</b> Real, from your Takeout file: every count, date, channel and video above. <i>Topics</i> are guessed from keywords in video titles and channel names (YouTube Music plays count as Music), so treat them as a rough read. <i>Hours</i> assume about ${MIN_PER_VIDEO} minutes per video because Takeout doesn't include watch time. <i>Rank in India</i> compares your yearly videos with a typical viewer worked out from public YouTube figures (about 2.7B monthly users, about 500M in India, about 1B hours watched a day). All of it labeled est. is for fun, not fact. Times are as shown in your Google export. Ad views Google logs in your history are left out.
  ${shared ? "" : '<div class="forget"><button class="btn" id="forget">Forget my data</button><span>Removes the saved wrap from this browser.</span></div>'}</div>`;

  setView("dash");
  const yr = $("yr"); if (yr) { yr.value = S.sel; yr.onchange = e => { S.sel = e.target.value; render(); window.scrollTo(0, 0); }; }
  const ks = $("kind"); if (ks) { ks.value = S.kind; ks.onchange = e => { setKind(e.target.value); render(); window.scrollTo(0, 0); }; }
  const fg = $("forget"); if (fg) fg.onclick = forget;
  buildShare(v, d);
}

/* ---------- share cards ---------- */
function shareText(v, d) { if (S.kind === "search") return `My YouTube searches (${d.yearLabel}): ${fmt(v.count)} searches, mostly about ${d.topic}. #YouTubeWrapped`; return `My YouTube Wrapped (${d.yearLabel}): ${fmt(v.count)} videos, about ${fmt(d.hours)} hours, mostly ${d.topic}. I'm "${d.persona[0]}" (est. top ${d.topLbl}% in India). #YouTubeWrapped`; }
function drawCard(kind, v, d) {
  const W = 1080, H = 1350, cv = document.createElement("canvas"); cv.width = W; cv.height = H; const c = cv.getContext("2d");
  const F = (w, s) => `${w} ${s}px "Funnel Sans", ui-sans-serif, system-ui, sans-serif`;
  const rr = (x, y, w, h, r) => { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); };
  const fit = (t, mw, font) => { c.font = font; if (c.measureText(t).width <= mw) return t; while (t.length > 1 && c.measureText(t + "…").width > mw) t = t.slice(0, -1); return t.trimEnd() + "…"; };
  const glow = (col, b) => { c.shadowColor = col; c.shadowBlur = b; };
  const glass = (x, y, w, h, r, warm) => {
    c.save(); c.shadowColor = "rgba(0,0,0,.45)"; c.shadowBlur = 50; c.shadowOffsetY = 20; rr(x, y, w, h, r);
    const g = c.createLinearGradient(x, y, x + w, y + h);
    if (warm) { g.addColorStop(0, "rgba(255,138,53,.30)"); g.addColorStop(1, "rgba(255,122,26,.08)"); } else { g.addColorStop(0, "rgba(255,255,255,.10)"); g.addColorStop(1, "rgba(255,255,255,.025)"); }
    c.fillStyle = g; c.fill(); c.restore(); c.save(); rr(x, y, w, h, r); c.strokeStyle = warm ? "rgba(255,150,70,.55)" : "rgba(255,255,255,.14)"; c.lineWidth = 2; c.stroke(); c.restore();
  };
  c.fillStyle = "#141414"; c.fillRect(0, 0, W, H);
  let g = c.createRadialGradient(W * .88, H * .1, 0, W * .88, H * .1, 760); g.addColorStop(0, "rgba(255,122,26,.42)"); g.addColorStop(1, "rgba(255,122,26,0)"); c.fillStyle = g; c.fillRect(0, 0, W, H);
  g = c.createRadialGradient(W * .08, H * .95, 0, W * .08, H * .95, 720); g.addColorStop(0, "rgba(255,96,10,.30)"); g.addColorStop(1, "rgba(255,96,10,0)"); c.fillStyle = g; c.fillRect(0, 0, W, H);
  c.fillStyle = "rgba(255,255,255,.045)"; for (let x = 36; x < W; x += 36) for (let y = 36; y < H; y += 36) { c.beginPath(); c.arc(x, y, 1.6, 0, 7); c.fill(); }
  c.textBaseline = "alphabetic"; c.textAlign = "left"; c.fillStyle = "#ededed"; c.font = F(600, 40); c.fillText("Wrap up", 72, 112);
  c.fillStyle = "rgba(255,255,255,.45)"; c.font = F(400, 34); c.textAlign = "right"; c.fillText(v.year === "all" ? "All time" : String(v.year), W - 72, 112);
  c.textAlign = "left"; c.font = F(400, 28); c.fillStyle = "rgba(255,255,255,.4)"; c.fillText("Made with Wrap up · estimates marked est.", 72, H - 64);
  const eyebrow = t => { c.fillStyle = "#ff9a4d"; c.font = F(500, 30); c.fillText(t.toUpperCase(), 72, 236); };

  if (kind === "overview") {
    eyebrow("My YouTube year");
    c.fillStyle = "#ededed"; c.font = F(500, 124); c.fillText("My YouTube,", 72, 380);
    c.save(); glow("rgba(255,122,26,.7)", 40); c.fillStyle = "#ff7a1a"; c.fillText("wrapped.", 72, 510); c.restore();
    glass(72, 590, W - 144, 190, 28, false);
    c.fillStyle = "rgba(255,255,255,.55)"; c.font = F(400, 28); c.fillText("Viewer type", 108, 646);
    c.fillStyle = "#fff"; c.font = F(600, 62); c.fillText(fit(d.persona[0], W - 216, F(600, 62)), 108, 716);
    c.fillStyle = "rgba(255,255,255,.6)"; c.font = F(400, 30); c.fillText(fit(d.persona[1], W - 216, F(400, 30)), 108, 762);
    const tw = (W - 144 - 56) / 3;
    (S.kind === "search" ? [["Searches", fmt(v.count)], ["Per active day", (v.count / Math.max(v.activeDays, 1)).toFixed(1)], ["Topics", fmt(v.uniqueChannels)]] : [["Videos", fmt(v.count)], ["Hours (est.)", fmt(d.hours)], ["Channels", fmt(v.uniqueChannels)]]).forEach((s, i) => { const x = 72 + i * (tw + 28); glass(x, 820, tw, 230, 26, false); c.fillStyle = "rgba(255,255,255,.55)"; c.font = F(400, 26); c.fillText(s[0], x + 28, 876); c.fillStyle = "#fff"; c.font = F(500, s[1].length > 5 ? 64 : 78); c.fillText(s[1], x + 28, 968); });
    glass(72, 1090, 500, 100, 50, true); const isSr = S.kind === "search", rt = isSr ? `${fmt(v.activeDays)} active days` : `Top ${d.topLbl}% in India`; c.fillStyle = "#ffd2ac"; c.font = F(600, 38); c.fillText(rt, 108, 1152); const rw = c.measureText(rt).width; if (!isSr) { c.font = F(400, 24); c.fillStyle = "rgba(255,210,170,.7)"; c.fillText("est.", 108 + rw + 12, 1152); }
    glass(596, 1090, W - 596 - 72, 100, 50, false); c.fillStyle = "#ffb27a"; c.font = F(500, 34); c.fillText(fit(d.topic + " fan", W - 596 - 72 - 60, F(500, 34)), 630, 1152);
  }
  if (kind === "topics") {
    eyebrow("What I watch"); c.fillStyle = "#ededed"; c.font = F(500, 100); c.fillText("My top topics", 72, 360);
    const tt = v.topics.reduce((a, t) => a + t[1], 0) || 1, ts = v.topics.slice(0, 5), cx = W / 2, cy = 720, R = 215, T = 72; let a = -Math.PI / 2;
    c.beginPath(); c.arc(cx, cy, R, 0, 7); c.strokeStyle = "rgba(255,255,255,.07)"; c.lineWidth = T; c.stroke();
    ts.forEach((k, i) => { const pc = k[1] / tt, sw = pc * Math.PI * 2; c.save(); if (i === 0) glow("rgba(255,122,26,.8)", 36); c.beginPath(); c.arc(cx, cy, R, a + .02, a + Math.max(sw - .02, .02)); c.strokeStyle = COL[i]; c.lineWidth = T; c.stroke(); c.restore(); a += sw; });
    c.textAlign = "center"; c.fillStyle = "#fff"; c.font = F(500, 104); c.fillText(Math.round(ts[0][1] / tt * 100) + "%", cx, cy + 22); c.fillStyle = "rgba(255,255,255,.6)"; c.font = F(400, 34); c.fillText(fit(ts[0][0], 300, F(400, 34)), cx, cy + 76); c.textAlign = "left";
    glass(72, 1000, W - 144, 260, 28, false);
    ts.forEach((k, i) => { const y = 1062 + i * 44; c.fillStyle = COL[i]; c.beginPath(); c.arc(112, y - 10, 9, 0, 7); c.fill(); c.fillStyle = "#ededed"; c.font = F(400, 32); c.fillText(fit(k[0], 560, F(400, 32)), 138, y); c.textAlign = "right"; c.fillStyle = "rgba(255,255,255,.6)"; c.fillText(Math.round(k[1] / tt * 100) + "%", W - 108, y); c.textAlign = "left"; });
  }
  if (kind === "rank") {
    eyebrow("My rank in India (est.)");
    c.textAlign = "center"; c.save(); glow("rgba(255,122,26,.75)", 70); c.fillStyle = "#ffb27a"; c.font = F(600, 250); c.fillText(`Top ${d.topLbl}%`, W / 2, 640); c.restore();
    c.fillStyle = "rgba(255,255,255,.65)"; c.font = F(400, 38); c.fillText("of ~" + compact(BM.indiaUsers) + " Indian YouTube users", W / 2, 718); c.textAlign = "left";
    const gx = 120, gw = W - 240, gy = 880, lg = c.createLinearGradient(gx, 0, gx + gw, 0); lg.addColorStop(0, "#333"); lg.addColorStop(.7, "#ffa24d"); lg.addColorStop(1, "#ff7a1a");
    rr(gx, gy, gw, 18, 9); c.fillStyle = lg; c.fill(); const mx = gx + gw * Math.min(.97, Math.max(.03, d.pct));
    c.save(); glow("rgba(255,122,26,.9)", 30); c.fillStyle = "#fff"; c.beginPath(); c.arc(mx, gy + 9, 20, 0, 7); c.fill(); c.restore();
    c.textAlign = "center"; c.fillStyle = "#ff7a1a"; c.font = F(600, 32); c.fillText(ord(Math.round(d.pct * 100)) + " percentile", mx, gy - 38); c.textAlign = "left";
    c.fillStyle = "rgba(255,255,255,.45)"; c.font = F(400, 26); c.fillText("Casual", gx, gy + 68); c.textAlign = "center"; c.fillText("Regular", W / 2, gy + 68); c.textAlign = "right"; c.fillText("Superfan", gx + gw, gy + 68); c.textAlign = "left";
    const tw = (W - 144 - 28) / 2;
    [["Videos watched", fmt(v.count)], ["Longest streak", fmt(v.longestStreak) + " days"]].forEach((s, i) => { const x = 72 + i * (tw + 28); glass(x, 1040, tw, 190, 26, false); c.fillStyle = "rgba(255,255,255,.55)"; c.font = F(400, 26); c.fillText(s[0], x + 30, 1100); c.fillStyle = "#fff"; c.font = F(500, s[1].length > 8 ? 60 : 76); c.fillText(s[1], x + 30, 1192); });
  }
  if (kind === "channels") {
    eyebrow(S.kind === "search" ? "My top search terms" : "My top channels"); c.fillStyle = "#ededed"; c.font = F(500, 100); c.fillText(TXT[S.kind].topShort, 72, 360);
    const rows = v.topChannels.slice(0, 5), mxv = (rows[0] && rows[0][1]) || 1;
    rows.forEach(([n, k], i) => {
      const y = 430 + i * 152; glass(72, y, W - 144, 132, 24, i === 0);
      c.fillStyle = "#ff9a4d"; c.font = F(600, 54); c.fillText(String(i + 1), 108, y + 84);
      c.fillStyle = "#fff"; c.font = F(500, 40); c.fillText(fit(n, 560, F(500, 40)), 176, y + 62);
      rr(176, y + 84, 520, 8, 4); c.fillStyle = "rgba(255,255,255,.1)"; c.fill(); c.save(); glow("rgba(255,122,26,.7)", 14); rr(176, y + 84, Math.max(520 * k / mxv, 8), 8, 4); c.fillStyle = "#ff9a4d"; c.fill(); c.restore();
      c.textAlign = "right"; c.fillStyle = "rgba(255,255,255,.6)"; c.font = F(400, 32); c.fillText(fmt(k) + (S.kind === "search" ? " searches" : " videos"), W - 108, y + 78); c.textAlign = "left";
    });
  }
  if (kind === "rhythm") {
    eyebrow("When I watch"); c.fillStyle = "#ededed"; c.font = F(500, 100); c.fillText("My prime time", 72, 360);
    c.save(); glow("rgba(255,122,26,.75)", 60); c.fillStyle = "#ffb27a"; c.font = F(600, 190); c.fillText(hr12(d.peak), 72, 560); c.restore();
    c.fillStyle = "rgba(255,255,255,.6)"; c.font = F(400, 36); c.fillText(`${Math.round(v.nightPct)}% of my watching is after 10pm`, 72, 625);
    glass(72, 680, W - 144, 360, 28, false);
    const order = [1, 2, 3, 4, 5, 6, 0], mx = Math.max(...v.heat.flat(), 1), gx = 150, gy = 720, cw = (W - 144 - 110) / 24, ch = 40;
    order.forEach((wd, r) => { c.fillStyle = "rgba(255,255,255,.5)"; c.font = F(400, 24); c.fillText(DAYS[wd], 104, gy + r * (ch + 6) + 28); for (let h = 0; h < 24; h++) { const o = .07 + .93 * Math.pow(v.heat[wd][h] / mx, .55); c.fillStyle = `rgba(255,122,26,${o.toFixed(2)})`; rr(gx + h * cw + 2, gy + r * (ch + 6), cw - 4, ch, 6); c.fill(); } });
    const tw = (W - 144 - 28) / 2;
    [["Longest streak", fmt(v.longestStreak) + " days"], ["Active days", fmt(v.activeDays)]].forEach((s, i) => { const x = 72 + i * (tw + 28); glass(x, 1080, tw, 170, 26, false); c.fillStyle = "rgba(255,255,255,.55)"; c.font = F(400, 26); c.fillText(s[0], x + 30, 1138); c.fillStyle = "#fff"; c.font = F(500, 64); c.fillText(s[1], x + 30, 1214); });
  }
  return cv;
}
function dl(blob, kind) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `wrap-up-${kind}.png`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
async function shareCanvas(cv, kind, text) {
  const blob = await new Promise(r => cv.toBlob(r, "image/png"));
  const file = new File([blob], `wrap-up-${kind}.png`, { type: "image/png" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], text }); return; } catch (e) { if (e.name === "AbortError") return; } }
  dl(blob, kind); toast("Image downloaded. Attach it to your post.");
}
function buildShare(v, d) {
  const box = $("shares"); if (!box) return; box.textContent = ""; const my = ++shareGen;
  const isS = S.kind === "search", kinds = [["overview", "Overview"], ["topics", "Top topics"]].concat(isS ? [] : [["rank", "India rank"]], [["channels", isS ? "Top search terms" : "Top channels"], ["rhythm", "Prime time"]]), text = shareText(v, d);
  const go = () => { if (my !== shareGen) return; kinds.forEach(([k, name]) => {
    const cv = drawCard(k, v, d), t = document.createElement("div"); t.className = "tile"; cv.setAttribute("role", "img"); cv.setAttribute("aria-label", name + " share card"); t.appendChild(cv);
    const tn = document.createElement("div"); tn.className = "tn"; tn.textContent = name; t.appendChild(tn);
    const tb = document.createElement("div"); tb.className = "tb";
    const b1 = document.createElement("button"); b1.className = "btn"; b1.textContent = "Download"; b1.onclick = () => cv.toBlob(b => dl(b, k), "image/png");
    const b2 = document.createElement("button"); b2.className = "btn pri"; b2.textContent = "Share"; b2.onclick = () => shareCanvas(cv, k, text);
    tb.append(b1, b2); t.appendChild(tb); box.appendChild(t); }); };
  const fonts = document.fonts ? Promise.all(["400", "500", "600"].map(w => document.fonts.load(`${w} 40px "Funnel Sans"`).catch(() => {}))) : Promise.resolve();
  fonts.then(go);
  // share link: summary only, built in the browser
  let link = "";
  const q = () => encodeURIComponent(text + (link ? " " + link : ""));
  const setHrefs = () => { $("sx").href = "https://twitter.com/intent/tweet?text=" + q(); $("sw").href = "https://wa.me/?text=" + q(); $("sl").href = "https://www.linkedin.com/feed/?shareActive=true&text=" + q(); };
  setHrefs();
  WrapLib.encodeShare(v, S.kind, S.subs).then(code => { if (my !== shareGen) return; link = location.href.split("#")[0] + "#w=" + code; setHrefs(); }).catch(() => {});
  $("slink").onclick = async () => {
    if (!link) { toast("Still preparing the link. Try again in a second."); return; }
    if (navigator.share && /Mobi|Android/i.test(navigator.userAgent || "")) { try { await navigator.share({ url: link, text }); return; } catch (e) { if (e.name === "AbortError") return; } }
    if (!navigator.clipboard) { toast("Copy isn't available here. Use the share buttons instead."); return; }
    navigator.clipboard.writeText(link).then(() => toast("Link copied. Anyone with it can see your summary stats."), () => toast("Couldn't copy the link."));
  };
}

/* ---------- upload ---------- */
function setDrop(state, msg) { const dz = $("drop"); dz.className = "drop" + (state ? " " + state : ""); $("dropmsg").textContent = msg || ""; }
const tick = () => new Promise(r => setTimeout(r, 30));
async function handleFiles(list) {
  const files = Array.from(list || []); if (!files.length || busy) return;
  busy = true; setDrop("work", "Reading your file…");
  try {
    const r = await WrapLib.extract(files, m => setDrop("work", m));
    if (!r.watches.length && !r.searches.length) { setDrop("err", r.problems.join(" ")); return; }
    setDrop("work", `Crunching ${fmt(r.watches.length + r.searches.length)} entries…`); await tick();
    setData({ watch: r.watches.length ? WrapLib.summarize(r.watches) : null, search: r.searches.length ? WrapLib.summarize(r.searches) : null }, r.subs, "live");
    S.notes = r.notes.concat(r.problems);
    if ($("remember").checked) { if (save()) S.savedAt = Date.now(); else toast("Couldn't save in this browser (private mode or storage full). Your wrap still works for this visit."); } else clearStored();
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    setDrop("", ""); render(); window.scrollTo(0, 0);
  } catch (e) { setDrop("err", (e && e.message) || "Something went wrong reading that file."); }
  finally { busy = false; $("file").value = ""; }
}
function startDemo() {
  setData({ watch: WrapLib.summarize(WrapLib.demoWatches()), search: WrapLib.summarize(WrapLib.demoSearches()) }, 42, "demo"); S.notes = []; render(); window.scrollTo(0, 0);
}
function forget() {
  clearStored(); Object.assign(S, { data: { watch: null, search: null }, kind: "watch", notes: [], sums: null, subs: null, sel: "all", mode: "none", savedAt: 0 }); shareGen++;
  setMenu(false); $("dash").textContent = ""; setDrop("", ""); setView("gate"); window.scrollTo(0, 0); toast("Your data was removed from this browser.");
}
function showUpload() { setMenu(false); setView("gate"); $("how").scrollIntoView({ behavior: "smooth", block: "start" }); }
function backToWrap() { if (S.sums) { render(); window.scrollTo(0, 0); } }
function setMenu(o) { $("menu").classList.toggle("open", o); $("avbtn").setAttribute("aria-expanded", o ? "true" : "false"); }

/* ---------- boot ---------- */
async function boot() {
  const h = location.hash;
  if (h.startsWith("#w=")) {
    try { const { summary, subs, kind } = await WrapLib.decodeShare(h.slice(3)); const one = { years: [], by: { all: summary } }; S.data = { watch: kind === "watch" ? one : null, search: kind === "search" ? one : null }; S.kind = kind; S.sums = one; S.sel = "all"; S.subs = subs; S.mode = "shared"; S.notes = []; render(); return; }
    catch (e) { toast(e.message); history.replaceState(null, "", location.pathname + location.search); if (S.mode === "shared") Object.assign(S, { data: { watch: null, search: null }, sums: null, subs: null, mode: "none" }); }
  }
  if (CFG.autoDemo || new URLSearchParams(location.search).get("demo") === "1") { startDemo(); return; }
  const saved = loadSaved();
  if (saved) { setData(saved.data, saved.subs, "live"); S.notes = []; S.savedAt = saved.savedAt || Date.now(); render(); return; }
  setView("gate");
}
function wire() {
  const dz = $("drop"), input = $("file");
  dz.addEventListener("click", e => { if (e.target.closest("label")) return; input.click(); });
  dz.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
  ["dragenter", "dragover"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add("over"); }));
  ["dragleave", "drop"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove("over"); }));
  dz.addEventListener("drop", e => handleFiles(e.dataTransfer && e.dataTransfer.files));
  input.addEventListener("change", () => handleFiles(input.files));
  window.addEventListener("dragover", e => e.preventDefault()); window.addEventListener("drop", e => e.preventDefault());
  $("start").onclick = () => $("how").scrollIntoView({ behavior: "smooth", block: "start" });
  $("demo").onclick = startDemo; $("demo2").onclick = startDemo;
  $("back").onclick = backToWrap; $("makeown").onclick = () => { history.replaceState(null, "", location.pathname + location.search); Object.assign(S, { data: { watch: null, search: null }, sums: null, subs: null, mode: "none" }); $("dash").textContent = ""; setView("gate"); window.scrollTo(0, 0); };
  $("home").onclick = e => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); };
  $("avbtn").onclick = e => { e.stopPropagation(); setMenu(!$("menu").classList.contains("open")); };
  $("m-upload").onclick = showUpload; $("m-forget").onclick = forget;
  $("m-share").onclick = () => { setMenu(false); const s = $("share"); if (s) s.scrollIntoView({ behavior: "smooth" }); };
  document.addEventListener("click", () => setMenu(false));
  document.addEventListener("keydown", e => { if (e.key === "Escape" && $("menu").classList.contains("open")) { setMenu(false); $("avbtn").focus(); } });
  window.addEventListener("hashchange", () => { if (location.hash.startsWith("#w=")) boot(); });
  const layer = $("layer"), hero = $("gate");
  if (layer && !(window.matchMedia && matchMedia("(prefers-reduced-motion:reduce)").matches)) {
    hero.addEventListener("mousemove", e => { const r = hero.getBoundingClientRect(); layer.style.setProperty("--mx", ((e.clientX - r.left) / r.width - .5) * 2); layer.style.setProperty("--my", ((e.clientY - r.top) / r.height - .5) * 2); });
    hero.addEventListener("mouseleave", () => { layer.style.setProperty("--mx", 0); layer.style.setProperty("--my", 0); });
  }
}
wire(); boot();
