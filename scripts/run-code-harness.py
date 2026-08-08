#!/usr/bin/env python3
"""Run the installed code harness with a durable project-level --spec contract."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path


def find_harness_script() -> Path:
    configured = os.environ.get("CODE_HARNESS_SCRIPT", "").strip()
    if configured:
        candidate = Path(configured).expanduser().resolve()
        if candidate.is_file():
            return candidate
        raise FileNotFoundError("CODE_HARNESS_SCRIPT does not point to a file.")

    pattern = "plugins/cache/**/skills/code-harness/scripts/run_harness.py"
    candidates = list((Path.home() / ".codex").glob(pattern))
    if not candidates:
        raise FileNotFoundError("No installed code-harness script was found under the Codex plugin cache.")
    return max(candidates, key=lambda item: item.stat().st_mtime)


def attach_spec(report_dir: Path, spec: Path) -> None:
    result_path = report_dir / "static_results.json"
    if not result_path.is_file():
        return
    result = json.loads(result_path.read_text(encoding="utf-8"))
    result["spec"] = str(spec)
    for entry in result.get("results", []):
        if entry.get("status") == "PENDING_AGENT":
            entry["spec"] = str(spec)
    result_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", required=True)
    parser.add_argument("--rules", required=True)
    parser.add_argument("--spec")
    parser.add_argument("--report")
    parser.add_argument("--stage", choices=("unit", "final"), default="final")
    args = parser.parse_args()

    target = Path(args.target).resolve()
    rules = Path(args.rules).resolve()
    spec = Path(args.spec).resolve() if args.spec else None
    if not target.exists():
        parser.error(f"target does not exist: {target}")
    if not rules.is_file():
        parser.error(f"rules file does not exist: {rules}")
    if spec and not spec.is_file():
        parser.error(f"spec file does not exist: {spec}")

    try:
        harness = find_harness_script()
    except FileNotFoundError as error:
        parser.error(str(error))

    report = Path(args.report).resolve() if args.report else (
        target / "_harness" if target.is_dir() else target.parent / "_harness"
    )
    command = [
        sys.executable,
        str(harness),
        "--target",
        str(target),
        "--rules",
        str(rules),
        "--report",
        str(report),
        "--stage",
        args.stage,
    ]

    supports_spec = '"--spec"' in harness.read_text(encoding="utf-8", errors="replace")
    if spec and supports_spec:
        command.extend(("--spec", str(spec)))

    completed = subprocess.run(command, check=False)
    if spec:
        attach_spec(report, spec)
        if not supports_spec:
            print(
                "[HARNESS] Installed runner lacks --spec; project wrapper attached the validated spec to static_results.json.",
                file=sys.stderr,
            )
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
