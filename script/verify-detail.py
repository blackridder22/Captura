#!/usr/bin/env python3
"""Verify the capture page in the isolated packaged main WKWebView (0.0.8+).

Usage: python3 script/verify-detail.py [--app PATH]

Launches its own CAPTURA_TEST_MODE instance (never the installed app), drives
the page with programmatic DOM events and Tiptap commands, and reads the
database back through the same IPC the UI uses. This verifies React, Tauri
and SQLite together; it does not claim physical pointer or keyboard
verification (see docs/performance and the native key QA for that).
Exit code 0 only when every check passes; the JSON report goes to stdout.
"""
from __future__ import annotations

import argparse
import json
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import perf  # noqa: E402  (QA client, launch/stop, in-webview helpers)

parser = argparse.ArgumentParser()
parser.add_argument("--app", default=str(perf.DEFAULT_APP))
parser.add_argument("--work-root", default=None)
args = parser.parse_args()

work_root = Path(args.work_root) if args.work_root else Path(tempfile.mkdtemp(prefix="captura-detail-"))
process, qa, _, _ = perf.launch(perf.resolve_binary(Path(args.app)), work_root / "run")
report: dict = {"layer": "packaged main WKWebView, programmatic DOM actions", "checks": {}, "run_dir": str(work_root)}
failures: list[str] = []


def check(name: str, ok: bool, detail=None) -> None:
    report["checks"][name] = bool(ok)
    if detail is not None:
        report.setdefault("details", {})[name] = detail
    if not ok:
        failures.append(name)


def js(script: str):
    return qa.js(script)


def wait(script: str, timeout: float = 10.0):
    return qa.wait(script, timeout)


def invoke(command: str, payload: dict):
    return qa.run_async(f"return await window.__perf.invoke({json.dumps(command)}, {json.dumps(payload)});")


def click(label: str, scope: str = ".capture-page-host") -> None:
    found = js(f"(()=>{{const b=[...document.querySelectorAll({json.dumps(scope + ' button')})].find(b=>b.textContent.trim()==={json.dumps(label)}||b.getAttribute('aria-label')==={json.dumps(label)});if(!b)return false;b.click();return true}})()")
    if not found:
        raise AssertionError(f"button missing: {label}")


def open_row(title: str, mode: str = "edit") -> None:
    row = f"[...document.querySelectorAll('.queue-item')].find(r=>r.textContent.includes({json.dumps(title)}))"
    wait(f"Boolean({row})")
    if mode == "preview":
        js(f"(()=>{{const r={row};r.click();r.dispatchEvent(new MouseEvent('dblclick',{{bubbles:true}}));return true}})()")
    else:
        # Row actions render once the row is selected; click, wait for the pencil, then edit.
        js(f"(()=>{{const r={row};r.click();return true}})()")
        wait(f"!!({row})?.querySelector('[aria-label=\"Edit capture\"]')")
        js(f"(()=>{{const r={row};r.querySelector('[aria-label=\"Edit capture\"]').click();return true}})()")
    wait("!!document.querySelector('.capture-page-host .ProseMirror, .capture-page-host .cm-editor, .capture-page-host .caption-field')")


def page_closed() -> None:
    wait("!document.querySelector('.capture-page-host')")


def editor_insert(text: str) -> None:
    js(f"document.querySelector('.ProseMirror').editor.chain().focus('end').insertContent({json.dumps(text)}).run();true")


def source_value() -> str:
    return js("document.querySelector('.cm-content')?.cmView?.view.state.doc.toString() ?? [...document.querySelectorAll('.cm-line')].map(l=>l.textContent).join('\\n')")


try:
    qa.request("show")
    wait("!!document.querySelector('.queue-list')")
    js(perf.HELPERS)
    js("(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Continue in limited mode');b&&b.click();return true})()")
    windows_before = qa.request("webview-windows")
    geometry_before = qa.request("geometry", window="main")

    title = "Capture page QA"
    source = "# " + title + "\n\nBody paragraph with **bold** and `code`.\n\n- first point\n- second point\n\n> A quote stays inside Captura.\n"
    item = invoke("create_item", {"content": source, "kind": "note", "sourceApp": "Detail verification"})

    # 1. Opening shows a full page inside the panel, editor focused, queue inert.
    scroll_before = js("document.querySelector('.queue-list').scrollTop")
    open_row(title)
    layout = json.loads(js("JSON.stringify((()=>{const p=document.querySelector('.captura-panel').getBoundingClientRect(),h=document.querySelector('.capture-page-host').getBoundingClientRect();return {fills:Math.abs(h.width-p.width)<=2&&Math.abs(h.height-p.height)<=2,inert:document.querySelector('.queue-view').hasAttribute('inert'),backdrop:!!document.querySelector('.sheet-backdrop'),focused:document.activeElement?.classList.contains('ProseMirror'),title:document.getElementById('capture-sheet-title')?.textContent,h1:document.querySelector('.ProseMirror h1')?.textContent}})())"))
    check("page_fills_panel_editor_focused_queue_inert", layout["fills"] and layout["inert"] and not layout["backdrop"] and layout["focused"] and layout["h1"] == title, layout)
    qa.request("snapshot", window="main", filename="page-open.png")

    # 2. Source shows the exact Markdown; switching back keeps the page; nothing was written.
    click("Source")
    wait("!!document.querySelector('.capture-page-host .cm-editor')")
    check("source_view_shows_exact_markdown", source_value() == source.rstrip("\n") or source_value() == source, source_value()[:60])
    click("Page")
    wait("!!document.querySelector('.capture-page-host .ProseMirror')")
    check("no_write_without_an_edit", invoke("get_capture_details", {"ids": [item["id"]]})[0]["content"] == source)

    # 3. An edit autosaves as Markdown against the expected version.
    editor_insert(" Edited on the page.")
    wait("document.querySelector('.capture-save-status')?.textContent==='Unsaved'", 3)
    wait("document.querySelector('.capture-save-status')?.textContent==='Saved'", 5)
    saved = invoke("get_capture_details", {"ids": [item["id"]]})[0]
    check("page_edit_autosaves_markdown", saved["content"].startswith("# " + title) and "Edited on the page." in saved["content"] and saved["updatedAt"] != item["updatedAt"], saved["content"][:80])

    # 4. A change elsewhere keeps the draft and says so; the draft is never clobbered.
    editor_insert(" Draft after conflict.")
    wait("document.querySelector('.capture-save-status')?.textContent==='Unsaved'", 3)
    invoke("update_item", {"id": item["id"], "content": "Changed elsewhere", "kind": "note", "expectedUpdatedAt": saved["updatedAt"]})
    wait("[...document.querySelectorAll('.capture-notice')].some(n=>n.textContent.includes('changed elsewhere'))", 8)
    check("remote_change_keeps_draft_with_notice", js("document.querySelector('.ProseMirror').textContent.includes('Draft after conflict.')"))
    db_after = invoke("get_capture_details", {"ids": [item["id"]]})[0]["content"]
    check("draft_does_not_clobber_remote_change", db_after == "Changed elsewhere", db_after)
    # Closing with a draft that cannot be saved raises the Retry / Discard dialog instead of losing it.
    click("Close capture")
    wait("!!document.querySelector('.capture-page-host [role=alertdialog]')", 5)
    check("close_with_unsavable_draft_asks_first", js("document.querySelector('.ProseMirror').textContent.includes('Draft after conflict.')"))
    click("Discard", ".capture-page-host [role=alertdialog]")
    page_closed()
    check("close_returns_to_same_queue_position_and_queue_live", js("document.querySelector('.queue-list').scrollTop") == scroll_before and not js("document.querySelector('.queue-view').hasAttribute('inert')"))

    # 5. Lossy Markdown opens in Source with a way back to the page.
    lossy_title = "Table capture"
    lossy = "# " + lossy_title + "\n\n| a | b |\n|---|---|\n| 1 | 2 |\n"
    invoke("create_item", {"content": lossy, "kind": "note", "sourceApp": "Detail verification"})
    open_row(lossy_title)
    check("lossy_markdown_opens_in_source_with_notice", js("!!document.querySelector('.capture-page-host .cm-editor')") and js("[...document.querySelectorAll('.capture-notice')].some(n=>n.textContent.includes('Opened in Source'))"))
    click("Open as page anyway")
    wait("!!document.querySelector('.capture-page-host .ProseMirror')")
    check("open_as_page_anyway_works", js("document.querySelector('.ProseMirror h1')?.textContent") == lossy_title)
    click("Close capture")
    page_closed()

    # 6. A trashed capture opens read-only with Restore. (Step 4 renamed it.)
    current_title = "Changed elsewhere"
    invoke("delete_item", {"id": item["id"]})
    js("[...document.querySelectorAll('.filter-tabs button')].find(b=>b.dataset.filter==='trash').click();true")
    open_row(current_title, mode="preview")
    ro = json.loads(js("JSON.stringify({editable:document.querySelector('.ProseMirror')?.getAttribute('contenteditable'),restore:[...document.querySelectorAll('.capture-page-host button')].some(b=>b.textContent.trim()==='Restore'),status:document.querySelector('.capture-save-status')?.textContent})"))
    check("trashed_capture_is_read_only_with_restore", ro["editable"] == "false" and ro["restore"], ro)
    click("Restore")
    wait("document.querySelector('.ProseMirror')?.getAttribute('contenteditable')==='true'", 5)
    check("restore_makes_it_editable_again", True)
    click("Close capture")
    page_closed()

    # 7. Escape inside the page closes it; no new webview or window resize.
    js("[...document.querySelectorAll('.filter-tabs button')].find(b=>b.dataset.filter==='inbox').click();true")
    open_row(current_title)
    js("document.querySelector('.ProseMirror').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));true")
    page_closed()
    check("escape_closes_page", True)
    check("no_new_webview_or_resize", qa.request("webview-windows") == windows_before and qa.request("geometry", window="main") == geometry_before)
except Exception as error:  # noqa: BLE001
    report["error"] = repr(error)
    failures.append("exception")
finally:
    report["stop"] = perf.stop(process, qa)

report["pass"] = not failures
report["failures"] = failures
print(json.dumps(report, indent=2))
sys.exit(0 if report["pass"] else 1)
