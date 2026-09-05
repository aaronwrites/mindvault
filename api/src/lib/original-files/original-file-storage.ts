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
