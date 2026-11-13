# Wrap up

Built by [Sid](https://x.com/sidsimharaju).

Your YouTube year from your own data. Users download their Google Takeout, drop it on the page, and see their top channels, topics, prime time and an estimated rank in India. There is no sign-in, no backend and no network access: the analysis runs in the browser and the page's Content Security Policy (`connect-src 'none'`) forbids sending anything out.

## How it works
1. The user exports **History** and **Subscriptions** from takeout.google.com (without their uploaded videos, which makes the zip huge). HTML or JSON history both work. The page walks them through it.
2. They drop the `.zip` (read in the browser with no library, using the built-in `DecompressionStream`), or the loose `watch-history` / `search-history` files (.html or .json) and `subscriptions.csv`. Split exports (-001, -002) can be dropped together. Ad views ("From Google Ads") are skipped. If there's no organic watch history, the wrap is built from searches.
3. `lib.js` parses it and builds a summary per year. `app.js` renders the dashboard and share cards.
4. If "Remember my wrap" is ticked, **only the summary** (counts, top channels/topics, heatmap, ten most-watched titles) is saved in `localStorage`. The raw history is never stored. "Forget my data" or clearing site data removes it.
5. "Copy share link" puts a compressed summary (no video titles) in the URL fragment (`#w=...`), which browsers never send to servers. Anyone with the link sees a read-only view.

## What is real and what is estimated
Real: watch counts, dates, channels, rewatches, streaks, heatmap, subscriptions count. Estimated (labeled **est.**): topics (keyword rules on titles and channel names, in `lib.js`), hours (Takeout has no durations, so 7 minutes per video), and rank in India (lognormal around a typical yearly viewer derived from public figures: about 2.7B monthly users, 500M in India, 1B hours a day). Edit `BM` in `app.js` and `TOPIC_RULES` / `MIN_PER_VIDEO` in `lib.js` to tune them.

Times are wall-clock values exactly as written in the export (no time-zone shifting). HTML dates are parsed in English formats; other languages should export JSON. Takeout titles are localized by account language. Parsing keys off the video URL, not the wording, so non-English exports work; only the leading "Watched" word is stripped in English.

## Files
| File | Purpose |
|---|---|
| `index.html`, `styles.css`, `app.js` | The app UI. No inline scripts. |
| `lib.js` | Zip reader, parsers, summaries, share-link codec, validation. No DOM. |
| `config.js` | Optional contact email for the privacy page. |
| `privacy.html`, `privacy.js` | Privacy policy matching what the app does. |
| `_headers`, `vercel.json` | Security headers (CSP, HSTS, no framing). |
| `demo.html`, `config-demo.js` | Opens with sample data. Delete if you don't want it public. |
| `tests/`, `check.mjs` | Tests and a pre-deploy check. |

## Ship it
Any static host works: upload the folder to Netlify, Cloudflare Pages (uses `_headers`) or Vercel (uses `vercel.json`) over HTTPS. There is nothing to register with Google: no OAuth client, no API key, no verification, no quota. Run `npm test` and `npm run check` first.

## Deploy on GitHub Pages
Run `./deploy.sh` (needs the GitHub CLI, signed in with `gh auth login`). It runs the tests, creates `SiddharthSimharaju/wrap-up`, pushes, and enables Pages. The workflow in `.github/workflows/pages.yml` then tests and publishes on every push to `main`, at `https://siddharthsimharaju.github.io/wrap-up/`.

Manual route: create an empty public repo, `git remote add origin https://github.com/SiddharthSimharaju/wrap-up.git && git push -u origin main`, then Settings > Pages > Source: **GitHub Actions**.

GitHub Pages can't set HTTP headers, so `_headers` and `vercel.json` aren't used there. The CSP in each page's `<meta>` tag still applies (it blocks scripts, network access and form posts); only `frame-ancestors` and HSTS need real headers. Use Netlify or Cloudflare Pages if you want those.

## Security notes
- Everything from a file, from storage or from a share link is validated (`cleanSummary`) and escaped before rendering; share links are size-capped against decompression bombs.
- Share links reveal summary stats to whoever has them and can't be recalled. The UI says so.
- The only third-party request is the Funnel Sans font from Google Fonts. Self-host it if you want zero third-party requests.
- Don't add analytics or error reporters that could capture user data without updating the privacy policy.

## Limits
Reading is done in memory: very large histories (hundreds of thousands of entries) take a few seconds. Takeout zips over 4 GB (ZIP64) aren't supported; users should export only History and Subscriptions, which are small. Name: the product avoids "YouTube" in its title and says it's independent, but the headline still uses it descriptively.
