import "dotenv/config";
import { createApp } from "./app";
import { db } from "./db";
import { createArticleProcessingWorker, startProcessingWorker } from "./worker";

const port = process.env.PORT || 3000;
const worker = createArticleProcessingWorker({ database: db });

startProcessingWorker(worker);
createApp().listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log("Processing worker started.");
});
