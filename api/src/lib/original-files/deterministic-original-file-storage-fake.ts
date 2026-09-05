import { randomUUID } from "node:crypto";
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
    #signedAccesses = new Map<string, { identity: string; expiresAt: number }>();

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

    async createSignedAccess(request: { locator: string; expiresAt: Date; disposition: "inline" | "attachment"; filename: string }) {
        await this.#wait();
        this.#assertAvailable();
        const identity = request.locator.slice("fake:".length);
        if (!this.#files.has(identity)) throw new OriginalFileStorageError("rejected", "Original File does not exist");
        const signature = randomUUID();
        const expiresAt = Math.floor(request.expiresAt.getTime() / 1_000);
        this.#signedAccesses.set(signature, { identity, expiresAt });
        return {
            url: `https://storage.fake/access/${encodeURIComponent(identity)}?expires_at=${expiresAt}&signature=${signature}&disposition=${request.disposition}&filename=${encodeURIComponent(request.filename)}`,
            expiresAt: request.expiresAt,
        };
    }

    canAccess(url: string, at = new Date()) {
        const parsed = new URL(url);
        const identity = decodeURIComponent(parsed.pathname.replace("/access/", ""));
        const expiresAt = Number(parsed.searchParams.get("expires_at"));
        const signature = parsed.searchParams.get("signature");
        const signedAccess = signature ? this.#signedAccesses.get(signature) : undefined;
        return parsed.origin === "https://storage.fake"
            && parsed.pathname.startsWith("/access/")
            && this.#files.has(identity)
            && Number.isSafeInteger(expiresAt)
            && signedAccess?.identity === identity
            && signedAccess.expiresAt === expiresAt
            && at.getTime() < expiresAt * 1_000;
    }

    async delete(locator: string): Promise<{ deleted: boolean }> {
        await this.#wait();
        this.#assertAvailable();
        if (this.#nextDeletionFailure) throw this.#takeDeletionFailure();
        const identity = locator.slice("fake:".length);
        for (const [signature, access] of this.#signedAccesses) if (access.identity === identity) this.#signedAccesses.delete(signature);
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
