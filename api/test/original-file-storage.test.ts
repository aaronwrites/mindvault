import { describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { DeterministicOriginalFileStorageFake } from "../src/lib/original-files/deterministic-original-file-storage-fake";
import { cloudinaryOriginalFileStorageFromEnvironment } from "../src/lib/original-files/cloudinary-original-file-storage";

const cloudinaryContractEnabled = Boolean(
    process.env.CLOUDINARY_CONTRACT_TEST_CLOUD_NAME
    && process.env.CLOUDINARY_CONTRACT_TEST_API_KEY
    && process.env.CLOUDINARY_CONTRACT_TEST_API_SECRET
);

async function localUpload(bytes = Buffer.from("original bytes")) {
    const directory = join(tmpdir(), `mindvault-original-file-storage-${randomUUID()}`);
    await mkdir(directory, { recursive: true });
    const path = join(directory, "original.bin");
    await writeFile(path, bytes);
    return { path, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

describe("Original File storage boundary", () => {
    test("validates Cloudinary configuration only when Original File storage is requested", () => {
        expect(() => cloudinaryOriginalFileStorageFromEnvironment({})).toThrow("CLOUDINARY_CLOUD_NAME must be configured");
    });

    test("retains a bounded local upload privately and reuses its idempotent provider identity", async () => {
        const upload = await localUpload();
        const storage = new DeterministicOriginalFileStorageFake();

        try {
            const first = await storage.upload({ localPath: upload.path, providerIdentity: "original-files/sha256-abc", mediaType: "application/pdf" });
            const repeated = await storage.upload({ localPath: upload.path, providerIdentity: "original-files/sha256-abc", mediaType: "application/pdf" });

            expect(first).toEqual({ locator: "fake:original-files/sha256-abc", byteSize: 14, reused: false });
            expect(repeated).toEqual({ ...first, reused: true });
            expect(await storage.inspectUpload("original-files/sha256-abc")).toEqual(first);
            expect(Buffer.from(await storage.read({ locator: first.locator, maximumBytes: 14, timeoutMs: 1000 }))).toEqual(Buffer.from("original bytes"));
            await expect(storage.read({ locator: first.locator, maximumBytes: 13, timeoutMs: 1000 })).rejects.toThrow("byte limit");
            const access = await storage.createSignedAccess({ locator: first.locator, expiresAt: new Date("2030-01-01T00:05:00.000Z"), disposition: "attachment", filename: "original.bin" });
            expect(access).toEqual({
                url: expect.stringMatching(/^https:\/\/storage\.fake\/access\/original-files%2Fsha256-abc\?expires_at=1893456300&signature=[\w-]+&disposition=attachment&filename=original\.bin$/),
                expiresAt: new Date("2030-01-01T00:05:00.000Z"),
            });
            expect(storage.canAccess(access.url, new Date("2029-12-31T00:00:00.000Z"))).toBe(true);
            expect(storage.canAccess("https://storage.fake/access/original-files%2Fsha256-abc?expires_at=1893456300")).toBe(false);
        } finally {
            await upload.cleanup();
        }
    });

    test("models provider rejection, outage, deletion failure, and ambiguous post-upload outcomes deterministically", async () => {
        const upload = await localUpload();
        const storage = new DeterministicOriginalFileStorageFake();

        try {
            storage.rejectNextUpload("file rejected");
            await expect(storage.upload({ localPath: upload.path, providerIdentity: "original-files/rejected", mediaType: "application/pdf" })).rejects.toThrow("file rejected");

            storage.setOutage(true);
            await expect(storage.upload({ localPath: upload.path, providerIdentity: "original-files/outage", mediaType: "application/pdf" })).rejects.toThrow("unavailable");
            storage.setOutage(false);

            storage.ambiguouslyUploadNext("after upload connection lost");
            await expect(storage.upload({ localPath: upload.path, providerIdentity: "original-files/ambiguous", mediaType: "application/pdf" })).rejects.toThrow("after upload connection lost");
            expect(await storage.inspectUpload("original-files/ambiguous")).toEqual(expect.objectContaining({ locator: "fake:original-files/ambiguous" }));

            const retained = await storage.upload({ localPath: upload.path, providerIdentity: "original-files/delete", mediaType: "application/pdf" });
            storage.failNextDeletion("delete unavailable");
            await expect(storage.delete(retained.locator)).rejects.toThrow("delete unavailable");
            await expect(storage.delete(retained.locator)).resolves.toEqual({ deleted: true });
            await expect(storage.delete(retained.locator)).resolves.toEqual({ deleted: false });
        } finally {
            await upload.cleanup();
        }
    });
});

describe("Cloudinary Original File storage contract", () => {
    test.skipIf(!cloudinaryContractEnabled)("retains authenticated bytes, grants short-lived signed access, and deletes an isolated asset", async () => {
        const environment = {
            CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CONTRACT_TEST_CLOUD_NAME!,
            CLOUDINARY_API_KEY: process.env.CLOUDINARY_CONTRACT_TEST_API_KEY!,
            CLOUDINARY_API_SECRET: process.env.CLOUDINARY_CONTRACT_TEST_API_SECRET!,
            CLOUDINARY_ORIGINAL_FILE_PREFIX: process.env.CLOUDINARY_CONTRACT_TEST_PREFIX ?? "mindvault-contract-tests",
        };
        const storage = cloudinaryOriginalFileStorageFromEnvironment(environment);
        const upload = await localUpload(Buffer.from("MindVault Cloudinary contract bytes"));
        const providerIdentity = `original-file-${randomUUID()}`;

        try {
            const stored = await storage.upload({ localPath: upload.path, providerIdentity, mediaType: "text/plain" });
            expect(stored.reused).toBe(false);
            expect(stored.byteSize).toBe(33);

            const unsigned = await fetch(`https://res.cloudinary.com/${environment.CLOUDINARY_CLOUD_NAME}/raw/authenticated/${environment.CLOUDINARY_ORIGINAL_FILE_PREFIX}/${providerIdentity}.txt`);
            expect(unsigned.ok).toBe(false);

            expect(Buffer.from(await storage.read({ locator: stored.locator, maximumBytes: 100, timeoutMs: 10_000 }))).toEqual(Buffer.from("MindVault Cloudinary contract bytes"));
            await expect(storage.read({ locator: stored.locator, maximumBytes: 10, timeoutMs: 10_000 })).rejects.toThrow("byte limit");
            const access = await storage.createSignedAccess({ locator: stored.locator, expiresAt: new Date(Date.now() + 60_000), disposition: "attachment", filename: "original.bin" });
            const signed = await fetch(access.url);
            expect(signed.ok).toBe(true);
            expect(Buffer.from(await signed.arrayBuffer())).toEqual(Buffer.from("MindVault Cloudinary contract bytes"));

            await expect(storage.delete(stored.locator)).resolves.toEqual({ deleted: true });
            await expect(storage.delete(stored.locator)).resolves.toEqual({ deleted: false });
        } finally {
            await upload.cleanup();
        }
    });
});
