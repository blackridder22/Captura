"""Functional QA against the isolated, running packaged WKWebView.

DOM actions exercise real React/Tauri/SQLite integration. They do not claim
physical keyboard, pointer, or cross-application drag verification.
"""
import json
from pathlib import Path
import subprocess
import sys
import time

root = Path(__file__).resolve().parent.parent
control = Path(sys.argv[1]).resolve()
report = {"layer": "packaged WKWebView with programmatic DOM actions", "checks": {}}

def qa(action, **fields):
    completed = subprocess.run([sys.executable, str(root / 'script/qa.py'), str(control)], input=json.dumps({"action": action, **fields}), text=True, capture_output=True, check=True)
    return json.loads(completed.stdout)['value']

def js(script, window='capture-detail'):
    return qa('eval', window=window, script=script)

def wait(script, window='capture-detail'):
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        value = js(script, window)
        if value: return value
        time.sleep(.05)
    raise AssertionError(script)

def click(label, selector='button'):
    return js(f"(()=>{{const b=[...document.querySelectorAll({json.dumps(selector)})].find(b=>b.textContent==={json.dumps(label)});if(!b)return false;b.click();return true;}})()")

def draft(value):
    js("(()=>{const t=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t," + json.dumps(value) + ");t.dispatchEvent(new Event('input',{bubbles:true}));return true})()")
    wait("document.querySelector('.detail-capture-kind')?.textContent.includes('Unsaved')")

js("void window.__TAURI_INTERNALS__.invoke('create_item',{content:'# Native QA\\n\\nOriginal **Markdown**',kind:'note',sourceApp:null}).then(x=>window.__detailQA=x)", 'main')
item = wait('window.__detailQA', 'main')
# Clear an earlier exploratory draft before the repeatable run.
js("document.querySelector('[aria-label=\"Close capture\"]')?.click();true")
if js("!!document.querySelector('[role=alertdialog]')"): click('Discard', '[role=alertdialog] button')
qa('detail', ids=[item['id']], mode='preview')
wait("document.querySelector('[data-detail-preview] h1')?.textContent==='Native QA'")
assert js("!document.querySelector('textarea')")
report['checks']['preview_standalone'] = True
click('Edit')
wait("document.activeElement?.tagName==='TEXTAREA'")
assert js("document.querySelector('.detail-content')?.dataset.split==='true'")
report['checks']['source_immediate_and_split'] = True
exact = '  # Exact source\n\nNative **edit**  \n\n'
draft(exact)
js("document.querySelector('[aria-label=\"Close capture\"]').click();true")
wait("!!document.querySelector('[role=alertdialog]')")
click('Cancel', '[role=alertdialog] button')
assert js("document.querySelector('textarea').value") == exact
report['checks']['cancel_keeps_draft'] = True
click('Save changes')
wait("document.querySelector('main')?.dataset.mode==='preview'")
js("void window.__TAURI_INTERNALS__.invoke('get_capture_details',{ids:["+json.dumps(item['id'])+"]}).then(x=>window.__saved=x[0])")
saved = wait('window.__saved')
assert saved['content'] == exact
report['checks']['save_preserves_source_bytes'] = True
click('Edit')
draft('My conflicting draft')
js("void window.__TAURI_INTERNALS__.invoke('update_item',{id:"+json.dumps(item['id'])+",content:'Other window update',kind:'note',expectedUpdatedAt:"+json.dumps(saved['updatedAt'])+"}).then(()=>window.__external=true)")
wait('window.__external')
click('Save changes')
wait("document.querySelector('[role=alert]')?.textContent.includes('changed')")
assert js("document.querySelector('textarea').value") == 'My conflicting draft'
report['checks']['stale_save_retains_draft'] = True
click('Cancel')
wait("!!document.querySelector('[role=alertdialog]')")
click('Discard', '[role=alertdialog] button')
wait("document.querySelector('[data-detail-preview]')?.textContent.includes('Other window update')")
report['checks']['discard_loads_latest'] = True
qa('snapshot', window='capture-detail', filename='reader-verified.png')
report['detail_geometry'] = qa('geometry', window='capture-detail')
js("document.querySelector('[aria-label=\"Close capture\"]').click();true")
wait("document.body.innerText.includes('Open a capture from the queue')")
report['checks']['close_clears_reader_state'] = True
report['pass'] = all(report['checks'].values())
(control.parent / 'detail-verification.json').write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps(report, indent=2))
