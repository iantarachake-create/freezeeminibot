/**
 * Persistent key/value storage, namespaced per WhatsApp number.
 *   - DATABASE_URL set -> PostgreSQL (e.g. Supabase)
 *   - MONGODB_URI set  -> MongoDB (survives redeploys on ephemeral hosts)
 *   - otherwise        -> files under SESSIONS_DIR/<number>/<key>.json
 * Same API for both so the rest of the bot doesn't care.
 *
 *   get(ns, key) / set(ns, key, string) / del(ns, key) / delNs(ns) / listNs()
 * Values are plain strings (callers JSON-serialize with BufferJSON).
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');

const safe = (s) => String(s).replace(/[^a-zA-Z0-9_.@-]/g, '_').replace(/^\.+/, '_');

class FileStore {
  constructor(dir) {
    this.dir = path.resolve(dir);
    fs.mkdirSync(this.dir, { recursive: true });
    this.kind = 'disk';
  }
  _p(ns, key) { return path.join(this.dir, safe(ns), safe(key) + '.json'); }
  async get(ns, key) {
    try { return await fs.promises.readFile(this._p(ns, key), 'utf8'); } catch { return null; }
  }
  async set(ns, key, val) {
    const p = this._p(ns, key);
    await fs.promises.mkdir(path.dirname(p), { recursive: true });
    // atomic write: a crash mid-write must never corrupt creds
    const tmp = p + '.' + process.pid + '.tmp';
    await fs.promises.writeFile(tmp, val);
    await fs.promises.rename(tmp, p);
  }
  async del(ns, key) { try { await fs.promises.unlink(this._p(ns, key)); } catch {} }
  async delNs(ns) { try { await fs.promises.rm(path.join(this.dir, safe(ns)), { recursive: true, force: true }); } catch {} }
  async listNs() {
    try {
      const out = [];
      for (const d of await fs.promises.readdir(this.dir, { withFileTypes: true })) {
        if (d.isDirectory() && fs.existsSync(path.join(this.dir, d.name, 'creds.json'))) out.push(d.name);
      }
      return out;
    } catch { return []; }
  }
  async close() {}
}

class MongoStore {
  constructor(uri) { this.uri = uri; this.kind = 'mongo'; this.col = null; }
  async init() {
    const mongoose = require('mongoose');
    mongoose.set('strictQuery', false);
    await mongoose.connect(this.uri, { maxPoolSize: 10, serverSelectionTimeoutMS: 15000 });
    this.mongoose = mongoose;
    this.col = mongoose.connection.collection('minibot_kv');
    await this.col.createIndex({ ns: 1 });
    return this;
  }
  async get(ns, key) {
    const d = await this.col.findOne({ _id: `${ns}::${key}` });
    return d ? d.v : null;
  }
  async set(ns, key, val) {
    await this.col.updateOne({ _id: `${ns}::${key}` }, { $set: { ns, key, v: val, t: new Date() } }, { upsert: true });
  }
  async del(ns, key) { await this.col.deleteOne({ _id: `${ns}::${key}` }); }
  async delNs(ns) { await this.col.deleteMany({ ns }); }
  async listNs() { return this.col.distinct('ns', { key: 'creds' }); }
  async close() { try { await this.mongoose.disconnect(); } catch {} }
}

class PgStore {
  constructor(url) { this.url = url; this.kind = 'postgres'; this.pool = null; }
  async init() {
    const { Pool } = require('pg');
    this.pool = new Pool({
      connectionString: this.url,
      ssl: { rejectUnauthorized: false }, // Supabase requires SSL
      max: 10,
      connectionTimeoutMillis: 15000
    });
    this.pool.on('error', (e) => console.error('pg pool error:', e.message));
    await this.pool.query(`CREATE TABLE IF NOT EXISTS minibot_kv (
      ns TEXT NOT NULL,
      key TEXT NOT NULL,
      v TEXT,
      t TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (ns, key)
    )`);
    return this;
  }
  async get(ns, key) {
    const r = await this.pool.query('SELECT v FROM minibot_kv WHERE ns=$1 AND key=$2', [ns, key]);
    return r.rows[0] ? r.rows[0].v : null;
  }
  async set(ns, key, val) {
    await this.pool.query(
      'INSERT INTO minibot_kv (ns, key, v, t) VALUES ($1,$2,$3,now()) ON CONFLICT (ns, key) DO UPDATE SET v=EXCLUDED.v, t=now()',
      [ns, key, val]
    );
  }
  async del(ns, key) { await this.pool.query('DELETE FROM minibot_kv WHERE ns=$1 AND key=$2', [ns, key]); }
  async delNs(ns) { await this.pool.query('DELETE FROM minibot_kv WHERE ns=$1', [ns]); }
  async listNs() {
    const r = await this.pool.query("SELECT DISTINCT ns FROM minibot_kv WHERE key='creds'");
    return r.rows.map((x) => x.ns);
  }
  async close() { try { await this.pool.end(); } catch {} }
}

async function createStore() {
  if (config.DATABASE_URL) {
    try {
      const s = await new PgStore(config.DATABASE_URL).init();
      console.log('💾 Storage: PostgreSQL (Supabase)');
      return s;
    } catch (e) {
      console.error('❌ PostgreSQL connection failed:', e.message);
      console.error('   Fix DATABASE_URL or unset it to use another storage. Exiting so the host retries.');
      process.exit(1);
    }
  }
  if (config.MONGODB_URI) {
    try {
      const s = await new MongoStore(config.MONGODB_URI).init();
      console.log('💾 Storage: MongoDB');
      return s;
    } catch (e) {
      // Never silently fall back: on an ephemeral host that would lose every session on redeploy.
      console.error('❌ MongoDB connection failed:', e.message);
      console.error('   Fix MONGODB_URI or unset it to use disk storage. Exiting so the host retries.');
      process.exit(1);
    }
  }
  const s = new FileStore(config.SESSIONS_DIR);
  console.log(`💾 Storage: disk (${s.dir}) — use a persistent volume or set MONGODB_URI`);
  return s;
}

module.exports = { createStore, FileStore, MongoStore, PgStore };
