import "dotenv/config";
import { createApp } from "./app";
import { createOllamaProviders } from "./lib/ai/ollama";

const port = process.env.PORT || 3000;
const providers = createOllamaProviders();
await providers.preflight();
createApp({ embeddingProvider: providers.embeddingProvider, synthesisProvider: providers.synthesisProvider })
    .listen(port, () => console.log(`Server running on port ${port}`));
