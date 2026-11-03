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
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(callback, 0),
  cancelAnimationFrame: (id: number) => clearTimeout(id),
  IS_REACT_ACT_ENVIRONMENT: true,
});

const { act, cleanup, fireEvent, render, screen, waitFor, within } =
  await import("@testing-library/react");
const { default: userEvent } = await import("@testing-library/user-event");
const { QueryClient, QueryClientProvider } =
  await import("@tanstack/react-query");

const updateKnowledgeItemTitle = mock<(id: number, customTitle: string | null) => Promise<KnowledgeItem>>();
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
  updateKnowledgeItemTitle,
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
  updateKnowledgeItemTitle.mockReset();
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

    await user.click(screen.getByRole("button", { name: "Ask" }));
    expect(await screen.findByText("Questions, matching evidence, and current-session context are processed locally by Ollama. Original files are not sent to the models.")).toBeTruthy();
    await user.type(await screen.findByLabelText("Ask a question about your saves"), "How do read models stay current?");
    await user.click(screen.getByRole("button", { name: "Ask your vault" }));
    await waitFor(() => expect(askVault.mock.calls[0]?.[0]).toEqual({ question: "How do read models stay current?", conversation: [] }));
    expect(await screen.findByText(initialAnswer.answer)).toBeTruthy();
    expect(screen.getByText("Based only on the website’s description, not the full content.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "View PostgreSQL replication overview" }).textContent).toContain("PostgreSQL replication overview");

    const question = screen.getByLabelText("Ask a question about your saves");
    await user.type(question, "What does it apply?");
    await user.click(screen.getByRole("button", { name: "Ask your vault" }));
    await waitFor(() => expect(askVault.mock.calls[1]?.[0]).toEqual({
      question: "What does it apply?",
      conversation: [{ question: "How do read models stay current?", answer: initialAnswer.answer.slice(0, 4000) }],
    }));
    expect(await screen.findByText("It does that by applying changes from the publisher.")).toBeTruthy();
    expect(screen.getByText("Based on your personal note.")).toBeTruthy();

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
  await user.click(screen.getByRole("button", { name: "Ask" }));
  const question = await screen.findByLabelText("Ask a question about your saves");
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
  expect(await screen.findByText("Your vault is empty. Use Add to save a link or file.")).toBeTruthy();
  unmount();
  getKnowledgeItems.mockRejectedValueOnce(new Error("MindVault is unavailable."));
  renderHome();
  expect((await screen.findByRole("alert")).textContent).toContain("Couldn’t load your saves. Please try again.");
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
  await waitFor(() => expect(Boolean(screen.queryByLabelText("Processing saved content"))).toBe(false), { timeout: 6500 });
  await waitFor(() => expect(screen.getByRole("region", { name: "Preview" }).textContent).toContain(readyItem.recognitionSummary!), { timeout: 6500 });
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
  const search = screen.getByLabelText("Search your saves");
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
  await openTrash(user);
  await openCard("proposal.pdf");
  await user.click(screen.getByRole("button", { name: "Delete permanently" }));
  await screen.findByRole("alertdialog");
  expect(permanentlyDeleteKnowledgeItem.mock.calls).toHaveLength(0);
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: "Restore" }));
  await waitFor(() => expect(restoreKnowledgeItem.mock.calls[0]?.[0]).toBe(9));
});

test("saves a URL immediately as a processing card through Add", async () => {
  getKnowledgeItems.mockResolvedValue([]);
  createCapture.mockResolvedValue({ captureId: 1, sourceId: 1, knowledgeItemId: 1, processingAttemptId: 1, availability: "processing", organizationCondition: "processing", knowledgeItem: processingItem });
  const user = userSetup(); renderHome();
  await user.click(screen.getByRole("button", { name: "Add" }));
    await user.type(screen.getByLabelText("Link"), "https://example.com/article");
  await user.click(screen.getByRole("button", { name: "Save link" }));
  expect(await screen.findByRole("button", { name: "View example.com" })).toBeTruthy();
  expect(screen.getByLabelText("Processing saved content")).toBeTruthy();
});

test("a file saved through Add appears on the board with retained original access", async () => {
  getKnowledgeItems.mockResolvedValue([]);
  createOriginalFileCapture.mockResolvedValue({ captureId: 9, sourceId: 9, knowledgeItemId: 9, processingAttemptId: null, availability: "ready", organizationCondition: "complete", knowledgeItem: fileItem });
  getKnowledgeItem.mockResolvedValue(fileItem);
  const user = userSetup(); renderHome();
  await user.click(screen.getByRole("button", { name: "Add" }));
  await user.upload(screen.getByLabelText("Choose files"), new File(["proposal"], "proposal.pdf", { type: "application/pdf" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await openCard("proposal.pdf");
  expect(screen.getByRole("button", { name: "Open original" }).getAttribute("href")).toBe("http://localhost:4000/knowledge-items/9/original-file/open");
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

    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.type(screen.getByLabelText("Link"), processingItem.source.submittedUrl);
    await user.click(screen.getByRole("button", { name: "Save link" }));
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

    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.type(screen.getByLabelText("Link"), repeatedCapture.source.submittedUrl);
    await user.click(screen.getByRole("button", { name: "Save link" }));
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

    await user.type(screen.getByLabelText("Search your saves"), "EADDRINUSE");
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByText(/The service reported the error message EADDRINUSE/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open original" }).getAttribute("href")).toBe(processingItem.source.submittedUrl);
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

    await user.type(screen.getByLabelText("Search your saves"), "grounded source");
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByRole("heading", { name: "Trustworthy preview facts" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "A durable knowledge card" }).getAttribute("src")).toBe("/source-preview-media/5");
    expect(screen.getByText("MindVault Journal")).toBeTruthy();
    expect(screen.getByText("Original details")).toBeTruthy();
    expect(screen.getByText("A source-provided description for recognizing this article.")).toBeTruthy();
    expect(screen.getByText(/Ada Lovelace/)).toBeTruthy();
    expect(screen.getByText("Grounded Source text explains why this Knowledge Item matched.")).toBeTruthy();
    expect(screen.getByLabelText("Generated preview").textContent).toContain("Generated context for recognition.");
    expect(screen.getByRole("list", { name: "Tags" }).textContent).toContain("durable capture");
    expect(screen.getByRole("button", { name: "Open original" }).getAttribute("href")).toBe("https://archive.example.com/original-article");
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

    await user.type(screen.getByLabelText("Search your saves"), "grounded source");
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

function matchingItem(item: KnowledgeItem, text: string): RecallKnowledgeItem {
  return { id: item.id, title: null, source: item.source, sourcePreview: item.sourcePreview,
    recognitionSummary: item.recognitionSummary, topicTags: item.topicTags,
    excerpts: [{ text, origin: "source-snapshot", sourceSnapshot: null, ranking: { score: 1 } }],
    ranking: { score: 1, matchedPassageCount: 1 } };
}

test("search replaces the board in relevance order and clearing restores newest-first saves", async () => {
  getKnowledgeItems.mockResolvedValue([readyItem, { ...fileItem, createdAt: "2026-11-01T10:00:00Z" }]);
  searchKnowledgeItems.mockResolvedValue([matchingItem(readyItem, "First relevant match"), matchingItem(fileItem, "Second relevant match")]);
  const user = userSetup(); renderHome();
  await screen.findByRole("button", { name: "View proposal.pdf" });
  await user.type(screen.getByLabelText("Search your saves"), "recovery");
  await user.click(screen.getByRole("button", { name: "Search" }));
  await screen.findByText("First relevant match");
  const board = screen.getByRole("region", { name: "Search results" });
  expect(Array.from(board.querySelectorAll('[id^="knowledge-item-"]')).map(card => card.id)).toEqual(["knowledge-item-1", "knowledge-item-9"]);
  expect(screen.getAllByRole("heading", { name: "proposal.pdf", level: 3 })).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Clear search" }));
  await waitFor(() => expect(screen.queryByText("First relevant match")).toBeNull());
  expect(Array.from(screen.getByRole("region", { name: "Your saves" }).querySelectorAll('[id^="knowledge-item-"]')).map(card => card.id)).toEqual(["knowledge-item-9", "knowledge-item-1"]);
});

test("a newer query wins even if an older search finishes later", async () => {
  getKnowledgeItems.mockResolvedValue([readyItem]);
  let finishOld!: (items: RecallKnowledgeItem[]) => void;
  searchKnowledgeItems.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
    .mockResolvedValueOnce([matchingItem(fileItem, "Newest query evidence")]);
  const user = userSetup(); renderHome();
  const search = screen.getByLabelText("Search your saves");
  await user.type(search, "old{Enter}");
  expect(await screen.findByText("Searching your saves…")).toBeTruthy();
  await user.clear(search); await user.type(search, "new{Enter}");
  await screen.findByText("Newest query evidence");
  await act(async () => finishOld([matchingItem(readyItem, "Old query evidence")]));
  expect(screen.queryByText("Old query evidence")).toBeNull();
  expect(screen.getByText("Newest query evidence")).toBeTruthy();
  expect((search as HTMLInputElement).value).toBe("new");
});

test("failed search has safe copy, retries the current query, and supports clearing no matches", async () => {
  getKnowledgeItems.mockResolvedValue([readyItem]);
  searchKnowledgeItems.mockRejectedValueOnce(new Error("private SQL details" )).mockResolvedValueOnce([]);
  const user = userSetup(); renderHome();
  await user.type(screen.getByLabelText("Search your saves"), "missing{Enter}");
  expect(await screen.findByText("Couldn’t search your saves. Please try again.")).toBeTruthy();
  expect(screen.queryByText("private SQL details")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Try search again" }));
  expect(await screen.findByText("No matches here. Try another idea or clear your filters.")).toBeTruthy();
  expect(searchKnowledgeItems.mock.calls.at(-1)?.[0]).toBe("missing");
  await user.click(screen.getByRole("button", { name: "Clear search" }));
  expect(await screen.findByRole("button", { name: "View example.com" })).toBeTruthy();
});

test("filters loaded results by saved link or file and keeps filters through details and browsing", async () => {
  getKnowledgeItems.mockResolvedValue([readyItem, fileItem]); getKnowledgeItem.mockResolvedValue(fileItem);
  searchKnowledgeItems.mockResolvedValue([matchingItem(readyItem, "Link match"), matchingItem(fileItem, "File match")]);
  const user = userSetup(); renderHome();
  expect(screen.queryByRole("radio", { name: "Files" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Filter" }));
  await user.click(screen.getByRole("radio", { name: "Files" }));
  expect(screen.queryByRole("button", { name: "View example.com" })).toBeNull();
  await user.type(screen.getByLabelText("Search your saves"), "backup{Enter}");
  await screen.findByText("File match");
  expect(screen.queryByText("Link match")).toBeNull();
  expect(screen.getByText(/Filter these search results/)).toBeTruthy();
  await openCard("proposal.pdf");
  expect(window.location.hash).toBe("#item=9");
  await user.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByRole("radio", { name: "Files" }).getAttribute("aria-checked")).toBe("true");
  expect((screen.getByLabelText("Search your saves") as HTMLInputElement).value).toBe("backup");
  await user.click(screen.getByRole("button", { name: "Clear search" }));
  expect(screen.queryByRole("button", { name: "View example.com" })).toBeNull();
  expect(screen.getByRole("button", { name: "View proposal.pdf" })).toBeTruthy();
  await user.click(screen.getByRole("radio", { name: "Links" }));
  expect(screen.getByRole("button", { name: "View example.com" })).toBeTruthy();
});

test("moving a search result to Trash removes it immediately while a replacement search loads", async () => {
  getKnowledgeItems.mockResolvedValue([readyItem, fileItem]); getKnowledgeItem.mockResolvedValue(fileItem);
  searchKnowledgeItems.mockResolvedValueOnce([matchingItem(fileItem, "File to remove"), matchingItem(readyItem, "Keep this match")])
    .mockImplementation(() => new Promise(() => {}));
  trashKnowledgeItem.mockResolvedValue();
  const user = userSetup(); renderHome();
  await user.type(screen.getByLabelText("Search your saves"), "backup{Enter}");
  await screen.findByText("File to remove");
  await openCard("proposal.pdf");
  await user.click(screen.getByRole("button", { name: "Move to Trash" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(Boolean(screen.queryByText("File to remove"))).toBe(false);
  expect(screen.getByText("Keep this match")).toBeTruthy();
  expect((screen.getByLabelText("Search your saves") as HTMLInputElement).value).toBe("backup");
});

test("processing refreshes matching evidence without clearing the query, filter, or open details", async () => {
  getKnowledgeItems.mockResolvedValueOnce([processingItem, fileItem]).mockResolvedValue([readyItem, fileItem]);
  getKnowledgeItem.mockResolvedValue(fileItem);
  searchKnowledgeItems.mockResolvedValueOnce([matchingItem(fileItem, "Earlier matching evidence")]).mockResolvedValue([matchingItem(fileItem, "Updated matching evidence")]);
  const user = userSetup(); renderHome();
  await user.click(screen.getByRole("button", { name: "Filter" }));
  await user.click(screen.getByRole("radio", { name: "Files" }));
  await user.type(screen.getByLabelText("Search your saves"), "backup{Enter}");
  await screen.findByText("Earlier matching evidence");
  await openCard("proposal.pdf");
  await waitFor(() => expect(Boolean(screen.queryByText("Updated matching evidence"))).toBe(true), { timeout: 6500 });
  expect(window.location.hash).toBe("#item=9");
  await user.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(Boolean(screen.queryByRole("dialog"))).toBe(false));
  expect((screen.getByLabelText("Search your saves") as HTMLInputElement).value).toBe("backup");
  expect(screen.getByRole("radio", { name: "Files" }).getAttribute("aria-checked")).toBe("true");
  expect(screen.getByText("Updated matching evidence")).toBeTruthy();
});

test("an already saved link resets hidden search and filters and highlights its existing card", async () => {
  getKnowledgeItems.mockResolvedValue([readyItem, fileItem]);
  searchKnowledgeItems.mockResolvedValue([matchingItem(fileItem, "Only file evidence")]);
  createCapture.mockResolvedValue({ captureId: 2, sourceId: 1, knowledgeItemId: 1, processingAttemptId: null, availability: "ready", organizationCondition: "complete", reused: true, knowledgeItem: readyItem });
  const user = userSetup(); renderHome();
  await user.click(screen.getByRole("button", { name: "Filter" }));
  await user.click(screen.getByRole("radio", { name: "Files" }));
  await user.type(screen.getByLabelText("Search your saves"), "backup{Enter}");
  await screen.findByText("Only file evidence");
  await user.click(screen.getByRole("button", { name: "Add" }));
  await user.type(screen.getByLabelText("Link"), readyItem.source.submittedUrl);
  await user.click(screen.getByRole("button", { name: "Save link" }));
  expect(await screen.findByText("Already saved")).toBeTruthy();
  expect(await screen.findByLabelText("Already saved item")).toBeTruthy();
  expect((screen.getByLabelText("Search your saves") as HTMLInputElement).value).toBe("");
  expect(screen.getByRole("radio", { name: "All saves" }).getAttribute("aria-checked")).toBe("true");
  expect(screen.getAllByRole("button", { name: "View example.com" })).toHaveLength(1);
});

test("Trash disables board shortcuts while Add remains available and search survives return", async () => {
  getKnowledgeItems.mockResolvedValue([readyItem]); getTrashedKnowledgeItems.mockResolvedValue([]);
  searchKnowledgeItems.mockResolvedValue([matchingItem(readyItem, "Keep query evidence")]);
  const user = userSetup(); renderHome();
  await user.type(screen.getByLabelText("Search your saves"), "database{Enter}");
  await screen.findByText("Keep query evidence");
  await openTrash(user);
  expect(screen.getByRole("button", { name: "Add" })).toBeTruthy();
  fireEvent.paste(screen.getByRole("main"), { clipboardData: { getData: () => "https://example.com/another" } });
  expect(createCapture).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Back to saves" }));
  expect((screen.getByLabelText("Search your saves") as HTMLInputElement).value).toBe("database");
  expect(await screen.findByText("Keep query evidence")).toBeTruthy();
});


test("an existing save restored through Add leaves Trash and reveals the active card", async () => {
  const trashed = { ...readyItem, lifecycleState: "trashed" as const, trashedAt: "2026-11-03T10:00:00Z" };
  getKnowledgeItems.mockResolvedValue([]); getTrashedKnowledgeItems.mockResolvedValue([trashed]);
  createCapture.mockResolvedValue({ captureId: 2, sourceId: 1, knowledgeItemId: 1, processingAttemptId: null, availability: "ready", organizationCondition: "complete", reused: true, restoredFromTrash: true, knowledgeItem: readyItem });
  const user = userSetup(); renderHome();
  await openTrash(user);
  await screen.findByRole("button", { name: "View example.com" });
  await user.click(screen.getByRole("button", { name: "Add" }));
  await user.type(screen.getByLabelText("Link"), readyItem.source.submittedUrl);
  await user.click(screen.getByRole("button", { name: "Save link" }));
  await screen.findByLabelText("Already saved item");
  expect(screen.getByRole("region", { name: "Your saves" })).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "View example.com" })).toHaveLength(1);
  expect(screen.getByText("Already saved")).toBeTruthy();
  getTrashedKnowledgeItems.mockResolvedValue([]);
  await openTrash(user);
  expect(await screen.findByText("Trash is empty. Items you move here can be restored.")).toBeTruthy();
});


test("Recall excerpt and provenance clicks open details while PDF links keep their own action", async () => {
  const { RecallResultCard } = await import("@/components/recall-result-card");
  const onOpen = mock<(id: number) => void>();
  const result: RecallKnowledgeItem = {
    id: 7, title: "PDF evidence", source: processingItem.source, sourcePreview: null,
    recognitionSummary: null, topicTags: [], ranking: { score: 1, matchedPassageCount: 1 },
    excerpts: [{ text: "Matching evidence to revisit.", origin: "source-snapshot", pageNumber: 2,
      openOriginalFile: "/knowledge-items/7/original-file#page=2", sourceSnapshot: {
        id: 5, originalUrl: processingItem.source.submittedUrl, finalUrl: processingItem.source.submittedUrl,
        canonicalUrl: null, extractedAt: processingItem.createdAt, evidenceCoverage: "primary-content",
      }, ranking: { score: 1 } }],
  };
  const view = render(<RecallResultCard result={result} onOpen={onOpen} />);
  const user = userEvent.setup({ document: globalThis.document });
  const link = view.getByRole("button", { name: "Open PDF at page 2" });
  link.addEventListener("click", event => event.preventDefault(), { once: true });
  await user.click(link);
  expect(onOpen).not.toHaveBeenCalled();
  await user.click(view.getByText("Matching evidence to revisit."));
  expect(onOpen).toHaveBeenLastCalledWith(7);
  await user.click(view.getByText("Saved text"));
  expect(onOpen).toHaveBeenCalledTimes(2);
  await user.click(view.getByRole("button", { name: "View PDF evidence" }));
  expect(onOpen).toHaveBeenCalledTimes(3);
});

test("card keyboard actions remove without opening details and Undo restores that save", async () => {
  getKnowledgeItems.mockResolvedValue([readyItem]);
  trashKnowledgeItem.mockResolvedValue();
  restoreKnowledgeItem.mockResolvedValue({ knowledgeItem: readyItem });
  const user = userSetup(); renderHome();
  await screen.findByRole("button", { name: "View example.com" });
  const remove = screen.getByRole("button", { name: "Move example.com to Trash" });
  remove.focus(); await user.keyboard("{Enter}");
  expect(await screen.findByText("Moved “example.com” to Trash.")).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("button", { name: "View example.com" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Undo removal of example.com" }));
  expect(await screen.findByRole("button", { name: "View example.com" })).toBeTruthy();
  expect(restoreKnowledgeItem.mock.calls[0]?.[0]).toBe(1);
});

async function openTrash(user: ReturnType<typeof userSetup>) {
  await user.click(screen.getByRole("button", { name: "Board menu" }));
  await user.click(await screen.findByRole("menuitem", { name: "View Trash" }));
}

test("the card menu exposes original and removal actions for touch without opening details", async () => {
  getKnowledgeItems.mockResolvedValue([fileItem]); trashKnowledgeItem.mockResolvedValue();
  const user = userSetup(); renderHome();
  await user.click(await screen.findByRole("button", { name: "Actions for proposal.pdf" }));
  const original = await screen.findByRole("menuitem", { name: "Open original" });
  expect(original.getAttribute("href")).toBe("http://localhost:4000/knowledge-items/9/original-file/open");
  await user.click(screen.getByRole("menuitem", { name: "Move to Trash" }));
  await screen.findByText("Moved “proposal.pdf” to Trash.");
  expect(trashKnowledgeItem.mock.calls[0]?.[0]).toBe(9);
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("independent removals finish out of order and failed Undo retries the correct item", async () => {
  getKnowledgeItems.mockResolvedValue([readyItem, fileItem]);
  let finishFirst!: () => void;
  trashKnowledgeItem.mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; })).mockResolvedValueOnce();
  restoreKnowledgeItem.mockRejectedValueOnce(new Error("private storage error")).mockResolvedValueOnce({ knowledgeItem: fileItem });
  const user = userSetup(); renderHome();
  await user.click(await screen.findByRole("button", { name: "Move example.com to Trash" }));
  await user.click(screen.getByRole("button", { name: "Move proposal.pdf to Trash" }));
  await screen.findByRole("button", { name: "Undo removal of proposal.pdf" });
  await act(async () => finishFirst());
  expect(await screen.findByRole("button", { name: "Undo removal of example.com" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Undo removal of proposal.pdf" }));
  expect(await screen.findByText("Couldn’t restore “proposal.pdf”. Please try again.")).toBeTruthy();
  expect(screen.queryByText("private storage error")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Try restore again for proposal.pdf" }));
  expect(await screen.findByRole("button", { name: "View proposal.pdf" })).toBeTruthy();
  expect(restoreKnowledgeItem.mock.calls.map(call => call[0])).toEqual([9, 9]);
  expect(screen.queryByRole("button", { name: "View example.com" })).toBeNull();
  expect(screen.getByRole("button", { name: "Undo removal of example.com" })).toBeTruthy();
});

test("a failed removal stays in details with safe recovery and a successful retry returns focus to the board", async () => {
  getKnowledgeItems.mockResolvedValue([readyItem]); getKnowledgeItem.mockResolvedValue(readyItem);
  trashKnowledgeItem.mockRejectedValueOnce(new Error("private SQL error")).mockResolvedValueOnce();
  const user = userSetup(); renderHome(); await openCard();
  await user.click(screen.getByRole("button", { name: "Move to Trash" }));
  await waitFor(() => expect(screen.getByRole("dialog").textContent).toContain("Couldn’t move this save to Trash. Please try again."));
  expect(screen.queryByText("private SQL error")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Move to Trash" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Your saves" })));
  expect(screen.queryByRole("button", { name: "View example.com" })).toBeNull();
});

test("permanent deletion is confirmed, retains pending feedback, and exposes cleanup failure for retry", async () => {
  const trashed: KnowledgeItem = { ...fileItem, lifecycleState: "trashed", trashedAt: "2026-11-03T10:00:00Z" };
  const pending: KnowledgeItem = { ...trashed, lifecycleState: "pending-permanent-deletion", deletion: { status: "pending", failureReason: null } };
  getKnowledgeItems.mockResolvedValue([]); getTrashedKnowledgeItems.mockResolvedValue([trashed]);
  permanentlyDeleteKnowledgeItem.mockImplementationOnce(async () => { getTrashedKnowledgeItems.mockResolvedValue([pending]); return { deletionPending: true }; });
  const user = userSetup(); renderHome(); await openTrash(user); await openCard("proposal.pdf");
  await user.click(screen.getByRole("button", { name: "Delete permanently" }));
  const confirmation = await screen.findByRole("alertdialog");
  expect(permanentlyDeleteKnowledgeItem).not.toHaveBeenCalled();
  await user.click(within(confirmation).getByRole("button", { name: "Delete permanently" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(await screen.findByText("Deleting permanently…")).toBeTruthy();
  expect(permanentlyDeleteKnowledgeItem.mock.calls[0]?.[0]).toBe(9);
  getTrashedKnowledgeItems.mockResolvedValue([{ ...pending, deletion: { status: "failed", failureReason: "private storage credentials" } }]);
  expect(await screen.findByText("Deletion didn’t finish. Open details to retry.", {}, { timeout: 4500 })).toBeTruthy();
  await openCard("proposal.pdf");
  expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
  expect(screen.queryByText("private storage credentials")).toBeNull();
  permanentlyDeleteKnowledgeItem.mockResolvedValueOnce(undefined);
  getTrashedKnowledgeItems.mockResolvedValue([]);
  await user.click(screen.getByRole("button", { name: "Retry deletion" }));
  const retry = await screen.findByRole("alertdialog");
  await user.click(within(retry).getByRole("button", { name: "Delete permanently" }));
  expect(await screen.findByText("Trash is empty. Items you move here can be restored.")).toBeTruthy();
});

test("Trash restore and deletion request failures keep the save recoverable", async () => {
  const trashed: KnowledgeItem = { ...fileItem, lifecycleState: "trashed", trashedAt: "2026-11-03T10:00:00Z" };
  getKnowledgeItems.mockResolvedValue([]); getTrashedKnowledgeItems.mockResolvedValue([trashed]);
  restoreKnowledgeItem.mockRejectedValueOnce(new Error("private restore error"));
  permanentlyDeleteKnowledgeItem.mockRejectedValueOnce(new Error("private delete error"));
  const user = userSetup(); renderHome(); await openTrash(user); await openCard("proposal.pdf");
  await user.click(screen.getByRole("button", { name: "Restore" }));
  await waitFor(() => expect(screen.getByRole("dialog").textContent).toContain("Couldn’t restore this save. Please try again."));
  await user.click(screen.getByRole("button", { name: "Delete permanently" }));
  const confirm = await screen.findByRole("alertdialog");
  await user.click(within(confirm).getByRole("button", { name: "Delete permanently" }));
  await waitFor(() => expect(screen.getByRole("dialog").textContent).toContain("Couldn’t delete this save. Please try again."));
  expect(screen.queryByText(/private (restore|delete) error/)).toBeNull();
  restoreKnowledgeItem.mockResolvedValue({ knowledgeItem: fileItem }); getTrashedKnowledgeItems.mockResolvedValue([]); getKnowledgeItems.mockResolvedValue([fileItem]);
  await user.click(screen.getByRole("button", { name: "Restore" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await user.click(screen.getByRole("button", { name: "Back to saves" }));
  expect(await screen.findByRole("button", { name: "View proposal.pdf" })).toBeTruthy();
});

test("failed Trash browsing has safe recovery without losing the board", async () => {
  getKnowledgeItems.mockResolvedValue([readyItem]);
  getTrashedKnowledgeItems.mockRejectedValueOnce(new Error("private database error")).mockResolvedValueOnce([]);
  const user = userSetup(); renderHome(); await openTrash(user);
  expect(await screen.findByText("Couldn’t load Trash. Please try again.")).toBeTruthy();
  expect(screen.queryByText("private database error")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Try loading Trash again" }));
  expect(await screen.findByText("Trash is empty. Items you move here can be restored.")).toBeTruthy();
});

test("new search responses cannot reintroduce a removed save or its stale details", async () => {
  getKnowledgeItems.mockResolvedValue([readyItem]); trashKnowledgeItem.mockResolvedValue();
  searchKnowledgeItems.mockResolvedValue([matchingItem(readyItem, "Stale matching evidence")]);
  const user = userSetup(); renderHome();
  await user.click(await screen.findByRole("button", { name: "Move example.com to Trash" }));
  await screen.findByRole("button", { name: "Undo removal of example.com" });
  await user.type(screen.getByLabelText("Search your saves"), "database{Enter}");
  await waitFor(() => expect(searchKnowledgeItems).toHaveBeenCalled());
  expect(screen.queryByText("Stale matching evidence")).toBeNull();
  await act(async () => { window.history.pushState(null, "", "#item=1"); window.dispatchEvent(new dom.window.PopStateEvent("popstate")); });
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("removal clears earlier answers and ignores in-flight answers based on removed knowledge", async () => {
  getKnowledgeItems.mockResolvedValue([readyItem]); trashKnowledgeItem.mockResolvedValue();
  const answer: SynthesisResult = { answer: "Earlier saved evidence.", insufficientEvidence: false, citations: [] };
  let finishAnswer!: (result: SynthesisResult) => void;
  askVault.mockResolvedValueOnce(answer).mockImplementationOnce(() => new Promise(resolve => { finishAnswer = resolve; })).mockResolvedValueOnce({ ...answer, answer: "Fresh answer." });
  const user = userSetup(); renderHome();
  await user.click(screen.getByRole("button", { name: "Ask" }));
  const input = screen.getByLabelText("Ask a question about your saves");
  await user.type(input, "first question"); await user.click(screen.getByRole("button", { name: "Ask your vault" }));
  await screen.findByText(answer.answer);
  await user.type(input, "follow up"); await user.click(screen.getByRole("button", { name: "Ask your vault" }));
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "Move example.com to Trash" }));
  await screen.findByRole("button", { name: "Undo removal of example.com" });
  await user.click(screen.getByRole("button", { name: "Ask" }));
  expect(screen.queryByText(answer.answer)).toBeNull();
  await act(async () => finishAnswer({ ...answer, answer: "Late stale answer." }));
  expect(screen.queryByText("Late stale answer.")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Ask your vault" }));
  await screen.findByText("Fresh answer.");
  expect(askVault.mock.calls.at(-1)?.[0].conversation).toEqual([]);
});

test("removing a search result while the library first loads resumes a complete board", async () => {
  getKnowledgeItems.mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue([fileItem]);
  searchKnowledgeItems.mockResolvedValueOnce([matchingItem(readyItem, "Remove this match")]).mockResolvedValue([]);
  trashKnowledgeItem.mockResolvedValue();
  const user = userSetup(); renderHome();
  await user.type(screen.getByLabelText("Search your saves"), "database{Enter}");
  await screen.findByText("Remove this match");
  await user.click(screen.getByRole("button", { name: "Move example.com to Trash" }));
  await screen.findByRole("button", { name: "Undo removal of example.com" });
  await user.click(screen.getByRole("button", { name: "Clear search" }));
  expect(await screen.findByRole("button", { name: "View proposal.pdf" })).toBeTruthy();
  expect(screen.queryByText("Loading your saves…")).toBeNull();
});

test("Ask opens only on request, closes by keyboard or touch, and preserves search and draft", async () => {
  getKnowledgeItems.mockResolvedValue([readyItem]);
  searchKnowledgeItems.mockResolvedValue([]);
  const user = userSetup(); renderHome();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(Boolean(screen.queryByLabelText("Ask a question about your saves"))).toBe(false);
  await user.type(screen.getByLabelText("Search your saves"), "replication{Enter}");
  await screen.findByText(/No matches here/);
  expect(askVault).not.toHaveBeenCalled();
  const ask = screen.getByRole("button", { name: "Ask" });
  ask.focus(); await user.keyboard("{Enter}");
  const panel = await screen.findByRole("dialog", { name: "Ask your vault" });
  await user.type(within(panel).getByRole("textbox"), "Unfinished question");
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(ask));
  expect((screen.getByLabelText("Search your saves") as HTMLInputElement).value).toBe("replication");
  await user.click(ask);
  expect((await screen.findByRole("textbox", { name: "Ask a question about your saves" }) as HTMLTextAreaElement).value).toBe("Unfinished question");
  await user.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(askVault).not.toHaveBeenCalled();
});

test("Ask keeps pending requests across closing, offers retry after failure, and explains insufficient evidence", async () => {
  getKnowledgeItems.mockResolvedValue([]);
  let rejectAnswer!: (error: Error) => void;
  askVault.mockImplementationOnce(() => new Promise((_, reject) => { rejectAnswer = reject; }))
    .mockResolvedValueOnce({ answer: "Your saves do not explain this topic.", insufficientEvidence: true, citations: [] });
  const user = userSetup(); renderHome();
  await user.click(screen.getByRole("button", { name: "Ask" }));
  await user.type(screen.getByRole("textbox"), "How does this work?");
  await user.click(screen.getByRole("button", { name: "Ask your vault" }));
  expect(screen.getByRole("status").textContent).toContain("Finding relevant saved information");
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(true);
  await user.keyboard("{Escape}");
  await waitFor(() => expect(Boolean(screen.queryByRole("dialog"))).toBe(false));
  await user.click(screen.getByRole("button", { name: "Ask" }));
  expect((screen.getByRole("button", { name: "Finding evidence…" }) as HTMLButtonElement).disabled).toBe(true);
  expect(askVault).toHaveBeenCalledTimes(1);
  await act(async () => rejectAnswer(new Error("private model diagnostic")));
  expect((await screen.findByRole("alert")).textContent).toContain("Answer generation is temporarily unavailable. Please try again.");
  expect(Boolean(screen.queryByText("private model diagnostic"))).toBe(false);
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("How does this work?");
  await user.click(screen.getByRole("button", { name: "Ask your vault" }));
  expect(await screen.findByText("Your saves do not explain this topic.")).toBeTruthy();
  expect(screen.getByText(/There isn’t enough evidence in your saves/)).toBeTruthy();
  expect(Boolean(screen.queryByRole("region", { name: "Supporting saves" }))).toBe(false);
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "Ask" }));
  expect(await screen.findByText("Your saves do not explain this topic.")).toBeTruthy();
});

test("a citation outside filtered board results opens details and returns to the conversation and search", async () => {
  getKnowledgeItems.mockResolvedValue([readyItem]);
  searchKnowledgeItems.mockResolvedValue([]);
  getKnowledgeItem.mockResolvedValue(fileItem);
  askVault.mockResolvedValueOnce({ answer: "The proposal recommends durable storage.", insufficientEvidence: false, citations: [{
    knowledgeItemId: 9, sourceSnapshotId: 4, title: "proposal.pdf", origin: "source-snapshot", originalUrl: null,
    evidenceCoverage: "primary-content", excerpt: "Retain the original document.", pageNumber: 2, pageLabel: "1",
    openOriginalFile: "/knowledge-items/9/original-file/open?page=2",
    extractionCoverage: { pageCount: 3, pages: [{ pageNumber: 3, outcome: "unprocessed", reason: "OCR work limit reached" }] },
  }] });
  const user = userSetup(); renderHome();
  await user.type(screen.getByLabelText("Search your saves"), "unrelated{Enter}");
  await screen.findByText(/No matches here/);
  await user.click(screen.getByRole("button", { name: "Ask" }));
  await user.type(screen.getByRole("textbox"), "What does the proposal recommend?");
  await user.click(screen.getByRole("button", { name: "Ask your vault" }));
  const citation = await screen.findByRole("button", { name: "View proposal.pdf" });
  const conversation = screen.getByRole("region", { name: "Current conversation" });
  conversation.parentElement!.scrollTop = 180;
  expect(screen.getByRole("button", { name: "Open PDF at page 2" }).getAttribute("href")).toBe("http://localhost:4000/knowledge-items/9/original-file/open?page=2");
  expect(screen.getByText(/printed label: 1/)).toBeTruthy();
  expect(screen.getByText(/Incomplete extraction: page 3/)).toBeTruthy();
  citation.focus(); await user.keyboard("{Enter}");
  const details = await screen.findByRole("dialog", { name: "proposal.pdf" });
  expect(getKnowledgeItem).toHaveBeenCalledWith(9);
  expect(within(details).getByRole("button", { name: "Open original" }).getAttribute("href")).toBe("http://localhost:4000/knowledge-items/9/original-file/open");
  await user.keyboard("{Escape}");
  await waitFor(() => expect(Boolean(screen.queryByRole("dialog", { name: "proposal.pdf" }))).toBe(false));
  expect(screen.getByRole("dialog", { name: "Ask your vault" })).toBeTruthy();
  await waitFor(() => expect(document.activeElement === citation).toBe(true));
  expect(conversation.parentElement!.scrollTop).toBe(180);
  await user.click(citation);
  await screen.findByRole("dialog", { name: "proposal.pdf" });
  await act(async () => window.history.back());
  await waitFor(() => expect(Boolean(screen.queryByRole("dialog", { name: "proposal.pdf" }))).toBe(false));
  expect(screen.getByText("The proposal recommends durable storage.")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(Boolean(screen.queryByRole("dialog"))).toBe(false));
  expect((screen.getByLabelText("Search your saves") as HTMLInputElement).value).toBe("unrelated");
  expect(screen.getByText(/No matches here/)).toBeTruthy();
});

test("board loading failures use safe everyday copy and recover without reloading the page", async () => {
  getKnowledgeItems.mockRejectedValueOnce(new Error("SQL connection diagnostic"));
  const user = userSetup(); renderHome();
  expect(await screen.findByText("Couldn’t load your saves. Please try again.")).toBeTruthy();
  expect(screen.queryByText(/SQL connection diagnostic/)).toBeNull();
  getKnowledgeItems.mockResolvedValue([readyItem]);
  await user.click(screen.getByRole("button", { name: "Try loading saves again" }));
  expect(await screen.findByRole("button", { name: "View example.com" })).toBeTruthy();
});

test("a failed refresh stays inside its own details and never leaks onto another save or the board", async () => {
  getKnowledgeItems.mockResolvedValue([readyItem, fileItem]);
  getKnowledgeItem.mockImplementation(async id => id === 9 ? fileItem : readyItem);
  refreshKnowledgeItem.mockRejectedValueOnce(new Error("Internal processing diagnostic"));
  const user = userSetup(); renderHome(); await openCard();
  await user.click(screen.getByRole("button", { name: "Refresh" }));
  expect(await within(screen.getByRole("dialog")).findByText("Couldn’t update this save. Please try again.")).toBeTruthy();
  expect(screen.queryByText(/Internal processing diagnostic/)).toBeNull();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.queryByText("Couldn’t update this save. Please try again.")).toBeNull();
  await openCard("proposal.pdf");
  expect(screen.queryByText("Couldn’t update this save. Please try again.")).toBeNull();
});

test("partial batch saves remain accessible across unavailable search and Ask, and retry submits only the failed file", async () => {
  const second = { ...fileItem, id: 10, source: { ...fileItem.source, id: 10, filename: "second.pdf" } };
  const response = (knowledgeItem: KnowledgeItem): CaptureResponse => ({ captureId: knowledgeItem.id, sourceId: knowledgeItem.source.id,
    knowledgeItemId: knowledgeItem.id, processingAttemptId: null, availability: "ready", organizationCondition: "complete", knowledgeItem });
  getKnowledgeItems.mockResolvedValue([]);
  createOriginalFileCapture.mockResolvedValueOnce(response(fileItem)).mockRejectedValueOnce(new Error("Storage diagnostic")).mockResolvedValueOnce(response(second));
  searchKnowledgeItems.mockRejectedValue(new Error("Search diagnostic"));
  askVault.mockRejectedValue(new Error("Model diagnostic"));
  getKnowledgeItem.mockResolvedValue(fileItem);
  const user = userSetup(); renderHome();
  await screen.findByText(/Your vault is empty/);
  const firstFile = new File(["first"], "proposal.pdf", { type: "application/pdf" });
  const secondFile = new File(["second"], "second.pdf", { type: "application/pdf" });
  fireEvent.drop(document.body, { dataTransfer: { files: [firstFile, secondFile], types: ["Files"] } });
  expect(await screen.findByRole("button", { name: "View proposal.pdf" })).toBeTruthy();
  const retry = await screen.findByRole("button", { name: "Retry second.pdf" });
  await user.type(screen.getByLabelText("Search your saves"), "recovery{Enter}");
  await screen.findByText("Couldn’t search your saves. Please try again.");
  await user.click(screen.getByRole("button", { name: /^Ask$/ }));
  await user.type(screen.getByRole("textbox"), "How do I recover?");
  await user.click(screen.getByRole("button", { name: "Ask your vault" }));
  await screen.findByText("Answer generation is temporarily unavailable. Please try again.");
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await user.click(screen.getByRole("button", { name: "Clear search" }));
  await user.click(retry);
  expect(await screen.findByRole("button", { name: "View second.pdf" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "View proposal.pdf" })).toBeTruthy();
  expect(createOriginalFileCapture.mock.calls.map(call => call[0].file)).toEqual([firstFile, secondFile, secondFile]);
  await openCard("proposal.pdf");
  expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Open original" }).getAttribute("href")).toContain("/knowledge-items/9/original-file/open");
  expect(screen.queryByText(/Storage diagnostic|Search diagnostic|Model diagnostic/)).toBeNull();
});


test("renames a save in details, keeps the draft after errors, and resets its board title", async () => {
  const item = { ...processingItem, availability: "ready" as const, organizationCondition: "complete" as const, latestAttempt: null, title: "Source title", customTitle: null };
  getKnowledgeItems.mockResolvedValue([item]);
  getKnowledgeItem.mockResolvedValue(item);
  const renamed = { ...item, title: "My title", customTitle: "My title" };
  updateKnowledgeItemTitle.mockRejectedValueOnce(new Error("offline"));
  updateKnowledgeItemTitle.mockResolvedValueOnce(renamed).mockResolvedValueOnce(item);
  const user = userEvent.setup({ document: dom.window.document });
  renderHome();
  await user.click(await screen.findByRole("button", { name: "View Source title" }));
  const dialog = await screen.findByRole("dialog", { name: "Source title" });
  await user.click(within(dialog).getByRole("button", { name: "Edit title" }));
  const input = within(dialog).getByRole("textbox", { name: "Title" });
  await user.clear(input);
  await user.type(input, "   ");
  await user.click(within(dialog).getByRole("button", { name: "Save title" }));
  expect(updateKnowledgeItemTitle).not.toHaveBeenCalled();
  expect(within(dialog).getByRole("alert").textContent).toContain("1–500");
  await user.clear(input);
  await user.type(input, "My title");
  await user.click(within(dialog).getByRole("button", { name: "Save title" }));
  await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toContain("try again"));
  expect((input as HTMLInputElement).value).toBe("My title");
  await user.click(within(dialog).getByRole("button", { name: "Save title" }));
  await screen.findByRole("dialog", { name: "My title" });
  expect(screen.getAllByText("My title").some(node => node.tagName === "H3")).toBe(true);
  expect(screen.getByText("Title saved.")).toBeTruthy();
  await user.click(within(dialog).getByRole("button", { name: "Reset to source title" }));
  await screen.findByRole("dialog", { name: "Source title" });
  expect(updateKnowledgeItemTitle).toHaveBeenLastCalledWith(item.id, null);
  expect(screen.getAllByText("Source title").some(node => node.tagName === "H3")).toBe(true);
});


test("title edits update Recall cards and existing citation labels without changing excerpts", async () => {
  const item: KnowledgeItem = { ...readyItem, title: "Original title", customTitle: null };
  const renamed = { ...item, title: "My reference", customTitle: "My reference" };
  getKnowledgeItems.mockResolvedValue([item]);
  getKnowledgeItem.mockResolvedValue(item);
  searchKnowledgeItems.mockResolvedValue([{ ...matchingItem(item, "Source evidence stays intact."), title: "Original title" }]);
  askVault.mockResolvedValue({ answer: "Grounded answer.", insufficientEvidence: false, citations: [{ knowledgeItemId: item.id, sourceSnapshotId: 1, title: "Original title", origin: "source-snapshot", originalUrl: item.source.submittedUrl, evidenceCoverage: "primary-content", excerpt: "Source evidence stays intact." }] });
  updateKnowledgeItemTitle.mockImplementation(async () => {
    getKnowledgeItems.mockResolvedValue([renamed]);
    getKnowledgeItem.mockResolvedValue(renamed);
    searchKnowledgeItems.mockResolvedValue([{ ...matchingItem(item, "Source evidence stays intact."), title: "My reference" }]);
    return renamed;
  });
  const user = userSetup(); renderHome();
  await user.type(screen.getByLabelText("Search your saves"), "evidence{Enter}");
  await screen.findByText("Source evidence stays intact.");
  await user.click(screen.getByRole("button", { name: "Ask" }));
  await user.type(screen.getByLabelText("Ask a question about your saves"), "What does it say?");
  await user.click(screen.getByRole("button", { name: "Ask your vault" }));
  await user.click(await screen.findByRole("button", { name: "View Original title" }));
  const dialog = await screen.findByRole("dialog", { name: "Original title" });
  await user.click(within(dialog).getByRole("button", { name: "Edit title" }));
  const input = within(dialog).getByRole("textbox", { name: "Title" });
  await user.clear(input); await user.type(input, "My reference");
  await user.click(within(dialog).getByRole("button", { name: "Save title" }));
  await screen.findByRole("dialog", { name: "My reference" });
  await user.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(await screen.findByRole("button", { name: "View My reference" })).toBeTruthy();
  expect(screen.getAllByText("Source evidence stays intact.").length).toBeGreaterThan(0);
  await user.click(screen.getByRole("button", { name: "Close" }));
  expect(await screen.findByRole("heading", { name: "My reference", level: 3 })).toBeTruthy();
  expect(screen.getAllByText("Source evidence stays intact.").length).toBeGreaterThan(0);
});
