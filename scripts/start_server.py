#!/usr/bin/env python3
"""Start the Fragmentarium Web dev server with explicit prerequisite checks."""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]


class StartServerError(RuntimeError):
    pass


def log(message: str) -> None:
    print(f"[start-server] {message}", flush=True)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Start the Vite development server for FragmentariumWeb."
    )
    parser.add_argument("--host", default="localhost", help="Host to bind Vite to.")
    parser.add_argument("--port", type=int, default=4174, help="Port to bind Vite to.")
    parser.add_argument(
        "--open",
        action="store_true",
        help="Ask Vite to open the app in a browser.",
    )
    parser.add_argument(
        "--strict-port",
        action="store_true",
        help="Fail instead of choosing another port if the requested port is busy.",
    )
    return parser.parse_args(argv)


def ensure_prerequisites(project_root: Path) -> None:
    package_json = project_root / "package.json"
    node_modules = project_root / "node_modules"

    if not package_json.exists():
        raise StartServerError(f"Missing project file: {package_json}")
    if shutil.which("npm") is None:
        raise StartServerError("`npm` is not available on PATH.")
    if not node_modules.exists():
        raise StartServerError(
            f"Missing dependencies directory: {node_modules}. Run `npm install` first."
        )


def build_command(args: argparse.Namespace) -> list[str]:
    command = ["npm", "run", "dev", "--", "--host", str(args.host)]
    if args.port is not None:
        command.extend(["--port", str(args.port)])
    if args.open:
        command.append("--open")
    if args.strict_port:
        command.append("--strictPort")
    return command


def run_server(command: list[str], project_root: Path) -> int:
    log(f"Working directory: {project_root}")
    log(f"Launching: {' '.join(command)}")
    result = subprocess.run(command, cwd=project_root, check=False)
    log(f"Server process exited with code {result.returncode}")
    return result.returncode


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    ensure_prerequisites(PROJECT_ROOT)
    command = build_command(args)
    return run_server(command, PROJECT_ROOT)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except StartServerError as exc:
        print(f"[start-server] ERROR: {exc}", file=sys.stderr, flush=True)
        raise SystemExit(1)
