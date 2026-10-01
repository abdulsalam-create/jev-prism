"use strict";
const $ = s => document.querySelector(s);
const PRICE_PER_MTOK = 0.042;          // USD per 1M input tokens
const LS = "jev-prism-proxy";

let DATA = null, cur = null, proxy = localStorage.getItem(LS) || "";

/* ---------- boot ---------- */
fetch("data/samples.json").then(r => r.json()).then(d => {
  DATA = d;
  buildPresets();
  select(d.presets[0].id);
  reflectProxy();
}).catch(() => {
  $("#lenses").innerHTML = `<div class="placeholder">Could not load sample data.</div>`;
});

function buildPresets(){
  $("#presets").innerHTML = DATA.presets.map(p =>
    `<button class="pbtn" data-id="${p.id}"><span class="ic">${p.icon}</span>${p.label}</button>`
  ).join("");
  $("#presets").addEventListener("click", e => {
    const b = e.target.closest(".pbtn"); if (b) select(b.dataset.id);
  });
}

function select(id){
  cur = DATA.presets.find(p => p.id === id);
  document.querySelectorAll(".pbtn").forEach(b => b.classList.toggle("on", b.dataset.id === id));
  $("#blurb").textContent = cur.blurb;
  $("#state").value = cur.request.state;
  render(cur.response, { source: "captured", latency: cur.latency_ms });
  onEdit();
}

/* ---------- input state ---------- */
$("#state").addEventListener("input", onEdit);
$("#reset").addEventListener("click", () => { $("#state").value = cur.request.state; onEdit();
  render(cur.response, { source: "captured", latency: cur.latency_ms }); });

function edited(){ return $("#state").value.trim() !== cur.request.state.trim(); }

function onEdit(){
  const ed = edited();
  $("#reset").hidden = !ed;
  const note = $("#note");
  if (!ed){ note.innerHTML = ""; $("#run").disabled = false; return; }
  if (proxy){ note.innerHTML = "custom text - runs live through your proxy"; $("#run").disabled = false; }
  else { note.innerHTML = `custom text needs a live proxy - <a id="opencfg">connect one</a>`;
         $("#run").disabled = true;
         $("#opencfg").onclick = () => dlg.showModal(); }
}

/* ---------- run ---------- */
$("#run").addEventListener("click", run);
async function run(){
  if (!edited()){                       // unchanged preset → replay captured
    render(cur.response, { source: "captured", latency: cur.latency_ms });
    return;
  }
  if (!proxy) return;
  const btn = $("#run"); btn.disabled = true; btn.textContent = "Splitting…";
  const body = { state: $("#state").value, model: DATA.model, questions: cur.request.questions };
  const t0 = performance.now();
  try {
    const r = await fetch(proxy, { method:"POST", headers:{ "Content-Type":"application/json" },
                                   body: JSON.stringify(body) });
    if (!r.ok) throw new Error("HTTP " + r.status + " - " + (await r.text()).slice(0,140));
    const resp = await r.json();
    render(resp, { source:"live", latency: Math.round(performance.now() - t0) });
  } catch (err){
    $("#lenses").innerHTML = `<div class="placeholder">Live call failed.<br>${esc(err.message)}<br>
      <small>Check the proxy URL in settings.</small></div>`;
    $("#meta").innerHTML = "";
  } finally { btn.disabled = false; btn.textContent = "Split through Jev"; }
}

/* ---------- render ---------- */
function render(resp, info){
  const qs = cur.request.questions, ans = resp.answers;
  $("#srcbadge").className = "src " + info.source;
  $("#srcbadge").textContent = info.source === "captured"
    ? "captured · " + DATA.captured : "live · " + info.latency + "ms";
  $("#lenses").innerHTML = Object.keys(qs).map(name => lens(name, qs[name], ans[name])).join("");

  const u = resp.usage || {};
  const cost = u.input_tokens ? (u.input_tokens / 1e6 * PRICE_PER_MTOK) : 0;
  $("#meta").innerHTML = [
    `model <b>${esc(resp.model || DATA.model)}</b>`,
    `latency <b>${info.latency} ms</b>`,
    u.input_tokens != null ? `input <b>${u.input_tokens}</b> tok` : "",
    cost ? `cost <b>$${cost.toFixed(6)}</b>` : "",
    `<b>${Object.keys(qs).length}</b> decisions in one call`,
  ].filter(Boolean).join("");
}

function lens(name, q, a){
  if (!a) return "";
  const head = (type) => `<div class="lhead">
      <span class="lname">${esc(name)}</span>
      <span class="ltype ${type}">${type}</span>
      ${a.confidence != null ? `<span class="conf">confidence ${pct(a.confidence)}</span>` : ""}
    </div>
    ${q.instructions && typeof q.instructions === "string"
      ? `<div class="instr">${esc(q.instructions)}</div>` : ""}`;

  if (a.type === "choice") return `<div class="lens">${head("choice")}${choiceBody(a)}</div>`;
  if (a.type === "score")  return `<div class="lens">${head("score")}${scoreBody(a)}</div>`;
  if (a.type === "noul")   return `<div class="lens">${head("noul")}${noulBody(a)}</div>`;
  return "";
}

function choiceBody(a){
  const entries = Object.entries(a.probabilities)
    .sort((x,y) => y[1] - x[1]);
  return entries.map(([k,v]) => `
    <div class="opt ${k === a.choice ? "win" : ""}">
      <span class="lab">${esc(k)}</span>
      <span class="track"><i style="width:${(v*100).toFixed(1)}%"></i></span>
      <span class="pct">${pct(v)}</span>
    </div>`).join("");
}

function scoreBody(a){
  const levels = Object.keys(a.legend).map(Number).sort((x,y)=>x-y);
  const max = levels[levels.length-1] || 1;
  const left = (a.score / max) * 100;
  const lowIdx = Math.floor(a.score), hiIdx = Math.ceil(a.score);
  const lvlLabel = lowIdx === hiIdx ? a.legend[lowIdx]
    : `between “${a.legend[lowIdx]}” and “${a.legend[hiIdx]}”`;
  return `
    <div class="scoreval"><b>${a.score.toFixed(2)}</b><span class="lvl">${esc(lvlLabel)}</span></div>
    <div class="meter">
      <div class="mtrack"></div>
      <div class="needle" style="left:${left}%"></div>
      <div class="mticks">${levels.map(l => `<span class="mtick">${l}</span>`).join("")}</div>
    </div>
    <div class="legend">${levels.map(l =>
      `<span><b>${l}</b> ${esc(a.legend[l])}</span>`).join("")}</div>`;
}

function noulBody(a){
  const v = a.noul;
  const cls = v >= 0.6 ? "yes" : v <= 0.4 ? "no" : "maybe";
  const word = cls === "yes" ? "YES" : cls === "no" ? "NO" : "MAYBE";
  const col = cls === "yes" ? "var(--good)" : cls === "no" ? "var(--bad)" : "var(--warn)";
  return `<div class="noul">
      <div class="ngauge"><span class="nmid"></span>
        <i style="width:${(v*100).toFixed(1)}%;background:${col}"></i></div>
      <div class="nval">${v.toFixed(2)}<span class="yn ${cls}">${word}</span></div>
    </div>`;
}

/* ---------- proxy config ---------- */
const dlg = $("#cfgdlg");
$("#cfg").addEventListener("click", () => dlg.showModal());
$("#proxyurl").value = proxy;
dlg.addEventListener("close", () => {
  if (dlg.returnValue === "cancel") { $("#proxyurl").value = proxy; return; }
});
$("#savecfg").addEventListener("click", () => {
  proxy = $("#proxyurl").value.trim();
  if (proxy) localStorage.setItem(LS, proxy); else localStorage.removeItem(LS);
  reflectProxy(); onEdit();
});
$("#clearproxy").addEventListener("click", e => {
  e.preventDefault(); proxy = ""; localStorage.removeItem(LS);
  $("#proxyurl").value = ""; reflectProxy(); onEdit(); dlg.close();
});
function reflectProxy(){
  const on = !!proxy;
  $("#cfg").classList.toggle("live", on);
  $("#cfg").textContent = on ? "● live" : "◦ offline";
  $("#cfg").title = on ? "Live proxy connected - click to change" : "Replaying captured responses - click to go live";
  $("#clearrow").hidden = !on;
}

/* ---------- utils ---------- */
function pct(v){ return (v*100).toFixed(v >= 0.995 || v === 0 ? 0 : 1).replace(/\.0$/,"") + "%"; }
function esc(s){ return String(s).replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c])); }
