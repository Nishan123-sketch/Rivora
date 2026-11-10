import json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from atomic_json import save_json

class AtomicJsonTests(unittest.TestCase):
 def test_transient_reader_lock_retries_without_destroying_previous_snapshot(self):
  with tempfile.TemporaryDirectory() as folder:
   target=Path(folder)/'snapshot.json';target.write_text('{"old":true}')
   import os
   replace=os.replace;calls=[]
   def locked(source,destination):
    calls.append(source)
    if len(calls)<3:
     self.assertTrue(json.loads(target.read_text())['old']);raise PermissionError('reader lock')
    replace(source,destination)
   with patch('atomic_json.os.replace',side_effect=locked),patch('atomic_json.time.sleep'):save_json(target,{'new':True})
   self.assertEqual(json.loads(target.read_text()),{'new':True});self.assertEqual(len(calls),3)
   self.assertEqual([p.name for p in Path(folder).iterdir()],['snapshot.json'])
 def test_persistent_lock_preserves_original_and_cleans_owned_temporary_file(self):
  with tempfile.TemporaryDirectory() as folder:
   target=Path(folder)/'snapshot.json';target.write_text('{"old":true}')
   with patch('atomic_json.os.replace',side_effect=PermissionError('locked')),patch('atomic_json.time.sleep'):
    with self.assertRaises(PermissionError):save_json(target,{'new':True})
   self.assertTrue(json.loads(target.read_text())['old']);self.assertEqual(len(list(Path(folder).iterdir())),1)
 def test_invalid_nonfinite_json_never_overwrites_a_snapshot(self):
  with tempfile.TemporaryDirectory() as folder:
   target=Path(folder)/'snapshot.json';target.write_text('{"old":true}')
   with self.assertRaises(ValueError):save_json(target,{'value':float('nan')})
   self.assertTrue(json.loads(target.read_text())['old'])
