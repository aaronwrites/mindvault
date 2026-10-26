export type OriginalFileStorageUpload = {
    localPath: string;
    providerIdentity: string;
    mediaType: string;
};

export type StoredOriginalFile = {
    locator: string;
    byteSize: number;
    reused: boolean;
};

export type OriginalFileAccess = {
    url: string;
    expiresAt: Date;
};

export type OriginalFileAccessRequest = {
    locator: string;
    expiresAt: Date;
    disposition: "inline" | "attachment";
    filename: string;
};

export interface OriginalFileStorage {
    readonly provider: string;
    upload(upload: OriginalFileStorageUpload): Promise<StoredOriginalFile>;
    inspectUpload(providerIdentity: string): Promise<StoredOriginalFile | null>;
    createSignedAccess(request: OriginalFileAccessRequest): Promise<OriginalFileAccess>;
    read(request: { locator: string; maximumBytes: number; timeoutMs: number }): Promise<Uint8Array>;
    delete(locator: string): Promise<{ deleted: boolean }>;
}

export class OriginalFileStorageError extends Error {
    constructor(
        readonly kind: "configuration" | "unavailable" | "rejected" | "ambiguous",
        message: string,
    ) {
        super(message);
        this.name = "OriginalFileStorageError";
    }
}

/** Bound even chunked provider responses; never trust Content-Length alone. */
export async function readBoundedOriginalFile(response: Response, maximumBytes: number): Promise<Uint8Array> {
    if (!response.ok || !response.body) throw new OriginalFileStorageError("unavailable", "Retained Original File could not be read");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maximumBytes) throw new OriginalFileStorageError("rejected", "PDF processing byte limit exceeded; no pages were processed");
            chunks.push(value);
        }
    } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
    return Buffer.concat(chunks, size);
}
