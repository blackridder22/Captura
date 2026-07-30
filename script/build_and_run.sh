#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
APP_NAME="Captura"
PROCESS_NAME="captura"
BUNDLE_ID="com.autoscale.captura"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_BUNDLE="$ROOT_DIR/src-tauri/target/release/bundle/macos/$APP_NAME.app"
APP_BINARY="$APP_BUNDLE/Contents/MacOS/$PROCESS_NAME"

pkill -x "$PROCESS_NAME" >/dev/null 2>&1 || true

cd "$ROOT_DIR"
if [[ "${CAPTURA_SKIP_BUILD:-0}" != "1" ]]; then
  pnpm tauri build --bundles app
fi

open_app() {
  /usr/bin/open -n "$APP_BUNDLE"
}

case "$MODE" in
  run)
    open_app
    ;;
  --debug|debug)
    lldb -- "$APP_BINARY"
    ;;
  --logs|logs)
    open_app
    /usr/bin/log stream --info --style compact --predicate "process == \"$PROCESS_NAME\""
    ;;
  --telemetry|telemetry)
    open_app
    /usr/bin/log stream --info --style compact --predicate "subsystem == \"$BUNDLE_ID\""
    ;;
  --verify|verify)
    open_app
    sleep 1
    pgrep -x "$PROCESS_NAME" >/dev/null
    ;;
  --smoke|smoke)
    REPORT="${CAPTURA_SMOKE_REPORT:-$(mktemp -t captura-smoke)}"
    # Launch the binary directly: `open` strips environment variables.
    CAPTURA_SMOKE=1 CAPTURA_SMOKE_REPORT="$REPORT" "$APP_BINARY" &
    APP_PID=$!
    for _ in $(seq 1 60); do
      kill -0 "$APP_PID" 2>/dev/null || break
      sleep 0.5
    done
    if kill -0 "$APP_PID" 2>/dev/null; then
      kill "$APP_PID" 2>/dev/null || true
      echo "smoke: app did not exit within 30s" >&2
      exit 1
    fi
    APP_EXIT=0
    wait "$APP_PID" || APP_EXIT=$?
    echo "smoke: app exit code $APP_EXIT"
    cat "$REPORT"
    REPORT_OK=0
    python3 -c 'import json,sys; sys.exit(0 if json.load(open(sys.argv[1]))["pass"] else 1)' "$REPORT" || REPORT_OK=$?
    [[ "$APP_EXIT" -eq 0 && "$REPORT_OK" -eq 0 ]]
    ;;
  *)
    echo "usage: $0 [run|--debug|--logs|--telemetry|--verify|--smoke]" >&2
    exit 2
    ;;
esac
