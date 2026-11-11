/* Wrap up: analysis engine. Pure functions, no DOM, no network.
   Reads a Google Takeout export (zip or loose files), builds per-year summaries,
   and encodes/decodes shareable links. Everything runs in the browser. */
(function (root) {
  "use strict";

  const LIMITS = { maxEntryBytes: 600e6, maxShareBytes: 200e3 };
  const MIN_PER_VIDEO = 7; // assumption used for estimated hours (Takeout has no durations)
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  /* ---------- topics (estimated from titles and channel names) ---------- */
  const TOPIC_RULES = [
    ["Music", /\b(official (music )?video|lyrics?|lyrical|audio|remix|mashup|songs?|album|ft\.?|feat\.?|live performance|unplugged|acoustic|lofi|lo-fi|vevo|t-series|sony music|zee music|saregama|jukebox)\b/i],
    ["Gaming", /\b(gameplay|walkthrough|let'?s play|minecraft|valorant|gta|bgmi|pubg|fortnite|roblox|speedrun|ps5|xbox|steam|esports?|free fire|cs2|apex|elden ring|zelda|pokemon|boss fight)\b/i],
    ["Tech", /\b(unboxing|iphone|android|samsung|laptop|smartphone|gadgets?|benchmarks?|chatgpt|openai|ai|llm|coding|programming|python|javascript|react|linux|kubernetes|api|developers?|software|cpu|gpu|nvidia|macbook|pixel|tech)\b/i],
    ["News", /\b(news|breaking|election|parliament|debate|politic\w*|budget|live updates?|headlines|ndtv|aaj tak|cnn|bbc)\b/i],
    ["Comedy", /\b(funny|comedy|roast|memes?|stand[- ]?up|prank|skit|laugh|jokes?|bloopers?)\b/i],
    ["Sports", /\b(cricket|ipl|t20|odi|test match|football|fifa|premier league|nba|nfl|tennis|f1|formula 1|highlights|goal|kohli|messi|ronaldo|wwe|ufc|olympics)\b/i],
    ["Learning", /\b(tutorial|how to|explained|lecture|course|learn|lesson|physics|chemistry|maths?|mathematics|history|science|documentary|ted|exam|upsc|jee|neet|class \d+|crash course|masterclass)\b/i],
    ["Movies & TV", /\b(trailer|teaser|scene|movie|film|episode|web series|season|netflix|prime video|hotstar|bollywood|recap|ending explained)\b/i],
    ["Food & Lifestyle", /\b(recipe|cooking|cook|food|street food|vlog|travel|trip|fitness|workout|gym|yoga|skincare|makeup|fashion|diy|home tour|minimalism)\b/i]
  ];
  function classify(title, channel, isMusic) {
    if (isMusic) return "Music";
    const text = title + " " + channel;
    let best = "Other", score = 0;
    for (const [name, re] of TOPIC_RULES) { if (re.test(text)) { const s = 1; if (s > score) { score = s; best = name; } } }
    return best;
  }

  /* ---------- parsing ---------- */
  function parseWatchHistory(arr) {
    const out = [];
    for (const x of arr) {
      if (!x || typeof x.titleUrl !== "string") continue;
      let u; try { u = new URL(x.titleUrl); } catch (_) { continue; }
      if (!/(^|\.)youtube\.com$/.test(u.hostname) && u.hostname !== "youtu.be") continue;
      let id = u.searchParams.get("v");
      if (!id) { const m = /^\/shorts\/([\w-]{6,})/.exec(u.pathname); id = m ? m[1] : null; }
      if (!id) continue;
      if (Array.isArray(x.details) && x.details.some(d => /google ads/i.test((d && d.name) || ""))) continue; // skip ad impressions
      const t = Date.parse(x.time); if (!isFinite(t)) continue;
      let title = String(x.title || "").replace(/^Watched\s+/, "");
      if (!title || title === x.titleUrl) title = "Removed video";
      const ch = String((x.subtitles && x.subtitles[0] && x.subtitles[0].name) || "Unknown channel");
      const music = /music/i.test(String(x.header || ""));
      out.push({ t, id, title: title.slice(0, 200), ch: ch.slice(0, 120), topic: classify(title, ch, music) });
    }
    return out;
  }
  function looksLikeWatchHistory(arr) {
    if (!Array.isArray(arr) || !arr.length) return false;
    const probe = arr.slice(0, 50); let hits = 0;
    for (const x of probe) if (x && typeof x.titleUrl === "string" && /youtube\.com\/(watch|shorts)|youtu\.be\//.test(x.titleUrl)) hits++;
    return hits / probe.length >= 0.5;
  }
  function countSubscriptions(csv) {
    const lines = String(csv).split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return null;
    const first = lines[1].split(",")[0].replace(/"/g, "").trim();
    if (!/^UC[\w-]{22}$/.test(first)) return null; // channel IDs; other CSVs (playlists, etc.) are ignored
    return lines.length - 1;
  }

  /* ---------- zip reading (no libraries) ---------- */
  async function inflateRaw(blob) {
    if (typeof DecompressionStream === "undefined") throw new Error("Your browser is too old to read zip files. Update it, or unzip the file and drop watch-history.json instead.");
    return new Response(blob.stream().pipeThrough(new DecompressionStream("deflate-raw"))).text();
  }
  async function readZip(file) {
    const size = file.size, tailLen = Math.min(size, 65557);
    const tail = new DataView(await file.slice(size - tailLen, size).arrayBuffer());
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("That doesn't look like a valid .zip file.");
    const total = tail.getUint16(eocd + 10, true), cdSize = tail.getUint32(eocd + 12, true), cdOff = tail.getUint32(eocd + 16, true);
    if (total === 0xFFFF || cdOff === 0xFFFFFFFF) throw new Error("This zip is too large to read. Re-export with only History and Subscriptions selected.");
    const buf = await file.slice(cdOff, cdOff + cdSize).arrayBuffer();
    const cd = new DataView(buf), u8 = new Uint8Array(buf), dec = new TextDecoder("utf-8");
    const entries = []; let p = 0;
    for (let i = 0; i < total; i++) {
      if (p + 46 > cd.byteLength || cd.getUint32(p, true) !== 0x02014b50) break;
      const method = cd.getUint16(p + 10, true), csize = cd.getUint32(p + 20, true), usize = cd.getUint32(p + 24, true);
      const n = cd.getUint16(p + 28, true), e = cd.getUint16(p + 30, true), c = cd.getUint16(p + 32, true), off = cd.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + n));
      entries.push({
        name, usize,
        async text() {
          if (usize > LIMITS.maxEntryBytes) throw new Error(name + " is too large to analyze in the browser.");
          const lh = new DataView(await file.slice(off, off + 30).arrayBuffer());
          if (lh.getUint32(0, true) !== 0x04034b50) throw new Error("The zip file looks damaged.");
          const start = off + 30 + lh.getUint16(26, true) + lh.getUint16(28, true), raw = file.slice(start, start + csize);
          if (method === 0) return raw.text();
          if (method === 8) return inflateRaw(raw);
          throw new Error("Unsupported zip compression.");
        }
      });
      p += 46 + n + e + c;
    }
    return entries;
  }

  /* ---------- extract from whatever the user dropped ---------- */
  async function extract(files, onProgress) {
    const say = onProgress || function () {};
    const state = { watches: [], subs: null, problems: [], sawHtmlHistory: false };
    const seen = new Set();
    const handle = (name, text) => {
      if (/\.json$/i.test(name)) {
        let arr; try { arr = JSON.parse(text); } catch (_) { return; }
        if (!looksLikeWatchHistory(arr)) return;
        say("Reading " + name.split("/").pop() + "…");
        for (const w of parseWatchHistory(arr)) { const k = w.t + "|" + w.id; if (!seen.has(k)) { seen.add(k); state.watches.push(w); } }
      } else if (/\.csv$/i.test(name)) {
        const n = countSubscriptions(text); if (n != null) state.subs = Math.max(state.subs || 0, n);
      }
    };
    for (const f of files) {
      const lower = String(f.name || "").toLowerCase();
      if (/\.zip$/.test(lower)) {
        say("Opening " + f.name + "…");
        const entries = await readZip(f);
        for (const en of entries) {
          if (/\/$/.test(en.name)) continue;
          if (/history.*\.html$/i.test(en.name)) state.sawHtmlHistory = true;
          if (!/\.(json|csv)$/i.test(en.name)) continue;
          if (/\.csv$/i.test(en.name) && en.usize > 20e6) continue;
          handle(en.name, await en.text());
        }
      } else if (/\.(json|csv)$/.test(lower)) {
        handle(lower, await f.text());
      } else if (/\.html?$/.test(lower)) {
        state.sawHtmlHistory = true;
      } else {
        state.problems.push((f.name || "A file") + " isn't a .zip, .json or .csv file.");
      }
    }
    if (!state.watches.length) {
      state.problems.push(state.sawHtmlHistory
        ? "Your export has the history as HTML. Export again and switch History from HTML to JSON (step 4)."
        : "We couldn't find any watch history in that file. Make sure History was ticked, watch history was turned on in YouTube, and the export format is JSON.");
    }
    state.watches.sort((a, b) => a.t - b.t);
    return state;
  }

  /* ---------- summaries ---------- */
  const pad = n => String(n).padStart(2, "0");
  const dayKey = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const topN = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

  function buildOne(list, mode, year, years) {
    const vids = new Map(), chans = new Map(), topics = new Map(), dayCounts = new Map();
    const heat = Array.from({ length: 7 }, () => Array(24).fill(0));
    const monthly = Array(12).fill(0), yearly = new Map();
    let night = 0, weekend = 0, first = null;
    for (const e of list) {
      const d = new Date(e.t), h = d.getHours(), wd = d.getDay();
      const key = e.id; let v = vids.get(key); if (!v) { v = { c: 0, title: e.title, ch: e.ch }; vids.set(key, v); } v.c++;
      chans.set(e.ch, (chans.get(e.ch) || 0) + 1);
      topics.set(e.topic, (topics.get(e.topic) || 0) + 1);
      heat[wd][h]++; monthly[d.getMonth()]++;
      yearly.set(d.getFullYear(), (yearly.get(d.getFullYear()) || 0) + 1);
      const dk = dayKey(d); dayCounts.set(dk, (dayCounts.get(dk) || 0) + 1);
      if (h >= 22 || h < 5) night++; if (wd === 0 || wd === 6) weekend++;
      if (!first || e.t < first.t) first = e;
    }
    const n = list.length;
    // streak
    const days = [...dayCounts.keys()].sort(); let best = 0, cur = 0, prev = null;
    for (const k of days) {
      const [y, m, d] = k.split("-").map(Number), ts = Date.UTC(y, m - 1, d);
      cur = prev !== null && ts - prev === 864e5 ? cur + 1 : 1; prev = ts; if (cur > best) best = cur;
    }
    const busiest = topN(dayCounts, 1)[0];
    let series;
    if (mode === "year") series = { labels: MONTHS.slice(), values: monthly };
    else { const ys = years.slice(-10); series = { labels: ys.map(String), values: ys.map(y => yearly.get(y) || 0) }; }
    return {
      count: n, uniqueVideos: vids.size, uniqueChannels: chans.size, rewatches: n - vids.size, activeDays: dayCounts.size, longestStreak: best,
      topChannels: topN(chans, 10), topics: topN(topics, 10),
      topVideos: [...vids.values()].sort((a, b) => b.c - a.c).slice(0, 10).map(v => [v.title, v.ch, v.c]),
      heat, series, busiest: busiest ? { date: busiest[0], count: busiest[1] } : null,
      first: first ? { t: first.t, title: first.title, ch: first.ch } : null,
      nightPct: n ? night / n * 100 : 0, weekendPct: n ? weekend / n * 100 : 0, year: mode === "year" ? year : "all"
    };
  }
  function summarize(watches) {
    const byYear = new Map();
    for (const w of watches) { const y = new Date(w.t).getFullYear(); if (!byYear.has(y)) byYear.set(y, []); byYear.get(y).push(w); }
    const years = [...byYear.keys()].sort((a, b) => a - b);
    const by = { all: buildOne(watches, "all", null, years) };
    for (const y of years) by[y] = buildOne(byYear.get(y), "year", y, years);
    for (const y of years) { const p = by[y - 1]; if (p) by[y].prev = { count: p.count, channels: p.uniqueChannels, active: p.activeDays }; }
    const spanYears = years.length ? Math.max(1, (watches[watches.length - 1].t - watches[0].t) / (365.25 * 864e5)) : 1;
    by.all.spanYears = spanYears;
    return { years: years.slice().reverse(), by };
  }

  /* ---------- validation of anything read from storage or a share link ---------- */
  const num = (x, max) => { x = +x; return isFinite(x) && x >= 0 ? Math.min(x, max == null ? 1e9 : max) : 0; };
  const str = (x, n) => String(x == null ? "" : x).slice(0, n == null ? 120 : n);
  function cleanSummary(x) {
    if (!x || typeof x !== "object" || !(num(x.count) > 0)) return null;
    const pairs = (a, n) => (Array.isArray(a) ? a : []).slice(0, n).filter(p => Array.isArray(p)).map(p => [str(p[0]), num(p[1])]);
    const heat = Array.from({ length: 7 }, (_, i) => Array.from({ length: 24 }, (_, j) => num(x.heat && x.heat[i] && x.heat[i][j])));
    const labels = (x.series && Array.isArray(x.series.labels) ? x.series.labels : []).slice(0, 12).map(l => str(l, 8));
    const values = (x.series && Array.isArray(x.series.values) ? x.series.values : []).slice(0, 12).map(v => num(v));
    const prev = x.prev && typeof x.prev === "object" ? { count: num(x.prev.count), channels: num(x.prev.channels), active: num(x.prev.active) } : null;
    return {
      count: num(x.count), uniqueVideos: num(x.uniqueVideos), uniqueChannels: num(x.uniqueChannels), rewatches: num(x.rewatches), activeDays: num(x.activeDays, 366 * 40), longestStreak: num(x.longestStreak, 366 * 40),
      topChannels: pairs(x.topChannels, 10), topics: pairs(x.topics, 10),
      topVideos: (Array.isArray(x.topVideos) ? x.topVideos : []).slice(0, 10).filter(p => Array.isArray(p)).map(p => [str(p[0], 200), str(p[1]), num(p[2])]),
      heat, series: { labels: labels.length === values.length ? labels : [], values: labels.length === values.length ? values : [] },
      busiest: x.busiest && /^\d{4}-\d{2}-\d{2}$/.test(String(x.busiest.date)) ? { date: String(x.busiest.date), count: num(x.busiest.count) } : null,
      first: x.first && typeof x.first === "object" ? { t: num(x.first.t, 4e12), title: str(x.first.title, 200), ch: str(x.first.ch) } : null,
      nightPct: num(x.nightPct, 100), weekendPct: num(x.weekendPct, 100), year: x.year === "all" ? "all" : (num(x.year, 3000) || "all"),
      spanYears: num(x.spanYears, 100) || 1, prev
    };
  }
  function cleanStore(x) {
    if (!x || typeof x !== "object" || !x.sums || !x.sums.by) return null;
    const by = {}; let any = false;
    for (const k of Object.keys(x.sums.by).slice(0, 60)) { if (k !== "all" && !/^\d{4}$/.test(k)) continue; const c = cleanSummary(x.sums.by[k]); if (c) { by[k] = c; any = true; } }
    if (!any || !by.all) return null;
    const years = Object.keys(by).filter(k => k !== "all").map(Number).sort((a, b) => b - a);
    return { sums: { years, by }, subs: x.subs == null ? null : num(x.subs, 1e6), savedAt: num(x.savedAt, 4e12) };
  }

  /* ---------- share links (#w=...) ---------- */
  function stripForShare(s) {
    const c = JSON.parse(JSON.stringify(s));
    c.topVideos = []; if (c.first) { c.first.title = ""; c.first.ch = ""; }
    return c;
  }
  const b64u = bytes => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
  const unb64u = t => { t = t.replace(/-/g, "+").replace(/_/g, "/"); while (t.length % 4) t += "="; const s = atob(t), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
  async function pipeBytes(bytes, stream) {
    const w = new Blob([bytes]).stream().pipeThrough(stream), r = w.getReader(), chunks = []; let total = 0;
    for (;;) { const { done, value } = await r.read(); if (done) break; total += value.length; if (total > LIMITS.maxShareBytes) { try { r.cancel(); } catch (_) {} throw new Error("Share link is too large."); } chunks.push(value); }
    const out = new Uint8Array(total); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; } return out;
  }
  async function encodeShare(summary, sub) {
    const payload = { v: 1, s: stripForShare(summary), subs: sub == null ? null : sub };
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    return b64u(await pipeBytes(bytes, new CompressionStream("deflate-raw")));
  }
  async function decodeShare(code) {
    if (!/^[A-Za-z0-9_-]{8,60000}$/.test(code)) throw new Error("That share link looks damaged.");
    let raw;
    try { raw = await pipeBytes(unb64u(code), new DecompressionStream("deflate-raw")); }
    catch (e) { throw new Error(/too large/.test(e.message) ? e.message : "That share link looks damaged."); }
    let p; try { p = JSON.parse(new TextDecoder().decode(raw)); } catch (_) { throw new Error("That share link looks damaged."); }
    if (!p || p.v !== 1) throw new Error("That share link is from a different version.");
    const s = cleanSummary(p.s); if (!s) throw new Error("That share link has no data.");
    return { summary: s, subs: p.subs == null ? null : num(p.subs, 1e6) };
  }

  /* ---------- estimates ---------- */
  function erf(x) { const s = Math.sign(x); x = Math.abs(x); const t = 1 / (1 + .3275911 * x); return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - .284496736) * t + .254829592) * t * Math.exp(-x * x)); }
  const lnCdf = (x, med, sig) => x <= 0 ? 0 : .5 * (1 + erf(Math.log(x / med) / (sig * Math.SQRT2)));

  /* ---------- demo data (deterministic) ---------- */
  function demoWatches() {
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647, pick = a => a[Math.floor(rnd() * a.length)];
    const chans = [["Lo-Fi Beats Lab", 1], ["Pixel Pioneers", 0], ["Tech Talk India", 0], ["The Daily Chuckle", 0], ["Code & Chai", 0], ["Match Day Highlights", 0], ["Desi Sketches", 0], ["Kitchen Chemistry", 0], ["Deep Dive Docs", 0], ["Vlog Squad", 0], ["Synth Wave Radio", 1], ["Speedrun Central", 0]];
    const titles = ["Why everyone is talking about", "Beginner's guide to", "I tried", "Ranking", "Inside", "The truth about", "Official video:", "Highlights:", "Explained:", "Walkthrough:"];
    const topics = ["retro consoles", "chai", "Rust", "mechanical keyboards", "Goa", "lo-fi", "IPL", "speedruns", "Python", "street food"];
    const now = Date.now(), out = [], reps = Array.from({ length: 14 }, (_, i) => "rep" + i);
    for (let i = 0; i < 6800; i++) {
      const ci = Math.min(chans.length - 1, Math.floor(Math.pow(rnd(), 1.7) * chans.length)), [ch, music] = chans[ci];
      const age = Math.pow(rnd(), 1.5) * 4.2 * 365 * 864e5, d = new Date(now - age);
      const night = rnd() < .5; d.setHours(night ? [22, 23, 0, 1, 2][Math.floor(rnd() * 5)] : 8 + Math.floor(rnd() * 13), Math.floor(rnd() * 60));
      const isRep = rnd() < .06, id = isRep ? pick(reps) : "v" + i;
      const title = isRep ? "Rain on a window (10 hours) " + id.slice(3) : pick(titles) + " " + pick(topics);
      out.push({ t: d.getTime(), id, title, ch, topic: classify(title, ch, music === 1) });
    }
    return out.sort((a, b) => a.t - b.t);
  }

  root.WrapLib = { MIN_PER_VIDEO, MONTHS, classify, parseWatchHistory, looksLikeWatchHistory, countSubscriptions, readZip, extract, summarize, cleanSummary, cleanStore, encodeShare, decodeShare, lnCdf, demoWatches, num, str };
})(typeof window !== "undefined" ? window : globalThis);
