import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { DeterministicEmbeddingProvider } from "./support/deterministic-runtime";
import { createIntegrationHarness, type IntegrationHarness } from "./support/integration-harness";
import { DeterministicOriginalFileStorageFake } from "../src/lib/original-files/deterministic-original-file-storage-fake";

let harness: IntegrationHarness | undefined;

afterEach(async () => {
    await harness?.cleanup();
    harness = undefined;
});

describe("bounded Original File Capture", () => {
    test.skipIf(!process.env.TEST_DATABASE_URL)("retains one file, reuses exact bytes, and preserves each submitted filename and note", async () => {
        const storage = new DeterministicOriginalFileStorageFake();
        harness = await createIntegrationHarness(
            database => createApp({ database: database.db, embeddingProvider: new DeterministicEmbeddingProvider(), originalFileStorage: storage }),
            { runEligibleWork: async () => 0 },
        );

        const first = await captureFile("notes.txt", "A durable original file", "First reason");
        const second = await captureFile("renamed.txt", "A durable original file", "Later reason");

        expect(first.status).toBe(201);
        expect(second.status).toBe(201);
        expect(second.body).toEqual(expect.objectContaining({
            sourceId: first.body.sourceId,
            knowledgeItemId: first.body.knowledgeItemId,
            reused: true,
            availability: "unsupported",
            processingAttemptId: null,
        }));
        expect(second.body.captureId).not.toBe(first.body.captureId);

        const item = await (await fetch(`${harness.apiBaseUrl}/knowledge-items/${first.body.knowledgeItemId}`)).json() as { availability: string; captureContexts: Array<{ kind: string; summary: string }> };
        expect(item).toEqual(expect.objectContaining({
            availability: "unsupported",
            captureContexts: [
                { kind: "personal-note", summary: "First reason" },
                { kind: "personal-note", summary: "Later reason" },
            ],
        }));
        expect(storage.uploadedFileCount).toBe(1);
    });

    test.skipIf(!process.env.TEST_DATABASE_URL)("rejects empty, oversized, executable, and archive uploads without a Capture graph", async () => {
        const storage = new DeterministicOriginalFileStorageFake();
        harness = await createIntegrationHarness(
            database => createApp({ database: database.db, embeddingProvider: new DeterministicEmbeddingProvider(), originalFileStorage: storage, maximumOriginalFileBytes: 64 }),
            { runEligibleWork: async () => 0 },
        );

        for (const [name, bytes, expectedError] of [
            ["empty.txt", "", "empty-file"],
            ["large.txt", "x".repeat(65), "file-too-large"],
            ["tool.txt", "MZ executable", "prohibited-file"],
            ["archive.txt", "PK\x03\x04 archive", "prohibited-file"],
        ] as const) {
            const response = await captureFile(name, bytes);
            expect(response.status).toBe(expectedError === "file-too-large" ? 413 : 400);
            expect(response.body).toEqual({ error: expectedError });
        }

        const interrupted = await fetch(`${harness.apiBaseUrl}/captures/file`, {
            method: "POST",
            headers: { "content-type": "multipart/form-data; boundary=interrupted" },
            body: "--interrupted\r\nContent-Disposition: form-data; name=\"file\"; filename=\"partial.txt\"\r\n\r\npartial bytes",
        });
        expect(interrupted).toEqual(expect.objectContaining({ status: 400 }));
        expect(await interrupted.json()).toEqual({ error: "invalid-multipart" });

        const counts = await harness.database.pool.query<{ sources: string; captures: string }>("SELECT (SELECT count(*) FROM sources)::text AS sources, (SELECT count(*) FROM captures)::text AS captures");
        expect(counts.rows).toEqual([{ sources: "0", captures: "0" }]);
    });

    test.skipIf(!process.env.TEST_DATABASE_URL)("converges concurrent bytes and leaves no Capture graph when storage is unavailable", async () => {
        const storage = new DeterministicOriginalFileStorageFake();
        storage.setDelay(25);
        harness = await createIntegrationHarness(
            database => createApp({ database: database.db, embeddingProvider: new DeterministicEmbeddingProvider(), originalFileStorage: storage }),
            { runEligibleWork: async () => 0 },
        );

        const [first, second] = await Promise.all([captureFile("one.txt", "same bytes"), captureFile("two.txt", "same bytes")]);
        expect(first.status).toBe(201);
        expect(second.status).toBe(201);
        expect(first.body.sourceId).toBe(second.body.sourceId);
        expect(storage.uploadedFileCount).toBe(1);

        storage.setOutage(true);
        const unavailable = await captureFile("unavailable.txt", "different bytes");
        expect(unavailable).toEqual({ status: 503, body: { error: "original-file-storage-unavailable", retryable: true } });
        const counts = await harness.database.pool.query<{ sources: string; captures: string }>("SELECT (SELECT count(*) FROM sources)::text AS sources, (SELECT count(*) FROM captures)::text AS captures");
        expect(counts.rows).toEqual([{ sources: "1", captures: "2" }]);
    });

    test.skipIf(!process.env.TEST_DATABASE_URL)("recovers a durable upload intent after the database rejects final Capture persistence", async () => {
        const storage = new DeterministicOriginalFileStorageFake();
        harness = await createIntegrationHarness(
            database => createApp({ database: database.db, embeddingProvider: new DeterministicEmbeddingProvider(), originalFileStorage: storage }),
            { runEligibleWork: async () => 0 },
        );
        await harness.database.pool.query(`
            CREATE FUNCTION reject_original_file_capture() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'test capture failure'; END; $$ LANGUAGE plpgsql;
            CREATE TRIGGER reject_original_file_capture BEFORE INSERT ON captures FOR EACH ROW EXECUTE FUNCTION reject_original_file_capture();
        `);

        const failed = await captureFile("recoverable.txt", "recoverable original");
        expect(failed.status).toBe(500);
        expect(storage.uploadedFileCount).toBe(1);
        const pending = await harness.database.pool.query<{ state: string; captures: string }>("SELECT (SELECT storage_state FROM original_files)::text AS state, (SELECT count(*) FROM captures)::text AS captures");
        expect(pending.rows).toEqual([{ state: "pending-upload", captures: "0" }]);

        await harness.database.pool.query("DROP TRIGGER reject_original_file_capture ON captures; DROP FUNCTION reject_original_file_capture()");
        const recovered = await captureFile("recoverable.txt", "recoverable original");
        expect(recovered).toEqual(expect.objectContaining({ status: 201, body: expect.objectContaining({ availability: "unsupported" }) }));
        expect(storage.uploadedFileCount).toBe(1);
    });
});

async function captureFile(filename: string, contents: string, personalNote?: string): Promise<{ status: number; body: any }> {
    const form = new FormData();
    form.set("file", new Blob([contents], { type: "text/plain" }), filename);
    if (personalNote) form.set("personalNote", personalNote);
    const response = await fetch(`${harness!.apiBaseUrl}/captures/file`, { method: "POST", body: form });
    return { status: response.status, body: await response.json() };
}
