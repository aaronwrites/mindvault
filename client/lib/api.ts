import type {
  CaptureResponse,
  KnowledgeItem,
  RecallKnowledgeItem,
  RefreshKnowledgeItemResponse,
} from "@/lib/types";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export const knowledgeItemKeys = { all: ["knowledge-items"] as const };
export const recallKeys = {
  all: ["knowledge-items", "recall"] as const,
  search: (query: string) => ["knowledge-items", "recall", query] as const,
};

async function getErrorMessage(response: Response, fallback: string) {
  const body = await response.json().catch(() => null);

  if (body?.retryable === true) {
    return "Original File storage is temporarily unavailable. Try again; your selected file and note are still available.";
  }
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

export async function searchKnowledgeItems(
  query: string,
): Promise<RecallKnowledgeItem[]> {
  const response = await fetch(
    `${API_URL}/search?q=${encodeURIComponent(query)}`,
  );

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        "Recall is unavailable right now. Please try again.",
      ),
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

export async function createOriginalFileCapture(input: {
  file: File;
  personalNote?: string;
}): Promise<CaptureResponse> {
  const body = new FormData();
  body.set("file", input.file, input.file.name);
  if (input.personalNote) body.set("personalNote", input.personalNote);

  const response = await fetch(`${API_URL}/captures/file`, {
    method: "POST",
    body,
  });

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(response, "Could not capture this Original File."),
    );
  }

  return response.json();
}

export async function refreshKnowledgeItem(
  knowledgeItemId: number,
): Promise<RefreshKnowledgeItemResponse> {
  const response = await fetch(
    `${API_URL}/knowledge-items/${knowledgeItemId}/refresh`,
    { method: "POST" },
  );

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(response, "Could not refresh this Knowledge Item."),
    );
  }

  return response.json();
}

export async function retryKnowledgeItem(
  knowledgeItemId: number,
): Promise<RefreshKnowledgeItemResponse> {
  const response = await fetch(
    `${API_URL}/knowledge-items/${knowledgeItemId}/retry`,
    { method: "POST" },
  );

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(response, "Could not retry Knowledge Item processing."),
    );
  }

  return response.json();
}
