# Word-list photo OCR

This local macOS tool reads JPG, HEIC, and PNG photos from `wordlists/inbox/` with Apple Vision. It makes no network calls and sends no image data anywhere. It writes `wordlists/round2.draft.json` with `{ "word", "source_image", "confidence" }` records, plus `wordlists/round2.draft.txt` for manual checking. The output is a draft: OCR can mistake letters, so check it against the official list before using it.

## Requirements

- macOS with Xcode Command Line Tools (`xcrun swift`)
- Python 3 and Pillow for the generated-image test

The installed machine has `xcrun` and Command Line Tools; `swift` is available through `xcrun`. The `shortcuts` CLI is installed, but has no usable shortcut configured, so this pipeline uses Vision directly. No build step or package install is needed to run OCR.

## Run

Copy the official photos into `wordlists/inbox/`, then from the repository root run:

```sh
xcrun swift tools/wordlist-ocr/wordlist-ocr.swift
```

Or provide an input directory and optional output paths:

```sh
xcrun swift tools/wordlist-ocr/wordlist-ocr.swift wordlists/inbox /tmp/round2.json /tmp/round2.txt
```

Numbered prefixes are stripped. Text is read top-to-bottom, with detected columns read left-to-right, and duplicate words are removed case-insensitively while keeping the first source and confidence. OCR's confidence is attached to each word detected on that line. Review spelling, order, and omissions manually.

## Test

The test creates a numbered two-column sample image locally, runs Apple Vision, then checks order, deduplication, source, confidence, schema, and text output:

```sh
python3 tools/wordlist-ocr/test_wordlist_ocr.py
```
