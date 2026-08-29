export type KnowledgeItemAvailability =
  "processing" | "ready" | "unsupported" | "needs-attention";

export type KnowledgeItem = {
  id: number;
  createdAt: string;
  source: {
    id: number;
    submittedUrl: string;
    normalizedUrl: string;
    kind: string;
  };
  sourcePreview: {
    title: string;
    description: string | null;
    websiteName: string | null;
    author: string | null;
    publishedAt: string | null;
    contentType: string | null;
    previewImageUrl: string | null;
    previewImageAlt: string | null;
    faviconUrl: string | null;
  } | null;
  captureContexts: Array<{ kind: string; summary: string }>;
  availability: KnowledgeItemAvailability;
  organizationCondition: "processing" | "complete" | "incomplete";
  recognitionSummary: string | null;
  topicTags: string[];
  latestAttempt: {
    id: number;
    kind: string;
    status: string;
    createdAt: string;
    failureReason?: string;
  } | null;
};

export type RecallKnowledgeItem = {
  id: number;
  title: string | null;
  source: KnowledgeItem["source"];
  sourcePreview: KnowledgeItem["sourcePreview"];
  recognitionSummary: string | null;
  topicTags: string[];
  excerpts: Array<{
    text: string;
    origin: "source-snapshot" | "selected-source-text" | "personal-note";
    sourceSnapshot: {
      id: number;
      originalUrl: string;
      finalUrl: string;
      canonicalUrl: string | null;
      extractedAt: string;
    } | null;
    ranking: {
      score: number;
      semanticRank?: number;
      lexicalRank?: number;
    };
  }>;
  ranking: { score: number; matchedPassageCount: number };
};

export type CaptureResponse = {
  captureId: number;
  sourceId: number;
  knowledgeItemId: number;
  processingAttemptId: number | null;
  availability: KnowledgeItemAvailability;
  organizationCondition: "processing" | "complete" | "incomplete";
  knowledgeItem: KnowledgeItem;
};

export type RefreshKnowledgeItemResponse = {
  processingAttemptId: number;
  knowledgeItem: KnowledgeItem;
};
