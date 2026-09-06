import { and, eq, gt, isNotNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema";
import { extractedSources } from "../../db/schema";

type Database = NodePgDatabase<typeof schema>;

export const recentSuccessfulExtractionWindowMs = 24 * 60 * 60 * 1_000;

export async function hasRecentSuccessfulExtraction(
    database: Database,
    sourceId: number,
    now = new Date(),
): Promise<boolean> {
    const [extraction] = await database.select({ id: extractedSources.id })
        .from(extractedSources)
        .where(and(
            eq(extractedSources.sourceId, sourceId),
            isNotNull(extractedSources.evidenceText),
            gt(extractedSources.extractedAt, new Date(now.getTime() - recentSuccessfulExtractionWindowMs)),
        ))
        .limit(1);
    return extraction !== undefined;
}
