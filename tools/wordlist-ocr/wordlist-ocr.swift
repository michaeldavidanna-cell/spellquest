#!/usr/bin/env xcrun swift
import AppKit
import Foundation
import Vision

struct Entry: Codable {
    let word: String
    let source_image: String
    let confidence: Float
}

struct OCRLine {
    let text: String
    let x: CGFloat
    let y: CGFloat
    let confidence: Float
}

func usage() -> Never {
    fputs("Usage: wordlist-ocr.swift [input-dir] [output.json] [output.txt]\n", stderr)
    exit(2)
}

let scriptURL = URL(fileURLWithPath: #filePath).standardizedFileURL
let repoRoot = scriptURL.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
let args = Array(CommandLine.arguments.dropFirst())
if args.count > 3 { usage() }
let inputDir = args.count > 0 ? URL(fileURLWithPath: args[0]) : repoRoot.appendingPathComponent("wordlists/inbox")
let jsonURL = args.count > 1 ? URL(fileURLWithPath: args[1]) : repoRoot.appendingPathComponent("wordlists/round2.draft.json")
let textURL = args.count > 2 ? URL(fileURLWithPath: args[2]) : repoRoot.appendingPathComponent("wordlists/round2.draft.txt")

func words(from line: String) -> [String] {
    // Remove common numbered-list markers, including “1.”, “(1)” and “1)”
    var value = line.replacingOccurrences(of: #"^\s*[\(\[]?\d+[\)\].:]?\s*"#, with: "", options: .regularExpression)
    value = value.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
    return value.split(separator: " ").compactMap { part in
        let cleaned = part.trimmingCharacters(in: CharacterSet(charactersIn: " \t\n\r.,;:!?()[]{}\"'“”‘’—–"))
        guard !cleaned.isEmpty,
              cleaned.rangeOfCharacter(from: .letters) != nil,
              cleaned.rangeOfCharacter(from: .decimalDigits) == nil else { return nil }
        return cleaned
    }
}

func recognizedLines(in imageURL: URL) throws -> [OCRLine] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    request.recognitionLanguages = ["en-US"]
    let imageData = try Data(contentsOf: imageURL)
    try VNImageRequestHandler(data: imageData).perform([request])
    return (request.results ?? []).compactMap { observation in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        return OCRLine(text: candidate.string,
                       x: observation.boundingBox.minX,
                       y: observation.boundingBox.midY,
                       confidence: candidate.confidence)
    }
}

func orderedLines(_ lines: [OCRLine]) -> [OCRLine] {
    // Vision returns line boxes without reading order. Split on the largest
    // horizontal gap so two-column sheets read down the left column, then right.
    let xs = lines.map(\.x).sorted()
    var split: (x: CGFloat, gap: CGFloat)? = nil
    if xs.count > 1 {
        for i in 1..<xs.count {
            let gap = xs[i] - xs[i - 1]
            if gap > 0.14 && (split == nil || gap > split!.gap) { split = (x: xs[i - 1] + gap / 2, gap: gap) }
        }
    }
    let cutoff = split?.x
    let left = lines.filter { cutoff == nil || $0.x < cutoff! }
    let right = lines.filter { cutoff != nil && $0.x >= cutoff! }
    func topToBottom(_ a: OCRLine, _ b: OCRLine) -> Bool {
        if abs(a.y - b.y) > 0.025 { return a.y > b.y }
        return a.x < b.x
    }
    return left.sorted(by: topToBottom) + right.sorted(by: topToBottom)
}

func spellingColumnLines(_ lines: [OCRLine]) -> [OCRLine] {
    // The supplied study-list pages use two narrow word columns (one on each
    // page of the photographed spread), followed by wide definition columns.
    // The normalized x bands omit definitions, part-of-speech labels, and page
    // furniture; the y bounds omit headers and copyright footers.
    lines.filter { line in
        (0.05...0.12).contains(line.x) || (0.54...0.62).contains(line.x)
    }.filter { (0.07...0.94).contains($0.y) }
}

let fileManager = FileManager.default
guard fileManager.fileExists(atPath: inputDir.path) else {
    fputs("Input directory does not exist: \(inputDir.path)\n", stderr); exit(1)
}
let supported = Set(["jpg", "jpeg", "heic", "png"])
let images = try fileManager.contentsOfDirectory(at: inputDir, includingPropertiesForKeys: nil)
    .filter { supported.contains($0.pathExtension.lowercased()) }
    .sorted { $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending }
guard !images.isEmpty else {
    fputs("No JPG, HEIC, or PNG images found in \(inputDir.path)\n", stderr); exit(1)
}

var entries: [Entry] = []
var seen = Set<String>()
for image in images {
    do {
        for line in orderedLines(spellingColumnLines(try recognizedLines(in: image))) {
            for word in words(from: line.text) {
                let key = word.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en_US"))
                guard seen.insert(key).inserted else { continue }
                entries.append(Entry(word: word, source_image: image.lastPathComponent, confidence: line.confidence))
            }
        }
    } catch {
        let detail = error as NSError
        fputs("Could not OCR \(image.lastPathComponent): \(detail.domain) (\(detail.code)) \(detail.userInfo)\n", stderr); exit(1)
    }
}
guard !entries.isEmpty else { fputs("OCR found no words.\n", stderr); exit(1) }
let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
try fileManager.createDirectory(at: jsonURL.deletingLastPathComponent(), withIntermediateDirectories: true)
try encoder.encode(entries).write(to: jsonURL, options: .atomic)
let plainText = entries.map(\.word).joined(separator: "\n") + "\n"
try plainText.write(to: textURL, atomically: true, encoding: .utf8)
print("Wrote \(entries.count) unique words to \(jsonURL.path) and \(textURL.path)")
