import { describe, expect, test } from "bun:test";
import { MAXIMUM_GENERATION_INPUT_BYTES } from "../src/lib/ai/limit-generation-input";
import { recognitionSummaryPrompt } from "../src/lib/recognition-summaries/generate-recognition-summary";
import { topicTagGenerationPrompt } from "../src/lib/topic-tags/generate-topic-tags";

const oversizedMetadata = "🧠 metadata ".repeat(10_000);

describe("generation input limits", () => {
    test("keeps Recognition Summary prompts within Ollama's byte limit when metadata is oversized", () => {
        const prompt = recognitionSummaryPrompt({ title: "Large metadata", evidenceText: oversizedMetadata, evidenceCoverage: "metadata-only" }, []);

        expect(new TextEncoder().encode(prompt).byteLength).toBeLessThanOrEqual(MAXIMUM_GENERATION_INPUT_BYTES);
        expect(prompt).toContain("The Source Snapshot contains metadata only");
        expect(prompt).toEndWith("[Additional Source content was omitted because it exceeds the generation input limit.]");
    });

    test("keeps Topic Tag prompts within Ollama's byte limit when metadata is oversized", () => {
        const prompt = topicTagGenerationPrompt({ title: "Large metadata", evidenceText: oversizedMetadata, evidenceCoverage: "metadata-only" }, []);

        expect(new TextEncoder().encode(prompt).byteLength).toBeLessThanOrEqual(MAXIMUM_GENERATION_INPUT_BYTES);
        expect(prompt).toContain("The Source Snapshot is metadata only");
        expect(prompt).toEndWith("[Additional Source content was omitted because it exceeds the generation input limit.]");
    });
});
