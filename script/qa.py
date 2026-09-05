"""Send one inspection request to an explicitly isolated packaged QA process.

Usage: python3 script/qa.py /absolute/qa-directory < request.json
No UI or browser simulation is performed by this client.
"""
import json
import os
from pathlib import Path
import sys
import time
import uuid

directory = Path(sys.argv[1]).resolve()
request = json.load(sys.stdin)
request["id"] = str(uuid.uuid4())
directory.mkdir(parents=True, exist_ok=True)
temporary = directory / "request.tmp"
temporary.write_text(json.dumps(request))
os.replace(temporary, directory / "request.json")
deadline = time.monotonic() + 30
while time.monotonic() < deadline:
    try:
        response = json.loads((directory / "response.json").read_text())
        if response.get("id") == request["id"]:
            print(json.dumps(response, indent=2))
            sys.exit(0 if response["ok"] else 1)
    except (OSError, json.JSONDecodeError):
        pass
    time.sleep(0.025)
raise SystemExit("Packaged QA process did not reply within 30 seconds")
