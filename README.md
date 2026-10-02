# Jev Pipeline

A small, locally-run **decision pipeline** built on [TypeSafe Jev](https://typesafe.ai), the "System One" model that answers questions about text with *typed* decisions instead of prose.

A support ticket comes in. **Stage 1** triages it with three decisions in one call: a `choice` (which team), a `score` (urgency), and a `noul` (needs a human?). The app then reads the `choice` and, **in code**, routes to a team-specific **stage 2** that asks different questions depending on the route. Billing tickets get billing questions, security tickets get takeover questions, and so on.

Every run makes **real, live Jev calls** through a tiny local backend. Your API key stays on your machine and is never committed.

```
browser (localhost)  ->  server.py  (holds your key)  ->  Jev API  ->  back
```

## Why there is a backend

Jev's API blocks browser origins (CORS) and must see your secret key. A browser therefore cannot call it directly, and a public static page cannot safely hold a key. So `server.py` does two things: it serves the frontend in `web/`, and it exposes `POST /api/decide`, which attaches your key server-side and forwards the request to Jev. The browser only ever talks to `127.0.0.1`, so there is no CORS problem and the key never reaches the page.

## Run it

Requires Python 3 only. No pip installs, no npm.

```bash
git clone https://github.com/abdulsalam-create/jev-prism
cd jev-prism
cp .env.example .env          # then paste your Jev key into .env
python3 server.py             # serves http://127.0.0.1:8000
```

Open **http://127.0.0.1:8000**, pick an example ticket (or paste your own), and click **Run pipeline**. You get your own key from the [TypeSafe dashboard](https://typesafe.ai).

## What each decision type looks like

| Type | Jev returns | Shown as |
|---|---|---|
| `choice` | the chosen option + a probability for every option + confidence | bars, winner highlighted |
| `score` | a value that lands *between* ordered rubric levels, weighted by probability | a meter with a needle between the level ticks |
| `noul` | one yes/no probability from 0 to 1 | a yes/no gauge |

The stage-1 question that drives the routing is flagged **routes stage 2**, so you can see the model's output become the program's control flow.

## Files

```
server.py            stdlib backend: serves web/ + proxies /api/decide to Jev
.env.example         copy to .env and add your key (.env is gitignored)
web/
  index.html         page
  style.css          theme-aware, responsive
  app.js             orchestrates the pipeline and renders the three lens types
  pipeline.json      the pipeline: stage-1 questions, per-route stage-2 questions, examples
```

## Extending it

The whole pipeline is declarative in `web/pipeline.json`. Add a route to `stage1.questions.route.criteria`, add a matching entry under `branches`, and the app will route to it with no code change. Swap in a different domain (content moderation, lead scoring, PR triage) by replacing that one file.

## Credits

Decisions by [TypeSafe Jev](https://typesafe.ai) · `POST /v1/systemone`.
