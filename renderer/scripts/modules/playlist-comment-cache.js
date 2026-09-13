// Display snapshots only. Never use this cache as the source of a file write.
export function createPlaylistCommentCache({ read, normalizePath }) {
  const entries = new Map();
  let generation = 0;
  return {
    read(path) {
      const key = normalizePath(path);
      const existing = entries.get(key);
      if (existing) {
        entries.delete(key);
        entries.set(key, existing);
        return existing.promise;
      }
      const entry = { generation: ++generation, readAt: 0 };
      entry.promise = Promise.resolve().then(() => read(path)).then(data => {
        entry.readAt = Date.now();
        return data ? { comments: data.comments, fps: data.fps } : null;
      }, error => {
        if (entries.get(key) === entry) entries.delete(key);
        throw error;
      });
      entries.set(key, entry);
      while (entries.size > 200) entries.delete(entries.keys().next().value);
      return entry.promise;
    },
    isFresh(path, maxAge = 5000) {
      const entry = entries.get(normalizePath(path));
      return !!entry && (!entry.readAt || Date.now() - entry.readAt < maxAge);
    },
    invalidate(path) { entries.delete(normalizePath(path)); },
    clear() { generation++; entries.clear(); }
  };
}
