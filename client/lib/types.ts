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
