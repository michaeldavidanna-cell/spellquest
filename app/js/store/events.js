// Tiny event bus shared by core modules and screens.
const handlers = new Map();

export const events = {
  on(name, fn) {
    if (!handlers.has(name)) handlers.set(name, new Set());
    handlers.get(name).add(fn);
    return () => handlers.get(name)?.delete(fn);
  },
  emit(name, detail = {}) {
    for (const fn of handlers.get(name) ?? []) {
      try { fn(detail); } catch (err) { console.error(`[events] ${name} handler failed`, err); }
    }
  },
};
