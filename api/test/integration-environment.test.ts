import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { DeterministicEmbeddingProvider, DeterministicGenerationProvider, ManualClock, drainEligibleWork } from "./support/deterministic-runtime";
import { startSourceFixtureServer, type SourceFixtureServer } from "./support/source-fixture-server";
import { createIntegrationHarness, type IntegrationHarness } from "./support/integration-harness";

let sourceServer: SourceFixtureServer | undefined;
let harness: IntegrationHarness | undefined;

afterEach(async () => {
    await sourceServer?.close();
    sourceServer = undefined;
    await harness?.cleanup();
    harness = undefined;
});

describe("durable article integration environment", () => {
    test.skipIf(!process.env.TEST_DATABASE_URL)("starts the public API and drains its worker controls against a migrated isolated database", async () => {
        let remainingWork = 1;
        harness = await createIntegrationHarness(database => createApp({ database: database.db }), { runEligibleWork: async () => remainingWork > 0 ? remainingWork-- : 0 });
        const health = await fetch(`${harness.apiBaseUrl}/health`);

        expect(await health.json()).toEqual({ status: "ok" });
        await harness.drainWorker();
        expect(remainingWork).toBe(0);
    });

    test("serves deterministic Source scenarios without external network access", async () => {
        sourceServer = await startSourceFixtureServer();
        const initial = await fetch(`${sourceServer.baseUrl}/articles/changed`);
        sourceServer.setChangedArticleVersion(2);
        const changed = await fetch(`${sourceServer.baseUrl}/articles/changed`);
        const repeated = await fetch(`${sourceServer.baseUrl}/articles/repeated`);
        const canonical = await fetch(`${sourceServer.baseUrl}/canonical`);
        const redirect = await fetch(`${sourceServer.baseUrl}/redirect/permanent`, { redirect: "manual" });
        const unsupported = await fetch(`${sourceServer.baseUrl}/unsupported.pdf`);
        const oversized = await fetch(`${sourceServer.baseUrl}/oversized`);
        const inadequate = await fetch(`${sourceServer.baseUrl}/inadequate`);
        const authentication = await fetch(`${sourceServer.baseUrl}/authentication`);
        const failure = await fetch(`${sourceServer.baseUrl}/failure`);

        expect(await initial.text()).toContain("original content");
        expect(await changed.text()).toContain("meaningfully changed content");
        expect(await repeated.text()).toContain("durable capture");
        expect(await canonical.text()).toContain(`href=\"${sourceServer.baseUrl}/articles/first\"`);
        expect(redirect.status).toBe(308);
        expect(redirect.headers.get("location")).toBe("/articles/first");
        expect(unsupported.headers.get("content-type")).toContain("application/pdf");
        expect(oversized.headers.get("content-length")).toBe("2097152");
        expect(await inadequate.text()).toContain("Too short");
        expect(await authentication.text()).toContain("Sign in required");
        expect(failure.status).toBe(503);
    });

    test("provides deterministic AI, time, and worker-draining controls", async () => {
        const generator = new DeterministicGenerationProvider("known summary");
        const embeddings = new DeterministicEmbeddingProvider();
        const clock = new ManualClock(new Date("2026-01-01T00:00:00.000Z"));
        let remainingWork = 2;

        expect(await generator.generate("ignored")).toBe("known summary");
        expect(await embeddings.embed("same input")).toEqual(await embeddings.embed("same input"));
        clock.advance(5_000);
        expect(clock.now().toISOString()).toBe("2026-01-01T00:00:05.000Z");
        await drainEligibleWork({ runEligibleWork: async () => remainingWork > 0 ? remainingWork-- : 0 });
        expect(remainingWork).toBe(0);
    });
});
