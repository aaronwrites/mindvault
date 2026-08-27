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

const { cleanup, render, screen, waitFor } =
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
const searchKnowledgeItems = mock<(query: string) => Promise<RecallKnowledgeItem[]>>();
mock.module("@/lib/api", () => ({
  getKnowledgeItems,
  createCapture,
  searchKnowledgeItems,
  knowledgeItemKeys: { all: ["knowledge-items"] },
  recallKeys: { search: (query: string) => ["knowledge-items", "recall", query] },
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
  searchKnowledgeItems.mockReset();
});
afterEach(cleanup);

describe("Knowledge Item Capture", () => {
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
      screen.getByText(
        "Capture succeeded. Processing continues in the background.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Read this after the design review.")).toBeTruthy();
  });

  test("polls Processing Knowledge Items until their status becomes stable", async () => {
    getKnowledgeItems
      .mockResolvedValueOnce([processingItem])
      .mockResolvedValueOnce([
        {
          ...processingItem,
          availability: "ready",
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
});
