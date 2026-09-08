import "dotenv/config";
import { createApp } from "./app";
import { db } from "./db";
import { createArticleProcessingWorker, startProcessingWorker } from "./worker";
import { cloudinaryOriginalFileStorageFromEnvironment } from "./lib/original-files/cloudinary-original-file-storage";
import { OriginalFileStorageError } from "./lib/original-files/original-file-storage";
import { createOriginalFileOperationsWorker } from "./lib/original-files/process-original-file-operations";
import { createOllamaProviders } from "./lib/ai/ollama";

const port = process.env.PORT || 3000;
const providers = createOllamaProviders();
await providers.preflight();
const worker = createArticleProcessingWorker({
    database: db,
    embeddingProvider: providers.embeddingProvider,
    summaryProvider: providers.summaryProvider,
    topicTagProvider: providers.topicTagProvider,
});

startProcessingWorker(worker);
try {
    startProcessingWorker(createOriginalFileOperationsWorker({ database: db, storage: cloudinaryOriginalFileStorageFromEnvironment(process.env) }));
} catch (error) {
    if (!(error instanceof OriginalFileStorageError) || error.kind !== "configuration") throw error;
    console.warn("Original File reconciliation is disabled until Cloudinary is configured.");
}
createApp({ embeddingProvider: providers.embeddingProvider, synthesisProvider: providers.synthesisProvider }).listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log("Processing worker started.");
});
