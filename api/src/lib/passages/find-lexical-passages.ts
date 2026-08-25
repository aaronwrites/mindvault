import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema";
import type { CaptureContextKind } from "../../db/schema";

type Database = NodePgDatabase<typeof schema>;

export type LexicalPassageMatch = {
    id: number;
    origin: "source-snapshot" | CaptureContextKind;
    text: string;
    rank: number;
};

export async function findLexicalPassages(database: Database, query: string): Promise<LexicalPassageMatch[]> {
    if (!query.trim()) return [];

    const result = await database.execute(sql<LexicalPassageMatch>`
        SELECT id, origin, text,
            ts_rank_cd(lexical_search, plainto_tsquery('simple', ${query})) AS rank
        FROM passages
        WHERE lexical_search @@ plainto_tsquery('simple', ${query})
        ORDER BY rank DESC, id
    `);
    return result.rows as LexicalPassageMatch[];
}
