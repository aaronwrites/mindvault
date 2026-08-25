import { describe, expect, test } from "bun:test";
import { createPassageTexts } from "../src/lib/passages/create-passages";

describe("Passage boundaries", () => {
    test("does not create a Passage for empty text", () => {
        expect(createPassageTexts("   \n\t ")).toEqual([]);
    });

    test("keeps short text as one Passage", () => {
        expect(createPassageTexts("Capture Context explains why this Source matters.")).toEqual([
            "Capture Context explains why this Source matters.",
        ]);
    });

    test("divides long text into stable retrieval units", () => {
        const text = `${"a ".repeat(500)}final`;

        expect(createPassageTexts(text)).toEqual([
            `${"a ".repeat(500)}`.trim(),
            "final",
        ]);
    });

    test("uses adjacent whitespace when text crosses a Passage boundary", () => {
        const text = `${"a".repeat(998)}\tboundary ${"b".repeat(20)}`;

        expect(createPassageTexts(text)).toEqual([
            "a".repeat(998),
            `boundary ${"b".repeat(20)}`,
        ]);
    });
});
