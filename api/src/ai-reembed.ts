import "dotenv/config";
import { db, pool } from "./db";
import { createOllamaProviders } from "./lib/ai/ollama";
import { reembedRetainedPassages } from "./lib/ai/reembed-passages";

const providers = createOllamaProviders();

try {
    await providers.preflight();
    const report = await reembedRetainedPassages(db, providers.embeddingProvider, (passageId, error) => {
        console.error(`Passage ${passageId} failed:`, error instanceof Error ? error.message : error);
    });
    console.log(`Re-embedding complete: processed=${report.processed} skipped=${report.skipped} failed=${report.failed} remaining=${report.remaining}`);
    if (report.remaining > 0) process.exitCode = 1;
} finally {
    await pool.end();
}
