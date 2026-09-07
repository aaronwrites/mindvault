import type { SafeFetchResult } from "./fetch-public-source";

export type SourceSupportClassification =
    | {
        kind: "supported";
        sourceKind: "public-textual-web";
        adapter: "public-textual-web";
    }
    | {
        kind: "unsupported";
        sourceKind: "pdf" | "image" | "video" | "unknown";
        reason: "unsupported-content-type";
    }
    | {
        kind: "unsupported";
        sourceKind: "unknown";
        reason: "ambiguous-content-type";
    };

export function classifySourceSupport(result: SafeFetchResult): SourceSupportClassification | undefined {
    if (!result.ok) {
        if (result.failure.kind !== "unsupported-content-type") return undefined;
        return classifyContentType(result.failure.contentType);
    }

    return classifyContentType(result.response.contentType);
}

function classifyContentType(contentType: string | null): SourceSupportClassification {
    if (contentType === "text/html" || contentType === "application/xhtml+xml" || (contentType !== null && isPlainTextContentType(contentType))) {
        return { kind: "supported", sourceKind: "public-textual-web", adapter: "public-textual-web" };
    }

    if (contentType === "application/pdf") {
        return { kind: "unsupported", sourceKind: "pdf", reason: "unsupported-content-type" };
    }

    if (!contentType) return { kind: "unsupported", sourceKind: "unknown", reason: "ambiguous-content-type" };

    return { kind: "unsupported", sourceKind: sourceKindFor(contentType), reason: "unsupported-content-type" };
}

function isPlainTextContentType(contentType: string): boolean {
    return contentType === "text/plain"
        || contentType === "text/markdown"
        || contentType === "text/x-markdown"
        || contentType === "application/markdown";
}

function sourceKindFor(contentType: string): "image" | "video" | "unknown" {
    if (contentType.startsWith("image/")) return "image";
    if (contentType.startsWith("video/")) return "video";
    return "unknown";
}
