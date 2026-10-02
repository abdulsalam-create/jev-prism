# Stop Parsing LLM Output: I Built a Routing Pipeline on a Decision-Only Model

Every LLM tutorial ends the same way. You get back a blob of text, and now you have to parse it. You beg the model for JSON. It hands you JSON wrapped in an apology. You write a regex. The regex breaks on the next prompt. You add a retry. The retry costs you another second and another fraction of a cent.

So I built a small app on a model that **cannot write a sentence**, and that turned out to be the entire point.

Here is what I learned building a support-ticket router on a decision-only LLM.

---

## The problem: your code wants a decision, the model gives you an essay

Most "AI feature" work is not generation. It is classification and routing. Which team should this ticket go to? How urgent is it? Is this a security incident? Should a human see it?

Those are decisions your code needs to branch on. A `switch`, an `if`, a priority sort. But a chat model answers them in prose:

> "This looks like a billing issue, and it seems fairly urgent given the tone, so I'd route it to..."

Now you are parsing. You prompt for JSON, you validate the shape, you handle the time it returns `"Billing"` instead of `"billing"`, you retry when it wraps the object in a code fence. You have built a brittle translation layer between a text generator and a program that just wanted one value.

## Meet the decision-only model

[Jev](https://typesafe.ai) (TypeSafe's "System One" model) skips the prose entirely. You give it some text and a set of typed questions, and it answers in types.

The name is not an accident. In Daniel Kahneman's *Thinking, Fast and Slow*, **System 1** is the fast, automatic, intuitive mind: the part that reads a short message and just *knows*, with no deliberate reasoning. **System 2** is the slow, effortful mind you use for long division or weighing a hard choice. Most models we reach for behave like System 2: they deliberate, they explain, they take their time. Jev is deliberately System 1: a snap judgment, returned as a type, in a few hundred milliseconds. For triage you do not want a System 2 essay agonising over a ticket. You want a fast, confident reflex, and then your own code decides what to do with it.

There are three primitives:

- **`choice`** picks one labelled option. You get the chosen option, a probability for every option, and a confidence.
- **`score`** rates against an ordered rubric. You get a number that can land *between* the levels, weighted by the probabilities.
- **`noul`** is a single yes/no probability from 0 to 1.

One request, in the shape your code already thinks in:

```json
POST /v1/systemone
{
  "state": "I was charged twice this morning and support has not replied.",
  "model": "jev-latest",
  "questions": {
    "route":   { "type": "choice", "criteria": { "billing": "...", "technical": "...", "account": "...", "abuse": "..." } },
    "urgency": { "type": "score",  "criteria": ["Can wait", "This week", "Today", "Drop everything"] },
    "needs_human": { "type": "noul", "instructions": "Does this need a human agent?" }
  }
}
```

And the answer comes back already typed, no parsing required:

```json
{
  "answers": {
    "route":   { "choice": "billing", "confidence": 1.0, "probabilities": { "billing": 1.0, "technical": 0.0, ... } },
    "urgency": { "score": 2.28, "legend": { "0": "Can wait", "1": "This week", "2": "Today", "3": "Drop everything" } },
    "needs_human": { "noul": 0.92 }
  }
}
```

Notice `urgency: 2.28`. That is not a bucket. It is the probability-weighted average across the rubric, sitting between "Today" and "Drop everything". You get the model's uncertainty as a number, for free.

## What I built: a two-stage triage pipeline

A single classification is a nice demo. A pipeline is a real app. So I wired two stages where **the first decision chooses the second**:

```
ticket
  -> Stage 1: triage   (route + urgency + needs_human)
  -> code reads route
  -> Stage 2: team-specific questions  (billing? technical? account? abuse?)
```

A billing ticket gets billing questions. A suspected account takeover gets security questions. The model does the understanding; my code does the branching.

## Stage 1: three decisions in one call

The whole triage is one request. In my testing it ran in about **0.9 seconds** on roughly **500 input tokens**, which at Jev's pricing is a few thousandths of a cent.

```js
const r = await fetch("/api/decide", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ state: ticket, model, questions: stage1.questions }),
});
const { answers } = await r.json();
```

No prompt engineering to force a format. No `JSON.parse` wrapped in a try/catch. The response is the shape.

## The move that matters: the decision is the control flow

Here is the part that made the whole design click. With a chat model, I would be extracting `"billing"` out of a sentence. With a decision model, the answer is already a value I can use as a map key:

```js
const route  = answers.route.choice;        // "billing"
const stage2 = pipeline.branches[route];    // just an object lookup
```

That is it. The model's output drops straight into an object lookup and becomes the next step of the program. The "AI" and the control flow are the same line of code.

## Stage 2: different questions per route

Each route points at its own question set, declared as plain data:

```json
"branches": {
  "billing": { "questions": {
    "subtype":        { "type": "choice", "criteria": { "double_charge": "...", "refund_request": "...", ... } },
    "churn_risk":     { "type": "noul",  "instructions": "Is this customer at risk of cancelling?" },
    "auto_refundable":{ "type": "noul",  "instructions": "Can this be auto-refunded without a manager?" }
  }},
  "account": { "questions": {
    "issue":             { "type": "choice", "criteria": { "cannot_login": "...", "password_reset": "...", ... } },
    "security_sensitive":{ "type": "noul", "instructions": "Could this be an account takeover?" },
    "verify_identity":   { "type": "noul", "instructions": "Require extra identity verification first?" }
  }}
}
```

Adding a whole new route is a data change, not a code change. The engine stays the same.

## The part the docs do not warn you about: you still need a backend

I wanted this to run as a static page. It cannot, for two reasons I only found by trying:

1. **The API blocks browser origins.** I sent a preflight from a GitHub Pages origin and got `Disallowed CORS origin`. I tried localhost. I tried the vendor's own app origin. All rejected. This API is server-to-server by design.
2. **It needs a secret key**, which you can never ship inside a public page.

So the fix is a tiny backend. Mine is about 40 lines of Python standard library, no dependencies:

```python
def call_jev(payload):
    body = json.dumps(payload).encode()
    req = urllib.request.Request(JEV_URL, data=body, method="POST", headers={
        "Authorization": "Bearer " + KEY,      # key lives here, never in the browser
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.status, json.loads(r.read())
```

The browser only ever talks to `127.0.0.1`. The backend holds the key and makes the real call. No CORS problem, because the browser never touches the vendor. This is the boring, correct way to use any keyed API, and it is worth saying out loud because "just call it from the frontend" is the first thing most tutorials do wrong.

## Results: what it actually does

I ran four realistic tickets through the full two-stage pipeline. Every one routed correctly, and the second stage caught the thing that actually matters:

| Ticket | Stage 1 route | Key stage-2 signals |
|---|---|---|
| "Charged twice, disputing with my bank" | **billing** | `double_charge` 1.00, `churn_risk` 0.98, `auto_refundable` 0.43 (correctly unsure, it is disputed) |
| "Checkout API returning 503, losing sales" | **technical** | severity 3.0, `is_regression` 0.99 |
| "Password and email changed, not me, locked out" | **account** | `security_sensitive` 0.97, `verify_identity` 0.92 |
| "A user said he knows where I live" | **abuse** | `credible_threat` 0.81, escalation 2.95 |

Two live calls per ticket, roughly 1.7 seconds and about 1,000 input tokens total, well under a hundredth of a cent. The `auto_refundable` 0.43 is my favourite output: the model is telling me it is genuinely uncertain, so route it to a human instead of auto-approving. That is a signal a parsed text label would have thrown away.

## When a decision model is the wrong tool

This is not a chat model, and pretending otherwise will burn you:

- **You need generated text** (a reply, a summary, code). Wrong tool. Use a generative model.
- **Your categories are open-ended** and you cannot enumerate them. `choice` needs options.
- **You want one freeform answer.** Overkill, just prompt a normal model.

It shines when the model's answer becomes an `if` or a `switch`: routing, triage, moderation, scoring, gating, prioritisation. Anything where you were about to parse a label out of prose.

The real pattern is to use both minds. Let a fast System 1 model like Jev make the snap, typed decisions, and reserve a slow System 2 model (a large reasoning or generative model) for the work that genuinely needs deliberation, like writing the actual reply to the customer. Cheap reflex up front, expensive thought only where it earns its keep. Kahneman's whole point was that a healthy mind knows which system to hand a problem to; the same is true of a system design.

## Should you reach for one? A quick checklist

- Does your code branch on the model's answer?
- Can you enumerate the options, or define a rubric?
- Do you want probabilities and confidence, not just a bare label?
- Are you tired of coaxing and parsing JSON out of a text model?

If that is mostly "yes", a decision model will make the feature smaller and more reliable.

## TL;DR

- Chat models answer in prose you have to parse. A decision model answers in types you can branch on.
- Jev is a "System 1" model in Kahneman's *Thinking, Fast and Slow* sense: fast intuition, not slow deliberation. Pair it with a System 2 model for the heavy thinking.
- I built a two-stage support router: one call triages, the result picks the next set of questions, and the model's output becomes an object lookup.
- The API blocks browsers and needs a key, so it runs behind a 40-line zero-dependency backend that keeps the key server-side.
- Four realistic tickets routed correctly, in about 1.7 seconds and a hundredth of a cent each, with uncertainty surfaced as numbers.

Code and the full pipeline are on GitHub: [github.com/abdulsalam-create/jev-prism](https://github.com/abdulsalam-create/jev-prism).
