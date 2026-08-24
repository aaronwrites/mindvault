import { describe, expect, test } from "bun:test";
import { normalizeCaptureUrl } from "../src/lib/capture/normalize-capture-url";

describe("Capture URL normalization", () => {
    test("removes fragments and known tracking parameters from an article URL", () => {
        expect(normalizeCaptureUrl(
            "HTTPS://Docs.Example.com:443/guides/capture?topic=queues&utm_source=newsletter&utm_medium=email&gclid=click-id#overview",
        )).toBe("https://docs.example.com/guides/capture?topic=queues");
    });

    test("keeps meaningful URL distinctions outside the tracking policy", () => {
        expect(normalizeCaptureUrl(
            "https://docs.example.com/guides/capture?page=2&ref=appendix#examples",
        )).toBe("https://docs.example.com/guides/capture?page=2&ref=appendix");
    });
});
