#!/usr/bin/env python3
from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
import sys


INDENT = "  "


@dataclass
class FormatResult:
    text: str
    changed: bool


def normalize_newlines(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n")


def strip_comments_for_braces(line: str, in_block_comment: bool) -> tuple[str, bool]:
    out: list[str] = []
    i = 0
    n = len(line)
    in_string: str | None = None
    escape = False

    while i < n:
        ch = line[i]
        nxt = line[i + 1] if i + 1 < n else ""

        if in_block_comment:
            if ch == "*" and nxt == "/":
                in_block_comment = False
                i += 2
                continue
            i += 1
            continue

        if in_string is not None:
            out.append(ch)
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == in_string:
                in_string = None
            i += 1
            continue

        if ch in ("'", '"'):
            in_string = ch
            out.append(ch)
            i += 1
            continue

        if ch == "/" and nxt == "/":
            break
        if ch == "/" and nxt == "*":
            in_block_comment = True
            i += 2
            continue

        out.append(ch)
        i += 1

    return "".join(out), in_block_comment


def line_brace_stats(line: str, in_block_comment: bool) -> tuple[int, int, bool]:
    code, next_in_block_comment = strip_comments_for_braces(line, in_block_comment)
    stripped = code.lstrip()
    leading_close = 0
    for ch in stripped:
        if ch == "}":
            leading_close += 1
            continue
        break
    delta = code.count("{") - code.count("}")
    return delta, leading_close, next_in_block_comment


def collapse_blank_lines(lines: list[str]) -> list[str]:
    out: list[str] = []
    last_blank = True
    for raw in lines:
        if raw == "":
            if last_blank:
                continue
            out.append("")
            last_blank = True
            continue
        out.append(raw)
        last_blank = False
    while out and out[-1] == "":
        out.pop()
    return out


def format_frag_text(text: str) -> str:
    text = normalize_newlines(text)
    lines = text.split("\n")

    out: list[str] = []
    indent_level = 0
    in_preset = False
    in_block_comment = False

    for original in lines:
        line = original.rstrip(" \t")
        stripped = line.strip()

        if stripped == "":
            out.append("")
            continue

        lower = stripped.lower()
        is_directive = stripped.startswith("#")

        if is_directive:
            directive_line = stripped
            out.append(directive_line)
            if lower.startswith("#preset "):
                in_preset = True
            elif lower == "#endpreset":
                in_preset = False
            continue

        if in_preset:
            out.append(line.lstrip())
            continue

        delta, leading_close, in_block_comment = line_brace_stats(line, in_block_comment)
        effective_indent = max(indent_level - leading_close, 0)
        formatted = f"{INDENT * effective_indent}{line.lstrip()}"
        out.append(formatted)
        indent_level = max(indent_level + delta, 0)

    out = collapse_blank_lines(out)
    return "\n".join(out) + "\n"


def format_file(path: Path, write: bool) -> bool:
    original = path.read_text(encoding="utf-8")
    formatted = format_frag_text(original)
    changed = formatted != normalize_newlines(original)
    if changed and write:
        path.write_text(formatted, encoding="utf-8", newline="\n")
    return changed


def collect_frag_files(paths: list[Path]) -> list[Path]:
    files: list[Path] = []
    for base in paths:
        if base.is_file():
            if base.suffix == ".frag":
                files.append(base)
            continue
        if base.is_dir():
            files.extend(sorted(base.rglob("*.frag")))
            continue
        raise FileNotFoundError(f"Path not found: {base}")
    return sorted(set(files))


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Conservative beautifier for Fragmentarium .frag files (indentation/blank lines/trailing spaces)."
    )
    parser.add_argument(
        "paths",
        nargs="*",
        default=["src"],
        help="Files or directories to scan (default: src)"
    )
    parser.add_argument("--write", action="store_true", help="Write changes to files.")
    parser.add_argument("--check", action="store_true", help="Check only; exit non-zero if changes are needed.")
    parser.add_argument("--list", action="store_true", help="List changed files.")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    if args.write and args.check:
        raise ValueError("Use either --write or --check, not both.")

    paths = [Path(p) for p in args.paths]
    files = collect_frag_files(paths)
    if not files:
        raise RuntimeError("No .frag files found.")

    changed_files: list[Path] = []
    for path in files:
        changed = format_file(path, write=args.write)
        if changed:
            changed_files.append(path)

    mode = "write" if args.write else "check"
    print(f"[beautify_fragments] mode={mode} files={len(files)} changed={len(changed_files)}")
    if args.list:
        for path in changed_files:
            print(path.as_posix())

    if args.check and changed_files:
        return 1
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except Exception as exc:  # explicit failure, no silent fallback
        print(f"[beautify_fragments] error: {exc}", file=sys.stderr)
        raise

