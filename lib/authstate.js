/**
 * Baileys auth state (creds + signal keys) persisted through lib/store.
 * Unlike the old creds-only approach, signal keys are saved too, so a restart
 * never causes "waiting for this message" / bad-decrypt problems.
 */
const bl = require('@whiskeysockets/baileys');
const { initAuthCreds, BufferJSON, proto } = bl;

async function useStoreAuthState(store, ns) {
  const cache = new Map(); // `${type}-${id}` -> value (write-through cache)
  const fileKey = (type, id) => `key-${type}-${String(id).replace(/\//g, '__').replace(/:/g, '-')}`;

  const rawCreds = await store.get(ns, 'creds');
  const creds = rawCreds ? JSON.parse(rawCreds, BufferJSON.reviver) : initAuthCreds();

  // serialize writes per session so creds are never written out of order
  let chain = Promise.resolve();
  const enqueue = (fn) => (chain = chain.then(fn, fn).catch((e) => console.error(`[${ns}] store write failed:`, e.message)));

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(ids.map(async (id) => {
            const ck = `${type}-${id}`;
            let v = cache.get(ck);
            if (v === undefined) {
              const raw = await store.get(ns, fileKey(type, id));
              v = raw ? JSON.parse(raw, BufferJSON.reviver) : null;
              if (v && type === 'app-state-sync-key') v = proto.Message.AppStateSyncKeyData.fromObject(v);
              if (v) cache.set(ck, v);
            }
            data[id] = v;
          }));
          return data;
        },
        set: async (data) => {
          const jobs = [];
          for (const type in data) {
            for (const id in data[type]) {
              const v = data[type][id];
              const ck = `${type}-${id}`;
              if (v) { cache.set(ck, v); jobs.push(enqueue(() => store.set(ns, fileKey(type, id), JSON.stringify(v, BufferJSON.replacer)))); }
              else { cache.delete(ck); jobs.push(enqueue(() => store.del(ns, fileKey(type, id)))); }
            }
          }
          await Promise.all(jobs);
        }
      }
    },
    saveCreds: () => enqueue(() => store.set(ns, 'creds', JSON.stringify(creds, BufferJSON.replacer))),
    flush: () => chain
  };
}

module.exports = { useStoreAuthState };
