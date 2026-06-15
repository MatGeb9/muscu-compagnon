import { PROGRAM, EXERCISES, JOINTS } from "./data.js";
import * as store from "./store.js";

const $ = (s, r = document) => r.querySelector(s);
const app = $("#app");

let state = { tab: "home", screen: "home", routineIdx: null, warmup: null, live: null };
let sessionTimer = null, restTimer = null;
let rest = { running: false, remaining: 0, total: 0, endAt: 0 };

// ---------- utils ----------
const fmtClock = s => `${Math.floor(s / 60)}:${String(Math.max(0, s % 60)).padStart(2, "0")}`;
const exOf = id => EXERCISES[id] || { name: id, group: "", cues: [], mistakes: [], instructions: "" };
const fmtNum = n => (Math.round(n * 100) / 100).toString();
function jointsFor(routine) {
  const set = new Set();
  routine.exercises.forEach(e => (JOINTS[exOf(e.ex).group] || []).forEach(j => set.add(j)));
  const order = ["épaules","coudes","poignets","colonne","hanches","genoux","chevilles"];
  const r = order.filter(j => set.has(j));
  return r.length ? r.join(", ") : "épaules, hanches, genoux";
}
function toast(msg) {
  const t = document.createElement("div"); t.className = "toast"; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.classList.add("show"), 10);
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, 2600);
}
function startOfWeek() {
  const d = new Date(); const day = (d.getDay() + 6) % 7; // lundi=0
  d.setHours(0,0,0,0); d.setDate(d.getDate() - day); return d;
}

// ---------- render dispatcher ----------
function render() {
  if (state.screen === "warmup") return renderWarmup();
  if (state.screen === "live") return renderLive();
  app.innerHTML = ({ home: renderHome, programmes: renderProgrammes, exos: renderExos, progress: renderProgress, profil: renderProfil }[state.tab] || renderHome)();
  renderTabbar();
}
function renderTabbar() {
  const tabs = [["home","Entraînement","🏋️"],["programmes","Programmes","📋"],["exos","Exercices","📚"],["progress","Progression","📈"],["profil","Profil","👤"]];
  let bar = $("#tabbar");
  bar.innerHTML = tabs.map(([k,l,i]) =>
    `<button class="tab ${state.tab===k?"active":""}" data-tab="${k}"><span>${i}</span>${l}</button>`).join("");
  bar.style.display = (state.screen === "home" ? "" : "none");
}

// ---------- HOME ----------
function renderHome() {
  const sessions = store.getSessions();
  const ws = startOfWeek().toISOString();
  const done = sessions.filter(s => s.date >= ws).length;
  const cards = PROGRAM.map((r, i) => `
    <div class="card routine" data-action="open-warmup" data-idx="${i}">
      <span class="bar" style="background:${r.color}"></span>
      <div class="grow">
        <div class="title">${r.name}</div>
        <div class="sub">${r.exercises.length} exercices · ${r.summary}</div>
      </div>
      <button class="btn primary" data-action="open-warmup" data-idx="${i}">Démarrer</button>
    </div>`).join("");
  const hist = sessions.slice(0, 6).map(s => `
    <div class="card sm"><div class="grow"><div class="title">${s.routineName}</div>
      <div class="sub">${new Date(s.date).toLocaleDateString("fr-FR",{weekday:"short",day:"numeric",month:"short"})} · ${s.sets.filter(x=>!x.isWarmup).length} séries</div></div>
      <div class="sub">${Math.round((s.totalVolume||0))} kg</div></div>`).join("");
  return `
    <header class="head"><h1>Entraînement</h1></header>
    <div class="scroll">
      <div class="week"><div class="weeklabel">Cette semaine</div>
        <div class="weekbig">${done}<span>/5 séances</span></div></div>
      <h2>Mes séances</h2>
      ${cards}
      ${sessions.length ? `<h2>Historique</h2>${hist}` : `<p class="muted">Aucune séance enregistrée. Lance ta première !</p>`}
      <div class="pad"></div>
    </div>`;
}

// ---------- PROGRAMMES ----------
function renderProgrammes() {
  const body = PROGRAM.map(r => `
    <div class="card col"><div class="rowline"><span class="bar" style="background:${r.color}"></span>
      <div class="title">${r.name}</div></div>
      ${r.exercises.map(e => { const x = exOf(e.ex); return `
        <div class="exline" data-action="info" data-ex="${e.ex}"><div class="grow"><b>${x.name}</b>
        <div class="sub">${e.sets} séries · ${e.repLow}-${e.repHigh} reps · repos ${e.rest}s${e.ladder&&e.ladder.length?` · échelle ${e.ladder.join("/")}`:""}</div>
        ${e.notes?`<div class="note">📝 ${e.notes}</div>`:""}</div><span class="chev">ⓘ</span></div>`; }).join("")}
    </div>`).join("");
  return `<header class="head"><h1>Programmes</h1></header><div class="scroll">${body}<div class="pad"></div></div>`;
}

// ---------- PROGRESSION ----------
function renderProgress() {
  const sessions = store.getSessions();
  const weights = store.getBodyWeights();
  const list = sessions.map(s => `
    <div class="card sm"><div class="grow"><div class="title">${s.routineName}</div>
      <div class="sub">${new Date(s.date).toLocaleString("fr-FR",{weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}</div></div>
      <div class="sub">${s.sets.filter(x=>!x.isWarmup).length} séries · ${Math.round(s.totalVolume||0)} kg</div></div>`).join("")
    || `<p class="muted">Pas encore de séance.</p>`;
  const wlist = weights.slice(0,8).map(w => `<div class="exline"><div class="grow">${new Date(w.date).toLocaleDateString("fr-FR")}</div><b>${w.weightKg} kg</b></div>`).join("");
  return `<header class="head"><h1>Progression</h1></header><div class="scroll">
    <div class="card col"><div class="title">Poids du corps</div>
      <div class="rowline"><input id="bw" class="field" type="number" inputmode="decimal" placeholder="kg"/>
      <button class="btn primary" data-action="addbw">Ajouter</button></div>${wlist}</div>
    <h2>Séances réalisées</h2>${list}<div class="pad"></div></div>`;
}

// ---------- PROFIL ----------
function renderProfil() {
  const last = store.getSetting("lastBackup");
  const remind = store.getSetting("remindBackup");
  return `<header class="head"><h1>Profil</h1></header><div class="scroll">
    <div class="card col"><div class="title">Sauvegarde (iCloud)</div>
      <p class="sub">Tes données sont enregistrées en local. Exporte un fichier JSON et range-le dans <b>Fichiers → iCloud Drive</b> pour ne jamais rien perdre.</p>
      <div class="rowline">
        <button class="btn primary" data-action="export">Exporter</button>
        <button class="btn" data-action="import">Importer</button>
      </div>
      <label class="rowline"><input type="checkbox" id="remind" ${remind?"checked":""}/> Me rappeler de sauvegarder après chaque séance</label>
      <div class="sub">Dernière sauvegarde : ${last?new Date(last).toLocaleString("fr-FR"):"jamais"}</div>
    </div>
    <input id="importfile" type="file" accept="application/json,.json" hidden/>
    <div class="card col"><div class="title">À propos</div>
      <p class="sub">Muscu — appli web (PWA). Ajoute-la à l'écran d'accueil pour l'utiliser comme une app. 💪</p></div>
    <div class="pad"></div></div>`;
}

// ---------- EXERCICES (bibliothèque) ----------
function renderExos() {
  const groups = {};
  for (const [id, x] of Object.entries(EXERCISES)) (groups[x.group] = groups[x.group] || []).push([id, x]);
  const body = Object.entries(groups).map(([g, list]) => `
    <h2>${g}</h2>
    <div class="card col">${list.map(([id, x]) => `
      <div class="exline" data-action="info" data-ex="${id}">
        <div class="grow"><b>${x.name}</b><div class="sub">${x.equipment}</div></div>
        <span class="chev">ⓘ</span></div>`).join("")}</div>`).join("");
  return `<header class="head"><h1>Exercices</h1></header><div class="scroll">
    <p class="sub">Touche un exercice pour la technique : exécution, points clés, erreurs à éviter.</p>${body}<div class="pad"></div></div>`;
}
function showExercise(id) {
  const x = exOf(id);
  const m = document.createElement("div");
  m.className = "modal"; m.dataset.action = "close-modal";
  m.innerHTML = `<div class="sheet" data-action="stop">
    <div class="rowline"><div class="grow"><div class="title">${x.name}</div>
      <div class="sub">${x.group}${x.equipment ? " · " + x.equipment : ""}</div></div>
      <button class="link strong" data-action="close-modal">Fermer</button></div>
    ${x.instructions ? `<h3>Exécution</h3><p>${x.instructions}</p>` : ""}
    ${x.cues && x.cues.length ? `<h3>Points clés</h3><ul>${x.cues.map(c => `<li>${c}</li>`).join("")}</ul>` : ""}
    ${x.mistakes && x.mistakes.length ? `<h3>Erreurs fréquentes</h3><ul>${x.mistakes.map(c => `<li>⚠️ ${c}</li>`).join("")}</ul>` : ""}
  </div>`;
  document.body.appendChild(m);
}

// ---------- WARM-UP ----------
function openWarmup(idx) {
  const r = PROGRAM[idx];
  state.routineIdx = idx; state.screen = "warmup";
  state.warmup = { remaining: 120, endAt: Date.now() + 120000, firstEx: r.exercises[0].ex };
  render();
  clearInterval(restTimer);
  restTimer = setInterval(() => {
    if (!state.warmup) return;
    state.warmup.remaining = Math.max(0, Math.ceil((state.warmup.endAt - Date.now()) / 1000));
    updateWarmupTimer();
    if (state.warmup.remaining <= 0) clearInterval(restTimer);
  }, 250);
}
function renderWarmup() {
  const r = PROGRAM[state.routineIdx], w = state.warmup;
  app.innerHTML = `
    <header class="head"><button class="link" data-action="cancel-warmup">Annuler</button><h1>Échauffement</h1><span></span></header>
    <div class="scroll center">
      <div class="chrono" id="chrono">
        <div class="time" id="chronotime">${fmtClock(w.remaining)}</div><div class="sub">Mobilité</div></div>
      <p class="sub" style="text-align:center">Mobilise tes articulations : <b>${jointsFor(r)}</b>.</p>
      <h2>Par quel exercice commencer ?</h2>
      <p class="sub">Une série d'échauffement « à blanc » sera ajoutée à cet exercice (en plus de ses 4 séries).</p>
      ${r.exercises.map(e => { const x = exOf(e.ex); const sel = state.warmup.firstEx === e.ex;
        return `<div class="card pick ${sel?"sel":""}" data-action="pickfirst" data-ex="${e.ex}">
          <span class="radio">${sel?"●":"○"}</span><div class="grow">${x.name}</div></div>`; }).join("")}
      <div class="pad"></div>
    </div>
    <div class="bottombar">
      <button class="btn primary big" id="beginbtn" data-action="begin" ${w.remaining>0?"disabled":""}>
        ${w.remaining>0?`Échauffement en cours… ${w.remaining}s`:"Commencer la séance"}</button>
      ${w.remaining>0?`<button class="link" data-action="skip-warmup">Passer l'échauffement</button>`:""}
    </div>`;
  renderTabbar();
}
function updateWarmupTimer() {
  const w = state.warmup; if (!w) return;
  const t = $("#chronotime"); if (t) t.textContent = fmtClock(w.remaining);
  const btn = $("#beginbtn");
  if (btn) {
    if (w.remaining > 0) { btn.disabled = true; btn.textContent = `Échauffement en cours… ${w.remaining}s`; }
    else if (btn.disabled) { renderWarmup(); } // bascule en "Commencer"
  }
}

// ---------- LIVE WORKOUT ----------
function beginWorkout() {
  const r = PROGRAM[state.routineIdx];
  const order = [...r.exercises];
  const fi = order.findIndex(e => e.ex === state.warmup.firstEx);
  if (fi > 0) order.unshift(order.splice(fi, 1)[0]);

  const exercises = order.map((e, pos) => {
    const x = exOf(e.ex);
    const sug = store.suggestWeight(x.name, e.repHigh, e.ladder);
    const last = store.lastSetsFor(x.name);
    const sets = [];
    if (pos === 0) {
      const base = last[0]?.weight ?? sug ?? (e.ladder?.[0] || 0);
      sets.push({ setIndex: 0, weight: Math.round(base * 0.5), reps: e.repHigh, isWarmup: true, done: false });
    }
    for (let i = 0; i < e.sets; i++) {
      const prev = last[i] || last[last.length - 1];
      sets.push({ setIndex: i + 1, weight: prev?.weight ?? sug ?? (e.ladder?.[0] || 0), reps: prev?.reps ?? e.repHigh, isWarmup: false, done: false });
    }
    return { ex: e.ex, name: x.name, rest: e.rest, repLow: e.repLow, repHigh: e.repHigh, notes: e.notes || "",
      lastSummary: last.length ? "Dernière fois : " + last.map(s => `${fmtNum(s.weight)}×${s.reps}`).join("  ") : "", sets };
  });
  state.live = { routineName: r.name, color: r.color, startAt: Date.now(), exercises };
  state.screen = "live";
  clearInterval(restTimer);
  render();
  clearInterval(sessionTimer);
  sessionTimer = setInterval(() => { const e = $("#elapsed"); if (e) e.textContent = fmtClock(Math.floor((Date.now() - state.live.startAt) / 1000)); }, 1000);
}
function liveStats() {
  const all = state.live.exercises.flatMap(e => e.sets).filter(s => !s.isWarmup);
  const done = all.filter(s => s.done);
  return { done: done.length, total: all.length, vol: Math.round(done.reduce((a, s) => a + s.weight * s.reps, 0)) };
}
function renderLive() {
  const L = state.live, st = liveStats();
  app.innerHTML = `
    <header class="head live" style="border-color:${L.color}">
      <button class="link danger" data-action="cancel-live">Annuler</button><h1>${L.routineName}</h1>
      <button class="link strong" data-action="finish">Terminer</button></header>
    ${rest.running ? renderRestBanner() : ""}
    <div class="scroll">
      <div class="stats"><div><b id="elapsed">0:00</b><span>Durée</span></div>
        <div><b id="setcount">${st.done}/${st.total}</b><span>Séries</span></div>
        <div><b id="vol">${st.vol}</b><span>Volume kg</span></div></div>
      ${L.exercises.map((e, ei) => `
        <div class="card col exercise">
          <div class="rowline"><div class="grow"><div class="title">${e.name}</div>
            <span class="badge">${exOf(e.ex).group}</span></div>
            <button class="info" data-action="info" data-ex="${e.ex}">ⓘ</button></div>
          ${e.lastSummary ? `<div class="note">${e.lastSummary}</div>` : ""}
          ${e.notes ? `<div class="note">📝 ${e.notes}</div>` : ""}
          <div class="setgrid head"><span>Série</span><span>kg</span><span>Reps</span><span>✓</span></div>
          ${e.sets.map((s, si) => `
            <div class="setgrid ${s.done?"done":""}">
              <span class="${s.isWarmup?"warm":""}">${s.isWarmup?"Éch":s.setIndex}</span>
              <input class="field" type="number" inputmode="decimal" value="${s.weight}" data-f="weight" data-ei="${ei}" data-si="${si}"/>
              <input class="field" type="number" inputmode="numeric" value="${s.reps}" data-f="reps" data-ei="${ei}" data-si="${si}"/>
              <button class="check ${s.done?"on":""}" data-action="toggle" data-ei="${ei}" data-si="${si}">${s.done?"✓":"○"}</button>
            </div>`).join("")}
          <button class="btn ghost" data-action="addset" data-ei="${ei}">+ série</button>
        </div>`).join("")}
      <button class="btn primary big" data-action="finish">Terminer la séance</button>
      <div class="pad"></div>
    </div>`;
  renderTabbar();
}
function renderRestBanner() {
  return `<div class="restbanner"><div class="rowline"><span>⏱️ Repos</span><b id="resttime">${fmtClock(rest.remaining)}</b></div>
    <div class="progress"><div id="restfill" style="width:${rest.total?(1-rest.remaining/rest.total)*100:0}%"></div></div>
    <div class="rowline"><button class="btn sm" data-action="rest-add">+15s</button>
      <button class="btn sm" data-action="rest-skip">Passer</button></div></div>`;
}
function startRest(seconds) {
  clearInterval(restTimer);
  rest = { running: true, remaining: seconds, total: seconds, endAt: Date.now() + seconds * 1000 };
  render();
  restTimer = setInterval(() => {
    rest.remaining = Math.max(0, Math.ceil((rest.endAt - Date.now()) / 1000));
    const rt = $("#resttime"), rf = $("#restfill");
    if (rt) rt.textContent = fmtClock(rest.remaining);
    if (rf) rf.style.width = `${rest.total ? (1 - rest.remaining / rest.total) * 100 : 0}%`;
    if (rest.remaining <= 0) { clearInterval(restTimer); rest.running = false; navigator.vibrate && navigator.vibrate(200); render(); }
  }, 250);
}
function refreshLiveStats() {
  const st = liveStats();
  const a = $("#setcount"), b = $("#vol"); if (a) a.textContent = `${st.done}/${st.total}`; if (b) b.textContent = st.vol;
}
function finishWorkout() {
  const L = state.live;
  const sets = []; let order = 0;
  L.exercises.forEach(e => e.sets.filter(s => s.done).forEach(s => {
    sets.push({ exerciseName: e.name, order: order++, setIndex: s.setIndex, weight: +s.weight, reps: +s.reps, isWarmup: s.isWarmup });
  }));
  if (!sets.length) { if (!confirm("Aucune série validée. Quitter sans enregistrer ?")) return; cancelLive(); return; }
  const totalVolume = sets.filter(s => !s.isWarmup).reduce((a, s) => a + s.weight * s.reps, 0);
  store.addSession({ id: store.uid(), date: new Date(L.startAt).toISOString(), endDate: new Date().toISOString(),
    routineName: L.routineName, totalVolume, sets });
  clearInterval(sessionTimer); clearInterval(restTimer); rest.running = false;
  state.screen = "home"; state.tab = "home"; state.live = null; render();
  toast("Séance enregistrée 💪");
  if (store.getSetting("remindBackup")) setTimeout(() => { if (confirm("Sauvegarder tes données dans iCloud maintenant ?")) doExport(); }, 700);
}
function cancelLive() {
  clearInterval(sessionTimer); clearInterval(restTimer); rest.running = false;
  state.screen = "home"; state.live = null; render();
}

// ---------- export / import ----------
async function doExport() {
  const text = store.exportJSON();
  const fname = `muscu-sauvegarde.json`;
  const file = new File([text], fname, { type: "application/json" });
  store.setSetting("lastBackup", new Date().toISOString());
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: "Sauvegarde Muscu" });
      toast("Choisis « Enregistrer dans Fichiers » → iCloud Drive");
      return;
    }
  } catch (e) { /* annulé ou non supporté → fallback download */ }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a"); a.href = url; a.download = fname; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Sauvegarde exportée");
}
function doImport(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try { const r = store.importJSON(reader.result); toast(`Importé : ${r.sessions} séances, ${r.weights} pesées`); render(); }
    catch (e) { toast("Fichier invalide"); }
  };
  reader.readAsText(file);
}

// ---------- events ----------
document.addEventListener("click", e => {
  const tabBtn = e.target.closest("[data-tab]");
  if (tabBtn) { state.tab = tabBtn.dataset.tab; state.screen = "home"; render(); return; }
  const el = e.target.closest("[data-action]"); if (!el) return;
  const a = el.dataset.action;
  if (a === "stop") return;
  if (a === "close-modal") { document.querySelector(".modal")?.remove(); return; }
  if (a === "info") return showExercise(el.dataset.ex);
  if (a === "open-warmup") return openWarmup(+el.dataset.idx);
  if (a === "cancel-warmup" || a === "skip-warmup") {
    if (a === "skip-warmup") { state.warmup.endAt = Date.now(); state.warmup.remaining = 0; clearInterval(restTimer); return renderWarmup(); }
    state.screen = "home"; state.warmup = null; clearInterval(restTimer); return render();
  }
  if (a === "pickfirst") { state.warmup.firstEx = el.dataset.ex; return renderWarmup(); }
  if (a === "begin") return beginWorkout();
  if (a === "toggle") {
    const s = state.live.exercises[+el.dataset.ei].sets[+el.dataset.si];
    s.done = !s.done;
    if (s.done && !s.isWarmup) startRest(state.live.exercises[+el.dataset.ei].rest);
    else render();
    refreshLiveStats(); return;
  }
  if (a === "addset") {
    const ex = state.live.exercises[+el.dataset.ei];
    const work = ex.sets.filter(s => !s.isWarmup); const last = ex.sets[ex.sets.length - 1];
    ex.sets.push({ setIndex: work.length + 1, weight: last?.weight || 0, reps: last?.reps || ex.repHigh, isWarmup: false, done: false });
    return render();
  }
  if (a === "rest-add") { rest.endAt += 15000; rest.total += 15; return; }
  if (a === "rest-skip") { clearInterval(restTimer); rest.running = false; return render(); }
  if (a === "finish") return finishWorkout();
  if (a === "cancel-live") { if (confirm("Annuler la séance ? Les séries non enregistrées seront perdues.")) cancelLive(); return; }
  if (a === "addbw") { const v = parseFloat($("#bw").value); if (v > 0) { store.addBodyWeight(v); render(); } return; }
  if (a === "export") return doExport();
  if (a === "import") return $("#importfile").click();
});
document.addEventListener("input", e => {
  const f = e.target.closest("[data-f]");
  if (f && state.live) { state.live.exercises[+f.dataset.ei].sets[+f.dataset.si][f.dataset.f] = f.value; return; }
  if (e.target.id === "remind") store.setSetting("remindBackup", e.target.checked);
});
document.addEventListener("change", e => {
  if (e.target.id === "importfile" && e.target.files[0]) doImport(e.target.files[0]);
});

// ---------- boot ----------
render();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
