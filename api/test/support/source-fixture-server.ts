import { createServer, type Server } from "node:http";

export type SourceFixtureServer = {
    baseUrl: string;
    setChangedArticleVersion(version: 1 | 2): void;
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
        close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
    };
}
