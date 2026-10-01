# Prism

**Drop in any text and watch [TypeSafe Jev](https://typesafe.ai) split it into *typed decisions*.**

Live: **https://abdulsalam-create.github.io/jev-prism/**

Most language models answer in prose you then have to parse. Jev (TypeSafe's "System One" decision model) answers in **types**: ask a question about some text and it returns a decision you can branch on directly, with the probabilities behind it. Prism showcases all three of Jev's primitives at once, on real content, in a single API call per example:

| Primitive | Returns | Prism shows it as |
|---|---|---|
| `choice` | one labelled option + a probability for every option | routing bars, winner highlighted |
| `score` | a rating that lands *between* ordered rubric levels, weighted by probability | a meter with a needle sitting between the level ticks |
| `noul` | a single yes/no probability from 0 to 1 | a yes/no gauge |

Each lens also surfaces the model's **confidence**, **latency**, **input tokens** and **cost** - the uncertainty most LLM demos hide.

### The five lenses
A support email (route · urgency · needs-human · churn-risk), a product review (sentiment · topic · defect · recommend), a social mention (intent · brand-risk · **sarcasm** · respond), a pull request (type · review-priority · touches-auth · has-tests), and an incident alert (severity · component · page-oncall · customer-facing). Every question set is a real, practical use of the model - triage, moderation, code review, on-call.

## How it reaches Jev (and why the key is safe)

Jev's API **blocks all browser origins** (CORS) and must see your API key server-side, so a static page can't call it directly. Prism is therefore a **hybrid**:

- **Out of the box** it replays *real* responses captured from the Jev API (`docs/data/samples.json`) - no key anywhere, works instantly on GitHub Pages.
- **Go live** on your own text by pointing Prism at the included Cloudflare Worker, which holds your key as a secret. Click **◦ offline → ● live**, paste the Worker URL (stored only in your browser), and edit any example.

**No API key is ever committed to this repo or shipped to the browser.**

### Deploy the live proxy (optional, free tier)
```bash
cd worker
npm i -g wrangler
wrangler login
wrangler secret put JEV_KEY     # paste your TypeSafe key when prompted
wrangler deploy
```
Copy the printed `https://jev-prism.<you>.workers.dev` URL into Prism's **Go live** dialog. To lock the proxy to your own page, set `ALLOW_ORIGIN` in `worker/worker.js` to your Pages origin before deploying.

## Re-capturing the samples
`capture.py` (in the repo history / scratch) runs each preset through `POST /v1/systemone` and writes `docs/data/samples.json`. The file contains only prompt text and model answers - never a key.

## Layout
```
docs/            GitHub Pages site (static)
  index.html     one screen
  style.css      theme-aware, responsive
  app.js         renders the three lens types from the API shape
  data/samples.json   real captured Jev responses
worker/          Cloudflare Worker proxy (holds the key as a secret)
```

## Credits
Decisions by [TypeSafe Jev](https://typesafe.ai) · `POST /v1/systemone`. Built as a demo of the model.
