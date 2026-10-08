// Real-time layer: Server-Sent Events + persistent notifications.
const { db } = require('../db');
const clients = new Set(); // { res, userId, role }

function addClient(res, user) {
  const c = { res, userId: user.id, role: user.role };
  clients.add(c);
  res.on('close', () => clients.delete(c));
}
function send(c, event, data) { c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }

function broadcast(event, data) { clients.forEach(c => send(c, event, data)); }

function notify(userIds, message, link) {
  const ids = [...new Set([].concat(userIds).filter(Boolean))];
  const ts = new Date().toISOString();
  const ins = db.prepare('INSERT INTO notifications (user_id,message,link,ts) VALUES (?,?,?,?)');
  ids.forEach(id => {
    ins.run(id, message, link || null, ts);
    clients.forEach(c => { if (c.userId === id) send(c, 'notification', { message, link, ts }); });
  });
}
function adminIds() { return db.prepare("SELECT id FROM users WHERE role='admin'").all().map(r => r.id); }
function notifyAdmins(message, link) { notify(adminIds(), message, link); }

setInterval(() => clients.forEach(c => c.res.write(': ping\n\n')), 25000).unref();

module.exports = { addClient, broadcast, notify, notifyAdmins, adminIds };
