import { JOINTS } from "./data.js";
import * as store from "./store.js";
import { lineChart } from "./charts.js";

const $ = (s, r = document) => r.querySelector(s);
const app = $("#app");

let state = { tab: "home", screen: "home", routineId: null, warmup: null, live: null, editor: null, viewSessionId: null, chartEx: null, calOffset: 0 };
let sessionTimer = null, restTimer = null;
let rest = { running: false, remaining: 0, total: 0, endAt: 0 };
let wakeLock = null, audioCtx = null;

// ---------- utils ----------
const fmtClock = s => `${Math.floor(s / 60)}:${String(Math.max(0, s % 60)).padStart(2, "0")}`;
const exOf = id => store.getExercise(id);
const fmtNum = n => (Math.round(n * 100) / 100).toString();
const numW = v => parseFloat(String(v).replace(",", ".")) || 0; // tolère la virgule décimale (clavier FR)
const dateFR = (d, o) => new Date(d).toLocaleDateString("fr-FR", o || { weekday: "short", day: "numeric", month: "short" });
function startOfWeek() { const d = new Date(); const day = (d.getDay() + 6) % 7; d.setHours(0,0,0,0); d.setDate(d.getDate() - day); return d; }
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
const RPES = [6, 7, 8, 9, 10];

// ---------- render dispatcher ----------
function render() {
  if (state.screen === "warmup") return renderWarmup();
  if (state.screen === "live") return renderLive();
  if (state.screen === "editor") return renderEditor();
  if (state.screen === "editsession") return renderSessionEdit();
  app.innerHTML = ({ home: renderHome, programmes: renderProgrammes, exos: renderExos, progress: renderProgress, profil: renderProfil }[state.tab] || renderHome)();
  renderTabbar();
}
function renderTabbar() {
  const tabs = [["home","Entraînement","🏋️"],["programmes","Programmes","📋"],["exos","Exercices","📚"],["progress","Progression","📈"],["profil","Profil","👤"]];
  const bar = $("#tabbar");
  bar.innerHTML = tabs.map(([k,l,i]) => `<button class="tab ${state.tab===k?"active":""}" data-tab="${k}"><span>${i}</span>${l}</button>`).join("");
  bar.style.display = (state.screen === "home" ? "" : "none");
}

// ---------- HOME ----------
function weekStrip() {
  const ws = startOfWeek();
  const sessions = store.getSessions().filter(s => new Date(s.date) >= ws);
  const days = ["L","M","M","J","V","S","D"];
  return `<div class="weekstrip">${days.map((d, i) => {
    const day = new Date(ws); day.setDate(ws.getDate() + i);
    const isToday = day.toDateString() === new Date().toDateString();
    const dots = sessions.filter(s => new Date(s.date).toDateString() === day.toDateString());
    return `<div class="day ${isToday ? "today" : ""}"><span>${d}</span><b>${day.getDate()}</b>
      <div class="dots">${dots.map(s => `<i style="background:${s.color || (store.getRoutine(s.routineId)||{}).color || "#888"}"></i>`).join("")}</div></div>`;
  }).join("")}</div>`;
}
function renderHome() {
  const sessions = store.getSessions();
  const ws = startOfWeek().toISOString();
  const done = sessions.filter(s => s.date >= ws).length;
  const cards = store.getRoutines().map(r => `
    <div class="card routine" data-action="open-warmup" data-id="${r.id}">
      <span class="bar" style="background:${r.color}"></span>
      <div class="grow"><div class="title">${r.name}${r.custom ? ' <span class="tag">perso</span>' : ''}</div>
        <div class="sub">${r.exercises.length} exercices · ${r.summary || ""}</div></div>
      <button class="btn primary" data-action="open-warmup" data-id="${r.id}">Démarrer</button>
    </div>`).join("");
  const hist = sessions.slice(0, 6).map(s => `
    <div class="card sm" data-action="view-session" data-id="${s.id}"><div class="grow"><div class="title">${s.routineName}</div>
      <div class="sub">${dateFR(s.date)} · ${s.sets.filter(x=>!x.isWarmup).length} séries${s.sessionRPE?` · RPE ${s.sessionRPE}`:""}</div></div>
      <div class="sub">${Math.round(s.totalVolume||0)} kg ›</div></div>`).join("");
  return `<header class="head"><h1>Entraînement</h1></header>
    <div class="scroll">
      <div class="week"><div class="weeklabel">Cette semaine</div><div class="weekbig">${done}<span>/5 séances</span></div>${weekStrip()}</div>
      <h2>Mes séances</h2>${cards}
      ${sessions.length ? `<h2>Historique</h2>${hist}` : `<p class="muted">Aucune séance enregistrée. Lance ta première !</p>`}
      <div class="pad"></div></div>`;
}

// ---------- PROGRAMMES ----------
function renderProgrammes() {
  const body = store.getRoutines().map(r => `
    <div class="card col"><div class="rowline"><span class="bar" style="background:${r.color}"></span>
      <div class="title grow">${r.name}${r.custom ? ' <span class="tag">perso</span>' : ''}</div>
      ${r.custom ? `<button class="link" data-action="edit-routine" data-id="${r.id}">Modifier</button>` : ""}</div>
      ${r.exercises.map(e => { const x = exOf(e.ex); return `
        <div class="exline" data-action="info" data-ex="${e.ex}"><div class="grow"><b>${x.name}</b>
        <div class="sub">${e.sets} séries · ${e.repLow}-${e.repHigh} reps · repos ${e.rest}s${e.superset?` · super set ${e.superset}`:""}${e.ladder&&e.ladder.length?` · échelle ${e.ladder.join("/")}`:""}</div>
        ${e.notes?`<div class="note">📝 ${e.notes}</div>`:""}</div><span class="chev">ⓘ</span></div>`; }).join("")}
    </div>`).join("");
  return `<header class="head"><h1>Programmes</h1><button class="link strong" data-action="new-routine">+ Séance</button></header>
    <div class="scroll">${body}<div class="pad"></div></div>`;
}

// ---------- EXERCICES ----------
function renderExos() {
  const ex = store.allExercises();
  const groups = {};
  for (const [id, x] of Object.entries(ex)) (groups[x.group] = groups[x.group] || []).push([id, x]);
  const body = Object.entries(groups).map(([g, list]) => `
    <h2>${g}</h2><div class="card col">${list.map(([id, x]) => `
      <div class="exline" data-action="info" data-ex="${id}"><div class="grow"><b>${x.name}${x.custom?' <span class="tag">perso</span>':''}</b>
        <div class="sub">${x.equipment||""}</div></div><span class="chev">ⓘ</span></div>`).join("")}</div>`).join("");
  return `<header class="head"><h1>Exercices</h1><button class="link strong" data-action="new-exercise">+ Exo</button></header>
    <div class="scroll"><p class="sub">Touche un exercice pour la technique.</p>${body}<div class="pad"></div></div>`;
}
function showExercise(id) {
  const x = exOf(id); const pr = store.personalRecord(x.name);
  const m = document.createElement("div"); m.className = "modal"; m.dataset.action = "close-modal";
  m.innerHTML = `<div class="sheet" data-action="stop">
    <div class="rowline"><div class="grow"><div class="title">${x.name}</div><div class="sub">${x.group}${x.equipment?" · "+x.equipment:""}</div></div>
      <button class="link strong" data-action="close-modal">Fermer</button></div>
    ${pr ? `<div class="pr">🏆 Record : <b>${fmtNum(pr.weight)} kg × ${pr.reps}</b> · 1RM est. ${fmtNum(pr.oneRM)} kg</div>` : ""}
    ${x.instructions ? `<h3>Exécution</h3><p>${x.instructions}</p>` : ""}
    ${x.cues && x.cues.length ? `<h3>Points clés</h3><ul>${x.cues.map(c => `<li>${c}</li>`).join("")}</ul>` : ""}
    ${x.mistakes && x.mistakes.length ? `<h3>Erreurs fréquentes</h3><ul>${x.mistakes.map(c => `<li>⚠️ ${c}</li>`).join("")}</ul>` : ""}</div>`;
  document.body.appendChild(m);
}

// ---------- PROGRESSION ----------
function monthCalendar() {
  const base = new Date(); base.setDate(1); base.setMonth(base.getMonth() + (state.calOffset || 0));
  const year = base.getFullYear(), month = base.getMonth();
  const monthName = base.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const startDow = (new Date(year, month, 1).getDay() + 6) % 7;      // lundi = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const byDay = {};
  store.getSessions().forEach(s => { const d = new Date(s.date); if (d.getFullYear() === year && d.getMonth() === month) (byDay[d.getDate()] = byDay[d.getDate()] || []).push(s); });
  const todayStr = new Date().toDateString();
  const dows = ["L", "M", "M", "J", "V", "S", "D"];
  let cells = "";
  for (let i = 0; i < startDow; i++) cells += `<div class="cal-cell empty"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const isToday = new Date(year, month, d).toDateString() === todayStr;
    const list = byDay[d] || [];
    const dots = list.map(s => `<i data-action="view-session" data-id="${s.id}" style="background:${s.color || (store.getRoutine(s.routineId) || {}).color || "#888"}"></i>`).join(""); // chaque pastille ouvre sa séance
    const act = list.length ? `data-action="view-session" data-id="${list[0].id}"` : "";
    cells += `<div class="cal-cell ${isToday ? "today" : ""} ${list.length ? "has" : ""}" ${act}><b>${d}</b><div class="cal-dots">${dots}</div></div>`;
  }
  return `<div class="card col"><div class="rowline"><button class="info" data-action="cal-prev">‹</button>
      <div class="title grow" style="text-align:center;text-transform:capitalize">${monthName}</div>
      <button class="info" data-action="cal-next" ${(state.calOffset || 0) >= 0 ? "disabled" : ""}>›</button></div>
    <div class="cal-grid">${dows.map(d => `<div class="cal-dow">${d}</div>`).join("")}${cells}</div></div>`;
}
function renderProgress() {
  const sessions = store.getSessions();
  const weights = store.getBodyWeights();
  const exos = store.exercisesWithHistory();
  if (state.chartEx == null || !exos.includes(state.chartEx)) state.chartEx = exos[0] || null;
  let chartBlock = `<p class="muted">Fais quelques séances pour voir tes courbes 📈</p>`;
  if (state.chartEx) {
    const pts = store.progressPoints(state.chartEx);
    const pr = store.personalRecord(state.chartEx);
    chartBlock = `
      <div class="card col"><div class="rowline"><b class="grow">Exercice</b>
        <select id="chartex" class="field auto">${exos.map(e => `<option ${e===state.chartEx?"selected":""}>${e}</option>`).join("")}</select></div>
        ${pr ? `<div class="pr">🏆 ${fmtNum(pr.weight)} kg × ${pr.reps} · 1RM ${fmtNum(pr.oneRM)} kg</div>` : ""}
        <div class="chartlabel">Charge max (kg)</div>${lineChart(pts.map(p => ({ date: p.date, value: p.topWeight })), { color: "#E23B3B" })}
        <div class="chartlabel">1RM estimé (kg)</div>${lineChart(pts.map(p => ({ date: p.date, value: p.oneRM })), { color: "#FF7A00" })}
        <div class="chartlabel">Volume (kg)</div>${lineChart(pts.map(p => ({ date: p.date, value: p.volume })), { color: "#2E7BE6" })}
      </div>`;
  }
  const bwBlock = `<div class="card col"><div class="title">Poids du corps</div>
      <div class="rowline"><input id="bw" class="field" type="text" inputmode="decimal" placeholder="kg"/>
      <button class="btn primary" data-action="addbw">Ajouter</button></div>
      ${weights.length >= 2 ? `<div class="chartlabel">Évolution</div>${lineChart(store.bodyWeightPoints(), { color: "#14B8A6", fmt: v => v.toFixed(1) })}` : ""}
      ${weights.slice(0,6).map(w => `<div class="exline"><div class="grow">${dateFR(w.date)}</div><b>${w.weightKg} kg</b></div>`).join("")}</div>`;
  const list = sessions.slice(0, 20).map(s => `
    <div class="card sm" data-action="view-session" data-id="${s.id}"><div class="grow"><div class="title">${s.routineName}</div>
      <div class="sub">${dateFR(s.date, {weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}</div></div>
      <div class="sub">${s.sets.filter(x=>!x.isWarmup).length} séries · ${Math.round(s.totalVolume||0)} kg ›</div></div>`).join("") || `<p class="muted">Pas encore de séance.</p>`;
  return `<header class="head"><h1>Progression</h1></header><div class="scroll">
    <h2>Calendrier</h2>${monthCalendar()}
    <h2>Courbes</h2>${chartBlock}${bwBlock}<h2>Séances réalisées</h2>${list}<div class="pad"></div></div>`;
}

// ---------- PROFIL ----------
function renderProfil() {
  const last = store.getSetting("lastBackup");
  return `<header class="head"><h1>Profil</h1></header><div class="scroll">
    <div class="card col"><div class="title">Sauvegarde (iCloud)</div>
      <p class="sub">Données en local. Exporte un JSON et range-le dans <b>Fichiers → iCloud Drive</b>.</p>
      <div class="rowline"><button class="btn primary" data-action="export">Exporter</button><button class="btn" data-action="import">Importer</button></div>
      <label class="rowline"><input type="checkbox" id="remind" ${store.getSetting("remindBackup")?"checked":""}/> Rappel de sauvegarde après chaque séance</label>
      <div class="sub">Dernière sauvegarde : ${last?new Date(last).toLocaleString("fr-FR"):"jamais"}</div></div>
    <input id="importfile" type="file" accept=".json,.txt,application/json,text/plain" hidden/>
    <div class="card col"><div class="title">Réglages</div>
      <label class="rowline"><span class="grow">Repos par défaut (nouveaux exos)</span>
        <select id="defrest" class="field auto">${[45,60,75,90,120,150].map(v=>`<option ${store.getSetting("defaultRest")===v?"selected":""}>${v}</option>`).join("")}</select> s</label>
      <label class="rowline"><input type="checkbox" id="notify" ${store.getSetting("notify")?"checked":""}/> Notification à la fin du repos</label>
      <label class="rowline"><input type="checkbox" id="vibrate" ${store.getSetting("vibrate")!==false?"checked":""}/> Vibration à la fin du repos</label>
      <p class="sub">Un <b>bip</b> sonne toujours à la fin du repos — c'est le signal fiable sur iPhone. La <b>vibration</b>, elle, dépend de l'appareil : Android la gère ; sur iOS, Safari ne l'expose pas vraiment et iOS&nbsp;26.5+ l'a encore restreinte → fie-toi alors au bip. L'app garde l'écran allumé ; iOS ne peut pas alerter en arrière-plan total, reste sur Muscu (ou écran verrouillé).</p></div>
    <div class="card col"><div class="title">À propos</div><p class="sub">Muscu — PWA. Ajoute-la à l'écran d'accueil. 💪</p></div>
    <div class="pad"></div></div>`;
}

// ---------- WARM-UP ----------
function openWarmup(id) {
  const r = store.getRoutine(id); if (!r || !r.exercises.length) return;
  state.routineId = id; state.screen = "warmup";
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
  const r = store.getRoutine(state.routineId), w = state.warmup;
  app.innerHTML = `<header class="head"><button class="link" data-action="cancel-warmup">Annuler</button><h1>Échauffement</h1><span></span></header>
    <div class="scroll center">
      <div class="chrono"><div class="time" id="chronotime">${fmtClock(w.remaining)}</div><div class="sub">Mobilité</div></div>
      <p class="sub" style="text-align:center">Mobilise tes articulations : <b>${jointsFor(r)}</b>.</p>
      <h2>Par quel exercice commencer ?</h2>
      <p class="sub">Une série d'échauffement « à blanc » sera ajoutée à cet exercice (en plus de ses séries).</p>
      ${r.exercises.map(e => { const x = exOf(e.ex); const sel = w.firstEx === e.ex;
        return `<div class="card pick ${sel?"sel":""}" data-action="pickfirst" data-ex="${e.ex}"><span class="radio">${sel?"●":"○"}</span><div class="grow">${x.name}</div></div>`; }).join("")}
      <div class="pad"></div></div>
    <div class="bottombar"><button class="btn primary big" id="beginbtn" data-action="begin" ${w.remaining>0?"disabled":""}>
      ${w.remaining>0?`Échauffement en cours… ${w.remaining}s`:"Commencer la séance"}</button>
      ${w.remaining>0?`<button class="link" data-action="skip-warmup">Passer l'échauffement</button>`:""}</div>`;
  renderTabbar();
}
function updateWarmupTimer() {
  const w = state.warmup; if (!w) return;
  const t = $("#chronotime"); if (t) t.textContent = fmtClock(w.remaining);
  const btn = $("#beginbtn");
  if (btn) { if (w.remaining > 0) { btn.disabled = true; btn.textContent = `Échauffement en cours… ${w.remaining}s`; } else if (btn.disabled) renderWarmup(); }
}

// ---------- LIVE WORKOUT ----------
function buildLiveExercise(e, pos) {
  const x = exOf(e.ex);
  const sug = store.suggestWeight(x.name, e.repHigh, e.ladder);
  const last = store.lastSetsFor(x.name);
  const sets = [];
  if (pos === 0) {
    const base = last[0]?.weight ?? sug ?? (e.ladder?.[0] || 0);
    sets.push({ setIndex: 0, weight: Math.round(base * 0.5), reps: e.repHigh, rpe: null, isWarmup: true, done: false });
  }
  for (let i = 0; i < (e.sets || 4); i++) {
    const prev = last[i] || last[last.length - 1];
    sets.push({ setIndex: i + 1, weight: prev?.weight ?? sug ?? (e.ladder?.[0] || 0), reps: prev?.reps ?? e.repHigh, rpe: null, isWarmup: false, done: false });
  }
  return { ex: e.ex, name: x.name, rest: e.rest || 90, repLow: e.repLow || 8, repHigh: e.repHigh || 12, superset: e.superset || null, notes: e.notes || "",
    lastSummary: last.length ? "Dernière fois : " + last.map(s => `${fmtNum(s.weight)}×${s.reps}${s.rpe?`@${s.rpe}`:""}`).join("  ") : "", sets };
}
function beginWorkout() {
  const r = store.getRoutine(state.routineId);
  const order = [...r.exercises];
  const fi = order.findIndex(e => e.ex === state.warmup.firstEx);
  if (fi > 0) order.unshift(order.splice(fi, 1)[0]);
  state.live = { routineId: r.id, routineName: r.name, color: r.color, startAt: Date.now(), exercises: order.map(buildLiveExercise) };
  state.screen = "live";
  clearInterval(restTimer); requestWakeLock(); render();
  clearInterval(sessionTimer);
  sessionTimer = setInterval(() => { const e = $("#elapsed"); if (e) e.textContent = fmtClock(Math.floor((Date.now() - state.live.startAt) / 1000)); }, 1000);
}
function liveStats() {
  const all = state.live.exercises.flatMap(e => e.sets).filter(s => !s.isWarmup);
  const done = all.filter(s => s.done);
  return { done: done.length, total: all.length, vol: Math.round(done.reduce((a, s) => a + numW(s.weight) * (+s.reps || 0), 0)) };
}
function isSupersetTop(list, i) {
  const g = list[i].superset; if (!g) return false;
  return i === 0 || list[i - 1].superset !== g;
}
function renderLive() {
  const L = state.live, st = liveStats();
  const scOld = app.querySelector(".scroll");
  const prevScroll = scOld ? scOld.scrollTop : 0;                       // ne pas remonter en haut quand on valide une série
  const prevBannerH = app.querySelector(".restbanner")?.offsetHeight || 0;
  app.innerHTML = `<header class="head live" style="border-color:${L.color}">
      <button class="link danger" data-action="cancel-live">Annuler</button><h1>${L.routineName}</h1><button class="link strong" data-action="finish">Terminer</button></header>
    ${rest.running ? renderRestBanner() : ""}
    <div class="scroll">
      <div class="stats"><div><b id="elapsed">0:00</b><span>Durée</span></div><div><b id="setcount">${st.done}/${st.total}</b><span>Séries</span></div><div><b id="vol">${st.vol}</b><span>Volume kg</span></div></div>
      ${L.exercises.map((e, ei) => `
        ${isSupersetTop(L.exercises, ei) ? `<div class="sslabel">🔗 Super set ${e.superset}</div>` : ""}
        <div class="card col exercise ${e.superset?"ss":""}">
          <div class="rowline"><div class="grow"><div class="title">${e.name}</div><span class="badge">${exOf(e.ex).group}</span></div>
            <button class="info" data-action="info" data-ex="${e.ex}">ⓘ</button>
            <button class="info" data-action="del-ex" data-ei="${ei}">✕</button></div>
          ${e.lastSummary ? `<div class="note">${e.lastSummary}</div>` : ""}${e.notes ? `<div class="note">📝 ${e.notes}</div>` : ""}
          <div class="setgrid head"><span>Série</span><span>kg</span><span>Reps</span><span>RPE</span><span>✓</span></div>
          ${e.sets.map((s, si) => `<div class="setgrid ${s.done?"done":""}">
            <span class="${s.isWarmup?"warm":s.drop?"drop":""}">${s.isWarmup?"Éch":s.drop?"↘":s.setIndex}</span>
            <input class="field" type="text" inputmode="decimal" value="${s.weight}" data-f="weight" data-ei="${ei}" data-si="${si}"/>
            <input class="field" type="number" inputmode="numeric" value="${s.reps}" data-f="reps" data-ei="${ei}" data-si="${si}"/>
            <select class="field rpe" data-f="rpe" data-ei="${ei}" data-si="${si}"><option value="">–</option>${RPES.map(v=>`<option ${s.rpe==v?"selected":""}>${v}</option>`).join("")}</select>
            <button class="check ${s.done?"on":""}" data-action="toggle" data-ei="${ei}" data-si="${si}">${s.done?"✓":"○"}</button></div>`).join("")}
          <div class="rowline" style="gap:8px;margin-top:6px">
            <button class="btn ghost" style="margin-top:0;flex:1" data-action="addset" data-ei="${ei}">+ série</button>
            <button class="btn ghost" style="margin-top:0;flex:1" data-action="dropset" data-ei="${ei}">↘ dégressif</button></div></div>`).join("")}
      <button class="btn" data-action="add-ex" style="width:100%">+ Ajouter un exercice</button>
      <button class="btn primary big" data-action="finish">Terminer la séance</button><div class="pad"></div></div>`;
  const sc = app.querySelector(".scroll");
  if (sc) { const dH = (app.querySelector(".restbanner")?.offsetHeight || 0) - prevBannerH; sc.scrollTop = Math.max(0, prevScroll + dH); } // compense l'apparition/disparition du bandeau de repos (hors .scroll)
  renderTabbar();
}
function renderRestBanner() {
  return `<div class="restbanner"><div class="rowline"><span>⏱️ Repos</span><b id="resttime">${fmtClock(rest.remaining)}</b></div>
    <div class="progress"><div id="restfill" style="width:${rest.total?(1-rest.remaining/rest.total)*100:0}%"></div></div>
    <div class="rowline"><button class="btn sm" data-action="rest-add">+15s</button><button class="btn sm" data-action="rest-sub">−15s</button><button class="btn sm" data-action="rest-skip">Passer</button></div></div>`;
}
function startRest(seconds) {
  clearInterval(restTimer); primeAudio();
  rest = { running: true, remaining: seconds, total: seconds, endAt: Date.now() + seconds * 1000 }; render();
  restTimer = setInterval(() => {
    rest.remaining = Math.max(0, Math.ceil((rest.endAt - Date.now()) / 1000));
    const rt = $("#resttime"), rf = $("#restfill");
    if (rt) rt.textContent = fmtClock(rest.remaining);
    if (rf) rf.style.width = `${rest.total ? (1 - rest.remaining / rest.total) * 100 : 0}%`;
    if (rest.remaining <= 0) { clearInterval(restTimer); rest.running = false; alertRestDone(); render(); }
  }, 250);
}
// Alerte de fin de repos : vibration (selon plateforme) + bip + notification (selon réglages).
function alertRestDone() {
  if (store.getSetting("vibrate") !== false) haptic([500, 200, 500, 200, 700]);
  primeAudio(); playBeep();
  notifyRest();
}
// Vibration multi-plateforme.
//  • Android : Vibration API (navigator.vibrate, motifs supportés).
//  • iOS : navigator.vibrate N'EXISTE PAS dans Safari/WebKit. Seul contournement = le "truc du
//    switch" (input type=checkbox switch + label.click) qui déclenche un haptic natif.
//    ⚠️ Marche uniquement iOS 17.4 → 26.4 : Apple a supprimé ce déclenchement programmatique en
//    iOS 26.5. Sur iOS récent le BIP reste le signal fiable (cf. texte des réglages). C'est sans
//    risque : si rien ne se déclenche, on ne fait que créer/cliquer un input invisible.
let _hapticSwitch = null;
function iosHapticTap() {
  try {
    if (!_hapticSwitch) {
      const label = document.createElement("label");
      label.setAttribute("aria-hidden", "true");
      label.style.cssText = "position:absolute;left:-9999px;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none";
      const cb = document.createElement("input");
      cb.type = "checkbox"; cb.setAttribute("switch", ""); cb.tabIndex = -1;
      label.appendChild(cb); document.body.appendChild(label); _hapticSwitch = label;
    }
    _hapticSwitch.click(); // toggle le switch → haptic iOS 17.4–26.4
  } catch (e) {}
}
function haptic(pattern) {
  try { if (navigator.vibrate) { navigator.vibrate(pattern); return; } } catch (e) {}
  // Fallback iOS : quelques tapes rapprochées pour rendre l'alerte perceptible.
  const n = Array.isArray(pattern) ? Math.min(3, Math.ceil(pattern.length / 2)) : 1;
  for (let i = 0; i < n; i++) setTimeout(iosHapticTap, i * 140);
}
function notifyRest() {
  if (!store.getSetting("notify") || !("Notification" in window) || Notification.permission !== "granted") return;
  const opts = { body: "Reprends ta série 💪", tag: "muscu-rest", renotify: true, vibrate: [400, 150, 400], icon: "./icons/icon-192.png", badge: "./icons/icon-192.png" };
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.ready)
      navigator.serviceWorker.ready.then(reg => reg.showNotification("Repos terminé 💪", opts)).catch(() => { try { new Notification("Repos terminé 💪", opts); } catch (e) {} });
    else new Notification("Repos terminé 💪", opts);
  } catch (e) {}
}
// WebAudio : bip court (amorcé au clic qui lance le repos → autorisé par iOS).
function primeAudio() { try { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === "suspended") audioCtx.resume(); } catch (e) {} }
function playBeep() {
  try {
    if (!audioCtx) return;
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination); o.type = "sine"; o.frequency.value = 880; g.gain.value = 0.12;
    o.start(); setTimeout(() => { o.frequency.value = 660; }, 160); setTimeout(() => { o.stop(); }, 340);
  } catch (e) {}
}
// Verrou d'écran : garde l'écran allumé pendant la séance (timer fiable au premier plan).
async function requestWakeLock() {
  try {
    if (!("wakeLock" in navigator)) return;
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => { wakeLock = null; if (state.screen === "live" && document.visibilityState === "visible") requestWakeLock(); });
  } catch (e) {}
}
function releaseWakeLock() { try { if (wakeLock) { wakeLock.release(); wakeLock = null; } } catch (e) {} }
function refreshLiveStats() { const st = liveStats(); const a = $("#setcount"), b = $("#vol"); if (a) a.textContent = `${st.done}/${st.total}`; if (b) b.textContent = st.vol; }
function finishWorkout() {
  const L = state.live;
  const done = L.exercises.flatMap(e => e.sets).filter(s => s.done);
  if (!done.length) { if (confirm("Aucune série validée. Quitter sans enregistrer ?")) cancelLive(); return; }
  showFinishModal();
}
function showFinishModal() {
  const m = document.createElement("div"); m.className = "modal"; m.dataset.action = "close-modal";
  m.innerHTML = `<div class="sheet" data-action="stop"><div class="title">Séance terminée 💪</div>
    <p class="sub">Ressenti global de la séance ?</p>
    <div class="rpebar">${[1,2,3,4,5,6,7,8,9,10].map(v=>`<button class="rpebtn" data-action="save-session" data-rpe="${v}">${v}</button>`).join("")}</div>
    <button class="btn big" data-action="save-session" data-rpe="">Enregistrer sans ressenti</button></div>`;
  document.body.appendChild(m);
}
function saveSession(sessionRPE) {
  const L = state.live; const sets = []; let order = 0;
  L.exercises.forEach(e => e.sets.filter(s => s.done).forEach(s =>
    sets.push({ exerciseName: e.name, order: order++, setIndex: s.setIndex, weight: numW(s.weight), reps: +s.reps || 0, rpe: s.rpe ? +s.rpe : null, isWarmup: s.isWarmup, drop: !!s.drop })));
  const totalVolume = sets.filter(s => !s.isWarmup).reduce((a, s) => a + s.weight * s.reps, 0);
  store.addSession({ id: store.uid(), date: new Date(L.startAt).toISOString(), endDate: new Date().toISOString(),
    routineId: L.routineId, routineName: L.routineName, color: L.color, sessionRPE: sessionRPE || null, totalVolume, sets });
  document.querySelector(".modal")?.remove();
  clearInterval(sessionTimer); clearInterval(restTimer); rest.running = false; releaseWakeLock();
  state.screen = "home"; state.tab = "home"; state.live = null; render();
  toast("Séance enregistrée 💪");
  if (store.getSetting("remindBackup")) setTimeout(() => { if (confirm("Sauvegarder tes données dans iCloud maintenant ?")) doExport(); }, 700);
}
function cancelLive() { clearInterval(sessionTimer); clearInterval(restTimer); rest.running = false; releaseWakeLock(); state.screen = "home"; state.live = null; render(); }

// ---------- SESSION DETAIL ----------
function showSession(id) {
  const s = store.getSession(id); if (!s) return;
  const byEx = {};
  s.sets.forEach(x => (byEx[x.exerciseName] = byEx[x.exerciseName] || []).push(x));
  const m = document.createElement("div"); m.className = "modal"; m.dataset.action = "close-modal";
  m.innerHTML = `<div class="sheet" data-action="stop">
    <div class="rowline"><div class="grow"><div class="title">${s.routineName}</div>
      <div class="sub">${dateFR(s.date,{weekday:"long",day:"numeric",month:"long",hour:"2-digit",minute:"2-digit"})}${s.sessionRPE?` · RPE ${s.sessionRPE}/10`:""}</div></div>
      <button class="link" data-action="edit-session" data-id="${s.id}">Modifier</button>
      <button class="link strong" data-action="close-modal">Fermer</button></div>
    <div class="sub">${s.sets.filter(x=>!x.isWarmup).length} séries · ${Math.round(s.totalVolume||0)} kg de volume</div>
    ${Object.entries(byEx).map(([n, sets]) => `<h3>${n}</h3>${sets.map(x => `<div class="exline"><span class="${x.isWarmup?"warm":x.drop?"drop":""}" style="width:42px">${x.isWarmup?"Éch":x.drop?"↘":x.setIndex}</span><div class="grow">${fmtNum(x.weight)} kg × ${x.reps}${x.rpe?` · RPE ${x.rpe}`:""}</div></div>`).join("")}`).join("")}
    <button class="btn big" data-action="del-session" data-id="${s.id}" style="background:#3a1d1d;color:#ff6a6a">Supprimer cette séance</button></div>`;
  document.body.appendChild(m);
}

// ---------- ÉDITION D'UNE SÉANCE PASSÉE ----------
function openSessionEdit(id) {
  const s = store.getSession(id); if (!s) return;
  document.querySelector(".modal")?.remove();
  const order = [], map = {};
  s.sets.forEach(x => { if (!map[x.exerciseName]) { map[x.exerciseName] = []; order.push(x.exerciseName); } map[x.exerciseName].push({ weight: x.weight, reps: x.reps, rpe: x.rpe, isWarmup: !!x.isWarmup, drop: !!x.drop }); });
  state.sessionEdit = { id, date: s.date, routineName: s.routineName, sessionRPE: s.sessionRPE || null, groups: order.map(n => ({ name: n, sets: map[n] })) };
  state.screen = "editsession"; render();
}
function renderSessionEdit() {
  const se = state.sessionEdit;
  app.innerHTML = `<header class="head"><button class="link" data-action="cancel-sedit">Annuler</button>
    <h1>Modifier la séance</h1><button class="link strong" data-action="save-sedit">OK</button></header>
    <div class="scroll">
      <p class="sub">${se.routineName} · ${dateFR(se.date,{weekday:"long",day:"numeric",month:"long"})}</p>
      ${se.groups.map((g, gi) => `<div class="card col"><div class="title">${g.name}</div>
        ${g.sets.map((s, si) => `<div class="seteditrow">
          <span class="lbl ${s.isWarmup?"warm":s.drop?"drop":""}" data-action="se-warm" data-gi="${gi}" data-si="${si}">${s.isWarmup?"Éch":s.drop?"↘":si+1}</span>
          <input class="field" type="text" inputmode="decimal" value="${s.weight}" data-sef="weight" data-gi="${gi}" data-si="${si}" placeholder="kg"/>
          <input class="field" type="number" inputmode="numeric" value="${s.reps}" data-sef="reps" data-gi="${gi}" data-si="${si}" placeholder="reps"/>
          <select class="field rpe" data-sef="rpe" data-gi="${gi}" data-si="${si}"><option value="">–</option>${RPES.map(v=>`<option ${s.rpe==v?"selected":""}>${v}</option>`).join("")}</select>
          <span class="acts"><button class="info" data-action="se-up" data-gi="${gi}" data-si="${si}">↑</button>
            <button class="info" data-action="se-down" data-gi="${gi}" data-si="${si}">↓</button>
            <button class="info" data-action="se-del" data-gi="${gi}" data-si="${si}">✕</button></span></div>`).join("")}
        <button class="btn ghost" data-action="se-addset" data-gi="${gi}">+ série</button></div>`).join("")}
      <div class="card col"><label class="rowline"><span class="grow">Ressenti global (RPE)</span>
        <select id="se-rpe" class="field auto"><option value="">–</option>${[1,2,3,4,5,6,7,8,9,10].map(v=>`<option ${se.sessionRPE==v?"selected":""}>${v}</option>`).join("")}</select></label></div>
      <p class="sub">Astuce : touche « Éch / numéro » pour basculer une série en échauffement.</p>
      <div class="pad"></div></div>`;
  renderTabbar();
}
function saveSessionEdit() {
  const se = state.sessionEdit;
  const sets = []; let order = 0;
  se.groups.filter(g => g.sets.length).forEach(g => {
    let work = 0;
    g.sets.forEach(s => sets.push({ exerciseName: g.name, order: order++, setIndex: s.isWarmup ? 0 : (++work),
      weight: numW(s.weight), reps: +s.reps || 0, rpe: s.rpe ? +s.rpe : null, isWarmup: !!s.isWarmup, drop: !!s.drop }));
  });
  store.updateSession(se.id, { sessionRPE: se.sessionRPE || null, sets });
  state.screen = "home"; state.tab = "progress"; state.sessionEdit = null; render(); toast("Séance modifiée");
}

// ---------- ÉDITEUR DE SÉANCE PERSO ----------
function openEditor(id) {
  if (id) { const r = store.getRoutine(id); state.editor = { id, name: r.name, color: r.color, summary: r.summary || "", exercises: r.exercises.map(e => ({ ...e })) }; }
  else state.editor = { id: null, name: "", color: "#8E44E6", summary: "", exercises: [] };
  state.screen = "editor"; render();
}
const COLORS = ["#FF7A00","#E23B3B","#14B8A6","#2E7BE6","#8E44E6","#27c06a","#E6007A","#E6A700"];
function renderEditor() {
  const ed = state.editor;
  app.innerHTML = `<header class="head"><button class="link" data-action="cancel-editor">Annuler</button>
    <h1>${ed.id?"Modifier":"Nouvelle"} séance</h1><button class="link strong" data-action="save-routine">OK</button></header>
    <div class="scroll">
      <div class="card col"><label class="sub">Nom</label><input id="ed-name" class="field" style="text-align:left" value="${ed.name.replace(/"/g,'&quot;')}" placeholder="Ex. Full body"/>
        <label class="sub" style="margin-top:8px">Résumé</label><input id="ed-sum" class="field" style="text-align:left" value="${ed.summary.replace(/"/g,'&quot;')}" placeholder="Optionnel"/>
        <label class="sub" style="margin-top:8px">Couleur</label><div class="rowline">${COLORS.map(c=>`<span class="swatch ${ed.color===c?"sel":""}" data-action="ed-color" data-c="${c}" style="background:${c}"></span>`).join("")}</div></div>
      <h2>Exercices (${ed.exercises.length})</h2>
      ${ed.exercises.map((e, i) => { const x = exOf(e.ex); return `<div class="card col">
        <div class="rowline"><b class="grow">${x.name}</b>
          <button class="info" data-action="ed-up" data-i="${i}">↑</button><button class="info" data-action="ed-down" data-i="${i}">↓</button>
          <button class="info" data-action="ed-del" data-i="${i}">✕</button></div>
        <div class="setgrid3"><label class="sub">Séries<input class="field" type="number" inputmode="numeric" value="${e.sets}" data-ef="sets" data-i="${i}"/></label>
          <label class="sub">Reps bas<input class="field" type="number" inputmode="numeric" value="${e.repLow}" data-ef="repLow" data-i="${i}"/></label>
          <label class="sub">Reps haut<input class="field" type="number" inputmode="numeric" value="${e.repHigh}" data-ef="repHigh" data-i="${i}"/></label>
          <label class="sub">Repos s<input class="field" type="number" inputmode="numeric" value="${e.rest}" data-ef="rest" data-i="${i}"/></label></div></div>`; }).join("")}
      <button class="btn" data-action="ed-addex" style="width:100%">+ Ajouter un exercice</button>
      ${ed.id?`<button class="btn big" data-action="del-routine" data-id="${ed.id}" style="background:#3a1d1d;color:#ff6a6a">Supprimer la séance</button>`:""}
      <div class="pad"></div></div>`;
  renderTabbar();
}

// ---------- SÉLECTEUR D'EXERCICE ----------
function showPicker(onPick) {
  pickerCb = onPick;
  const ex = store.allExercises();
  const groups = {};
  for (const [id, x] of Object.entries(ex)) (groups[x.group] = groups[x.group] || []).push([id, x]);
  const m = document.createElement("div"); m.className = "modal"; m.id = "picker"; m.dataset.action = "close-modal";
  m.innerHTML = `<div class="sheet" data-action="stop">
    <div class="rowline"><div class="title grow">Choisir un exercice</div><button class="link strong" data-action="close-modal">Fermer</button></div>
    <input id="pickerq" class="field" style="text-align:left;margin:8px 0" placeholder="Rechercher…"/>
    <div id="pickerlist">${Object.entries(groups).map(([g, list]) => `<h3>${g}</h3>${list.map(([id, x]) => `<div class="exline pickrow" data-action="pick" data-ex="${id}" data-name="${x.name.toLowerCase()}"><div class="grow">${x.name}</div><span class="chev">+</span></div>`).join("")}`).join("")}</div></div>`;
  document.body.appendChild(m);
}
let pickerCb = null;

// ---------- export / import ----------
// iOS PWA : NE PAS utiliser navigator.share (WebKit renomme le .json en "text.txt").
// On force le nom via un <a download> : data: URL sur iOS (extension respectée + "Enregistrer
// dans Fichiers"), blob: sur desktop/Android (pas de limite de taille). cf. w3c/web-share#201.
function doExport() {
  const text = store.exportJSON();
  const filename = `muscu-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
  const ua = navigator.userAgent || "";
  const iOSLike = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const a = document.createElement("a");
  a.download = filename; a.rel = "noopener"; a.style.display = "none";
  let objUrl = null;
  if (iOSLike) {
    a.href = "data:application/json;charset=utf-8," + encodeURIComponent(text);
  } else {
    const blob = new Blob([text], { type: "application/json" });
    a.href = objUrl = URL.createObjectURL(blob);
  }
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  if (objUrl) setTimeout(() => URL.revokeObjectURL(objUrl), 1500);
  store.setSetting("lastBackup", new Date().toISOString());
  toast(iOSLike ? "Aperçu ouvert → « Enregistrer dans Fichiers » → iCloud Drive" : `Sauvegarde exportée (${filename})`);
}
function doImport(file) { const r = new FileReader(); r.onload = () => { try { const res = store.importJSON(r.result); toast(`Importé : ${res.sessions} séances, ${res.weights} pesées`); render(); } catch (e) { toast("Fichier invalide"); } }; r.readAsText(file); }

// ---------- events: click ----------
document.addEventListener("click", e => {
  const tabBtn = e.target.closest("[data-tab]");
  if (tabBtn) { state.tab = tabBtn.dataset.tab; state.screen = "home"; render(); return; }
  const el = e.target.closest("[data-action]"); if (!el) return;
  const a = el.dataset.action, ei = +el.dataset.ei, si = +el.dataset.si, i = +el.dataset.i;
  if (a === "stop") return;
  if (a === "close-modal") { document.querySelector(".modal")?.remove(); return; }
  if (a === "info") return showExercise(el.dataset.ex);
  if (a === "open-warmup") return openWarmup(el.dataset.id);
  if (a === "view-session") return showSession(el.dataset.id);
  if (a === "del-session") { if (confirm("Supprimer cette séance ?")) { store.deleteSession(el.dataset.id); document.querySelector(".modal")?.remove(); render(); } return; }
  // édition d'une séance passée
  if (a === "edit-session") return openSessionEdit(el.dataset.id);
  if (a === "cancel-sedit") { state.screen = "home"; state.tab = "progress"; state.sessionEdit = null; return render(); }
  if (a === "save-sedit") return saveSessionEdit();
  if (a === "se-del") { const g = state.sessionEdit.groups[+el.dataset.gi]; g.sets.splice(+el.dataset.si, 1); if (!g.sets.length) state.sessionEdit.groups.splice(+el.dataset.gi, 1); return renderSessionEdit(); }
  if (a === "se-up") { const g = state.sessionEdit.groups[+el.dataset.gi].sets, k = +el.dataset.si; if (k > 0) [g[k-1], g[k]] = [g[k], g[k-1]]; return renderSessionEdit(); }
  if (a === "se-down") { const g = state.sessionEdit.groups[+el.dataset.gi].sets, k = +el.dataset.si; if (k < g.length - 1) [g[k+1], g[k]] = [g[k], g[k+1]]; return renderSessionEdit(); }
  if (a === "se-addset") { const g = state.sessionEdit.groups[+el.dataset.gi].sets, last = g[g.length-1]; g.push({ weight: last?.weight || 0, reps: last?.reps || 10, rpe: null, isWarmup: false }); return renderSessionEdit(); }
  if (a === "se-warm") { const s = state.sessionEdit.groups[+el.dataset.gi].sets[+el.dataset.si]; s.isWarmup = !s.isWarmup; return renderSessionEdit(); }
  // warm-up
  if (a === "cancel-warmup") { state.screen = "home"; state.warmup = null; clearInterval(restTimer); return render(); }
  if (a === "skip-warmup") { state.warmup.endAt = Date.now(); state.warmup.remaining = 0; clearInterval(restTimer); return renderWarmup(); }
  if (a === "pickfirst") { state.warmup.firstEx = el.dataset.ex; return renderWarmup(); }
  if (a === "begin") return beginWorkout();
  // live
  if (a === "toggle") { const ex = state.live.exercises[ei], s = ex.sets[si]; s.done = !s.done; const next = ex.sets[si + 1]; const skipRest = next && next.drop && !next.done; if (s.done && !s.isWarmup && !skipRest) startRest(ex.rest); else render(); refreshLiveStats(); return; }
  if (a === "addset") { const ex = state.live.exercises[ei]; const work = ex.sets.filter(s => !s.isWarmup && !s.drop); const last = ex.sets[ex.sets.length - 1]; ex.sets.push({ setIndex: work.length + 1, weight: last?.weight || 0, reps: last?.reps || ex.repHigh, rpe: null, isWarmup: false, done: false }); return render(); }
  if (a === "dropset") { const ex = state.live.exercises[ei]; const lastWork = [...ex.sets].reverse().find(s => !s.isWarmup); const base = numW(lastWork ? lastWork.weight : 0); const idx = ex.sets.filter(s => !s.isWarmup && !s.drop).length + 1; ex.sets.push({ setIndex: idx, weight: Math.round(base * 0.8 * 2) / 2, reps: ex.repHigh, rpe: null, isWarmup: false, drop: true, done: false }); clearInterval(restTimer); rest.running = false; return render(); }
  if (a === "del-ex") { if (state.live.exercises.length > 1) state.live.exercises.splice(ei, 1); return render(); }
  if (a === "add-ex") return showPicker(id => { const x = exOf(id); state.live.exercises.push({ ex: id, name: x.name, rest: store.getSetting("defaultRest"), repLow: 8, repHigh: 12, superset: null, notes: "", lastSummary: store.lastSetsFor(x.name).length?"Dernière fois : "+store.lastSetsFor(x.name).map(s=>`${fmtNum(s.weight)}×${s.reps}`).join("  "):"", sets: [1,2,3,4].map(n => ({ setIndex: n, weight: store.lastSetsFor(x.name)[0]?.weight||0, reps: 12, rpe: null, isWarmup: false, done: false })) }); document.querySelector(".modal")?.remove(); render(); });
  if (a === "rest-add") { rest.endAt += 15000; rest.total += 15; return; }
  if (a === "rest-sub") { rest.endAt = Math.max(Date.now(), rest.endAt - 15000); return; }
  if (a === "rest-skip") { clearInterval(restTimer); rest.running = false; return render(); }
  if (a === "finish") return finishWorkout();
  if (a === "save-session") { saveSession(el.dataset.rpe ? +el.dataset.rpe : null); return; }
  if (a === "cancel-live") { if (confirm("Annuler la séance ? Les séries non enregistrées seront perdues.")) cancelLive(); return; }
  // progression / profil
  if (a === "cal-prev") { state.calOffset = (state.calOffset || 0) - 1; return render(); }
  if (a === "cal-next") { if ((state.calOffset || 0) < 0) state.calOffset++; return render(); }
  if (a === "addbw") { const v = numW($("#bw").value); if (v > 0) { store.addBodyWeight(v); render(); } return; }
  if (a === "export") return doExport();
  if (a === "import") return $("#importfile").click();
  // exos / routines perso
  if (a === "new-exercise") return showExerciseEditor();
  if (a === "new-routine") return openEditor(null);
  if (a === "edit-routine") return openEditor(el.dataset.id);
  if (a === "cancel-editor") { state.screen = "home"; state.tab = "programmes"; state.editor = null; return render(); }
  if (a === "ed-color") { state.editor.color = el.dataset.c; return renderEditor(); }
  if (a === "ed-del") { state.editor.exercises.splice(i, 1); return renderEditor(); }
  if (a === "ed-up") { if (i > 0) { const ex = state.editor.exercises; [ex[i-1], ex[i]] = [ex[i], ex[i-1]]; } return renderEditor(); }
  if (a === "ed-down") { const ex = state.editor.exercises; if (i < ex.length - 1) { [ex[i+1], ex[i]] = [ex[i], ex[i+1]]; } return renderEditor(); }
  if (a === "ed-addex") return showPicker(id => { state.editor.exercises.push({ ex: id, sets: 4, repLow: 8, repHigh: 12, rest: store.getSetting("defaultRest"), ladder: [], notes: "" }); document.querySelector(".modal")?.remove(); renderEditor(); });
  if (a === "save-routine") return saveRoutine();
  if (a === "del-routine") { if (confirm("Supprimer cette séance perso ?")) { store.deleteRoutine(el.dataset.id); state.screen = "home"; state.tab = "programmes"; state.editor = null; render(); } return; }
  // picker
  if (a === "pick") { const cb = pickerCb; pickerCb = null; if (cb) cb(el.dataset.ex); return; }
});
// ---------- events: input/change ----------
document.addEventListener("input", e => {
  const f = e.target.closest("[data-f]");
  if (f && state.live) { const k = f.dataset.f; state.live.exercises[+f.dataset.ei].sets[+f.dataset.si][k] = k === "rpe" ? (e.target.value ? +e.target.value : null) : (k === "weight" ? e.target.value.replace(",", ".") : e.target.value); return; }
  const ef = e.target.closest("[data-ef]");
  if (ef && state.editor) { state.editor.exercises[+ef.dataset.i][ef.dataset.ef] = +e.target.value || 0; return; }
  const sef = e.target.closest("[data-sef]");
  if (sef && state.sessionEdit) { const k = sef.dataset.sef; const s = state.sessionEdit.groups[+sef.dataset.gi].sets[+sef.dataset.si]; s[k] = k === "rpe" ? (e.target.value ? +e.target.value : null) : (k === "weight" ? e.target.value.replace(",", ".") : e.target.value); return; }
  if (e.target.id === "pickerq") { const q = e.target.value.toLowerCase(); document.querySelectorAll("#pickerlist .pickrow").forEach(r => r.style.display = r.dataset.name.includes(q) ? "" : "none"); return; }
});
document.addEventListener("change", e => {
  if (e.target.id === "importfile" && e.target.files[0]) doImport(e.target.files[0]);
  if (e.target.id === "chartex") { state.chartEx = e.target.value; render(); }
  if (e.target.id === "se-rpe" && state.sessionEdit) state.sessionEdit.sessionRPE = e.target.value ? +e.target.value : null;
  if (e.target.id === "remind") store.setSetting("remindBackup", e.target.checked);
  if (e.target.id === "defrest") store.setSetting("defaultRest", +e.target.value);
  if (e.target.id === "notify") { store.setSetting("notify", e.target.checked); if (e.target.checked && "Notification" in window && Notification.permission !== "granted") Notification.requestPermission(); }
  if (e.target.id === "vibrate") store.setSetting("vibrate", e.target.checked);
});
// Retour au premier plan : ré-acquiert le verrou d'écran et rattrape un repos terminé pendant l'absence.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (state.screen === "live") requestWakeLock();
  if (rest.running) {
    rest.remaining = Math.max(0, Math.ceil((rest.endAt - Date.now()) / 1000));
    if (rest.remaining <= 0) { clearInterval(restTimer); rest.running = false; alertRestDone(); }
    render();
  }
});
// éditeur : nom/résumé (au blur/changement)
document.addEventListener("input", e => {
  if (e.target.id === "ed-name" && state.editor) state.editor.name = e.target.value;
  if (e.target.id === "ed-sum" && state.editor) state.editor.summary = e.target.value;
});

function saveRoutine() {
  const ed = state.editor;
  if (!ed.name.trim()) { toast("Donne un nom à la séance"); return; }
  if (!ed.exercises.length) { toast("Ajoute au moins un exercice"); return; }
  const payload = { name: ed.name.trim(), color: ed.color, summary: ed.summary.trim(), exercises: ed.exercises };
  if (ed.id) store.updateRoutine(ed.id, payload); else store.addCustomRoutine(payload);
  state.screen = "home"; state.tab = "programmes"; state.editor = null; render(); toast("Séance enregistrée");
}
function showExerciseEditor() {
  const m = document.createElement("div"); m.className = "modal"; m.dataset.action = "close-modal";
  const groups = ["Jambes","Pectoraux","Dos","Épaules","Biceps","Triceps","Mollets","Abdominaux","Corps entier"];
  const equips = ["Barre","Haltères","Machine","Poulie","Smith","Poids du corps","Kettlebell","Autre"];
  m.innerHTML = `<div class="sheet" data-action="stop"><div class="rowline"><div class="title grow">Nouvel exercice</div><button class="link strong" data-action="close-modal">Fermer</button></div>
    <label class="sub">Nom</label><input id="nx-name" class="field" style="text-align:left"/>
    <div class="rowline"><label class="sub grow">Muscle<select id="nx-group" class="field">${groups.map(g=>`<option>${g}</option>`).join("")}</select></label>
      <label class="sub grow">Matériel<select id="nx-eq" class="field">${equips.map(g=>`<option>${g}</option>`).join("")}</select></label></div>
    <label class="sub">Conseils (exécution)</label><textarea id="nx-ins" class="field" style="text-align:left;height:80px"></textarea>
    <button class="btn primary big" data-action="save-exercise">Créer</button></div>`;
  document.body.appendChild(m);
}
document.addEventListener("click", e => {
  if (e.target.closest('[data-action="save-exercise"]')) {
    const name = $("#nx-name").value.trim(); if (!name) { toast("Nom requis"); return; }
    store.addCustomExercise({ name, group: $("#nx-group").value, equipment: $("#nx-eq").value, instructions: $("#nx-ins").value.trim() });
    document.querySelector(".modal")?.remove(); render(); toast("Exercice créé");
  }
});

// ---------- boot ----------
render();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
