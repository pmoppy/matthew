# Panko

A chat assistant on top of Claude for the team. Load your data, then just ask:

- **"What are the best sellers?"**: Panko queries the data and answers with the numbers.
- **"Build me a report on crisps sales by store"**: you get a formatted report card with a chart and table that you can **print/save as PDF** or **download**. Every report is kept under **Reports**.
- **"What did we say about Red Bull last time?"**: Panko searches your earlier conversations.
- **"Remember that I only care about the Leeds stores"**: Panko saves the note and uses it in every future chat (see or delete notes in **Settings**).

It runs as a web app (phone, tablet or laptop; installable to the home screen). The first time it opens, it loads a **demo sales dataset** (12 weeks × 4 stores × 87 products) so you can try it straight away.

## How it works

```
 phone / browser                          Panko server (Cloudflare Worker)       Claude
 ┌───────────────────────────────┐        ┌──────────────────────────┐           ┌────────┐
 │ chat UI                       │ ─────► │ checks the access code,  │ ───────►  │ Opus   │
 │ your data, chats, reports,    │ ◄───── │ adds the API key,        │ ◄───────  │ 5.5    │
 │ notes (all stored on device)  │ stream │ streams the reply back   │           └────────┘
 │ tools: query_data, …          │        └──────────────────────────┘
 └───────────────────────────────┘
```

- **Claude does the thinking; the tools do the counting.** Claude never sees a whole file. It calls tools that run *on the device*: `list_datasets`, `query_data` (filter / group / sum / sort), `create_report`, `search_conversations`, `get_conversation`, `remember`, `forget`. Only the rows it asks for are sent to the AI, and every number it quotes comes from a query, so it doesn't make figures up.
- **Your data stays on the device** (IndexedDB): datasets, conversations, reports and notes.
- **The API key stays on the server.** The Worker in `worker/` holds it, so it never sits on anyone's phone.
- Model: **Claude Opus 5.5** by default (switchable to Sonnet 5.5 or Haiku 5.5 in Settings). If a request is declined for policy reasons, the API automatically retries on a fallback model.

## Your data

In the app: **Data → Add a file**. CSV, TSV (or any `;`-separated export) and JSON arrays work. From Excel, use *File → Save As → CSV*.

- The first row must be the column headers. Any columns are fine: sales, stock, prices, stores, deliveries.
- Numbers like `£1,200` and `12%`, and dates like `03/08/2026` (UK) or `2026-08-03`, are recognised automatically.
- You can load several files. Panko picks the right one, or ask it to compare them.

## Set it up

### 1. The server (once, about 5 minutes)

You need an Anthropic API key from https://console.anthropic.com.

```bash
cd panko/worker
npx wrangler deploy
npx wrangler secret put ANTHROPIC_API_KEY   # paste the key
npx wrangler secret put ACCESS_CODE         # choose a code to give the team
```

You get an address like `https://panko-api.<you>.workers.dev`. Optionally set `ALLOWED_ORIGIN` in `wrangler.toml` to the app's address.

### 2. The app

It's built and published to GitHub Pages with ShelfScan on every push to `main`:
**https://pmoppy.github.io/matthew/panko/**

To pre-fill the server address for everyone, add a repository variable `PANKO_SERVER` (GitHub → Settings → Secrets and variables → Actions → Variables) set to the Worker address. Each person then only types the access code.

### 3. On each phone

Open the link, then **Settings → Panko server**, enter the address (if not pre-filled) and the access code. To install it: Safari → Share → *Add to Home Screen*, or Chrome → ⋮ → *Install app*.

> **Just trying it yourself?** Choose **Settings → My own API key** and paste an Anthropic key. It is stored on that device only. Don't hand that out to a team; use the server instead.

## Develop

```bash
cd panko
npm install
npm run dev        # http://localhost:5173
npm test           # data/query/tool unit tests
npm run build
node scripts/make-demo-data.mjs   # regenerate public/demo/sales.csv
```

| Where | What |
|---|---|
| `src/lib/agent.ts` | The conversation loop with Claude (system prompt, streaming, tool calls) |
| `src/lib/tools.ts` | Tool definitions and what they do |
| `src/lib/data.ts` | File loading and the query engine |
| `src/lib/store.ts` | On-device storage |
| `src/lib/reportHtml.ts` | Report charts, print and download |
| `worker/` | The Panko server (API-key proxy) |

## Ideas for next steps

- Plug in live data instead of uploads (e.g. ShelfScan's sales file or an R2 bucket), so reports are always current.
- Shared reports and conversations across the team (needs a small database on the server).
- Scheduled reports ("every Monday, send me last week's best sellers").
- Sign-in per person instead of one shared access code.
