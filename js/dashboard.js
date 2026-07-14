// Onglet « Bilan » — vue d'ensemble agrégée (tous exercices confondus).
// Fonctions PURES : lisent le store, renvoient une string HTML (même paradigme que charts.js).
// N'ajoute AUCUNE persistance : tout est recalculé à partir des séances existantes.
import * as store from "./store.js";
import { lineChart } from "./charts.js";

const DAY = 864e5;
const MUSCLES = ["Pectoraux", "Dos", "Jambes", "Épaules", "Biceps", "Triceps", "Mollets", "Abdominaux"];
const MCOLOR = {
  Pectoraux: "#E23B3B", Dos: "#2E7BE6", Jambes: "#FF7A00", "Épaules": "#8E44E6",
  Biceps: "#14B8A6", Triceps: "#27c06a", Mollets: "#E6A700", Abdominaux: "#E6007A", Autre: "#6b7280",
};
const GOAL_SESSIONS = 5; // cible hebdo (codée en dur pour l'instant — deviendra paramétrable en v1.2)

const fmtNum = n => (Math.round(n * 100) / 100).toString();
const fmtKg = v => (v >= 10000 ? Math.round(v / 1000) + "k" : Math.round(v).toString());
function weekStartTs(d) { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - day); return +x; }

// nom d'exercice -> groupe musculaire. ⚠ les séries stockent exerciseName (chaîne), pas l'id :
// on indexe donc par NOM depuis le catalogue (built-in + perso). Bucket "Autre" si exo disparu.
function nameToGroup() {
  const idx = {};
  for (const x of Object.values(store.allExercises())) idx[x.name] = x.group;
  return idx;
}

// Une seule passe sur les séances -> tous les agrégats du bilan.
export function computeStats() {
  const sessions = store.getSessions();           // trié desc (plus récent d'abord)
  const n2g = nameToGroup();
  const now = Date.now();
  const weekStart = weekStartTs(now);

  let weekSessions = 0, weekVolume = 0, lastSessionTs = null;
  const vol28 = {};        // groupe -> volume 28j
  const lastWork = {};     // groupe -> ts du dernier travail
  const setCount = {};     // nom d'exo -> nb séries de travail (pour l'exo par défaut)
  const activeWeeks = new Set();

  for (const s of sessions) {
    const t = +new Date(s.date);
    if (lastSessionTs == null || t > lastSessionTs) lastSessionTs = t;
    activeWeeks.add(weekStartTs(t));
    if (t >= weekStart) weekSessions++;
    for (const set of s.sets || []) {
      if (set.isWarmup) continue;
      const g = n2g[set.exerciseName] || "Autre";
      const v = (set.weight || 0) * (set.reps || 0);
      if (t >= weekStart) weekVolume += v;
      if (now - t <= 28 * DAY) vol28[g] = (vol28[g] || 0) + v;
      if (!lastWork[g] || t > lastWork[g]) lastWork[g] = t;
      setCount[set.exerciseName] = (setCount[set.exerciseName] || 0) + 1;
    }
  }

  // streak = semaines actives consécutives (grâce à la semaine en cours si pas encore de séance)
  let streak = 0, cur = weekStart;
  if (!activeWeeks.has(cur)) cur -= 7 * DAY;
  while (activeWeeks.has(cur)) { streak++; cur -= 7 * DAY; }

  const topEx = Object.entries(setCount).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const daysSince = lastSessionTs == null ? null : Math.floor((now - lastSessionTs) / DAY);

  return { sessionCount: sessions.length, weekSessions, weekVolume, daysSince, streak, vol28, lastWork, topEx, now };
}

// -------- blocs de rendu --------
function heroBlock(st) {
  const ds = st.daysSince == null ? "–" : (st.daysSince === 0 ? "0" : String(st.daysSince));
  return `<div class="week"><div class="weeklabel">Cette semaine</div>
      <div class="weekbig">${st.weekSessions}<span>/${GOAL_SESSIONS} séances</span></div></div>
    <div class="stats">
      <div><b>${fmtKg(st.weekVolume)}</b><span>Volume 7j (kg)</span></div>
      <div><b>${ds}</b><span>j. depuis séance</span></div>
      <div><b>${st.streak} 🔥</b><span>semaines d'affilée</span></div></div>`;
}

function nextSessionBlock(st) {
  const routines = store.getRoutines();
  if (!routines.length) return "";
  const sessions = store.getSessions();
  const lastByRoutine = {};
  for (const s of sessions) {
    const t = +new Date(s.date);
    if (!lastByRoutine[s.routineId] || t > lastByRoutine[s.routineId]) lastByRoutine[s.routineId] = t;
  }
  // priorité à la routine la moins récemment (ou jamais) entraînée
  const reco = routines.slice().sort((a, b) => (lastByRoutine[a.id] || 0) - (lastByRoutine[b.id] || 0))[0];
  const last = lastByRoutine[reco.id];
  const label = last ? `Dernière fois il y a ${Math.max(0, Math.floor((st.now - last) / DAY))} j` : "Jamais faite";
  return `<h2>Prochaine séance conseillée</h2>
    <div class="card routine" data-action="open-warmup" data-id="${reco.id}">
      <span class="bar" style="background:${reco.color}"></span>
      <div class="grow"><div class="title">${reco.name}</div><div class="sub">${label} · ${reco.exercises.length} exercices</div></div>
      <button class="btn primary" data-action="open-warmup" data-id="${reco.id}">Démarrer</button></div>`;
}

function exerciseChartBlock(selectedEx) {
  const exos = store.exercisesWithHistory();
  if (!exos.length) return `<h2>Charge max par exercice</h2><div class="card col"><p class="chartempty">Enregistre des séances pour voir tes courbes 📈</p></div>`;
  const st = computeStats();
  let ex = selectedEx && exos.includes(selectedEx) ? selectedEx : (exos.includes(st.topEx) ? st.topEx : exos[0]);
  const pts = store.progressPoints(ex);
  const pr = store.personalRecord(ex);
  return `<h2>Charge max par exercice</h2>
    <div class="card col"><div class="rowline"><b class="grow">Exercice</b>
      <select id="dashex" class="field auto">${exos.map(e => `<option ${e === ex ? "selected" : ""}>${e}</option>`).join("")}</select></div>
      ${pr ? `<div class="pr">🏆 ${fmtNum(pr.weight)} kg × ${pr.reps} · 1RM est. ${fmtNum(pr.oneRM)} kg</div>` : ""}
      <div class="chartlabel">Charge max soulevée (kg)</div>
      ${lineChart(pts.map(p => ({ date: p.date, value: p.topWeight })), { color: "#E23B3B" })}</div>`;
}

function muscleBalanceBlock(st) {
  const max = Math.max(1, ...MUSCLES.map(m => st.vol28[m] || 0));
  const any = MUSCLES.some(m => st.vol28[m]);
  const bars = MUSCLES.map(m => {
    const v = st.vol28[m] || 0;
    return `<div class="mbar"><span class="mbar-lbl">${m}</span>
      <span class="mbar-track"><span class="mbar-fill" style="width:${(v / max * 100).toFixed(0)}%;background:${MCOLOR[m]}"></span></span>
      <span class="mbar-val">${fmtKg(v)}</span></div>`;
  }).join("");
  return `<h2>Équilibre musculaire · 28 jours</h2>
    <div class="card col">${bars}
      <div class="sub">${any ? "Volume soulevé par groupe (repère les muscles négligés)." : "Aucune série sur 28 jours."}</div></div>`;
}

function freshnessBlock(st) {
  const cells = MUSCLES.map(m => {
    const t = st.lastWork[m];
    let cls, label;
    if (!t) { cls = "neg"; label = "jamais"; }
    else {
      const d = Math.floor((st.now - t) / DAY);
      label = d === 0 ? "aujourd'hui" : (d === 1 ? "hier" : `il y a ${d} j`);
      cls = d >= 7 ? "neg" : (d >= 3 ? "ok" : "rec");
    }
    return `<div class="fresh ${cls}"><b>${m}</b><span>${label}</span></div>`;
  }).join("");
  return `<h2>Fraîcheur · quoi travailler ?</h2>
    <div class="card col"><div class="fresh-grid">${cells}</div>
      <div class="sub"><i class="dot neg"></i> négligé (≥ 7 j) &nbsp; <i class="dot ok"></i> prêt &nbsp; <i class="dot rec"></i> récent</div></div>`;
}

// Vue complète. opts.ex = exercice sélectionné dans le graphe (piloté par app.js via state.dashEx).
export function view(opts = {}) {
  const st = computeStats();
  if (!st.sessionCount) {
    return `<header class="head"><h1>Bilan</h1></header>
      <div class="scroll"><p class="muted">Fais ta première séance pour voir ton bilan 📊</p><div class="pad"></div></div>`;
  }
  return `<header class="head"><h1>Bilan</h1></header><div class="scroll">
    ${heroBlock(st)}
    ${nextSessionBlock(st)}
    ${exerciseChartBlock(opts.ex)}
    ${muscleBalanceBlock(st)}
    ${freshnessBlock(st)}
    <div class="pad"></div></div>`;
}
