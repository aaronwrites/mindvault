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

describe("Knowledge Item Trash", () => {
    test.skipIf(!process.env.TEST_DATABASE_URL)("excludes trashed webpage and Original File Knowledge Items while preserving restoration and retained bytes", async () => {
        const storage = new DeterministicOriginalFileStorageFake();
        harness = await createIntegrationHarness(
            database => createApp({ database: database.db, embeddingProvider: new DeterministicEmbeddingProvider(), originalFileStorage: storage }),
            { runEligibleWork: async () => 0 },
        );

        const webpage = await captureUrl(harness.sourceServer.fetchUrl("/articles/primary-text"));
        const originalFile = await captureFile("proposal.pdf", "%PDF- retained bytes", "Initial note");
        expect(webpage.status).toBe(201);
        expect(originalFile.status).toBe(201);

        for (const captured of [webpage, originalFile]) {
            const response = await fetch(`${harness.apiBaseUrl}/knowledge-items/${captured.body.knowledgeItemId}/trash`, { method: "POST" });
            expect(response.status).toBe(204);
        }
        expect(await (await fetch(`${harness.apiBaseUrl}/knowledge-items`)).json()).toEqual([]);
        const trash = await (await fetch(`${harness.apiBaseUrl}/knowledge-items/trash`)).json() as Array<{
            id: number;
            lifecycleState: string;
            source: { originalFileActions?: { download: string } };
        }>;
        expect(trash).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: webpage.body.knowledgeItemId, lifecycleState: "trashed" }),
            expect.objectContaining({ id: originalFile.body.knowledgeItemId, lifecycleState: "trashed" }),
        ]));

        const retainedDownload = await fetch(`${harness.apiBaseUrl}${trash.find(item => item.id === originalFile.body.knowledgeItemId)!.source.originalFileActions!.download}`, { redirect: "manual" });
        expect(retainedDownload.status).toBe(302);
        expect(storage.uploadedFileCount).toBe(1);

        const [firstRestore, secondRestore] = await Promise.all([
            fetch(`${harness.apiBaseUrl}/knowledge-items/${webpage.body.knowledgeItemId}/restore`, { method: "POST" }),
            fetch(`${harness.apiBaseUrl}/knowledge-items/${webpage.body.knowledgeItemId}/restore`, { method: "POST" }),
        ]);
        expect([firstRestore.status, secondRestore.status]).toEqual([200, 200]);
        await fetch(`${harness.apiBaseUrl}/knowledge-items/${webpage.body.knowledgeItemId}/trash`, { method: "POST" });

        const restoredWebpage = await captureUrl(harness.sourceServer.fetchUrl("/articles/primary-text"), "Restored webpage note");
        const restoredFile = await captureFile("renamed.pdf", "%PDF- retained bytes", "Restored file note");
        expect(restoredWebpage.body).toEqual(expect.objectContaining({ knowledgeItemId: webpage.body.knowledgeItemId, reused: true, restoredFromTrash: true }));
        expect(restoredFile.body).toEqual(expect.objectContaining({ knowledgeItemId: originalFile.body.knowledgeItemId, reused: true, restoredFromTrash: true }));
        expect(storage.uploadedFileCount).toBe(1);
        const contexts = await harness.database.pool.query<{ text: string }>("SELECT text FROM capture_contexts ORDER BY id");
        expect(contexts.rows).toEqual(expect.arrayContaining([{ text: "Initial note" }, { text: "Restored webpage note" }, { text: "Restored file note" }]));
        const filenames = await harness.database.pool.query<{ submittedFilename: string }>("SELECT submitted_filename AS \"submittedFilename\" FROM captures WHERE knowledge_item_id = $1 ORDER BY id", [originalFile.body.knowledgeItemId]);
        expect(filenames.rows).toEqual([{ submittedFilename: "proposal.pdf" }, { submittedFilename: "renamed.pdf" }]);
    });
});

async function captureUrl(url: string, personalNote?: string): Promise<{ status: number; body: any }> {
    const response = await fetch(`${harness!.apiBaseUrl}/captures`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url, ...(personalNote ? { personalNote } : {}) }) });
    return { status: response.status, body: await response.json() };
}

async function captureFile(filename: string, contents: string, personalNote?: string): Promise<{ status: number; body: any }> {
    const form = new FormData();
    form.set("file", new Blob([contents], { type: "application/pdf" }), filename);
    if (personalNote) form.set("personalNote", personalNote);
    const response = await fetch(`${harness!.apiBaseUrl}/captures/file`, { method: "POST", body: form });
    return { status: response.status, body: await response.json() };
}
