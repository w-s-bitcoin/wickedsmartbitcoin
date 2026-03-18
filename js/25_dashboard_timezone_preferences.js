(function initDashboardTimezonePreferences(globalScope) {
  const STORAGE_KEY = "wicked_dashboard_timezone_v1";
  const FALLBACK_TIME_ZONE = "UTC";
  const CURATED_TIME_ZONES = [
    { value: "UTC", label: "UTC - Greenwich Mean Time (GMT)" },
    { value: "Etc/GMT+12", label: "UTC-12 - Anywhere on Earth (AoE)" },
    { value: "Pacific/Pago_Pago", label: "UTC-11 - Samoa Standard Time (SST)" },
    { value: "Pacific/Honolulu", label: "UTC-10 - Hawaii Standard Time (HST)" },
    { value: "America/Anchorage", label: "UTC-9 - Alaska Time (AKT)" },
    { value: "America/Los_Angeles", label: "UTC-8 - Pacific Time (PT)" },
    { value: "America/Denver", label: "UTC-7 - Mountain Time (MT)" },
    { value: "America/Chicago", label: "UTC-6 - Central Time (CT)" },
    { value: "America/New_York", label: "UTC-5 - Eastern Time (ET)" },
    { value: "America/Halifax", label: "UTC-4 - Atlantic Time (AT)" },
    { value: "America/Argentina/Buenos_Aires", label: "UTC-3 - Argentina Time (ART)" },
    { value: "America/Noronha", label: "UTC-2 - Fernando de Noronha Time (FNT)" },
    { value: "Atlantic/Azores", label: "UTC-1 - Azores Time (AZOT)" },
    { value: "Europe/Berlin", label: "UTC+1 - Central European Time (CET)" },
    { value: "Europe/Helsinki", label: "UTC+2 - Eastern European Time (EET)" },
    { value: "Europe/Moscow", label: "UTC+3 - Moscow Standard Time (MSK)" },
    { value: "Asia/Yerevan", label: "UTC+4 - Armenia Time (AMT)" },
    { value: "Asia/Karachi", label: "UTC+5 - Pakistan Standard Time (PKT)" },
    { value: "Asia/Urumqi", label: "UTC+6 - Xinjiang Time (XJT)" },
    { value: "Asia/Bangkok", label: "UTC+7 - Indochina Time (ICT)" },
    { value: "Asia/Hong_Kong", label: "UTC+8 - Hong Kong Time (HKT)" },
    { value: "Asia/Tokyo", label: "UTC+9 - Japan Standard Time (JST)" },
    { value: "Australia/Sydney", label: "UTC+10 - Australian Eastern Time (AET)" },
    { value: "Pacific/Norfolk", label: "UTC+11 - Norfolk Time (NFT)" },
    { value: "Pacific/Auckland", label: "UTC+12 - New Zealand Time (NZT)" },
    { value: "Pacific/Tongatapu", label: "UTC+13 - Tonga Time (TOT)" },
    { value: "Pacific/Kiritimati", label: "UTC+14 - Line Islands Time (LINT)" },
  ];

  function parseFallbackName(label) {
    const raw = String(label || "");
    const dashIndex = raw.indexOf(" - ");
    if (dashIndex === -1) return raw;
    const withoutPrefix = raw.slice(dashIndex + 3).trim();
    return withoutPrefix.replace(/\s*\([^)]*\)\s*$/, "").trim();
  }

  function parseFallbackAbbreviation(label) {
    const match = String(label || "").match(/\(([^)]+)\)\s*$/);
    return match ? match[1].trim() : "";
  }

  function getTimeZoneNamePart(timeZone, timeZoneName, date) {
    try {
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZoneName,
      });
      const parts = formatter.formatToParts(date);
      const zonePart = parts.find((part) => part.type === "timeZoneName");
      return zonePart ? zonePart.value : "";
    } catch (_) {
      return "";
    }
  }

  function getTimeZoneOffsetMinutes(timeZone, date) {
    try {
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      });
      const parts = formatter.formatToParts(date);
      const values = Object.create(null);
      parts.forEach((part) => {
        if (part.type !== "literal") {
          values[part.type] = part.value;
        }
      });

      const utcMillis = Date.UTC(
        Number(values.year),
        Number(values.month) - 1,
        Number(values.day),
        Number(values.hour),
        Number(values.minute),
        Number(values.second)
      );
      return Math.round((utcMillis - date.getTime()) / 60000);
    } catch (_) {
      return 0;
    }
  }

  function formatUtcOffset(minutes) {
    const sign = minutes < 0 ? "-" : "+";
    const absMinutes = Math.abs(minutes);
    const hours = Math.floor(absMinutes / 60);
    const mins = absMinutes % 60;
    const paddedHours = String(hours);
    const paddedMinutes = String(mins).padStart(2, "0");
    return mins === 0
      ? `UTC${sign}${paddedHours}`
      : `UTC${sign}${paddedHours}:${paddedMinutes}`;
  }

  function buildCurrentLabel(option, now) {
    const timeZone = option.value;
    const fallbackName = parseFallbackName(option.label);
    const fallbackAbbreviation = parseFallbackAbbreviation(option.label);

    const longName = getTimeZoneNamePart(timeZone, "long", now) || fallbackName;
    const isCurrentlyDaylight = /daylight|summer/i.test(longName);

    // Preserve the original curated labels unless the zone is actively in DST/summer time.
    if (!isCurrentlyDaylight) {
      return option.label;
    }

    const offsetLabel = formatUtcOffset(getTimeZoneOffsetMinutes(timeZone, now));

    let shortName = getTimeZoneNamePart(timeZone, "short", now);
    if (!shortName || /^GMT|^UTC/.test(shortName)) {
      shortName = fallbackAbbreviation;
    }

    if (!shortName || shortName === longName) {
      return `${offsetLabel} - ${longName}`;
    }
    return `${offsetLabel} - ${longName} (${shortName})`;
  }

  function normalizeTimeZone(value) {
    const raw = String(value || "").trim();
    if (!raw) return FALLBACK_TIME_ZONE;

    try {
      Intl.DateTimeFormat("en-US", { timeZone: raw }).format(new Date());
      return raw;
    } catch (_) {
      return FALLBACK_TIME_ZONE;
    }
  }

  function getBrowserTimeZone() {
    try {
      return normalizeTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    } catch (_) {
      return FALLBACK_TIME_ZONE;
    }
  }

  function getTimeZoneOptions() {
    const now = new Date();
    return CURATED_TIME_ZONES.map((option) => ({
      value: option.value,
      label: buildCurrentLabel(option, now),
    }));
  }

  function getPreferredTimeZone() {
    try {
      return normalizeTimeZone(localStorage.getItem(STORAGE_KEY) || FALLBACK_TIME_ZONE);
    } catch (_) {
      return FALLBACK_TIME_ZONE;
    }
  }

  function setPreferredTimeZone(value) {
    const normalized = normalizeTimeZone(value);
    try {
      localStorage.setItem(STORAGE_KEY, normalized);
    } catch (_) {
      // Ignore storage failures so dashboards still work in restricted modes.
    }
    return normalized;
  }

  function formatUtcTimestamp(value, timeZone) {
    const raw = String(value || "").trim();
    if (!raw) {
      return { text: "n/a", timeZone: FALLBACK_TIME_ZONE };
    }

    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      return { text: raw, timeZone: FALLBACK_TIME_ZONE };
    }

    const normalizedTimeZone = normalizeTimeZone(timeZone);

    try {
      const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: normalizedTimeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZoneName: "short",
      });
      const parts = formatter.formatToParts(parsed);
      const values = Object.create(null);
      parts.forEach((part) => {
        values[part.type] = part.value;
      });
      return {
        text: `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute} ${values.timeZoneName || normalizedTimeZone}`,
        timeZone: normalizedTimeZone,
      };
    } catch (_) {
      return { text: raw, timeZone: FALLBACK_TIME_ZONE };
    }
  }

  globalScope.WSBDashboardTime = {
    STORAGE_KEY,
    FALLBACK_TIME_ZONE,
    getBrowserTimeZone,
    getPreferredTimeZone,
    setPreferredTimeZone,
    getTimeZoneOptions,
    formatUtcTimestamp,
  };
})(window);