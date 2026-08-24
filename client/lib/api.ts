import type {
  CaptureResponse,
  KnowledgeItem,
  Resource,
  SourceType,
} from "@/lib/types";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export const resourceKeys = {
  all: ["resources"] as const,
  search: (query: string) => ["resources", "search", query] as const,
};

export const knowledgeItemKeys = { all: ["knowledge-items"] as const };

async function getErrorMessage(response: Response, fallback: string) {
  const body = await response.json().catch(() => null);

  if (typeof body?.error === "string") return body.error;
  if (typeof body?.error?.formErrors?.[0] === "string")
    return body.error.formErrors[0];

  return fallback;
}

export async function getKnowledgeItems(): Promise<KnowledgeItem[]> {
  const response = await fetch(`${API_URL}/knowledge-items`);

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(response, "Could not load your Knowledge Items."),
    );
  }

  return response.json();
}

export async function searchResources(query: string): Promise<Resource[]> {
  const response = await fetch(
    `${API_URL}/search?q=${encodeURIComponent(query)}`,
  );

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(response, "Could not search your resources."),
    );
  }

  return response.json();
}

export async function createCapture(input: {
  url: string;
  selectedText?: string;
  personalNote?: string;
}): Promise<CaptureResponse> {
  const response = await fetch(`${API_URL}/captures`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(response, "Could not capture this URL."),
    );
  }

  return response.json();
}

export async function createResource(input: {
  title: string;
  url: string;
  sourceType: SourceType;
}): Promise<Resource> {
  const response = await fetch(`${API_URL}/resources`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok)
    throw new Error(
      await getErrorMessage(response, "Could not save this resource."),
    );
  return response.json();
}
