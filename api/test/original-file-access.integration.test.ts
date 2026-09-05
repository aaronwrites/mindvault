import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createApp } from "../src/app";
import { DeterministicOriginalFileStorageFake } from "../src/lib/original-files/deterministic-original-file-storage-fake";
import { DeterministicEmbeddingProvider } from "./support/deterministic-runtime";
import { createIntegrationHarness, type IntegrationHarness } from "./support/integration-harness";

let harness: IntegrationHarness | undefined;

afterEach(async () => {
    await harness?.cleanup();
    harness = undefined;
});

describe("Original File access", () => {
    test.skipIf(!process.env.TEST_DATABASE_URL)("exposes MindVault-owned actions and redirects a retained PDF to short-lived signed access", async () => {
        const storage = new DeterministicOriginalFileStorageFake();
        harness = await createIntegrationHarness(
            database => createApp({ database: database.db, embeddingProvider: new DeterministicEmbeddingProvider(), originalFileStorage: storage }),
            { runEligibleWork: async () => 0 },
        );

        const captured = await captureFile("../proposal.pdf", "%PDF- a retained proposal");
        expect(captured.status).toBe(201);
        expect(captured.body.knowledgeItem.source).toEqual(expect.objectContaining({
            originalFileActions: {
                open: `/knowledge-items/${captured.body.knowledgeItemId}/original-file/open`,
                download: `/knowledge-items/${captured.body.knowledgeItemId}/original-file/download`,
            },
        }));
        expect(JSON.stringify(captured.body)).not.toContain("fake:");
        expect(JSON.stringify(captured.body)).not.toContain("original-files/");

        const opened = await fetch(`${harness.apiBaseUrl}${captured.body.knowledgeItem.source.originalFileActions.open}`, { redirect: "manual" });
        expect(opened.status).toBe(302);
        expect(opened.headers.get("location")).toMatch(/^https:\/\/storage\.fake\/access\//);
        expect(opened.headers.get("location")).toContain("disposition=inline");
        expect(storage.canAccess(opened.headers.get("location")!)).toBe(true);
        expect(storage.canAccess(opened.headers.get("location")!, new Date("2100-01-01"))).toBe(false);
        expect(storage.canAccess("https://storage.fake/original-files/sha256-unknown")).toBe(false);

        const downloaded = await fetch(`${harness.apiBaseUrl}${captured.body.knowledgeItem.source.originalFileActions.download}`, { redirect: "manual" });
        expect(downloaded.status).toBe(302);
        expect(downloaded.headers.get("location")).toContain("disposition=attachment");
        expect(downloaded.headers.get("location")).toContain("filename=proposal.pdf");

        const hash = createHash("sha256").update("%PDF- a retained proposal").digest("hex");
        await storage.delete(`fake:sha256:${hash}`);
        const missing = await fetch(`${harness.apiBaseUrl}${captured.body.knowledgeItem.source.originalFileActions.download}`, { redirect: "manual" });
        expect(missing.status).toBe(404);
        expect(await missing.json()).toEqual({ error: "Original File unavailable" });
    });

    test.skipIf(!process.env.TEST_DATABASE_URL)("limits Open to browser-safe types and does not disclose unavailable provider details", async () => {
        const storage = new DeterministicOriginalFileStorageFake();
        harness = await createIntegrationHarness(
            database => createApp({ database: database.db, embeddingProvider: new DeterministicEmbeddingProvider(), originalFileStorage: storage }),
            { runEligibleWork: async () => 0 },
        );

        const captured = await captureFile("../../opaque.bin", "\u0000binary bytes");
        expect(captured.status).toBe(201);
        expect(captured.body.knowledgeItem.source.originalFileActions).toEqual({
            download: `/knowledge-items/${captured.body.knowledgeItemId}/original-file/download`,
        });
        const open = await fetch(`${harness.apiBaseUrl}/knowledge-items/${captured.body.knowledgeItemId}/original-file/open`, { redirect: "manual" });
        expect(open).toEqual(expect.objectContaining({ status: 404 }));
        expect(await open.json()).toEqual({ error: "Original File cannot be opened safely" });

        storage.setOutage(true);
        const download = await fetch(`${harness.apiBaseUrl}/knowledge-items/${captured.body.knowledgeItemId}/original-file/download`, { redirect: "manual" });
        expect(download.status).toBe(503);
        expect(await download.json()).toEqual({ error: "original-file-access-unavailable", retryable: true });
    });
});

async function captureFile(filename: string, contents: string): Promise<{ status: number; body: any }> {
    const form = new FormData();
    form.set("file", new Blob([contents], { type: "application/pdf" }), filename);
    const response = await fetch(`${harness!.apiBaseUrl}/captures/file`, { method: "POST", body: form });
    return { status: response.status, body: await response.json() };
}
