from __future__ import annotations

import argparse
import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest import mock


def _load_module():
    module_path = Path(__file__).resolve().parents[1] / "scripts" / "start_server.py"
    spec = importlib.util.spec_from_file_location("start_server", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load module spec for {module_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


start_server = _load_module()


class StartServerScriptTests(unittest.TestCase):
    def test_build_command_includes_requested_vite_flags(self) -> None:
        args = argparse.Namespace(
            host="0.0.0.0",
            port=5173,
            open=True,
            strict_port=True,
        )

        command = start_server.build_command(args)

        self.assertEqual(
            command,
            [
                "npm",
                "run",
                "dev",
                "--",
                "--host",
                "0.0.0.0",
                "--port",
                "5173",
                "--open",
                "--strictPort",
            ],
        )

    def test_ensure_prerequisites_fails_when_node_modules_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "package.json").write_text("{}", encoding="utf-8")
            with mock.patch.object(start_server.shutil, "which", return_value="/usr/bin/npm"):
                with self.assertRaises(start_server.StartServerError):
                    start_server.ensure_prerequisites(root)


if __name__ == "__main__":
    unittest.main()
