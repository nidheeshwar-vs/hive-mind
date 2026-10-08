require('dotenv').config();
const express = require('express');
const path = require('path');
const { db } = require('./db');
const { ensureSeed } = require('./seed');
const { simulateTick } = require('./services/health');
const { watchdog } = require('./services/sla');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));

ensureSeed();

app.use('/api', require('./routes/core'));
app.use('/api', require('./routes/assets'));
app.use('/api', require('./routes/requests'));
app.use('/api', require('./routes/insights'));
app.get('/healthz', (req, res) => res.json({ ok: true }));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Something went wrong on our side.' }); });

// Background jobs: IoT simulation + SLA watchdog
if (process.env.SIMULATE_IOT !== 'false') setInterval(() => { try { simulateTick(); } catch (e) { console.error(e); } }, 20000).unref();
setInterval(() => { try { watchdog(); } catch (e) { console.error(e); } }, 30000).unref();
try { watchdog(); } catch (e) { console.error(e); }

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Hive Mind running on http://localhost:${PORT}`));
