import { createServer, type Server } from "node:http";
import type { SafeFetchDependencies } from "../../src/lib/sources/fetch-public-source";

export type SourceFixtureServer = {
    baseUrl: string;
    setChangedArticleVersion(version: 1 | 2): void;
    fetchUrl(path: string): string;
    safeFetchDependencies(): SafeFetchDependencies;
    close(): Promise<void>;
};

const article = (title: string, body: string, canonical?: string) => `<!doctype html>
<html><head><title>${title}</title>${canonical ? `<link rel="canonical" href="${canonical}">` : ""}</head>
<body><main><article><h1>${title}</h1><p>${body}</p></article></main></body></html>`;

export async function startSourceFixtureServer(): Promise<SourceFixtureServer> {
    let changedArticleVersion: 1 | 2 = 1;
    let baseUrl = "";

    const server: Server = createServer((request, response) => {
        const path = new URL(request.url ?? "/", baseUrl).pathname;
        const html = (status: number, body: string) => {
            response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
            response.end(body);
        };

        if (path === "/articles/first") return html(200, article("First article", "A deterministic article about durable capture."));
        if (path === "/articles/primary-text") return html(200, `<!doctype html>
<html><head><title>Primary article</title></head><body>
<nav>Products Pricing Sign in</nav><div class="cookie-banner">We use cookies. Accept cookies.</div>
<main><article><h1>Primary article</h1><div class="site-navigation">Sections and account menu</div><div id="related-content">Read these unrelated articles next</div><p>Durable Capture stores a Source before asynchronous processing begins. This fixture explains how Extraction keeps meaningful primary text while discarding repeated page chrome and navigation.</p><p>Processing Attempts make failures visible without losing the user's Capture. A cleaned representation preserves the useful material for later Source Snapshot persistence and Passage retrieval.</p></article></main>
<footer>Copyright and privacy policy</footer></body></html>`);
        if (path === "/articles/repeated") return html(200, article("First article", "A deterministic article about durable capture."));
        if (path === "/articles/changed") {
            return html(200, article("Changed article", changedArticleVersion === 1 ? "The original content." : "The meaningfully changed content."));
        }
        if (path === "/canonical") return html(200, article("Canonical article", "Canonical fixture content.", `${baseUrl}/articles/first`));
        if (path === "/redirect/permanent") {
            response.writeHead(308, { location: "/articles/first" });
            return response.end();
        }
        if (path === "/unsupported.pdf") {
            response.writeHead(200, { "content-type": "application/pdf" });
            return response.end("%PDF-1.4 deterministic fixture");
        }
        if (path === "/oversized") {
            response.writeHead(200, { "content-type": "text/html", "content-length": "2097152" });
            return response.end("x".repeat(2 * 1024 * 1024));
        }
        if (path === "/inadequate") return html(200, "<html><body><main>Too short.</main></body></html>");
        if (path === "/authentication") return html(200, "<html><body><h1>Sign in required</h1><form><input type=password></form></body></html>");
        if (path === "/bot-challenge") return html(200, "<html><body><main><h1>Verify you are human</h1><p>Complete this CAPTCHA to continue to the requested page.</p></main></body></html>");
        if (path === "/paywall") return html(200, "<html><body><main><h1>Subscriber article</h1><p>Subscribe to continue reading this paywall-protected article.</p></main></body></html>");
        if (path === "/error-page") return html(200, "<html><body><main><h1>Something went wrong</h1><p>The requested page could not be loaded.</p></main></body></html>");
        if (path === "/failure") return html(503, "<html><body>Fixture unavailable</body></html>");
        return html(404, "<html><body>Not found</body></html>");
    });

    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Source fixture server did not bind to a TCP port");
    baseUrl = `http://127.0.0.1:${address.port}`;

    return {
        baseUrl,
        setChangedArticleVersion(version) {
            changedArticleVersion = version;
        },
        fetchUrl(path) {
            return `${baseUrl}${path}`;
        },
        safeFetchDependencies() {
            return {
                resolveAddresses: async () => ["8.8.8.8"],
                transport: {
                    async fetch(target) {
                        const response = await fetch(target.url, { signal: target.signal });
                        return {
                            status: response.status,
                            headers: Object.fromEntries(response.headers.entries()),
                            body: new Uint8Array(await response.arrayBuffer()),
                        };
                    },
                },
            };
        },
        close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
    };
}
