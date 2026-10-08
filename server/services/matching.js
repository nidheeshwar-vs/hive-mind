// AI feature 1: Intelligent technician matching (explainable weighted scoring).
// Score = skill 35% + workload 20% + availability 15% + distance 15% + experience 15%
const { db } = require('../db');
const { J, activeLoad } = require('./workflow');

const W = { skill: 0.35, workload: 0.20, availability: 0.15, distance: 0.15, experience: 0.15 };

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371, rad = d => d * Math.PI / 180;
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

function rankTechnicians(request, { excludeIds = [] } = {}) {
  const site = db.prepare('SELECT * FROM sites WHERE id=?').get(request.site_id);
  const techs = db.prepare('SELECT t.*, u.name, u.email FROM technicians t JOIN users u ON u.id=t.user_id').all();
  const need = request.required_skills || [];
  const out = techs.filter(t => !excludeIds.includes(t.id)).map(t => {
    const skills = J(t.skills);
    const matched = need.filter(s => skills.includes(s));
    const missing = need.filter(s => !skills.includes(s));
    const load = activeLoad(t.id);
    const km = haversine(t.lat, t.lng, site.lat, site.lng);
    const s = {
      skill: need.length ? matched.length / need.length : 1,
      workload: Math.max(0, 1 - load / t.max_load),
      availability: t.status === 'off' ? 0 : t.status === 'available' ? 1 : 0.6,
      distance: Math.exp(-km / 150),
      experience: Math.min(t.experience_years / 12, 1) * 0.7 + (t.rating / 5) * 0.3
    };
    const score = Math.round(100 * Object.keys(W).reduce((a, k) => a + W[k] * s[k], 0));
    const blockers = [];
    if (t.status === 'off') blockers.push('Off duty');
    if (load >= t.max_load) blockers.push(`At capacity (${load}/${t.max_load} jobs)`);
    if (missing.length) blockers.push(`Missing skill: ${missing.join(', ')}`);
    return {
      technician_id: t.id, user_id: t.user_id, name: t.name, skills, status: t.status,
      active_jobs: load, max_load: t.max_load, distance_km: Math.round(km), eta_minutes: Math.round(km / 45 * 60),
      experience_years: t.experience_years, rating: t.rating, base_label: t.base_label,
      score, breakdown: Object.fromEntries(Object.keys(s).map(k => [k, Math.round(s[k] * 100)])),
      matched_skills: matched, missing_skills: missing, blockers, eligible: blockers.length === 0
    };
  });
  return out.sort((a, b) => (b.eligible - a.eligible) || (b.score - a.score));
}

module.exports = { rankTechnicians, haversine, WEIGHTS: W };
