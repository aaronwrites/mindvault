import { describe, expect, test } from "bun:test";
import {
    fetchPublicSource,
    fetchPublicPreviewMedia,
    isPublicIpAddress,
    type SafeFetchDependencies,
    type SafeFetchTransport,
} from "../src/lib/sources/fetch-public-source";
import { classifySourceSupport } from "../src/lib/sources/classify-source-support";
import { parsePublicTextualSource } from "../src/lib/sources/extract-source-preview";

type StubResponse = {
    status: number;
    headers?: Record<string, string>;
    body?: string | Uint8Array;
};

const publicAddressResolver: SafeFetchDependencies["resolveAddresses"] = async hostname => {
    if (hostname === "unsafe.example") return ["127.0.0.1"];
    return ["8.8.8.8"];
};

function transport(responses: Record<string, StubResponse>): SafeFetchTransport {
    return {
        async fetch(target) {
            const response = responses[target.url];
            if (!response) throw new Error(`No response configured for ${target.url}`);
            return {
                status: response.status,
                headers: response.headers ?? { "content-type": "text/html; charset=utf-8" },
                body: typeof response.body === "string" || response.body === undefined
                    ? new TextEncoder().encode(response.body ?? "article body")
                    : response.body,
            };
        },
    };
}

describe("public Source fetch policy", () => {
    test("prefers HTML so content-negotiating documentation sites return rich preview metadata", async () => {
        const requestedAcceptHeaders: string[] = [];
        const result = await fetchPublicSource("https://docs.example/overview", {
            resolveAddresses: publicAddressResolver,
            transport: {
                async fetch(target) {
                    requestedAcceptHeaders.push(target.accept);
                    const servesHtml = target.accept.startsWith("text/html");
                    return {
                        status: 200,
                        headers: { "content-type": servesHtml ? "text/html; charset=utf-8" : "text/markdown" },
                        body: new TextEncoder().encode(servesHtml
                            ? '<html><head><meta property="og:title" content="Documentation overview"><meta property="og:image" content="/preview.png"></head><body><main>Useful documentation content.</main></body></html>'
                            : "# Documentation overview"),
                    };
                },
            },
        });

        expect(result).toEqual({
            ok: true,
            response: expect.objectContaining({ contentType: "text/html" }),
            permanentRedirects: [],
        });
        expect(requestedAcceptHeaders).toEqual(["text/html, application/xhtml+xml;q=0.9"]);
        expect(classifySourceSupport(result)).toEqual({
            kind: "supported",
            sourceKind: "public-textual-web",
            adapter: "public-textual-web",
        });
        if (!result.ok) throw new Error("Expected negotiated HTML");
        expect(parsePublicTextualSource(new TextDecoder().decode(result.response.body), result.response.finalUrl).sourcePreview).toEqual(
            expect.objectContaining({
                title: "Documentation overview",
                previewImageUrl: "https://docs.example/preview.png",
            }),
        );
    });

    test("retries with explicit Markdown negotiation when an HTML representation is unavailable", async () => {
        const requestedAcceptHeaders: string[] = [];
        const result = await fetchPublicSource("https://example.com/readme", {
            resolveAddresses: publicAddressResolver,
            transport: {
                async fetch(target) {
                    requestedAcceptHeaders.push(target.accept);
                    if (target.accept.startsWith("text/html")) {
                        return { status: 406, headers: {}, body: new Uint8Array() };
                    }
                    return {
                        status: 200,
                        headers: { "content-type": "text/markdown; charset=utf-8" },
                        body: new TextEncoder().encode("# Project README\n\nThis Markdown source contains enough useful documentation to be retained as primary evidence when the origin cannot provide an HTML representation. It remains inside the same bounded public-source fetch policy."),
                    };
                },
            },
        });

        expect(requestedAcceptHeaders).toEqual([
            "text/html, application/xhtml+xml;q=0.9",
            "text/markdown, text/plain;q=0.9, text/x-markdown;q=0.8, application/markdown;q=0.8",
        ]);
        expect(result).toEqual({
            ok: true,
            response: expect.objectContaining({ contentType: "text/markdown" }),
            permanentRedirects: [],
        });
        expect(classifySourceSupport(result)).toEqual({
            kind: "supported",
            sourceKind: "public-textual-web",
            adapter: "public-textual-web",
        });
        if (!result.ok) throw new Error("Expected Markdown fallback");
        expect(parsePublicTextualSource(new TextDecoder().decode(result.response.body), result.response.finalUrl)).toEqual(
            expect.objectContaining({
                evidenceCoverage: "primary-content",
                failureReason: null,
            }),
        );
    });

    test("retries a server-selected plain-text representation through the bounded fallback profile", async () => {
        const requestedAcceptHeaders: string[] = [];
        const result = await fetchPublicSource("https://example.com/robots.txt", {
            resolveAddresses: publicAddressResolver,
            transport: {
                async fetch(target) {
                    requestedAcceptHeaders.push(target.accept);
                    return {
                        status: 200,
                        headers: { "content-type": "text/plain" },
                        body: new TextEncoder().encode("User-agent: *\nDisallow: /private"),
                    };
                },
            },
        });

        expect(requestedAcceptHeaders).toHaveLength(2);
        expect(result).toEqual({
            ok: true,
            response: expect.objectContaining({ contentType: "text/plain" }),
            permanentRedirects: [],
        });
        expect(classifySourceSupport(result)?.kind).toBe("supported");
    });

    test("fetches only a bounded, correctly labelled raster preview image", async () => {
        const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9aQAAAABJRU5ErkJggg==", "base64"));

        const result = await fetchPublicPreviewMedia("https://example.com/preview.png", {
            resolveAddresses: publicAddressResolver,
            transport: transport({
                "https://example.com/preview.png": { status: 200, headers: { "content-type": "image/png" }, body: png },
            }),
        });

        expect(result).toEqual({
            ok: true,
            response: expect.objectContaining({ contentType: "image/png", body: png }),
            permanentRedirects: [],
        });
    });

    test("rejects a response that claims to be an image but has no supported image signature", async () => {
        const result = await fetchPublicPreviewMedia("https://example.com/not-an-image", {
            resolveAddresses: publicAddressResolver,
            transport: transport({
                "https://example.com/not-an-image": { status: 200, headers: { "content-type": "image/png" }, body: "<html>not an image</html>" },
            }),
        });

        expect(result).toEqual({ ok: false, failure: { kind: "invalid-media-content" } });
    });

    test("applies the public-network, redirect, type, size, and timeout protections to preview media", async () => {
        const unsafe = await fetchPublicPreviewMedia("https://unsafe.example/image.png", {
            resolveAddresses: publicAddressResolver,
            transport: { fetch: async () => { throw new Error("transport must not run"); } },
        });
        expect(unsafe).toEqual({ ok: false, failure: { kind: "unsafe-network-target", url: "https://unsafe.example/image.png" } });

        const unsafeRedirect = await fetchPublicPreviewMedia("https://safe.example/image.png", {
            resolveAddresses: publicAddressResolver,
            transport: transport({ "https://safe.example/image.png": { status: 302, headers: { location: "https://unsafe.example/image.png" } } }),
        });
        expect(unsafeRedirect).toEqual({ ok: false, failure: { kind: "unsafe-network-target", url: "https://unsafe.example/image.png" } });

        const unsupported = await fetchPublicPreviewMedia("https://safe.example/image.svg", {
            resolveAddresses: publicAddressResolver,
            transport: transport({ "https://safe.example/image.svg": { status: 200, headers: { "content-type": "image/svg+xml" } } }),
        });
        expect(unsupported).toEqual({ ok: false, failure: { kind: "unsupported-content-type", contentType: "image/svg+xml" } });

        const oversized = await fetchPublicPreviewMedia("https://safe.example/large.png", {
            maxResponseBytes: 8,
            resolveAddresses: publicAddressResolver,
            transport: transport({ "https://safe.example/large.png": { status: 200, headers: { "content-type": "image/png" }, body: "nine bytes" } }),
        });
        expect(oversized).toEqual({ ok: false, failure: { kind: "response-too-large", maxResponseBytes: 8 } });

        const timedOut = await fetchPublicPreviewMedia("https://safe.example/stalled.png", {
            timeoutMs: 10,
            resolveAddresses: publicAddressResolver,
            transport: { fetch: () => new Promise(() => {}) },
        });
        expect(timedOut).toEqual({ ok: false, failure: { kind: "timeout" } });
    });
    test("selects the public textual adapter for a bounded HTML article", async () => {
        const fetched = await fetchPublicSource("https://example.com/article", {
            resolveAddresses: publicAddressResolver,
            transport: transport({ "https://example.com/article": { status: 200 } }),
        });

        expect(classifySourceSupport(fetched)).toEqual({
            kind: "supported",
            sourceKind: "public-textual-web",
            adapter: "public-textual-web",
        });
    });

    test("classifies a bounded PDF response as an unsupported Source Kind", async () => {
        const fetched = await fetchPublicSource("https://example.com/article.pdf", {
            resolveAddresses: publicAddressResolver,
            transport: transport({ "https://example.com/article.pdf": { status: 200, headers: { "content-type": "application/pdf" } } }),
        });

        expect(classifySourceSupport(fetched)).toEqual({
            kind: "unsupported",
            sourceKind: "pdf",
            reason: "unsupported-content-type",
        });
    });

    test("classifies a bounded image response as an unsupported Source Kind", async () => {
        const fetched = await fetchPublicSource("https://example.com/diagram.png", {
            resolveAddresses: publicAddressResolver,
            transport: transport({ "https://example.com/diagram.png": { status: 200, headers: { "content-type": "image/png" } } }),
        });

        expect(classifySourceSupport(fetched)).toEqual({
            kind: "unsupported",
            sourceKind: "image",
            reason: "unsupported-content-type",
        });
    });

    test("keeps a bounded response without a content type unsupported when its Source Kind is ambiguous", async () => {
        const fetched = await fetchPublicSource("https://example.com/unknown", {
            resolveAddresses: publicAddressResolver,
            transport: transport({ "https://example.com/unknown": { status: 200, headers: {} } }),
        });

        expect(classifySourceSupport(fetched)).toEqual({
            kind: "unsupported",
            sourceKind: "unknown",
            reason: "ambiguous-content-type",
        });
    });

    test("classifies public and unsafe network addresses without making network requests", () => {
        expect(isPublicIpAddress("8.8.8.8")).toBe(true);
        expect(isPublicIpAddress("2606:4700:4700::1111")).toBe(true);
        expect(isPublicIpAddress("127.0.0.1")).toBe(false);
        expect(isPublicIpAddress("10.0.0.1")).toBe(false);
        expect(isPublicIpAddress("169.254.1.1")).toBe(false);
        expect(isPublicIpAddress("192.0.2.1")).toBe(false);
        expect(isPublicIpAddress("192.52.193.1")).toBe(false);
        expect(isPublicIpAddress("192.175.48.1")).toBe(false);
        expect(isPublicIpAddress("::1")).toBe(false);
        expect(isPublicIpAddress("64:ff9b::d8c6:4f01")).toBe(true);
        expect(isPublicIpAddress("64:ff9b::7f00:1")).toBe(false);
        expect(isPublicIpAddress("64:ff9b::a00:1")).toBe(false);
        expect(isPublicIpAddress("100::1")).toBe(false);
        expect(isPublicIpAddress("2001::1")).toBe(false);
        expect(isPublicIpAddress("3fff::1")).toBe(false);
        expect(isPublicIpAddress("5f00::1")).toBe(false);
    });

    test("rejects a loopback URL before the transport can reach it", async () => {
        const result = await fetchPublicSource("http://127.0.0.1/internal", {
            resolveAddresses: async hostname => [hostname],
            transport: { fetch: async () => { throw new Error("transport must not run"); } },
        });

        expect(result).toEqual({ ok: false, failure: { kind: "unsafe-network-target", url: "http://127.0.0.1/internal" } });
    });

    test("returns bounded textual content and permanent redirect provenance", async () => {
        const result = await fetchPublicSource("https://start.example/article", {
            resolveAddresses: publicAddressResolver,
            transport: transport({
                "https://start.example/article": { status: 308, headers: { location: "https://final.example/article" } },
                "https://final.example/article": { status: 200, body: "Useful article text" },
            }),
        });

        expect(result).toEqual({
            ok: true,
            response: expect.objectContaining({
                originalUrl: "https://start.example/article",
                finalUrl: "https://final.example/article",
                body: new TextEncoder().encode("Useful article text"),
            }),
            permanentRedirects: [{ from: "https://start.example/article", to: "https://final.example/article" }],
        });
    });

    test("rejects an unsafe redirect destination before the transport can reach it", async () => {
        const fetchTransport = transport({
            "https://safe.example/article": { status: 302, headers: { location: "https://unsafe.example/private" } },
        });
        const result = await fetchPublicSource("https://safe.example/article", {
            resolveAddresses: publicAddressResolver,
            transport: fetchTransport,
        });

        expect(result).toEqual({ ok: false, failure: { kind: "unsafe-network-target", url: "https://unsafe.example/private" } });
    });

    test("returns typed failures for unsupported protocols, non-textual content, oversized bodies, and redirect limits", async () => {
        const nonHttp = await fetchPublicSource("ftp://example.com/file", { resolveAddresses: publicAddressResolver, transport: transport({}) });
        expect(nonHttp).toEqual({ ok: false, failure: { kind: "unsupported-protocol", url: "ftp://example.com/file" } });

        const nonText = await fetchPublicSource("https://example.com/file", {
            resolveAddresses: publicAddressResolver,
            transport: transport({ "https://example.com/file": { status: 200, headers: { "content-type": "application/pdf" } } }),
        });
        expect(nonText).toEqual({ ok: false, failure: { kind: "unsupported-content-type", contentType: "application/pdf" } });

        const oversized = await fetchPublicSource("https://example.com/large", {
            maxResponseBytes: 8,
            resolveAddresses: publicAddressResolver,
            transport: transport({ "https://example.com/large": { status: 200, body: "nine bytes" } }),
        });
        expect(oversized).toEqual({ ok: false, failure: { kind: "response-too-large", maxResponseBytes: 8 } });

        const redirectLimit = await fetchPublicSource("https://example.com/one", {
            maxRedirects: 1,
            resolveAddresses: publicAddressResolver,
            transport: transport({
                "https://example.com/one": { status: 302, headers: { location: "/two" } },
                "https://example.com/two": { status: 302, headers: { location: "/three" } },
            }),
        });
        expect(redirectLimit).toEqual({ ok: false, failure: { kind: "redirect-limit-exceeded", maxRedirects: 1 } });
    });

    test("bounds a stalled transport with a timeout outcome", async () => {
        const cancellationObserved = Promise.withResolvers<void>();
        const result = await fetchPublicSource("https://example.com/stalled", {
            timeoutMs: 10,
            resolveAddresses: publicAddressResolver,
            transport: { fetch: target => new Promise((_, reject) => {
                target.signal.addEventListener("abort", () => {
                    cancellationObserved.resolve();
                    reject(target.signal.reason);
                });
            }) },
        });

        expect(result).toEqual({ ok: false, failure: { kind: "timeout" } });
        await cancellationObserved.promise;
    });

    test("bounds stalled address resolution before opening a transport", async () => {
        const result = await fetchPublicSource("https://example.com/stalled-resolution", {
            timeoutMs: 10,
            resolveAddresses: () => new Promise(() => {}),
            transport: { fetch: async () => { throw new Error("transport must not run"); } },
        });

        expect(result).toEqual({ ok: false, failure: { kind: "timeout", url: "https://example.com/stalled-resolution" } });
    });
});
