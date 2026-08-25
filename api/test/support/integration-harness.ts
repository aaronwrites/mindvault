import type { Express } from "express";
import type { Server } from "node:http";
import { createIntegrationDatabase, type IntegrationDatabase } from "./integration-database";
import { drainEligibleWork, type EligibleWorker } from "./deterministic-runtime";
import { startSourceFixtureServer, type SourceFixtureServer } from "./source-fixture-server";

export type IntegrationHarness = {
    database: IntegrationDatabase;
    sourceServer: SourceFixtureServer;
    apiBaseUrl: string;
    drainWorker(): Promise<void>;
    cleanup(): Promise<void>;
};

export async function createIntegrationHarness(
    createApp: (database: IntegrationDatabase) => Express,
    worker: EligibleWorker | ((database: IntegrationDatabase, sourceServer: SourceFixtureServer) => EligibleWorker),
): Promise<IntegrationHarness> {
    const database = await createIntegrationDatabase();
    const sourceServer = await startSourceFixtureServer();
    const resolvedWorker = typeof worker === "function" ? worker(database, sourceServer) : worker;
    const app = createApp(database);
    const server: Server = await new Promise((resolve, reject) => {
        const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
        listener.once("error", reject);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("API test server did not bind to a TCP port");

    return {
        database,
        sourceServer,
        apiBaseUrl: `http://127.0.0.1:${address.port}`,
        drainWorker: () => drainEligibleWork(resolvedWorker),
        async cleanup() {
            await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
            await sourceServer.close();
            await database.cleanup();
        },
    };
}
