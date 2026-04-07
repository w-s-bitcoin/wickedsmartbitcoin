(function () {
  function resolveDashboardElements(source, rootDocument) {
    if (!source) return [];

    if (typeof source === 'function') {
      return resolveDashboardElements(source(), rootDocument);
    }

    if (typeof source === 'string') {
      return Array.from((rootDocument || document).querySelectorAll(source));
    }

    if (source instanceof Element) {
      return [source];
    }

    if (Array.isArray(source) || (typeof source[Symbol.iterator] === 'function')) {
      return Array.from(source).flatMap((item) => resolveDashboardElements(item, rootDocument));
    }

    return [];
  }

  function createDashboardControlLock(options) {
    const config = options || {};
    const rootDocument = config.rootDocument || document;
    const selectors = String(
      config.selectors || 'button, select, textarea, input:not([type="hidden"])'
    );

    function collectControls() {
      const roots = resolveDashboardElements(config.controlRoots || config.topbar, rootDocument);
      const extras = resolveDashboardElements(config.extraControls, rootDocument);
      const seen = new Set();
      const controls = [];

      roots.forEach((root) => {
        if (!root || typeof root.querySelectorAll !== 'function') return;
        root.querySelectorAll(selectors).forEach((control) => {
          if (!control || seen.has(control)) return;
          seen.add(control);
          controls.push(control);
        });
      });

      extras.forEach((control) => {
        if (!control || seen.has(control)) return;
        seen.add(control);
        controls.push(control);
      });

      return controls;
    }

    function setEnabled(enabled) {
      const topbars = resolveDashboardElements(config.topbar, rootDocument);
      topbars.forEach((topbar) => {
        topbar.classList.toggle('ui-locked', !enabled);
      });

      collectControls().forEach((control) => {
        if ('disabled' in control) {
          control.disabled = !enabled;
        } else {
          control.setAttribute('aria-disabled', enabled ? 'false' : 'true');
        }
      });
    }

    return {
      setEnabled,
      getControls: collectControls,
    };
  }

  function computeModalControlsClearance() {
    const minClearance = 30;
    const extraGap = -4;
    let clearance = minClearance;

    try {
      const controls = window.parent?.document?.querySelector('.modal-controls');
      if (controls) {
        clearance = Math.max(minClearance, Math.ceil(controls.getBoundingClientRect().height + extraGap));
      }
    } catch (_) {
      clearance = minClearance;
    }

    return clearance;
  }

  function applyEmbeddedModalTopClearance() {
    try {
      if (window.self === window.top) return;

      const root = document.documentElement;
      const update = () => {
        const clearance = computeModalControlsClearance();
        root.classList.add('embedded-in-modal');
        document.body?.classList?.add('embedded-in-modal');
        root.style.setProperty('--modal-controls-clearance', `${clearance}px`);
      };

      update();
      window.addEventListener('resize', update);
      try {
        window.parent?.addEventListener?.('resize', update);
      } catch (_) {
      }
    } catch (_) {
    }
  }

  function forwardEmbeddedNavigationKeys() {
    try {
      if (window.self === window.top) return;

      document.addEventListener('keydown', (event) => {
        const key = event.key;
        const code = event.code;
        const isLeft = key === 'ArrowLeft';
        const isRight = key === 'ArrowRight';
        const isSpace = key === ' ' || key === 'Spacebar' || code === 'Space';
        if (!isLeft && !isRight && !isSpace) return;

        event.preventDefault();
        event.stopPropagation();
        window.parent?.postMessage({ type: 'wsb-dashboard-nav-key', key }, window.location.origin);
      }, true);
    } catch (_) {
    }
  }

  window.WSBDashboardShared = window.WSBDashboardShared || {};
  window.WSBDashboardShared.applyEmbeddedModalTopClearance = applyEmbeddedModalTopClearance;
  window.WSBDashboardShared.createDashboardControlLock = createDashboardControlLock;
  window.WSBDashboardShared.forwardEmbeddedNavigationKeys = forwardEmbeddedNavigationKeys;

  // Apply as early as possible to avoid top-padding jumps when embedded in modal.
  applyEmbeddedModalTopClearance();
  forwardEmbeddedNavigationKeys();
}());
