import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, expect, test } from "bun:test";

const databases: Array<{ name: string; adminUrl: string; pool: Pool }> = [];

afterEach(async () => {
    await Promise.all(databases.splice(0).map(async ({ name, adminUrl, pool }) => {
        await pool.end();
        const admin = new Pool({ connectionString: adminUrl });
        try {
            await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [name]);
            await admin.query(`DROP DATABASE IF EXISTS ${name}`);
        } finally {
            await admin.end();
        }
    }));
});

test("Source provenance migrations apply from an empty database", async () => {
    const { pool } = await createDatabase();
    await applyMigrations(pool, 20);
    expect((await pool.query("SELECT to_regclass('public.webpage_sources') AS webpage_sources, to_regclass('public.original_files') AS original_files, to_regclass('public.original_file_operations') AS original_file_operations")).rows).toEqual([{
        webpage_sources: "webpage_sources",
        original_files: "original_files",
        original_file_operations: "original_file_operations",
    }]);
});

test("Source provenance upgrade preserves existing webpage identity and dependent records", async () => {
    const { pool } = await createDatabase();

    await applyMigrations(pool, 17);
    await pool.query("INSERT INTO sources (id, submitted_url, normalized_url, source_kind) VALUES (41, 'https://example.com/submitted', 'https://example.com/canonical', 'web')");
    await pool.query("INSERT INTO knowledge_items (id, source_id) VALUES (42, 41)");
    await pool.query("INSERT INTO captures (id, source_id, knowledge_item_id) VALUES (43, 41, 42)");
    await pool.query("INSERT INTO processing_attempts (id, knowledge_item_id, kind) VALUES (44, 42, 'initial-capture')");
    await pool.query("INSERT INTO source_snapshots (id, source_id, title, primary_text, original_url, final_url, permanent_redirects, extracted_at, content_hash) VALUES (45, 41, 'Title', 'Primary text', 'https://example.com/submitted', 'https://example.com/canonical', '[]', now(), 'snapshot-hash')");
    await pool.query("INSERT INTO source_previews (source_snapshot_id, title) VALUES (45, 'Title')");
    await pool.query("INSERT INTO source_preview_media (source_snapshot_id, source_url, content_type, bytes) VALUES (45, 'https://example.com/image.png', 'image/png', $1)", [Buffer.from([1, 2, 3])]);
    await pool.query("INSERT INTO recognition_summaries (knowledge_item_id, source_snapshot_id, text) VALUES (42, 45, 'Summary')");
    await pool.query("INSERT INTO topic_tags (id, canonical_name, normalized_name) VALUES (47, 'Retrieval', 'retrieval')");
    await pool.query("INSERT INTO topic_tag_aliases (id, topic_tag_id, alias, normalized_alias) VALUES (48, 47, 'Recall', 'recall')");
    await pool.query("INSERT INTO knowledge_item_topic_tags (knowledge_item_id, topic_tag_id, source_snapshot_id) VALUES (42, 47, 45)");
    await pool.query("INSERT INTO passages (id, source_snapshot_id, origin, text, ordinal) VALUES (46, 45, 'source-snapshot', 'Primary text', 0)");
    await pool.query("INSERT INTO processing_stages (id, processing_attempt_id, kind) VALUES (49, 44, 'extraction')");

    await applyMigrations(pool, 19, 18);

    expect((await pool.query("SELECT id, provenance_kind, source_kind FROM sources")).rows).toEqual([{ id: 41, provenance_kind: "webpage", source_kind: "web" }]);
    expect((await pool.query("SELECT source_id, submitted_url, normalized_url FROM webpage_sources")).rows).toEqual([{ source_id: 41, submitted_url: "https://example.com/submitted", normalized_url: "https://example.com/canonical" }]);
    expect((await pool.query("SELECT source_id, lifecycle_state FROM knowledge_items")).rows).toEqual([{ source_id: 41, lifecycle_state: "active" }]);
    expect((await pool.query("SELECT source_id, knowledge_item_id FROM captures")).rows).toEqual([{ source_id: 41, knowledge_item_id: 42 }]);
    expect((await pool.query("SELECT source_id FROM source_snapshots")).rows).toEqual([{ source_id: 41 }]);
    expect((await pool.query("SELECT source_snapshot_id, bytes FROM source_preview_media")).rows).toEqual([{ source_snapshot_id: 45, bytes: Buffer.from([1, 2, 3]) }]);
    expect((await pool.query("SELECT knowledge_item_id, source_snapshot_id FROM recognition_summaries")).rows).toEqual([{ knowledge_item_id: 42, source_snapshot_id: 45 }]);
    expect((await pool.query("SELECT knowledge_item_id, topic_tag_id, source_snapshot_id FROM knowledge_item_topic_tags")).rows).toEqual([{ knowledge_item_id: 42, topic_tag_id: 47, source_snapshot_id: 45 }]);
    expect((await pool.query("SELECT source_snapshot_id FROM passages")).rows).toEqual([{ source_snapshot_id: 45 }]);
    expect((await pool.query("SELECT processing_attempt_id FROM processing_stages")).rows).toEqual([{ processing_attempt_id: 44 }]);
});

async function createDatabase(): Promise<{ pool: Pool }> {
    const adminUrl = databaseUrl("postgres");
    const name = `mindvault_upgrade_${randomUUID().replaceAll("-", "")}`;
    const admin = new Pool({ connectionString: adminUrl });
    await admin.query(`CREATE DATABASE ${name}`);
    await admin.end();
    const pool = new Pool({ connectionString: databaseUrl(name) });
    databases.push({ name, adminUrl, pool });
    return { pool };
}

async function applyMigrations(pool: Pool, last: number, first = 0): Promise<void> {
    const folder = fileURLToPath(new URL("../drizzle", import.meta.url));
    const files = (await readdir(folder)).filter(file => {
        const number = Number(file.slice(0, 4));
        return Number.isInteger(number) && number >= first && number <= last && file.endsWith(".sql");
    }).sort();
    for (const file of files) {
        for (const statement of (await readFile(`${folder}/${file}`, "utf8")).split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean)) {
            await pool.query(statement);
        }
    }
}

function databaseUrl(database: string): string {
    const configured = process.env.TEST_DATABASE_URL;
    if (!configured) throw new Error("TEST_DATABASE_URL must be configured for migration integration tests");
    const url = new URL(configured);
    url.pathname = `/${database}`;
    return url.toString();
}
