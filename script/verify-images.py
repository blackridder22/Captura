"""Verify shared image commands through the packaged WKWebView/Tauri runtime."""
import hashlib
import json
from pathlib import Path
import sqlite3
import struct
import subprocess
import sys
import time

root = Path(__file__).resolve().parent.parent
control = Path(sys.argv[1]).resolve()
report = {'layer': 'packaged WKWebView + native ImageIO + isolated SQLite', 'checks': {}}

def qa(action, **fields):
    p = subprocess.run([sys.executable, str(root/'script/qa.py'), str(control)], input=json.dumps({'action':action, **fields}), text=True, capture_output=True, check=True)
    return json.loads(p.stdout)['value']

def js(script): return qa('eval', script=script)
def wait(script):
    deadline=time.monotonic()+20
    while time.monotonic()<deadline:
        result=js(script)
        if result: return result
        time.sleep(.05)
    raise AssertionError(script)
def invoke(command, data):
    js('window.__imageQA=null;void window.__TAURI_INTERNALS__.invoke('+json.dumps(command)+','+json.dumps(data)+').then(value=>window.__imageQA={value}).catch(error=>window.__imageQA={error:String(error)});true')
    result=wait('window.__imageQA')
    if 'error' in result: raise AssertionError(result)
    return result['value']
def dimensions(path):
    raw=Path(path).read_bytes()
    assert raw[:8]==b'\x89PNG\r\n\x1a\n'
    return struct.unpack('>II',raw[16:24])

fixtures=root/'src-tauri/tests/fixtures/images'
qa('show')
wait("!!document.querySelector('[aria-label=\"Add image\"]')")
section=invoke('create_section',{'name':'Native image checks'})
paths=[str(fixtures/name) for name in ['large.png','rotated.jpg','first-page.tiff','small.heic','alpha.webp','first-frame.gif','small.bmp']]+[str(fixtures/'missing.png')]
result=invoke('import_image_files',{'requestId':'native-images-batch','sectionId':section['id'],'paths':paths})
assert len(result['items'])==7 and len(result['issues'])==1 and len(result['warnings'])==2,result
assert all(x['sectionId']==section['id'] for x in result['items'])
assert [x['content'] for x in result['items']]==['large','rotated','first-page','small','alpha','first-frame','small']
for item in result['items']:
    assert dimensions(item['attachmentPath'])==(item['imageWidth'],item['imageHeight'])
    assert max(dimensions(item['thumbnailPath']))<=480
assert dimensions(result['items'][0]['attachmentPath'])==(1024,512)
assert dimensions(result['items'][1]['attachmentPath'])==(32,64)
report['checks']['all_seven_formats_originals_thumbnails_orientation']=True
report['checks']['section_snapshot_partial_failure_first_frame_notices']=True
snapshot=invoke('snapshot_queue',{})
assert [x['id'] for x in snapshot['items'] if x['sectionId']==section['id']]==[x['id'] for x in result['items']]
report['checks']['input_order_survives_db_reload']=True
invoke('delete_section',{'id':section['id']})
fallback=invoke('import_image_files',{'requestId':'native-section-fallback','sectionId':section['id'],'paths':[str(fixtures/'alpha.png')]})
assert fallback['items'][0]['sectionId'] is None
assert fallback['warnings'][0]['code']=='section_deleted'
report['checks']['deleted_section_falls_back']=True
qa('clipboard',operation='backup')
try:
    qa('clipboard',operation='files',paths=[str(fixtures/'alpha.png'),str(fixtures/'rotated.jpg')])
    copied=invoke('paste_image_from_clipboard',{'requestId':'native-finder-flavors','sectionId':None})
    assert len(copied['items'])==2 and not copied['issues']
    report['checks']['copied_local_file_urls']=True
finally: qa('clipboard',operation='restore')
limits=invoke('import_image_files',{'requestId':'native-limit','sectionId':None,'paths':[str(fixtures/'alpha.png')]*21})
assert not limits['items'] and limits['issues'][0]['code']=='too_many_files'
report['checks']['batch_limit_is_visible_error']=True
report['pass']=all(report['checks'].values())
(control.parent/'image-verification.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
