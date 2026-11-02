/**
 * Tiny in-memory TTL cache for rarely-changing reference data
 * (branches, teams, shifts, designations). Process-local only.
 */

function createTtlCache({ defaultTtlMs = 120_000 } = {}) {
  const store = new Map();

  function get(key) {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  function set(key, value, ttlMs = defaultTtlMs) {
    store.set(key, { value, expiresAt: Date.now() + Math.max(0, ttlMs) });
    return value;
  }

  function invalidate(prefixOrKey) {
    if (prefixOrKey == null) {
      store.clear();
      return;
    }
    const needle = String(prefixOrKey);
    for (const key of store.keys()) {
      if (key === needle || key.startsWith(`${needle}:`)) {
        store.delete(key);
      }
    }
  }

  async function getOrSet(key, loader, ttlMs = defaultTtlMs) {
    const hit = get(key);
    if (hit !== undefined) return hit;
    const value = await loader();
    return set(key, value, ttlMs);
  }

  return { get, set, invalidate, getOrSet };
}

/** Shared singleton for catalog/reference endpoints. */
const refDataCache = createTtlCache({ defaultTtlMs: 120_000 });

module.exports = { createTtlCache, refDataCache };
