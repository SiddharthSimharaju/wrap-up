// Run: node tests/ui.test.mjs   (no dependencies, Node 18+)
import fs from "node:fs"; import path from "node:path"; import vm from "node:vm"; import zlib from "node:zlib"; import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), read = f => fs.readFileSync(path.join(root, f), "utf8");
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.error("FAIL:", m); } };
const libSrc = read("lib.js"), appSrc = read("app.js"), html = read("index.html");

/* ---------- static checks ---------- */
ok(!/<script(?![^>]*\ssrc=)[^>]*>/i.test(html), "inline <script> in index.html");
ok(!/\son[a-z]+\s*=/i.test(html), "inline event handler in index.html");
ok(/connect-src 'none'/.test(html) && /default-src 'none'/.test(html) && /form-action 'none'/.test(html), "CSP must block network access");
ok(!/script-src[^;]*('unsafe-inline'|'unsafe-eval'|https:)/.test(html), "script-src too loose");
ok(!/google\.com\/gsi|accounts\.google|googleapis\.com\/youtube/.test(html + appSrc + libSrc), "sign-in / API code should be gone");
ok(!/\b(fetch|XMLHttpRequest|WebSocket|sendBeacon|EventSource)\b/.test(appSrc + libSrc.replace(/new Response\(/g, "")), "network API used");
ok(!/\beval\(|new Function\(|document\.write\(|insertAdjacentHTML/.test(appSrc + libSrc), "dangerous API used");
ok(!/sessionStorage|document\.cookie|indexedDB/.test(appSrc + libSrc), "unexpected storage API");
const ids = [...appSrc.matchAll(/\$\("([A-Za-z0-9_-]+)"\)/g)].map(m => m[1]), known = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1])), dyn = new Set([...appSrc.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
for (const id of new Set(ids)) ok(known.has(id) || dyn.has(id), `#${id} used in app.js but never defined`);
for (const f of ["styles.css", "lib.js", "app.js", "config.js", "privacy.html"]) ok(html.includes(f) || f === "privacy.html" || f === "styles.css", f + " not referenced");

/* ---------- DOM stub ---------- */
function makeEnv({ storage = {}, hash = "", search = "" } = {}) {
  const ctx2d = new Proxy({}, { get: (_, k) => k === "measureText" ? s => ({ width: String(s).length * 16 }) : (k === "createLinearGradient" || k === "createRadialGradient") ? () => ({ addColorStop() {} }) : () => {}, set: () => true });
  const els = {};
  function makeEl(id) {
    const st = {};
    const el = new Proxy(function () {}, {
      get(_, k) {
        if (k in st) return st[k];
        if (k === "classList") return { add() {}, remove() {}, toggle(c, f) { st._open = f; return f; }, contains: () => !!st._open };
        if (k === "style") return (st.style ||= { setProperty() {} });
        if (k === "getContext") return () => ctx2d;
        if (k === "toBlob") return cb => cb(new Blob(["x"]));
        if (k === "closest") return () => null;
        if (k === Symbol.toPrimitive) return () => id;
        return () => el;
      },
      set(_, k, v) { st[k] = v; if (k === "textContent") st.innerHTML = ""; return true; }, apply() { return el; }
    });
    return el;
  }
  const store = { ...storage }, events = [];
  const sb = {
    console, Blob, Response, TextEncoder, TextDecoder, DecompressionStream, CompressionStream, URL, URLSearchParams, btoa, atob, Math, Date, JSON, Map, Set, Array, Object, String, Number, Promise, Uint8Array, DataView, isFinite, Error, setTimeout, clearTimeout, File: class {},
    document: { getElementById: id => (els[id] ||= makeEl(id)), createElement: () => makeEl("c"), querySelector: () => makeEl("q"), addEventListener() {}, body: makeEl("body"), fonts: { load: () => Promise.resolve() }, hidden: false },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem(k, v) { store[k] = String(v); }, removeItem(k) { delete store[k]; } },
    location: { hash, search, pathname: "/", href: "https://example.com/" + hash },
    history: { replaceState(_, __, u) { sb.location.hash = ""; events.push(u); } },
    navigator: { userAgent: "", clipboard: { writeText: async t => { sb.copied = t; } } },
    matchMedia: () => ({ matches: true }), scrollTo() {}, addEventListener() {}, URL
  };
  sb.window = sb; sb.globalThis = sb; sb.APP_CONFIG = {};
  sb.URL.createObjectURL = () => "blob:x"; sb.URL.revokeObjectURL = () => {};
  vm.createContext(sb); vm.runInContext(libSrc, sb);
  return { sb, els, store, el: id => (els[id] ||= makeEl(id)) };
}
const run = (env, code) => { if (!env.loaded) { env.loaded = true; return vm.runInContext(appSrc + "\n;" + code, env.sb); } return vm.runInContext(code, env.sb); };
const clean = s => !/NaN|Infinity|undefined|\[object/.test(s);

/* ---------- 1. demo flow, every year ---------- */
{
  const env = makeEnv();
  const out = await run(env, `(async()=>{ const r={}; startDemo(); r.demo=$("dash").innerHTML; r.mode=S.mode; r.years=S.sums.years.slice(); r.bad=[]; for(const y of ["all",...r.years]){ S.sel=String(y); render(); if(!/Top channels/.test($("dash").innerHTML)||/NaN|Infinity|undefined|\\[object/.test($("dash").innerHTML)) r.bad.push(y); } r.shares=$("shares").textContent; return r; })()`);
  ok(out.mode === "demo" && /Demo data/.test(out.demo) && /Where you stand/.test(out.demo) && /Share your wrap/.test(out.demo) && /Most watched videos/.test(out.demo), "demo dashboard incomplete");
  ok(out.bad.length === 0, "NaN/undefined in views for: " + out.bad);
  ok(out.years.length >= 4, "demo years");
}

/* ---------- 2. uploading a real-shaped Takeout zip ---------- */
function makeZip(files) {
  const parts = [], central = []; let off = 0;
  for (const [name, content] of files) {
    const nb = Buffer.from(name), raw = Buffer.from(content), data = zlib.deflateRawSync(raw);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nb.length, 26); parts.push(lh, nb, data);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42); central.push(ch, nb); off += 30 + nb.length + data.length;
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, e]);
}
const wh = Array.from({ length: 3000 }, (_, i) => ({ header: i % 9 === 0 ? "YouTube Music" : "YouTube", title: "Watched Secret private title number " + i, titleUrl: "https://www.youtube.com/watch?v=vid" + (i % 700), subtitles: [{ name: "Chan" + (i % 25) }], time: new Date(Date.UTC(2025, i % 12, 1 + (i % 27), (i * 7) % 24, i % 60)).toISOString() }));
const zipBlob = Object.assign(new Blob([makeZip([["Takeout/YouTube and YouTube Music/history/watch-history.json", JSON.stringify(wh)], ["Takeout/YouTube and YouTube Music/subscriptions/subscriptions.csv", "Channel ID,Channel URL,Channel title\nUCaaaaaaaaaaaaaaaaaaaaaa,u,One\n"]])]), { name: "takeout.zip" });
{
  const env = makeEnv();
  // inject the blob via sandbox global
  env.sb.ZIP = zipBlob;
  const out2 = await run(env, `(async()=>{ await handleFiles([ZIP]); return {mode:S.mode,count:S.sums.by.all.count,subs:S.subs,sel:S.sel,html:$("dash").innerHTML,saved:S.savedAt>0}; })()`);
  ok(out2.mode === "live" && out2.count === 3000 && out2.subs === 1, `upload result wrong: ${JSON.stringify({ m: out2.mode, c: out2.count, s: out2.subs })}`);
  ok(out2.saved && env.store["wrapup:v1"], "wrap should be saved when 'remember' is on");
  const saved = env.store["wrapup:v1"] || "";
  ok(saved.length < 150e3, "stored data too large: " + saved.length);
  ok(!/watch\?v=|titleUrl|vid699/.test(saved), "raw history must not be stored");
  ok(clean(out2.html) && /Saved on this device/.test(out2.html), "live render issue");
  // reload from storage in a fresh page
  const env2 = makeEnv({ storage: { "wrapup:v1": saved } });
  const o3 = await run(env2, `(async()=>{ await boot(); return {mode:S.mode,html:$("dash").innerHTML,count:S.sums.by.all.count}; })()`);
  ok(o3.mode === "live" && o3.count === 3000 && /Saved on this device/.test(o3.html), "saved wrap not restored after reload");
  // forget
  const o4 = await run(env2, `forget(); ({stored:localStorage.getItem("wrapup:v1"),sums:S.sums,html:$("dash").innerHTML,mode:S.mode})`);
  ok(o4.stored === null && o4.sums === null && o4.html === "" && o4.mode === "none", "forget did not clear everything");
  // not remembering
  const env3 = makeEnv({ storage: { "wrapup:v1": "old" } }); env3.sb.ZIP = zipBlob; env3.el("remember").checked = false;
  await run(env3, `(async()=>{ await handleFiles([ZIP]); })()`);
  ok(env3.store["wrapup:v1"] === undefined, "unticked remember must not save (and should clear older saved data)");
  // bad uploads
  const env4 = makeEnv(); env4.sb.BAD = Object.assign(new Blob(["not a zip"]), { name: "x.zip" }); env4.sb.PNG = Object.assign(new Blob(["x"]), { name: "a.png" });
  const o5 = await run(env4, `(async()=>{ await handleFiles([BAD]); const a=$("drop").className+"|"+$("dropmsg").textContent; await handleFiles([PNG]); const b=$("dropmsg").textContent; return [a,b,S.sums]; })()`);
  ok(/err/.test(o5[0]) && /valid \.zip/.test(o5[0]) && /isn't a/.test(o5[1]) && o5[2] === null, "bad upload handling: " + JSON.stringify(o5));
}

/* ---------- 3. hostile data in storage / share link ---------- */
{
  const evil = { count: 10, topChannels: [['<img src=x onerror=alert(1)>', 5], ['"><script>alert(2)</script>', 3]], topics: [["<script>alert(3)</script>", 7]], topVideos: [["<svg onload=alert(4)>", "<b>x</b>", 3]], series: { labels: ["<i>", "b"], values: [1, 2] }, first: { t: 1, title: "<u>t</u>", ch: "c" }, busiest: { date: "2024-01-01", count: 2 } };
  const store = JSON.stringify({ v: 1, savedAt: 1, subs: "<b>5</b>", sums: { by: { all: evil, "2024": evil } } });
  const env = makeEnv({ storage: { "wrapup:v1": store } });
  const o = await run(env, `(async()=>{ await boot(); return $("dash").innerHTML; })()`);
  ok(!/<img src=x|<script|<svg onload|<b>x<\/b>|<u>t<\/u>/.test(o) && /&lt;img/.test(o), "XSS via saved data");
  ok(clean(o), "hostile saved data produced NaN/undefined");
  // share link
  const env2 = makeEnv();
  const code = await vm.runInContext("WrapLib.encodeShare(WrapLib.summarize(WrapLib.demoWatches()).by.all, 7)", env2.sb);
  env2.sb.location.hash = "#w=" + code;
  const o2 = await run(env2, `(async()=>{ await boot(); return {mode:S.mode,html:$("dash").innerHTML,subs:S.subs}; })()`);
  ok(o2.mode === "shared" && /Shared wrap/.test(o2.html) && !/Most watched videos/.test(o2.html) && !/id="forget"|id="yr"/.test(o2.html) && clean(o2.html), "shared view wrong");
  const evilCode = zlib.deflateRawSync(Buffer.from(JSON.stringify({ v: 1, s: evil }))).toString("base64url"); env2.sb.location.hash = "#w=" + evilCode;
  const o3 = await run(env2, `(async()=>{ await boot(); return $("dash").innerHTML; })()`); ok(!/<img src=x|<script/.test(o3), "XSS via share link");
  env2.sb.location.hash = "#w=AAAAAAAAAAAAAAAA"; const o4 = await run(env2, `(async()=>{ await boot(); return {t:$("toast").textContent,mode:S.mode}; })()`);
  ok(/damaged|different|no data/.test(o4.t) && o4.mode !== "shared", "tampered link should show an error: " + JSON.stringify(o4));
}

/* ---------- 4. share cards render for every kind and view ---------- */
{
  const env = makeEnv();
  const out = await run(env, `(()=>{ const sums=WrapLib.summarize(WrapLib.demoWatches()); const errs=[]; for(const k of Object.keys(sums.by)){ const v=sums.by[k], d=derive(v,3); for(const kind of ["overview","topics","rank","channels","rhythm"]) { try{ drawCard(kind,v,d); }catch(e){ errs.push(k+kind+e.message); } } if(!/#YouTubeWrapped/.test(shareText(v,d))||!clean2(shareText(v,d))) errs.push("text"+k); } return errs; function clean2(s){return !/NaN|undefined/.test(s);} })()`);
  ok(out.length === 0, "share card errors: " + out.join(";"));
}
// tiny dataset must not break derive/render
{
  const env = makeEnv();
  const o = await run(env, `(()=>{ const sums=WrapLib.summarize([{t:Date.now(),id:"a",title:"t",ch:"c",topic:"Other"}]); S.sums=sums; S.sel="all"; S.mode="live"; render(); return $("dash").innerHTML; })()`);
  ok(clean(o) && /Top channels/.test(o), "single-video dataset breaks the dashboard");
}

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
