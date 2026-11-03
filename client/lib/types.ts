export type KnowledgeItemAvailability =
  "processing" | "ready" | "unsupported" | "needs-attention";
export type EvidenceCoverage = "primary-content" | "metadata-only";

export type KnowledgeItem = {
  title?: string;
  customTitle?: string | null;
  id: number;
  createdAt: string;
  lifecycleState: "active" | "trashed" | "pending-permanent-deletion";
  trashedAt: string | null;
  deletion?: { status: "pending" | "running" | "failed"; failureReason: string | null } | null;
  source: {
    id: number;
    kind: string;
    submittedUrl: string;
    normalizedUrl: string;
    filename?: string | null;
    mediaType?: string;
    byteSize?: number;
    originalFileActions?: { open?: string; download: string };
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
    previewImagePresentation?: "cover" | "icon" | null;
    faviconUrl: string | null;
  } | null;
  evidenceCoverage: EvidenceCoverage | null;
  extractionCoverage?: { pageCount: number; pages: Array<{ pageNumber: number; outcome: "extracted" | "blank" | "needs-ocr" | "failed" | "unreadable" | "unprocessed"; reason: string | null }> } | null;
  noteIndexing?: "processing" | "complete" | "incomplete";
  captureContexts: Array<{ id: number; kind: string; text: string; summary: string }>;
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
    warnings?: string[];
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
    pageNumber?: number | null;
    pageLabel?: string | null;
    openOriginalFile?: string;
    origin: "source-snapshot" | "selected-source-text" | "personal-note";
    sourceSnapshot: {
      id: number;
      originalUrl: string | null;
      finalUrl: string | null;
      canonicalUrl: string | null;
      extractedAt: string;
      evidenceCoverage: EvidenceCoverage;
      extractionCoverage?: KnowledgeItem["extractionCoverage"];
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
  reused?: boolean;
  restoredFromTrash?: boolean;
};

export type RefreshKnowledgeItemResponse = {
  processingAttemptId: number;
  knowledgeItem: KnowledgeItem;
};

export type SynthesisResult = {
  answer: string;
  citations: Array<{
    origin: "source-snapshot" | "selected-source-text" | "personal-note";
    knowledgeItemId: number;
    sourceSnapshotId: number | null;
    title: string;
    originalUrl: string | null;
    pageNumber?: number | null;
    pageLabel?: string | null;
    openOriginalFile?: string;
    extractionCoverage?: KnowledgeItem["extractionCoverage"];
    evidenceCoverage: EvidenceCoverage | null;
    excerpt: string;
  }>;
  insufficientEvidence: boolean;
};

export type SynthesisConversationTurn = {
  question: string;
  answer: string;
};

export type SynthesisRequest = {
  question: string;
  conversation: SynthesisConversationTurn[];
};
