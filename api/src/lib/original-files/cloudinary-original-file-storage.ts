import { v2 as cloudinary } from "cloudinary";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { readBoundedOriginalFile, OriginalFileStorageError, type OriginalFileStorage, type OriginalFileStorageUpload, type StoredOriginalFile } from "./original-file-storage";

type CloudinaryResourceType = "image" | "video" | "raw";

type CloudinaryOriginalFileStorageConfig = {
    cloudName: string;
    apiKey: string;
    apiSecret: string;
    prefix?: string;
    uploadPrefix?: string;
};

type CloudinaryLocator = {
    publicId: string;
    resourceType: CloudinaryResourceType;
    format: string;
};

export function cloudinaryOriginalFileStorageFromEnvironment(environment: NodeJS.ProcessEnv = process.env): OriginalFileStorage {
    return new CloudinaryOriginalFileStorage({
        cloudName: required(environment, "CLOUDINARY_CLOUD_NAME"),
        apiKey: required(environment, "CLOUDINARY_API_KEY"),
        apiSecret: required(environment, "CLOUDINARY_API_SECRET"),
        prefix: environment.CLOUDINARY_ORIGINAL_FILE_PREFIX,
        uploadPrefix: environment.CLOUDINARY_UPLOAD_PREFIX,
    });
}

export class CloudinaryOriginalFileStorage implements OriginalFileStorage {
    readonly provider = "cloudinary";
    #prefix: string;
    #apiKey: string;
    #apiSecret: string;
    #uploadPrefix: string;

    constructor(config: CloudinaryOriginalFileStorageConfig) {
        this.#prefix = config.prefix ?? "mindvault/original-files";
        this.#apiKey = config.apiKey;
        this.#apiSecret = config.apiSecret;
        this.#uploadPrefix = config.uploadPrefix?.replace(/\/$/, "") ?? "https://api.cloudinary.com";
        cloudinary.config({ cloud_name: config.cloudName, api_key: config.apiKey, api_secret: config.apiSecret, secure: true, ...(config.uploadPrefix ? { upload_prefix: config.uploadPrefix } : {}) });
    }

    async upload(upload: OriginalFileStorageUpload): Promise<StoredOriginalFile> {
        const resourceType = resourceTypeFor(upload.mediaType);
        const publicId = this.#publicId(upload.providerIdentity, upload.mediaType);
        try {
            const file = new Blob([await readFile(upload.localPath)], { type: upload.mediaType });
            const response = await this.#request<{ public_id: string; resource_type: CloudinaryResourceType | "auto"; format?: string; bytes: number }>(
                `/v1_1/${this.#cloudName()}/${resourceType}/upload`,
                {
                    method: "POST",
                    body: this.#signedForm({
                        public_id: publicId,
                        type: "authenticated",
                        ...(resourceType === "raw" ? { format: rawExtensionFor(upload.mediaType) } : {}),
                        overwrite: false,
                        unique_filename: false,
                        use_filename: false,
                    }, file, basename(upload.localPath)),
                },
            );
            return storedResponse(response, false);
        } catch (error) {
            if (!alreadyExists(error)) throw storageError(error);
            const existing = await this.inspectUpload(upload.providerIdentity);
            if (!existing) throw storageError(error);
            return { ...existing, reused: true };
        }
    }

    async inspectUpload(providerIdentity: string): Promise<StoredOriginalFile | null> {
        for (const resourceType of ["image", "video", "raw"] as const) {
            const publicId = this.#publicId(providerIdentity, resourceType === "raw" ? "application/octet-stream" : resourceType === "video" ? "video/*" : "image/*");
            try {
                const response = await this.#request<{ public_id: string; resource_type: CloudinaryResourceType | "auto"; format?: string; bytes: number }>(
                    `/v1_1/${this.#cloudName()}/resources/${resourceType}/authenticated/${encodeURIComponent(publicId)}`,
                    { headers: { Authorization: `Basic ${Buffer.from(`${this.#apiKey}:${this.#apiSecret}`).toString("base64")}` } },
                );
                return storedResponse(response, false);
            } catch (error) {
                if (notFound(error)) continue;
                throw storageError(error);
            }
        }
        return null;
    }

    #publicId(providerIdentity: string, mediaType: string) {
        const identity = `${this.#prefix}/${providerIdentity}`;
        return resourceTypeFor(mediaType) === "raw" ? `${identity}.${rawExtensionFor(mediaType)}` : identity;
    }

    #cloudName() {
        return cloudinary.config().cloud_name as string;
    }

    #signedForm(parameters: Record<string, string | boolean>, file?: Blob, filename?: string) {
        const timestamp = Math.floor(Date.now() / 1_000).toString();
        const signedParameters = { ...parameters, timestamp };
        const signature = createHash("sha1")
            .update(Object.entries(signedParameters).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${value}`).join("&") + this.#apiSecret)
            .digest("hex");
        const form = new FormData();
        for (const [key, value] of Object.entries(signedParameters)) form.set(key, String(value));
        form.set("api_key", this.#apiKey);
        form.set("signature", signature);
        if (file) form.set("file", file, filename ?? "original-file");
        return form;
    }

    async #request<Response>(path: string, init: RequestInit): Promise<Response> {
        const response = await fetch(`${this.#uploadPrefix}${path}`, init);
        if (response.ok) return response.json() as Promise<Response>;
        const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw { http_code: response.status, message: body?.error?.message ?? `Cloudinary returned HTTP ${response.status}` };
    }

    async createSignedAccess(request: { locator: string; expiresAt: Date; disposition: "inline" | "attachment"; filename: string }) {
        const locator = parseLocator(request.locator);
        return {
            url: privateDownloadUrl(locator.publicId, locator.format, {
                resource_type: locator.resourceType,
                type: "authenticated",
                expires_at: Math.floor(request.expiresAt.getTime() / 1_000),
                attachment: request.disposition === "attachment" ? request.filename : false,
            }),
            expiresAt: request.expiresAt,
        };
    }

    async read(request: { locator: string; maximumBytes: number; timeoutMs: number }): Promise<Uint8Array> {
        const access = await this.createSignedAccess({ locator: request.locator, filename: "original.pdf", disposition: "attachment", expiresAt: new Date(Date.now() + request.timeoutMs + 60_000) });
        try {
            const response = await fetch(access.url, { signal: AbortSignal.timeout(request.timeoutMs), redirect: "error" });
            return await readBoundedOriginalFile(response, request.maximumBytes);
        } catch (error) {
            if (error instanceof OriginalFileStorageError) throw error;
            throw new OriginalFileStorageError("unavailable", "Retained Original File storage read failed or timed out");
        }
    }

    async delete(locator: string): Promise<{ deleted: boolean }> {
        const parsed = parseLocator(locator);
        try {
            const response = await this.#request<{ result: string }>(`/v1_1/${this.#cloudName()}/${parsed.resourceType}/destroy`, {
                method: "POST",
                body: this.#signedForm({ public_id: parsed.publicId, type: "authenticated", invalidate: true }),
            });
            return { deleted: response.result === "ok" };
        } catch (error) {
            if (notFound(error)) return { deleted: false };
            throw storageError(error);
        }
    }
}

function privateDownloadUrl(publicId: string, format: string, options: { resource_type: CloudinaryResourceType; type: "authenticated"; expires_at: number; attachment: string | false }) {
    return (cloudinary.utils.private_download_url as unknown as (id: string, fileFormat: string, values: typeof options) => string)(publicId, format, options);
}

function required(environment: NodeJS.ProcessEnv, key: string): string {
    const value = environment[key]?.trim();
    if (!value) throw new OriginalFileStorageError("configuration", `${key} must be configured before using Original File storage`);
    return value;
}

function resourceTypeFor(mediaType: string): CloudinaryResourceType {
    if (mediaType.startsWith("image/")) return "image";
    if (mediaType.startsWith("video/") || mediaType.startsWith("audio/")) return "video";
    return "raw";
}

function rawExtensionFor(mediaType: string): string {
    switch (mediaType) {
        case "application/pdf": return "pdf";
        case "application/vnd.openxmlformats-officedocument.wordprocessingml.document": return "docx";
        case "text/plain": return "txt";
        default: return "dat";
    }
}

function storedResponse(response: { public_id: string; resource_type: CloudinaryResourceType | "auto"; format?: string; bytes: number }, reused: boolean): StoredOriginalFile {
    if (response.resource_type === "auto") throw new OriginalFileStorageError("unavailable", "Cloudinary did not resolve an Original File resource type");
    const format = response.format ?? "bin";
    return { locator: serializeLocator({ publicId: response.public_id, resourceType: response.resource_type, format }), byteSize: response.bytes, reused };
}

function serializeLocator(locator: CloudinaryLocator): string {
    return `cloudinary:${locator.resourceType}:${encodeURIComponent(locator.publicId)}:${encodeURIComponent(locator.format)}`;
}

function parseLocator(locator: string): CloudinaryLocator {
    const [provider, resourceType, encodedPublicId, encodedFormat] = locator.split(":");
    if (provider !== "cloudinary" || (resourceType !== "image" && resourceType !== "video" && resourceType !== "raw") || !encodedPublicId || !encodedFormat) {
        throw new OriginalFileStorageError("rejected", "Original File storage locator is invalid");
    }
    return { publicId: decodeURIComponent(encodedPublicId), resourceType, format: decodeURIComponent(encodedFormat) };
}

function alreadyExists(error: unknown): boolean {
    return statusCode(error) === 409 || /already exists|conflict/i.test(errorMessage(error));
}

function notFound(error: unknown): boolean {
    return statusCode(error) === 404 || /not found/i.test(errorMessage(error));
}

function storageError(error: unknown): OriginalFileStorageError {
    const status = statusCode(error);
    const message = errorMessage(error);
    const kind = status === 403 ? "rejected" : "unavailable";
    return new OriginalFileStorageError(kind, status ? `Cloudinary request failed (HTTP ${status}): ${message}` : message);
}

function errorMessage(error: unknown): string {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") return error.message;
    if (typeof error === "object" && error !== null && "error" in error) {
        const nested = error.error;
        if (typeof nested === "object" && nested !== null && "message" in nested && typeof nested.message === "string") return nested.message;
    }
    return "Original File storage is unavailable";
}

function statusCode(error: unknown): number | null {
    if (typeof error !== "object" || error === null || !("http_code" in error) || typeof error.http_code !== "number") return null;
    return error.http_code;
}
