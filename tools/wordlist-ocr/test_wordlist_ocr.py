import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "tools/wordlist-ocr/wordlist-ocr.swift"
SWIFT = shutil.which("swift") or ("/usr/bin/xcrun" if Path("/usr/bin/xcrun").exists() else None)


@unittest.skipUnless(SWIFT, "Swift / Xcode Command Line Tools are required")
class OCRPipelineTests(unittest.TestCase):
    def test_generated_numbered_two_column_sample_and_dedupe(self):
        with tempfile.TemporaryDirectory() as temp:
            temp_path = Path(temp)
            input_dir = temp_path / "inbox"
            input_dir.mkdir()
            image = Image.new("RGB", (1800, 1100), "white")
            draw = ImageDraw.Draw(image)
            font_path = "/System/Library/Fonts/Supplemental/Arial.ttf"
            font = ImageFont.truetype(font_path, 96) if os.path.exists(font_path) else ImageFont.load_default()
            for y, text in [(100, "1. lantern"), (300, "2. meadow"), (100, "3. orchard"), (300, "4. lantern")]:
                x = 120 if text.startswith(("1.", "2.")) else 980
                draw.text((x, y), text, fill="black", font=font)
            image.save(input_dir / "sample.png")
            out_json = temp_path / "round2.draft.json"
            out_text = temp_path / "round2.draft.txt"
            command = [SWIFT, str(SCRIPT), str(input_dir), str(out_json), str(out_text)]
            result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr or result.stdout)

            records = json.loads(out_json.read_text())
            self.assertEqual([r["word"].lower() for r in records], ["lantern", "meadow", "orchard"])
            self.assertEqual([r["word"].lower() for r in records], [w.lower() for w in out_text.read_text().splitlines()])
            self.assertTrue(all(set(r) == {"word", "source_image", "confidence"} for r in records))
            self.assertTrue(all(r["source_image"] == "sample.png" for r in records))
            self.assertTrue(all(0.0 <= r["confidence"] <= 1.0 for r in records))


if __name__ == "__main__":
    unittest.main()
