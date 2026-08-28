import { db } from "./index";
import { persistUrlCapture } from "../lib/capture/persist-url-capture";

async function seed() {
    const seedCaptures = [
        {
            url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Closures",
            personalNote: "Review lexical scope examples before the next JavaScript session.",
        },
        {
            url: "https://docs.docker.com/compose/",
            selectedText: "Docker Compose is a tool for defining and running multi-container applications.",
        },
    ];

    for (const input of seedCaptures) {
        const capture = await persistUrlCapture(db, input);
        console.log(`Created Capture ${capture.captureId} for Knowledge Item ${capture.knowledgeItemId}.`);
    }

    console.log("Seeded Captures are Processing. Start the worker to extract, index, and organize them.");
    process.exit(0);
}

seed().catch((err) => {
    console.error(err);
    process.exit(1);
});
