// Pre-deploy check. Run: node check.mjs
import fs from "node:fs";
const errs = [], warns = [];
for (const f of ["index.html", "privacy.html", "styles.css", "lib.js", "app.js", "config.js", "_headers", "vercel.json"]) if (!fs.existsSync(f)) errs.push("missing file: " + f);
if (!errs.length) {
  const html = fs.readFileSync("index.html", "utf8"), headers = fs.readFileSync("_headers", "utf8");
  if (!/connect-src 'none'/.test(html) || !/connect-src 'none'/.test(headers)) errs.push("CSP must keep connect-src 'none' (it is what stops data leaving the page).");
  if (/script-src[^;]*https?:/.test(html)) errs.push("script-src allows an external origin.");
  if (/accounts\.google|gsi\/client/.test(html)) errs.push("Google sign-in script found; this version has no sign-in.");
  const m = /contactEmail:\s*"([^"]*)"/.exec(fs.readFileSync("config.js", "utf8"));
  if (!m || !m[1]) warns.push("config.js: contactEmail is empty. Add one so the privacy page has a contact.");
  if (fs.existsSync("demo.html")) warns.push("demo.html and config-demo.js are sample-data previews. Delete them if you don't want them public.");
}
warns.forEach(w => console.warn("warning: " + w));
if (errs.length) { console.error("Not ready to ship:\n - " + errs.join("\n - ")); process.exit(1); }
console.log("Looks good. Run the tests too: node tests/lib.test.mjs && node tests/ui.test.mjs");
