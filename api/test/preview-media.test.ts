import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { parsePublicTextualSource } from "../src/lib/sources/extract-source-preview";
import { prepareRetainedPreviewMedia } from "../src/lib/sources/retain-source-preview-media";

describe("Source Preview media", () => {
    test("chooses the largest declared safe raster favicon and falls back to /favicon.ico", () => {
        const preview = parsePublicTextualSource(`<!doctype html><html><head>
            <link rel="icon" type="image/svg+xml" sizes="any" href="/mark.svg">
            <link rel="icon" type="image/png" sizes="32x32" href="/small.png">
            <link rel="apple-touch-icon" sizes="180x180" href="/touch.png">
            <title>Useful page title</title></head><body><main>This page has enough useful primary text to pass extraction and test selection of the best declared website icon without treating presentation media as evidence.</main></body></html>`, "https://example.com/article").sourcePreview;

        expect(preview.faviconUrl).toBe("https://example.com/touch.png");
        expect(parsePublicTextualSource("<html><head><title>Page</title></head><body></body></html>", "https://example.com/path").sourcePreview.faviconUrl)
            .toBe("https://example.com/favicon.ico");
    });

    test("preserves a bounded GIF byte-for-byte so browser animation remains available", async () => {
        const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");
        const retained = await prepareRetainedPreviewMedia(gif, "image/gif", gif.byteLength);

        expect(retained).toEqual({ bytes: gif, contentType: "image/gif" });
    });

    test("turns an oversized image into a bounded static WebP thumbnail", async () => {
        const pixels = Buffer.allocUnsafe(900 * 900 * 3);
        for (let index = 0; index < pixels.length; index += 1) pixels[index] = (index * 31 + Math.floor(index / 97)) % 256;
        const png = await sharp(pixels, { raw: { width: 900, height: 900, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer();
        const retained = await prepareRetainedPreviewMedia(png, "image/png", 300_000);

        expect(png.byteLength).toBeGreaterThan(300_000);
        expect(retained?.contentType).toBe("image/webp");
        expect(retained?.bytes.byteLength).toBeLessThanOrEqual(300_000);
        expect((await sharp(retained!.bytes).metadata()).pages).toBeOneOf([undefined, 1]);
    });
});
