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

const getKnowledgeItem = mock<(id: number) => Promise<KnowledgeItem>>();
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
  getKnowledgeItem,
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
  knowledgeItemKeys: { detail: (id: number | null) => ["knowledge-items", "detail", id], all: ["knowledge-items"], trash: ["knowledge-items", "trash"] },
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

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  getKnowledgeItem.mockReset();
  getKnowledgeItem.mockResolvedValue(processingItem);
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
    expect(screen.getByRole("button", { name: "View PostgreSQL replication overview" }).textContent).toContain("PostgreSQL replication overview");

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

test("Recall discloses the cited PDF snapshot's extraction gaps", async () => {
  const { RecallResultCard } = await import("@/components/recall-result-card");
  const result: RecallKnowledgeItem = {
    id: 31, title: "Printed recovery", source: { ...processingItem.source, filename: "scan.pdf" },
    sourcePreview: null, recognitionSummary: null, topicTags: [],
    excerpts: [{ text: "Restore the base backup.", pageNumber: 2, pageLabel: "1", openOriginalFile: "/knowledge-items/31/original-file/open?page=2", origin: "source-snapshot",
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
  expect(screen.getByRole("button", { name: "Open PDF at page 2" }).getAttribute("href")).toBe("http://localhost:4000/knowledge-items/31/original-file/open?page=2");
  expect(screen.getByText(/printed label: 1/)).toBeTruthy();
  expect(screen.getByText(/If your viewer/)).toBeTruthy();
});


test("Synthesis shows distinct PDF page citations and keeps evidence visible after a failed follow-up", async () => {
  getKnowledgeItems.mockResolvedValue([]);
  getTrashedKnowledgeItems.mockResolvedValue([]);
  askVault.mockResolvedValueOnce({ answer: "Restore the backup and replay archived WAL.", insufficientEvidence: false,
    citations: [1, 2].map(pageNumber => ({ knowledgeItemId: 31, sourceSnapshotId: 4, title: "recovery.pdf",
      origin: "source-snapshot", originalUrl: null, evidenceCoverage: "primary-content", pageNumber,
      pageLabel: pageNumber === 2 ? "1" : null, openOriginalFile: `/knowledge-items/31/original-file/open?page=${pageNumber}`,
      excerpt: pageNumber === 1 ? "Restore the base backup." : "Replay archived WAL.",
      extractionCoverage: { pageCount: 3, pages: [{ pageNumber: 3, outcome: "unprocessed", reason: "OCR work limit reached" }] },
    })) });
  const user = userEvent.setup({ document: dom.window.document });
  renderHome();
  const question = await screen.findByLabelText("Ask a question about your captured knowledge");
  await user.type(question, "How do I recover?");
  await user.click(screen.getByRole("button", { name: "Ask your vault" }));
  expect(await screen.findByText("Replay archived WAL.")).toBeTruthy();
  for (const page of [1, 2]) expect(screen.getByRole("button", { name: `Open PDF at page ${page}` }).getAttribute("href")).toBe(`http://localhost:4000/knowledge-items/31/original-file/open?page=${page}`);
  expect(screen.getAllByText(/Incomplete extraction: page 3/)).toHaveLength(2);
  askVault.mockRejectedValueOnce(new Error("Generation input exceeds the supported limit. Shorten your question."));
  await user.type(question, "Explain the diagram");
  await user.click(screen.getByRole("button", { name: "Ask your vault" }));
  expect(await screen.findByText(/Generation input exceeds/)).toBeTruthy();
  expect(screen.getByText("Replay archived WAL.")).toBeTruthy();
  expect((question as HTMLTextAreaElement).value).toBe("Explain the diagram");
});


test("opens saved details with a keyboard, closes with Escape, and returns focus", async () => {
  const ready = { ...processingItem, availability: "ready" as const, organizationCondition: "complete" as const, latestAttempt: null, recognitionSummary: "Descriptive preview." };
  getKnowledgeItems.mockResolvedValue([ready]);
  getKnowledgeItem.mockResolvedValue(ready);
  const user = userEvent.setup({ document: dom.window.document });
  renderHome();
  const card = await screen.findByRole("button", { name: "View example.com" });
  expect(screen.queryByText("Ready")).toBeNull();
  card.focus();
  await user.keyboard("{Enter}");
  expect(await screen.findByRole("dialog")).toBeTruthy();
  expect(await screen.findByRole("heading", { name: /^Preview$/ })).toBeTruthy();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(Boolean(screen.queryByRole("dialog"))).toBe(false));
  await waitFor(() => expect(document.activeElement === card).toBe(true));
});

const readyItem: KnowledgeItem = {
  ...processingItem, availability: "ready", organizationCondition: "complete", latestAttempt: null,
  recognitionSummary: "A descriptive preview of available text.", topicTags: ["Databases"],
};
const fileItem: KnowledgeItem = {
  ...readyItem, id: 9,
  source: { id: 9, kind: "pdf", submittedUrl: "", normalizedUrl: "", filename: "proposal.pdf", mediaType: "application/pdf", byteSize: 1024,
    originalFileActions: { open: "/knowledge-items/9/original-file/open", download: "/knowledge-items/9/original-file/download" } },
};
function userSetup() { return userEvent.setup({ document: dom.window.document }); }
async function openCard(name = "example.com") {
  const user = userSetup();
  await user.click(await screen.findByRole("button", { name: `View ${name}` }));
  await screen.findByRole("dialog");
  return user;
}

test("provides accessible loading, empty, and board error states", async () => {
  let resolveItems!: (items: KnowledgeItem[]) => void;
  getKnowledgeItems.mockImplementationOnce(() => new Promise(resolve => { resolveItems = resolve; }));
  const { unmount } = renderHome();
  expect(screen.getByRole("status").textContent).toContain("Loading your saves");
  await act(async () => resolveItems([]));
  expect(await screen.findByText("Your vault is empty. Save a link or file below.")).toBeTruthy();
  unmount();
  getKnowledgeItems.mockRejectedValueOnce(new Error("MindVault is unavailable."));
  renderHome();
  expect((await screen.findByRole("alert")).textContent).toContain("MindVault is unavailable.");
});

test("loads details on demand and offers recovery from a loading failure", async () => {
  getKnowledgeItems.mockResolvedValue([readyItem]);
  let rejectDetails!: (error: Error) => void;
  getKnowledgeItem.mockImplementationOnce(() => new Promise((_, reject) => { rejectDetails = reject; }));
  renderHome();
  const user = await openCard();
  expect(screen.getByText("Loading details…")).toBeTruthy();
  await act(async () => rejectDetails(new Error("HTTP 503: private diagnostic")));
  expect(await screen.findByText(/Couldn’t load details/)).toBeTruthy();
  expect(screen.queryByText(/private diagnostic/)).toBeNull();
  getKnowledgeItem.mockResolvedValue(readyItem);
  await user.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(screen.getByRole("region", { name: "Preview" }).textContent).toContain(readyItem.recognitionSummary!));
});

test("shows image previews and title fallbacks in newest-first order without success badges", async () => {
  const newer = { ...readyItem, id: 2, createdAt: "2026-11-01T10:00:00Z", sourcePreview: { title: "Newer article", description: "Recognizable source facts", websiteName: "Example", author: null, publishedAt: null, contentType: "article", previewImageUrl: "/source-preview-media/2", previewImageAlt: "Article cover", faviconUrl: null } };
  getKnowledgeItems.mockResolvedValue([readyItem, newer]);
  renderHome();
  const cards = await screen.findAllByRole("button", { name: /^View (example.com|Newer article)$/ });
  expect(cards.map(card => card.getAttribute("aria-label"))).toEqual(["View Newer article", "View example.com"]);
  expect(screen.getByRole("img", { name: "Article cover" }).getAttribute("src")).toBe("/source-preview-media/2");
  expect(screen.queryByText("Ready")).toBeNull();
  expect(screen.queryByLabelText("Processing saved content")).toBeNull();
  expect(screen.queryByLabelText("Details need attention or have limitations")).toBeNull();
});

test("shows Preview and tags while keeping routine dates and processing under Details", async () => {
  getKnowledgeItems.mockResolvedValue([readyItem]);
  getKnowledgeItem.mockResolvedValue(readyItem);
  renderHome();
  await openCard();
  expect(screen.getByRole("heading", { name: "Preview" })).toBeTruthy();
  expect(screen.queryByText("TL;DR")).toBeNull();
  expect(screen.getByRole("region", { name: "Tags" }).textContent).toContain("Databases");
  expect(document.querySelector("details")?.open).toBe(false);
  expect(screen.getByRole("button", { name: "Open original" }).getAttribute("href")).toBe("https://example.com/article");
});

test("automatically discloses metadata limitations without presenting full-content claims", async () => {
  const metadata: KnowledgeItem = { ...readyItem, evidenceCoverage: "metadata-only" };
  getKnowledgeItems.mockResolvedValue([metadata]);
  getKnowledgeItem.mockResolvedValue(metadata);
  renderHome();
  expect(await screen.findByLabelText("Details need attention or have limitations")).toBeTruthy();
  await openCard();
  expect(document.querySelector("details")?.open).toBe(true);
  expect(screen.getByText(/Only the website’s description was available/)).toBeTruthy();
});

test("keeps PDF coverage, authenticated original access, and file provenance in details", async () => {
  const pdf: KnowledgeItem = { ...fileItem, extractionCoverage: { pageCount: 3, pages: [
    { pageNumber: 1, outcome: "extracted", reason: null }, { pageNumber: 2, outcome: "unprocessed", reason: "OCR work limit reached" }, { pageNumber: 3, outcome: "blank", reason: null },
  ] } };
  getKnowledgeItems.mockResolvedValue([pdf]);
  getKnowledgeItem.mockResolvedValue(pdf);
  renderHome();
  await openCard("proposal.pdf");
  expect(document.querySelector("details")?.open).toBe(true);
  expect(screen.getByText(/Incomplete extraction: page 2/)).toBeTruthy();
  expect(screen.getByText(/visual relationships have not been interpreted/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Open original" }).getAttribute("href")).toBe("http://localhost:4000/knowledge-items/9/original-file/open");
  expect(screen.getByRole("button", { name: "Download original file: proposal.pdf" }).getAttribute("href")).toBe("http://localhost:4000/knowledge-items/9/original-file/download");
  expect(screen.getByText(/application\/pdf · 1.0 KB/)).toBeTruthy();
});

test("opens unsupported files with download alone and explains why they are not searchable", async () => {
  const file: KnowledgeItem = { ...fileItem, availability: "unsupported", source: { ...fileItem.source, kind: "file", originalFileActions: { download: "/knowledge-items/9/original-file/download" } } };
  getKnowledgeItems.mockResolvedValue([file]); getKnowledgeItem.mockResolvedValue(file);
  renderHome(); await openCard("proposal.pdf");
  expect(screen.queryByRole("button", { name: "Open original" })).toBeNull();
  expect(screen.getByRole("button", { name: /Download original file/ })).toBeTruthy();
  expect(screen.getByText(/can’t read this type of content yet/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
});

test("polls the board and open details until processing finishes", async () => {
  getKnowledgeItems.mockResolvedValueOnce([processingItem]).mockResolvedValue([readyItem]);
  getKnowledgeItem.mockResolvedValueOnce(processingItem).mockResolvedValue(readyItem);
  renderHome(); await openCard();
  expect(screen.getByText(/preparing it for search/)).toBeTruthy();
  await waitFor(() => expect(screen.queryByLabelText("Processing saved content")).toBeNull(), { timeout: 3500 });
  await waitFor(() => expect(screen.getByRole("region", { name: "Preview" }).textContent).toContain(readyItem.recognitionSummary!), { timeout: 3500 });
});

test("offers retry for failed updates while preserving previously searchable content", async () => {
  const failed: KnowledgeItem = { ...readyItem, latestAttempt: { ...processingItem.latestAttempt!, status: "failed", kind: "refresh", failureReason: "Internal SQL secret" } };
  getKnowledgeItems.mockResolvedValue([failed]); getKnowledgeItem.mockResolvedValue(failed);
  retryKnowledgeItem.mockResolvedValue({ processingAttemptId: 2, knowledgeItem: { ...readyItem, latestAttempt: { ...processingItem.latestAttempt!, kind: "manual-retry" } } });
  const user = userSetup(); renderHome(); await openCard();
  expect(screen.getByText(/Previously saved content is still searchable/)).toBeTruthy();
  expect(screen.queryByText(/Internal SQL secret/)).toBeNull();
  await user.click(screen.getByRole("button", { name: "Retry processing" }));
  expect(retryKnowledgeItem.mock.calls[0]?.[0]).toBe(1);
});

test("refreshes available content and processes a previously retained PDF", async () => {
  const retained = { ...fileItem, availability: "unsupported" as const };
  getKnowledgeItems.mockResolvedValue([retained]); getKnowledgeItem.mockResolvedValue(retained);
  refreshKnowledgeItem.mockResolvedValue({ processingAttemptId: 2, knowledgeItem: { ...fileItem, latestAttempt: processingItem.latestAttempt } });
  renderHome(); const user = await openCard("proposal.pdf");
  await user.click(screen.getByRole("button", { name: "Process PDF" }));
  expect(refreshKnowledgeItem.mock.calls[0]?.[0]).toBe(9);
});

test("Back and explicit Close preserve search input and results and return focus", async () => {
  getKnowledgeItems.mockResolvedValue([readyItem]); getKnowledgeItem.mockResolvedValue(readyItem);
  searchKnowledgeItems.mockResolvedValue([{ id: 1, title: "Matching item", source: readyItem.source, sourcePreview: null, recognitionSummary: null, topicTags: [], excerpts: [{ text: "A matching database passage", origin: "source-snapshot", sourceSnapshot: null, ranking: { score: 1 } }], ranking: { score: 1, matchedPassageCount: 1 } }]);
  const user = userSetup(); renderHome();
  const search = screen.getByLabelText("Search your Knowledge Items");
  await user.type(search, "database"); await user.click(screen.getByRole("button", { name: "Search" }));
  expect(await screen.findByText("A matching database passage")).toBeTruthy();
  const trigger = screen.getByRole("button", { name: "View details" });
  await user.click(trigger);
  await screen.findByRole("dialog");
  expect(window.location.hash).toBe("#item=1");
  await act(async () => window.history.back());
  await waitFor(() => expect(Boolean(screen.queryByRole("dialog"))).toBe(false));
  expect((search as HTMLInputElement).value).toBe("database");
  expect(screen.getByText("A matching database passage")).toBeTruthy();
  await waitFor(() => expect(document.activeElement === trigger).toBe(true));
  await user.click(trigger); await screen.findByRole("dialog");
  await user.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(Boolean(screen.queryByRole("dialog"))).toBe(false));
  expect((search as HTMLInputElement).value).toBe("database");
});

test("moves a save to Trash, restores it, and confirms permanent deletion separately", async () => {
  const trashed: KnowledgeItem = { ...fileItem, lifecycleState: "trashed", trashedAt: "2026-11-01T12:00:00Z" };
  getKnowledgeItems.mockResolvedValue([fileItem]); getKnowledgeItem.mockResolvedValue(fileItem);
  getTrashedKnowledgeItems.mockResolvedValue([trashed]);
  trashKnowledgeItem.mockResolvedValue(); restoreKnowledgeItem.mockResolvedValue({ knowledgeItem: fileItem });
  permanentlyDeleteKnowledgeItem.mockResolvedValue({ deletionPending: true });
  renderHome(); const user = await openCard("proposal.pdf");
  await user.click(screen.getByRole("button", { name: "Move to Trash" }));
  await waitFor(() => expect(Boolean(screen.queryByRole("dialog"))).toBe(false));
  expect(trashKnowledgeItem.mock.calls[0]?.[0]).toBe(9);
  await user.click(screen.getByRole("button", { name: "View Trash" }));
  await openCard("proposal.pdf");
  await user.click(screen.getByRole("button", { name: "Delete permanently" }));
  await screen.findByRole("alertdialog");
  expect(permanentlyDeleteKnowledgeItem.mock.calls).toHaveLength(0);
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: "Restore" }));
  await waitFor(() => expect(restoreKnowledgeItem.mock.calls[0]?.[0]).toBe(9));
});

test("saves a URL immediately as a processing card through the retained capture form", async () => {
  getKnowledgeItems.mockResolvedValue([]);
  createCapture.mockResolvedValue({ captureId: 1, sourceId: 1, knowledgeItemId: 1, processingAttemptId: 1, availability: "processing", organizationCondition: "processing", knowledgeItem: processingItem });
  const user = userSetup(); renderHome();
  await user.type(screen.getByLabelText("URL"), "https://example.com/article");
  await user.click(screen.getByRole("button", { name: "Capture to MindVault" }));
  expect(await screen.findByRole("button", { name: "View example.com" })).toBeTruthy();
  expect(screen.getByLabelText("Processing saved content")).toBeTruthy();
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
    expect(screen.getByLabelText("Details need attention or have limitations")).toBeTruthy();
    expect(screen.getByText("Reused the existing Knowledge Item.")).toBeTruthy();
    getKnowledgeItem.mockResolvedValue(originalFileItem);
    await openCard("design notes.pdf");


    expect(screen.getByText(/application\/pdf · 1.5 KB/)).toBeTruthy();
    expect(screen.getByRole("img", { name: "PDF file placeholder" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry processing" })).toBeNull();
    expect(screen.queryByLabelText("Generated Recognition Summary")).toBeNull();
    expect(screen.queryByLabelText("Generated Topic Tags")).toBeNull();
    const open = screen.getByRole("button", { name: "Open original" });
    expect(open.getAttribute("href")).toBe("http://localhost:4000/knowledge-items/2/original-file/open");
    expect(open.getAttribute("target")).toBe("_blank");
    expect(open.getAttribute("rel")).toBe("noopener noreferrer");
    const download = screen.getByRole("button", { name: "Download original file: design notes.pdf" });
    expect(download.getAttribute("href")).toBe("http://localhost:4000/knowledge-items/2/original-file/download");
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
      expect(screen.queryByText("Loading your saves…")).toBeNull(),
    );
    expect(await screen.findByRole("heading", { name: "example.com" })).toBeTruthy();
    expect(screen.getByLabelText("Processing saved content")).toBeTruthy();
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
    expect(await screen.findByRole("button", { name: "View example.com" })).toBeTruthy();

    await act(async () => resolveInitialLibraryRequest?.([existingKnowledgeItem]));

    await waitFor(() =>
      expect(screen.queryByText("Loading your saves…")).toBeNull(),
    );
    expect(screen.getByLabelText("Processing saved content")).toBeTruthy();
    getKnowledgeItem.mockResolvedValue(repeatedCapture);
    await openCard();
    expect(await screen.findByText("Keep the latest Capture Context.")).toBeTruthy();
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

test("explains how to make a PDF link searchable without offering an unavailable processing action", async () => {
  const linkedPdf: KnowledgeItem = { ...readyItem, availability: "unsupported", source: { ...readyItem.source, kind: "pdf" } };
  getKnowledgeItems.mockResolvedValue([linkedPdf]); getKnowledgeItem.mockResolvedValue(linkedPdf);
  renderHome(); await openCard();
  expect(screen.getByText(/Upload a copy of the PDF/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Process PDF" })).toBeNull();
});

test("a delayed Trash response does not close a different item's details", async () => {
  getKnowledgeItems.mockResolvedValue([readyItem, fileItem]);
  getKnowledgeItem.mockImplementation(async id => id === 1 ? readyItem : fileItem);
  let finishTrash!: () => void;
  trashKnowledgeItem.mockImplementationOnce(() => new Promise(resolve => { finishTrash = resolve; }));
  renderHome(); const user = await openCard();
  await user.click(screen.getByRole("button", { name: "Move to Trash" }));
  await user.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(Boolean(screen.queryByRole("dialog"))).toBe(false));
  await openCard("proposal.pdf");
  await act(async () => finishTrash());
  expect(window.location.hash).toBe("#item=9");
  expect(screen.getByRole("heading", { name: "proposal.pdf", level: 2 })).toBeTruthy();
});
