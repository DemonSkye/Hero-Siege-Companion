from __future__ import annotations

from pathlib import Path
import sys

RELAY_DIR = Path(__file__).resolve().parents[2] / "resources" / "satanic-zone-relay"
sys.path.insert(0, str(RELAY_DIR))

import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from relay_state import process_is_alive, read_json, reserve_json_marker


class ProcessStateTests(unittest.TestCase):
    def test_detects_current_process(self) -> None:
        self.assertTrue(process_is_alive(os.getpid()))

    def test_liveness_probe_does_not_terminate_process(self) -> None:
        child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
        try:
            self.assertTrue(process_is_alive(child.pid))
            self.assertIsNone(child.poll())
        finally:
            if child.poll() is None:
                child.terminate()
                child.wait(timeout=3)

    def test_rejects_invalid_pid(self) -> None:
        self.assertFalse(process_is_alive(0))

    def test_one_shot_marker_is_exclusive_and_not_overwritten(self) -> None:
        with tempfile.TemporaryDirectory(prefix="hsc-sz-state-") as temporary:
            marker = Path(temporary) / "consumed.json"

            self.assertTrue(reserve_json_marker(marker, {"status": "first"}))
            self.assertFalse(reserve_json_marker(marker, {"status": "second"}))

            self.assertEqual(read_json(marker), {"status": "first"})


if __name__ == "__main__":
    unittest.main()
