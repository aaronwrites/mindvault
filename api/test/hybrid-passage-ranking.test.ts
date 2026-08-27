import { describe, expect, test } from "bun:test";
import { aggregateHybridPassageMatches } from "../src/lib/recall/hybrid-passage-ranking";

describe("hybrid Passage ranking", () => {
    test("fuses lexical and semantic ranks before returning Knowledge Item results", () => {
        const results = aggregateHybridPassageMatches({
            semantic: [
                { passageId: 11, knowledgeItemId: 1, origin: "source-snapshot", text: "Source passage", rank: 1 },
                { passageId: 22, knowledgeItemId: 2, origin: "source-snapshot", text: "Conceptual match", rank: 2 },
            ],
            lexical: [
                { passageId: 33, knowledgeItemId: 2, origin: "source-snapshot", text: "Exact identifier", rank: 1 },
                { passageId: 11, knowledgeItemId: 1, origin: "source-snapshot", text: "Source passage", rank: 2 },
            ],
        });

        expect(results.map(result => result.knowledgeItemId)).toEqual([1, 2]);
        expect(results[0]?.passages).toEqual([
            expect.objectContaining({ passageId: 11, semanticRank: 1, lexicalRank: 2 }),
        ]);
        expect(results[1]?.passages).toEqual(expect.arrayContaining([
            expect.objectContaining({ passageId: 22, semanticRank: 2 }),
            expect.objectContaining({ passageId: 33, lexicalRank: 1 }),
        ]));
    });

    test("gives Capture Context a deliberate boost over equally relevant Source Snapshot text", () => {
        const results = aggregateHybridPassageMatches({
            semantic: [
                { passageId: 101, knowledgeItemId: 1, origin: "source-snapshot", text: "A source match", rank: 1 },
                { passageId: 202, knowledgeItemId: 2, origin: "personal-note", text: "The reason I saved it", rank: 2 },
            ],
            lexical: [
                { passageId: 101, knowledgeItemId: 1, origin: "source-snapshot", text: "A source match", rank: 1 },
                { passageId: 202, knowledgeItemId: 2, origin: "personal-note", text: "The reason I saved it", rank: 2 },
            ],
        });

        expect(results.map(result => result.knowledgeItemId)).toEqual([2, 1]);
        expect(results[0]?.passages[0]).toEqual(expect.objectContaining({
            origin: "personal-note",
            text: "The reason I saved it",
        }));
    });
});
