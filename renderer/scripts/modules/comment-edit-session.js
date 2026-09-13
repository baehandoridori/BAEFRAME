export function createCommentEditSession() {
  let editing = null;
  let refresh = null;
  return {
    begin({ key, element }) { editing = { key, element }; },
    isEditing() { return editing !== null; },
    getElement() { return editing?.element || null; },
    getKey() { return editing?.key || null; },
    deferRefresh(fn) {
      if (!editing) { fn(); return false; }
      refresh = fn;
      return true;
    },
    end({ flush = true, preserveRefresh = false } = {}) {
      editing = null;
      const pending = refresh;
      if (flush || !preserveRefresh) refresh = null;
      if (flush) pending?.();
    }
  };
}
