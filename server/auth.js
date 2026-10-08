const jwt = require('jsonwebtoken');
const { db } = require('./db');

const SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') console.warn('WARNING: set JWT_SECRET in production!');

const sign = user => jwt.sign({ id: user.id, role: user.role }, SECRET, { expiresIn: '12h' });

function load(token) {
  try {
    const p = jwt.verify(token, SECRET);
    return db.prepare('SELECT id,name,email,role,site_id FROM users WHERE id=?').get(p.id);
  } catch { return null; }
}
// auth() = any logged-in user; auth('admin') = role restricted
const auth = (...roles) => (req, res, next) => {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : req.query.token;
  const user = token && load(token);
  if (!user) return res.status(401).json({ error: 'Please sign in again.' });
  if (roles.length && !roles.includes(user.role)) return res.status(403).json({ error: 'Your role cannot do this.' });
  if (user.role === 'technician') user.tech = db.prepare('SELECT * FROM technicians WHERE user_id=?').get(user.id);
  req.user = user;
  next();
};
module.exports = { auth, sign };
