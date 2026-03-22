(function () {
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

  window.WSBDashboardShared = window.WSBDashboardShared || {};
  window.WSBDashboardShared.applyEmbeddedModalTopClearance = applyEmbeddedModalTopClearance;

  // Apply as early as possible to avoid top-padding jumps when embedded in modal.
  applyEmbeddedModalTopClearance();
}());
