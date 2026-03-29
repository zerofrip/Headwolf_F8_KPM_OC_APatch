#!/usr/bin/env python3
"""
Patch mtk_gpufreq_mt6897.ko top GPU OPP from 1400000 KHz to a custom value.

This script targets the OPP table pattern found in the vendor module and writes
an output .ko with only the top frequency entry changed.
"""

from __future__ import annotations

import argparse
import hashlib
import struct
import sys
from pathlib import Path

ENTRY_STRIDE = 24
TOP_FREQ_OLD = 1_400_000
TOP_FREQ_DEFAULT = 1_450_000
TOP_FREQ_MIN = 1_400_000
TOP_FREQ_MAX = 1_700_000
END_FREQ_EXPECT = 265_000
PATTERN = [1_400_000, 1_383_000, 1_367_000, 1_351_000]


def find_opp_table_offsets(blob: bytes) -> list[int]:
    hits: list[int] = []
    max_scan = len(blob) - ENTRY_STRIDE * 65
    for off in range(max_scan):
        ok = True
        for idx, freq in enumerate(PATTERN):
            val = struct.unpack_from("<I", blob, off + ENTRY_STRIDE * idx)[0]
            if val != freq:
                ok = False
                break
        if not ok:
            continue

        end_off = off + ENTRY_STRIDE * 64
        end_freq = struct.unpack_from("<I", blob, end_off)[0]
        if end_freq == END_FREQ_EXPECT:
            hits.append(off)
    return hits


def patch_blob(blob: bytes, top_freq_new: int) -> tuple[bytes, int]:
    data = bytearray(blob)
    hits = find_opp_table_offsets(blob)
    if len(hits) != 1:
        raise RuntimeError(f"Expected exactly one OPP table hit, got {len(hits)}: {hits}")

    off = hits[0]
    cur = struct.unpack_from("<I", data, off)[0]
    if cur != TOP_FREQ_OLD:
        raise RuntimeError(f"Unexpected top frequency at 0x{off:x}: {cur}")

    struct.pack_into("<I", data, off, top_freq_new)

    verify = struct.unpack_from("<I", data, off)[0]
    if verify != top_freq_new:
        raise RuntimeError("Patch verification failed")

    return bytes(data), off


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description="Patch mtk_gpufreq_mt6897.ko top OPP to custom KHz")
    parser.add_argument("input", type=Path, help="Input mtk_gpufreq_mt6897.ko")
    parser.add_argument("output", type=Path, help="Output patched .ko")
    parser.add_argument(
        "--new-top-freq",
        type=int,
        default=TOP_FREQ_DEFAULT,
        help=f"New top OPP frequency in KHz (default: {TOP_FREQ_DEFAULT})",
    )
    args = parser.parse_args()

    if not args.input.is_file():
        print(f"Input file not found: {args.input}", file=sys.stderr)
        return 2

    if not (TOP_FREQ_MIN <= args.new_top_freq <= TOP_FREQ_MAX):
        print(
            f"Invalid --new-top-freq: {args.new_top_freq} (allowed {TOP_FREQ_MIN}..{TOP_FREQ_MAX})",
            file=sys.stderr,
        )
        return 2

    src = args.input.read_bytes()
    out, off = patch_blob(src, args.new_top_freq)
    args.output.write_bytes(out)

    print(f"Patched offset: 0x{off:x}")
    print(f"Old top freq: {TOP_FREQ_OLD}")
    print(f"New top freq: {args.new_top_freq}")
    print(f"Input SHA256:  {sha256(args.input)}")
    print(f"Output SHA256: {sha256(args.output)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
