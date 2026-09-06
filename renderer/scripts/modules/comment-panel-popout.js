/**
 * 기존 댓글 DOM을 보호된 별도 창으로 옮긴다.
 * 댓글 데이터, 입력 초안, 저장/협업 세션과 이벤트 리스너는 계속 메인 화면이 소유한다.
 */
export function createCommentPanelPopout({
  panel, toggleButton, focusButton, windowRef = window,
  onChange, onReady, onError, loadTimeoutMs = 6000
}) {
  const document = windowRef.document;
  const originalParent = panel.parentNode;
  const anchor = document.createComment('comment-panel-position');
  originalParent.insertBefore(anchor, panel);
  const popupUrl = new URL('comment-panel.html', document.URL).href;
  let session = null;
  let detached = false;
  let disposed = false;

  const reportError = (error) => {
    try { onError?.(error); } catch { /* 호출 측 오류가 창 복원을 방해하지 않게 한다. */ }
  };
  const notifyChange = (value) => {
    try { onChange?.(value); } catch (error) { reportError(error); }
  };
  const updateControls = () => {
    const label = detached ? '댓글 다시 붙이기' : '댓글 창 분리';
    if (toggleButton) {
      toggleButton.title = label;
      toggleButton.setAttribute('aria-label', label);
      toggleButton.setAttribute('aria-pressed', String(detached));
      toggleButton.disabled = !!session?.pending;
    }
    if (focusButton) focusButton.hidden = !detached;
    document.body.classList.toggle('comments-detached', detached);
  };
  const isClosed = (child) => {
    try { return !child || child.closed; } catch { return true; }
  };
  const closeWindow = (child) => {
    if (isClosed(child)) return;
    try { child.close(); } catch (error) { reportError(error); }
  };

  // 브라우저가 adopt/focus 중 스크롤을 조정해도 작성 중인 위치를 보존한다.
  const captureView = () => {
    const owner = panel.ownerDocument;
    const active = panel.contains(owner.activeElement) ? owner.activeElement : null;
    const scroll = [panel, ...panel.querySelectorAll('*')]
      .filter(node => node.scrollTop || node.scrollLeft)
      .map(node => ({ node, top: node.scrollTop, left: node.scrollLeft }));
    const selection = [...panel.querySelectorAll('textarea, input')]
      .filter(node => typeof node.selectionStart === 'number')
      .map(node => ({ node, start: node.selectionStart, end: node.selectionEnd, direction: node.selectionDirection }));
    return { active, scroll, selection };
  };
  const restoreView = (view) => {
    view.active?.focus({ preventScroll: true });
    for (const { node, start, end, direction } of view.selection) node.setSelectionRange(start, end, direction);
    for (const { node, top, left } of view.scroll) {
      node.scrollTop = top;
      node.scrollLeft = left;
    }
  };

  const finish = (current, shouldClose = true) => {
    if (session !== current) return false;
    session = null; // beforeunload와 늦은 load가 같은 창을 다시 정리하지 못하게 먼저 끊는다.
    windowRef.clearTimeout(current.timeout);
    windowRef.clearTimeout(current.initialCheck);
    windowRef.clearInterval(current.watchdog);
    current.observer?.disconnect();
    current.child?.removeEventListener('load', current.checkReady);
    current.child?.removeEventListener('beforeunload', current.beforeUnload);
    if (current.cleanup) {
      try { current.cleanup(); } catch (error) { reportError(error); }
      current.cleanup = null;
    }
    if (panel.ownerDocument !== document || detached) {
      const view = captureView();
      const parent = anchor.parentNode || originalParent;
      parent.insertBefore(document.adoptNode(panel), anchor.parentNode ? anchor.nextSibling : null);
      restoreView(view);
    }
    detached = false;
    updateControls();
    if (current.notified) notifyChange(false);
    if (shouldClose) closeWindow(current.child);
    current.resolve(false);
    return true;
  };

  const focus = () => {
    const current = session;
    if (!current) return false;
    if (isClosed(current.child)) {
      finish(current, false);
      return false;
    }
    try { current.child.focus(); } catch (error) { reportError(error); return false; }
    return true;
  };

  const detach = () => {
    if (disposed) return Promise.resolve(false);
    if (session) {
      const current = session;
      if (focus()) return current.promise;
    }
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    const current = { promise, resolve, pending: true, child: null, notified: false };
    session = current;
    updateControls();
    const fail = (error) => {
      if (session !== current) return;
      finish(current);
      reportError(error);
    };
    try {
      current.child = windowRef.open(popupUrl, 'baeframe-comments', 'popup=yes,width=420,height=760');
      if (!current.child) throw new Error('댓글 창을 열지 못했습니다. 다시 시도해 주세요.');
    } catch (error) {
      fail(error);
      return promise;
    }

    const syncTheme = () => {
      if (session !== current || isClosed(current.child)) return;
      const root = current.child.document.documentElement;
      for (const attribute of ['class', 'style']) {
        const value = document.documentElement.getAttribute(attribute);
        if (value === null) root.removeAttribute(attribute);
        else root.setAttribute(attribute, value);
      }
    };
    current.beforeUnload = () => finish(current, false);
    current.checkReady = () => {
      if (session !== current || !current.pending) return;
      if (isClosed(current.child)) {
        fail(new Error('댓글 창이 열리기 전에 닫혔습니다.'));
        return;
      }
      try {
        const childDocument = current.child.document;
        // window.open 직후의 about:blank도 complete일 수 있으므로 목적 문서를 함께 검사한다.
        if (childDocument.URL !== popupUrl || childDocument.readyState === 'loading') return;
        const mount = childDocument.getElementById('commentPopoutMount');
        if (!mount) return;
        const view = captureView();
        mount.appendChild(childDocument.adoptNode(panel));
        detached = true;
        current.child.addEventListener('beforeunload', current.beforeUnload);
        childDocument.title = 'BAEFRAME 댓글';
        syncTheme();
        current.observer = new windowRef.MutationObserver(syncTheme);
        current.observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
        const cleanup = onReady?.(current.child);
        if (typeof cleanup === 'function') current.cleanup = cleanup;
        current.pending = false;
        windowRef.clearTimeout(current.timeout);
        updateControls();
        restoreView(view);
        current.notified = true;
        notifyChange(true);
        current.resolve(true);
        focus();
      } catch (error) {
        fail(error);
      }
    };
    current.child.addEventListener('load', current.checkReady);
    current.timeout = windowRef.setTimeout(() => {
      fail(new Error('댓글 창을 불러오지 못했습니다. 다시 시도해 주세요.'));
    }, Number.isFinite(loadTimeoutMs) && loadTimeoutMs > 0 ? loadTimeoutMs : 6000);
    current.watchdog = windowRef.setInterval(() => {
      if (session !== current) return;
      if (isClosed(current.child)) {
        if (current.pending) fail(new Error('댓글 창이 열리기 전에 닫혔습니다.'));
        else finish(current, false);
      } else if (current.pending) current.checkReady();
    }, 100);
    current.initialCheck = windowRef.setTimeout(current.checkReady, 0);
    return promise;
  };

  const dock = () => session ? finish(session) : false;
  const toggle = () => { if (session) dock(); else void detach(); };
  const beforeUnload = () => dock();
  toggleButton?.addEventListener('click', toggle);
  focusButton?.addEventListener('click', focus);
  windowRef.addEventListener('beforeunload', beforeUnload);
  updateControls();

  return {
    detach, dock, focus,
    isDetached: () => detached,
    dispose() {
      if (disposed) return;
      disposed = true;
      dock();
      toggleButton?.removeEventListener('click', toggle);
      focusButton?.removeEventListener('click', focus);
      windowRef.removeEventListener('beforeunload', beforeUnload);
      anchor.remove();
    }
  };
}
