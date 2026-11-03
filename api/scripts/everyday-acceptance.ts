// Disposable local acceptance environment. Never connects the app to the user's Vault.
import { createApp } from "../src/app";
import { createArticleProcessingWorker } from "../src/worker";
import { DeterministicOriginalFileStorageFake } from "../src/lib/original-files/deterministic-original-file-storage-fake";
import { createIntegrationHarness } from "../test/support/integration-harness";
import { DeterministicEmbeddingProvider, DeterministicGenerationProvider, DeterministicTopicTagGenerationProvider } from "../test/support/deterministic-runtime";

const port = 4000;
const origin = `http://localhost:${port}`;
const storage = new class extends DeterministicOriginalFileStorageFake {
    override async createSignedAccess(request: Parameters<DeterministicOriginalFileStorageFake["createSignedAccess"]>[0]) {
        const access = await super.createSignedAccess(request);
        return { ...access, url: access.url.replace("https://storage.fake", `${origin}/__storage`) };
    }
}();
const embeddings = new DeterministicEmbeddingProvider();
const harness = await createIntegrationHarness(
    database => createApp({ database: database.db, originalFileStorage: storage, embeddingProvider: embeddings,
        synthesisProvider: {
            async resolveQuestion({ question }) { return question; },
            async generateSynthesis({ evidence }) {
                return { answer: evidence.map(item => item.text).join("\n\n"),
                    citationIds: evidence.map(item => item.citationId), insufficientEvidence: evidence.length === 0 };
            },
        },
    }),
    (database, sourceServer) => createArticleProcessingWorker({ database: database.db, originalFileStorage: () => storage,
        embeddingProvider: embeddings, sourceFetchOptions: sourceServer.safeFetchDependencies(),
        summaryProvider: new DeterministicGenerationProvider("Saved text about durable knowledge and database recovery."),
        topicTagProvider: new DeterministicTopicTagGenerationProvider(), maxAttempts: 1 }),
);
// One-shot failures are consumed by the next request for the named public route.
const failures = new Set<string>();
let server: ReturnType<typeof Bun.serve> | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let draining = false;
try {
    server = Bun.serve({ hostname: "127.0.0.1", port, async fetch(request) {
        const url = new URL(request.url);
        const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" };
        if (request.method === "OPTIONS") return new Response(null, { headers });
        if (url.pathname === "/__acceptance/fail-next" && request.method === "POST") {
            const { path } = await request.json() as { path: string };
            failures.add(path);
            return Response.json({ path }, { headers });
        }
        if (url.pathname.startsWith("/__storage/access/")) {
            const signedUrl = request.url.replace(url.origin + "/__storage", "https://storage.fake");
            if (!storage.canAccess(signedUrl)) return new Response("Expired or removed file", { status: 403, headers });
            const identity = decodeURIComponent(url.pathname.slice("/__storage/access/".length));
            const bytes = await storage.read({ locator: `fake:${identity}`, maximumBytes: 60_000_000, timeoutMs: 30_000 });
            return new Response(bytes, { headers: { ...headers, "Content-Type": "application/pdf",
                "Content-Disposition": `${url.searchParams.get("disposition")}; filename="acceptance.pdf"` } });
        }
        if (failures.delete(url.pathname)) return Response.json({ error: "Internal acceptance diagnostic" }, { status: 503, headers });
        const upstream = await fetch(new Request(harness.apiBaseUrl + url.pathname + url.search, request), { redirect: "manual" });
        const responseHeaders = new Headers(upstream.headers);
        responseHeaders.set("Access-Control-Allow-Origin", "*");
        return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
    } });
    for (const path of ["/articles/preview-facts", "/articles/missing-preview-image", "/metadata/description-only"]) await fetch(`${origin}/captures`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: harness.sourceServer.fetchUrl(path) }) });
    for (const filename of ["selectable.pdf", "partial-native.pdf", "encrypted.pdf"]) {
        const form = new FormData();
        form.set("file", new Blob([await Bun.file(new URL(`../test/fixtures/pdf/${filename}`, import.meta.url)).arrayBuffer()]), filename);
        await fetch(`${origin}/captures/file`, { method: "POST", body: form });
    }
    await harness.drainWorker();
    console.log(`Disposable acceptance API: ${origin}. Seeded webpage, complete PDF, partial PDF, locked PDF.`);
    console.log(`Additional webpage: ${harness.sourceServer.fetchUrl("/articles/semantic-retention")}`);
    timer = setInterval(async () => {
        if (draining) return;
        draining = true;
        try { await harness.drainWorker(); } catch (error) { console.error(error); } finally { draining = false; }
    }, 2_000);
    await new Promise<void>(resolve => {
        process.once("SIGINT", resolve);
        process.once("SIGTERM", resolve);
    });
} finally {
    clearInterval(timer);
    while (draining) await new Promise(resolve => setTimeout(resolve, 50));
    server?.stop(true);
    await harness.cleanup();
}
