// Persistance locale (localStorage) + export/import JSON pour sauvegarde iCloud.
import { PROGRAM_VERSION } from "./data.js";

const KEY = "muscu.data.v1";

const DEFAULT = () => ({
  schema: 1,
  programVersion: PROGRAM_VERSION,
  sessions: [],      // { id, date, endDate, routineName, sets:[{exerciseName,order,setIndex,weight,reps,isWarmup}], notes }
  bodyWeights: [],   // { id, date, weightKg }
  settings: { lastBackup: null, remindBackup: true },
});

let cache = null;

export function load() {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? { ...DEFAULT(), ...JSON.parse(raw) } : DEFAULT();
  } catch (e) {
    cache = DEFAULT();
  }
  return cache;
}

export function save() {
  if (!cache) return;
  localStorage.setItem(KEY, JSON.stringify(cache));
}

export function uid() {
  return (crypto.randomUUID && crypto.randomUUID()) ||
    (Date.now().toString(36) + Math.floor(performance.now()).toString(36));
}

// --- Séances ---
export function addSession(session) {
  const d = load();
  d.sessions.unshift(session);
  save();
}

export function getSessions() {
  return load().sessions;
}

// Dernières séries (hors échauffement) de la dernière fois où l'exo a été fait.
export function lastSetsFor(exerciseName) {
  const d = load();
  for (const s of d.sessions) {
    const sets = (s.sets || []).filter(x => x.exerciseName === exerciseName && !x.isWarmup);
    if (sets.length) return sets.sort((a, b) => a.setIndex - b.setIndex);
  }
  return [];
}

// Suggestion de charge : si la dernière fois on a atteint le haut de fourchette, propose le cran suivant de l'échelle.
export function suggestWeight(exerciseName, repHigh, ladder) {
  const last = lastSetsFor(exerciseName);
  if (!last.length) return ladder && ladder.length ? ladder[0] : 0;
  const top = Math.max(...last.map(s => s.weight));
  const topSets = last.filter(s => s.weight >= top - 0.01);
  const hitReps = topSets.every(s => s.reps >= repHigh);
  if (hitReps && ladder && ladder.length) {
    const next = ladder.find(w => w > top + 0.01);
    if (next) return next;
    return +(top + 2.5).toFixed(2);
  }
  return top;
}

// --- Poids corporel ---
export function addBodyWeight(weightKg) {
  const d = load();
  d.bodyWeights.unshift({ id: uid(), date: new Date().toISOString(), weightKg });
  save();
}
export function getBodyWeights() { return load().bodyWeights; }

// --- Réglages ---
export function setSetting(k, v) { const d = load(); d.settings[k] = v; save(); }
export function getSetting(k) { return load().settings[k]; }

// --- Export / Import (sauvegarde iCloud) ---
export function exportJSON() {
  const d = load();
  return JSON.stringify({ ...d, exportedAt: new Date().toISOString(), app: "Muscu" }, null, 2);
}

export function importJSON(text) {
  const incoming = JSON.parse(text);
  const d = load();
  const seenS = new Set(d.sessions.map(s => s.id));
  const seenW = new Set(d.bodyWeights.map(w => w.id));
  let added = { sessions: 0, weights: 0 };
  for (const s of (incoming.sessions || [])) if (!seenS.has(s.id)) { d.sessions.push(s); added.sessions++; }
  for (const w of (incoming.bodyWeights || [])) if (!seenW.has(w.id)) { d.bodyWeights.push(w); added.weights++; }
  d.sessions.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  d.bodyWeights.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  save();
  return added;
}
