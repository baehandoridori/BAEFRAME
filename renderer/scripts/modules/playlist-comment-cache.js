// Display snapshots only. Never use this cache as the source of a file write.
export function createPlaylistCommentCache({ read, normalizePath, getVersion = null, now = () => Date.now() }) {
  const entries = new Map();
  let generation = 0;
  const api = {
    read(path) {
      const key = normalizePath(path);
      const existing = entries.get(key);
      if (existing) {
        entries.delete(key);
        entries.set(key, existing);
        return existing.promise;
      }
      const entry = { generation: ++generation, checkedAt: null, version: null };
      entry.promise = Promise.resolve().then(async () => {
        // Read the version before the body: a concurrent write is rechecked next time.
        if (getVersion) {
          try { entry.version = await getVersion(path); } catch { /* body read may still work */ }
        }
        return read(path);
      }).then(data => {
        entry.checkedAt = now();
        return data ? { comments: data.comments, fps: data.fps } : null;
      }, error => {
        if (entries.get(key) === entry) entries.delete(key);
        throw error;
      });
      entries.set(key, entry);
      while (entries.size > 200) entries.delete(entries.keys().next().value);
      return entry.promise;
    },
    isFresh(path, maxAge = 60000) {
      const entry = entries.get(normalizePath(path));
      return !!entry && (entry.checkedAt === null || now() - entry.checkedAt < maxAge);
    },
    revalidate(path) {
      const key = normalizePath(path);
      const entry = entries.get(key);
      if (!entry) return api.read(path).then(data => ({ changed: true, data }));
      if (entry.revalidation) return entry.revalidation;
      const work = (async () => {
        const data = await entry.promise;
        if (api.isFresh(path)) return { changed: false, data };
        try {
          const version = getVersion ? await getVersion(path) : null;
          if (entries.get(key) !== entry) return { changed: true, data: await api.read(path) };
          if (version !== null && version === entry.version) {
            entry.checkedAt = now();
            return { changed: false, data };
          }
          entries.delete(key);
          return { changed: true, data: await api.read(path) };
        } catch (error) {
          if (entries.get(key) === entry) entry.checkedAt = now();
          throw error;
        }
      })();
      entry.revalidation = work.finally(() => { entry.revalidation = null; });
      return entry.revalidation;
    },
    invalidate(path) { entries.delete(normalizePath(path)); },
    clear() { generation++; entries.clear(); }
  };
  return api;
}
