import { JSDOM } from "jsdom";
import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import type { CaptureResponse, KnowledgeItem } from "@/lib/types";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
  requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(callback, 0),
  cancelAnimationFrame: (id: number) => clearTimeout(id), IS_REACT_ACT_ENVIRONMENT: true,
});
const { act, cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { default: userEvent } = await import("@testing-library/user-event");
const createCapture = mock<(input: { url: string }) => Promise<CaptureResponse>>();
const createOriginalFileCapture = mock<(input: { file: File }) => Promise<CaptureResponse>>();
mock.module("@/lib/api", () => ({ createCapture, createOriginalFileCapture }));
const { UniversalCaptureArea } = await import("@/components/universal-capture-area");
const item: KnowledgeItem = {
  id: 8, createdAt: "2026-11-03T10:00:00Z", lifecycleState: "active", trashedAt: null,
  source: { id: 8, submittedUrl: "https://example.com/story", normalizedUrl: "https://example.com/story", kind: "web" },
  sourcePreview: null, evidenceCoverage: null, captureContexts: [], availability: "processing",
  organizationCondition: "processing", recognitionSummary: null, topicTags: [], latestAttempt: null,
};
function response(overrides: Partial<CaptureResponse> = {}): CaptureResponse {
  return { captureId: 2, sourceId: 8, knowledgeItemId: 8, processingAttemptId: 3,
    availability: "processing", organizationCondition: "processing", knowledgeItem: item, ...overrides };
}
function setup(disabled = false) {
  const onSaved = mock<(item: KnowledgeItem) => void>();
  const onDuplicate = mock<(item: KnowledgeItem) => void>();
  const view = render(<UniversalCaptureArea onSaved={onSaved} onDuplicate={onDuplicate} disabled={disabled}>
    <div data-testid="board" tabIndex={0}>Board<input aria-label="Search" /><textarea aria-label="Note" /><div contentEditable role="textbox" aria-label="Editable" /></div>
  </UniversalCaptureArea>);
  return { ...view, onSaved, onDuplicate, user: userEvent.setup({ document: globalThis.document }) };
}
beforeEach(() => { createCapture.mockReset(); createOriginalFileCapture.mockReset(); });
afterEach(cleanup);

test("capture shortcuts are discoverable before Add and file support is explained before choosing files", async () => {
  const view = setup();
  expect(view.getByText("Paste a link or drop files")).toBeTruthy();
  await view.user.click(view.getByRole("button", { name: "Add" }));
  const support = view.getByText(/Text PDFs and scanned PDFs with printed English text can be searched/);
  expect(support.textContent).toContain("Other files are retained for opening or downloading");
  expect(support.textContent).toContain("understanding their contents is not available yet");
  expect(support.textContent).toContain("Executables and archives aren’t accepted");
  expect(view.getByLabelText("Choose files").getAttribute("aria-describedby")).toBe(support.id);
});

test("Add saves a link without metadata and reports Saved only after durable success", async () => {
  let finish!: (value: CaptureResponse) => void;
  createCapture.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = setup();
  await view.user.click(view.getByRole("button", { name: "Add" }));
  expect(view.getByRole("dialog")).toBeTruthy();
  expect(view.getByLabelText("Choose files")).toBeTruthy();
  await view.user.type(view.getByLabelText("Link"), "https://example.com/story");
  await view.user.click(view.getByRole("button", { name: "Save link" }));
  expect(view.getByText(/Saving link/)).toBeTruthy();
  expect(view.onSaved).not.toHaveBeenCalled();
  expect(view.queryByText(/^Saved/)).toBeNull();
  await act(async () => finish(response()));
  expect(await view.findByText(/^Saved/)).toBeTruthy();
  expect(view.onSaved).toHaveBeenCalledWith(item);
  expect(createCapture).toHaveBeenCalledWith({ url: "https://example.com/story" });
});

function paste(target: Element, text: string) {
  return fireEvent.paste(target, { clipboardData: { getData: () => text, files: [] } });
}

test("board paste saves a supported link immediately and protects editable controls", async () => {
  createCapture.mockResolvedValue(response());
  const view = setup();
  for (const label of ["Search", "Note", "Editable"]) {
    const input = view.getByLabelText(label);
    expect(paste(input, "https://example.com/story")).toBe(true);
  }
  expect(createCapture).not.toHaveBeenCalled();
  expect(paste(view.getByTestId("board"), "https://example.com/story")).toBe(false);
  await waitFor(() => expect(view.onSaved).toHaveBeenCalledWith(item));
});

test("unsupported board input offers everyday guidance without submitting", async () => {
  const view = setup();
  paste(view.getByTestId("board"), "just a note");
  expect(await view.findByText(/Paste a public link starting with https/)).toBeTruthy();
  expect(createCapture).not.toHaveBeenCalled();
});

test("recognized URL captures preserve API semantics and reveal the existing item", async () => {
  createCapture.mockResolvedValue(response({ reused: true, restoredFromTrash: true }));
  const view = setup();
  paste(view.getByTestId("board"), "https://example.com/story");
  expect(await view.findByText(/Already saved/)).toBeTruthy();
  await waitFor(() => expect(view.onDuplicate).toHaveBeenCalledWith(item));
  expect(view.onSaved).toHaveBeenCalledWith(item);
  expect(createCapture).toHaveBeenCalledWith({ url: "https://example.com/story" });
});

function fileDrag(files: File[]) {
  return { dataTransfer: { types: ["Files"], files, dropEffect: "none" } };
}

test("whole-board external file drag shows an overlay, survives child transitions, and clears on leave or drop", async () => {
  createOriginalFileCapture.mockResolvedValue(response());
  const view = setup();
  const board = view.getByTestId("board");
  const drag = fileDrag([new File(["one"], "one.pdf")]);
  fireEvent.dragEnter(board, drag);
  expect(view.getByText("Drop files to save")).toBeTruthy();
  fireEvent.dragEnter(view.getByLabelText("Search"), drag);
  fireEvent.dragLeave(view.getByLabelText("Search"), drag);
  expect(view.getByText("Drop files to save")).toBeTruthy();
  fireEvent.dragLeave(board, drag);
  expect(view.queryByText("Drop files to save")).toBeNull();
  fireEvent.dragEnter(board, drag);
  fireEvent.drop(board, drag);
  expect(view.queryByText("Drop files to save")).toBeNull();
  await waitFor(() => expect(view.onSaved).toHaveBeenCalled());
});

test("mixed file batches retain successful saves and retry only failures with the original file", async () => {
  const good = new File(["good"], "good.pdf");
  const bad = new File(["bad"], "bad.pdf");
  createOriginalFileCapture.mockResolvedValueOnce(response()).mockRejectedValueOnce(new Error("Cloudinary rejected API_KEY configuration"));
  const view = setup();
  fireEvent.drop(view.getByTestId("board"), fileDrag([good, bad]));
  expect(await view.findByText(/Saved.*good.pdf/)).toBeTruthy();
  expect(await view.findByText(/Couldn’t save bad.pdf/)).toBeTruthy();
  expect(view.queryByText(/Cloudinary|API_KEY/)).toBeNull();
  expect(view.onSaved).toHaveBeenCalledTimes(1);
  let finish!: (value: CaptureResponse) => void;
  createOriginalFileCapture.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const retry = view.getByRole("button", { name: "Retry bad.pdf" });
  fireEvent.click(retry);
  fireEvent.click(retry);
  expect(createOriginalFileCapture).toHaveBeenCalledTimes(3);
  expect(createOriginalFileCapture.mock.calls[2]?.[0].file).toBe(bad);
  await act(async () => finish(response({ knowledgeItem: { ...item, id: 9, availability: "unsupported" } })));
  expect(await view.findByText(/Saved.*bad.pdf/)).toBeTruthy();
  expect(view.onSaved).toHaveBeenCalledTimes(2);
  expect(view.queryByRole("button", { name: "Retry bad.pdf" })).toBeNull();
});

test("file picker saves multiple files independently without requiring another form", async () => {
  createOriginalFileCapture.mockResolvedValue(response());
  const view = setup();
  await view.user.click(view.getByRole("button", { name: "Add" }));
  const files = [new File(["1"], "first.txt", { type: "text/plain" }), new File(["2"], "second.txt", { type: "text/plain" })];
  fireEvent.change(view.getByLabelText("Choose files"), { target: { files } });
  await waitFor(() => expect(view.onSaved).toHaveBeenCalledTimes(2));
  expect(createOriginalFileCapture.mock.calls.map(call => call[0].file)).toEqual(files);
});

test("paste works with page focus, ignores an open dialog, and disables shortcuts in Trash", async () => {
  createCapture.mockResolvedValue(response());
  const view = setup();
  paste(document.body, "https://example.com/story");
  await waitFor(() => expect(view.onSaved).toHaveBeenCalledTimes(1));
  await view.user.click(view.getByRole("button", { name: "Add" }));
  paste(document.body, "https://example.com/other");
  expect(createCapture).toHaveBeenCalledTimes(1);
  view.unmount();
  const trash = setup(true);
  paste(trash.getByTestId("board"), "https://example.com/other");
  fireEvent.dragEnter(trash.getByTestId("board"), fileDrag([new File(["1"], "one.pdf")]));
  fireEvent.drop(trash.getByTestId("board"), fileDrag([new File(["1"], "one.pdf")]));
  expect(createCapture).toHaveBeenCalledTimes(1);
  expect(createOriginalFileCapture).not.toHaveBeenCalled();
  expect(trash.queryByText("Drop files to save")).toBeNull();
  expect(trash.queryByText("Paste a link or drop files")).toBeNull();
  await trash.user.click(trash.getByRole("button", { name: "Add" }));
  expect(trash.getByRole("dialog")).toBeTruthy();
  expect(trash.queryByText(/You can also paste a link or drop files/)).toBeNull();
});

test("pending files and links cannot be resubmitted, and cancelled drags clear the overlay", async () => {
  let finish!: (value: CaptureResponse) => void;
  createOriginalFileCapture.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = setup();
  const file = new File(["one"], "one.pdf");
  fireEvent.dragEnter(view.getByTestId("board"), fileDrag([file]));
  fireEvent.dragEnd(window);
  expect(view.queryByText("Drop files to save")).toBeNull();
  fireEvent.drop(view.getByTestId("board"), fileDrag([file, file]));
  fireEvent.drop(view.getByTestId("board"), fileDrag([file]));
  expect(createOriginalFileCapture).toHaveBeenCalledTimes(1);
  expect(view.getByText(/Uploading one.pdf/)).toBeTruthy();
  expect(view.onSaved).not.toHaveBeenCalled();
  await act(async () => finish(response()));
  expect(await view.findByText(/Saved.*one.pdf/)).toBeTruthy();
  let finishLink!: (value: CaptureResponse) => void;
  createCapture.mockImplementationOnce(() => new Promise(resolve => { finishLink = resolve; }));
  paste(view.getByTestId("board"), "https://example.com/story");
  paste(view.getByTestId("board"), "https://example.com/story");
  expect(createCapture).toHaveBeenCalledTimes(1);
  await act(async () => finishLink(response()));
});

test("a failed link can be retried without retyping or exposing backend diagnostics", async () => {
  createCapture.mockRejectedValueOnce(new Error("private-network-host HTTP 400"));
  const view = setup();
  paste(view.getByTestId("board"), "https://example.com/story");
  expect(await view.findByText(/Couldn’t save https/)).toBeTruthy();
  expect(view.queryByText(/private-network|HTTP 400/)).toBeNull();
  createCapture.mockResolvedValueOnce(response());
  await view.user.click(view.getByRole("button", { name: "Retry https://example.com/story" }));
  expect(await view.findByText(/Saved.*example.com/)).toBeTruthy();
  expect(view.onSaved).toHaveBeenCalledWith(item);
});

test("separate file selections are never deduplicated by filename and unsupported saves still reach the board", async () => {
  const unsupported: KnowledgeItem = { ...item, availability: "unsupported", source: { ...item.source, filename: "scan.bin", kind: "file" } };
  createOriginalFileCapture.mockResolvedValue(response({ reused: true, knowledgeItem: unsupported }));
  const view = setup();
  const first = new File(["first"], "scan.bin");
  const second = new File(["second"], "scan.bin");
  fireEvent.drop(view.getByTestId("board"), fileDrag([first, second]));
  await waitFor(() => expect(view.onSaved).toHaveBeenCalledTimes(2));
  expect(view.onSaved).toHaveBeenCalledWith(unsupported);
  expect(view.onDuplicate).not.toHaveBeenCalled();
  expect(view.queryByText(/Couldn’t save/)).toBeNull();
});

test("board update errors keep a durable save distinct from a retryable upload failure", async () => {
  createCapture.mockResolvedValue(response());
  const view = setup();
  view.onSaved.mockImplementation(() => { throw new Error("Board update failed"); });
  paste(view.getByTestId("board"), "https://example.com/story");
  expect(await view.findByText("Saved, but the board couldn’t update. Reload to see your save.")).toBeTruthy();
  expect(view.queryByRole("button", { name: /^Retry/ })).toBeNull();
});

test("rejected file input explains how to choose a usable replacement without exposing error codes", async () => {
  createOriginalFileCapture.mockRejectedValueOnce(new Error("file-too-large"));
  const view = setup();
  fireEvent.drop(view.getByTestId("board"), fileDrag([new File(["1"], "large.pdf")]));
  expect(await view.findByText(/This file is too large. Choose a smaller file with Add./)).toBeTruthy();
  expect(view.queryByText(/file-too-large/)).toBeNull();
});


test("file dropping covers the page outside the board and suppresses navigation while shortcuts are excluded", async () => {
  createOriginalFileCapture.mockResolvedValue(response());
  const view = setup();
  const drag = fileDrag([new File(["page"], "page.pdf")]);
  expect(fireEvent.dragEnter(document.body, drag)).toBe(false);
  expect(view.getByText("Drop files to save")).toBeTruthy();
  expect(fireEvent.dragOver(document.documentElement, drag)).toBe(false);
  expect(fireEvent.drop(document.body, drag)).toBe(false);
  await waitFor(() => expect(view.onSaved).toHaveBeenCalledTimes(1));
  expect(view.queryByText("Drop files to save")).toBeNull();
  await view.user.click(view.getByRole("button", { name: "Add" }));
  expect(fireEvent.drop(document.body, fileDrag([new File(["modal"], "modal.pdf")]))).toBe(false);
  expect(createOriginalFileCapture).toHaveBeenCalledTimes(1);
  view.unmount();
  setup(true);
  expect(fireEvent.drop(document.body, fileDrag([new File(["trash"], "trash.pdf")]))).toBe(false);
  expect(createOriginalFileCapture).toHaveBeenCalledTimes(1);
});
