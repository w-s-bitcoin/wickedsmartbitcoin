(function () {
  const ns = window.WSBDashboardComponents = window.WSBDashboardComponents || {};

  function parseIsoDate(iso) {
    if (!iso) return null;
    const parts = String(iso).split("-").map(Number);
    if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) return null;
    const dt = new Date(parts[0], parts[1] - 1, parts[2]);
    dt.setHours(0, 0, 0, 0);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  function createDatePicker(opts = {}) {
    let popup = null;
    let pickerYear;
    let pickerMonth;
    let pickerView = "days";
    let pickerExpandedYear = null;
    const align = opts.align === "right" ? "right" : "left";

    function getSelected() {
      return typeof opts.getSelected === "function" ? String(opts.getSelected() || "") : "";
    }

    function getMin() {
      return typeof opts.getMin === "function" ? String(opts.getMin() || "") : "";
    }

    function getMax() {
      return typeof opts.getMax === "function" ? String(opts.getMax() || "") : "";
    }

    function buildCalendar() {
      const selectedIso = getSelected();
      const minDate = parseIsoDate(getMin());
      const maxDate = parseIsoDate(getMax());
      const year = pickerYear;
      const month = pickerMonth;
      const monthLabel = new Date(year, month, 1).toLocaleString("default", { month: "long", year: "numeric" });

      const wrap = document.createElement("div");
      wrap.className = "date-picker-popup";

      const header = document.createElement("div");
      header.className = "date-picker-header";
      const prev = document.createElement("button");
      prev.className = "date-picker-nav";
      prev.textContent = "\u2039";
      prev.type = "button";
      prev.addEventListener("click", (event) => {
        event.stopPropagation();
        pickerMonth -= 1;
        if (pickerMonth < 0) {
          pickerMonth = 11;
          pickerYear -= 1;
        }
        rebuildCalendar();
      });
      const next = document.createElement("button");
      next.className = "date-picker-nav";
      next.textContent = "\u203a";
      next.type = "button";
      next.addEventListener("click", (event) => {
        event.stopPropagation();
        pickerMonth += 1;
        if (pickerMonth > 11) {
          pickerMonth = 0;
          pickerYear += 1;
        }
        rebuildCalendar();
      });
      const label = document.createElement("span");
      label.textContent = monthLabel;
      label.className = "date-picker-header-label";
      label.title = "Select year / month";
      label.addEventListener("click", (event) => {
        event.stopPropagation();
        pickerView = "years";
        pickerExpandedYear = null;
        rebuildCalendar();
      });
      header.append(prev, label, next);
      wrap.appendChild(header);

      const grid = document.createElement("div");
      grid.className = "date-picker-grid";
      ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].forEach((day) => {
        const dow = document.createElement("div");
        dow.className = "date-picker-dow";
        dow.textContent = day;
        grid.appendChild(dow);
      });

      const firstDay = new Date(year, month, 1).getDay();
      for (let i = 0; i < firstDay; i += 1) {
        const blank = document.createElement("div");
        blank.className = "date-picker-day dp-empty";
        grid.appendChild(blank);
      }

      const daysInMonth = new Date(year, month + 1, 0).getDate();
      for (let day = 1; day <= daysInMonth; day += 1) {
        const date = new Date(year, month, day);
        date.setHours(0, 0, 0, 0);
        const isoVal = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const outOfRange = (minDate && date < minDate) || (maxDate && date > maxDate);
        const extraDisabled = typeof opts.isDisabled === "function" ? opts.isDisabled(isoVal) : false;
        const cell = document.createElement("div");
        cell.className = "date-picker-day";
        cell.textContent = String(day);
        if (isoVal === selectedIso) cell.classList.add("dp-selected");
        if (outOfRange || extraDisabled) {
          cell.classList.add("dp-disabled");
        } else {
          cell.addEventListener("click", (event) => {
            event.stopPropagation();
            closePopup();
            if (typeof opts.onSelect === "function") opts.onSelect(isoVal);
          });
        }
        grid.appendChild(cell);
      }

      wrap.appendChild(grid);
      return wrap;
    }

    function buildYearGrid() {
      const minDate = parseIsoDate(getMin());
      const maxDate = parseIsoDate(getMax());
      const minYear = minDate ? minDate.getFullYear() : pickerYear - 10;
      const maxYear = maxDate ? maxDate.getFullYear() : pickerYear + 5;
      const wrap = document.createElement("div");
      wrap.className = "date-picker-popup dp-year-grid-popup";

      const header = document.createElement("div");
      header.className = "date-picker-header";
      const backBtn = document.createElement("button");
      backBtn.className = "date-picker-nav";
      backBtn.textContent = "\u2039";
      backBtn.type = "button";
      backBtn.title = "Back to calendar";
      backBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        pickerView = "days";
        rebuildCalendar();
      });
      const label = document.createElement("span");
      label.className = "date-picker-header-label";
      label.textContent = "Select Year";
      header.append(backBtn, label);
      wrap.appendChild(header);

      const grid = document.createElement("div");
      grid.className = "dp-year-grid";
      for (let year = minYear; year <= maxYear; year += 1) {
        const cell = document.createElement("div");
        cell.className = "dp-year-cell";
        if (year === pickerYear) cell.classList.add("dp-year-current");
        const yearLabel = document.createElement("span");
        yearLabel.textContent = String(year);
        const chevron = document.createElement("span");
        chevron.className = "dp-accordion-chevron";
        chevron.textContent = "\u203a";
        cell.append(yearLabel, chevron);
        cell.addEventListener("click", (event) => {
          event.stopPropagation();
          pickerView = "year";
          pickerExpandedYear = year;
          rebuildCalendar();
        });
        grid.appendChild(cell);
      }
      wrap.appendChild(grid);
      return wrap;
    }

    function buildYearAccordion() {
      const minDate = parseIsoDate(getMin());
      const maxDate = parseIsoDate(getMax());
      const minYear = minDate ? minDate.getFullYear() : pickerYear - 10;
      const maxYear = maxDate ? maxDate.getFullYear() : pickerYear + 5;
      const expandedYear = pickerExpandedYear !== null ? pickerExpandedYear : pickerYear;
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const wrap = document.createElement("div");
      wrap.className = "date-picker-popup dp-year-grid-popup";

      const header = document.createElement("div");
      header.className = "date-picker-header";
      const backBtn = document.createElement("button");
      backBtn.className = "date-picker-nav";
      backBtn.textContent = "\u2039";
      backBtn.type = "button";
      backBtn.title = "Back to year list";
      backBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        pickerView = "years";
        pickerExpandedYear = null;
        rebuildCalendar();
      });
      const label = document.createElement("span");
      label.className = "date-picker-header-label";
      label.textContent = "Select Month";
      header.append(backBtn, label);
      wrap.appendChild(header);

      const list = document.createElement("div");
      list.className = "dp-accordion-list";
      for (let year = minYear; year <= maxYear; year += 1) {
        const row = document.createElement("div");
        row.className = `dp-accordion-year${year === expandedYear ? " dp-accordion-open" : ""}`;
        const yearBtn = document.createElement("button");
        yearBtn.type = "button";
        yearBtn.className = "dp-accordion-year-btn";
        yearBtn.textContent = String(year);
        const chevron = document.createElement("span");
        chevron.className = "dp-accordion-chevron";
        chevron.textContent = "\u203a";
        yearBtn.appendChild(chevron);
        yearBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          pickerExpandedYear = pickerExpandedYear === year ? null : year;
          rebuildCalendar();
        });
        row.appendChild(yearBtn);

        if (year === expandedYear) {
          const monthGrid = document.createElement("div");
          monthGrid.className = "dp-month-grid";
          monthNames.forEach((name, monthIndex) => {
            const minMonth = minDate && year === minDate.getFullYear() ? minDate.getMonth() : -1;
            const maxMonth = maxDate && year === maxDate.getFullYear() ? maxDate.getMonth() : 12;
            const disabled = monthIndex < minMonth || monthIndex > maxMonth;
            const cell = document.createElement("div");
            cell.className = `dp-month-cell${disabled ? " dp-disabled" : ""}`;
            if (year === pickerYear && monthIndex === pickerMonth) cell.classList.add("dp-month-current");
            cell.textContent = name;
            if (!disabled) {
              cell.addEventListener("click", (event) => {
                event.stopPropagation();
                pickerYear = year;
                pickerMonth = monthIndex;
                pickerView = "days";
                pickerExpandedYear = null;
                rebuildCalendar();
              });
            }
            monthGrid.appendChild(cell);
          });
          row.appendChild(monthGrid);
        }
        list.appendChild(row);
      }
      wrap.appendChild(list);
      return wrap;
    }

    function positionPopup() {
      if (!popup || !opts.anchorEl) return;
      const rect = opts.anchorEl.getBoundingClientRect();
      popup.style.top = `${rect.bottom + 6}px`;
      const idealLeft = align === "left" ? rect.left : rect.right - popup.offsetWidth;
      const maxLeft = Math.max(4, window.innerWidth - popup.offsetWidth - 4);
      popup.style.left = `${Math.min(Math.max(4, idealLeft), maxLeft)}px`;
    }

    function rebuildCalendar() {
      if (!popup) return;
      const fresh = pickerView === "years" ? buildYearGrid() : pickerView === "year" ? buildYearAccordion() : buildCalendar();
      popup.replaceChildren(...fresh.childNodes);
      popup.className = fresh.className;
      requestAnimationFrame(() => {
        positionPopup();
        if (pickerView === "years") {
          const grid = popup.querySelector(".dp-year-grid");
          const selectedYear = popup.querySelector(".dp-year-current");
          if (grid && selectedYear) {
            grid.scrollTop = Math.max(0, selectedYear.offsetTop + selectedYear.offsetHeight - grid.clientHeight);
          }
        } else if (pickerView === "year") {
          const list = popup.querySelector(".dp-accordion-list");
          const openRow = popup.querySelector(".dp-accordion-year.dp-accordion-open");
          if (list && openRow) {
            const yearButton = openRow.querySelector(".dp-accordion-year-btn");
            const desiredTop = Math.max(0, (yearButton || openRow).offsetTop - 2);
            list.scrollTop = Math.min(desiredTop, Math.max(0, list.scrollHeight - list.clientHeight));
          }
        }
      });
    }

    function openPopup() {
      closePopup();
      pickerView = "days";
      pickerExpandedYear = null;
      const selectedIso = getSelected();
      const selectedDate = parseIsoDate(selectedIso);
      const fallbackDate = parseIsoDate(getMax()) || parseIsoDate(getMin()) || new Date();
      const initialDate = selectedDate || fallbackDate;
      pickerYear = initialDate.getFullYear();
      pickerMonth = initialDate.getMonth();
      popup = buildCalendar();
      document.body.appendChild(popup);
      requestAnimationFrame(positionPopup);
      window.addEventListener("scroll", positionPopup, true);
      window.addEventListener("resize", positionPopup);
    }

    function closePopup() {
      if (!popup) return;
      popup.remove();
      popup = null;
      window.removeEventListener("scroll", positionPopup, true);
      window.removeEventListener("resize", positionPopup);
    }

    function toggle(event) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      if (popup) closePopup();
      else openPopup();
    }

    document.addEventListener("click", closePopup);
    return { toggle, closePopup, rebuildCalendar };
  }

  function bindDateRangePickers(config = {}) {
    const startBtn = config.startBtn || document.getElementById(config.startBtnId || "startDateBtn");
    const endBtn = config.endBtn || document.getElementById(config.endBtnId || "endDateBtn");
    const startInput = config.startInput || document.getElementById(config.startInputId || "startDateInput");
    const endInput = config.endInput || document.getElementById(config.endInputId || "endDateInput");
    if (!startBtn || !endBtn || !startInput || !endInput) return null;

    const startPicker = createDatePicker({
      align: config.align || "left",
      anchorEl: startBtn,
      getSelected: () => startInput.value,
      getMin: () => startInput.min || (typeof config.getMin === "function" ? config.getMin("start") : ""),
      getMax: () => startInput.max || endInput.value || (typeof config.getMax === "function" ? config.getMax("start") : ""),
      isDisabled: config.isDisabled,
      onSelect: (iso) => {
        startInput.value = iso;
        if (typeof config.onSelect === "function") config.onSelect("start", iso, startPicker, endPicker);
      },
    });

    const endPicker = createDatePicker({
      align: config.align || "left",
      anchorEl: endBtn,
      getSelected: () => endInput.value,
      getMin: () => endInput.min || startInput.value || (typeof config.getMin === "function" ? config.getMin("end") : ""),
      getMax: () => endInput.max || (typeof config.getMax === "function" ? config.getMax("end") : ""),
      isDisabled: config.isDisabled,
      onSelect: (iso) => {
        endInput.value = iso;
        if (typeof config.onSelect === "function") config.onSelect("end", iso, startPicker, endPicker);
      },
    });

    startBtn.addEventListener("click", startPicker.toggle);
    endBtn.addEventListener("click", endPicker.toggle);
    return { startPicker, endPicker };
  }

  function createIndexDateRangeController(config = {}) {
    const getRows = typeof config.getRows === "function" ? config.getRows : () => config.rows || [];
    const getItemDate = typeof config.getDate === "function" ? config.getDate : (row) => row?.date;
    const onRange = typeof config.onRange === "function" ? config.onRange : null;

    function rows() {
      const value = getRows();
      return Array.isArray(value) ? value : [];
    }

    function maxIndex() {
      return Math.max(0, rows().length - 1);
    }

    function dateAt(index) {
      const list = rows();
      return getItemDate(list[index], index) || "";
    }

    function findIndex(iso, mode = "nearest") {
      const list = rows();
      if (!list.length || !iso) return -1;
      let lo = 0;
      let hi = list.length - 1;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (String(getItemDate(list[mid], mid) || "") < iso) lo = mid + 1;
        else hi = mid;
      }
      const foundDate = String(getItemDate(list[lo], lo) || "");
      if (foundDate === iso) return lo;
      if (mode === "ceil") return lo;
      if (mode === "floor") return Math.max(0, lo - 1);
      if (lo === 0) return 0;
      const prior = lo - 1;
      const currentMs = parseIsoDate(foundDate)?.getTime();
      const priorMs = parseIsoDate(getItemDate(list[prior], prior))?.getTime();
      const targetMs = parseIsoDate(iso)?.getTime();
      if (!Number.isFinite(currentMs) || !Number.isFinite(priorMs) || !Number.isFinite(targetMs)) return lo;
      return Math.abs(currentMs - targetMs) < Math.abs(priorMs - targetMs) ? lo : prior;
    }

    function clampIndex(index, fallback = 0) {
      const maxIdx = maxIndex();
      const next = Number.isFinite(index) ? Math.round(index) : fallback;
      return Math.max(0, Math.min(maxIdx, next));
    }

    function indexPercent(index) {
      const maxIdx = Math.max(1, maxIndex());
      return (clampIndex(index) / maxIdx) * 100;
    }

    function getRangeIndices(startIso, endIso) {
      const maxIdx = maxIndex();
      let startIndex = findIndex(startIso, "ceil");
      let endIndex = findIndex(endIso, "floor");
      if (!Number.isFinite(startIndex) || startIndex < 0) startIndex = 0;
      if (!Number.isFinite(endIndex) || endIndex < 0) endIndex = maxIdx;
      startIndex = clampIndex(startIndex);
      endIndex = clampIndex(endIndex, maxIdx);
      if (startIndex > endIndex) {
        const tmp = startIndex;
        startIndex = endIndex;
        endIndex = tmp;
      }
      return { startIndex, endIndex, minIndex: 0, maxIndex: maxIdx };
    }

    function indexFromPointer(clientX, trackEl) {
      if (!trackEl || !rows().length) return null;
      const rect = trackEl.getBoundingClientRect();
      if (!Number.isFinite(rect.width) || rect.width <= 0) return null;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return Math.round(ratio * maxIndex());
    }

    function moveRangeByDelta(startIndex, endIndex, deltaIndex) {
      const maxIdx = maxIndex();
      const safeStart = clampIndex(startIndex);
      const safeEnd = Math.max(safeStart, clampIndex(endIndex, maxIdx));
      const delta = Number.isFinite(deltaIndex) ? Math.round(deltaIndex) : 0;
      const minShift = -safeStart;
      const maxShift = maxIdx - safeEnd;
      const shift = Math.max(minShift, Math.min(maxShift, delta));
      return { startIndex: safeStart + shift, endIndex: safeEnd + shift, shift };
    }

    function setRangeByIndices(startIndex, endIndex, options = {}) {
      const list = rows();
      if (!list.length) return null;
      const safeStart = clampIndex(startIndex);
      const safeEnd = Math.max(safeStart, clampIndex(endIndex, maxIndex()));
      const range = {
        startIndex: safeStart,
        endIndex: safeEnd,
        startIso: getItemDate(list[safeStart], safeStart) || "",
        endIso: getItemDate(list[safeEnd], safeEnd) || "",
      };
      if (onRange) onRange(range, options);
      return range;
    }

    return {
      rows,
      maxIndex,
      dateAt,
      findIndex,
      clampIndex,
      indexPercent,
      getRangeIndices,
      indexFromPointer,
      moveRangeByDelta,
      setRangeByIndices,
    };
  }

  function getButtonGroupValue(group, options = {}) {
    if (!group) return options.defaultValue || "";
    const multiValues = options.multiValues || ["left", "right"];
    const multiResult = options.multiResult || "both";
    if (options.multi) {
      const selected = multiValues.filter((value) => {
        return !!group.querySelector(`.download-setting-option.is-selected[data-value="${value}"], .date-range-chart-toggle-btn.is-active[data-value="${value}"]`);
      });
      if (selected.length === multiValues.length) return multiResult;
      if (selected.length === 1) return selected[0];
      return options.defaultValue || multiResult;
    }
    const selected = group.querySelector(".download-setting-option.is-selected[data-value], .date-range-chart-toggle-btn.is-active[data-value]");
    return selected?.dataset.value || options.defaultValue || "";
  }

  function setButtonGroupValue(group, value, options = {}) {
    if (!group) return;
    const selectedClass = options.selectedClass || "is-selected";
    const buttonSelector = options.buttonSelector || ".download-setting-option[data-value]";
    const buttons = Array.from(group.querySelectorAll(buttonSelector));
    if (options.multi) {
      const multiValues = options.multiValues || ["left", "right"];
      const multiResult = options.multiResult || "both";
      const normalized = [...multiValues, multiResult].includes(String(value)) ? String(value) : (options.defaultValue || multiResult);
      buttons.forEach((button) => {
        const isSelected = normalized === multiResult || button.dataset.value === normalized;
        button.classList.toggle(selectedClass, isSelected);
        button.setAttribute("aria-pressed", isSelected ? "true" : "false");
      });
      return;
    }
    buttons.forEach((button) => {
      const isSelected = button.dataset.value === String(value);
      button.classList.toggle(selectedClass, isSelected);
      button.setAttribute("aria-pressed", isSelected ? "true" : "false");
    });
  }

  function toggleRequiredButtonGroupItem(group, button, options = {}) {
    if (!group || !button) return;
    const selectedClass = options.selectedClass || "is-selected";
    const buttonSelector = options.buttonSelector || ".download-setting-option[data-value]";
    const buttons = Array.from(group.querySelectorAll(buttonSelector));
    const nextSelected = !button.classList.contains(selectedClass);
    button.classList.toggle(selectedClass, nextSelected);
    button.setAttribute("aria-pressed", nextSelected ? "true" : "false");
    if (!buttons.some((item) => item.classList.contains(selectedClass))) {
      const fallback = buttons.find((item) => item !== button) || button;
      fallback.classList.add(selectedClass);
      fallback.setAttribute("aria-pressed", "true");
    }
    buttons.forEach((item) => {
      item.setAttribute("aria-pressed", item.classList.contains(selectedClass) ? "true" : "false");
    });
  }

  function syncDependentButtonGroupAvailability(config = {}) {
    const chartGroup = config.chartGroup;
    if (!chartGroup) return;
    (config.sides || []).forEach(({ value, group }) => {
      if (!group) return;
      const chartButton = chartGroup.querySelector(`.download-setting-option[data-value="${value}"], .date-range-chart-toggle-btn[data-value="${value}"]`);
      const isEnabled = !!chartButton?.classList.contains(config.chartSelectedClass || "is-selected")
        || !!chartButton?.classList.contains(config.chartActiveClass || "is-active");
      group.classList.toggle("is-disabled", !isEnabled);
      group.querySelectorAll(config.optionSelector || ".download-setting-option[data-value]").forEach((button) => {
        button.disabled = !isEnabled;
        button.setAttribute("aria-disabled", isEnabled ? "false" : "true");
      });
    });
  }

  function createDownloadSettingsController(config = {}) {
    const defaults = { ...(config.defaults || {}) };
    const normalize = typeof config.normalize === "function"
      ? config.normalize
      : (settings) => ({ ...defaults, ...(settings || {}) });
    const groups = config.groups || {};
    const checkboxes = config.checkboxes || {};
    const storageKey = config.storageKey || "";
    let settings = normalize({ ...defaults, ...(config.initial || {}) });
    let hasStoredValue = false;

    function getGroupValue(name) {
      const entry = groups[name];
      const group = entry?.group || entry;
      if (!group) return "";
      return getButtonGroupValue(group, {
        multi: !!entry.multi,
        defaultValue: entry.defaultValue !== undefined ? entry.defaultValue : defaults[name],
        selectedClass: entry.selectedClass,
        buttonSelector: entry.buttonSelector,
      });
    }

    function setGroupValue(name, value) {
      const entry = groups[name];
      const group = entry?.group || entry;
      if (!group) return;
      setButtonGroupValue(group, value, {
        multi: !!entry.multi,
        defaultValue: entry.defaultValue !== undefined ? entry.defaultValue : defaults[name],
        selectedClass: entry.selectedClass,
        buttonSelector: entry.buttonSelector,
      });
    }

    function readControls() {
      const next = {};
      Object.keys(groups).forEach((name) => {
        next[name] = getGroupValue(name);
      });
      Object.keys(checkboxes).forEach((name) => {
        const checkbox = checkboxes[name]?.checkbox || checkboxes[name];
        const fallback = checkboxes[name]?.defaultValue;
        next[name] = checkbox ? !!checkbox.checked : !!fallback;
      });
      return normalize({ ...settings, ...next });
    }

    function writeControls(nextSettings = settings) {
      settings = normalize(nextSettings);
      Object.keys(groups).forEach((name) => setGroupValue(name, settings[name]));
      Object.keys(checkboxes).forEach((name) => {
        const checkbox = checkboxes[name]?.checkbox || checkboxes[name];
        if (checkbox) checkbox.checked = !!settings[name];
      });
      if (typeof config.afterWrite === "function") config.afterWrite(settings);
      return settings;
    }

    function save(nextSettings = readControls()) {
      settings = normalize(nextSettings);
      hasStoredValue = true;
      writeControls(settings);
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, JSON.stringify(settings));
        } catch (_) {}
      }
      if (typeof config.afterSave === "function") config.afterSave(settings);
      return settings;
    }

    function load() {
      let stored = null;
      if (storageKey) {
        try {
          stored = JSON.parse(localStorage.getItem(storageKey) || "null");
        } catch (_) {
          stored = null;
        }
      }
      hasStoredValue = !!stored && typeof stored === "object";
      settings = normalize(stored || defaults);
      writeControls(settings);
      if (typeof config.afterLoad === "function") config.afterLoad(settings, hasStoredValue);
      return settings;
    }

    function getSettings() {
      return settings;
    }

    function setSettings(nextSettings, options = {}) {
      settings = normalize(nextSettings);
      if (options.writeControls !== false) writeControls(settings);
      return settings;
    }

    function hasStoredSettings() {
      return hasStoredValue;
    }

    return {
      getGroupValue,
      setGroupValue,
      readControls,
      writeControls,
      save,
      load,
      getSettings,
      setSettings,
      hasStoredSettings,
    };
  }

  function getTwoPanelMode(group, options = {}) {
    if (!group) return options.defaultMode || "both";
    const leftValue = options.leftValue || "left";
    const rightValue = options.rightValue || "right";
    const activeClass = options.activeClass || "is-active";
    const selector = options.buttonSelector || "[data-value]";
    const leftSelected = !!group.querySelector(`${selector}.${activeClass}[data-value="${leftValue}"], ${selector}.${activeClass}[data-chart-mode="${leftValue}"]`);
    const rightSelected = !!group.querySelector(`${selector}.${activeClass}[data-value="${rightValue}"], ${selector}.${activeClass}[data-chart-mode="${rightValue}"]`);
    if (leftSelected && rightSelected) return "both";
    if (leftSelected) return leftValue;
    if (rightSelected) return rightValue;
    return options.defaultMode || "both";
  }

  function setTwoPanelMode(config = {}) {
    const mode = config.mode || "both";
    const leftValue = config.leftValue || "left";
    const rightValue = config.rightValue || "right";
    const activeClass = config.activeClass || "is-active";
    const selector = config.buttonSelector || "[data-value]";
    const showLeft = mode !== rightValue;
    const showRight = mode !== leftValue;
    const grid = config.grid;
    const leftPanel = config.leftPanel;
    const rightPanel = config.rightPanel;
    grid?.classList.toggle(config.leftOnlyClass || "is-left-only", showLeft && !showRight);
    grid?.classList.toggle(config.rightOnlyClass || "is-right-only", showRight && !showLeft);
    grid?.classList.toggle(config.bothClass || "is-both", showLeft && showRight);
    leftPanel?.classList.toggle(config.hiddenClass || "is-hidden", !showLeft);
    rightPanel?.classList.toggle(config.hiddenClass || "is-hidden", !showRight);
    if (config.group) {
      config.group.querySelectorAll(selector).forEach((button) => {
        const value = button.dataset.value || button.dataset.chartMode;
        const selected = value === leftValue ? showLeft : value === rightValue ? showRight : false;
        button.classList.toggle(activeClass, selected);
        button.classList.toggle(config.selectedClass || "is-selected", selected);
        button.setAttribute("aria-pressed", selected ? "true" : "false");
      });
    }
    return { showLeft, showRight, mode: showLeft && showRight ? "both" : showLeft ? leftValue : rightValue };
  }

  function toggleTwoPanelMode(config = {}, button) {
    if (!button) return config.currentMode || "both";
    const leftValue = config.leftValue || "left";
    const rightValue = config.rightValue || "right";
    const value = button.dataset.value || button.dataset.chartMode;
    if (value !== leftValue && value !== rightValue) return config.currentMode || "both";
    const currentMode = config.currentMode || getTwoPanelMode(config.group, config);
    let showLeft = currentMode !== rightValue;
    let showRight = currentMode !== leftValue;
    if (value === leftValue) showLeft = !showLeft;
    if (value === rightValue) showRight = !showRight;
    if (!showLeft && !showRight) {
      if (value === leftValue) showRight = true;
      if (value === rightValue) showLeft = true;
    }
    return showLeft && showRight ? "both" : showLeft ? leftValue : rightValue;
  }

  function syncScaleButtonGroup(group, value, options = {}) {
    if (!group) return;
    const activeClass = options.activeClass || "is-active";
    const selector = options.buttonSelector || "[data-value]";
    group.querySelectorAll(selector).forEach((button) => {
      const buttonValue = button.dataset.value || button.dataset.scale || button.dataset.priceScale || button.dataset.daysScale;
      const selected = buttonValue === value;
      button.classList.toggle(activeClass, selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    });
  }

  function getScaleButtonValue(button) {
    return button?.dataset?.value || button?.dataset?.scale || button?.dataset?.priceScale || button?.dataset?.daysScale || "";
  }

  function setFloatingMenuOpen(config = {}, open) {
    const menu = config.menu;
    const button = config.button;
    menu?.classList.toggle(config.openClass || "open", !!open);
    button?.classList.toggle(config.buttonOpenClass || "is-open", !!open);
    button?.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      if (typeof config.onOpen === "function") config.onOpen();
      constrainFloatingMenuToViewport(menu, config.shiftProperty);
    } else {
      menu?.style.removeProperty(config.shiftProperty || "--download-settings-menu-shift-x");
      if (typeof config.onClose === "function") config.onClose();
    }
  }

  function constrainFloatingMenuToViewport(menu, shiftProperty = "--download-settings-menu-shift-x") {
    if (!menu?.classList.contains("open")) return;
    menu.style.setProperty(shiftProperty, "0px");
    const rect = menu.getBoundingClientRect();
    const margin = 8;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || rect.right;
    let shiftX = 0;
    if (rect.left < margin) shiftX = margin - rect.left;
    else if (rect.right > viewportWidth - margin) shiftX = (viewportWidth - margin) - rect.right;
    menu.style.setProperty(shiftProperty, `${Math.round(shiftX)}px`);
  }

  function resolveDashboardElement(value, root = document) {
    if (!value) return null;
    if (typeof value === "string") return root.querySelector(value);
    return value;
  }

  function escapeDashboardHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[char]));
  }

  function createUpdatedTimeZoneChipController(config = {}) {
    const root = config.root || document;
    let timeApi = null;
    function resolveTimeApi() {
      if (config.timeApi) return config.timeApi;
      if (window.WSBDashboardTime) return window.WSBDashboardTime;
      try {
        if (window.parent && window.parent !== window && window.parent.WSBDashboardTime) {
          return window.parent.WSBDashboardTime;
        }
      } catch (_) {
      }
      return null;
    }
    function getTimeApi() {
      if (!timeApi) timeApi = resolveTimeApi();
      return timeApi;
    }
    const wrap = resolveDashboardElement(config.wrap || "#updatedChipWrap", root);
    const chip = resolveDashboardElement(config.chip || "#chipUpdated", root);
    const valueEl = resolveDashboardElement(config.value || "#updatedKpi", root) || chip?.querySelector(".chip-value");
    const select = resolveDashboardElement(config.select || "#updatedTimeZoneSelect", root);
    const dropdown = resolveDashboardElement(config.dropdown || "#updatedTimeZoneDropdown", root);
    const trigger = resolveDashboardElement(config.trigger || "#updatedTimeZoneDropdownTrigger", root);
    const menu = resolveDashboardElement(config.menu || "#updatedTimeZoneDropdownMenu", root);
    const fallbackTimeZone = getTimeApi()?.FALLBACK_TIME_ZONE || "UTC";
    const getTimeZone = typeof config.getTimeZone === "function"
      ? config.getTimeZone
      : () => select?.value || getTimeApi()?.getPreferredTimeZone?.() || fallbackTimeZone;
    const setTimeZone = typeof config.setTimeZone === "function"
      ? config.setTimeZone
      : (value) => {
        const normalized = getTimeApi()?.setPreferredTimeZone?.(value) || value || fallbackTimeZone;
        if (select) select.value = normalized;
        return normalized;
      };
    let listenersBound = false;

    function parseCssPx(value, fallback = 0) {
      const parsed = Number.parseFloat(String(value || ""));
      return Number.isFinite(parsed) ? parsed : fallback;
    }

    function sizeMenu() {
      if (!select || !menu) return;
      menu.style.removeProperty("--dca-dropdown-shift-x");
      const selectRect = select.getBoundingClientRect();
      const styles = window.getComputedStyle(menu);
      const minWidth = Math.max(260, Math.ceil(selectRect.width || 0));
      const maxWidth = Math.max(minWidth, Math.min(520, Math.max(260, window.innerWidth - 24)));
      menu.style.minWidth = `${minWidth}px`;
      menu.style.maxWidth = `${maxWidth}px`;
      const menuWidth = Math.min(
        maxWidth,
        Math.max(minWidth, menu.scrollWidth || minWidth, parseCssPx(styles.width, minWidth))
      );
      const margin = 8;
      let shift = 0;
      const left = selectRect.right - menuWidth;
      const right = selectRect.right;
      if (left < margin) shift = margin - left;
      if (right + shift > window.innerWidth - margin) shift = (window.innerWidth - margin) - right;
      menu.style.setProperty("--dca-dropdown-shift-x", `${Math.round(shift)}px`);
    }

    function setDropdownOpen(isOpen) {
      dropdown?.classList.toggle("is-open", !!isOpen);
      wrap?.classList.toggle("is-open", !!isOpen);
      menu?.classList.toggle("open", !!isOpen);
      trigger?.setAttribute("aria-expanded", isOpen ? "true" : "false");
      if (!isOpen) menu?.style.removeProperty("--dca-dropdown-shift-x");
      if (isOpen) sizeMenu();
    }

    function syncDropdown() {
      if (!select) return;
      const value = getTimeZone() || fallbackTimeZone;
      select.value = value;
      const selected = select.selectedOptions?.[0];
      const text = selected?.textContent || value;
      if (trigger) trigger.textContent = text;
      if (menu) {
        menu.querySelectorAll(".dca-dropdown-option").forEach((option) => {
          const selectedOption = option.dataset.value === value;
          option.classList.toggle("is-selected", selectedOption);
          option.setAttribute("aria-selected", selectedOption ? "true" : "false");
        });
      }
    }

    function getOptions() {
      if (typeof config.getOptions === "function") return config.getOptions();
      return getTimeApi()?.getTimeZoneOptions?.() || [{ value: fallbackTimeZone, label: fallbackTimeZone }];
    }

    function populate() {
      const options = getOptions();
      const current = getTimeZone() || getTimeApi()?.getPreferredTimeZone?.() || fallbackTimeZone;
      if (select) {
        select.innerHTML = "";
        options.forEach((option) => {
          const item = document.createElement("option");
          item.value = option.value;
          item.textContent = option.label;
          select.appendChild(item);
        });
        select.value = current;
      }
      if (menu) {
        menu.innerHTML = options.map((option) => (
          `<button type="button" class="dca-dropdown-option" data-value="${escapeDashboardHtml(option.value)}" role="option">${escapeDashboardHtml(option.label)}</button>`
        )).join("");
      }
      syncDropdown();
    }

    function normalizeTimestamp(value) {
      const raw = String(value || "").trim();
      if (!raw) return "";
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T23:59:59Z`;
      const utcSuffixMatch = raw.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2}(?::\d{2})?)(?:\.\d+)?\s*(?:UTC|GMT|Z)$/i);
      if (utcSuffixMatch) return `${utcSuffixMatch[1]}T${utcSuffixMatch[2]}Z`;
      if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(raw)) return `${raw.replace(" ", "T")}Z`;
      return raw;
    }

    function formatUpdated(value, options = {}) {
      const raw = String(value || "").trim();
      if (!raw) return "-";
      if (options.mode === "date") {
        const iso = raw.slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
          const date = new Date(`${iso}T00:00:00Z`);
          return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
        }
      }
      const formatted = getTimeApi()?.formatUtcTimestamp?.(normalizeTimestamp(raw), getTimeZone());
      let text = (formatted?.text || raw).replace(/\s+([A-Z]{2,5}|GMT[^\s]*)$/, " ($1)");
      if (options.includeHeight && options.height != null && options.height !== "") {
        const height = Number(options.height);
        const heightText = Number.isFinite(height) ? height.toLocaleString("en-US") : String(options.height);
        text = `${text} | ${heightText}`;
      }
      return text;
    }

    function setUpdated(value, options = {}) {
      if (valueEl) valueEl.textContent = formatUpdated(value, options);
    }

    function setText(text) {
      if (valueEl) valueEl.textContent = String(text ?? "");
    }

    function bind() {
      if (listenersBound) return;
      listenersBound = true;
      select?.addEventListener("change", () => {
        const normalized = setTimeZone(select.value);
        if (select) select.value = normalized;
        syncDropdown();
        if (typeof config.onChange === "function") config.onChange(normalized);
      });
      trigger?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        setDropdownOpen(!menu?.classList.contains("open"));
      });
      menu?.addEventListener("click", (event) => {
        const option = event.target.closest?.(".dca-dropdown-option");
        if (!option || !select) return;
        event.preventDefault();
        select.value = option.dataset.value || fallbackTimeZone;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        setDropdownOpen(false);
      });
      document.addEventListener("click", (event) => {
        if (!dropdown?.contains(event.target) && event.target !== select) setDropdownOpen(false);
      });
      window.addEventListener("resize", () => {
        if (menu?.classList.contains("open")) sizeMenu();
      });
      if (timeApi?.CHANGE_EVENT) {
        window.addEventListener(timeApi.CHANGE_EVENT, (event) => {
          const next = event?.detail?.timeZone || timeApi.getPreferredTimeZone?.();
          if (select && next && select.value !== next) select.value = next;
          syncDropdown();
          if (typeof config.onChange === "function") config.onChange(next);
        });
      }
    }

    populate();
    bind();

    return {
      elements: { wrap, chip, value: valueEl, select, dropdown, trigger, menu },
      getTimeZone,
      setTimeZone,
      populate,
      syncDropdown,
      formatUpdated,
      setUpdated,
      setText,
    };
  }

  async function copyTextToClipboard(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.setAttribute("readonly", "readonly");
    textArea.style.position = "absolute";
    textArea.style.left = "-9999px";
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand("copy");
    document.body.removeChild(textArea);
  }

  function showCopyButtonFeedback(button, options = {}) {
    if (!button) return;
    const labelEl = button.querySelector(options.labelSelector || ".btn-label");
    const original = labelEl ? labelEl.textContent : button.textContent;
    if (button.__copyFeedbackTimer) window.clearTimeout(button.__copyFeedbackTimer);
    button.classList.add(options.copiedClass || "copy-link-btn--copied");
    if (typeof options.setIcon === "function") options.setIcon(options.copiedIcon);
    if (labelEl) labelEl.textContent = options.copiedText || "Copied!";
    else button.textContent = options.copiedText || "Copied!";
    button.__copyFeedbackTimer = window.setTimeout(() => {
      if (typeof options.setIcon === "function") options.setIcon(options.defaultIcon);
      if (labelEl) labelEl.textContent = original || options.defaultText || "Copy Link";
      else button.textContent = original || options.defaultText || "Copy Link";
      button.classList.remove(options.copiedClass || "copy-link-btn--copied");
      button.__copyFeedbackTimer = null;
    }, options.durationMs || 1400);
  }

  async function copyDashboardLink(config = {}) {
    const link = typeof config.getUrl === "function" ? config.getUrl() : (config.url || window.location.href);
    await copyTextToClipboard(link);
    showCopyButtonFeedback(config.button, config);
    return link;
  }

  function setResetButtonState(config = {}) {
    const button = config.button;
    if (!button) return;
    const labelEl = button.querySelector(config.labelSelector || ".btn-label");
    const isUndo = !!config.isUndo;
    const label = isUndo ? (config.undoLabel || "Undo Restore") : (config.defaultLabel || "Restore Defaults");
    if (labelEl) labelEl.textContent = label;
    else button.textContent = label;
    if (typeof config.setIcon === "function") config.setIcon(isUndo ? config.undoIcon : config.defaultIcon);
    button.classList.toggle(config.undoClass || "reset-dashboard-btn--undo", isUndo);
    const tooltip = isUndo ? (config.undoTooltip || "Undo the last restore defaults action") : (config.defaultTooltip || "Reset dashboard to defaults");
    button.setAttribute("aria-label", isUndo ? "Undo the last restore defaults action" : "Restore dashboard defaults");
    button.dataset.tooltip = tooltip;
    button.title = tooltip;
    button.disabled = isUndo ? false : !!config.disabled;
  }

  function bindDashboardActions(config = {}) {
    const copyButton = config.copyButton;
    const resetButton = config.resetButton;
    if (copyButton && copyButton.dataset.wsbActionBound !== "1") {
      copyButton.dataset.wsbActionBound = "1";
      copyButton.addEventListener("click", async () => {
        try {
          await copyDashboardLink({
            button: copyButton,
            getUrl: config.getShareUrl,
            setIcon: config.setCopyIcon,
            defaultIcon: config.copyDefaultIcon,
            copiedIcon: config.copyCopiedIcon,
            copiedText: config.copiedText,
            defaultText: config.copyDefaultText,
          });
        } catch (_) {}
      });
    }

    if (resetButton && resetButton.dataset.wsbActionBound !== "1") {
      resetButton.dataset.wsbActionBound = "1";
      resetButton.addEventListener("click", () => {
        if (typeof config.onReset === "function") config.onReset(resetButton);
      });
    }

    function syncResetState(options = {}) {
      setResetButtonState({
        button: resetButton,
        isUndo: !!options.isUndo,
        disabled: !!options.disabled,
        setIcon: config.setResetIcon,
        defaultIcon: config.resetDefaultIcon,
        undoIcon: config.resetUndoIcon,
        defaultLabel: config.resetDefaultLabel,
        undoLabel: config.resetUndoLabel,
        defaultTooltip: config.resetDefaultTooltip,
        undoTooltip: config.resetUndoTooltip,
      });
    }

    return { syncResetState };
  }

  function isTextEntryElementActive(activeElement = document.activeElement) {
    if (!activeElement) return false;
    const tag = activeElement.tagName;
    return activeElement.isContentEditable
      || tag === "INPUT"
      || tag === "TEXTAREA"
      || tag === "SELECT"
      || activeElement.closest?.("[contenteditable='true']");
  }

  function consumeKeyboardEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
  }

  function bindPlaybackKeyboardShortcuts(config = {}) {
    window.WSBDashboardPlaybackKeyboardShortcutsActive = true;
    const getActiveElement = () => document.activeElement;
    const isTextEntry = (event) => {
      if (typeof config.isTextEntry === "function") return !!config.isTextEntry(getActiveElement(), event);
      return isTextEntryElementActive(getActiveElement());
    };
    const blurControls = () => {
      if (typeof config.blurControls !== "function") return;
      config.blurControls();
      requestAnimationFrame(() => config.blurControls());
    };
    const isPlaybackActive = () => {
      if (typeof config.isPlaybackActive === "function") return !!config.isPlaybackActive();
      if (typeof config.isArrowActive === "function") return !!config.isArrowActive();
      return false;
    };
    const isInactiveArrowActive = () => (
      typeof config.isInactiveArrowActive === "function" ? !!config.isInactiveArrowActive() : typeof config.onInactiveArrow === "function"
    );
    const handler = (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const isSpace = event.key === " " || event.key === "Spacebar" || event.code === "Space";
      const isArrow = event.key === "ArrowLeft" || event.key === "ArrowRight";
      // Shift+Comma / Shift+Period are reserved for modal dashboard navigation.
      const isStep = !event.shiftKey && (
        event.key === "," || event.code === "Comma" || event.key === "." || event.code === "Period"
      );
      const isEscape = event.key === "Escape";
      if (!isSpace && !isArrow && !isStep && !isEscape) return;
      if (!isEscape && isTextEntry(event)) return;
      if (isSpace) {
        consumeKeyboardEvent(event);
        blurControls();
        if (typeof config.onSpace === "function") config.onSpace(event);
        return;
      }
      if (isEscape && (typeof config.isEscapeActive !== "function" || config.isEscapeActive())) {
        consumeKeyboardEvent(event);
        if (typeof config.onEscape === "function") config.onEscape(event);
        return;
      }
      if ((isArrow || isStep) && isPlaybackActive()) {
        consumeKeyboardEvent(event);
        blurControls();
        const direction = (event.key === "ArrowRight" || event.key === "." || event.code === "Period") ? 1 : -1;
        const detail = { isArrow, isStep, key: event.key, code: event.code };
        if (isStep && typeof config.onStep === "function") config.onStep(direction, event, detail);
        else if (typeof config.onArrow === "function") config.onArrow(direction, event, detail);
        return;
      }
      if (isArrow && !isPlaybackActive() && isInactiveArrowActive()) {
        consumeKeyboardEvent(event);
        blurControls();
        if (typeof config.onInactiveArrow === "function") config.onInactiveArrow(event.key === "ArrowRight" ? 1 : -1, event);
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }

  function getDashboardManifest(fallback = {}) {
    const manifest = window.WSBDashboardManifest;
    if (!manifest || typeof manifest !== "object") return { ...fallback };
    return { ...fallback, ...manifest };
  }

  function setTextIfPresent(element, text) {
    if (!element || text == null) return;
    element.textContent = String(text);
  }

  function initDashboardRuntime(config = {}) {
    const manifest = getDashboardManifest(config.manifest || {});
    const root = config.root || document;
    const title = manifest.title || config.title;
    if (title) {
      setTextIfPresent(root.querySelector(config.titleSelector || ".title"), title);
      if (config.updateDocumentTitle !== false) document.title = title;
    }
    if (manifest.description) {
      setTextIfPresent(root.querySelector(config.descriptionSelector || ".info-popover"), manifest.description);
    }

    const copyButton = config.copyButton || root.querySelector(config.copyButtonSelector || "#copyDashboardLink");
    const resetButton = config.resetButton || root.querySelector(config.resetButtonSelector || "#resetDashboard");
    const actions = bindDashboardActions({
      copyButton,
      resetButton,
      getShareUrl: config.getShareUrl || (() => window.location.href),
      setCopyIcon: config.setCopyIcon,
      setResetIcon: config.setResetIcon,
      copyDefaultIcon: config.copyDefaultIcon,
      copyCopiedIcon: config.copyCopiedIcon,
      resetDefaultIcon: config.resetDefaultIcon,
      resetUndoIcon: config.resetUndoIcon,
      copiedText: config.copiedText,
      copyDefaultText: config.copyDefaultText,
      resetDefaultLabel: config.resetDefaultLabel,
      resetUndoLabel: config.resetUndoLabel,
      resetDefaultTooltip: config.resetDefaultTooltip,
      resetUndoTooltip: config.resetUndoTooltip,
      onReset: config.onReset,
    });

    return { manifest, actions };
  }

  function resolveElement(elementOrId, root = document) {
    if (!elementOrId) return null;
    if (typeof elementOrId === "string") return root.getElementById?.(elementOrId) || root.querySelector?.(elementOrId) || null;
    return elementOrId;
  }

  function createChartLoader(config = {}) {
    const loader = document.createElement("div");
    loader.className = config.className || "dashboard-ring-loader";
    if (config.id) loader.id = config.id;
    loader.setAttribute("role", config.role || "status");
    loader.setAttribute("aria-live", config.live || "polite");
    loader.setAttribute("aria-label", config.ariaLabel || config.label || "Loading chart");
    const ring = document.createElement("span");
    ring.className = config.ringClassName || "chart-loader-ring";
    ring.setAttribute("aria-hidden", "true");
    loader.appendChild(ring);
    if (typeof config.label === "string" && config.label) {
      const label = document.createElement("span");
      label.className = config.labelClassName || "label";
      label.textContent = config.label;
      loader.appendChild(label);
    }
    if (config.hidden) setChartLoaderVisible(loader, false);
    return loader;
  }

  function setChartLoaderVisible(elementOrId, visible, options = {}) {
    const loader = resolveElement(elementOrId, options.root || document);
    if (!loader) return null;
    const isVisible = !!visible;
    loader.classList.toggle("hidden", !isVisible);
    loader.classList.toggle("is-hidden", !isVisible);
    loader.setAttribute("aria-hidden", isVisible ? "false" : "true");
    if (options.useHiddenAttribute) loader.hidden = !isVisible;
    return loader;
  }

  function bindChartLoaders(loaders, options = {}) {
    const items = (Array.isArray(loaders) ? loaders : [loaders])
      .map((loader) => resolveElement(loader, options.root || document))
      .filter(Boolean);
    const api = {
      show() {
        items.forEach((loader) => setChartLoaderVisible(loader, true, options));
      },
      hide() {
        items.forEach((loader) => setChartLoaderVisible(loader, false, options));
      },
      set(visible) {
        items.forEach((loader) => setChartLoaderVisible(loader, visible, options));
      },
      elements: items,
    };
    if (options.initialVisible === false) api.hide();
    else if (options.initialVisible === true) api.show();
    return api;
  }

  function createTitleSettingsButton(config = {}) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = config.className || "info-btn filters-btn";
    if (config.id) button.id = config.id;
    button.setAttribute("aria-label", config.ariaLabel || "Show dashboard settings");
    button.setAttribute("aria-haspopup", config.haspopup || "dialog");
    button.setAttribute("aria-expanded", String(!!config.expanded));
    if (config.controls) button.setAttribute("aria-controls", config.controls);
    if (config.title) button.title = config.title;

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("focusable", "false");
    svg.setAttribute("aria-hidden", "true");
    [
      "M3 5.5h8.3M16.7 5.5H21M3 12h4.3M12.7 12H21M3 18.5h10.3M18.7 18.5H21",
    ].forEach((d) => {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      svg.appendChild(path);
    });
    [
      { cx: "14", cy: "5.5", r: "2.65" },
      { cx: "10", cy: "12", r: "2.65" },
      { cx: "16", cy: "18.5", r: "2.65" },
    ].forEach((attrs) => {
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      Object.entries(attrs).forEach(([key, value]) => circle.setAttribute(key, value));
      svg.appendChild(circle);
    });
    button.appendChild(svg);
    return button;
  }

  function renderTitleSettingsButtonIcon(button) {
    if (!button) return null;
    button.querySelectorAll("svg").forEach((svg) => svg.remove());
    const iconButton = createTitleSettingsButton();
    const icon = iconButton.querySelector("svg");
    if (icon) button.appendChild(icon);
    return button;
  }

  function hydrateTitleSettingsButtons(root = document) {
    const scope = root && typeof root.querySelectorAll === "function" ? root : document;
    scope.querySelectorAll("[data-title-settings-button]").forEach(renderTitleSettingsButtonIcon);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => hydrateTitleSettingsButtons(), { once: true });
  } else {
    hydrateTitleSettingsButtons();
  }

  ns.createDatePicker = createDatePicker;
  ns.makeDatePicker = createDatePicker;
  ns.bindDateRangePickers = bindDateRangePickers;
  ns.createIndexDateRangeController = createIndexDateRangeController;
  ns.getButtonGroupValue = getButtonGroupValue;
  ns.setButtonGroupValue = setButtonGroupValue;
  ns.toggleRequiredButtonGroupItem = toggleRequiredButtonGroupItem;
  ns.syncDependentButtonGroupAvailability = syncDependentButtonGroupAvailability;
  ns.createDownloadSettingsController = createDownloadSettingsController;
  ns.getTwoPanelMode = getTwoPanelMode;
  ns.setTwoPanelMode = setTwoPanelMode;
  ns.toggleTwoPanelMode = toggleTwoPanelMode;
  ns.syncScaleButtonGroup = syncScaleButtonGroup;
  ns.getScaleButtonValue = getScaleButtonValue;
  ns.setFloatingMenuOpen = setFloatingMenuOpen;
  ns.constrainFloatingMenuToViewport = constrainFloatingMenuToViewport;
  ns.createUpdatedTimeZoneChipController = createUpdatedTimeZoneChipController;
  ns.copyTextToClipboard = copyTextToClipboard;
  ns.showCopyButtonFeedback = showCopyButtonFeedback;
  ns.copyDashboardLink = copyDashboardLink;
  ns.setResetButtonState = setResetButtonState;
  ns.bindDashboardActions = bindDashboardActions;
  ns.isTextEntryElementActive = isTextEntryElementActive;
  ns.consumeKeyboardEvent = consumeKeyboardEvent;
  ns.bindPlaybackKeyboardShortcuts = bindPlaybackKeyboardShortcuts;
  ns.getDashboardManifest = getDashboardManifest;
  ns.initDashboardRuntime = initDashboardRuntime;
  ns.createTitleSettingsButton = createTitleSettingsButton;
  ns.renderTitleSettingsButtonIcon = renderTitleSettingsButtonIcon;
  ns.hydrateTitleSettingsButtons = hydrateTitleSettingsButtons;
  ns.createChartLoader = createChartLoader;
  ns.setChartLoaderVisible = setChartLoaderVisible;
  ns.bindChartLoaders = bindChartLoaders;
}());
