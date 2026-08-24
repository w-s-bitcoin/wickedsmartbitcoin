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

  const PRESENTATION_MODE_PARAMS = ['presentation', 'presentationMode', 'present', 'kiosk'];
  const PRESENTATION_MODE_TRUE_VALUES = new Set(['', '1', 'true', 'yes', 'on']);

  function searchParamsEnablePresentation(search) {
    const params = new URLSearchParams(String(search || ''));
    return PRESENTATION_MODE_PARAMS.some((name) => {
      if (!params.has(name)) return false;
      const value = String(params.get(name) || '').trim().toLowerCase();
      return PRESENTATION_MODE_TRUE_VALUES.has(value);
    });
  }

  function isDashboardPresentationModeEnabled() {
    if (searchParamsEnablePresentation(window.location.search)) return true;

    try {
      if (window.parent && window.parent !== window) {
        return searchParamsEnablePresentation(window.parent.location.search);
      }
    } catch (_) {
    }

    return false;
  }

  function setDashboardPresentationModeClasses(active) {
    document.documentElement.classList.toggle('dashboard-presentation-mode', active);
    document.documentElement.classList.toggle('presentation-mode', active);
    document.body?.classList?.toggle('dashboard-presentation-mode', active);
    document.body?.classList?.toggle('presentation-mode', active);
  }

  function ensureDashboardPresentationModeStyles() {
    if (document.getElementById('wsb-dashboard-presentation-mode-style')) return;
    const style = document.createElement('style');
    style.id = 'wsb-dashboard-presentation-mode-style';
    style.textContent = [
      'html.presentation-mode body .copy-link-btn.copy-link-btn,',
      'html.presentation-mode body .reset-dashboard-btn.reset-dashboard-btn,',
      'html.presentation-mode body #copyDashboardLink,',
      'html.presentation-mode body #resetDashboard,',
      'html.presentation-mode body #restoreBtn,',
      'html.dashboard-presentation-mode body .copy-link-btn.copy-link-btn,',
      'html.dashboard-presentation-mode body .reset-dashboard-btn.reset-dashboard-btn,',
      'html.dashboard-presentation-mode body #copyDashboardLink,',
      'html.dashboard-presentation-mode body #resetDashboard,',
      'html.dashboard-presentation-mode body #restoreBtn {',
      '  display: none !important;',
      '  visibility: hidden !important;',
      '  pointer-events: none !important;',
      '}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(style);
  }

  function applyDashboardPresentationModeControls() {
    ensureDashboardPresentationModeStyles();
    const active = isDashboardPresentationModeEnabled();
    setDashboardPresentationModeClasses(active);

    const controls = document.querySelectorAll([
      '#copyDashboardLink',
      '#resetDashboard',
      '#restoreBtn',
      '.copy-link-btn',
      '.reset-dashboard-btn'
    ].join(', '));

    controls.forEach((control) => {
      if (!(control instanceof HTMLElement)) return;
      control.hidden = active;
      control.setAttribute('aria-hidden', active ? 'true' : 'false');
      if (active) {
        if (!control.dataset.presentationPreviousTabindex) {
          control.dataset.presentationPreviousTabindex = control.hasAttribute('tabindex')
            ? control.getAttribute('tabindex')
            : '__unset__';
        }
        control.setAttribute('tabindex', '-1');
      } else {
        const previousTabindex = control.dataset.presentationPreviousTabindex;
        if (previousTabindex === '__unset__') {
          control.removeAttribute('tabindex');
        } else if (previousTabindex) {
          control.setAttribute('tabindex', previousTabindex);
        }
        delete control.dataset.presentationPreviousTabindex;
      }
    });
  }

  function watchDashboardPresentationModeControls() {
    const apply = () => applyDashboardPresentationModeControls();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', apply, { once: true });
    } else {
      apply();
    }

    window.addEventListener('load', apply, { once: true });
    setTimeout(apply, 0);
    setTimeout(apply, 250);
  }

  function computeModalControlsClearance() {
    if (isDashboardPresentationModeEnabled()) return 0;

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
      setDashboardPresentationModeClasses(isDashboardPresentationModeEnabled());
      if (window.self === window.top) return;

      const root = document.documentElement;
      const update = () => {
        const presentationMode = isDashboardPresentationModeEnabled();
        const clearance = presentationMode ? 0 : computeModalControlsClearance();
        setDashboardPresentationModeClasses(presentationMode);
        root.classList.add('embedded-in-modal');
        document.body?.classList?.add('embedded-in-modal');
        root.style.setProperty('--modal-controls-clearance', `${clearance}px`);
        root.style.overscrollBehaviorX = 'contain';
        root.style.touchAction = 'pan-y';
        if (document.body) {
          document.body.style.overscrollBehaviorX = 'contain';
          document.body.style.touchAction = 'pan-y';
        }
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

  function forwardEmbeddedSwipeGestures() {
    try {
      if (window.self === window.top) return;

      let swipeStartX = 0;
      let swipeStartY = 0;
      let swipePointerId = null;
      let swipeTracking = false;
      let swipeBlocked = false;
      let lastPostedSwipeAt = 0;

      const isInputTarget = (target) => {
        if (!(target instanceof Element)) return false;
        return !!target.closest('input, textarea, select, option, [contenteditable="true"], [contenteditable=""], [contenteditable]');
      };

      const isDragSurface = (target) => {
        if (!(target instanceof Element)) return false;
        return !!target.closest(
          [
            '[data-no-dashboard-swipe]',
            '.date-range-slider-wrap',
            '.date-range-slider-track',
            '.date-range-start-marker',
            '.date-range-end-marker',
            '.date-range-current-marker',
            '.range-slider',
            '.slider',
            '.chart-canvas',
            'canvas'
          ].join(', ')
        );
      };

      const isHorizontalSwipe = (deltaX, deltaY, threshold = 12) => (
        Math.abs(deltaX) > threshold && Math.abs(deltaX) > Math.abs(deltaY)
      );

      const isEdgeSwipeStart = (clientX) => clientX <= 28 || clientX >= window.innerWidth - 28;
      const shouldBlockSwipe = (target, clientX) => (
        isInputTarget(target) || (!isEdgeSwipeStart(clientX) && isDragSurface(target))
      );

      const postSwipe = (deltaX) => {
        const now = Date.now();
        if (now - lastPostedSwipeAt < 250) return;
        lastPostedSwipeAt = now;
        window.parent?.postMessage({
          type: 'wsb-dashboard-swipe',
          direction: deltaX < 0 ? 'next' : 'prev',
        }, window.location.origin);
      };

      document.addEventListener('touchstart', (event) => {
        const touch = event.changedTouches?.[0] || event.touches?.[0];
        if (!touch) return;
        swipeStartX = touch.clientX;
        swipeStartY = touch.clientY;
        swipeTracking = true;
        swipeBlocked = shouldBlockSwipe(event.target, swipeStartX);

        // Suppress browser history edge-swipe early while preserving form controls
        // and intentional chart/range drags.
        if (!swipeBlocked && isEdgeSwipeStart(swipeStartX)) {
          event.preventDefault();
        }
      }, { passive: false, capture: true });

      document.addEventListener('touchmove', (event) => {
        if (!swipeTracking || swipeBlocked) return;
        const touch = event.changedTouches?.[0] || event.touches?.[0];
        if (!touch) return;
        const deltaX = touch.clientX - swipeStartX;
        const deltaY = touch.clientY - swipeStartY;
        if (isHorizontalSwipe(deltaX, deltaY)) event.preventDefault();
      }, { passive: false, capture: true });

      document.addEventListener('touchend', (event) => {
        if (!swipeTracking || swipeBlocked) {
          swipeTracking = false;
          swipeBlocked = false;
          return;
        }
        const touch = event.changedTouches?.[0];
        if (!touch) return;
        const deltaX = touch.clientX - swipeStartX;
        const deltaY = touch.clientY - swipeStartY;
        swipeTracking = false;
        swipeBlocked = false;
        if (!isHorizontalSwipe(deltaX, deltaY, 50)) return;
        event.preventDefault();
        event.stopPropagation();
        postSwipe(deltaX);
      }, { passive: false, capture: true });

      document.addEventListener('touchcancel', () => {
        swipeTracking = false;
        swipeBlocked = false;
      }, { passive: true, capture: true });

      document.addEventListener('pointerdown', (event) => {
        if (event.pointerType !== 'touch') return;
        swipePointerId = event.pointerId;
        swipeStartX = event.clientX;
        swipeStartY = event.clientY;
        swipeTracking = true;
        swipeBlocked = shouldBlockSwipe(event.target, swipeStartX);
      }, { passive: true, capture: true });

      document.addEventListener('pointermove', (event) => {
        if (event.pointerType !== 'touch' || event.pointerId !== swipePointerId || !swipeTracking || swipeBlocked) return;
        const deltaX = event.clientX - swipeStartX;
        const deltaY = event.clientY - swipeStartY;
        if (isHorizontalSwipe(deltaX, deltaY)) event.preventDefault();
      }, { passive: false, capture: true });

      document.addEventListener('pointerup', (event) => {
        if (event.pointerType !== 'touch' || event.pointerId !== swipePointerId) return;
        const deltaX = event.clientX - swipeStartX;
        const deltaY = event.clientY - swipeStartY;
        const blocked = swipeBlocked;
        swipePointerId = null;
        swipeTracking = false;
        swipeBlocked = false;
        if (blocked || !isHorizontalSwipe(deltaX, deltaY, 50)) return;
        event.preventDefault();
        event.stopPropagation();
        postSwipe(deltaX);
      }, { passive: false, capture: true });

      document.addEventListener('pointercancel', (event) => {
        if (event.pointerType !== 'touch' || event.pointerId !== swipePointerId) return;
        swipePointerId = null;
        swipeTracking = false;
        swipeBlocked = false;
      }, { passive: true, capture: true });
    } catch (_) {
    }
  }

  function forwardEmbeddedModalNavigationShortcuts() {
    try {
      if (window.self === window.top) return;

      const parentWindow = window.parent;
      const parentDocument = parentWindow?.document;
      const modalEmbed = parentDocument?.getElementById('modal-embed');
      if (!parentDocument || modalEmbed?.contentWindow !== window) return;

      const parentHandlerKey = '__wsbModalNavigationShortcutHandler';

      const shortcutAction = (event) => {
        if (!event?.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return null;
        if (event.code === 'Comma' || event.key === '<') return 'prev';
        if (event.code === 'Period' || event.key === '>') return 'next';
        if (event.code === 'Space' || event.key === ' ' || event.key === 'Spacebar') return 'home';
        const key = String(event.key || '').toLowerCase();
        if (event.code === 'KeyS' || key === 's') return 'favorite';
        if (event.code === 'KeyX' || key === 'x') return 'x';
        if (event.code === 'KeyY' || key === 'y') return 'youtube';
        return null;
      };

      const isTextEntryTarget = (target) => {
        if (!target || typeof target.closest !== 'function') return false;
        return !!target.closest([
          'input',
          'textarea',
          'select',
          'option',
          '[contenteditable="true"]',
          '[contenteditable=""]',
          '[contenteditable]',
          '[role="textbox"]'
        ].join(', '));
      };

      const isVisible = (element, ownerWindow) => {
        if (!(element instanceof ownerWindow.Element) || element.hidden) return false;
        const style = ownerWindow.getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden';
      };

      const isActiveModalEmbed = () => {
        const currentEmbed = parentDocument.getElementById('modal-embed');
        const modal = parentDocument.getElementById('modal');
        return currentEmbed?.contentWindow === window && isVisible(modal, parentWindow);
      };

      const hasBlockingParentOverlay = () => {
        const youtubeOverlay = parentDocument.getElementById('youtube-overlay');
        if (youtubeOverlay && !youtubeOverlay.classList.contains('hidden') && isVisible(youtubeOverlay, parentWindow)) {
          return true;
        }

        const thanksOverlay = parentDocument.getElementById('thanks-overlay');
        if (thanksOverlay && isVisible(thanksOverlay, parentWindow)) return true;

        const buyCoffeeOverlay = parentDocument.getElementById('buyCoffeeOverlay');
        return !!(
          buyCoffeeOverlay
          && buyCoffeeOverlay.getAttribute('aria-hidden') === 'false'
          && isVisible(buyCoffeeOverlay, parentWindow)
        );
      };

      const navigationIsLocked = () => !!(
        window.wsbDashboardExportActive
        || window.dateRangeExportActive
        || parentWindow.wsbDashboardExportActive
        || parentWindow.dateRangeExportActive
      );

      const availableModalLink = (id, dataAttribute) => {
        const link = parentDocument.getElementById(id);
        if (!link || !isVisible(link, parentWindow)) return null;
        if (link.classList.contains('disabled') || link.getAttribute('aria-disabled') === 'true') return null;
        const href = String(
          (dataAttribute ? link.dataset?.[dataAttribute] : '')
          || link.getAttribute('href')
          || ''
        ).trim();
        if (!href || href === '#') return null;
        try {
          const url = new URL(href, parentWindow.location.href);
          if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
        } catch (_) {
          return null;
        }
        return link;
      };

      const resolveActionTarget = (action) => {
        if (action === 'favorite') {
          return typeof parentWindow.toggleFavoriteFromModal === 'function'
            ? parentWindow.toggleFavoriteFromModal
            : null;
        }
        if (action === 'x') return availableModalLink('x-link');
        if (action === 'youtube') return availableModalLink('youtube-link', 'youtube');
        if (action === 'home') return typeof parentWindow.closeModal === 'function' ? parentWindow.closeModal : null;
        return action === 'prev' || action === 'next' ? action : null;
      };

      const handleShortcut = (event) => {
        const action = shortcutAction(event);
        if (!action || !isActiveModalEmbed()) return;
        if (isTextEntryTarget(event.target) || hasBlockingParentOverlay() || navigationIsLocked()) return;
        const actionTarget = resolveActionTarget(action);
        if (!actionTarget) return;

        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();

        if (event.repeat && (action === 'favorite' || action === 'x' || action === 'youtube')) return;

        if (action === 'home') {
          actionTarget({ allowDuringPlayback: true, source: 'keyboard' });
          return;
        }

        if (action === 'favorite') {
          actionTarget();
          return;
        }

        if (action === 'x' || action === 'youtube') {
          actionTarget.click();
          return;
        }

        parentWindow.postMessage({
          type: 'wsb-dashboard-swipe',
          direction: action,
          source: 'keyboard',
        }, window.location.origin);
      };

      document.addEventListener('keydown', handleShortcut, true);

      const previousParentHandler = parentDocument[parentHandlerKey];
      if (typeof previousParentHandler === 'function') {
        parentDocument.removeEventListener('keydown', previousParentHandler, true);
      }
      parentDocument[parentHandlerKey] = handleShortcut;
      parentDocument.addEventListener('keydown', handleShortcut, true);

      const cleanup = () => {
        document.removeEventListener('keydown', handleShortcut, true);
        if (parentDocument[parentHandlerKey] === handleShortcut) {
          parentDocument.removeEventListener('keydown', handleShortcut, true);
          delete parentDocument[parentHandlerKey];
        }
      };
      window.addEventListener('pagehide', cleanup, { once: true });
    } catch (_) {
    }
  }

  function updateInfoPopoverPosition(popover) {
    if (!(popover instanceof Element)) return;

    popover.style.setProperty('--info-popover-shift-x', '0px');

    const margin = 12;
    const rect = popover.getBoundingClientRect();
    let shift = 0;

    if (rect.left < margin) {
      shift = margin - rect.left;
    } else if (rect.right > window.innerWidth - margin) {
      shift = window.innerWidth - margin - rect.right;
    }

    popover.style.setProperty('--info-popover-shift-x', `${Math.round(shift)}px`);
  }

  function setupInfoPopoverPlacement() {
    const updateFromTarget = (target) => {
      const wrap = target?.closest?.('.info-wrap');
      const popover = wrap?.querySelector?.('.info-popover');
      if (!popover) return;
      requestAnimationFrame(() => updateInfoPopoverPosition(popover));
    };

    document.addEventListener('pointerenter', (event) => updateFromTarget(event.target), true);
    document.addEventListener('focusin', (event) => updateFromTarget(event.target), true);
    window.addEventListener('resize', () => {
      document.querySelectorAll('.info-popover').forEach(updateInfoPopoverPosition);
    });
  }


  window.WSBDashboardShared = window.WSBDashboardShared || {};
  window.WSBDashboardShared.applyEmbeddedModalTopClearance = applyEmbeddedModalTopClearance;
  window.WSBDashboardShared.createDashboardControlLock = createDashboardControlLock;
  window.WSBDashboardShared.forwardEmbeddedModalNavigationShortcuts = forwardEmbeddedModalNavigationShortcuts;
  window.WSBDashboardShared.forwardEmbeddedSwipeGestures = forwardEmbeddedSwipeGestures;
  window.WSBDashboardShared.updateInfoPopoverPosition = updateInfoPopoverPosition;
  window.WSBDashboardShared.setupInfoPopoverPlacement = setupInfoPopoverPlacement;
  window.WSBDashboardShared.isPresentationModeEnabled = isDashboardPresentationModeEnabled;
  window.WSBDashboardShared.applyPresentationModeControls = applyDashboardPresentationModeControls;

  // Apply as early as possible to avoid top-padding jumps when embedded in modal.
  ensureDashboardPresentationModeStyles();
  applyEmbeddedModalTopClearance();
  watchDashboardPresentationModeControls();
  forwardEmbeddedModalNavigationShortcuts();
  forwardEmbeddedSwipeGestures();
  setupInfoPopoverPlacement();
}());
