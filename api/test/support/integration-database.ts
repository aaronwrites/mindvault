import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as schema from "../../src/db/schema";

type DatabaseSchema = typeof schema;

export type IntegrationDatabase = {
    connectionString: string;
    pool: Pool;
    db: NodePgDatabase<DatabaseSchema>;
    cleanup(): Promise<void>;
};

function requireTestDatabaseUrl(): string {
    const url = process.env.TEST_DATABASE_URL;
    if (!url) {
        throw new Error("TEST_DATABASE_URL must point to a PostgreSQL database the test runner may create databases from");
    }
    return url;
}

function databaseName(): string {
    return `mindvault_test_${randomUUID().replaceAll("-", "")}`;
}

function withDatabase(connectionString: string, database: string): string {
    const url = new URL(connectionString);
    url.pathname = `/${database}`;
    return url.toString();
}

export async function createIntegrationDatabase(): Promise<IntegrationDatabase> {
    const adminConnectionString = requireTestDatabaseUrl();
    const name = databaseName();
    const adminPool = new Pool({ connectionString: withDatabase(adminConnectionString, "postgres") });

    try {
        await adminPool.query(`CREATE DATABASE ${name}`);
    } finally {
        await adminPool.end();
    }

    const connectionString = withDatabase(adminConnectionString, name);
    const pool = new Pool({ connectionString });
    const db = drizzle(pool, { schema });
    const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

    try {
        await migrate(db, { migrationsFolder });
    } catch (error) {
        await pool.end();
        const cleanupPool = new Pool({ connectionString: withDatabase(adminConnectionString, "postgres") });
        await cleanupPool.query(`DROP DATABASE IF EXISTS ${name}`);
        await cleanupPool.end();
        throw error;
    }

    return {
        connectionString,
        pool,
        db,
        async cleanup() {
            await pool.end();
            const cleanupPool = new Pool({ connectionString: withDatabase(adminConnectionString, "postgres") });
            try {
                await cleanupPool.query(
                    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
                    [name],
                );
                await cleanupPool.query(`DROP DATABASE IF EXISTS ${name}`);
            } finally {
                await cleanupPool.end();
            }
        },
    };
}
