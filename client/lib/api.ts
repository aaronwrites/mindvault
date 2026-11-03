import type {
  CaptureResponse,
  KnowledgeItem,
  RecallKnowledgeItem,
  SynthesisRequest,
  RefreshKnowledgeItemResponse,
  SynthesisResult,
} from "@/lib/types";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export const knowledgeItemKeys = {
  all: ["knowledge-items"] as const,
  detail: (id: number | null) => ["knowledge-items", "detail", id] as const,
  trash: ["knowledge-items", "trash"] as const,
};
export const recallKeys = {
  all: ["knowledge-items", "recall"] as const,
  search: (query: string) => ["knowledge-items", "recall", query] as const,
};

export async function askVault(request: SynthesisRequest): Promise<SynthesisResult> {
  const response = await fetch(`${API_URL}/synthesis`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        "Answer generation is temporarily unavailable. Please try again.",
      ),
    );
  }
  return response.json();
}

async function getErrorMessage(response: Response, fallback: string) {
  const body = await response.json().catch(() => null);

  if (body?.retryable === true) {
    return "Original File storage is temporarily unavailable. Try again; your selected file and note are still available.";
  }
  if (body?.error === "original-file-storage-rejected") {
    return "Original File storage rejected this upload. An administrator needs to enable upload permission for the configured Cloudinary API key.";
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

export async function getTrashedKnowledgeItems(): Promise<KnowledgeItem[]> {
  const response = await fetch(`${API_URL}/knowledge-items/trash`);
  if (!response.ok) throw new Error(await getErrorMessage(response, "Could not load Trash."));
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

export async function trashKnowledgeItem(knowledgeItemId: number): Promise<void> {
  const response = await fetch(`${API_URL}/knowledge-items/${knowledgeItemId}/trash`, { method: "POST" });
  if (!response.ok) throw new Error(await getErrorMessage(response, "Could not move this Knowledge Item to Trash."));
}

export async function restoreKnowledgeItem(knowledgeItemId: number): Promise<{ knowledgeItem: KnowledgeItem }> {
  const response = await fetch(`${API_URL}/knowledge-items/${knowledgeItemId}/restore`, { method: "POST" });
  if (!response.ok) throw new Error(await getErrorMessage(response, "Could not restore this Knowledge Item."));
  return response.json();
}

export async function permanentlyDeleteKnowledgeItem(knowledgeItemId: number): Promise<{ deletionPending: true } | undefined> {
  const response = await fetch(`${API_URL}/knowledge-items/${knowledgeItemId}/permanent-delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmation: "permanently-delete" }),
  });
  if (!response.ok) throw new Error(await getErrorMessage(response, "Could not permanently delete this Knowledge Item."));
  return response.status === 204 ? undefined : response.json();
}


export async function getKnowledgeItem(id: number): Promise<KnowledgeItem> {
  const response = await fetch(`${API_URL}/knowledge-items/${id}`);
  if (!response.ok) throw new Error("Could not load saved details. Please try again.");
  return response.json();
}

export async function updateKnowledgeItemTitle(id: number, customTitle: string | null): Promise<KnowledgeItem> {
  const response = await fetch(`${API_URL}/knowledge-items/${id}/title`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customTitle }),
  });
  if (!response.ok) throw new Error("Couldn’t save the title. Please try again.");
  return response.json();
}

export async function updateKnowledgeItemTags(id: number, changes: { add: string[]; remove: string[] }): Promise<KnowledgeItem> {
  const response = await fetch(`${API_URL}/knowledge-items/${id}/tags`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changes),
  });
  if (!response.ok) throw new Error("Couldn’t save the tags. Please try again.");
  return response.json();
}

export type PersonalNoteChange = { action: "add"; text: string } | { action: "edit"; noteId: number; text: string } | { action: "remove"; noteId: number } | { action: "retry" };

export async function maintainPersonalNote(id: number, change: PersonalNoteChange): Promise<KnowledgeItem> {
  const response = await fetch(`${API_URL}/knowledge-items/${id}/notes${change.action === "add" ? "" : change.action === "retry" ? "/retry" : `/${change.noteId}`}`, {
    method: change.action === "add" || change.action === "retry" ? "POST" : change.action === "edit" ? "PATCH" : "DELETE",
    ...(change.action === "remove" || change.action === "retry" ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: change.text }) }),
  });
  if (!response.ok) throw new Error("Couldn’t save the note change. Please try again.");
  const result = await response.json();
  return change.action === "retry" ? result.knowledgeItem : result;
}
