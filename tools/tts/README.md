# Offline word-list audio generation

Generate pre-recorded AAC speech for each built-in word list. This runs on the Mac with the TTS environment in `.buildteam/spikes/tts/.venv312`; it is a content-authoring tool and is never used by the PWA.

Create the venv with a local Python 3.12 interpreter, then install `requirements.txt` there. The one-time Kokoro weights/voice download is kept in `.buildteam/spikes/tts/hf-cache` and is about 363 MB; the generator defaults to Hugging Face and Transformers offline mode after setup.

```sh
HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 \
  .buildteam/spikes/tts/.venv312/bin/python tools/tts/generate_audio.py
```

The generator uses Kokoro 0.9.4, the locally cached Apache-2.0 `hexgrad/Kokoro-82M` weights, and the `af_heart` voice. It reads every `*.json` word list except `index.json`, and writes `app/audio/<list-id>/<word-id>/{word,definition,sentence,origin}.m4a` plus a per-list `manifest.json` using `spellingbee.audio/1`, as required by the app loader. Each manifest gives all file paths, the total byte count, and per-clip byte sizes. The generator skips existing clips, so it can resume. Remove an individual clip before regenerating it.

Word clips use the normal spelling at a slower speaking rate. **The word list's `audio.respell` is not automatically used.** Add a `<list-id>/<word-id>` key to `respell-overrides.json` only after listening confirms a model mispronunciation; its value must match that record's current `audio.respell`. Other clue clips read the first definition, sentence, and origin. All output is trimmed for leading/trailing silence, mono AAC at 40 kbps, and 24 kHz.

After adding a word list, rerun the generator and add its JSON filename to `app/data/wordlists/index.json`. If a new list appears while this task is active, rerun then as well.
