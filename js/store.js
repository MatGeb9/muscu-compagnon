// Persistance locale (localStorage) + logique de suivi (suggestion, PR, progression)
// + exercices/séances perso. Export/import JSON pour sauvegarde iCloud.
import { PROGRAM, EXERCISES, PROGRAM_VERSION } from "./data.js";

const KEY = "muscu.data.v1";

const DEFAULT = () => ({
  schema: 2,
  programVersion: PROGRAM_VERSION,
  sessions: [],            // { id, date, endDate, routineId, routineName, sessionRPE, sets:[{exerciseName,order,setIndex,weight,reps,rpe,isWarmup}], totalVolume }
  bodyWeights: [],         // { id, date, weightKg }
  customExercises: {},     // id -> { name, group, equipment, instructions, cues, mistakes, custom:true }
  customRoutines: [],      // { id, name, color, summary, exercises:[...], custom:true }
  routineOverrides: {},    // "b0" -> { name?, color?, summary?, exercises? } : édition persistée d'un programme livré (data.js est en dur)
  settings: { lastBackup: null, remindBackup: true, defaultRest: 90, notify: false, vibrate: true },
});

let cache = null;
export function load() {
  if (cache) return cache;
  try { const raw = localStorage.getItem(KEY); cache = raw ? { ...DEFAULT(), ...JSON.parse(raw) } : DEFAULT(); }
  catch (e) { cache = DEFAULT(); }
  cache.settings = { ...DEFAULT().settings, ...(cache.settings || {}) };
  return cache;
}
export function save() { if (cache) localStorage.setItem(KEY, JSON.stringify(cache)); }
export function uid() {
  return (crypto.randomUUID && crypto.randomUUID()) || (Date.now().toString(36) + Math.floor(performance.now()).toString(36));
}

// --- Exercices (built-in + perso) ---
export function allExercises() { return { ...EXERCISES, ...load().customExercises }; }
export function getExercise(id) { return allExercises()[id] || { name: id, group: "", equipment: "", cues: [], mistakes: [], instructions: "" }; }
export function addCustomExercise(o) {
  const d = load(); const id = "c_" + uid();
  d.customExercises[id] = { name: o.name, group: o.group || "Corps entier", equipment: o.equipment || "Autre",
    instructions: o.instructions || "", cues: o.cues || [], mistakes: o.mistakes || [],
    defaultSets: o.defaultSets || null, defaultRest: o.defaultRest || null, custom: true };
  save(); return id;
}

// --- Séances (programmes) : built-in + perso, avec id stable ---
const isBuiltin = id => /^b\d+$/.test(id);
export function getRoutines() {
  const ov = load().routineOverrides || {};
  const builtin = PROGRAM.map((r, i) => {
    const id = "b" + i, base = { id, builtin: true, ...r };
    return ov[id] ? { ...base, ...ov[id], id, builtin: true, edited: true } : base; // édition persistée = « modifié »
  });
  return [...builtin, ...load().customRoutines];
}
export function getRoutine(id) { return getRoutines().find(r => r.id === id); }
export function addCustomRoutine(o) {
  const d = load(); const id = "r_" + uid();
  d.customRoutines.push({ id, custom: true, name: o.name, color: o.color || "#8E44E6", summary: o.summary || "", exercises: o.exercises || [] });
  save(); return id;
}
export function updateRoutine(id, o) {
  const d = load();
  if (isBuiltin(id)) { d.routineOverrides[id] = { ...(d.routineOverrides[id] || {}), ...o }; save(); return; } // programme livré -> override persisté
  const r = d.customRoutines.find(x => x.id === id); if (!r) return;
  Object.assign(r, o); save();
}
export function deleteRoutine(id) {
  const d = load();
  if (isBuiltin(id)) { delete d.routineOverrides[id]; save(); return; } // « réinitialiser » = retirer l'override
  d.customRoutines = d.customRoutines.filter(x => x.id !== id); save();
}

// --- Changements de structure faits pendant une séance -> proposition de MAJ du programme ---
// Compare la séance live à sa routine : exos ajoutés / retirés / nb de séries de travail modifié.
export function liveStructureDiff(routine, liveExercises) {
  const liveByEx = {};
  for (const e of liveExercises) liveByEx[e.ex] = (e.sets || []).filter(s => !s.isWarmup && !s.drop).length;
  const routineByEx = {};
  for (const e of routine.exercises) routineByEx[e.ex] = e.sets;
  const added = [], removed = [], setChanged = [];
  for (const id of Object.keys(liveByEx)) {
    if (!(id in routineByEx)) added.push(id);
    else if (liveByEx[id] !== routineByEx[id]) setChanged.push(id);
  }
  for (const id of Object.keys(routineByEx)) if (!(id in liveByEx)) removed.push(id);
  return { changed: !!(added.length || removed.length || setChanged.length), added, removed, setChanged, liveByEx };
}
// Reconstruit la liste d'exercices de la routine depuis la séance : garde l'ordre d'origine pour les
// exos conservés (séries mises à jour), ajoute les nouveaux à la fin (paramètres par défaut de l'exo).
export function routineFromLive(routine, liveExercises, diff) {
  const d = diff || liveStructureDiff(routine, liveExercises);
  const out = [], seen = new Set();
  for (const e of routine.exercises) if (e.ex in d.liveByEx) { out.push({ ...e, sets: d.liveByEx[e.ex] || e.sets }); seen.add(e.ex); }
  for (const e of liveExercises) {
    if (seen.has(e.ex)) continue; seen.add(e.ex);
    const x = allExercises()[e.ex] || {};
    out.push({ ex: e.ex, sets: d.liveByEx[e.ex] || x.defaultSets || 4, repLow: e.repLow || 8, repHigh: e.repHigh || 12,
      rest: e.rest || x.defaultRest || getSetting("defaultRest") || 90, ladder: [], notes: e.notes || "" });
  }
  return out;
}

// --- Séances réalisées ---
export function addSession(s) { const d = load(); d.sessions.unshift(s); save(); }
export function getSessions() { return load().sessions; }
export function getSession(id) { return load().sessions.find(s => s.id === id); }
export function deleteSession(id) { const d = load(); d.sessions = d.sessions.filter(s => s.id !== id); save(); }
export function updateSession(id, patch) {
  const d = load(); const s = d.sessions.find(x => x.id === id); if (!s) return;
  Object.assign(s, patch);
  s.totalVolume = (s.sets || []).filter(x => !x.isWarmup).reduce((a, x) => a + x.weight * x.reps, 0);
  save();
}

// --- Suivi intelligent ---
export function lastSetsFor(name) {
  for (const s of load().sessions) {
    const sets = (s.sets || []).filter(x => x.exerciseName === name && !x.isWarmup && !x.drop); // exclut échauffement ET dégressifs (sinon ils polluent pré-remplissage/suggestion)
    if (sets.length) return sets.slice().sort((a, b) => a.setIndex - b.setIndex);
  }
  return [];
}
export function oneRM(weight, reps) { if (!reps) return 0; return reps === 1 ? weight : weight * (1 + reps / 30); }

// Suggestion de charge — tient compte du RPE (comme l'app native).
export function suggestWeight(name, repHigh, ladder) {
  const last = lastSetsFor(name);
  if (!last.length) return ladder && ladder.length ? ladder[0] : 0;
  const top = Math.max(...last.map(s => s.weight));
  const topSets = last.filter(s => s.weight >= top - 0.01);
  const hitReps = topSets.every(s => s.reps >= repHigh);
  const rpes = topSets.map(s => s.rpe).filter(r => r != null);
  const feltEasy = rpes.length ? rpes.every(r => r <= 8) : true;
  if (hitReps && feltEasy && ladder && ladder.length) {
    const next = ladder.find(w => w > top + 0.01);
    return next != null ? next : +(top + 2.5).toFixed(2);
  }
  if (hitReps && feltEasy) return +(top + 2.5).toFixed(2);
  return top;
}

export function personalRecord(name) {
  let bestW = null, bestRM = 0;
  for (const s of load().sessions) for (const x of (s.sets || [])) {
    if (x.exerciseName !== name || x.isWarmup) continue;
    if (!bestW || x.weight > bestW.weight || (x.weight === bestW.weight && x.reps > bestW.reps))
      bestW = { weight: x.weight, reps: x.reps, date: s.date };
    const rm = oneRM(x.weight, x.reps);
    if (rm > bestRM) bestRM = rm;
  }
  return bestW ? { ...bestW, oneRM: bestRM } : null;
}

// Exercices ayant un historique (pour le sélecteur de graphiques).
export function exercisesWithHistory() {
  const set = new Set();
  for (const s of load().sessions) for (const x of (s.sets || [])) if (!x.isWarmup) set.add(x.exerciseName);
  return [...set].sort();
}

// Points d'évolution par séance pour un exercice.
export function progressPoints(name) {
  const pts = [];
  for (const s of load().sessions) {
    const sets = (s.sets || []).filter(x => x.exerciseName === name && !x.isWarmup);
    if (!sets.length) continue;
    pts.push({
      date: s.date,
      topWeight: Math.max(...sets.map(x => x.weight)),
      oneRM: Math.max(...sets.map(x => oneRM(x.weight, x.reps))),
      volume: sets.reduce((a, x) => a + x.weight * x.reps, 0),
    });
  }
  return pts.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
}

// --- Poids corporel ---
export function addBodyWeight(weightKg) { const d = load(); d.bodyWeights.unshift({ id: uid(), date: new Date().toISOString(), weightKg }); save(); }
export function getBodyWeights() { return load().bodyWeights; }
export function bodyWeightPoints() { return getBodyWeights().slice().reverse().map(w => ({ date: w.date, value: w.weightKg })); }

// --- Réglages ---
export function setSetting(k, v) { const d = load(); d.settings[k] = v; save(); }
export function getSetting(k) { return load().settings[k]; }

// --- Export / Import ---
export function exportJSON() { return JSON.stringify({ ...load(), exportedAt: new Date().toISOString(), app: "Muscu" }, null, 2); }
export function importJSON(text) {
  const inc = JSON.parse(text); const d = load();
  const seenS = new Set(d.sessions.map(s => s.id)), seenW = new Set(d.bodyWeights.map(w => w.id));
  let added = { sessions: 0, weights: 0 };
  for (const s of (inc.sessions || [])) if (!seenS.has(s.id)) { d.sessions.push(s); added.sessions++; }
  for (const w of (inc.bodyWeights || [])) if (!seenW.has(w.id)) { d.bodyWeights.push(w); added.weights++; }
  if (inc.customExercises) d.customExercises = { ...inc.customExercises, ...d.customExercises };
  if (inc.customRoutines) {
    const ids = new Set(d.customRoutines.map(r => r.id));
    for (const r of inc.customRoutines) if (!ids.has(r.id)) d.customRoutines.push(r);
  }
  if (inc.routineOverrides) d.routineOverrides = { ...inc.routineOverrides, ...d.routineOverrides }; // programmes édités (local prioritaire)
  d.sessions.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  d.bodyWeights.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  save(); return added;
}
