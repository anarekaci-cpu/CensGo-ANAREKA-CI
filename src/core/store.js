// === Store centralisé (pattern Observer) ===
class Store {
  constructor() {
    this.state = {
      user: null,
      points: [],
      filters: {
        block: "all",
        status: "all",
        visited: "all",
        search: ""
      },
      geo: {
        position: null,
        heading: 0,
        accuracy: null,
        tracking: false
      },
      navigation: {
        active: false,
        destination: null,
        route: null,
        instruction: "",
        arrived: false
      },
      tour: {
        active: false,
        points: [],
        currentIndex: 0
      },
      sync: {
        status: "idle", // idle | syncing | error | offline
        lastSync: null,
        pendingCount: 0,
        deadCount: 0,
        pendingPointIds: []
      },
      ui: {
        loading: true,
        error: null,
        controlsOpen: false,
        selectedPointId: null
      }
    };
    this.listeners = new Map();
    this.batch = new Set();
    this.frame = null;
  }

  get(key) {
    if (!key) return { ...this.state };
    const keys = key.split(".");
    let target = this.state;
    for (const k of keys) {
      if (target == null) return undefined;
      target = target[k];
    }
    return target;
  }

  set(path, value) {
    const keys = path.split(".");
    let target = this.state;
    for (let i = 0; i < keys.length - 1; i++) {
      target = target[keys[i]];
    }
    const oldValue = target[keys[keys.length - 1]];
    target[keys[keys.length - 1]] = value;

    if (oldValue !== value) {
      this._notify(path, value, oldValue);
    }
  }

  update(path, updater) {
    const current = this.get(path);
    const next = typeof updater === "function" ? updater(current) : { ...current, ...updater };
    this.set(path, next);
  }

  subscribe(path, callback) {
    if (!this.listeners.has(path)) {
      this.listeners.set(path, new Set());
    }
    this.listeners.get(path).add(callback);
    return () => this.listeners.get(path).delete(callback);
  }

  _notify(path, value, oldValue) {
    this.batch.add({ path, value, oldValue });
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      this.batch.forEach(({ path, value, oldValue }) => {
        // Notifier les listeners exacts
        const exact = this.listeners.get(path);
        if (exact) exact.forEach(cb => cb(value, oldValue));

        // Notifier les listeners wildcard (e.g. "sync.*")
        const parent = path.split(".").slice(0, -1).join(".");
        if (parent) {
          const parentListeners = this.listeners.get(parent + ".*");
          if (parentListeners) parentListeners.forEach(cb => cb(this.get(parent), null));
        }
      });
      this.batch.clear();
    });
  }
}

export const store = new Store();
