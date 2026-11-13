/* Wrap up: analysis engine. Pure functions, no DOM, no network.
   Reads a Google Takeout export (zip or loose files; JSON or HTML history), builds per-year summaries
   of what you watched and what you searched, and encodes/decodes shareable links. Runs in the browser.

   Time model: every event's `t` is a "wall clock" value: the date and time as the user saw it, stored
   in UTC fields. Always read it with getUTC*() so results never depend on the viewer's time zone. */
(function (root) {
  "use strict";

  const LIMITS = { maxEntryBytes: 600e6, maxShareBytes: 200e3 };
  const MIN_PER_VIDEO = 7; // assumption used for estimated hours (Takeout has no durations)
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  /* ---------- topics (estimated from titles / queries and channel names) ---------- */
  const TOPIC_RULES = [
    ["Music", /\b(official (music )?video|lyrics?|lyrical|audio|remix|mashup|songs?|album|ft\.?|feat\.?|live performance|unplugged|acoustic|lofi|lo-fi|vevo|t-series|sony music|zee music|saregama|jukebox)\b/i],
    ["Gaming", /\b(gameplay|walkthrough|let'?s play|minecraft|valorant|gta|bgmi|pubg|fortnite|roblox|speedrun|ps5|xbox|steam|esports?|free fire|cs2|apex|elden ring|zelda|pokemon|boss fight)\b/i],
    ["Tech", /\b(unboxing|iphone|android|samsung|laptop|smartphone|gadgets?|benchmarks?|chatgpt|openai|ai|llm|coding|programming|python|javascript|react|linux|kubernetes|api|developers?|software|cpu|gpu|nvidia|macbook|pixel|tech)\b/i],
    ["News", /\b(news|breaking|election|parliament|debate|politic\w*|budget|live updates?|headlines|ndtv|aaj tak|cnn|bbc|speech|senate|congress)\b/i],
    ["Comedy", /\b(funny|comedy|roast|memes?|stand[- ]?up|prank|skit|laugh|jokes?|bloopers?)\b/i],
    ["Sports", /\b(cricket|ipl|t20|odi|test match|football|fifa|premier league|nba|nfl|tennis|f1|formula 1|highlights|goals?|free ?kicks?|kohli|messi|ronaldo|wwe|ufc|olympics)\b/i],
    ["Learning", /\b(tutorial|how to|explained|lecture|course|learn|lesson|physics|chemistry|maths?|mathematics|history|science|documentary|ted|exam|upsc|jee|neet|class \d+|crash course|masterclass)\b/i],
    ["Movies & TV", /\b(trailer|teaser|scene|movie|film|episode|web series|season|netflix|prime video|hotstar|bollywood|recap|ending explained)\b/i],
    ["Food & Lifestyle", /\b(recipe|cooking|cook|food|street food|vlog|travel|trip|fitness|workout|gym|yoga|skincare|makeup|fashion|diy|home tour|minimalism)\b/i]
  ];
  function classify(title, channel, isMusic) {
    if (isMusic) return "Music";
    const text = title + " " + channel;
    for (const [name, re] of TOPIC_RULES) if (re.test(text)) return name;
    return "Other";
  }
  const STOP = new Set("the and for with from that this what how why who when where which are was were you your yours not but can has have had will would could should about into over under than then them they their there here out off all any more most some such only own same just too very one two new best top vs and&".split(" "));
  function searchWords(q) {
    const toks = String(q).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || [];
    const out = []; for (const t of toks) if (t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t) && out.indexOf(t) < 0) out.push(t);
    return out.slice(0, 6);
  }

  /* ---------- time ---------- */
  const wallFromUtc = t => t - new Date(t).getTimezoneOffset() * 60000; // UTC instant -> the viewer's local wall clock
  const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  function parseActivityDate(s) {
    s = String(s).replace(/[  ]/g, " ");
    let m = /([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4}),? (\d{1,2}):(\d{2})(?::(\d{2}))?\s?([AaPp]\.?[Mm]\.?)?/.exec(s), mo, d, y, h, mi, se, ap;
    if (m) { mo = MON[m[1].toLowerCase()]; d = +m[2]; y = +m[3]; h = +m[4]; mi = +m[5]; se = +(m[6] || 0); ap = m[7]; }
    else {
      m = /(\d{1,2}) ([A-Za-z]{3})[a-z]*\.? (\d{4}),? (\d{1,2}):(\d{2})(?::(\d{2}))?\s?([AaPp]\.?[Mm]\.?)?/.exec(s);
      if (!m) return null; d = +m[1]; mo = MON[m[2].toLowerCase()]; y = +m[3]; h = +m[4]; mi = +m[5]; se = +(m[6] || 0); ap = m[7];
    }
    if (mo == null || h > 23 || mi > 59 || se > 59 || d < 1 || d > 31) return null;
    if (ap) { const pm = /p/i.test(ap); if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
    return Date.UTC(y, mo, d, h, mi, se);
  }

  /* ---------- parsing: JSON ---------- */
  const isYT = u => /(^|\.)youtube\.com$/.test(u.hostname) || u.hostname === "youtu.be";
  function classifyUrl(href) {
    let u; try { u = new URL(href); } catch (_) { return null; }
    if (!isYT(u)) return null;
    const q = u.searchParams.get("search_query");
    if (u.pathname === "/results" && q) return { type: "search", q };
    let id = u.searchParams.get("v");
    if (!id) { const m = /^\/shorts\/([\w-]{6,})/.exec(u.pathname); id = m ? m[1] : null; }
    if (!id && u.hostname === "youtu.be") id = u.pathname.slice(1) || null;
    return id ? { type: "watch", id } : null;
  }
  const mkWatch = (t, id, title, ch, music) => ({ t, id, title: title.slice(0, 200), ch: ch.slice(0, 120), topic: classify(title, ch, music) });
  const mkSearch = (t, q) => { q = q.trim().slice(0, 200); return { t, id: q.toLowerCase(), title: q, ch: "", words: searchWords(q), topic: classify(q, "", false) }; };

  function parseHistoryJson(arr) {
    const watches = [], searches = []; let ads = 0;
    for (const x of arr) {
      if (!x || typeof x.titleUrl !== "string") continue;
      const c = classifyUrl(x.titleUrl); if (!c) continue;
      if (Array.isArray(x.details) && x.details.some(d => /google ads/i.test((d && d.name) || ""))) { ads++; continue; }
      const t0 = Date.parse(x.time); if (!isFinite(t0)) continue; const t = wallFromUtc(t0);
      if (c.type === "search") { const q = String(x.title || "").replace(/^Searched for\s+/, "") || c.q; if (q) searches.push(mkSearch(t, q)); continue; }
      let title = String(x.title || "").replace(/^Watched\s+/, ""); if (!title || title === x.titleUrl) title = "Removed video";
      const ch = String((x.subtitles && x.subtitles[0] && x.subtitles[0].name) || "Unknown channel");
      watches.push(mkWatch(t, c.id, title, ch, /music/i.test(String(x.header || ""))));
    }
    return { watches, searches, ads };
  }
  const parseWatchHistory = arr => parseHistoryJson(arr).watches; // kept for callers that only want watches
  function looksLikeActivity(arr) {
    if (!Array.isArray(arr) || !arr.length) return false;
    const probe = arr.slice(0, 50); let hits = 0;
    for (const x of probe) if (x && typeof x.titleUrl === "string" && /youtube\.com\/(watch|shorts|results)|youtu\.be\//.test(x.titleUrl)) hits++;
    return hits / probe.length >= 0.5;
  }
  const looksLikeWatchHistory = looksLikeActivity;

  /* ---------- parsing: HTML ("My Activity" pages) ---------- */
  const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", emsp: " ", ensp: " " };
  const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ""; }
    return ENT[e.toLowerCase()] != null ? ENT[e.toLowerCase()] : m;
  });
  const stripTags = s => s.replace(/<[^>]*>/g, "");
  const MAIN = '<div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">', CAP = "mdl-typography--caption";
  function parseActivityHtml(html) {
    const watches = [], searches = []; let ads = 0, dateFails = 0, entries = 0, i = 0;
    for (;;) {
      i = html.indexOf(MAIN, i); if (i < 0) break;
      const s = i + MAIN.length, e = html.indexOf("</div>", s); if (e < 0) break;
      const main = html.slice(s, e); i = e; entries++;
      const am = /<a href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/.exec(main); if (!am) continue;
      const c = classifyUrl(decode(am[1])); if (!c) continue;
      const nextMain = html.indexOf(MAIN, e), ci = html.indexOf(CAP, e);
      let cap = ""; if (ci >= 0 && (nextMain < 0 || ci < nextMain)) cap = html.slice(ci, html.indexOf("</div>", ci) >>> 0 || ci + 2000);
      if (/From Google Ads/i.test(cap)) { ads++; continue; }
      const t = parseActivityDate(decode(stripTags(main.replace(/<br\s*\/?>/gi, "\n"))));
      if (t == null) { dateFails++; continue; }
      const title = decode(stripTags(am[2])).trim();
      if (c.type === "search") { const q = title || c.q; if (q) searches.push(mkSearch(t, q)); continue; }
      const cm = /<a href="https?:\/\/(?:www\.)?youtube\.com\/(?:channel|c|user|@)[^"]*"[^>]*>([\s\S]*?)<\/a>/.exec(main.slice(am.index + am[0].length));
      const ch = cm ? decode(stripTags(cm[1])).trim() : "";
      watches.push(mkWatch(t, c.id, !title || /^https?:\/\//.test(title) ? "Removed video" : title, ch || "Unknown channel", false));
    }
    return { watches, searches, ads, dateFails, entries };
  }

  function countSubscriptions(csv) {
    const lines = String(csv).split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return null;
    const first = lines[1].split(",")[0].replace(/"/g, "").trim();
    if (!/^UC[\w-]{22}$/.test(first)) return null; // channel IDs; other CSVs (playlists, comments...) are ignored
    return lines.length - 1;
  }

  /* ---------- zip reading (no libraries, ZIP64 aware) ---------- */
  async function inflateRaw(blob) {
    if (typeof DecompressionStream === "undefined") throw new Error("Your browser is too old to read zip files. Update it, or unzip the file and drop the history file instead.");
    return new Response(blob.stream().pipeThrough(new DecompressionStream("deflate-raw"))).text();
  }
  async function readZip(file) {
    const size = file.size, tailLen = Math.min(size, 65557 + 20 + 56);
    const tailBuf = await file.slice(size - tailLen, size).arrayBuffer(), tail = new DataView(tailBuf);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("That doesn't look like a valid .zip file.");
    let total = tail.getUint16(eocd + 10, true), cdSize = tail.getUint32(eocd + 12, true), cdOff = tail.getUint32(eocd + 16, true);
    if (total === 0xFFFF || cdSize === 0xFFFFFFFF || cdOff === 0xFFFFFFFF) {
      const loc = eocd - 20;
      if (loc < 0 || tail.getUint32(loc, true) !== 0x07064b50) throw new Error("This zip uses an unsupported format. Re-export with only History and Subscriptions selected.");
      const z64 = Number(tail.getBigUint64(loc + 8, true)), rec = new DataView(await file.slice(z64, z64 + 56).arrayBuffer());
      if (rec.getUint32(0, true) !== 0x06064b50) throw new Error("The zip file looks damaged.");
      total = Number(rec.getBigUint64(32, true)); cdSize = Number(rec.getBigUint64(40, true)); cdOff = Number(rec.getBigUint64(48, true));
    }
    const buf = await file.slice(cdOff, cdOff + cdSize).arrayBuffer(), cd = new DataView(buf), u8 = new Uint8Array(buf), dec = new TextDecoder("utf-8");
    const entries = []; let p = 0;
    for (let i = 0; i < total; i++) {
      if (p + 46 > cd.byteLength || cd.getUint32(p, true) !== 0x02014b50) break;
      const method = cd.getUint16(p + 10, true); let csize = cd.getUint32(p + 20, true), usize = cd.getUint32(p + 24, true), off = cd.getUint32(p + 42, true);
      const n = cd.getUint16(p + 28, true), e = cd.getUint16(p + 30, true), c = cd.getUint16(p + 32, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + n));
      if (usize === 0xFFFFFFFF || csize === 0xFFFFFFFF || off === 0xFFFFFFFF) { // ZIP64 extra field
        let q = p + 46 + n; const end = q + e;
        while (q + 4 <= end) {
          const id = cd.getUint16(q, true), len = cd.getUint16(q + 2, true);
          if (id === 1) { let r = q + 4; if (usize === 0xFFFFFFFF) { usize = Number(cd.getBigUint64(r, true)); r += 8; } if (csize === 0xFFFFFFFF) { csize = Number(cd.getBigUint64(r, true)); r += 8; } if (off === 0xFFFFFFFF) { off = Number(cd.getBigUint64(r, true)); } break; }
          q += 4 + len;
        }
      }
      entries.push({
        name, usize,
        async text() {
          if (usize > LIMITS.maxEntryBytes) throw new Error(name.split("/").pop() + " is too large to analyze in the browser.");
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
    const st = { watches: [], searches: [], subs: null, problems: [], notes: [], ads: 0, sawHtml: false, htmlDateFails: 0 };
    const seenW = new Set(), seenS = new Set();
    const add = r => {
      for (const w of r.watches) { const k = w.t + "|" + w.id; if (!seenW.has(k)) { seenW.add(k); st.watches.push(w); } }
      for (const s of r.searches) { const k = s.t + "|" + s.id; if (!seenS.has(k)) { seenS.add(k); st.searches.push(s); } }
      st.ads += r.ads || 0;
    };
    const handle = (name, text) => {
      const short = name.split("/").pop();
      if (/\.json$/i.test(name)) {
        let arr; try { arr = JSON.parse(text); } catch (_) { return; }
        if (!looksLikeActivity(arr)) return;
        say("Reading " + short + "…"); add(parseHistoryJson(arr));
      } else if (/\.html?$/i.test(name)) {
        if (/archive_browser/i.test(name) || text.indexOf("mdl-typography--body-1") < 0) return;
        st.sawHtml = true; say("Reading " + short + "…");
        const r = parseActivityHtml(text); st.htmlDateFails += r.dateFails; add(r);
      } else if (/\.csv$/i.test(name)) {
        const n = countSubscriptions(text); if (n != null) st.subs = Math.max(st.subs || 0, n);
      }
    };
    for (const f of files) {
      const lower = String(f.name || "").toLowerCase();
      if (/\.zip$/.test(lower)) {
        say("Opening " + f.name + "…");
        const entries = await readZip(f);
        for (const en of entries) {
          if (/\/$/.test(en.name) || !/\.(json|csv|html?)$/i.test(en.name)) continue;
          if (/\.csv$/i.test(en.name) && en.usize > 20e6) continue;
          if (/\.html?$/i.test(en.name) && /archive_browser/i.test(en.name)) continue;
          handle(en.name, await en.text());
        }
      } else if (/\.(json|csv|html?)$/.test(lower)) {
        handle(lower, await f.text());
      } else {
        st.problems.push((f.name || "A file") + " isn't a .zip, .json, .html or .csv file.");
      }
    }
    if (st.ads) st.notes.push(`Skipped ${st.ads.toLocaleString("en-US")} ad views that Google logs in your history.`);
    if (!st.watches.length && !st.searches.length) {
      st.problems.push(st.sawHtml && st.htmlDateFails
        ? "We found your history but couldn't read its dates, which only works for English-language exports. Export again and switch History from HTML to JSON."
        : "We couldn't find any watch or search history in that file. Make sure History was ticked, watch history was switched on in YouTube, and (if Google split the export into several zips) drop all the parts together.");
    } else if (!st.watches.length) {
      st.notes.push("There's no watch history in this file, only searches, so this wrap is about what you search for. If Google split your export into several zips (-001, -002...), drop all of them together.");
    }
    st.watches.sort((a, b) => a.t - b.t); st.searches.sort((a, b) => a.t - b.t);
    return st;
  }

  /* ---------- summaries ---------- */
  const pad = n => String(n).padStart(2, "0");
  const dayKey = d => d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
  const topN = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

  function buildOne(list, mode, year, years) {
    const vids = new Map(), chans = new Map(), topics = new Map(), dayCounts = new Map();
    const heat = Array.from({ length: 7 }, () => Array(24).fill(0));
    const monthly = Array(12).fill(0), yearly = new Map();
    let night = 0, weekend = 0, first = null;
    for (const e of list) {
      const d = new Date(e.t), h = d.getUTCHours(), wd = d.getUTCDay();
      let v = vids.get(e.id); if (!v) { v = { c: 0, title: e.title, ch: e.ch }; vids.set(e.id, v); } v.c++;
      if (e.words) for (const w of e.words) chans.set(w, (chans.get(w) || 0) + 1); else chans.set(e.ch, (chans.get(e.ch) || 0) + 1);
      topics.set(e.topic, (topics.get(e.topic) || 0) + 1);
      heat[wd][h]++; monthly[d.getUTCMonth()]++;
      yearly.set(d.getUTCFullYear(), (yearly.get(d.getUTCFullYear()) || 0) + 1);
      const dk = dayKey(d); dayCounts.set(dk, (dayCounts.get(dk) || 0) + 1);
      if (h >= 22 || h < 5) night++; if (wd === 0 || wd === 6) weekend++;
      if (!first || e.t < first.t) first = e;
    }
    const n = list.length;
    const days = [...dayCounts.keys()].sort(); let best = 0, cur = 0, prev = null;
    for (const k of days) { const [y, m, d] = k.split("-").map(Number), ts = Date.UTC(y, m - 1, d); cur = prev !== null && ts - prev === 864e5 ? cur + 1 : 1; prev = ts; if (cur > best) best = cur; }
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
  function summarize(events) {
    const byYear = new Map();
    for (const w of events) { const y = new Date(w.t).getUTCFullYear(); if (!byYear.has(y)) byYear.set(y, []); byYear.get(y).push(w); }
    const years = [...byYear.keys()].sort((a, b) => a - b);
    const by = { all: buildOne(events, "all", null, years) };
    for (const y of years) by[y] = buildOne(byYear.get(y), "year", y, years);
    for (const y of years) { const p = by[y - 1]; if (p) by[y].prev = { count: p.count, channels: p.uniqueChannels, active: p.activeDays }; }
    by.all.spanYears = years.length ? Math.max(1, (events[events.length - 1].t - events[0].t) / (365.25 * 864e5)) : 1;
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
  function cleanSums(x) {
    if (!x || typeof x !== "object" || !x.by || typeof x.by !== "object") return null;
    const by = {}; let any = false;
    for (const k of Object.keys(x.by).slice(0, 60)) { if (k !== "all" && !/^\d{4}$/.test(k)) continue; const c = cleanSummary(x.by[k]); if (c) { by[k] = c; any = true; } }
    if (!any || !by.all) return null;
    return { years: Object.keys(by).filter(k => k !== "all").map(Number).sort((a, b) => b - a), by };
  }
  function cleanStore(x) {
    if (!x || typeof x !== "object") return null;
    const data = { watch: null, search: null };
    if (x.sums && x.sums.by) data.watch = cleanSums(x.sums);          // v1 layout
    if (x.data && typeof x.data === "object") { data.watch = cleanSums(x.data.watch); data.search = cleanSums(x.data.search); }
    if (!data.watch && !data.search) return null;
    return { data, subs: x.subs == null ? null : num(x.subs, 1e6), savedAt: num(x.savedAt, 4e12) };
  }

  /* ---------- share links (#w=...) ---------- */
  function stripForShare(s) { const c = JSON.parse(JSON.stringify(s)); c.topVideos = []; if (c.first) { c.first.title = ""; c.first.ch = ""; } return c; }
  const b64u = bytes => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
  const unb64u = t => { t = t.replace(/-/g, "+").replace(/_/g, "/"); while (t.length % 4) t += "="; const s = atob(t), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
  async function pipeBytes(bytes, stream) {
    const w = new Blob([bytes]).stream().pipeThrough(stream), r = w.getReader(), chunks = []; let total = 0;
    for (;;) { const { done, value } = await r.read(); if (done) break; total += value.length; if (total > LIMITS.maxShareBytes) { try { r.cancel(); } catch (_) {} throw new Error("Share link is too large."); } chunks.push(value); }
    const out = new Uint8Array(total); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; } return out;
  }
  async function encodeShare(summary, kind, sub) {
    const payload = { v: 2, kind: kind === "search" ? "search" : "watch", s: stripForShare(summary), subs: sub == null ? null : sub };
    return b64u(await pipeBytes(new TextEncoder().encode(JSON.stringify(payload)), new CompressionStream("deflate-raw")));
  }
  async function decodeShare(code) {
    if (!/^[A-Za-z0-9_-]{8,60000}$/.test(code)) throw new Error("That share link looks damaged.");
    let raw;
    try { raw = await pipeBytes(unb64u(code), new DecompressionStream("deflate-raw")); }
    catch (e) { throw new Error(/too large/.test(e.message) ? e.message : "That share link looks damaged."); }
    let p; try { p = JSON.parse(new TextDecoder().decode(raw)); } catch (_) { throw new Error("That share link looks damaged."); }
    if (!p || (p.v !== 1 && p.v !== 2)) throw new Error("That share link is from a different version.");
    const s = cleanSummary(p.s); if (!s) throw new Error("That share link has no data.");
    return { kind: p.kind === "search" ? "search" : "watch", summary: s, subs: p.subs == null ? null : num(p.subs, 1e6) };
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
    const now = Date.UTC(2026, 10, 9), out = [], reps = Array.from({ length: 14 }, (_, i) => "rep" + i);
    for (let i = 0; i < 6800; i++) {
      const ci = Math.min(chans.length - 1, Math.floor(Math.pow(rnd(), 1.7) * chans.length)), [ch, music] = chans[ci];
      const d = new Date(now - Math.pow(rnd(), 1.5) * 4.2 * 365 * 864e5), night = rnd() < .5;
      d.setUTCHours(night ? [22, 23, 0, 1, 2][Math.floor(rnd() * 5)] : 8 + Math.floor(rnd() * 13), Math.floor(rnd() * 60));
      const isRep = rnd() < .06, id = isRep ? pick(reps) : "v" + i, title = isRep ? "Rain on a window (10 hours) " + id.slice(3) : pick(titles) + " " + pick(topics);
      out.push(mkWatch(d.getTime(), id, title, ch, music === 1));
    }
    return out.sort((a, b) => a.t - b.t);
  }
  function demoSearches() {
    let seed = 99; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647, pick = a => a[Math.floor(rnd() * a.length)];
    const qs = ["lofi study beats", "ipl highlights 2025", "python tutorial for beginners", "best street food in mumbai", "rust ownership explained", "mechanical keyboard review", "monsoon trailer", "chess openings", "sourdough recipe", "iphone vs pixel", "goa travel vlog", "jazz standards playlist", "black holes documentary", "cricket world cup final", "home lab setup", "solar power at home"];
    const out = [], now = Date.UTC(2026, 10, 9);
    for (let i = 0; i < 1900; i++) {
      const q = rnd() < .5 ? pick(qs) : pick(qs) + " " + pick(["2024", "2025", "part 2", "live", "india", "full", "new"]);
      const d = new Date(now - Math.pow(rnd(), 1.3) * 3.5 * 365 * 864e5); d.setUTCHours(rnd() < .45 ? [22, 23, 0, 1][Math.floor(rnd() * 4)] : 9 + Math.floor(rnd() * 12), Math.floor(rnd() * 60));
      out.push(mkSearch(d.getTime(), q));
    }
    return out.sort((a, b) => a.t - b.t);
  }

  root.WrapLib = { MIN_PER_VIDEO, MONTHS, classify, searchWords, parseActivityDate, parseHistoryJson, parseWatchHistory, parseActivityHtml, looksLikeActivity, looksLikeWatchHistory, countSubscriptions, readZip, extract, summarize, cleanSummary, cleanSums, cleanStore, encodeShare, decodeShare, lnCdf, demoWatches, demoSearches, num, str };
})(typeof window !== "undefined" ? window : globalThis);
