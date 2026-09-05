"""Verify centered overlays using the isolated packaged main WKWebView.

Programmatic DOM events exercise React/Tauri/SQLite together. This does not
claim physical pointer/keyboard or measured interaction-latency verification.
"""
import json
from pathlib import Path
import subprocess
import sys
import time
import uuid

root = Path(__file__).resolve().parent.parent
control = Path(sys.argv[1]).resolve()
report = {"layer": "packaged main WKWebView with programmatic DOM actions", "checks": {}}

def qa(action, **fields):
    result = subprocess.run([sys.executable, str(root / "script/qa.py"), str(control)], input=json.dumps({"action": action, **fields}), text=True, capture_output=True, check=True)
    return json.loads(result.stdout)["value"]

def js(script):
    return qa("eval", window="main", script=script)

def wait(script):
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        value = js(script)
        if value: return value
        time.sleep(.05)
    raise AssertionError(script)

def invoke(command, args):
    key = "qa" + uuid.uuid4().hex
    js(f"void window.__TAURI_INTERNALS__.invoke({json.dumps(command)},{json.dumps(args)}).then(value=>window.{key}={{value}},error=>window.{key}={{error:String(error)}})")
    result = wait(f"window.{key}")
    js(f"delete window.{key}")
    assert "error" not in result, result
    return result.get("value")

def click(label, selector=".capture-sheet button"):
    assert js(f"(()=>{{const b=[...document.querySelectorAll({json.dumps(selector)})].find(b=>b.textContent.trim()==={json.dumps(label)}||b.getAttribute('aria-label')==={json.dumps(label)});if(!b)return false;b.click();return true;}})()"), label

def draft(value):
    js("(()=>{const t=document.querySelector('.capture-sheet textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t," + json.dumps(value) + ");t.dispatchEvent(new Event('input',{bubbles:true}));return true})()")
    wait("document.querySelector('.capture-sheet .capture-status')?.textContent.includes('Unsaved')")

geometry = """(()=>{
const panel=document.querySelector('.captura-panel'),sheet=document.querySelector('.capture-sheet');
if(!panel||!sheet)return null;
const p=panel.getBoundingClientRect(),s=sheet.getBoundingClientRect();
return {panel:{x:p.x,y:p.y,width:p.width,height:p.height},sheet:{x:s.x,y:s.y,width:s.width,height:s.height},
centeredX:Math.abs((s.left+s.right-p.left-p.right)/2),centeredY:Math.abs((s.top+s.bottom-p.top-p.bottom)/2),
contained:s.left>=p.left&&s.right<=p.right&&s.top>=p.top&&s.bottom<=p.bottom,
samePanel:sheet.closest('.captura-panel')===panel,queueInert:document.querySelector('.queue-view').inert};
})()"""

def verify_geometry(mode):
    bounds = wait(f"(()=>{{const g={geometry};return g&&g.centeredX<1&&g.centeredY<1&&g}})()")
    assert bounds["contained"] and bounds["samePanel"] and bounds["queueInert"], bounds
    report[mode + "_geometry"] = bounds
    report["checks"][mode + "_centered_inside_main_panel"] = True

wait("!!document.querySelector('.queue-list')")
before = qa("webview-windows")
assert before == {"count": 2, "labels": ["capture-hud", "main"]}, before
report["windows_before"] = before
report["main_geometry_before"] = qa("geometry", window="main")
title = "Capture preview QA"
source = "# " + title + "\n\n## Project notes\n\n- Review the draft\n- Keep the useful details\n\n> A preview stays inside Captura.\n\n" + "\n\n".join(f"Paragraph {i}: full text remains available in the Markdown preview." for i in range(1, 41)) + "\n\n**End of the complete capture.**"
item = invoke("create_item", {"content": source, "kind": "note", "sourceApp": "Preview verification"})
row = f"[...document.querySelectorAll('.queue-item')].find(row=>row.textContent.includes({json.dumps(title)}))"
wait(f"Boolean({row})")
scroll_before = js("document.querySelector('.queue-list').scrollTop")
js(f"(()=>{{const row={row};row.click();row.dispatchEvent(new MouseEvent('dblclick',{{bubbles:true}}));return true}})()")
wait("document.querySelector('.capture-sheet h1')?.textContent==='Capture preview QA'")
assert js("!document.querySelector('.capture-sheet textarea')&&!document.querySelector('.capture-sheet [role=tablist]')")
verify_geometry("preview")
assert qa("webview-windows") == before
qa("snapshot", window="main", filename="preview-centered.png")
assert js("(()=>{const p=document.querySelector('[data-capture-preview]');return p.scrollHeight>p.clientHeight&&p.textContent.includes('End of the complete capture.')})()")
js("(()=>{const p=document.querySelector('[data-capture-preview]');p.scrollTop=p.scrollHeight;return true})()")
assert js("(()=>{const p=document.querySelector('[data-capture-preview]');return p.scrollTop>0&&p.scrollHeight-p.scrollTop-p.clientHeight<2})()")
report["checks"]["double_click_opens_readonly_markdown_with_full_text_scroll"] = True
click("Close capture")
wait("!document.querySelector('.capture-sheet')")
assert js("document.querySelector('.queue-list').scrollTop") == scroll_before
assert not js("document.querySelector('.queue-view').inert")
report["checks"]["close_returns_to_same_queue_position"] = True
js(f"(()=>{{const row={row};row.click();row.querySelector('[aria-label=\"Edit capture\"]').click();return true}})()")
wait("document.querySelector('.capture-sheet')?.dataset.mode==='edit'&&document.activeElement===document.querySelector('.capture-sheet textarea')")
assert js("document.querySelector('.capture-sheet textarea').value") == source
verify_geometry("editor")
assert qa("webview-windows") == before
qa("snapshot", window="main", filename="editor-centered.png")
report["checks"]["pencil_opens_editor_in_same_panel"] = True
exact = "  # Exact source\n\nNative **edit**  \n\n"
draft(exact)
click("Preview")
wait("document.querySelector('[data-capture-preview] h1')?.textContent==='Exact source'")
qa("snapshot", window="main", filename="editor-preview-centered.png")
click("Source")
assert js("document.querySelector('.capture-sheet textarea').value") == exact
report["checks"]["editor_tabs_keep_exact_draft"] = True
click("Close capture")
wait("!!document.querySelector('[role=alertdialog]')")
click("Cancel", "[role=alertdialog] button")
assert js("document.querySelector('.capture-sheet textarea').value") == exact
report["checks"]["cancel_keeps_unsaved_draft"] = True
click("Save changes")
wait("document.querySelector('.capture-sheet')?.dataset.mode==='preview'")
saved = invoke("get_capture_details", {"ids": [item["id"]]})[0]
assert saved["content"] == exact
report["checks"]["save_preserves_source_bytes"] = True
click("Edit")
draft("My conflicting draft")
invoke("update_item", {"id": item["id"], "content": "Updated saved content", "kind": "note", "expectedUpdatedAt": saved["updatedAt"]})
click("Save changes")
wait("document.querySelector('.capture-sheet [role=alert]')?.textContent.includes('changed')")
assert js("document.querySelector('.capture-sheet textarea').value") == "My conflicting draft"
assert js("document.activeElement===document.querySelector('.capture-sheet textarea')")
report["checks"]["stale_save_keeps_draft_and_focus"] = True
click("Cancel")
wait("!!document.querySelector('[role=alertdialog]')")
click("Discard", "[role=alertdialog] button")
wait("document.querySelector('[data-capture-preview]')?.textContent.includes('Updated saved content')")
report["checks"]["discard_loads_latest_saved_content"] = True
js("document.querySelector('[data-capture-preview]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));true")
wait("!document.querySelector('.capture-sheet')")
assert not js("document.querySelector('.queue-view').inert")
report["checks"]["escape_dismisses_overlay"] = True
report["windows_after"] = qa("webview-windows")
report["main_geometry_after"] = qa("geometry", window="main")
assert report["windows_after"] == before
assert report["main_geometry_before"] == report["main_geometry_after"]
report["checks"]["no_new_webview_or_window_resize"] = True
report["pass"] = all(report["checks"].values())
(control.parent / "detail-verification.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
