#!/usr/bin/env python3
"""Render local Kokoro clips for all built-in word lists; no network fallback."""
import argparse
from datetime import date
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
ROOT = Path(__file__).resolve().parents[2]
os.environ.setdefault("HF_HOME", str(ROOT / ".buildteam/spikes/tts/hf-cache"))

# Enforce offline mode before importing Kokoro/Transformers/Hugging Face clients.
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

import numpy as np
import soundfile as sf
from kokoro import KPipeline

WORDLIST_DIR = ROOT / "app/data/wordlists"
AUDIO_DIR = ROOT / "app/audio"
OVERRIDES_FILE = Path(__file__).with_name("respell-overrides.json")
SPEED = {"word": 0.82, "definition": 0.96, "sentence": 0.96, "origin": 0.96}

def utterances(word, list_id, use_respell):
    audio = word.get("audio") or {}
    override = use_respell.get(f"{list_id}/{word['id']}")
    if override and override != audio.get("respell"):
        raise ValueError(f"Respell override for {word['id']} must equal the list's audio.respell")
    spoken_word = override or word["word"]
    definition = (word.get("definitions") or [word.get("definition", "")])[0]
    return {
        "word": spoken_word,
        "definition": f"Definition: {definition}" if definition else "",
        "sentence": word.get("sentence", ""),
        "origin": f"Language of origin: {word['origin']}." if word.get("origin") else "",
    }

def render(pipeline, text, voice, speed, target):
    chunks = []
    for result in pipeline(text, voice=voice, speed=speed):
        audio = result[2]
        if audio is not None:
            chunks.append(audio.detach().cpu().numpy())
    if not chunks:
        raise RuntimeError(f"Kokoro returned no audio for {target}")
    samples = np.concatenate(chunks)
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(prefix="tts-", suffix=".wav", dir=target.parent, delete=False) as f:
        wav = Path(f.name)
    try:
        sf.write(wav, samples, 24000, subtype="PCM_16")
        subprocess.run([
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(wav),
            "-af", "silenceremove=start_periods=1:start_duration=0.04:start_threshold=-50dB:"
                  "stop_periods=1:stop_duration=0.10:stop_threshold=-50dB",
            "-c:a", "aac", "-b:a", "40k", "-ac", "1", "-ar", "24000", str(target),
        ], check=True)
    finally:
        wav.unlink(missing_ok=True)

def process_list(path, pipeline, voice, overrides, overwrite, word_ids=None):
    data = json.loads(path.read_text(encoding="utf-8"))
    list_id = data.get("id") or path.stem
    out_dir = AUDIO_DIR / list_id
    out_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    clip_map = {}
    sizes = {}
    words = [w for w in data["words"] if not word_ids or w["id"] in word_ids]
    total = len(words)
    if word_ids and len(words) != len(word_ids):
        found = {w["id"] for w in words}
        raise ValueError(f"Unknown word id(s): {', '.join(sorted(set(word_ids) - found))}")
    for ix, word in enumerate(words, 1):
        clips = {}
        for kind, text in utterances(word, list_id, overrides).items():
            if not text:
                continue
            target = out_dir / word["id"] / f"{kind}.m4a"
            if overwrite or not target.exists():
                render(pipeline, text, voice, SPEED[kind], target)
            rel = str(target.relative_to(out_dir))
            clips[kind] = {"path": rel, "bytes": target.stat().st_size}
            sizes[rel] = target.stat().st_size
        rows.append({"id": word["id"], "word": word["word"], "clips": clips})
        clip_map[word["id"]] = {kind: clip["path"] for kind, clip in clips.items()}
        print(f"[{path.name}] {ix}/{total} {word['word']}", flush=True)
    total_bytes = sum(sizes.values())
    digest = hashlib.sha256()
    for rel in sorted(sizes):
        digest.update(rel.encode("utf-8"))
        digest.update((out_dir / rel).read_bytes())
    version = f"{voice}-{date.today().isoformat()}-{digest.hexdigest()[:12]}"
    manifest = {"schema": "spellingbee.audio/1", "listId": list_id, "ext": "m4a",
                "voice": voice, "version": version, "codec": "AAC-LC", "sampleRate": 24000,
                "bitrate": 40000, "channels": 1, "bytes": total_bytes,
                "clips": clip_map, "sizes": sizes, "words": rows}
    (out_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return total_bytes

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--list", action="append", help="word-list JSON filename; repeatable (default: all lists)")
    parser.add_argument("--voice", default="am_michael")
    parser.add_argument("--word-id", action="append", help="render only these word ids (repeatable)")
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()
    overrides = json.loads(OVERRIDES_FILE.read_text(encoding="utf-8"))
    paths = [WORDLIST_DIR / name for name in args.list] if args.list else sorted(WORDLIST_DIR.glob("*.json"))
    paths = [p for p in paths if p.name != "index.json"]
    missing = [p for p in paths if not p.is_file()]
    if missing:
        raise SystemExit("Missing word list(s): " + ", ".join(str(p) for p in missing))
    pipeline = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M")
    total_bytes = 0
    for path in paths:
        total_bytes += process_list(path, pipeline, args.voice, overrides, args.overwrite, args.word_id)
    print(f"Audio size in processed list manifests: {total_bytes:,} bytes ({total_bytes / 1_000_000:.2f} MB)")

if __name__ == "__main__":
    main()
