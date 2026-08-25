import { and, eq, ne, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema";
import { extractedSources, knowledgeItems, processingAttempts, processingStages, sources } from "../../db/schema";
import { classifySourceSupport } from "./classify-source-support";
import { fetchPublicSource, type SafeFetchOptions } from "./fetch-public-source";
import { reconcileExtractedSourceIdentity } from "./reconcile-source-identity";
import type { ClaimedProcessingStage } from "../../worker";

type Database = NodePgDatabase<typeof schema>;

export function createExtractionStageHandler(database: Database, fetchOptions: SafeFetchOptions = {}) {
    return async (stage: ClaimedProcessingStage): Promise<void | { completed: true }> => {
        const source = await sourceForAttempt(database, stage.processingAttemptId);
        if (!source) throw new Error("Extraction could not find its Source");

        const fetched = await fetchPublicSource(source.submittedUrl, fetchOptions);
        const support = classifySourceSupport(fetched);
        if (support?.kind === "unsupported") {
            const completed = await withCurrentLease(database, stage, async transaction => {
                await transaction.update(sources).set({ sourceKind: support.sourceKind }).where(eq(sources.id, source.id));
                await transaction.update(processingAttempts).set({ status: "unsupported", failureReason: null })
                    .where(eq(processingAttempts.id, stage.processingAttemptId));
                await transaction.update(processingStages).set({ status: "skipped" })
                    .where(and(
                        eq(processingStages.processingAttemptId, stage.processingAttemptId),
                        ne(processingStages.id, stage.id),
                    ));
                await completeCurrentStage(transaction, stage);
                return true;
            });
            return completed ? { completed: true } : undefined;
        }
        if (!fetched.ok) throw new Error(failureReasonForFetch(fetched.failure));
        if (!support || support.kind !== "supported") throw new Error("MindVault could not determine how to process this Source");

        const extracted = extractMeaningfulPrimaryText(new TextDecoder().decode(fetched.response.body), fetched.response.finalUrl);
        const completed = await withCurrentLease(database, stage, async transaction => {
            const reconciledSource = await reconcileExtractedSourceIdentity(transaction, source, {
                canonicalUrl: extracted.canonicalUrl,
                permanentRedirects: fetched.permanentRedirects,
            });
            await transaction.update(sources).set({ sourceKind: support.sourceKind }).where(eq(sources.id, reconciledSource.id));
            await transaction.insert(extractedSources).values({
                processingAttemptId: stage.processingAttemptId,
                sourceId: reconciledSource.id,
                title: extracted.title,
                primaryText: extracted.primaryText,
                originalUrl: fetched.response.originalUrl,
                finalUrl: fetched.response.finalUrl,
                canonicalUrl: extracted.canonicalUrl,
                permanentRedirects: fetched.permanentRedirects,
            }).onConflictDoUpdate({
                target: extractedSources.processingAttemptId,
                set: {
                    title: extracted.title,
                    primaryText: extracted.primaryText,
                    originalUrl: fetched.response.originalUrl,
                    finalUrl: fetched.response.finalUrl,
                    canonicalUrl: extracted.canonicalUrl,
                    permanentRedirects: fetched.permanentRedirects,
                    extractedAt: new Date(),
                },
            });
            await completeCurrentStage(transaction, stage);
            return true;
        });
        return completed ? { completed: true } : undefined;
    };
}

async function sourceForAttempt(database: Database, processingAttemptId: number) {
    const [row] = await database.select({ id: sources.id, submittedUrl: sources.submittedUrl })
        .from(processingAttempts)
        .innerJoin(knowledgeItems, eq(knowledgeItems.id, processingAttempts.knowledgeItemId))
        .innerJoin(sources, eq(sources.id, knowledgeItems.sourceId))
        .where(eq(processingAttempts.id, processingAttemptId));
    return row;
}

export function extractMeaningfulPrimaryText(html: string, finalUrl: string): { title: string; primaryText: string; canonicalUrl: string | null } {
    const title = firstText(html, /<meta\s+[^>]*(?:property|name)=["'](?:og:title|twitter:title)["'][^>]*content=["']([^"']+)["'][^>]*>/i)
        ?? firstText(html, /<title[^>]*>([\s\S]*?)<\/title>/i)
        ?? firstText(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const primaryHtml = firstMatch(html, /<article\b[^>]*>([\s\S]*?)<\/article>/i)
        ?? firstMatch(html, /<main\b[^>]*>([\s\S]*?)<\/main>/i)
        ?? firstMatch(html, /<body\b[^>]*>([\s\S]*?)<\/body>/i)
        ?? html;
    const primaryText = withoutRepeatedTitle(cleanText(stripBoilerplate(primaryHtml)), title);
    const qualityFailure = qualityFailureFor(title, primaryText);
    if (qualityFailure) throw new Error(qualityFailure);

    const canonical = firstMatch(html, /<link\s+[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i)
        ?? firstMatch(html, /<link\s+[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["'][^>]*>/i);
    return { title: title!, primaryText, canonicalUrl: canonicalUrlFor(canonical, finalUrl) };
}

function canonicalUrlFor(canonical: string | null, finalUrl: string): string | null {
    if (!canonical) return null;
    try {
        const url = new URL(canonical, finalUrl);
        return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
    } catch {
        return null;
    }
}

function stripBoilerplate(value: string): string {
    return value
        .replace(/<(script|style|noscript|nav|header|footer|aside|form)[^>]*>[\s\S]*?<\/\1>/gi, " ")
        .replace(/<([a-z][\w:-]*)\b[^>]*(?:class|id|role)=["'][^"']*\b(?:navigation|menu|cookie|consent|banner|sidebar|related|footer)\b[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi, " ");
}

function cleanText(value: string): string {
    return decodeEntities(value.replace(/<[^>]*>/g, " "))
        .replace(/\s+/g, " ")
        .trim();
}

function withoutRepeatedTitle(primaryText: string, title: string | null): string {
    return title && primaryText.startsWith(title) ? primaryText.slice(title.length).trim() : primaryText;
}

function decodeEntities(value: string): string {
    return value.replace(/&(?:nbsp|amp|lt|gt|quot|#39);/g, entity => ({ "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'" })[entity] ?? entity);
}

function firstText(html: string, expression: RegExp): string | null {
    const match = firstMatch(html, expression);
    return match ? cleanText(match) : null;
}

function firstMatch(html: string, expression: RegExp): string | null {
    return expression.exec(html)?.[1] ?? null;
}

function qualityFailureFor(title: string | null, primaryText: string): string | undefined {
    const content = `${title ?? ""} ${primaryText}`.toLowerCase();
    if (/sign in|required|log in|password|authentication/.test(content)) return "This Source requires authentication";
    if (/captcha|verify you are human|bot challenge|cloudflare/.test(content)) return "This Source is protected by a bot challenge";
    if (/paywall|subscribe to continue|subscription required/.test(content)) return "This Source is behind a paywall";
    if (/page not found|not found|something went wrong|internal server error/.test(content)) return "This Source appears to be an error page";
    if (primaryText.length < 120) return "This Source has inadequate meaningful text";
    if (!title) return "This Source has no recognizable title";
    return undefined;
}

function failureReasonForFetch(failure: { kind: string; status?: number }): string {
    if (failure.kind === "http-status") return `The Source returned HTTP ${failure.status}`;
    if (failure.kind === "timeout") return "Fetching this Source timed out";
    if (failure.kind === "unsafe-network-target") return "This Source resolves to an unsafe network target";
    return "MindVault could not fetch this Source safely";
}

async function withCurrentLease<T>(
    database: Database,
    stage: ClaimedProcessingStage,
    operation: (transaction: Parameters<Parameters<Database["transaction"]>[0]>[0]) => Promise<T>,
): Promise<T | undefined> {
    return database.transaction(async transaction => {
        const lease = await transaction.execute(sql`
            SELECT id
            FROM processing_stages
            WHERE id = ${stage.id}
              AND status = 'running'
              AND lease_token = ${stage.leaseToken}
            FOR UPDATE
        `);
        if (lease.rows.length === 0) return undefined;
        return operation(transaction);
    });
}

async function completeCurrentStage(
    transaction: Parameters<Parameters<Database["transaction"]>[0]>[0],
    stage: ClaimedProcessingStage,
): Promise<void> {
    await transaction.update(processingStages).set({ status: "completed", leaseToken: null, leaseExpiresAt: null })
        .where(and(
            eq(processingStages.id, stage.id),
            eq(processingStages.status, "running"),
            eq(processingStages.leaseToken, stage.leaseToken),
        ));
}
