// Tamper-evident audit trail: every row stores sha256(prev_hash + payload).
// Any edit/deletion in the database breaks the chain -> verifyChain() exposes it.
// (Blockchain-ready: the head hash can be anchored on any public chain.)
const crypto = require('crypto');
const { db } = require('../db');

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const payload = (prev, uid, action, entity, eid, detail, ts) =>
  JSON.stringify([prev, uid ?? null, action, entity ?? null, String(eid ?? ''), detail ?? '', ts]);

function audit(userId, action, entity, entityId, detail) {
  const last = db.prepare('SELECT hash FROM audit ORDER BY id DESC LIMIT 1').get();
  const prev = last ? last.hash : 'GENESIS';
  const ts = new Date().toISOString();
  const hash = sha(payload(prev, userId, action, entity, entityId, detail, ts));
  db.prepare('INSERT INTO audit (user_id,action,entity,entity_id,detail,ts,prev_hash,hash) VALUES (?,?,?,?,?,?,?,?)')
    .run(userId ?? null, action, entity ?? null, String(entityId ?? ''), detail ?? '', ts, prev, hash);
}

function verifyChain() {
  const rows = db.prepare('SELECT * FROM audit ORDER BY id').all();
  let prev = 'GENESIS';
  for (const r of rows) {
    const h = sha(payload(prev, r.user_id, r.action, r.entity, r.entity_id, r.detail, r.ts));
    if (r.prev_hash !== prev || r.hash !== h) return { valid: false, broken_at: r.id, total: rows.length, head: null };
    prev = r.hash;
  }
  return { valid: true, total: rows.length, head: prev };
}
module.exports = { audit, verifyChain };
