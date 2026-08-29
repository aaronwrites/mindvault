import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { CaptureResponse, KnowledgeItem, RecallKnowledgeItem } from "@/lib/types";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
});
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
  IS_REACT_ACT_ENVIRONMENT: true,
});

const { act, cleanup, render, screen, waitFor } =
  await import("@testing-library/react");
const { default: userEvent } = await import("@testing-library/user-event");
const { QueryClient, QueryClientProvider } =
  await import("@tanstack/react-query");

const getKnowledgeItems = mock<() => Promise<KnowledgeItem[]>>();
const createCapture =
  mock<
    (input: {
      url: string;
      selectedText?: string;
      personalNote?: string;
    }) => Promise<CaptureResponse>
  >();
const refreshKnowledgeItem = mock<(knowledgeItemId: number) => Promise<{ processingAttemptId: number; knowledgeItem: KnowledgeItem }>>();
const retryKnowledgeItem = mock<(knowledgeItemId: number) => Promise<{ processingAttemptId: number; knowledgeItem: KnowledgeItem }>>();
const searchKnowledgeItems = mock<(query: string) => Promise<RecallKnowledgeItem[]>>();
mock.module("@/lib/api", () => ({
  getKnowledgeItems,
  createCapture,
  refreshKnowledgeItem,
  retryKnowledgeItem,
  searchKnowledgeItems,
  API_URL: "http://localhost:4000",
  knowledgeItemKeys: { all: ["knowledge-items"] },
  recallKeys: { all: ["knowledge-items", "recall"], search: (query: string) => ["knowledge-items", "recall", query] },
}));

const { default: Home } = await import("@/app/page");

const processingItem: KnowledgeItem = {
  id: 1,
  createdAt: "2026-08-24T10:00:00.000Z",
  source: {
    id: 1,
    submittedUrl: "https://example.com/article",
    normalizedUrl: "https://example.com/article",
    kind: "web",
  },
  sourcePreview: null,
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

beforeEach(() => {
  getKnowledgeItems.mockReset();
  createCapture.mockReset();
  refreshKnowledgeItem.mockReset();
  retryKnowledgeItem.mockReset();
  searchKnowledgeItems.mockReset();
});
afterEach(cleanup);

describe("Knowledge Item Capture", () => {
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

  test("labels Recognition Summaries as generated enrichment in Knowledge Item and Recall results", async () => {
    const summary = "A generated description that helps recognize this Knowledge Item.";
    getKnowledgeItems.mockResolvedValue([{ ...processingItem, recognitionSummary: summary }]);
    searchKnowledgeItems.mockResolvedValue([
      {
        id: 7,
        title: "Recognition fixture",
        source: processingItem.source,
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
