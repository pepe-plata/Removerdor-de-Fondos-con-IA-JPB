// ===================================================================
//  db.js — Wrapper simple de IndexedDB para modelos ONNX
//  Guarda ArrayBuffers (más portable que Blob entre navegadores)
// ===================================================================

const DB_NAME = 'bg-remover-db';
const DB_VERSION = 2;                 // v2 por cambio de formato (Blob → ArrayBuffer)
const STORE_MODELS = 'models';
const STORE_META   = 'models-meta';

const ModelDB = (() => {
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        // Recrear si existían de versión anterior
        if (db.objectStoreNames.contains(STORE_MODELS)) db.deleteObjectStore(STORE_MODELS);
        if (db.objectStoreNames.contains(STORE_META)) db.deleteObjectStore(STORE_META);
        db.createObjectStore(STORE_MODELS);
        db.createObjectStore(STORE_META);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(storeName, mode = 'readonly') {
    return open().then(db => db.transaction(storeName, mode).objectStore(storeName));
  }

  function reqPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  return {
    /** Devuelve el ArrayBuffer del modelo o null */
    async getModel(key) {
      const store = await tx(STORE_MODELS, 'readonly');
      const buf = await reqPromise(store.get(key));
      if (!buf) return null;
      if (buf instanceof ArrayBuffer) return buf;
      if (buf && buf.buffer instanceof ArrayBuffer) return buf.buffer;
      return buf;
    },

    async getMeta(key) {
      const store = await tx(STORE_META, 'readonly');
      const meta = await reqPromise(store.get(key));
      return meta || null;
    },

    async listMeta() {
      const store = await tx(STORE_META, 'readonly');
      return reqPromise(store.getAll());
    },

    /**
     * Guarda el modelo.
     * @param key  string
     * @param data ArrayBuffer o Blob (se normaliza a ArrayBuffer)
     * @param meta object
     */
    async saveModel(key, data, meta) {
      let buffer;
      if (data instanceof ArrayBuffer) {
        buffer = data;
      } else if (typeof Blob !== 'undefined' && data instanceof Blob) {
        buffer = await data.arrayBuffer();
      } else if (data && data.buffer instanceof ArrayBuffer) {
        buffer = data.buffer;
      } else {
        throw new Error('Tipo de dato no soportado para guardar modelo');
      }

      const db = await open();
      return new Promise((resolve, reject) => {
        const t = db.transaction([STORE_MODELS, STORE_META], 'readwrite');
        t.objectStore(STORE_MODELS).put(buffer, key);
        t.objectStore(STORE_META).put(meta, key);
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
      });
    },

    async deleteModel(key) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const t = db.transaction([STORE_MODELS, STORE_META], 'readwrite');
        t.objectStore(STORE_MODELS).delete(key);
        t.objectStore(STORE_META).delete(key);
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
      });
    },

    async estimate() {
      if (navigator.storage && navigator.storage.estimate) {
        return navigator.storage.estimate();
      }
      return { usage: 0, quota: 0 };
    },

    async requestPersistence() {
      if (navigator.storage && navigator.storage.persist) {
        try { return await navigator.storage.persist(); }
        catch (_) { return false; }
      }
      return false;
    }
  };
})();