/* Stockage local durable — IndexedDB avec repli localStorage. */
(() => {
  'use strict';

  const DB_NAME = 'croquis-rampe-local';
  const DB_VERSION = 2;
  const STORE = 'sketches';
  const META_STORE = 'meta';
  const FALLBACK_KEY = 'croquis-rampe-sketches-v2';
  const DRAFT_KEY = 'croquis-rampe-current-draft-v2';
  const SCHEMA_VERSION = 2;

  class LocalSketchStorage {
    constructor() {
      this.db = null;
      this.mode = 'indexeddb';
      this.ready = this.init();
    }

    async init() {
      if (!('indexedDB' in window)) {
        this.mode = 'localstorage';
        return;
      }
      try {
        this.db = await new Promise((resolve, reject) => {
          const request = indexedDB.open(DB_NAME, DB_VERSION);
          request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE)) {
              const store = db.createObjectStore(STORE, { keyPath: 'id' });
              store.createIndex('updatedAt', 'updatedAt', { unique: false });
              store.createIndex('title', 'title', { unique: false });
            }
            if (!db.objectStoreNames.contains(META_STORE)) {
              db.createObjectStore(META_STORE, { keyPath: 'key' });
            }
          };
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
          request.onblocked = () => reject(new Error('La base de données locale est bloquée par un autre onglet.'));
        });
        this.db.onversionchange = () => this.db.close();
      } catch (error) {
        console.warn('IndexedDB indisponible; utilisation de localStorage.', error);
        this.mode = 'localstorage';
      }
    }

    async requestPersistence() {
      if (!navigator.storage?.persist) return false;
      try { return await navigator.storage.persist(); } catch { return false; }
    }

    async isPersisted() {
      if (!navigator.storage?.persisted) return false;
      try { return await navigator.storage.persisted(); } catch { return false; }
    }

    async getEstimate() {
      if (!navigator.storage?.estimate) return null;
      try { return await navigator.storage.estimate(); } catch { return null; }
    }

    async list() {
      await this.ready;
      if (this.mode === 'localstorage') return this._fallbackList();
      return this._transaction(STORE, 'readonly', store => new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      }));
    }

    async get(id) {
      await this.ready;
      if (this.mode === 'localstorage') return this._fallbackList().find(item => item.id === id) || null;
      return this._transaction(STORE, 'readonly', store => this._request(store.get(id)));
    }

    async put(sketch) {
      await this.ready;
      const normalized = this.normalizeSketch(sketch);
      if (this.mode === 'localstorage') {
        const items = this._fallbackList();
        const index = items.findIndex(item => item.id === normalized.id);
        if (index >= 0) items[index] = normalized; else items.push(normalized);
        localStorage.setItem(FALLBACK_KEY, JSON.stringify(items));
        return normalized;
      }
      await this._transaction(STORE, 'readwrite', store => this._request(store.put(normalized)));
      return normalized;
    }

    async delete(id) {
      await this.ready;
      if (this.mode === 'localstorage') {
        localStorage.setItem(FALLBACK_KEY, JSON.stringify(this._fallbackList().filter(item => item.id !== id)));
        return;
      }
      await this._transaction(STORE, 'readwrite', store => this._request(store.delete(id)));
    }

    async clear() {
      await this.ready;
      if (this.mode === 'localstorage') {
        localStorage.removeItem(FALLBACK_KEY);
        return;
      }
      await this._transaction(STORE, 'readwrite', store => this._request(store.clear()));
    }

    saveDraft(draft) {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, savedAt: new Date().toISOString() })); return true; }
      catch (error) { console.warn('Brouillon non sauvegardé', error); return false; }
    }

    loadDraft() {
      try {
        const raw = localStorage.getItem(DRAFT_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch { return null; }
    }

    clearDraft() { localStorage.removeItem(DRAFT_KEY); }

    async exportBackup() {
      const sketches = await this.list();
      return {
        format: 'croquis-rampe-backup',
        schemaVersion: SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        source: 'local-device',
        sharePointReady: true,
        count: sketches.length,
        sketches
      };
    }

    async importBackup(payload) {
      if (!payload || payload.format !== 'croquis-rampe-backup' || !Array.isArray(payload.sketches)) {
        throw new Error('Ce fichier n’est pas une sauvegarde valide de Croquis de rampe.');
      }
      const report = { added: 0, updated: 0, skipped: 0 };
      for (const raw of payload.sketches) {
        if (!raw || !raw.id || !raw.title || !raw.data) { report.skipped += 1; continue; }
        const existing = await this.get(raw.id);
        const incoming = this.normalizeSketch(raw);
        if (!existing) {
          await this.put(incoming);
          report.added += 1;
        } else if (new Date(incoming.updatedAt).getTime() > new Date(existing.updatedAt).getTime()) {
          await this.put(incoming);
          report.updated += 1;
        } else {
          report.skipped += 1;
        }
      }
      return report;
    }

    normalizeSketch(raw) {
      const now = new Date().toISOString();
      return {
        schemaVersion: SCHEMA_VERSION,
        id: String(raw.id || this.makeId()),
        title: String(raw.title || 'Croquis sans nom').slice(0, 160),
        client: String(raw.client || raw.data?.form?.client || '').slice(0, 160),
        jobsite: String(raw.jobsite || raw.data?.form?.jobsite || '').slice(0, 200),
        section: String(raw.section || raw.data?.form?.section || '').slice(0, 160),
        projectDate: String(raw.projectDate || raw.data?.form?.projectDate || ''),
        thumbnail: typeof raw.thumbnail === 'string' ? raw.thumbnail : '',
        createdAt: raw.createdAt || now,
        updatedAt: raw.updatedAt || now,
        revision: Number.isFinite(raw.revision) ? raw.revision : 1,
        data: raw.data || { form: {}, measurements: [], drawing: { actions: [] } },
        sync: {
          state: raw.sync?.state || 'local-only',
          sharePointItemId: raw.sync?.sharePointItemId || null,
          lastSyncedAt: raw.sync?.lastSyncedAt || null,
          localRevision: Number.isFinite(raw.sync?.localRevision) ? raw.sync.localRevision : (Number(raw.revision) || 1)
        }
      };
    }

    makeId() {
      if (crypto?.randomUUID) return crypto.randomUUID();
      return `croquis-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    _transaction(storeName, mode, operation) {
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);
        let result;
        try { result = operation(store); } catch (error) { reject(error); return; }
        transaction.onerror = () => reject(transaction.error);
        Promise.resolve(result).then(resolve, reject);
      });
    }

    _request(request) {
      return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
      });
    }

    _fallbackList() {
      try { return JSON.parse(localStorage.getItem(FALLBACK_KEY) || '[]'); }
      catch { return []; }
    }
  }

  window.CroquisStorage = new LocalSketchStorage();
  window.CROQUIS_SCHEMA_VERSION = SCHEMA_VERSION;
})();
