import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { CaptureResponse, SynthesisRequest, KnowledgeItem, RecallKnowledgeItem, SynthesisResult } from "@/lib/types";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
});
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  Element: dom.window.Element,
  Node: dom.window.Node,
  requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(callback, 0),
  cancelAnimationFrame: (id: number) => clearTimeout(id),
  IS_REACT_ACT_ENVIRONMENT: true,
});

const { act, cleanup, render, screen, waitFor } =
  await import("@testing-library/react");
const { default: userEvent } = await import("@testing-library/user-event");
const { QueryClient, QueryClientProvider } =
  await import("@tanstack/react-query");

const getKnowledgeItems = mock<() => Promise<KnowledgeItem[]>>();
const getTrashedKnowledgeItems = mock<() => Promise<KnowledgeItem[]>>();
const createCapture =
  mock<
    (input: {
      url: string;
      selectedText?: string;
      personalNote?: string;
    }) => Promise<CaptureResponse>
  >();
const createOriginalFileCapture =
  mock<
    (input: { file: File; personalNote?: string }) => Promise<CaptureResponse>
  >();
const refreshKnowledgeItem = mock<(knowledgeItemId: number) => Promise<{ processingAttemptId: number; knowledgeItem: KnowledgeItem }>>();
const retryKnowledgeItem = mock<(knowledgeItemId: number) => Promise<{ processingAttemptId: number; knowledgeItem: KnowledgeItem }>>();
const trashKnowledgeItem = mock<(knowledgeItemId: number) => Promise<void>>();
const restoreKnowledgeItem = mock<(knowledgeItemId: number) => Promise<{ knowledgeItem: KnowledgeItem }>>();
type PermanentlyDeleteKnowledgeItem = (knowledgeItemId: number) => Promise<{ deletionPending: boolean } | undefined>;
const permanentlyDeleteKnowledgeItem = mock<PermanentlyDeleteKnowledgeItem>();
const searchKnowledgeItems = mock<(query: string) => Promise<RecallKnowledgeItem[]>>();
const askVault = mock<(request: SynthesisRequest) => Promise<SynthesisResult>>();
mock.module("@/lib/api", () => ({
  getKnowledgeItems,
  getTrashedKnowledgeItems,
  createCapture,
  createOriginalFileCapture,
  refreshKnowledgeItem,
  retryKnowledgeItem,
  trashKnowledgeItem,
  restoreKnowledgeItem,
  permanentlyDeleteKnowledgeItem,
  searchKnowledgeItems,
  askVault,
  API_URL: "http://localhost:4000",
  knowledgeItemKeys: { all: ["knowledge-items"], trash: ["knowledge-items", "trash"] },
  recallKeys: { all: ["knowledge-items", "recall"], search: (query: string) => ["knowledge-items", "recall", query] },
}));

const { default: Home } = await import("@/app/page");

const processingItem: KnowledgeItem = {
  id: 1,
  createdAt: "2026-08-24T10:00:00.000Z",
  lifecycleState: "active",
  trashedAt: null,
  source: {
    id: 1,
    submittedUrl: "https://example.com/article",
    normalizedUrl: "https://example.com/article",
    kind: "web",
  },
  sourcePreview: null,
  evidenceCoverage: null,
  captureContexts: [
    { kind: "personal-note", summary: "Read this after the design review." },
  ],
  availability: "processing",
  organizationCondition: "processing",
  recognitionSummary: null,
  topicTags: [],
  latestAttempt: {
    id: 1,
    kind: "initial-capture",
    status: "pending",
    createdAt: "2026-08-24T10:00:00.000Z",
  },
};

function renderHome() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Home />
    </QueryClientProvider>,
  );
}

test("discloses when a Ready Knowledge Item is searchable from metadata only", async () => {
  getKnowledgeItems.mockResolvedValue([{
    ...processingItem,
    availability: "ready",
    organizationCondition: "complete",
    evidenceCoverage: "metadata-only",
    sourcePreview: {
      title: "PostgreSQL replication overview",
      description: "A source-provided description of logical replication.",
      websiteName: null,
      author: null,
      publishedAt: null,
      contentType: null,
      previewImageUrl: null,
      previewImageAlt: null,
      faviconUrl: null,
    },
    latestAttempt: { ...processingItem.latestAttempt!, status: "completed" },
  }]);
  getTrashedKnowledgeItems.mockResolvedValue([]);
  renderHome();

  expect(await screen.findByText("Searchable from source-provided metadata only; primary page content was unavailable.")).toBeTruthy();
});

beforeEach(() => {
  getKnowledgeItems.mockReset();
  getTrashedKnowledgeItems.mockReset();
  createCapture.mockReset();
  createOriginalFileCapture.mockReset();
  refreshKnowledgeItem.mockReset();
  retryKnowledgeItem.mockReset();
  trashKnowledgeItem.mockReset();
  restoreKnowledgeItem.mockReset();
  permanentlyDeleteKnowledgeItem.mockReset();
  searchKnowledgeItems.mockReset();
  askVault.mockReset();
});
afterEach(cleanup);

describe("collection-wide Synthesis", () => {
  test("keeps current-session turns for follow-ups and preserves them when a later answer fails", async () => {
    getKnowledgeItems.mockResolvedValue([processingItem]);
    getTrashedKnowledgeItems.mockResolvedValue([]);
    const initialAnswer: SynthesisResult = {
      answer: "Logical replication keeps read models current." + " Supporting detail.".repeat(300),
      insufficientEvidence: false,
      citations: [{
        knowledgeItemId: 7,
        sourceSnapshotId: 12,
        origin: "source-snapshot",
        title: "PostgreSQL replication overview",
        originalUrl: "https://example.com/postgres",
        evidenceCoverage: "metadata-only",
        excerpt: "Source-provided title: How PostgreSQL logical replication keeps read models current",
      }],
    };
    const followUpAnswer: SynthesisResult = {
      ...initialAnswer,
      answer: "It does that by applying changes from the publisher.",
      citations: [{ ...initialAnswer.citations[0]!, origin: "personal-note", sourceSnapshotId: null, evidenceCoverage: null }],
    };
    askVault.mockResolvedValueOnce(initialAnswer).mockResolvedValueOnce(followUpAnswer);
    const user = userEvent.setup({ document: dom.window.document });
    renderHome();

    expect(await screen.findByText("Questions, matching evidence, and current-session context are processed locally by Ollama. Original Files are not sent to the models.")).toBeTruthy();
    await user.type(await screen.findByLabelText("Ask a question about your captured knowledge"), "How do read models stay current?");
    await user.click(screen.getByRole("button", { name: "Ask your vault" }));
    await waitFor(() => expect(askVault.mock.calls[0]?.[0]).toEqual({ question: "How do read models stay current?", conversation: [] }));
    expect(await screen.findByText(initialAnswer.answer)).toBeTruthy();
    expect(screen.getByText("Based on source-provided metadata only.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "View PostgreSQL replication overview" }).getAttribute("href")).toBe("#knowledge-item-7");

    const question = screen.getByLabelText("Ask a question about your captured knowledge");
    await user.type(question, "What does it apply?");
    await user.click(screen.getByRole("button", { name: "Ask your vault" }));
    await waitFor(() => expect(askVault.mock.calls[1]?.[0]).toEqual({
      question: "What does it apply?",
      conversation: [{ question: "How do read models stay current?", answer: initialAnswer.answer.slice(0, 4000) }],
    }));
    expect(await screen.findByText("It does that by applying changes from the publisher.")).toBeTruthy();
    expect(screen.getByText("Based on your Personal Note.")).toBeTruthy();

    askVault.mockRejectedValue(new Error("Answer generation is temporarily unavailable. Please try again."));
    await user.type(question, "And when does it fail?");
    await user.click(screen.getByRole("button", { name: "Ask your vault" }));
    expect(await screen.findByText("Answer generation is temporarily unavailable. Please try again.")).toBeTruthy();
    expect(screen.getByText(initialAnswer.answer)).toBeTruthy();
    expect(screen.getByText("It does that by applying changes from the publisher.")).toBeTruthy();
  });
});

describe("Knowledge Item Capture", () => {
  test("moves an active card to Trash and restores a recognizable file card", async () => {
    const trashedFile: KnowledgeItem = {
      ...processingItem,
      id: 9,
      lifecycleState: "trashed",
      trashedAt: "2026-09-01T11:00:00.000Z",
      source: {
        id: 9, kind: "pdf", submittedUrl: "", normalizedUrl: "", filename: "proposal.pdf", mediaType: "application/pdf", byteSize: 32,
        originalFileActions: { open: "/knowledge-items/9/original-file/open", download: "/knowledge-items/9/original-file/download" },
      },
      availability: "unsupported",
      organizationCondition: "complete",
      latestAttempt: null,
    };
    getKnowledgeItems.mockResolvedValue([processingItem]);
    getTrashedKnowledgeItems.mockResolvedValue([trashedFile]);
    trashKnowledgeItem.mockResolvedValue();
    restoreKnowledgeItem.mockResolvedValue({ knowledgeItem: { ...trashedFile, lifecycleState: "active", trashedAt: null } });
    const user = userEvent.setup({ document: dom.window.document });
    renderHome();

    await user.click(await screen.findByRole("button", { name: "Move to Trash" }));
    await waitFor(() => expect(trashKnowledgeItem.mock.calls[0]?.[0]).toBe(processingItem.id));
    expect(screen.queryByRole("heading", { name: "example.com" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "View Trash" }));
    expect(await screen.findByRole("heading", { name: "proposal.pdf" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Restore" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download original file: proposal.pdf" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(restoreKnowledgeItem.mock.calls[0]?.[0]).toBe(trashedFile.id));
  });

  test.serial("requires confirmation before requesting permanent deletion from Trash", async () => {
    const trashedItem: KnowledgeItem = {
      ...processingItem,
      lifecycleState: "trashed",
      trashedAt: "2026-09-01T11:00:00.000Z",
      source: { ...processingItem.source, kind: "pdf", filename: "../proposal.pdf" },
    };
    getKnowledgeItems.mockResolvedValue([]);
    getTrashedKnowledgeItems.mockResolvedValue([trashedItem]);
    permanentlyDeleteKnowledgeItem.mockResolvedValue({ deletionPending: true });
    const user = userEvent.setup({ document: dom.window.document });
    renderHome();

    await user.click(await screen.findByRole("button", { name: "View Trash" }));
    await user.click(await screen.findByRole("button", { name: "Delete permanently" }));
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText(/“proposal\.pdf”/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Delete permanently" }));
    await waitFor(() => expect(permanentlyDeleteKnowledgeItem.mock.calls[0]?.[0]).toBe(trashedItem.id));
  });

  test("captures one Original File with a personal note and presents its provenance without processing actions", async () => {
    const originalFileItem: KnowledgeItem = {
      id: 2,
      createdAt: "2026-09-01T10:00:00.000Z",
      lifecycleState: "active",
      trashedAt: null,
      source: {
        id: 2,
        kind: "pdf",
        submittedUrl: "",
        normalizedUrl: "",
        filename: "../design notes.pdf",
        mediaType: "application/pdf",
        byteSize: 1_536,
        originalFileActions: {
          open: "/knowledge-items/2/original-file/open",
          download: "/knowledge-items/2/original-file/download",
        },
      },
      sourcePreview: null,
      evidenceCoverage: null,
      captureContexts: [{ kind: "personal-note", summary: "Keep for the proposal." }],
      availability: "unsupported",
      organizationCondition: "complete",
      recognitionSummary: null,
      topicTags: [],
      latestAttempt: null,
    };
    getKnowledgeItems.mockResolvedValue([]);
    createOriginalFileCapture.mockResolvedValue({
      captureId: 2,
      sourceId: 2,
      knowledgeItemId: 2,
      processingAttemptId: null,
      availability: "unsupported",
      organizationCondition: "complete",
      reused: true,
      restoredFromTrash: false,
      knowledgeItem: originalFileItem,
    });
    const user = userEvent.setup({ document: dom.window.document });
    renderHome();

    await user.click(screen.getByRole("radio", { name: /File/ }));
    await user.upload(screen.getByLabelText("Choose Original File"), new File(["proposal"], "design notes.pdf", { type: "application/pdf" }));
    await user.type(screen.getByLabelText("Personal note (optional)"), "Keep for the proposal.");
    await user.click(screen.getByRole("button", { name: "Capture file to MindVault" }));

    await waitFor(() => expect(createOriginalFileCapture.mock.calls[0]?.[0]).toEqual({
      file: expect.any(File),
      personalNote: "Keep for the proposal.",
    }));
    expect(await screen.findByRole("heading", { name: "design notes.pdf" })).toBeTruthy();
    expect(screen.getByText("Unsupported")).toBeTruthy();
    expect(screen.getByText("PDF")).toBeTruthy();
    expect(screen.getByText("application/pdf")).toBeTruthy();
    expect(screen.getByText("1.5 KB")).toBeTruthy();
    expect(screen.getByRole("img", { name: "PDF file placeholder" })).toBeTruthy();
    expect(screen.getByText("Reused the existing Knowledge Item.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry processing" })).toBeNull();
    expect(screen.queryByLabelText("Generated Recognition Summary")).toBeNull();
    expect(screen.queryByLabelText("Generated Topic Tags")).toBeNull();
    const open = screen.getByRole("button", { name: "Open original file: design notes.pdf" });
    expect(open.getAttribute("href")).toBe("http://localhost:4000/knowledge-items/2/original-file/open");
    expect(open.getAttribute("target")).toBe("_blank");
    expect(open.getAttribute("rel")).toBe("noopener noreferrer");
    const download = screen.getByRole("button", { name: "Download original file: design notes.pdf" });
    expect(download.getAttribute("href")).toBe("http://localhost:4000/knowledge-items/2/original-file/download");
  });

  test("progressively presents Source facts separately from generated enrichment", async () => {
    const recognizedItem: KnowledgeItem = {
      ...processingItem,
      availability: "ready",
      sourcePreview: {
        title: "Trustworthy &lt; Source title",
        description: "Source-provided description.",
        websiteName: "MindVault Journal",
        author: "Ada Lovelace",
        publishedAt: "2026-08-20T00:00:00.000Z",
        contentType: "article",
        previewImageUrl: "/source-preview-media/1",
        previewImageAlt: "A durable knowledge card",
        faviconUrl: null,
      },
      recognitionSummary: "Generated recognition summary.",
      topicTags: ["durable capture"],
      latestAttempt: { ...processingItem.latestAttempt!, status: "completed" },
    };
    getKnowledgeItems.mockResolvedValue([recognizedItem]);
    renderHome();

    expect(await screen.findByRole("heading", { name: "Trustworthy &lt; Source title" })).toBeTruthy();
    expect(screen.getByText("MindVault Journal")).toBeTruthy();
    expect(screen.getByText("Article")).toBeTruthy();
    expect(screen.getByText("Source-provided description.")).toBeTruthy();
    expect(screen.getByText(/Ada Lovelace/)).toBeTruthy();
    expect(screen.getByText(/Aug 20, 2026/)).toBeTruthy();
    expect(screen.getByRole("img", { name: "A durable knowledge card" }).getAttribute("src")).toBe("/source-preview-media/1");
    expect(screen.getByLabelText("Generated Recognition Summary").textContent).toContain("Generated recognition summary.");
    expect(screen.getByLabelText("Generated Topic Tags").textContent).toContain("durable capture");
  });

  test("renders a retained favicon as a contained icon instead of stretching it as a cover", async () => {
    getKnowledgeItems.mockResolvedValue([{
      ...processingItem,
      availability: "ready",
      sourcePreview: {
        title: "Page with icon fallback",
        description: null,
        websiteName: "Example",
        author: null,
        publishedAt: null,
        contentType: null,
        previewImageUrl: "/source-preview-media/7",
        previewImageAlt: "Website icon",
        previewImagePresentation: "icon",
        faviconUrl: "https://example.com/favicon.ico",
      },
      latestAttempt: { ...processingItem.latestAttempt!, status: "completed" },
    }]);
    renderHome();

    const icon = await screen.findByRole("img", { name: "Website icon" });
    expect(icon.className).toContain("object-contain");
    expect(icon.className).not.toContain("w-full");
    expect(icon.parentElement?.className).toContain("items-center");
  });

  test("keeps recognizable Source facts visible when webpage processing needs attention", async () => {
    getKnowledgeItems.mockResolvedValue([{
      ...processingItem,
      availability: "needs-attention",
      sourcePreview: {
        title: "Preview retained despite unavailable article",
        description: "Recognizable source-provided facts remain visible while primary article text is unavailable.",
        websiteName: "MindVault Journal",
        author: null,
        publishedAt: null,
        contentType: null,
        previewImageUrl: null,
        previewImageAlt: null,
        faviconUrl: null,
      },
      latestAttempt: {
        ...processingItem.latestAttempt!,
        status: "failed",
        failureReason: "This Source requires authentication",
      },
    }]);
    renderHome();

    expect(await screen.findByRole("heading", { name: "Preview retained despite unavailable article" })).toBeTruthy();
    expect(screen.getByText("MindVault Journal")).toBeTruthy();
    expect(screen.getByText("Recognizable source-provided facts remain visible while primary article text is unavailable.")).toBeTruthy();
    expect(screen.getByText("Needs attention")).toBeTruthy();
    expect(screen.getByText("Processing needs attention: This Source requires authentication")).toBeTruthy();
  });

  test("offers Download but no unavailable Open action for an unsupported generic Original File", async () => {
    getKnowledgeItems.mockResolvedValue([{
      ...processingItem,
      id: 3,
      source: {
        id: 3,
        kind: "file",
        submittedUrl: "",
        normalizedUrl: "",
        filename: "opaque.bin",
        mediaType: "application/octet-stream",
        byteSize: 64,
        originalFileActions: { download: "/knowledge-items/3/original-file/download" },
      },
      availability: "unsupported",
      organizationCondition: "complete",
      latestAttempt: null,
    }]);
    renderHome();

    expect(await screen.findByRole("button", { name: "Download original file: opaque.bin" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open original file: opaque.bin" })).toBeNull();
  });

  test("hides Original File actions when retained storage is unavailable", async () => {
    getKnowledgeItems.mockResolvedValue([{
      ...processingItem,
      id: 4,
      source: {
        id: 4,
        kind: "pdf",
        submittedUrl: "",
        normalizedUrl: "",
        filename: "pending.pdf",
        mediaType: "application/pdf",
        byteSize: 64,
      },
      availability: "unsupported",
      organizationCondition: "complete",
      latestAttempt: null,
    }]);
    renderHome();

    await screen.findByRole("heading", { name: "pending.pdf" });
    expect(screen.queryByRole("button", { name: /original file: pending\.pdf/ })).toBeNull();
  });

  test("accepts the minimal URL form and displays a captured item as Processing immediately", async () => {
    getKnowledgeItems.mockResolvedValue([]);
    createCapture.mockResolvedValue({
      captureId: 1,
      sourceId: 1,
      knowledgeItemId: 1,
      processingAttemptId: 1,
      availability: "processing",
      organizationCondition: "complete",
      knowledgeItem: processingItem,
    });
    const user = userEvent.setup({ document: dom.window.document });
    renderHome();

    await user.type(
      screen.getByLabelText("URL"),
      processingItem.source.submittedUrl,
    );
    await user.click(
      screen.getByRole("button", { name: "Capture to MindVault" }),
    );

    await waitFor(() =>
      expect(createCapture.mock.calls[0]?.[0]).toEqual({
        url: processingItem.source.submittedUrl,
      }),
    );
    expect(await screen.findByText("Processing")).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "example.com" }),
    ).toBeTruthy();
    expect(screen.getByText("Webpage")).toBeTruthy();
    expect(
      screen.getByRole("img", { name: "Webpage preview placeholder" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Open original webpage: https://example.com/article",
      }),
    ).toBeTruthy();
    const originalWebpageAction = screen.getByRole("button", {
      name: "Open original webpage: https://example.com/article",
    });
    expect(originalWebpageAction.getAttribute("href")).toBe(
      processingItem.source.submittedUrl,
    );
    expect(originalWebpageAction.getAttribute("target")).toBe("_blank");
    expect(originalWebpageAction.getAttribute("rel")).toBe("noopener noreferrer");
    expect(
      screen.getByText(
        "Capture succeeded. Processing continues in the background.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Read this after the design review.")).toBeTruthy();
  });

  test("keeps a completed card understandable when no preview image was retained", async () => {
    getKnowledgeItems.mockResolvedValue([{
      ...processingItem,
      availability: "ready",
      sourcePreview: {
        title: "A sparse but useful article",
        description: null,
        websiteName: null,
        author: null,
        publishedAt: null,
        contentType: "article",
        previewImageUrl: null,
        previewImageAlt: null,
        faviconUrl: null,
      },
      latestAttempt: { ...processingItem.latestAttempt!, status: "completed" },
    }]);
    renderHome();

    expect(await screen.findByRole("heading", { name: "A sparse but useful article" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Webpage preview placeholder" })).toBeTruthy();
    expect(screen.getByText("Article")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open original webpage: https://example.com/article" })).toBeTruthy();
  });

  test("polls Processing Knowledge Items until their status becomes stable", async () => {
    getKnowledgeItems
      .mockResolvedValueOnce([processingItem])
      .mockResolvedValueOnce([
        {
          ...processingItem,
          availability: "ready",
          recognitionSummary: "A newly available generated description.",
          latestAttempt: {
            ...processingItem.latestAttempt!,
            status: "completed",
          },
        },
      ]);
    renderHome();

    expect(await screen.findByText("Processing")).toBeTruthy();
    await waitFor(() => expect(getKnowledgeItems).toHaveBeenCalledTimes(2), {
      timeout: 3_000,
    });
    expect(await screen.findByText("Ready")).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "example.com" }),
    ).toBeTruthy();
    expect(screen.getByText("Webpage")).toBeTruthy();
    expect(
      screen.getByRole("img", { name: "Webpage preview placeholder" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Open original webpage: https://example.com/article",
      }),
    ).toBeTruthy();
    expect(
      screen.getByText("A newly available generated description."),
    ).toBeTruthy();
  });

  test("keeps a newly captured Processing Preview Card when an older library request completes", async () => {
    let resolveInitialLibraryRequest: ((items: KnowledgeItem[]) => void) | undefined;
    getKnowledgeItems.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveInitialLibraryRequest = resolve;
        }),
    );
    createCapture.mockResolvedValue({
      captureId: 1,
      sourceId: 1,
      knowledgeItemId: 1,
      processingAttemptId: 1,
      availability: "processing",
      organizationCondition: "complete",
      knowledgeItem: processingItem,
    });
    const user = userEvent.setup({ document: dom.window.document });
    renderHome();

    await user.type(screen.getByLabelText("URL"), processingItem.source.submittedUrl);
    await user.click(screen.getByRole("button", { name: "Capture to MindVault" }));
    expect(await screen.findByRole("heading", { name: "example.com" })).toBeTruthy();

    await act(async () => resolveInitialLibraryRequest?.([]));

    await waitFor(() =>
      expect(screen.queryByText("Loading Knowledge Items…")).toBeNull(),
    );
    expect(await screen.findByRole("heading", { name: "example.com" })).toBeTruthy();
    expect(screen.getByText("Processing")).toBeTruthy();
  });

  test("keeps the latest repeated Capture when an older library request includes the same Knowledge Item", async () => {
    let resolveInitialLibraryRequest: ((items: KnowledgeItem[]) => void) | undefined;
    const existingKnowledgeItem: KnowledgeItem = {
      ...processingItem,
      availability: "ready",
      captureContexts: [],
      latestAttempt: {
        ...processingItem.latestAttempt!,
        status: "completed",
      },
    };
    const repeatedCapture: KnowledgeItem = {
      ...processingItem,
      captureContexts: [
        { kind: "personal-note", summary: "Keep the latest Capture Context." },
      ],
    };
    getKnowledgeItems.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveInitialLibraryRequest = resolve;
        }),
    );
    createCapture.mockResolvedValue({
      captureId: 2,
      sourceId: 1,
      knowledgeItemId: 1,
      processingAttemptId: 2,
      availability: "processing",
      organizationCondition: "complete",
      knowledgeItem: repeatedCapture,
    });
    const user = userEvent.setup({ document: dom.window.document });
    renderHome();

    await user.type(screen.getByLabelText("URL"), repeatedCapture.source.submittedUrl);
    await user.click(screen.getByRole("button", { name: "Capture to MindVault" }));
    expect(await screen.findByText("Keep the latest Capture Context.")).toBeTruthy();

    await act(async () => resolveInitialLibraryRequest?.([existingKnowledgeItem]));

    await waitFor(() =>
      expect(screen.queryByText("Loading Knowledge Items…")).toBeNull(),
    );
    expect(screen.getByText("Processing")).toBeTruthy();
    expect(screen.getByText("Keep the latest Capture Context.")).toBeTruthy();
  });

  test("offers an accessible Refresh action while keeping Ready content visible", async () => {
    const readyItem = {
      ...processingItem,
      availability: "ready" as const,
      latestAttempt: { ...processingItem.latestAttempt!, kind: "initial-capture", status: "completed" },
    };
    getKnowledgeItems.mockResolvedValue([readyItem]);
    refreshKnowledgeItem.mockResolvedValue({
      processingAttemptId: 2,
      knowledgeItem: {
        ...readyItem,
        latestAttempt: { ...readyItem.latestAttempt!, id: 2, kind: "refresh", status: "pending" },
      },
    });
    const user = userEvent.setup({ document: dom.window.document });
    renderHome();

    await user.click(await screen.findByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(refreshKnowledgeItem.mock.calls[0]?.[0]).toBe(readyItem.id));
  });

  test("keeps polling a Ready initial Capture until its Recognition Summary finishes", async () => {
    const awaitingSummary: KnowledgeItem = { ...processingItem, availability: "ready", organizationCondition: "complete", topicTags: ["Closures"], latestAttempt: { ...processingItem.latestAttempt!, status: "pending" } };
    getKnowledgeItems.mockResolvedValueOnce([awaitingSummary]).mockResolvedValue([{ ...awaitingSummary, recognitionSummary: "Explains JavaScript closures and lexical scope.", latestAttempt: { ...awaitingSummary.latestAttempt!, status: "completed" } }]);
    renderHome();
    expect(await screen.findByText("Closures")).toBeTruthy();
    expect(await screen.findByText("Explains JavaScript closures and lexical scope.", {}, { timeout: 3_500 })).toBeTruthy();
  });

  test("updates Recall tags when background organization finishes without a manual refresh", async () => {
    const organizing: KnowledgeItem = { ...processingItem, availability: "ready", organizationCondition: "processing", latestAttempt: { ...processingItem.latestAttempt!, status: "pending" } };
    getKnowledgeItems.mockResolvedValueOnce([organizing]).mockResolvedValue([{ ...organizing, organizationCondition: "complete", topicTags: ["Closures"], latestAttempt: { ...organizing.latestAttempt!, status: "completed" } }]);
    const result: RecallKnowledgeItem = { id: 1, title: "Closures", source: processingItem.source, sourcePreview: null, recognitionSummary: null, topicTags: [], excerpts: [], ranking: { score: 1, matchedPassageCount: 1 } };
    searchKnowledgeItems.mockResolvedValueOnce([result]).mockResolvedValue([{ ...result, topicTags: ["Closures"] }]);
    const user = userEvent.setup({ document: dom.window.document });
    renderHome();
    await user.type(await screen.findByLabelText("Search your Knowledge Items"), "closures");
    await user.click(screen.getByRole("button", { name: /^Search$/ }));
    expect(await screen.findByText("Grounded match")).toBeTruthy();
    await waitFor(() => expect(screen.getAllByLabelText("Generated Topic Tags").length).toBe(2), { timeout: 3_500 });
  });

  test("keeps polling a Ready card while Refresh is pending, then presents its changed Preview", async () => {
    const refreshingItem: KnowledgeItem = {
      ...processingItem,
      availability: "ready",
      sourcePreview: {
        title: "Original Source Preview",
        description: "Original facts remain visible while Refresh runs.",
        websiteName: null,
        author: null,
        publishedAt: null,
        contentType: "article",
        previewImageUrl: "/source-preview-media/1",
        previewImageAlt: "Original preview image",
        faviconUrl: null,
      },
      recognitionSummary: "Generated recognition summary remains labelled.",
      topicTags: ["Testing"],
      latestAttempt: { ...processingItem.latestAttempt!, kind: "refresh", status: "pending" },
    };
    getKnowledgeItems
      .mockResolvedValueOnce([refreshingItem])
      .mockResolvedValueOnce([{
        ...refreshingItem,
        sourcePreview: { ...refreshingItem.sourcePreview!, title: "Changed Source Preview", previewImageUrl: "/source-preview-media/2", previewImageAlt: "Changed preview image" },
        latestAttempt: { ...refreshingItem.latestAttempt!, status: "completed" },
      }]);
    renderHome();

    expect(await screen.findByRole("heading", { name: "Original Source Preview" })).toBeTruthy();
    expect(screen.getByText(/Refresh underway/)).toBeTruthy();
    expect(screen.getByLabelText("Generated Recognition Summary").textContent).toContain("Generated recognition summary remains labelled.");
    await waitFor(() => expect(getKnowledgeItems).toHaveBeenCalledTimes(2), { timeout: 3_000 });
    expect(await screen.findByRole("heading", { name: "Changed Source Preview" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Changed preview image" }).getAttribute("src")).toBe("/source-preview-media/2");
    expect(screen.getByLabelText("Generated Topic Tags").textContent).toContain("Testing");
  });

  test("offers Retry only for a Knowledge Item that needs attention and updates it as retry processing begins", async () => {
    const needsAttentionItem: KnowledgeItem = {
      ...processingItem,
      availability: "needs-attention",
      latestAttempt: {
        ...processingItem.latestAttempt!,
        status: "failed",
        failureReason: "The Source returned HTTP 503",
      },
    };
    const retriedItem: KnowledgeItem = {
      ...needsAttentionItem,
      availability: "processing",
      latestAttempt: { ...needsAttentionItem.latestAttempt!, id: 2, kind: "manual-retry", status: "pending" },
    };
    getKnowledgeItems
      .mockResolvedValueOnce([needsAttentionItem])
      .mockResolvedValue([retriedItem]);
    retryKnowledgeItem.mockResolvedValue({
      processingAttemptId: 2,
      knowledgeItem: retriedItem,
    });
    const user = userEvent.setup({ document: dom.window.document });
    renderHome();

    await user.click(await screen.findByRole("button", { name: "Retry processing" }));
    await waitFor(() => expect(retryKnowledgeItem.mock.calls[0]?.[0]).toBe(needsAttentionItem.id));
    expect(await screen.findByText("Processing")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry processing" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
  });

  test("offers Retry without removing Ready content after a failed Refresh", async () => {
    const readyItem = {
      ...processingItem,
      availability: "ready" as const,
      latestAttempt: {
        ...processingItem.latestAttempt!,
        kind: "refresh",
        status: "failed",
        failureReason: "The Source returned HTTP 503",
      },
    };
    getKnowledgeItems.mockResolvedValue([readyItem]);
    renderHome();

    expect(await screen.findByText("Ready")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry processing" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
    expect(screen.getByText(/existing Ready content remains available/)).toBeTruthy();
  });

  test("provides accessible loading, empty, and error states", async () => {
    let resolveItems: ((items: KnowledgeItem[]) => void) | undefined;
    getKnowledgeItems.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveItems = resolve;
        }),
    );
    const { unmount } = renderHome();
    expect(screen.getByRole("status").textContent).toContain(
      "Loading Knowledge Items",
    );
    resolveItems?.([]);
    expect(
      await screen.findByText(
        "Your vault is empty. Capture your first link above.",
      ),
    ).toBeTruthy();
    unmount();

    getKnowledgeItems.mockRejectedValueOnce(
      new Error("MindVault is unavailable."),
    );
    renderHome();
    expect((await screen.findByRole("alert")).textContent).toContain(
      "MindVault is unavailable.",
    );
  });

  test("shows grounded Recall excerpts and an action to open the original Source", async () => {
    getKnowledgeItems.mockResolvedValue([]);
    searchKnowledgeItems.mockResolvedValue([
      {
        id: 7,
        title: "Lexical corpus",
        source: processingItem.source,
        sourcePreview: null,
        recognitionSummary: null,
        topicTags: [],
        excerpts: [
          {
            text: "The service reported the error message EADDRINUSE while binding its listener.",
            origin: "source-snapshot",
            sourceSnapshot: {
              id: 5,
              originalUrl: processingItem.source.submittedUrl,
              finalUrl: processingItem.source.submittedUrl,
              canonicalUrl: null,
              extractedAt: processingItem.createdAt,
              evidenceCoverage: "primary-content",
            },
            ranking: { score: 0.04, lexicalRank: 1 },
          },
        ],
        ranking: { score: 0.04, matchedPassageCount: 1 },
      },
    ]);
    const user = userEvent.setup({ document: dom.window.document });
    renderHome();

    await user.type(screen.getByLabelText("Search your Knowledge Items"), "EADDRINUSE");
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByText(/EADDRINUSE/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open original Source" }).getAttribute("href")).toBe(processingItem.source.submittedUrl);
  });

  test("presents the shared Source Preview while keeping Recall evidence prominent", async () => {
    getKnowledgeItems.mockResolvedValue([]);
    searchKnowledgeItems.mockResolvedValue([
      {
        id: 7,
        title: "Trustworthy preview facts",
        source: processingItem.source,
        sourcePreview: {
          title: "Trustworthy preview facts",
          description: "A source-provided description for recognizing this article.",
          websiteName: "MindVault Journal",
          author: "Ada Lovelace",
          publishedAt: "2026-08-20T00:00:00.000Z",
          contentType: "article",
          previewImageUrl: "/source-preview-media/5",
          previewImageAlt: "A durable knowledge card",
          faviconUrl: null,
        },
        recognitionSummary: "Generated context for recognition.",
        topicTags: ["durable capture"],
        excerpts: [
          {
            text: "Grounded Source text explains why this Knowledge Item matched.",
            origin: "source-snapshot",
            sourceSnapshot: {
              id: 5,
              originalUrl: "https://archive.example.com/original-article",
              finalUrl: processingItem.source.submittedUrl,
              canonicalUrl: null,
              extractedAt: processingItem.createdAt,
              evidenceCoverage: "primary-content",
            },
            ranking: { score: 0.04, lexicalRank: 1 },
          },
        ],
        ranking: { score: 0.04, matchedPassageCount: 1 },
      },
    ]);
    const user = userEvent.setup({ document: dom.window.document });
    renderHome();

    await user.type(screen.getByLabelText("Search your Knowledge Items"), "grounded source");
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByRole("heading", { name: "Trustworthy preview facts" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "A durable knowledge card" }).getAttribute("src")).toBe("/source-preview-media/5");
    expect(screen.getByText("MindVault Journal")).toBeTruthy();
    expect(screen.getByText("Source-provided details")).toBeTruthy();
    expect(screen.getByText("A source-provided description for recognizing this article.")).toBeTruthy();
    expect(screen.getByText(/Ada Lovelace/)).toBeTruthy();
    expect(screen.getByText("Grounded Source text explains why this Knowledge Item matched.")).toBeTruthy();
    expect(screen.getByLabelText("Generated Recognition Summary").textContent).toContain("Generated context for recognition.");
    expect(screen.getByRole("list", { name: "Generated Topic Tags" }).textContent).toContain("durable capture");
    expect(screen.getByRole("button", { name: "Open original Source" }).getAttribute("href")).toBe("https://archive.example.com/original-article");
  });

  test("keeps Recall understandable when no preview image was retained", async () => {
    getKnowledgeItems.mockResolvedValue([]);
    searchKnowledgeItems.mockResolvedValue([
      {
        id: 7,
        title: null,
        source: processingItem.source,
        sourcePreview: null,
        recognitionSummary: null,
        topicTags: [],
        excerpts: [{
          text: "Grounded Source text remains available without presentation media.",
          origin: "source-snapshot",
          sourceSnapshot: null,
          ranking: { score: 0.04, lexicalRank: 1 },
        }],
        ranking: { score: 0.04, matchedPassageCount: 1 },
      },
    ]);
    const user = userEvent.setup({ document: dom.window.document });
    renderHome();

    await user.type(screen.getByLabelText("Search your Knowledge Items"), "grounded source");
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByRole("img", { name: "Webpage preview placeholder" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "example.com" })).toBeTruthy();
    expect(screen.getByText("Grounded Source text remains available without presentation media.")).toBeTruthy();
  });

  test("labels Recognition Summaries as generated enrichment in Knowledge Item and Recall results", async () => {
    const summary = "A generated description that helps recognize this Knowledge Item.";
    getKnowledgeItems.mockResolvedValue([{ ...processingItem, recognitionSummary: summary }]);
    searchKnowledgeItems.mockResolvedValue([
      {
        id: 7,
        title: "Recognition fixture",
        source: processingItem.source,
        sourcePreview: null,
        recognitionSummary: summary,
        topicTags: [],
        excerpts: [
          {
            text: "Grounded Source text remains separate from generated enrichment.",
            origin: "source-snapshot",
            sourceSnapshot: null,
            ranking: { score: 0.04, lexicalRank: 1 },
          },
        ],
        ranking: { score: 0.04, matchedPassageCount: 1 },
      },
    ]);
    const user = userEvent.setup({ document: dom.window.document });
    renderHome();

    expect(await screen.findAllByText("Generated recognition summary")).toHaveLength(1);
    await user.type(screen.getByLabelText("Search your Knowledge Items"), "recognition");
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findAllByText("Generated recognition summary")).toHaveLength(2);
    expect(screen.getAllByText(summary)).toHaveLength(2);
  });

  test("shows generated Topic Tags and Organization incomplete without hiding Ready content", async () => {
    const item: KnowledgeItem = {
      ...processingItem,
      availability: "ready",
      organizationCondition: "incomplete",
      topicTags: ["Machine Learning", "Neural Networks"],
      latestAttempt: {
        ...processingItem.latestAttempt!,
        status: "failed",
        failureReason: "Topic Tag provider unavailable",
      },
    };
    getKnowledgeItems.mockResolvedValue([item]);
    renderHome();

    expect(await screen.findByText("Ready")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Generated Topic Tags" })).toBeTruthy();
    expect(screen.getByText("Machine Learning")).toBeTruthy();
    expect(screen.getByText("Neural Networks")).toBeTruthy();
    expect(screen.getByText(/Organization is incomplete/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry processing" })).toBeTruthy();
  });
});

test("processes an already retained PDF and exposes its generated enrichment", async () => {
  const retained: KnowledgeItem = {
    ...processingItem,
    id: 31,
    source: { id: 31, kind: "pdf", submittedUrl: "", normalizedUrl: "", filename: "recovery.pdf", mediaType: "application/pdf", byteSize: 1000,
      originalFileActions: { open: "/knowledge-items/31/original-file/open", download: "/knowledge-items/31/original-file/download" } },
    availability: "unsupported", organizationCondition: "complete", captureContexts: [], latestAttempt: null,
  };
  const ready: KnowledgeItem = { ...retained, availability: "ready", recognitionSummary: "A guide to durable transaction logs.", topicTags: ["PostgreSQL"],
    latestAttempt: { id: 32, kind: "refresh", status: "completed", createdAt: retained.createdAt, warnings: ["Summary generation exceeded its input limit."] },
    extractionCoverage: { pageCount: 2, pages: [{ pageNumber: 1, outcome: "extracted", reason: null }, { pageNumber: 2, outcome: "needs-ocr", reason: "OCR is required" }] } };
  getKnowledgeItems.mockResolvedValueOnce([retained]).mockResolvedValue([ready]);
  getTrashedKnowledgeItems.mockResolvedValue([]);
  refreshKnowledgeItem.mockResolvedValue({ processingAttemptId: 32, knowledgeItem: ready });
  const user = userEvent.setup({ document: dom.window.document });
  renderHome();
  await user.click(await screen.findByRole("button", { name: "Process PDF" }));
  expect(refreshKnowledgeItem.mock.calls[0]?.[0]).toBe(31);
  expect(await screen.findByText("A guide to durable transaction logs.")).toBeTruthy();
  expect(screen.getByText("PostgreSQL")).toBeTruthy();
  expect(screen.getByText(/Incomplete extraction: page 2/)).toBeTruthy();
  expect(screen.getByText("Summary generation exceeded its input limit.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Open original file: recovery.pdf" })).toBeTruthy();
});

test("Recall discloses the cited PDF snapshot's extraction gaps", async () => {
  const { RecallResultCard } = await import("@/components/recall-result-card");
  const result: RecallKnowledgeItem = {
    id: 31, title: "Printed recovery", source: { ...processingItem.source, filename: "scan.pdf" },
    sourcePreview: null, recognitionSummary: null, topicTags: [],
    excerpts: [{ text: "Restore the base backup.", pageNumber: 2, origin: "source-snapshot",
      sourceSnapshot: { id: 4, originalUrl: null, finalUrl: null, canonicalUrl: null,
        extractedAt: processingItem.createdAt, evidenceCoverage: "primary-content",
        extractionCoverage: { pageCount: 3, pages: [
          { pageNumber: 1, outcome: "blank", reason: null },
          { pageNumber: 2, outcome: "extracted", reason: "Native text retained; raster text coverage incomplete" },
          { pageNumber: 3, outcome: "unprocessed", reason: "Document rendering/OCR work limit reached" },
        ] } }, ranking: { score: 1 } }],
    ranking: { score: 1, matchedPassageCount: 1 },
  };
  render(<RecallResultCard result={result} />);
  expect(screen.getByText(/Incomplete extraction: page 2/)).toBeTruthy();
  expect(screen.getByText(/visual relationships have not been interpreted/)).toBeTruthy();
});
