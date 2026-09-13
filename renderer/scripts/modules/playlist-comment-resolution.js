export function createPlaylistResolutionQueue({ keyForPath }) {
  const pending = new Map();
  const tails = new Map();
  const locks = new Map();
  const failures = new Map();
  return {
    enqueue(intent, run) {
      const path = keyForPath(intent.videoPath);
      if (pending.has(intent.key)) return pending.get(intent.key).promise;
      if (locks.has(path)) return Promise.reject(new Error('저장 후 이동 중'));
      const previous = tails.get(path) || Promise.resolve();
      const record = { path, intent, promise: null };
      const promise = previous.catch(() => {}).then(() => run(intent)).then(result => {
        if (result === false) throw new Error('저장에 실패했습니다.');
        failures.delete(intent.key);
        return result;
      }).catch(error => {
        failures.set(intent.key, { path, error });
        throw error;
      }).finally(() => {
        if (pending.get(intent.key) === record) pending.delete(intent.key);
        if (tails.get(path) === promise) tails.delete(path);
      });
      record.promise = promise;
      pending.set(intent.key, record);
      tails.set(path, promise);
      return promise;
    },
    hasPending(key) { return pending.has(key); },
    isLocked(path) { return locks.has(keyForPath(path)); },
    lockPaths(paths) {
      const keys = [...new Set(paths.filter(Boolean).map(keyForPath))];
      keys.forEach(key => locks.set(key, (locks.get(key) || 0) + 1));
      let released = false;
      return () => {
        if (released) return;
        released = true;
        keys.forEach(key => {
          const count = locks.get(key) - 1;
          if (count > 0) locks.set(key, count); else locks.delete(key);
        });
      };
    },
    async drainPaths(paths) {
      const keys = new Set(paths.filter(Boolean).map(keyForPath));
      await Promise.all([...pending.values()].filter(record => keys.has(record.path)).map(record => record.promise));
      for (const failure of failures.values()) if (keys.has(failure.path)) throw failure.error;
    }
  };
}
