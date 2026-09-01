import { readFile } from "node:fs/promises";
import { OriginalFileStorageError, type OriginalFileStorage, type OriginalFileStorageUpload, type StoredOriginalFile } from "./original-file-storage";

type StoredFakeFile = Omit<StoredOriginalFile, "reused"> & { bytes: Buffer };

export class DeterministicOriginalFileStorageFake implements OriginalFileStorage {
    readonly provider = "deterministic";
    #files = new Map<string, StoredFakeFile>();
    #outage = false;
    #nextUploadFailure: OriginalFileStorageError | null = null;
    #nextDeletionFailure: OriginalFileStorageError | null = null;
    #nextAmbiguousUpload: OriginalFileStorageError | null = null;

    get uploadedFileCount() { return this.#files.size; }
    #delayMs = 0;

    setOutage(outage: boolean) { this.#outage = outage; }
    setDelay(milliseconds: number) { this.#delayMs = milliseconds; }
    rejectNextUpload(message: string) { this.#nextUploadFailure = new OriginalFileStorageError("rejected", message); }
    failNextDeletion(message: string) { this.#nextDeletionFailure = new OriginalFileStorageError("unavailable", message); }
    ambiguouslyUploadNext(message: string) { this.#nextAmbiguousUpload = new OriginalFileStorageError("ambiguous", message); }

    async upload(upload: OriginalFileStorageUpload): Promise<StoredOriginalFile> {
        await this.#wait();
        this.#assertAvailable();
        if (this.#nextUploadFailure) throw this.#takeUploadFailure();

        const existing = this.#files.get(upload.providerIdentity);
        if (existing) return { ...withoutBytes(existing), reused: true };

        const bytes = await readFile(upload.localPath);
        const stored = {
            locator: `fake:${upload.providerIdentity}`,
            byteSize: bytes.byteLength,
            bytes,
        };
        this.#files.set(upload.providerIdentity, stored);
        if (this.#nextAmbiguousUpload) throw this.#takeAmbiguousUpload();
        return { ...withoutBytes(stored), reused: false };
    }

    async inspectUpload(providerIdentity: string): Promise<StoredOriginalFile | null> {
        await this.#wait();
        this.#assertAvailable();
        const stored = this.#files.get(providerIdentity);
        return stored ? { ...withoutBytes(stored), reused: false } : null;
    }

    async createSignedAccess(request: { locator: string; expiresAt: Date }) {
        await this.#wait();
        this.#assertAvailable();
        const identity = request.locator.slice("fake:".length);
        if (!this.#files.has(identity)) throw new OriginalFileStorageError("rejected", "Original File does not exist");
        return {
            url: `https://storage.fake/access/${encodeURIComponent(identity)}?expires_at=${Math.floor(request.expiresAt.getTime() / 1_000)}`,
            expiresAt: request.expiresAt,
        };
    }

    async delete(locator: string): Promise<{ deleted: boolean }> {
        await this.#wait();
        this.#assertAvailable();
        if (this.#nextDeletionFailure) throw this.#takeDeletionFailure();
        const identity = locator.slice("fake:".length);
        return { deleted: this.#files.delete(identity) };
    }

    #assertAvailable() {
        if (this.#outage) throw new OriginalFileStorageError("unavailable", "Original File storage is unavailable");
    }

    #takeUploadFailure() {
        const failure = this.#nextUploadFailure!;
        this.#nextUploadFailure = null;
        return failure;
    }

    #takeDeletionFailure() {
        const failure = this.#nextDeletionFailure!;
        this.#nextDeletionFailure = null;
        return failure;
    }

    #takeAmbiguousUpload() {
        const failure = this.#nextAmbiguousUpload!;
        this.#nextAmbiguousUpload = null;
        return failure;
    }

    async #wait() {
        if (this.#delayMs > 0) await new Promise(resolve => setTimeout(resolve, this.#delayMs));
    }
}

function withoutBytes(file: StoredFakeFile): Omit<StoredFakeFile, "bytes"> {
    const { bytes: _bytes, ...metadata } = file;
    return metadata;
}
