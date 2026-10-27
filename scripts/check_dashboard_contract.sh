#!/usr/bin/env bash
set -euo pipefail

dashboard_dir="${1:-}"
if [[ -z "$dashboard_dir" ]]; then
  echo "Usage: $0 webapps/<dashboard_slug>" >&2
  exit 2
fi

if [[ ! -d "$dashboard_dir" ]]; then
  echo "Missing dashboard directory: $dashboard_dir" >&2
  exit 2
fi

required_files=(
  "$dashboard_dir/dashboard.html"
  "$dashboard_dir/dashboard_app.js"
)

for file in "${required_files[@]}"; do
  if [[ ! -f "$file" ]]; then
    echo "Missing required file: $file" >&2
    exit 1
  fi
done

html="$dashboard_dir/dashboard.html"
app="$dashboard_dir/dashboard_app.js"
css="$dashboard_dir/dashboard.css"
slug="$(basename "$dashboard_dir")"
# Shared daily-history controllers own the same required widget wiring.
app_sources=("$app")
if grep -Fq '../shared/daily_history_dashboard.js' "$html" && grep -Fq 'window.WSBDailyHistoryDashboard(' "$app"; then
  app_sources+=("$dashboard_dir/../shared/daily_history_dashboard.js")
fi

required_html_patterns=(
  "../shared/dashboard_embed_modal.js"
  "../shared/dashboard_components.js"
  "../shared/dashboard_shared.css"
  "../shared/dashboard_controls.css"
  "class=\"title"
  "info-btn"
  "info-popover"
)

for pattern in "${required_html_patterns[@]}"; do
  if ! grep -Fq "$pattern" "$html"; then
    echo "Contract failure in $html: missing '$pattern'" >&2
    exit 1
  fi
done

if grep -Eq 'copy-link-btn|copyDashboardLink|copyLinkBtn' "$html"; then
  if ! grep -Fq '../shared/dashboard_share.js' "$html"; then
    echo "Contract failure in $html: copy links must load dashboard_share.js" >&2
    exit 1
  fi
fi

manifest="$dashboard_dir/dashboard_manifest.js"
if [[ -f "$manifest" ]]; then
  if ! grep -Fq "dashboard_manifest.js" "$html"; then
    echo "Contract failure in $html: dashboard_manifest.js exists but is not loaded" >&2
    exit 1
  fi
  if ! grep -Fq "window.WSBDashboardManifest" "$manifest"; then
    echo "Contract failure in $manifest: manifest must assign window.WSBDashboardManifest" >&2
    exit 1
  fi
fi

if grep -Fq "startDateBtn" "$html" || grep -Fq "endDateBtn" "$html" || grep -Fq "dateRangeStartBtn" "$html" || grep -Fq "dateRangeEndBtn" "$html"; then
  if grep -Fq "dateRangeStartBtn" "$html" || grep -Fq "dateRangeEndBtn" "$html"; then
    date_patterns=(
      "dateRangeStartBtn"
      "dateRangeEndBtn"
      "dateRangeStartInput"
      "dateRangeEndInput"
    )
  else
    date_patterns=(
      "startDateBtn"
      "endDateBtn"
      "startDateInput"
      "endDateInput"
    )
  fi
  for pattern in "${date_patterns[@]}"; do
    if ! grep -Fq "$pattern" "$html"; then
      echo "Contract failure in $html: date controls are incomplete, missing '$pattern'" >&2
      exit 1
    fi
  done

  if grep -Fq ".showPicker(" "${app_sources[@]}"; then
    echo "Contract failure in $app: standard dashboard date controls must use WSBDashboardComponents, not native showPicker()" >&2
    exit 1
  fi

  if ! grep -Eq "WSBDashboardComponents\\.(createDatePicker|makeDatePicker|bindDateRangePickers)" "${app_sources[@]}"; then
    echo "Contract failure in $app: date controls must use WSBDashboardComponents" >&2
    exit 1
  fi

  if [[ "$slug" != "patoshi_pattern" ]]; then
    if grep -Fq ".date-picker-popup" "$html"; then
      echo "Contract failure in $html: date picker CSS belongs in webapps/shared/dashboard_controls.css" >&2
      exit 1
    fi
    if [[ -f "$css" ]] && grep -Fq ".date-picker-popup" "$css"; then
      echo "Contract failure in $css: date picker CSS belongs in webapps/shared/dashboard_controls.css" >&2
      exit 1
    fi
  fi
fi

if grep -Fq "dateRangeSettings" "$html"; then
  if ! grep -Fq "date-range-download-settings-menu" "$html" && ! grep -Fq "date-range-settings-menu" "$html"; then
    echo "Contract failure in $html: playback/export controls are incomplete, missing settings menu class" >&2
    exit 1
  fi
  if ! grep -Fq "date-range-playback-btn" "$html"; then
    echo "Contract failure in $html: playback/export controls are incomplete, missing 'date-range-playback-btn'" >&2
    exit 1
  fi
fi

if grep -Eq "downloadEstimate(Size|Length|Time)|Download Animation|dateRangeDownloadBtn|downloadSettingsDownloadBtn" "$html"; then
  if ! grep -Fq "../shared/dashboard_export.js" "$html"; then
    echo "Contract failure in $html: animation export dashboards must load ../shared/dashboard_export.js" >&2
    exit 1
  fi
  if ! grep -Fq "WSBDashboardExport" "${app_sources[@]}"; then
    echo "Contract failure in $app: animation export dashboards must use WSBDashboardExport" >&2
    exit 1
  fi
  if ! grep -Fq "WSBDashboardExport.estimateDownload" "${app_sources[@]}"; then
    echo "Contract failure in $app: animation export dashboards must use WSBDashboardExport.estimateDownload()" >&2
    exit 1
  fi
  if ! grep -Fq '../shared/dashboard_mp4.js' "$html"; then
    echo "Contract failure in $html: animation export dashboards must load ../shared/dashboard_mp4.js" >&2
    exit 1
  fi
fi

# Export feedback is shared, including dashboards using the daily-history controller.
if grep -Eq '\.(encodeVideo|encodeWebM)\(' "${app_sources[@]}"; then
  for pattern in 'VIDEO_FPS' '.renderProgress('; do
    if ! grep -Fq "$pattern" "${app_sources[@]}"; then
      echo "Contract failure in $app: video exports must use the shared export API ($pattern)" >&2
      exit 1
    fi
  done
  if grep -Eq '(EXPORT[^ =]*FPS[[:space:]]*=[[:space:]]*[0-9]|outputFps:[[:space:]]*[0-9])' "${app_sources[@]}"; then
    echo "Contract failure in $app: use WSBDashboardExport.VIDEO_FPS instead of a local numeric video frame rate" >&2
    exit 1
  fi
  if grep -Eq 'date-range-export-progress|date-range-export-stop-square' "$html" "${app_sources[@]}" || { [[ -f "$css" ]] && grep -Eq 'date-range-export-progress|date-range-export-stop-square' "$css"; }; then
    echo "Contract failure in $dashboard_dir: download progress markup/styles belong in the shared exporter and dashboard_shared.css" >&2
    exit 1
  fi
fi

if grep -Eq "new MediaRecorder|WSBMp4Muxer|12_mp4_muxer|mp4_muxer|function (encodeMp4|buildMp4Blob)|const (encodeMp4|buildMp4Blob)" "$html" "${app_sources[@]}"; then
  echo "Contract failure: video encoding and muxing belong in the shared deterministic exporter" >&2
  exit 1
fi

if grep -Eq "function (buildWebMBlob|webmSimpleBlock|ebmlElement|ebmlUint)|const (buildWebMBlob|webmSimpleBlock|ebmlElement|ebmlUint)" "${app_sources[@]}"; then
  echo "Contract failure in $app: WebM/EBML helpers belong in webapps/shared/dashboard_export.js" >&2
  exit 1
fi

if grep -Fq "copyDashboardLink" "$html"; then
  if grep -Fq "navigator.clipboard.writeText" "${app_sources[@]}"; then
    echo "Contract failure in $app: copy link buttons must use WSBDashboardComponents.copyDashboardLink()" >&2
    exit 1
  fi
  if ! grep -Eq 'WSBDashboardComponents(\?\.|\.)(copyDashboardLink|bindDashboardActions|initDashboardRuntime)(\?\.)?[[:space:]]*\(' "${app_sources[@]}"; then
    echo "Contract failure in $app: copy link buttons must use WSBDashboardComponents.copyDashboardLink(), bindDashboardActions(), or initDashboardRuntime()" >&2
    exit 1
  fi
fi

if grep -Fq "resetDashboard" "$html"; then
  if grep -Fq "reset-dashboard-btn--undo" "${app_sources[@]}" && ! grep -Eq 'WSBDashboardComponents(\?\.|\.)(setResetButtonState|bindDashboardActions|initDashboardRuntime)(\?\.)?[[:space:]]*\(' "${app_sources[@]}"; then
    echo "Contract failure in $app: reset button UI must use WSBDashboardComponents.setResetButtonState() or bindDashboardActions()" >&2
    exit 1
  fi
fi

if grep -Fq "updatedTimeZoneSelect" "$html"; then
  if ! grep -Fq "../../js/11_dashboard_timezone_preferences.js" "$html"; then
    echo "Contract failure in $html: Updated KPI timezone chips must load ../../js/11_dashboard_timezone_preferences.js" >&2
    exit 1
  fi
  if ! grep -Fq "WSBDashboardComponents" "${app_sources[@]}" || ! grep -Fq "createUpdatedTimeZoneChipController" "${app_sources[@]}"; then
    echo "Contract failure in $app: Updated KPI timezone chips must use WSBDashboardComponents.createUpdatedTimeZoneChipController()" >&2
    exit 1
  fi
fi

if grep -Eq "<canvas|id=\"costBasisChart\"|class=\"historical-svg\"" "$html"; then
  if ! grep -Eq "dashboard-ring-loader|panel-loader|loading-ring|uoa-loading|issuance-loading|historical-chart-loading|stage-loading-ring" "$html" "${app_sources[@]}" "$css" 2>/dev/null; then
    echo "Contract failure in $html: chart dashboards must include a shared ring loader pattern" >&2
    exit 1
  fi
fi

echo "Dashboard contract passed: $dashboard_dir"
