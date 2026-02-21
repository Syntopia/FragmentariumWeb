#!/usr/bin/env python3
"""Port Fragmentarium legacy 3D examples into this repo.

The script copies include files and selected 3D example .frag files while transforming
example sources to remove legacy raytracer includes. It preserves comments/notes.
"""

from __future__ import annotations

import json
import re
import shutil
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

SOURCE_ROOT = Path("/home/mikael/PrivateProjects/Fragmentarium/Fragmentarium-Source/Examples")
DEST_ROOT = Path(__file__).resolve().parents[1] / "src/systems/fragmentarium"
DEST_INCLUDE_DIR = DEST_ROOT / "include"
DEST_EXAMPLES_DIR = DEST_ROOT / "examples"
MANIFEST_PATH = DEST_ROOT / "manifest.json"
REPORT_PATH = Path(__file__).resolve().parents[1] / "reports/fragmentarium-port-report.json"

INCLUDE_LINE_RE = re.compile(r'^\s*#include\s+"([^"]+)"\s*$')
CAMERA_3D_RE = re.compile(r"^\s*#camera\s+3D\b", re.IGNORECASE | re.MULTILINE)
CAMERA_UNIFORM_RE = re.compile(r"^\s*uniform\s+(?:float|vec3)\s+(?:FOV|Eye|Target|Up)\b", re.MULTILINE)
ORBIT_TRAP_USE_RE = re.compile(r"\borbitTrap\b")
ORBIT_TRAP_DECL_RE = re.compile(r"\bvec4\s+orbitTrap\b")
DE_FUNCTION_RE = re.compile(r"\bfloat\s+DE\s*\(")
LEGACY_PIPELINE_RE = re.compile(
    r"\bvarying\b|\battribute\b|\bgl_FragColor\b|\bgl_ProjectionMatrix\b|\bvoid\s+main\s*\(",
    re.IGNORECASE,
)
SAMPLER_FILE_ANNOTATION_RE = re.compile(
    r'^(\s*uniform\s+sampler[A-Za-z0-9_]*\s+[A-Za-z_][A-Za-z0-9_]*\s*;)\s*file\[[^\]]*\]\s*$'
)

LEGACY_RENDERER_INCLUDES = {
    "3D.frag",
    "Brute3D.frag",
    "Brute-Raytracer.frag",
    "DE-Raytracer.frag",
    "DE-Raytracer-v0.9.1.frag",
    "DE-Raytracer-v0.9.10.frag",
    "DE-Raytracer-Slicer.frag",
    "DE-RaytracerX.frag",
    "Fast-Raytracer.frag",
    "IBL-Pathtracer.frag",
    "IBL-Raytracer.frag",
    "Path-Raytracer.frag",
    "Sky-Pathtracer.frag",
    "Soft-Raytracer.frag",
    "Subblue-Raytracer.frag",
    "ZBuffer3D.frag",
}
LEGACY_RENDERER_INCLUDES_LOWER = {name.lower() for name in LEGACY_RENDERER_INCLUDES}

THREED_TRIGGER_INCLUDES_LOWER = set(LEGACY_RENDERER_INCLUDES_LOWER)
THREED_TRIGGER_INCLUDES_LOWER.update({"3d.frag", "zbuffer3d.frag"})


@dataclass(frozen=True)
class ManifestEntry:
    id: str
    name: str
    path: str
    relativePath: str
    removedIncludes: list[str]


class PortError(RuntimeError):
    pass


def collect_include_name_map(include_dir: Path) -> dict[str, str]:
    mapping: dict[str, str] = {}
    for include_file in include_dir.glob("*.frag"):
        mapping[include_file.name.lower()] = include_file.name
    return mapping


def normalize_include_name(include_name: str, include_name_map: dict[str, str]) -> str:
    canonical = include_name_map.get(include_name.lower())
    return canonical if canonical is not None else include_name


def is_3d_candidate(source: str) -> bool:
    if CAMERA_3D_RE.search(source) is not None:
        return True

    for line in source.splitlines():
        match = INCLUDE_LINE_RE.match(line)
        if match is None:
            continue
        include_name = match.group(1)
        if include_name.lower() in THREED_TRIGGER_INCLUDES_LOWER:
            return True

    return False


def find_header_insert_index(lines: list[str]) -> int:
    idx = 0
    while idx < len(lines):
        stripped = lines[idx].strip()
        if stripped == "":
            idx += 1
            continue
        if stripped.startswith("//"):
            idx += 1
            continue
        if stripped.startswith("/*") or stripped.startswith("*"):
            idx += 1
            continue
        if stripped.lower().startswith("#info"):
            idx += 1
            continue
        if stripped.lower().startswith("#define"):
            idx += 1
            continue
        break
    return idx


def transform_example_source(source: str, include_name_map: dict[str, str]) -> tuple[str, list[str]]:
    original_lines = source.splitlines()
    transformed_lines: list[str] = []
    removed_includes: list[str] = []

    for line in original_lines:
        match = INCLUDE_LINE_RE.match(line)
        if match is None:
            sampler_match = SAMPLER_FILE_ANNOTATION_RE.match(line)
            if sampler_match is not None:
                transformed_lines.append(sampler_match.group(1))
                continue
            transformed_lines.append(line)
            continue

        include_name = match.group(1)
        normalized = normalize_include_name(include_name, include_name_map)
        if normalized.lower() in LEGACY_RENDERER_INCLUDES_LOWER:
            removed_includes.append(normalized)
            continue

        transformed_lines.append(f'#include "{normalized}"')

    source_after_remove = "\n".join(transformed_lines)

    has_camera_uniforms = CAMERA_UNIFORM_RE.search(source_after_remove) is not None
    includes_common_camera = any(
        (INCLUDE_LINE_RE.match(line) is not None and INCLUDE_LINE_RE.match(line).group(1).lower() == "common-camera-3d.frag")
        for line in transformed_lines
    )

    needs_common_camera = (not has_camera_uniforms) and (not includes_common_camera)

    if needs_common_camera:
        insert_idx = find_header_insert_index(transformed_lines)
        transformed_lines.insert(insert_idx, '#include "common-camera-3d.frag"')

    source_after_camera = "\n".join(transformed_lines)
    uses_orbit_trap = ORBIT_TRAP_USE_RE.search(source_after_camera) is not None
    has_orbit_trap_decl = ORBIT_TRAP_DECL_RE.search(source_after_camera) is not None

    if uses_orbit_trap and not has_orbit_trap_decl:
        insert_idx = find_header_insert_index(transformed_lines)
        while insert_idx < len(transformed_lines):
            include_match = INCLUDE_LINE_RE.match(transformed_lines[insert_idx])
            if include_match is None:
                break
            insert_idx += 1

        transformed_lines.insert(insert_idx, "")
        transformed_lines.insert(insert_idx + 1, "vec4 orbitTrap = vec4(1.0e20);")

    while len(transformed_lines) >= 3 and transformed_lines[0].strip() == "" and transformed_lines[1].strip() == "":
        transformed_lines.pop(0)

    transformed = "\n".join(transformed_lines)
    transformed = transformed.replace("texture2D(", "texture(")
    transformed = transformed.rstrip() + "\n"
    return transformed, removed_includes


def make_system_id(relative_no_ext: str, used_ids: set[str]) -> str:
    segments = [seg for seg in relative_no_ext.split("/") if seg]
    normalized: list[str] = []
    for seg in segments:
        slug = re.sub(r"[^a-z0-9]+", "-", seg.lower()).strip("-")
        normalized.append(slug if slug else "item")

    base = f"fragmentarium/{'/'.join(normalized)}"
    if base not in used_ids:
        used_ids.add(base)
        return base

    suffix = 2
    while True:
        candidate = f"{base}-{suffix}"
        if candidate not in used_ids:
            used_ids.add(candidate)
            return candidate
        suffix += 1


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def main() -> None:
    include_source_dir = SOURCE_ROOT / "Include"
    if not SOURCE_ROOT.exists():
        raise PortError(f"Source examples directory does not exist: {SOURCE_ROOT}")
    if not include_source_dir.exists():
        raise PortError(f"Include directory does not exist: {include_source_dir}")

    if DEST_INCLUDE_DIR.exists():
        shutil.rmtree(DEST_INCLUDE_DIR)
    if DEST_EXAMPLES_DIR.exists():
        shutil.rmtree(DEST_EXAMPLES_DIR)

    DEST_INCLUDE_DIR.mkdir(parents=True, exist_ok=True)
    DEST_EXAMPLES_DIR.mkdir(parents=True, exist_ok=True)

    include_files = sorted(include_source_dir.glob("*.frag"), key=lambda p: p.name.lower())
    if not include_files:
        raise PortError("No include .frag files found in source include directory.")

    for include_file in include_files:
        content = include_file.read_text(encoding="latin-1", errors="strict")
        write_text(DEST_INCLUDE_DIR / include_file.name, content)

    include_name_map = collect_include_name_map(DEST_INCLUDE_DIR)

    all_example_files = sorted(
        [
            p
            for p in SOURCE_ROOT.rglob("*.frag")
            if include_source_dir not in p.parents and p.parent != include_source_dir
        ],
        key=lambda p: str(p).lower(),
    )

    if not all_example_files:
        raise PortError("No example .frag files found.")

    used_ids: set[str] = set()
    entries: list[ManifestEntry] = []
    removed_counter: Counter[str] = Counter()
    candidates_count = 0
    skipped_missing_de: list[str] = []
    skipped_legacy_pipeline: list[str] = []

    for src_file in all_example_files:
        source = src_file.read_text(encoding="latin-1", errors="strict")
        if not is_3d_candidate(source):
            continue

        candidates_count += 1

        transformed, removed = transform_example_source(source, include_name_map)
        if DE_FUNCTION_RE.search(transformed) is None:
            skipped_missing_de.append(src_file.relative_to(SOURCE_ROOT).as_posix())
            continue
        if LEGACY_PIPELINE_RE.search(transformed) is not None:
            skipped_legacy_pipeline.append(src_file.relative_to(SOURCE_ROOT).as_posix())
            continue

        relative_path = src_file.relative_to(SOURCE_ROOT).as_posix()
        if relative_path.startswith("Include/"):
            continue

        dest_file = DEST_EXAMPLES_DIR / relative_path
        write_text(dest_file, transformed)

        relative_no_ext = relative_path[:-5] if relative_path.lower().endswith(".frag") else relative_path
        path_for_tree = relative_no_ext
        system_name = Path(relative_no_ext).name
        system_id = make_system_id(relative_no_ext, used_ids)

        removed_counter.update(removed)

        entries.append(
            ManifestEntry(
                id=system_id,
                name=system_name,
                path=path_for_tree,
                relativePath=relative_path,
                removedIncludes=sorted(set(removed), key=lambda value: value.lower()),
            )
        )

    entries.sort(key=lambda entry: entry.relativePath.lower())

    manifest_data = [
        {
            "id": entry.id,
            "name": entry.name,
            "path": entry.path,
            "relativePath": entry.relativePath,
            "removedIncludes": entry.removedIncludes,
        }
        for entry in entries
    ]

    write_text(MANIFEST_PATH, json.dumps(manifest_data, indent=2) + "\n")

    report_data = {
        "sourceRoot": str(SOURCE_ROOT),
        "includeFilesCopied": len(include_files),
        "exampleFilesScanned": len(all_example_files),
        "threeDCandidates": candidates_count,
        "portedExamples": len(entries),
        "skippedMissingDE": sorted(skipped_missing_de),
        "skippedLegacyPipeline": sorted(skipped_legacy_pipeline),
        "manifestPath": str(MANIFEST_PATH),
        "removedIncludeCounts": dict(sorted(removed_counter.items())),
    }
    write_text(REPORT_PATH, json.dumps(report_data, indent=2) + "\n")

    print(f"Ported {len(entries)} 3D examples.")
    print(f"Copied {len(include_files)} include files.")
    print(f"Manifest: {MANIFEST_PATH}")
    print(f"Report: {REPORT_PATH}")


if __name__ == "__main__":
    main()
