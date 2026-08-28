import { describe, expect, test } from "bun:test";
import { normalizeTopicTagAlias } from "../src/lib/topic-tags/normalize-topic-tag";

describe("Topic Tag mechanical normalization", () => {
    test("treats capitalization, spacing, and hyphenation variants as one alias", () => {
        expect(normalizeTopicTagAlias("  Machine-Learning ")).toBe("machine learning");
        expect(normalizeTopicTagAlias("MACHINE   LEARNING")).toBe("machine learning");
        expect(normalizeTopicTagAlias("machine learning")).toBe("machine learning");
    });

    test("preserves related but distinct concepts", () => {
        expect(normalizeTopicTagAlias("Machine Learning")).not.toBe(normalizeTopicTagAlias("Neural Networks"));
    });
});
