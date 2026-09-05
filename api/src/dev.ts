import "dotenv/config";
import { createApp } from "./app";
import { db } from "./db";
import { createArticleProcessingWorker, startProcessingWorker } from "./worker";
import { cloudinaryOriginalFileStorageFromEnvironment } from "./lib/original-files/cloudinary-original-file-storage";
import { OriginalFileStorageError } from "./lib/original-files/original-file-storage";
import { createOriginalFileOperationsWorker } from "./lib/original-files/process-original-file-operations";

const port = process.env.PORT || 3000;
const worker = createArticleProcessingWorker({ database: db });

startProcessingWorker(worker);
try {
    startProcessingWorker(createOriginalFileOperationsWorker({ database: db, storage: cloudinaryOriginalFileStorageFromEnvironment(process.env) }));
} catch (error) {
    if (!(error instanceof OriginalFileStorageError) || error.kind !== "configuration") throw error;
    console.warn("Original File reconciliation is disabled until Cloudinary is configured.");
}
createApp().listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log("Processing worker started.");
});
