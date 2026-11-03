import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { DeterministicEmbeddingProvider, ManualClock } from "./support/deterministic-runtime";
import { createIntegrationHarness, type IntegrationHarness } from "./support/integration-harness";
import { DeterministicOriginalFileStorageFake } from "../src/lib/original-files/deterministic-original-file-storage-fake";
import { createOriginalFileOperationsWorker } from "../src/lib/original-files/process-original-file-operations";

let harness: IntegrationHarness | undefined;

afterEach(async () => {
    await harness?.cleanup();
    harness = undefined;
});

describe("permanent Knowledge Item deletion", () => {
    test.skipIf(!process.env.TEST_DATABASE_URL)("keeps an Original File deletion pending until storage confirms removal", async () => {
        const storage = new DeterministicOriginalFileStorageFake();
        harness = await createIntegrationHarness(
            database => createApp({ database: database.db, embeddingProvider: new DeterministicEmbeddingProvider(), originalFileStorage: storage }),
            database => createOriginalFileOperationsWorker({ database: database.db, storage }),
        );

        const capture = await captureFile("proposal.pdf", "%PDF- retained bytes");
        expect(capture.knowledgeItemId).toBeDefined();
        const knowledgeItemId = capture.knowledgeItemId!;
        await fetch(`${harness.apiBaseUrl}/knowledge-items/${knowledgeItemId}/trash`, { method: "POST" });

        const request = await fetch(`${harness.apiBaseUrl}/knowledge-items/${knowledgeItemId}/permanent-delete`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ confirmation: "permanently-delete" }),
        });
        expect(request.status).toBe(202);
        expect(await (await fetch(`${harness.apiBaseUrl}/knowledge-items/trash`)).json()).toEqual([
            expect.objectContaining({ id: knowledgeItemId, lifecycleState: "pending-permanent-deletion" }),
        ]);
        expect(await fetch(`${harness.apiBaseUrl}/knowledge-items/${knowledgeItemId}/restore`, { method: "POST" })).toHaveProperty("status", 404);

        await harness.drainWorker();

        expect(await (await fetch(`${harness.apiBaseUrl}/knowledge-items/trash`)).json()).toEqual([]);
        expect(storage.uploadedFileCount).toBe(0);
    });

    test.skipIf(!process.env.TEST_DATABASE_URL)("reconciles a provider asset left by an ambiguous upload before any Capture became durable", async () => {
        const clock = new ManualClock(new Date());
        const storage = new DeterministicOriginalFileStorageFake();
        storage.ambiguouslyUploadNext("connection dropped after retention");
        harness = await createIntegrationHarness(
            database => createApp({ database: database.db, embeddingProvider: new DeterministicEmbeddingProvider(), originalFileStorage: storage }),
            database => createOriginalFileOperationsWorker({ database: database.db, storage, clock }),
        );

        const failedCapture = await captureFile("proposal.pdf", "%PDF- retained bytes");
        expect(failedCapture).toEqual(expect.objectContaining({ error: "original-file-storage-unavailable" }));
        expect(storage.uploadedFileCount).toBe(1);

        clock.advance(Date.now() - clock.now().getTime() + 1_000);
        await harness.drainWorker();

        expect(storage.uploadedFileCount).toBe(0);
        expect(await (await fetch(`${harness.apiBaseUrl}/knowledge-items`)).json()).toEqual([]);
    });

    test.skipIf(!process.env.TEST_DATABASE_URL)("keeps failed cleanup visible and allows manual recovery", async () => {
        const clock = new ManualClock(new Date());
        const storage = new DeterministicOriginalFileStorageFake();
        harness = await createIntegrationHarness(
            database => createApp({ database: database.db, embeddingProvider: new DeterministicEmbeddingProvider(), originalFileStorage: storage }),
            database => createOriginalFileOperationsWorker({ database: database.db, storage, maxAttempts: 1, clock }),
        );
        const capture = await captureFile("proposal.pdf", "%PDF- retained bytes");
        const knowledgeItemId = capture.knowledgeItemId!;
        await fetch(`${harness.apiBaseUrl}/knowledge-items/${knowledgeItemId}/trash`, { method: "POST" });
        await fetch(`${harness.apiBaseUrl}/knowledge-items/${knowledgeItemId}/permanent-delete`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmation: "permanently-delete" }) });
        storage.setOutage(true);
        // Database defaults use the PostgreSQL host clock. Make newly queued work
        // eligible explicitly even when that host runs slightly ahead of the test runner.
        clock.advance(60_000);

        await harness.drainWorker();

        expect(await (await fetch(`${harness.apiBaseUrl}/knowledge-items/trash`)).json()).toEqual([
            expect.objectContaining({ id: knowledgeItemId, deletion: expect.objectContaining({ status: "failed", failureReason: "Original File storage is unavailable" }) }),
        ]);
        storage.setOutage(false);
        expect((await fetch(`${harness.apiBaseUrl}/knowledge-items/${knowledgeItemId}/permanent-delete`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmation: "permanently-delete" }) })).status).toBe(202);
        await harness.drainWorker();
        expect(await (await fetch(`${harness.apiBaseUrl}/knowledge-items/trash`)).json()).toEqual([]);
    });
});

async function captureFile(filename: string, contents: string): Promise<{ knowledgeItemId?: number; error?: string }> {
    const form = new FormData();
    form.set("file", new Blob([contents], { type: "application/pdf" }), filename);
    const response = await fetch(`${harness!.apiBaseUrl}/captures/file`, { method: "POST", body: form });
    return response.json() as Promise<{ knowledgeItemId?: number; error?: string }>;
}
