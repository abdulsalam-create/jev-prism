"use strict";
const $ = s => document.querySelector(s);
const PRICE_PER_MTOK = 0.042; // USD per 1M input tokens

let SPEC = null;


Promise.all([
  fetch("pipeline.json").then(r => r.json()),
  fetch("/api/health").then(r => r.json()).catch(() => ({ key_set: false })),
]).then(([spec, health]) => {
  SPEC = spec;
  $("#title").textContent = spec.title;
  $("#subtitle").textContent = spec.subtitle;
  buildExamples();
  $("#state").value = spec.examples[0].state;
  reflectHealth(health);
});

function reflectHealth(h){
  if (!h.key_set){
    $("#note").innerHTML = "Backend has no key. Copy <code>.env.example</code> to <code>.env</code>, paste your Jev key, restart <code>server.py</code>.";
  }
}

function buildExamples(){
  $("#examples").innerHTML = SPEC.examples.map(e =>
    `<button class="pbtn" data-id="${e.id}">${e.label}</button>`
  ).join("");
  $("#examples").addEventListener("click", ev => {
    const b = ev.target.closest(".pbtn"); if (!b) return;
    const ex = SPEC.examples.find(x => x.id === b.dataset.id);
    $("#state").value = ex.state;
  });
}


async function decide(state, questions){
  const t0 = performance.now();
  const r = await fetch("/api/decide", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state, model: SPEC.model, questions }),
  });
  const json = await r.json();
  const ms = Math.round(performance.now() - t0);
  if (!r.ok) throw new Error(json.error || ("HTTP " + r.status));
  return { resp: json, ms };
}


$("#run").addEventListener("click", run);
async function run(){
  const state = $("#state").value.trim();
  if (!state) return;
  const btn = $("#run"); btn.disabled = true; btn.textContent = "Running…";
  $("#flow").innerHTML = "";
  $("#summary").innerHTML = "";
  const totals = { calls: 0, ms: 0, tok: 0 };

  try {
    const s1 = SPEC.stage1;
    const a1 = await decide(state, s1.questions);
    tally(totals, a1);
    renderStage(s1.title, s1.questions, a1.resp, a1.ms, s1.branch_on);

    const routeName = a1.resp.answers[s1.branch_on].choice;
    const branch = SPEC.branches[routeName];
    renderArrow(s1.branch_on, routeName, branch ? branch.title : "(no matching branch)");
    if (!branch){ finish(btn); return; }

    const a2 = await decide(state, branch.questions);
    tally(totals, a2);
    renderStage(branch.title, branch.questions, a2.resp, a2.ms, null);

    renderSummary(totals);
  } catch (err){
    $("#flow").innerHTML += `<div class="err">Live call failed: ${esc(err.message)}</div>`;
  } finally { finish(btn); }
}

function finish(btn){ btn.disabled = false; btn.textContent = "Run pipeline"; }
function tally(t, a){ t.calls++; t.ms += a.ms; t.tok += (a.resp.usage && a.resp.usage.input_tokens) || 0; }


function renderStage(title, questions, resp, ms, branchOn){
  const ans = resp.answers;
  const lenses = Object.keys(questions).map(name =>
    lens(name, questions[name], ans[name], name === branchOn)).join("");
  const card = `<section class="stage">
      <div class="shead"><h3>${esc(title)}</h3><span class="lat">live · ${ms} ms</span></div>
      ${lenses}
    </section>`;
  $("#flow").innerHTML += card;
}

function renderArrow(branchOn, routeName, targetTitle){
  $("#flow").innerHTML += `<div class="arrow">
      <span><code>${esc(branchOn)}</code> = <b>${esc(routeName)}</b></span>
      <span class="dn">↓ code routes to</span>
      <span class="tgt">${esc(targetTitle)}</span>
    </div>`;
}

function renderSummary(t){
  const cost = t.tok / 1e6 * PRICE_PER_MTOK;
  $("#summary").innerHTML = [
    `<b>${t.calls}</b> live Jev calls`,
    `<b>${t.ms}</b> ms total`,
    `<b>${t.tok}</b> input tokens`,
    `<b>$${cost.toFixed(6)}</b> total cost`,
  ].join("<span class='sep'>·</span>");
}

function lens(name, q, a, isRoute){
  if (!a) return "";
  const head = `<div class="lhead">
      <span class="lname">${esc(name)}</span>
      <span class="ltype ${a.type}">${a.type}</span>
      ${a.confidence != null ? `<span class="conf">confidence ${pct(a.confidence)}</span>` : ""}
    </div>
    ${typeof q.instructions === "string" ? `<div class="instr">${esc(q.instructions)}</div>` : ""}`;
  const body = a.type === "choice" ? choiceBody(a)
             : a.type === "score"  ? scoreBody(a)
             : a.type === "noul"   ? noulBody(a) : "";
  return `<div class="lens ${isRoute ? "isroute" : ""}">${head}${body}</div>`;
}

function choiceBody(a){
  return Object.entries(a.probabilities).sort((x, y) => y[1] - x[1]).map(([k, v]) => `
    <div class="opt ${k === a.choice ? "win" : ""}">
      <span class="lab">${esc(k)}</span>
      <span class="track"><i style="width:${(v * 100).toFixed(1)}%"></i></span>
      <span class="pct">${pct(v)}</span>
    </div>`).join("");
}

function scoreBody(a){
  const levels = Object.keys(a.legend).map(Number).sort((x, y) => x - y);
  const max = levels[levels.length - 1] || 1;
  const left = (a.score / max) * 100;
  const lo = Math.floor(a.score), hi = Math.ceil(a.score);
  const label = lo === hi ? a.legend[lo] : `between "${a.legend[lo]}" and "${a.legend[hi]}"`;
  return `
    <div class="scoreval"><b>${a.score.toFixed(2)}</b><span class="lvl">${esc(label)}</span></div>
    <div class="meter">
      <div class="mfill" style="width:${left}%"></div>
      <div class="mmark" style="left:${left}%"></div>
    </div>
    <div class="mticks">${levels.map(l => `<span>${l}</span>`).join("")}</div>
    <div class="legend">${levels.map(l => `<span><b>${l}</b>${esc(a.legend[l])}</span>`).join("")}</div>`;
}

function noulBody(a){
  const v = a.noul;
  const cls = v >= 0.6 ? "yes" : v <= 0.4 ? "no" : "maybe";
  const word = cls === "yes" ? "YES" : cls === "no" ? "NO" : "MAYBE";
  const col = cls === "yes" ? "var(--good)" : cls === "no" ? "var(--bad)" : "var(--warn)";
  return `<div class="noul">
      <div class="ngauge"><span class="nmid"></span><i style="width:${(v * 100).toFixed(1)}%;background:${col}"></i></div>
      <div class="nval">${v.toFixed(2)}<span class="yn ${cls}">${word}</span></div>
    </div>`;
}


function pct(v){ return (v * 100).toFixed(v >= 0.995 || v === 0 ? 0 : 1).replace(/\.0$/, "") + "%"; }
function esc(s){ return String(s).replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c])); }
