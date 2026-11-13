// Run: node tests/lib.test.mjs   (no dependencies, Node 18+)
import fs from "node:fs"; import path from "node:path"; import zlib from "node:zlib"; import vm from "node:vm"; import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ctx = vm.createContext({ console, Blob, Response, TextEncoder, TextDecoder, DecompressionStream, CompressionStream, URL, btoa, atob, Math, Date, JSON, Map, Set, Array, Object, String, Number, Promise, Uint8Array, DataView, isFinite, Error });
ctx.globalThis = ctx; vm.runInContext(fs.readFileSync(path.join(root, "lib.js"), "utf8"), ctx);
const L = ctx.WrapLib;
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.error("FAIL:", m); } };

/* minimal zip writer */
function makeZip(files) {
  const parts = [], central = []; let off = 0;
  for (const [name, content, method = 8] of files) {
    const nb = Buffer.from(name), raw = Buffer.from(content), data = method === 8 ? zlib.deflateRawSync(raw) : raw;
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(method, 8); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nb.length, 26);
    parts.push(lh, nb, data);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(method, 10); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
    central.push(ch, nb); off += 30 + nb.length + data.length;
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, e]);
}
const file = (name, buf) => Object.assign(new Blob([buf]), { name });

const wh = [
  { header: "YouTube", title: "Watched Official Video: Song One", titleUrl: "https://www.youtube.com/watch?v=aaaaaaaaaaa", subtitles: [{ name: "Music Co", url: "x" }], time: "2025-03-01T22:30:00.000Z", products: ["YouTube"] },
  { header: "YouTube", title: "Watched Song One", titleUrl: "https://www.youtube.com/watch?v=aaaaaaaaaaa", subtitles: [{ name: "Music Co" }], time: "2025-03-02T22:35:00.000Z" },
  { header: "YouTube", title: "Watched Minecraft gameplay part 2", titleUrl: "https://www.youtube.com/watch?v=bbbbbbbbbbb", subtitles: [{ name: "Gamer" }], time: "2025-03-03T09:00:00.000Z" },
  { header: "YouTube", title: "Watched Short thing", titleUrl: "https://www.youtube.com/shorts/ccccccccccc", subtitles: [{ name: "Gamer" }], time: "2025-03-04T09:00:00.000Z" },
  { header: "YouTube", title: "Watched https://www.youtube.com/watch?v=ddddddddddd", titleUrl: "https://www.youtube.com/watch?v=ddddddddddd", time: "2024-12-31T23:59:00.000Z" },
  { header: "YouTube", title: "Watched An ad", titleUrl: "https://www.youtube.com/watch?v=eeeeeeeeeee", details: [{ name: "From Google Ads" }], time: "2025-03-05T09:00:00.000Z" },
  { header: "YouTube", title: "Viewed post", titleUrl: "https://www.youtube.com/post/abc", time: "2025-03-05T09:00:00.000Z" },
  { header: "YouTube Music", title: "Watched Some track", titleUrl: "https://music.youtube.com/watch?v=fffffffffff", subtitles: [{ name: "Artist - Topic" }], time: "2025-03-06T10:00:00.000Z" },
  { header: "YouTube", title: "Watched bad time", titleUrl: "https://www.youtube.com/watch?v=ggggggggggg", time: "not-a-date" },
  { title: "Watched evil", titleUrl: "https://evil.example/watch?v=hhhhhhhhhhh", time: "2025-03-06T10:00:00.000Z" }
];
const subsCsv = "Channel ID,Channel URL,Channel title\nUCaaaaaaaaaaaaaaaaaaaaaa,http://www.youtube.com/channel/UCaaaaaaaaaaaaaaaaaaaaaa,One\nUCbbbbbbbbbbbbbbbbbbbbbb,http://www.youtube.com/channel/UCbbbbbbbbbbbbbbbbbbbbbb,Two\n";
const playlistCsv = "Video ID,Playlist video creation timestamp\nabcdefghijk,2024-01-01T00:00:00+00:00\n";

/* parsing */
const parsed = L.parseWatchHistory(wh);
ok(parsed.length === 6, "parse count: " + parsed.length); // 2 songs + minecraft + short + removed + music
ok(parsed.find(p => p.id === "ccccccccccc"), "shorts url not recognised");
ok(parsed.find(p => p.id === "ddddddddddd").title === "Removed video", "removed video title");
ok(parsed.find(p => p.id === "fffffffffff").topic === "Music", "YouTube Music entry should be Music");
ok(parsed.find(p => p.id === "bbbbbbbbbbb").topic === "Gaming", "gaming topic");
ok(!parsed.some(p => p.id === "eeeeeeeeeee" || p.id === "ggggggggggg" || p.id === "hhhhhhhhhhh"), "ads/bad time/foreign host should be skipped");
ok(L.looksLikeWatchHistory(wh) && !L.looksLikeWatchHistory([{ title: "Searched for x", titleUrl: "https://www.google.com/search?q=x" }]), "watch-history detection");
ok(L.countSubscriptions(subsCsv) === 2 && L.countSubscriptions(playlistCsv) === null, "subscription csv detection");

/* zip: nested folders, deflate + stored, localized folder name, extra files ignored */
const zip = makeZip([
  ["Takeout/YouTube und YouTube Music/Verlauf/Wiedergabeverlauf.json", JSON.stringify(wh)],
  ["Takeout/YouTube und YouTube Music/Abos/Abos.csv", subsCsv, 0],
  ["Takeout/YouTube und YouTube Music/Playlists/Liked.csv", playlistCsv],
  ["Takeout/archive_browser.html", "<html></html>"]
]);
const progress = []; let r = await L.extract([file("takeout.zip", zip)], m => progress.push(m));
ok(r.watches.length === 6 && r.subs === 2 && r.problems.length === 0, `zip extract: ${r.watches.length}/${r.subs}/${r.problems}`);
ok(progress.length > 0, "progress callback not called");
ok(r.watches.every((w, i, a) => !i || a[i - 1].t <= w.t), "watches not sorted");

/* loose files + duplicates across files */
r = await L.extract([file("watch-history.json", JSON.stringify(wh)), file("watch-history (1).json", JSON.stringify(wh)), file("subscriptions.csv", subsCsv)]);
ok(r.watches.length === 6 && r.subs === 2, "dedupe across files: " + r.watches.length);

/* problems */
r = await L.extract([file("watch-history.html", "<html>")]); ok(r.problems.length === 1, "html with no entries is a problem");
r = await L.extract([file("photo.png", "x")]); ok(/isn't a/.test(r.problems.join()), "unsupported type");
r = await L.extract([file("empty.json", "[]")]); ok(r.problems.length === 1, "empty json");
r = await L.extract([file("bad.json", "{not json")]); ok(r.problems.length === 1, "malformed json must not throw");
let threw = ""; try { await L.extract([file("x.zip", Buffer.from("not a zip at all"))]); } catch (e) { threw = e.message; } ok(/valid \.zip/.test(threw), "invalid zip message: " + threw);
const htmlZip = makeZip([["Takeout/YouTube/history/watch-history.html", "<html></html>"]]); r = await L.extract([file("t.zip", htmlZip)]); ok(r.problems.length === 1, "html-in-zip without entries is a problem");

/* summaries */
const demo = L.demoWatches(); ok(demo.length > 5000, "demo size");
const S = L.summarize(demo); const yrs = S.years;
ok(yrs.length >= 4 && yrs[0] > yrs[1], "years desc: " + yrs);
const A = S.by.all;
ok(A.count === demo.length && A.series.labels.length > 0 && A.heat.length === 7, "all summary shape");
ok(Object.keys(S.by).filter(k => k !== "all").reduce((a, k) => a + S.by[k].count, 0) === A.count, "year counts must sum to total");
const Y = S.by[yrs[0]]; ok(Y.series.labels.length === 12 && Y.series.values.reduce((a, b) => a + b, 0) === Y.count, "monthly series sums to count");
ok(Y.heat.flat().reduce((a, b) => a + b, 0) === Y.count, "heatmap sums to count");
ok(Y.topChannels[0][1] >= Y.topChannels[1][1], "top channels sorted");
ok(A.longestStreak >= 1 && A.activeDays >= A.longestStreak, "streak sanity");
ok(A.nightPct >= 0 && A.nightPct <= 100, "night pct range");
ok(S.by[yrs[0]].prev === undefined || S.by[yrs[0]].prev.count === S.by[yrs[0] - 1].count, "prev year link");
ok(L.summarize([]).years.length === 0, "empty summarize should not throw");
// streak correctness
const day = n => Date.UTC(2025, 0, n, 12);
const st = L.summarize([1, 2, 3, 5, 6].map(n => ({ t: day(n) + new Date().getTimezoneOffset() * 0, id: "x" + n, title: "t", ch: "c", topic: "Other" })));
ok(st.by.all.longestStreak === 3 && st.by.all.activeDays === 5, "streak calc: " + st.by.all.longestStreak);

/* validation: hostile input */
const evil = { count: 5, uniqueVideos: "x", topChannels: [["<img src=x onerror=1>".repeat(50), 1e30], "bad", null], topics: "nope", heat: "bad", series: { labels: ["a"], values: [1, 2, 3] }, busiest: { date: "<script>", count: 1 }, first: { t: -5, title: "t".repeat(1e5) }, year: "<b>", nightPct: 9999, prev: "x", __proto__: { polluted: 1 } };
const c = L.cleanSummary(evil);
ok(c && c.uniqueVideos === 0 && c.topChannels.length === 1 && c.topChannels[0][0].length <= 120 && c.topChannels[0][1] <= 1e9, "cleanSummary clamps strings/numbers");
ok(c.topics.length === 0 && c.heat.length === 7 && c.heat[0].length === 24 && c.series.labels.length === 0 && c.busiest === null && c.nightPct === 100 && c.first.title.length <= 200 && c.year === "all", "cleanSummary shape: " + JSON.stringify(c.year));
ok(L.cleanSummary(null) === null && L.cleanSummary({ count: 0 }) === null && L.cleanSummary("x") === null, "cleanSummary rejects junk");
ok(L.cleanStore({ sums: { by: { all: { count: 3 }, "2024": { count: 2 }, evil: { count: 9 } } }, subs: "12" }).data.watch.years.join() === "2024", "cleanStore filters keys");
ok(L.cleanStore({ sums: { by: { "2024": { count: 2 } } } }) === null && L.cleanStore("x") === null, "cleanStore requires all");

/* share links */
const code = await L.encodeShare(Y, "watch", 42);
ok(/^[A-Za-z0-9_-]+$/.test(code) && code.length < 6000, "share code size: " + code.length);
const back = await L.decodeShare(code);
ok(back.summary.count === Y.count && back.subs === 42 && back.summary.topVideos.length === 0 && back.summary.first.title === "", "share payload must drop video titles");
ok(!Buffer.from(code, "base64url").toString("latin1").includes("Rain on a window"), "titles leaked in link");
for (const bad of ["", "abc", "!!!!!!!!!!", "A".repeat(100), "////////"]) { let e = ""; try { await L.decodeShare(bad); } catch (x) { e = x.message; } ok(e, "decodeShare should reject " + JSON.stringify(bad)); }
// zip-bomb style payload
const bomb = zlib.deflateRawSync(Buffer.alloc(5e6, 97)).toString("base64url"); let be = ""; try { await L.decodeShare(bomb); } catch (x) { be = x.message; } ok(/too large/.test(be), "decompression bomb not capped: " + be);
// valid compression but hostile content
const hostile = zlib.deflateRawSync(Buffer.from(JSON.stringify({ v: 1, s: evil }))).toString("base64url"); const hb = await L.decodeShare(hostile); ok(hb.summary.topChannels[0][0].length <= 120, "hostile share content must be cleaned");

/* estimates */
ok(Math.abs(L.lnCdf(100, 100, 1) - .5) < 1e-3 && L.lnCdf(0, 100, 1) === 0 && L.lnCdf(1e9, 100, 1) > .999, "lnCdf");

/* ---------- real-format HTML (synthetic entries shaped like a Takeout export) ---------- */
{
  const cell = (inner, cap) => `<div class="outer-cell mdl-cell"><div class="mdl-grid"><div class="header-cell mdl-cell mdl-cell--12-col"><p class="mdl-typography--title">YouTube<br></p></div><div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">${inner}</div><div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1 mdl-typography--text-right"></div><div class="content-cell mdl-cell mdl-cell--12-col mdl-typography--caption">${cap}</div></div></div>`;
  const ad = "<b>Products:</b><br>&emsp;YouTube<br><b>Details:</b><br>&emsp;From Google Ads<br>";
  const plain = "<b>Products:</b><br>&emsp;YouTube<br>";
  const html = "<html><body>" +
    cell('Watched\u00a0<a href="https://www.youtube.com/watch?v=AAAAAAAAAAA">Real &amp; Good Video</a><br><a href="https://www.youtube.com/channel/UCxxxxxxxxxxxxxxxxxxxxxx">Some Channel</a><br>Mar 3, 2026, 11:45:10\u202fPM WET<br>', plain) +
    cell('Watched\u00a0<a href="https://www.youtube.com/watch?v=BBBBBBBBBBB">An Ad</a><br>Watched at 12:31\u202fAM<br>Nov 11, 2026, 12:31:27\u202fAM WET<br>', ad) +
    cell('Searched for\u00a0<a href="https://www.youtube.com/results?search_query=lofi+beats">lofi beats</a><br>Nov 10, 2026, 11:11:35\u202fPM WET<br>', plain) +
    cell('Searched for\u00a0<a href="https://www.youtube.com/results?search_query=Rust+ownership">Rust ownership</a><br>12 Nov 2026, 09:05:00 UTC<br>', plain) +
    "</body></html>";
  const h = L.parseActivityHtml(html);
  ok(h.watches.length === 1 && h.ads === 1 && h.searches.length === 2, "html: 1 watch, 1 ad skipped, 2 searches");
  ok(h.watches[0].title === "Real & Good Video" && h.watches[0].ch === "Some Channel", "html: title/channel decoded");
  const w = new Date(h.watches[0].t); ok(w.getUTCHours() === 23 && w.getUTCDate() === 3 && w.getUTCMonth() === 2, "html: wall-clock time kept (11:45 PM)");
  const sr = h.searches.find(x => x.title === "lofi beats"); ok(sr && new Date(sr.t).getUTCHours() === 23 && sr.words.includes("lofi"), "html: search parsed, 11:11 PM");
  ok(new Date(h.searches.find(x => x.title === "Rust ownership").t).getUTCHours() === 9, "html: 24h format");
  ok(L.parseActivityDate("Nov 11, 2026, 12:31:27\u202fAM WET") === Date.UTC(2026, 10, 11, 0, 31, 27), "12 AM is hour 0");
  ok(L.parseActivityDate("nonsense") === null, "bad date is null");
  const hz = makeZip([["Takeout/YouTube and YouTube Music/history/search-history.html", html], ["Takeout/YouTube and YouTube Music/subscriptions/subscriptions.csv", subsCsv]]);
  const rz = await L.extract([file("takeout-1.zip", hz)]);
  ok(rz.watches.length === 1 && rz.searches.length === 2 && rz.subs != null && rz.notes.length >= 1, "zip with HTML history extracts watches, searches, subs, ad note");
  const onlyS = await L.extract([file("search-history.html", html.replace(/<div class="outer-cell[^]*?Some Channel[^]*?<\/div><\/div><\/div>/, ""))]);
  ok(onlyS.searches.length === 2 && !onlyS.problems.length, "searches-only is not an error");
  const s = L.summarize(h.searches); ok(s.by.all.count === 2 && s.by.all.topChannels.length > 0, "search summary builds");
  const code = await L.encodeShare(s.by.all, "search", null); const dec = await L.decodeShare(code); ok(dec.kind === "search" && dec.summary.count === 2, "share round-trips kind");
  ok(L.cleanStore({ v: 2, data: { watch: null, search: s } }).data.search.by.all.count === 2, "cleanStore v2 search-only");
}

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

