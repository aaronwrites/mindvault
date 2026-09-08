import { eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema";
import { captureContexts, captures, knowledgeItemTopicTags, knowledgeItems, processingAttempts, sourceSnapshots, sources, topicTagAliases, topicTags, type EvidenceCoverage } from "../../db/schema";
import type { GeneratedTopicTag, TopicTagGenerationProvider } from "../ai/providers";
import { limitGenerationInput } from "../ai/limit-generation-input";
import type { ClaimedProcessingStage } from "../../worker";
import { displayTopicTagName, normalizeTopicTagAlias } from "./normalize-topic-tag";

type Database = NodePgDatabase<typeof schema>;

export function createTopicTagGenerationStageHandler(database: Database, provider: TopicTagGenerationProvider) {
    return async (stage: ClaimedProcessingStage): Promise<void> => {
        const [attempt] = await database.select({
            knowledgeItemId: processingAttempts.knowledgeItemId,
            sourceId: knowledgeItems.sourceId,
            sourceSnapshotId: processingAttempts.sourceSnapshotId,
        }).from(processingAttempts)
            .innerJoin(knowledgeItems, eq(knowledgeItems.id, processingAttempts.knowledgeItemId))
            .where(eq(processingAttempts.id, stage.processingAttemptId));
        if (!attempt?.sourceSnapshotId) throw new Error("Topic Tag generation could not find the Source Snapshot produced by this Processing Attempt");

        const [snapshot] = await database.select({ id: sourceSnapshots.id, title: sourceSnapshots.title, evidenceText: sourceSnapshots.evidenceText, evidenceCoverage: sourceSnapshots.evidenceCoverage })
            .from(sourceSnapshots)
            .where(eq(sourceSnapshots.id, attempt.sourceSnapshotId));
        if (!snapshot) throw new Error("Topic Tag generation could not find Source Snapshot content");

        const contexts = await database.select({ kind: captureContexts.kind, text: captureContexts.text })
            .from(captureContexts)
            .innerJoin(captures, eq(captures.id, captureContexts.captureId))
            .where(eq(captures.knowledgeItemId, attempt.knowledgeItemId))
            .orderBy(captureContexts.id);
        const generatedTags = await provider.generateTopicTags(topicTagGenerationPrompt(snapshot, contexts));
        const tags = normalizeGeneratedTags(generatedTags);
        if (tags.length === 0) throw new Error("Topic Tag generation returned no usable tags");

        await database.transaction(async transaction => {
            const [source] = await transaction.select({ currentSnapshotId: sources.currentSnapshotId })
                .from(sources)
                .where(eq(sources.id, attempt.sourceId));
            if (source?.currentSnapshotId !== snapshot.id) return;

            const tagIds: number[] = [];
            for (const tag of tags) tagIds.push(await findOrCreateTopicTag(transaction, tag));
            await transaction.delete(knowledgeItemTopicTags).where(eq(knowledgeItemTopicTags.knowledgeItemId, attempt.knowledgeItemId));
            await transaction.insert(knowledgeItemTopicTags).values(tagIds.map(topicTagId => ({
                knowledgeItemId: attempt.knowledgeItemId,
                topicTagId,
                sourceSnapshotId: snapshot.id,
            }))).onConflictDoNothing();
        });
    };
}

type Snapshot = { title: string; evidenceText: string; evidenceCoverage: EvidenceCoverage };
type CaptureContext = { kind: string; text: string };
type NormalizedTopicTag = { canonicalName: string; normalizedName: string; aliases: Array<{ alias: string; normalizedAlias: string }> };

export function topicTagGenerationPrompt(snapshot: Snapshot, contexts: CaptureContext[]): string {
    const context = contexts.map(item => `${item.kind === "personal-note" ? "Personal note" : "Selected source text"}: ${item.text}`).join("\n");
    const coverageInstruction = snapshot.evidenceCoverage === "metadata-only"
        ? "The Source Snapshot is metadata only, not the page's primary content. Generate tags only from that limited evidence."
        : "The Source Snapshot contains primary content.";
    return limitGenerationInput(`Generate 3-6 reusable Topic Tags from this Source Snapshot and Capture Context. Return JSON only: an array of objects with a canonical display name and known aliases. Use aliases only for genuinely equivalent abbreviations or alternate names; never merge related but distinct concepts.\n\n${coverageInstruction}\nEvidence coverage: ${snapshot.evidenceCoverage}\nSource title: ${snapshot.title}\nSource content:\n${snapshot.evidenceText}\n\nCapture Context:\n${context || "None"}`);
}

function normalizeGeneratedTags(tags: GeneratedTopicTag[]): NormalizedTopicTag[] {
    const normalized = new Map<string, NormalizedTopicTag>();
    for (const tag of tags) {
        const canonicalName = displayTopicTagName(tag.name);
        const normalizedName = normalizeTopicTagAlias(canonicalName);
        if (!normalizedName) continue;
        const current = normalized.get(normalizedName) ?? { canonicalName, normalizedName, aliases: [] };
        const aliases = [canonicalName, ...tag.aliases].map(displayTopicTagName).filter(Boolean);
        for (const alias of aliases) {
            const normalizedAlias = normalizeTopicTagAlias(alias);
            if (normalizedAlias && !current.aliases.some(existing => existing.normalizedAlias === normalizedAlias)) {
                current.aliases.push({ alias, normalizedAlias });
            }
        }
        normalized.set(normalizedName, current);
    }
    return [...normalized.values()];
}

async function findOrCreateTopicTag(database: Database, tag: NormalizedTopicTag): Promise<number> {
    const aliasRows = await database.select({ topicTagId: topicTagAliases.topicTagId })
        .from(topicTagAliases)
        .where(inArray(topicTagAliases.normalizedAlias, tag.aliases.map(alias => alias.normalizedAlias)));
    const existingId = aliasRows[0]?.topicTagId;
    if (existingId) {
        await database.insert(topicTagAliases).values(tag.aliases.map(alias => ({ topicTagId: existingId, ...alias }))).onConflictDoNothing();
        return existingId;
    }

    await database.insert(topicTags).values({ canonicalName: tag.canonicalName, normalizedName: tag.normalizedName }).onConflictDoNothing();
    const [topicTag] = await database.select({ id: topicTags.id })
        .from(topicTags)
        .where(eq(topicTags.normalizedName, tag.normalizedName));
    if (!topicTag) throw new Error("Topic Tag could not be created");

    await database.insert(topicTagAliases).values(tag.aliases.map(alias => ({ topicTagId: topicTag.id, ...alias }))).onConflictDoNothing();
    return topicTag.id;
}
