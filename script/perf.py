#!/usr/bin/env python3
"""Measure packaged Captura latency through the opt-in isolated QA harness.

Usage:
  python3 script/perf.py [--app PATH] [--seed 300] [--work-root DIR] [--json OUT]

Everything runs against a freshly created, isolated store:
  CAPTURA_TEST_MODE=1, CAPTURA_DATA_DIR=<run>/data, CAPTURA_QA_DIR=<run>/qa
(test mode also puts backups in <run>/data.backup and diagnostics in
<run>/Logs/Captura). The user's real Captura data, backups, and running
process are never touched: this script only signals the PID it spawned.

Interaction timings are taken INSIDE the WKWebView with performance.now() and
returned through `eval`, so the QA harness's 25 ms request polling does not
quantize them. Only cold-start wall times are measured from Python.
Every interaction metric uses 3 warmups + 30 samples (configurable) and
reports min / median / p95 (nearest rank) in milliseconds.

Never use script/build_and_run.sh for this: it runs `pkill -x captura`.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
from pathlib import Path
import re
import signal
import statistics
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_APP = ROOT / "src-tauri/target/release/bundle/macos/Captura.app"
DETAIL_TITLE = "Perf detail capture"
DETAIL_END = "PERF-END-MARKER"
TARGETS = {
    "warm_panel_qa_show": 150.0,
    "warm_panel_invoke_show": 150.0,
    "detail_open": 250.0,
    "composer_typing": 50.0,
}


# --------------------------------------------------------------------------
# QA client (same file protocol as script/qa.py, but importable and faster)
# --------------------------------------------------------------------------
class QAError(RuntimeError):
    pass


class QA:
    def __init__(self, directory: Path):
        self.directory = directory

    def request(self, action: str, timeout: float = 30.0, **fields):
        request = {"action": action, **fields, "id": str(uuid.uuid4())}
        temporary = self.directory / "request.tmp"
        temporary.write_text(json.dumps(request))
        os.replace(temporary, self.directory / "request.json")
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                response = json.loads((self.directory / "response.json").read_text())
                if response.get("id") == request["id"]:
                    if not response.get("ok"):
                        raise QAError(f"{action}: {response.get('error')}")
                    return response.get("value")
            except (OSError, json.JSONDecodeError):
                pass
            time.sleep(0.005)
        raise QAError(f"QA action {action!r} did not answer within {timeout}s")

    def js(self, script: str):
        return self.request("eval", window="main", script=script)

    def run_async(self, body: str, timeout: float = 120.0):
        """Run `body` as an async function in the main webview; return its value."""
        key = "__perfResult_" + uuid.uuid4().hex
        self.js(
            f"window.{key}=undefined;(async()=>{{{body}}})()"
            f".then(v=>{{window.{key}={{ok:true,value:v===undefined?null:v}}}},"
            f"e=>{{window.{key}={{ok:false,error:String((e&&e.stack)||e)}}}});true"
        )
        deadline = time.monotonic() + timeout
        poll = f"(()=>{{const r=window.{key};if(r===undefined)return null;delete window.{key};return r}})()"
        while time.monotonic() < deadline:
            result = self.js(poll)
            if result:
                if not result.get("ok"):
                    raise QAError(result.get("error"))
                return result.get("value")
            time.sleep(0.02)
        raise QAError(f"async webview task timed out after {timeout}s")

    def wait(self, script: str, timeout: float = 20.0):
        deadline = time.monotonic() + timeout
        last_error = None
        while time.monotonic() < deadline:
            try:
                value = self.js(script)
            except QAError as error:  # the webview may not accept eval yet
                last_error, value = error, None
            if value:
                return value
            time.sleep(0.05)
        raise QAError(f"timed out waiting for: {script} (last error: {last_error})")


# Installed once per page load; all measurement helpers live here.
HELPERS = r"""
window.__perf = {
  now: () => performance.now(),
  invoke: (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args || {}),
  // Second rAF callback runs after the frame produced by the first one painted.
  frames: () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now())))),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  waitFor(predicate, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      if (predicate()) return resolve(performance.now());
      const observer = new MutationObserver(() => {
        if (predicate()) { observer.disconnect(); clearTimeout(timer); resolve(performance.now()); }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
      const timer = setTimeout(() => { observer.disconnect(); reject(new Error('waitFor timeout')); }, timeoutMs);
    });
  },
  setValue(element, value) {
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  },
  async settle() { await this.frames(); await this.sleep(40); },
};
true
"""


# --------------------------------------------------------------------------
# Dataset
# --------------------------------------------------------------------------
def ten_kib_markdown() -> str:
    head = f"# {DETAIL_TITLE}\n\nA 10 KiB Markdown capture used by script/perf.py.\n\n"
    tail = f"\n\n**{DETAIL_END}**\n"
    blocks = []
    i = 0
    while len(head) + sum(len(b) for b in blocks) + len(tail) < 10240 + 400:
        i += 1
        blocks.append(
            f"## Section {i}\n\n"
            f"Paragraph {i} keeps **bold**, _emphasis_, `inline code`, and a "
            f"[link](https://example.com/perf/{i}) so the renderer does real work.\n\n"
            f"- first point for section {i}\n- second point with `code`\n- third point\n\n"
            f"> Quote {i}: capture now, keep moving.\n\n"
            f"```ts\nconst section{i} = {i} * 2;\n```\n\n"
        )
    body = "".join(blocks)
    body = body[: 10240 - len(head) - len(tail)]
    text = head + body + tail
    assert len(text.encode()) == 10240, len(text.encode())
    return text


def seed_dataset(count: int, throwaways: int):
    """Return (throwaway items, main items). Main items end with the 10 KiB capture
    so it is the newest (first) row in the queue."""
    junk = [{"content": f"Perf throwaway {n} delete me", "kind": "note"} for n in range(throwaways)]
    items = []
    for n in range(count - 1):
        mode = n % 3
        if mode == 0:
            items.append({"content": f"Perf note {n}: follow up on the release checklist and keep the queue calm.", "kind": "note"})
        elif mode == 1:
            items.append({"content": f"Perf prompt {n}: Rewrite this answer as three sharper launch hooks for the AI workflow.", "kind": "prompt"})
        else:
            items.append({"content": f"https://example.com/perf/link/{n}?ref=captura", "kind": "link"})
    items.append({"content": ten_kib_markdown(), "kind": "note"})
    return junk, items


# --------------------------------------------------------------------------
# Statistics / formatting
# --------------------------------------------------------------------------
def summarize(samples):
    ordered = sorted(samples)
    rank = max(1, math.ceil(0.95 * len(ordered)))
    return {
        "n": len(ordered),
        "min": ordered[0],
        "median": statistics.median(ordered),
        "p95": ordered[rank - 1],
        "max": ordered[-1],
    }


def fmt(value):
    return "—" if value is None else f"{value:.1f}"


def parse_utc(text: str) -> float:
    # chrono's to_rfc3339 emits up to 9 fractional digits; Python wants <= 6.
    match = re.match(r"(.*T\d\d:\d\d:\d\d)(\.\d+)?(.*)$", text)
    base, fraction, zone = match.group(1), (match.group(2) or ".0")[:7], match.group(3)
    zone = "+00:00" if zone in ("Z", "") else zone
    return dt.datetime.fromisoformat(base + fraction + zone).timestamp()


# --------------------------------------------------------------------------
# Process control (only ever the PID we spawned)
# --------------------------------------------------------------------------
def resolve_binary(app: Path) -> Path:
    if app.suffix == ".app":
        return app / "Contents/MacOS/captura"
    return app


def launch(binary: Path, run_dir: Path):
    data_dir, qa_dir = run_dir / "data", run_dir / "qa"
    data_dir.mkdir(parents=True, exist_ok=True)
    qa_dir.mkdir(parents=True, exist_ok=True)
    for stale in ("request.json", "response.json"):
        try:
            (qa_dir / stale).unlink()
        except FileNotFoundError:
            pass
    env = dict(os.environ, CAPTURA_TEST_MODE="1", CAPTURA_DATA_DIR=str(data_dir), CAPTURA_QA_DIR=str(qa_dir))
    log = open(run_dir / f"app-{int(time.time() * 1000)}.log", "w")
    spawn_epoch = time.time()
    spawn_mono = time.monotonic()
    process = subprocess.Popen([str(binary)], env=env, stdout=log, stderr=subprocess.STDOUT)
    qa = QA(qa_dir)
    # First answered `windows` request: the QA thread is up AND the main thread
    # services run_on_main. Includes up to one 25 ms polling interval.
    deadline = spawn_mono + 60
    first_windows = None
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise QAError(f"app exited during launch with code {process.returncode}")
        try:
            qa.request("windows", timeout=2)
            first_windows = (time.monotonic() - spawn_mono) * 1000
            break
        except QAError:
            continue
    if first_windows is None:
        raise QAError("QA harness never answered `windows`")
    return process, qa, spawn_epoch, first_windows


def stop(process: subprocess.Popen, qa: QA | None) -> str:
    if process.poll() is not None:
        return f"pid {process.pid} already exited ({process.returncode})"
    if qa is not None:
        try:
            qa.request("quit", timeout=5)
        except QAError:
            pass
        try:
            process.wait(timeout=10)
            return f"pid {process.pid} exited via QA quit ({process.returncode})"
        except subprocess.TimeoutExpired:
            pass
    os.kill(process.pid, signal.SIGTERM)
    try:
        process.wait(timeout=10)
        return f"pid {process.pid} exited after SIGTERM"
    except subprocess.TimeoutExpired:
        os.kill(process.pid, signal.SIGKILL)
        process.wait(timeout=10)
        return f"pid {process.pid} killed with SIGKILL"


def diagnostics_offsets(run_dir: Path, spawn_epoch: float, pid: int):
    path = run_dir / "Logs/Captura/diagnostics.jsonl"
    if not path.exists():
        return None
    offsets = {}
    for line in path.read_text().splitlines():
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        if entry.get("pid") != pid:
            continue
        event = entry.get("event")
        if event in ("startup_probe", "storage_ready", "database_open_succeeded", "backup_result") and event not in offsets:
            offsets[event] = (parse_utc(entry["at_utc"]) - spawn_epoch) * 1000
    return {"path": str(path), "offsets_ms": offsets}


# --------------------------------------------------------------------------
# Measurements
# --------------------------------------------------------------------------
def measure_invoke_loop(qa: QA, command: str, args_list_js: str, total: int):
    body = f"""
const P = window.__perf; const argsList = {args_list_js}; const out = [];
for (let i = 0; i < {total}; i++) {{
  const args = argsList(i);
  const t0 = performance.now();
  await P.invoke({json.dumps(command)}, args);
  out.push(performance.now() - t0);
  await P.settle();
}}
return out;"""
    return qa.run_async(body, timeout=300)


def measure_detail(qa: QA, total: int):
    body = f"""
const P = window.__perf; const out = []; const ready = []; let complete = true; const views = {{}};
// 0.0.8+: the capture sheet is a single page (Tiptap page, CodeMirror source, or
// an image caption). Before 0.0.8 it was `.capture-sheet textarea, .capture-sheet
// [data-capture-preview]`. The page element still carries `.capture-sheet`.
const sheetReady = () => document.querySelector('.capture-page .ProseMirror, .capture-page .cm-editor, .capture-page .caption-field');
for (let i = 0; i < {total}; i++) {{
  if (document.querySelector('.capture-sheet')) throw new Error('sheet still open');
  const row = document.querySelector('.queue-item');
  if (!row || !row.textContent.includes({json.dumps(DETAIL_TITLE)})) throw new Error('10 KiB capture is not the first row');
  const t0 = performance.now();
  row.dispatchEvent(new MouseEvent('dblclick', {{ bubbles: true, cancelable: true }}));
  const tReady = await P.waitFor(sheetReady, 5000);
  const tPaint = await P.frames();
  ready.push(tReady - t0); out.push(tPaint - t0);
  const target = sheetReady();
  const view = target.classList.contains('ProseMirror') ? 'page' : target.classList.contains('cm-editor') ? 'source' : 'caption';
  views[view] = (views[view] || 0) + 1;
  complete = complete && (target.value ?? target.textContent).includes({json.dumps(DETAIL_END)});
  target.dispatchEvent(new KeyboardEvent('keydown', {{ key: 'Escape', bubbles: true, cancelable: true }}));
  await P.waitFor(() => !document.querySelector('.capture-sheet'), 5000);
  await P.settle();
}}
return {{ paint: out, ready, complete, views }};"""
    return qa.run_async(body, timeout=300)


def measure_composer(qa: QA, text: str, total: int):
    body = f"""
const P = window.__perf; const text = {json.dumps(text)}; const out = []; const commit = [];
const area = document.querySelector('.quick-capture textarea');
if (!area) throw new Error('composer textarea missing');
for (let i = 0; i < {total}; i++) {{
  P.setValue(area, ''); await P.settle();
  const t0 = performance.now();
  P.setValue(area, text);
  const tCommit = performance.now();
  const tPaint = await P.frames();
  if (area.value.length !== text.length) throw new Error('composer did not accept value');
  commit.push(tCommit - t0); out.push(tPaint - t0);
}}
P.setValue(area, ''); await P.settle();
return {{ paint: out, commit }};"""
    return qa.run_async(body, timeout=300)


ARM_SHOW = r"""(() => {
const state = { events: [], t0: null, type: null, painted: null, snapshotPainted: null, snapshotResolved: null,
  hadFocus: document.hasFocus(), visibility: document.visibilityState };
window.__perfShow = state;
// __TAURI_INTERNALS__.invoke is read-only, but Tauri's macOS IPC goes through
// window.fetch('ipc://localhost/<command>'), so observe the focus refresh there.
const originalFetch = window.fetch;
let wrapped = false;
try {
  window.fetch = function (input, ...rest) {
    const promise = originalFetch.call(this, input, ...rest);
    const url = String((input && input.url) || input);
    // The app's own focus listener runs (and reaches fetch through a microtask)
    // before ours, so accept the first snapshot request after arming.
    if (url.endsWith('/snapshot_queue') && state.snapshotResolved === null) {
      promise.then(() => {
        if (state.snapshotResolved !== null) return;
        state.snapshotResolved = performance.now();
        window.__perf.frames().then((t) => { state.snapshotPainted = t; });
      }, () => {});
    }
    return promise;
  };
  wrapped = window.fetch !== originalFetch;
} catch (error) { wrapped = false; }
state.wrapped = wrapped;
const start = (type) => {
  state.events.push([type, performance.now(), document.visibilityState, document.hasFocus()]);
  if (state.t0 !== null) return;
  state.t0 = performance.now(); state.type = type;
  window.__perf.frames().then((t) => { state.painted = t; });
};
const onFocus = () => start('focus');
const onVisibility = () => { if (document.visibilityState === 'visible') start('visibilitychange'); };
window.addEventListener('focus', onFocus);
document.addEventListener('visibilitychange', onVisibility);
state.restore = () => {
  if (wrapped) window.fetch = originalFetch;
  window.removeEventListener('focus', onFocus);
  document.removeEventListener('visibilitychange', onVisibility);
};
})();
"""


def measure_warm_panel(qa: QA, total: int, mode: str):
    """mode 'qa': native show via QA `show` (identical to tray/shortcut present_main_window).
    mode 'invoke': the webview itself invokes show_main_window; also timed from the request."""
    paint, refreshed, from_request, focus_lag, failures, types, wrapped = [], [], [], [], [], {}, None
    for i in range(total):
        qa.run_async("await window.__perf.invoke('hide_main_window'); return true;", timeout=10)
        time.sleep(0.35)  # let WebKit deliver blur/visibility before arming listeners
        qa.js(ARM_SHOW + "true")
        if mode == "qa":
            qa.request("show")
        else:
            qa.js("window.__perfShow.request = performance.now(); void window.__perf.invoke('show_main_window'); true")
        deadline = time.monotonic() + 4
        painted_seen = None
        state = None
        while time.monotonic() < deadline:
            state = qa.js("(()=>{const s=window.__perfShow;return {t0:s.t0,type:s.type,painted:s.painted,request:s.request??null,"
                          "snapshotPainted:s.snapshotPainted,snapshotResolved:s.snapshotResolved,wrapped:s.wrapped,"
                          "hadFocus:s.hadFocus,visibility:s.visibility,events:s.events}})()")
            if state["painted"] is not None:
                painted_seen = painted_seen or time.monotonic()
                # The focus refresh only runs when `focus` fires; give it 1.5 s.
                if not state["wrapped"] or state["snapshotPainted"] is not None or time.monotonic() - painted_seen > 1.5:
                    break
            time.sleep(0.02)
        qa.js("window.__perfShow&&window.__perfShow.restore();true")
        wrapped = state and state["wrapped"]
        if not state or state["painted"] is None:
            failures.append({"sample": i, "state": state})
            continue
        types[state["type"]] = types.get(state["type"], 0) + 1
        paint.append(state["painted"] - state["t0"])
        if state["snapshotPainted"] is not None:
            refreshed.append(state["snapshotPainted"] - state["t0"])
        if mode == "invoke" and state["request"] is not None:
            from_request.append(state["painted"] - state["request"])
            focus_lag.append(state["t0"] - state["request"])
        time.sleep(0.15)
    return {"paint": paint, "refreshed": refreshed, "from_request": from_request, "request_to_event": focus_lag,
            "failures": failures, "event_types": types, "fetch_wrapped": wrapped}


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------
def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--app", type=Path, default=DEFAULT_APP, help="Captura.app bundle or its Contents/MacOS/captura binary")
    parser.add_argument("--seed", type=int, default=300, help="captures in the measured queue (includes one 10 KiB capture)")
    parser.add_argument("--warmups", type=int, default=3)
    parser.add_argument("--samples", type=int, default=30)
    parser.add_argument("--cold-runs", type=int, default=3, help="extra relaunches against the seeded store")
    parser.add_argument("--work-root", type=Path, default=Path("/private/tmp/captura-perf-runs"))
    parser.add_argument("--json", type=Path, help="also write raw results here")
    options = parser.parse_args()

    home_library = (Path.home() / "Library").resolve()
    work_root = options.work_root.resolve()
    if work_root == home_library or home_library in work_root.parents:
        raise SystemExit("Refusing to use a work root inside ~/Library (real Captura data lives there).")
    binary = resolve_binary(options.app.resolve())
    if not binary.exists():
        raise SystemExit(f"App binary not found: {binary}")
    run_dir = work_root / ("run-" + dt.datetime.now().strftime("%Y%m%d-%H%M%S"))
    run_dir.mkdir(parents=True, exist_ok=False)
    total = options.warmups + options.samples
    warm = options.warmups

    results = {"binary": str(binary), "run_dir": str(run_dir), "seed": options.seed,
               "warmups": warm, "samples": options.samples, "metrics": {}, "notes": []}
    log = lambda message: print(f"[perf] {message}", file=sys.stderr, flush=True)

    process = qa = None
    try:
        log(f"launching {binary} (isolated run dir {run_dir})")
        process, qa, spawn_epoch, first_windows = launch(binary, run_dir)
        results["pid"] = process.pid
        log(f"pid {process.pid}; QA answered `windows` after {first_windows:.0f} ms")
        qa.wait("document.readyState==='complete'&&!!window.__TAURI_INTERNALS__&&!!document.querySelector('.queue-list')", 30)
        timing = qa.js("(()=>{const n=performance.getEntriesByType('navigation')[0];return {timeOrigin:performance.timeOrigin,"
                       "domContentLoaded:n?n.domContentLoadedEventEnd:null,load:n?n.loadEventEnd:null}})()")
        cold = {"spawn_to_first_windows_ms": first_windows, "store": "empty",
                "spawn_to_webview_navigation_ms": timing["timeOrigin"] - spawn_epoch * 1000,
                "webview_dom_content_loaded_ms": timing["domContentLoaded"],
                "diagnostics": diagnostics_offsets(run_dir, spawn_epoch, process.pid)}
        results["cold_start_empty"] = cold
        qa.js(HELPERS)
        results["timer_resolution_ms"] = qa.js(
            "(()=>{let m=Infinity,a=performance.now();for(let i=0;i<200000&&m>0.001;i++){const b=performance.now();if(b>a){m=Math.min(m,b-a);a=b}}return m})()")
        qa.request("show")
        qa.wait("document.visibilityState==='visible'", 10)
        # Keep the panel from auto-hiding if focus moves elsewhere mid-run; the
        # show path (present_main_window) is identical either way.
        qa.run_async("await window.__perf.invoke('set_keep_open', {keepOpen: true}); return true;")
        # The updater does one silent check 3 s after launch; let it pass.
        time.sleep(max(0.0, 4.5 - (time.time() - spawn_epoch)))

        junk, items = seed_dataset(options.seed, total)
        log(f"seeding {len(junk)} throwaway + {len(items)} measured captures")
        seeded = qa.run_async(f"""
const P = window.__perf; const junk = {json.dumps(junk)}; const items = {json.dumps(items)};
const junkIds = []; const ids = []; const times = [];
for (const item of junk) {{ const t0 = performance.now(); junkIds.push((await P.invoke('create_item', item)).id); times.push(performance.now() - t0); }}
for (const item of items) {{ const t0 = performance.now(); ids.push((await P.invoke('create_item', item)).id); times.push(performance.now() - t0); }}
return {{ junkIds, ids, times }};""", timeout=600)
        junk_ids, ids = seeded["junkIds"], seeded["ids"]
        results["seeding_create_item"] = summarize(seeded["times"])
        expected = len(junk_ids) + len(ids)
        qa.wait(f"document.querySelectorAll('.queue-item').length==={expected}", 30)
        qa.run_async("await window.__perf.sleep(500); await window.__perf.frames(); return true;")

        log("delete_item")
        samples = measure_invoke_loop(qa, "delete_item", f"(i)=>({{id:{json.dumps(junk_ids)}[i]}})", total)
        results["metrics"]["delete_item"] = summarize(samples[warm:])
        qa.wait(f"document.querySelectorAll('.queue-item').length==={len(ids)}", 30)

        toggle_id = ids[-2]  # a short note just below the 10 KiB capture
        rounds = total + (total % 2)  # even count leaves the capture open again
        log("toggle_item")
        samples = measure_invoke_loop(qa, "toggle_item", f"()=>({{id:{json.dumps(toggle_id)}}})", rounds)
        results["metrics"]["toggle_item"] = summarize(samples[warm:warm + options.samples])

        log("snapshot_queue")
        samples = measure_invoke_loop(qa, "snapshot_queue", "()=>({})", total)
        results["metrics"]["snapshot_queue"] = summarize(samples[warm:])
        # 0.0.8+: delete_item moves captures to Trash and snapshot_queue still returns
        # trashed rows, so the measured queue is the rows with deletedAt === null.
        sizes = qa.run_async("const s = await window.__perf.invoke('snapshot_queue');"
                             "return {all: s.items.length, live: s.items.filter((i) => (i.deletedAt ?? null) === null).length};")
        results["queue_size"] = sizes["live"]
        results["snapshot_rows_total"] = sizes["all"]

        log("detail open (10 KiB)")
        detail = measure_detail(qa, total)
        results["metrics"]["detail_open"] = summarize(detail["paint"][warm:])
        results["metrics"]["detail_open_dom_ready"] = summarize(detail["ready"][warm:])
        results["detail_full_text_rendered"] = detail["complete"]
        results["detail_views"] = detail.get("views")

        log("composer typing (10 KiB)")
        composer = measure_composer(qa, ten_kib_markdown(), total)
        results["metrics"]["composer_typing"] = summarize(composer["paint"][warm:])
        results["metrics"]["composer_typing_commit"] = summarize(composer["commit"][warm:])

        for mode in ("qa", "invoke"):
            log(f"warm panel ({mode} show)")
            panel = measure_warm_panel(qa, total, mode)
            key = f"warm_panel_{mode}_show"
            results[key + "_raw"] = {k: panel[k] for k in ("failures", "event_types", "fetch_wrapped")}
            usable = panel["paint"][warm:] if len(panel["paint"]) == total else panel["paint"]
            if len(panel["paint"]) < total:
                results["notes"].append(f"{key}: {len(panel['failures'])} of {total} samples saw neither focus nor visibilitychange+paint within 4 s")
            if usable:
                results["metrics"][key] = summarize(usable)
            refreshed = panel["refreshed"][warm:] if len(panel["refreshed"]) == total else panel["refreshed"]
            if refreshed:
                results["metrics"][key + "_refreshed"] = summarize(refreshed)
            if mode == "invoke" and panel["from_request"]:
                fr = panel["from_request"][warm:] if len(panel["from_request"]) == total else panel["from_request"]
                results["metrics"]["warm_panel_invoke_request_to_paint"] = summarize(fr)
        qa.request("show")
        log(stop(process, qa))
        process = None

        cold_runs = []
        for n in range(options.cold_runs):
            process, qa, spawn_epoch, first_windows = launch(binary, run_dir)
            qa.wait("document.readyState==='complete'&&!!document.querySelector('.queue-list')", 30)
            timing = qa.js("performance.timeOrigin")
            cold_runs.append({"pid": process.pid, "spawn_to_first_windows_ms": first_windows,
                              "spawn_to_webview_navigation_ms": timing - spawn_epoch * 1000,
                              "diagnostics": diagnostics_offsets(run_dir, spawn_epoch, process.pid)})
            log(f"cold run {n + 1}: pid {process.pid}, first windows {first_windows:.0f} ms; {stop(process, qa)}")
            process = None
        results["cold_start_seeded"] = cold_runs
    finally:
        if process is not None:
            log(stop(process, qa))

    print(render_markdown(results))
    out = options.json or (run_dir / "perf-results.json")
    out.write_text(json.dumps(results, indent=2) + "\n")
    log(f"raw results: {out}")
    return 0


LABELS = [
    ("toggle_item", "`invoke('toggle_item')` round trip", None),
    ("delete_item", "`invoke('delete_item')` round trip", None),
    ("snapshot_queue", "`invoke('snapshot_queue')` round trip", None),
    ("detail_open", "Detail open, 10 KiB (dblclick → sheet content + 2 rAF)", "detail_open"),
    ("detail_open_dom_ready", "  ↳ dblclick → sheet content in DOM", None),
    ("composer_typing", "Composer 10 KiB input → 2 rAF", "composer_typing"),
    ("composer_typing_commit", "  ↳ input event → React commit returned", None),
    ("warm_panel_qa_show", "Warm panel, QA `show`: focus/visibility event → 2 rAF", "warm_panel_qa_show"),
    ("warm_panel_qa_show_refreshed", "  ↳ event → focus-refresh snapshot reply + 2 rAF (≈)", None),
    ("warm_panel_invoke_show", "Warm panel, `invoke('show_main_window')`: event → 2 rAF", "warm_panel_invoke_show"),
    ("warm_panel_invoke_request_to_paint", "  ↳ show request (in webview) → 2 rAF", "warm_panel_invoke_show"),
    ("warm_panel_invoke_show_refreshed", "  ↳ event → focus-refresh snapshot reply + 2 rAF (≈)", None),
]


def render_markdown(results) -> str:
    metrics = results["metrics"]
    lines = [f"Queue: {results.get('queue_size')} captures (seed {results['seed']}, one 10 KiB Markdown); "
             f"{results['warmups']} warmups + {results['samples']} samples; ms. "
             f"WKWebView performance.now() resolution: {results.get('timer_resolution_ms', '?')} ms.", "",
             "| Metric | min | median | p95 | target p95 |", "|---|---:|---:|---:|---:|"]
    for key, label, target in LABELS:
        stats = metrics.get(key)
        goal = f"≤{TARGETS[target]:.0f}" if target else ""
        if stats is None:
            lines.append(f"| {label} | not measured | | | {goal} |")
        else:
            lines.append(f"| {label} | {fmt(stats['min'])} | {fmt(stats['median'])} | {fmt(stats['p95'])} | {goal} |")
    seed = results.get("seeding_create_item")
    if seed:
        lines.append(f"| `invoke('create_item')` while seeding (n={seed['n']}, 0→{results['seed'] + results['warmups'] + results['samples']} rows) | {fmt(seed['min'])} | {fmt(seed['median'])} | {fmt(seed['p95'])} | |")
    lines += ["", "Cold start (wall time from spawn, Python-side; first `windows` answer includes ≤25 ms QA polling):", "",
              "| Launch | spawn → QA `windows` answered | spawn → webview navigation start | spawn → startup_probe | spawn → storage_ready | spawn → database_open_succeeded |",
              "|---|---:|---:|---:|---:|---:|"]

    def cold_row(name, entry):
        diag = (entry.get("diagnostics") or {}).get("offsets_ms", {})
        return (f"| {name} | {fmt(entry['spawn_to_first_windows_ms'])} | {fmt(entry.get('spawn_to_webview_navigation_ms'))} | "
                f"{fmt(diag.get('startup_probe'))} | {fmt(diag.get('storage_ready'))} | {fmt(diag.get('database_open_succeeded'))} |")
    if "cold_start_empty" in results:
        lines.append(cold_row("empty store (first launch)", results["cold_start_empty"]))
    for n, entry in enumerate(results.get("cold_start_seeded", []), 1):
        lines.append(cold_row(f"seeded store ({results.get('queue_size')} captures) #{n}", entry))
    for key in ("warm_panel_qa_show_raw", "warm_panel_invoke_show_raw"):
        raw = results.get(key)
        if raw:
            lines.append("")
            lines.append(f"{key[:-4]}: start events {raw['event_types'] or 'none'}; failures {len(raw['failures'])}; "
                         f"focus-refresh observer (fetch wrapper) {'on' if raw['fetch_wrapped'] else 'unavailable'}.")
    if results.get("detail_full_text_rendered") is not None:
        lines.append(f"Detail sheet rendered full 10 KiB text: {results['detail_full_text_rendered']} (views {results.get('detail_views')}).")
    if results.get("snapshot_rows_total") is not None and results["snapshot_rows_total"] != results.get("queue_size"):
        lines.append(f"snapshot_queue returns {results['snapshot_rows_total']} rows ({results.get('queue_size')} live + trashed).")
    for note in results["notes"]:
        lines.append(f"Note: {note}")
    return "\n".join(lines)


if __name__ == "__main__":
    sys.exit(main())
