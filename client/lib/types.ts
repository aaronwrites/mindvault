export type KnowledgeItemAvailability =
  "processing" | "ready" | "unsupported" | "needs-attention";

// Legacy presentation types remain until ticket 21 removes the synchronous Resource pipeline.
export type SourceType = "article" | "repo" | "video" | "pdf" | "note";
export type Resource = {
  id: number;
  title: string;
  url: string | null;
  sourceType: SourceType;
  summary: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string | null;
  tags: string[];
  distance?: number;
};

export type KnowledgeItem = {
  id: number;
  createdAt: string;
  source: {
    id: number;
    submittedUrl: string;
    normalizedUrl: string;
    kind: string;
  };
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
  } | null;
};

export type CaptureResponse = {
  captureId: number;
  sourceId: number;
  knowledgeItemId: number;
  processingAttemptId: number;
  availability: KnowledgeItemAvailability;
  organizationCondition: "processing" | "complete" | "incomplete";
  knowledgeItem: KnowledgeItem;
};
