import Busboy from "busboy";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Request } from "express";

export const DEFAULT_MAXIMUM_ORIGINAL_FILE_BYTES = 50 * 1024 * 1024;
export const DEFAULT_ORIGINAL_FILE_UPLOAD_TIMEOUT_MS = 60_000;

export type ReceivedOriginalFile = {
    localPath: string;
    cleanup(): Promise<void>;
    contentHash: string;
    byteSize: number;
    filename: string;
    mediaTypeHint: string;
    personalNote?: string;
};

export class OriginalFileRequestError extends Error {
    constructor(readonly code: "invalid-multipart" | "empty-file" | "file-too-large" | "prohibited-file", message: string) {
        super(message);
    }
}

export async function receiveOriginalFile(req: Request, maximumBytes = DEFAULT_MAXIMUM_ORIGINAL_FILE_BYTES, timeoutMs = DEFAULT_ORIGINAL_FILE_UPLOAD_TIMEOUT_MS): Promise<ReceivedOriginalFile> {
    const contentType = req.headers["content-type"];
    if (!contentType?.startsWith("multipart/form-data")) {
        throw new OriginalFileRequestError("invalid-multipart", "Expected multipart/form-data");
    }

    const directory = join(tmpdir(), "mindvault-original-files");
    await mkdir(directory, { recursive: true });
    const localPath = join(directory, randomUUID());
    let fileCount = 0;
    let filename: string | undefined;
    let mediaTypeHint = "application/octet-stream";
    let personalNote: string | undefined;
    let byteSize = 0;
    let tooLarge = false;
    const hash = createHash("sha256");
    let writeCompleted: Promise<void> | undefined;

    try {
        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                req.unpipe();
                req.resume();
                reject(new OriginalFileRequestError("invalid-multipart", "Upload timed out"));
            }, timeoutMs);
            const settle = (callback: () => void) => () => {
                clearTimeout(timeout);
                callback();
            };
            const parser = Busboy({ headers: req.headers, limits: { files: 1, fileSize: maximumBytes, fields: 1, fieldSize: 8 * 1024 } });
            parser.on("field", (name, value) => {
                if (name !== "personalNote") {
                    settle(() => reject(new OriginalFileRequestError("invalid-multipart", "Capture accepts only an optional personal note")))();
                    return;
                }
                personalNote = value.trim() || undefined;
            });
            parser.on("file", (name, stream, info) => {
                fileCount += 1;
                if (name !== "file" || fileCount > 1) {
                    stream.resume();
                    return;
                }
                filename = info.filename;
                mediaTypeHint = info.mimeType;
                const output = createWriteStream(localPath, { flags: "wx" });
                writeCompleted = new Promise((writeResolve, writeReject) => {
                    output.once("finish", writeResolve);
                    output.once("error", writeReject);
                });
                stream.on("data", (chunk: Buffer) => {
                    byteSize += chunk.length;
                    hash.update(chunk);
                });
                stream.once("limit", () => { tooLarge = true; });
                stream.once("error", settle(() => reject(new OriginalFileRequestError("invalid-multipart", "Upload was interrupted"))));
                stream.pipe(output);
            });
            parser.once("filesLimit", settle(() => reject(new OriginalFileRequestError("invalid-multipart", "Capture accepts exactly one file"))));
            parser.once("fieldsLimit", settle(() => reject(new OriginalFileRequestError("invalid-multipart", "Capture accepts only an optional personal note"))));
            parser.once("error", settle(() => reject(new OriginalFileRequestError("invalid-multipart", "Invalid multipart upload"))));
            req.once("aborted", settle(() => reject(new OriginalFileRequestError("invalid-multipart", "Upload was interrupted"))));
            parser.once("close", settle(resolve));
            req.pipe(parser);
        });
        await writeCompleted;
        if (fileCount !== 1 || !filename) throw new OriginalFileRequestError("invalid-multipart", "Capture requires one file field");
        if (tooLarge) throw new OriginalFileRequestError("file-too-large", `Original Files may not exceed ${maximumBytes} bytes`);
        if (byteSize === 0) throw new OriginalFileRequestError("empty-file", "Original Files may not be empty");
        return { localPath, cleanup: () => rm(localPath, { force: true }), contentHash: hash.digest("hex"), byteSize, filename, mediaTypeHint, personalNote };
    } catch (error) {
        await rm(localPath, { force: true });
        throw error;
    }
}

export type OriginalFileClassification = { sourceKind: "pdf" | "image" | "word-document" | "markdown" | "plain-text" | "audio" | "video" | "file"; mediaType: string };

export async function classifyOriginalFile(file: Pick<ReceivedOriginalFile, "localPath" | "filename" | "mediaTypeHint">): Promise<OriginalFileClassification> {
    const handle = await open(file.localPath, "r");
    try {
        const bytes = Buffer.alloc(8 * 1024);
        const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
        const head = bytes.subarray(0, bytesRead);
        if (head.subarray(0, 2).equals(Buffer.from("MZ")) || head.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) throw new OriginalFileRequestError("prohibited-file", "Executable Original Files are not accepted");
        if (head.subarray(0, 4).equals(Buffer.from("PK\x03\x04"))) {
            const tailLength = Math.min(66 * 1024, (await handle.stat()).size);
            const tail = Buffer.alloc(tailLength);
            await handle.read(tail, 0, tailLength, (await handle.stat()).size - tailLength);
            if (["word/", "xl/", "ppt/"].some(directory => tail.includes(Buffer.from(directory)))) return { sourceKind: "word-document", mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
            throw new OriginalFileRequestError("prohibited-file", "Archive Original Files are not accepted");
        }
        if (head.subarray(0, 5).equals(Buffer.from("%PDF-"))) return { sourceKind: "pdf", mediaType: "application/pdf" };
        if (head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { sourceKind: "image", mediaType: "image/png" };
        if (head.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return { sourceKind: "image", mediaType: "image/jpeg" };
        if (head.subarray(0, 6).toString() === "GIF87a" || head.subarray(0, 6).toString() === "GIF89a") return { sourceKind: "image", mediaType: "image/gif" };
        if (head.subarray(0, 4).toString() === "RIFF" && head.subarray(8, 12).toString() === "WEBP") return { sourceKind: "image", mediaType: "image/webp" };
        if (head.subarray(0, 2).toString() === "BM") return { sourceKind: "image", mediaType: "image/bmp" };
        if (head.subarray(0, 4).toString() === "RIFF" && head.subarray(8, 12).toString() === "WAVE") return { sourceKind: "audio", mediaType: "audio/wav" };
        if (head.subarray(0, 3).toString() === "ID3") return { sourceKind: "audio", mediaType: "audio/mpeg" };
        if (head.subarray(0, 4).toString() === "fLaC") return { sourceKind: "audio", mediaType: "audio/flac" };
        if (head.subarray(0, 4).toString() === "OggS") return { sourceKind: "audio", mediaType: "audio/ogg" };
        if (head.subarray(4, 8).toString() === "ftyp") {
            const brand = head.subarray(8, 12).toString();
            if (["M4A ", "M4B ", "M4P ", "f4a "].includes(brand)) return { sourceKind: "audio", mediaType: "audio/mp4" };
            if (["isom", "iso2", "mp41", "mp42", "avc1", "hvc1", "qt  "].includes(brand)) return { sourceKind: "video", mediaType: "video/mp4" };
        }
        if (!head.includes(0) && isUtf8(head)) return { sourceKind: /\.md(?:own)?$/i.test(file.filename) ? "markdown" : "plain-text", mediaType: "text/plain" };
        return { sourceKind: "file", mediaType: "application/octet-stream" };
    } finally {
        await handle.close();
    }
}

function isUtf8(bytes: Buffer): boolean {
    try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); return true; } catch { return false; }
}
