import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema";
import { captures, extractedSources, knowledgeItems, processingAttempts, sourceSnapshots, sources, webpageSources } from "../../db/schema";
import { normalizeCaptureUrl } from "../capture/normalize-capture-url";

type Database = NodePgDatabase<typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type SourceIdentityEvidence = {
    canonicalUrl: string | null;
    permanentRedirects: Array<{ from: string; to: string }>;
};

export async function reconcileExtractedSourceIdentity(
    transaction: Transaction,
    source: Pick<typeof sources.$inferSelect, "id">,
    evidence: SourceIdentityEvidence,
): Promise<typeof sources.$inferSelect> {
    const identityUrl = canonicalOrPermanentIdentity(evidence);
    if (!identityUrl) {
        const [currentSource] = await transaction.select().from(sources).where(eq(sources.id, source.id));
        if (!currentSource) throw new Error("Source identity reconciliation could not find its Source");
        return currentSource;
    }
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${identityUrl}, 0))`);
    const identifiedSource = (await transaction.select({ source: sources })
        .from(webpageSources)
        .innerJoin(sources, eq(sources.id, webpageSources.sourceId))
        .where(eq(webpageSources.normalizedUrl, identityUrl)))[0]?.source;

    if (!identifiedSource) {
        await transaction.update(webpageSources).set({ normalizedUrl: identityUrl }).where(eq(webpageSources.sourceId, source.id));
        const [updatedSource] = await transaction.select().from(sources).where(eq(sources.id, source.id));
        if (!updatedSource) throw new Error("Source identity reconciliation could not find its Source");
        return updatedSource;
    }
    if (identifiedSource.id === source.id) return identifiedSource;

    const [identifiedItem] = await transaction.select().from(knowledgeItems)
        .where(eq(knowledgeItems.sourceId, identifiedSource.id));
    const [sourceItem] = await transaction.select().from(knowledgeItems)
        .where(eq(knowledgeItems.sourceId, source.id));
    if (!identifiedItem || !sourceItem) throw new Error("Source identity reconciliation could not find its Knowledge Item");

    await transaction.update(captures).set({ sourceId: identifiedSource.id, knowledgeItemId: identifiedItem.id })
        .where(eq(captures.sourceId, source.id));
    await transaction.update(processingAttempts).set({ knowledgeItemId: identifiedItem.id })
        .where(eq(processingAttempts.knowledgeItemId, sourceItem.id));
    await transaction.update(extractedSources).set({ sourceId: identifiedSource.id })
        .where(eq(extractedSources.sourceId, source.id));
    await transaction.execute(sql`
        DELETE FROM source_snapshots AS duplicate
        USING source_snapshots AS existing
        WHERE duplicate.source_id = ${source.id}
          AND existing.source_id = ${identifiedSource.id}
          AND duplicate.content_hash = existing.content_hash
    `);
    await transaction.update(sourceSnapshots).set({ sourceId: identifiedSource.id })
        .where(eq(sourceSnapshots.sourceId, source.id));
    await transaction.delete(knowledgeItems).where(eq(knowledgeItems.id, sourceItem.id));
    await transaction.delete(sources).where(eq(sources.id, source.id));
    return identifiedSource;
}

function canonicalOrPermanentIdentity(evidence: SourceIdentityEvidence): string | undefined {
    if (evidence.canonicalUrl && isHttpUrl(evidence.canonicalUrl)) return normalizeCaptureUrl(evidence.canonicalUrl);
    const finalPermanentRedirect = evidence.permanentRedirects.at(-1)?.to;
    return finalPermanentRedirect && isHttpUrl(finalPermanentRedirect) ? normalizeCaptureUrl(finalPermanentRedirect) : undefined;
}

function isHttpUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
    } catch {
        return false;
    }
}
