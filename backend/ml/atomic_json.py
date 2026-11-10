"""Publish valid JSON atomically, tolerating brief Windows reader/antivirus locks."""
import json,os,tempfile,time
from pathlib import Path

def save_json(file,value,default=None):
    file=Path(file);file.parent.mkdir(parents=True,exist_ok=True)
    encoded=json.dumps(value,default=default,allow_nan=False,indent=2)
    handle,name=tempfile.mkstemp(prefix=file.name+'.',suffix='.tmp',dir=file.parent)
    temp=Path(name)
    try:
        with os.fdopen(handle,'w',encoding='utf-8') as stream:
            stream.write(encoded);stream.flush();os.fsync(stream.fileno())
        for attempt in range(8):
            try:os.replace(temp,file);return
            except PermissionError:
                if attempt==7:raise
                time.sleep(.025*2**min(attempt,4))
    finally:
        if temp.exists():temp.unlink()
