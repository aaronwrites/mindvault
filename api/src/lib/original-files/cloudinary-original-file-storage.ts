import { v2 as cloudinary } from "cloudinary";
import { OriginalFileStorageError, type OriginalFileStorage, type OriginalFileStorageUpload, type StoredOriginalFile } from "./original-file-storage";

type CloudinaryResourceType = "image" | "video" | "raw";

type CloudinaryOriginalFileStorageConfig = {
    cloudName: string;
    apiKey: string;
    apiSecret: string;
    prefix?: string;
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
    });
}

export class CloudinaryOriginalFileStorage implements OriginalFileStorage {
    readonly provider = "cloudinary";
    #prefix: string;

    constructor(config: CloudinaryOriginalFileStorageConfig) {
        this.#prefix = config.prefix ?? "mindvault/original-files";
        cloudinary.config({ cloud_name: config.cloudName, api_key: config.apiKey, api_secret: config.apiSecret, secure: true });
    }

    async upload(upload: OriginalFileStorageUpload): Promise<StoredOriginalFile> {
        const publicId = this.#publicId(upload.providerIdentity, upload.mediaType);
        try {
            const response = await cloudinary.uploader.upload(upload.localPath, {
                public_id: publicId,
                resource_type: resourceTypeFor(upload.mediaType),
                type: "authenticated",
                overwrite: false,
                unique_filename: false,
                use_filename: false,
            });
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
                const response = await cloudinary.api.resource(publicId, { resource_type: resourceType, type: "authenticated" });
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
        return resourceTypeFor(mediaType) === "raw" ? `${identity}.bin` : identity;
    }

    async createSignedAccess(request: { locator: string; expiresAt: Date }) {
        const locator = parseLocator(request.locator);
        return {
            url: cloudinary.utils.private_download_url(locator.publicId, locator.format, {
                resource_type: locator.resourceType,
                type: "authenticated",
                expires_at: Math.floor(request.expiresAt.getTime() / 1_000),
            }),
            expiresAt: request.expiresAt,
        };
    }

    async delete(locator: string): Promise<{ deleted: boolean }> {
        const parsed = parseLocator(locator);
        try {
            const response = await cloudinary.uploader.destroy(parsed.publicId, { resource_type: parsed.resourceType, type: "authenticated", invalidate: true });
            return { deleted: response.result === "ok" };
        } catch (error) {
            if (notFound(error)) return { deleted: false };
            throw storageError(error);
        }
    }
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
    return error instanceof Error && /already exists|conflict/i.test(error.message);
}

function notFound(error: unknown): boolean {
    return error instanceof Error && /not found/i.test(error.message);
}

function storageError(error: unknown): OriginalFileStorageError {
    return new OriginalFileStorageError("unavailable", error instanceof Error ? error.message : "Original File storage is unavailable");
}
