#!/usr/bin/env python3
"""Build the visually reviewed Round 2 word list from the photographed pages."""

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]

# Numbered in the printed order. The pages have no One Bee / Two Bee / Three
# Bee headings, so difficulty 2 is a neutral placeholder documented for Mike.
PAGES = {
    1: "ran|wind|leg|dirt|rod|good|most|hurt|shy|bunny|down|steps|drink|silly|sick|path|mist|stars|truck",
    2: "fire|still|hello|bush|late|pump|shell|yarn|wings|sharp|easy|body|house|rich|shift|heart|tusk|shoot|seal",
    3: "even|dive|claws|crack|come|fine|winter|apple|sound|mossy|yellow|shine|chips|beans|mouth|spray|year|truth|paper|rabbit",
    4: "feed|tallest|inside|frozen|speak|cliffs|whale|market|flock|crunch|lizard|beware|sparkle|sweater|nurse|wrong|hopped|money|cabin",
    5: "darkness|always|sprout|carve|shadows|morning|alive|earth|friend|lovely|return|half|swift|grandfather|footprints|fear|thirsty|peer|gentle",
    6: "riddle|voice|peach|pancake|illness|lead|groan|sloth|knit|cloak|parade|whistle|total|indoors|trouble|relax|finish|holiday|safety",
    7: "stout|spiders|entire|library|guide|hospital|mustard|company|ginger|narrow|medium|pennies|hiking|foolish|afraid|remember|result|charming|source",
    8: "pearls|fangs|beasts|shivering|barge|grumpily|smoothly|cottage|humble|seventy|dangle|distance|breeze|soared|frazzled|bamboo|buttons|cuddle|puffy",
    9: "tiptoed|clever|basement|burlap|wetlands|invite|butterflies|kelp|property|carefully|sniffling|beneath|tractor|permit|awning|fickle|relief|lunar|boycotting|molten",
    10: "elite|woven|proclaim|thimble|custody|granola|warrior|rigid|fierce|laughter|salary|disappear|hurdler|lounge|jovial|inferior|December|duration|dictionary",
    11: "business|reinstate|examine|versus|lullaby|opposite|tissues|marlin|Halloween|compliment|compromise|incident|Japanese|investment|bifocals|cutlery|chisel|fundraiser|geologist",
    12: "bellowed|organism|quail|atmosphere|disappointment|truant|pamphlet|helium|suggested|chimpanzees|desperate|annoyance|interruption|concentrate|piñata|territory|stragglers|albino|ridiculous",
    13: "monorail|exploratory|indigo|bratwurst|alphabetical|integrity|Oregon|rebuttal|prejudice|solidarity|calico|sputnik|cartridge|segregation|tortillas|civilian|fertilizer|apprentice",
    14: "synthetic|Caesar|sorceress|glamorous|salamanders|suspension|singularity|fictitious|convertible|snarkiness|battalion|collateral|initiation|mascara|perimeter|precedent|materialize|magnesium",
    15: "meticulous|haddock|hypothermia|optometrist|megahertz|cosmodrome|arthritis|schnauzer|insurrection|regolith|pentathlete|persnickety|fascism|pheasants|predecessor|Senegal|reservoir|duende|conscious",
    16: "Polaroid|carrion|matrilineal|piteously|arnica|elliptical|glaucoma|iridium|adrenaline|cemetery|staccato|rendezvous|romerillo|dachshund|Aeolus|newt|thrummed|embankment",
    17: "lapels|generosity|burnished|mortar|unrelenting|wallowing|imperial|persistent|arsonists|mewling|generator|dominion|authority|panoramic|Doberman|lemmings|decisively|gauntlets|inanimate",
    18: "frequency|auditory|appetizing|sentinels|blithely|self-sufficient|prospective|subscription|tenuous|conspicuous|preconception|procession|saxophone|perpendicular|hemisphere|seminal|canter|torrential|reluctance",
    19: "consulate|cuisine|sauntered|propeller|modish|influenza|juniper|settee|unconscious|odorant|palazzo|finesse|foliage|crocheted|irrelevant|curriculum|quizzically|apologetic",
    20: "diplomatically|enigmatic|increments|Delaware|calibrate|hypothesis|reassurance|undulating|credenza|comprehensible|protectorate|brazier|phenomenon|trenchant|pulmonary|phantasmal|alleviate|despondent",
    21: "approximation|arachnid|legation|echolocation|censers|affinities|diffidence|conflagration|pathologically|embodiment|butane|thermotaxis|glycerin|porpoises|cataract|inaugurate|alabaster|psychological",
    22: "quiche|bioluminescence|arugula|assemblage|euphemism|chickadee|vibrometer|leprosy|acolyte|asymmetric|mayonnaise|eureka|innocuous|shar-pei|sputum|annelids|Tripoli|endothermy|cerulean",
    23: "kerosene|neurological|éclair|cul-de-sac|Pennsylvania|mysticetes|irascibility|electrolytes|ampulla|Eritrea|a cappella|ototoxic|sensilla|forsythia|Amharic|Aphrodite|eponymous|salicylic acid",
    24: "Gloucester|dugong|Presbyterian|stomatopods|prosciutto|solenoid|Sierra Leone|frankincense|chitinous|Krio|vibrissae|solenodon|trichobothria|Addis Ababa|Bildungsroman|lactobacillus|Cappadocia|spes phthisica",
}

ALTERNATES = {
    "fertilizer": ["fertiliser"],
    "materialize": ["materialise"],
    "odorant": ["odourant"],
    "brazier": ["brasier"],
    "glycerin": ["glycerine"],
    "kerosene": ["kerosine"],
}

PAGE_IMAGE = {
    **{page: "IMG_1591.jpeg" for page in (1, 3, 5, 7)},
    **{page: "IMG_1592.jpeg" for page in (2, 4, 6, 8)},
    **{page: "IMG_1593.jpeg" for page in (9, 11, 13, 15)},
    **{page: "IMG_1594.jpeg" for page in (10, 12, 14, 16)},
    **{page: "IMG_1595.jpeg" for page in (17, 19, 21, 23)},
    **{page: "IMG_1596.jpeg" for page in (18, 20, 22, 24)},
}

STARTS = {
    1: 1, 2: 20, 3: 39, 4: 59, 5: 78, 6: 97, 7: 116, 8: 135,
    9: 154, 10: 174, 11: 193, 12: 212, 13: 231, 14: 249, 15: 267,
    16: 286, 17: 304, 18: 323, 19: 342, 20: 360, 21: 378, 22: 396,
    23: 415, 24: 433,
}

# Raw full-photo OCR scores for entries whose first pass was visibly garbled.
# These spellings were checked and corrected against the page images.
CORRECTED_OCR_SCORES = {
    258: 0.5,  # snarkiness
    353: 0.3,  # finesse
    356: 0.5,  # irrelevant
    390: 0.3,  # glycerin
    445: 0.3,  # trichobothria
}


def make_records():
    draft_path = ROOT / "wordlists/round2.draft.json"
    draft = json.loads(draft_path.read_text()) if draft_path.exists() else []
    confidence = {}
    for item in draft:
        if "source_image" in item:
            key = (item["source_image"], item["word"].casefold().rstrip("*"))
            confidence[key] = item.get("confidence", 1.0)

    records = []
    for page, serialized in PAGES.items():
        words = serialized.split("|")
        for line, word in enumerate(words, start=1):
            number = STARTS[page] + line - 1
            source = PAGE_IMAGE[page]
            score = CORRECTED_OCR_SCORES.get(
                number, confidence.get((source, word.casefold()), 1.0)
            )
            records.append({
                "id": f"w{number:04d}",
                "word": word,
                "accept": [word, *ALTERNATES.get(word, [])],
                "difficulty": 2,
                "ocr": {"page": page, "line": line, "confidence": score},
                "reviewed": False,
            })
    return records


def main():
    records = make_records()
    if len(records) != 450:
        raise SystemExit(f"Expected 450 entries, got {len(records)}")
    if [r["id"] for r in records] != [f"w{i:04d}" for i in range(1, 451)]:
        raise SystemExit("Printed numbering is not continuous from 1 to 450")

    output = {
        "schema": "spellingbee.wordlist/1",
        "id": "district-2026-r2",
        "title": "2026–2027 School Spelling Bee Study List — Round 2",
        "source": {
            "kind": "photo-ocr",
            "files": [f"IMG_{n}.jpeg" for n in range(1591, 1597)],
            "importedAt": "2026-11-24",
        },
        "words": records,
    }
    data_dir = ROOT / "app/data/wordlists"
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "round2.json").write_text(
        json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    review_lines = [
        "2026–2027 School Spelling Bee Study List — Round 2",
        "Difficulty 2 (the photos show no explicit bee-tier headings)",
        "",
        *(record["word"] for record in records),
    ]
    (ROOT / "wordlists/round2.review.txt").write_text(
        "\n".join(review_lines) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
