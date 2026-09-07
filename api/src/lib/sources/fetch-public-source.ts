import { lookup } from "node:dns/promises";
import { request as requestHttp } from "node:http";
import { request as requestHttps } from "node:https";
import { isIP } from "node:net";

export type SafeFetchTarget = {
    url: string;
    hostname: string;
    address: string;
    timeoutMs: number;
    maxResponseBytes: number;
    accept: string;
    signal: AbortSignal;
};

export type SafeFetchTransport = {
    fetch(target: SafeFetchTarget): Promise<{
        status: number;
        headers: Record<string, string | undefined>;
        body: Uint8Array;
    }>;
};

export type SafeFetchDependencies = {
    resolveAddresses?: (hostname: string) => Promise<string[]>;
    transport?: SafeFetchTransport;
};

export type SafeFetchOptions = SafeFetchDependencies & {
    responseProfile?: SafeFetchResponseProfile;
    timeoutMs?: number;
    maxResponseBytes?: number;
    maxRedirects?: number;
};

export type SafeFetchResponseProfile = "public-html-source" | "public-text-fallback" | "preview-media";

export type SafeFetchFailure =
    | { kind: "unsupported-protocol"; url: string }
    | { kind: "unsafe-network-target"; url: string }
    | { kind: "address-resolution-failed"; url: string }
    | { kind: "redirect-limit-exceeded"; maxRedirects: number }
    | { kind: "invalid-redirect"; url: string }
    | { kind: "http-status"; status: number }
    | { kind: "unsupported-content-type"; contentType: string | null }
    | { kind: "invalid-media-content" }
    | { kind: "response-too-large"; maxResponseBytes: number }
    | { kind: "timeout"; url?: string }
    | { kind: "transport-error" };

export type PublicSourceResponse = {
    originalUrl: string;
    finalUrl: string;
    status: number;
    contentType: string;
    body: Uint8Array;
};

export type SafeFetchResult =
    | { ok: true; response: PublicSourceResponse; permanentRedirects: Array<{ from: string; to: string }> }
    | { ok: false; failure: SafeFetchFailure };

const defaultTimeoutMs = 10_000;
const defaultMaxResponseBytes = 1_048_576;
const defaultMaxRedirects = 5;
// Fetch enough of a large social preview to derive a bounded static thumbnail. The
// bytes retained in PostgreSQL are subject to a much smaller limit downstream.
const previewMediaMaxResponseBytes = 8_388_608;

class TransportTimeoutError extends Error {}
class ResponseTooLargeError extends Error {}

export async function fetchPublicSource(value: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
    const htmlResult = await fetchPublicResource(value, { ...options, responseProfile: "public-html-source" });
    if (!shouldTryTextFallback(htmlResult)) return htmlResult;

    return fetchPublicResource(value, { ...options, responseProfile: "public-text-fallback" });
}

export async function fetchPublicPreviewMedia(value: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
    return fetchPublicResource(value, { ...options, responseProfile: "preview-media", maxResponseBytes: Math.min(options.maxResponseBytes ?? previewMediaMaxResponseBytes, previewMediaMaxResponseBytes) });
}

export async function fetchPublicResource(value: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
    let original: URL;
    try {
        original = new URL(value);
    } catch {
        return { ok: false, failure: { kind: "unsupported-protocol", url: value } };
    }
    if (!isSupportedProtocol(original)) return { ok: false, failure: { kind: "unsupported-protocol", url: original.toString() } };

    const responseProfile = options.responseProfile ?? "public-html-source";
    const timeoutMs = boundedLimit(options.timeoutMs, defaultTimeoutMs);
    const maxResponseBytes = boundedLimit(options.maxResponseBytes, responseProfile === "preview-media" ? previewMediaMaxResponseBytes : defaultMaxResponseBytes);
    const maxRedirects = boundedLimit(options.maxRedirects, defaultMaxRedirects);
    const resolveAddresses = options.resolveAddresses ?? resolvePublicAddresses;
    const transport = options.transport ?? nodeTransport;
    const permanentRedirects: Array<{ from: string; to: string }> = [];
    let current = original;
    let redirects = 0;

    while (true) {
        const addressResult = await resolveSafeAddress(current, resolveAddresses, timeoutMs);
        if (!addressResult.ok) return { ok: false, failure: { kind: addressResult.kind, url: current.toString() } };

        let fetched: Awaited<ReturnType<SafeFetchTransport["fetch"]>>;
        try {
            fetched = await withTimeout(signal => transport.fetch({
                url: current.toString(),
                hostname: hostnameOf(current),
                address: addressResult.address,
                timeoutMs,
                maxResponseBytes,
                accept: acceptHeaderFor(responseProfile),
                signal,
            }), timeoutMs);
        } catch (error) {
            if (error instanceof TransportTimeoutError) return { ok: false, failure: { kind: "timeout" } };
            if (error instanceof ResponseTooLargeError) return { ok: false, failure: { kind: "response-too-large", maxResponseBytes } };
            return { ok: false, failure: { kind: "transport-error" } };
        }

        if (fetched.body.byteLength > maxResponseBytes) {
            return { ok: false, failure: { kind: "response-too-large", maxResponseBytes } };
        }
        if (isRedirect(fetched.status)) {
            if (redirects >= maxRedirects) return { ok: false, failure: { kind: "redirect-limit-exceeded", maxRedirects } };
            const location = fetched.headers.location;
            if (!location) return { ok: false, failure: { kind: "invalid-redirect", url: current.toString() } };
            let destination: URL;
            try {
                destination = new URL(location, current);
            } catch {
                return { ok: false, failure: { kind: "invalid-redirect", url: current.toString() } };
            }
            if (!isSupportedProtocol(destination)) return { ok: false, failure: { kind: "unsupported-protocol", url: destination.toString() } };
            if (fetched.status === 301 || fetched.status === 308) {
                permanentRedirects.push({ from: current.toString(), to: destination.toString() });
            }
            current = destination;
            redirects += 1;
            continue;
        }
        if (fetched.status < 200 || fetched.status >= 300) return { ok: false, failure: { kind: "http-status", status: fetched.status } };

        const contentType = fetched.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() ?? null;
        if (!contentType || !isAllowedContentType(contentType, responseProfile)) {
            return { ok: false, failure: { kind: "unsupported-content-type", contentType } };
        }
        if (responseProfile === "preview-media" && !hasMatchingImageSignature(contentType, fetched.body)) {
            return { ok: false, failure: { kind: "invalid-media-content" } };
        }
        return {
            ok: true,
            response: { originalUrl: original.toString(), finalUrl: current.toString(), status: fetched.status, contentType, body: fetched.body },
            permanentRedirects,
        };
    }
}

export function isPublicIpAddress(address: string): boolean {
    const family = isIP(address);
    if (family === 4) return isPublicIpv4Address(address);
    if (family !== 6) return false;

    const normalized = address.toLowerCase();
    const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    if (mappedIpv4) return isPublicIpv4Address(mappedIpv4);
    const value = ipv6ToBigInt(normalized);
    if (value === undefined) return false;
    const nat64Ipv4 = ipv4FromWellKnownNat64(value);
    if (nat64Ipv4) return isPublicIpv4Address(nat64Ipv4);

    return inIpv6Range(value, "2000::", 3)
        && !inIpv6Range(value, "::", 128)
        && !inIpv6Range(value, "::1", 128)
        && !inIpv6Range(value, "fc00::", 7)
        && !inIpv6Range(value, "fe80::", 10)
        && !inIpv6Range(value, "ff00::", 8)
        && !inIpv6Range(value, "::ffff:0:0", 96)
        && !inIpv6Range(value, "64:ff9b::", 96)
        && !inIpv6Range(value, "64:ff9b:1::", 48)
        && !inIpv6Range(value, "100::", 64)
        && !inIpv6Range(value, "100:0:0:1::", 64)
        && !inIpv6Range(value, "2001::", 23)
        && !inIpv6Range(value, "2001:db8::", 32)
        && !inIpv6Range(value, "2002::", 16)
        && !inIpv6Range(value, "3fff::", 20);
}

function isSupportedProtocol(url: URL): boolean {
    return url.protocol === "http:" || url.protocol === "https:";
}

function isAllowedContentType(contentType: string, responseProfile: SafeFetchResponseProfile): boolean {
    if (responseProfile === "preview-media") return supportedPreviewMediaContentTypes.has(contentType);
    if (responseProfile === "public-html-source") return contentType === "text/html" || contentType === "application/xhtml+xml";
    return supportedTextFallbackContentTypes.has(contentType);
}

const supportedPreviewMediaContentTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/x-icon", "image/vnd.microsoft.icon"]);
const supportedTextFallbackContentTypes = new Set(["text/plain", "text/markdown", "text/x-markdown", "application/markdown"]);

function acceptHeaderFor(responseProfile: SafeFetchResponseProfile): string {
    if (responseProfile === "preview-media") return "image/png, image/jpeg, image/gif, image/webp, image/x-icon, image/vnd.microsoft.icon";
    if (responseProfile === "public-text-fallback") return "text/markdown, text/plain;q=0.9, text/x-markdown;q=0.8, application/markdown;q=0.8";
    return "text/html, application/xhtml+xml;q=0.9";
}

function shouldTryTextFallback(result: SafeFetchResult): boolean {
    if (result.ok) return false;
    if (result.failure.kind === "http-status") return result.failure.status === 406;
    return result.failure.kind === "unsupported-content-type"
        && result.failure.contentType !== null
        && supportedTextFallbackContentTypes.has(result.failure.contentType);
}

function hasMatchingImageSignature(contentType: string, body: Uint8Array): boolean {
    const beginsWith = (...bytes: number[]) => bytes.every((byte, index) => body[index] === byte);
    if (contentType === "image/png") return body.length >= 33
        && beginsWith(137, 80, 78, 71, 13, 10, 26, 10)
        && beginsWithAt(body, 12, 73, 72, 68, 82);
    if (contentType === "image/jpeg") return body.length >= 4 && beginsWith(255, 216, 255)
        && body[body.length - 2] === 255 && body[body.length - 1] === 217;
    if (contentType === "image/gif") return body.length >= 14
        && (beginsWith(71, 73, 70, 56, 55, 97) || beginsWith(71, 73, 70, 56, 57, 97))
        && body[body.length - 1] === 59;
    if (contentType === "image/webp") return beginsWith(82, 73, 70, 70) && body.length >= 12
        && beginsWithAt(body, 8, 87, 69, 66, 80)
        && new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(4, true) + 8 === body.length;
    if (contentType === "image/x-icon" || contentType === "image/vnd.microsoft.icon") {
        return body.length >= 22 && beginsWith(0, 0, 1, 0) && body[4]! > 0;
    }
    return false;
}

function beginsWithAt(body: Uint8Array, offset: number, ...bytes: number[]): boolean {
    return bytes.every((byte, index) => body[offset + index] === byte);
}

function isRedirect(status: number): boolean {
    return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function resolveSafeAddress(url: URL, resolver: (hostname: string) => Promise<string[]>, timeoutMs: number): Promise<{ ok: true; address: string } | { ok: false; kind: "unsafe-network-target" | "address-resolution-failed" | "timeout" }> {
    let addresses: string[];
    try {
        addresses = await withTimeout(() => resolver(hostnameOf(url)), timeoutMs);
    } catch (error) {
        if (error instanceof TransportTimeoutError) return { ok: false, kind: "timeout" };
        return { ok: false, kind: "address-resolution-failed" };
    }
    const address = addresses.find(isPublicIpAddress);
    return address ? { ok: true, address } : { ok: false, kind: "unsafe-network-target" };
}

function boundedLimit(value: number | undefined, maximum: number): number {
    if (!Number.isSafeInteger(value) || value === undefined || value <= 0) return maximum;
    return Math.min(value, maximum);
}

async function resolvePublicAddresses(hostname: string): Promise<string[]> {
    const records = await lookup(hostname, { all: true, verbatim: true });
    return records.map(record => record.address);
}

const nodeTransport: SafeFetchTransport = {
    fetch(target) {
        return new Promise((resolve, reject) => {
            const url = new URL(target.url);
            const request = (url.protocol === "https:" ? requestHttps : requestHttp)({
                hostname: target.address,
                port: url.port || undefined,
                path: `${url.pathname}${url.search}`,
                method: "GET",
                headers: { host: url.host, accept: target.accept },
                servername: url.hostname,
            }, response => {
                const contentLength = Number(response.headers["content-length"]);
                if (Number.isFinite(contentLength) && contentLength > target.maxResponseBytes) {
                    response.destroy();
                    reject(new ResponseTooLargeError());
                    return;
                }
                const chunks: Uint8Array[] = [];
                let size = 0;
                response.on("data", (chunk: Uint8Array) => {
                    size += chunk.byteLength;
                    if (size > target.maxResponseBytes) response.destroy(new ResponseTooLargeError());
                    else chunks.push(chunk);
                });
                response.on("error", reject);
                response.on("end", () => resolve({
                    status: response.statusCode ?? 0,
                    headers: Object.fromEntries(Object.entries(response.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : value])),
                    body: Buffer.concat(chunks),
                }));
            });
            request.setTimeout(target.timeoutMs, () => request.destroy(new TransportTimeoutError()));
            target.signal.addEventListener("abort", () => request.destroy(target.signal.reason), { once: true });
            request.on("error", reject);
            request.end();
        });
    },
};

function isPublicIpv4Address(address: string): boolean {
    const octets = address.split(".").map(Number);
    if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
    const [a, b, c] = octets as [number, number, number, number];
    return a !== 0 && a !== 10 && a !== 127 && a < 224
        && !(a === 100 && b >= 64 && b <= 127)
        && !(a === 169 && b === 254)
        && !(a === 172 && b >= 16 && b <= 31)
        && !(a === 192 && (b === 0 || b === 168
            || (b === 31 && c === 196)
            || (b === 52 && c === 193)
            || (b === 88 && c === 99)
            || (b === 112 && c === 36)
            || (b === 175 && c === 48)
            || (b === 251 && c === 0)))
        && !(a === 198 && (b === 18 || b === 19 || b === 51))
        && !(a === 203 && b === 0 && c === 113);
}

async function withTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            operation(controller.signal),
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => {
                    const error = new TransportTimeoutError();
                    controller.abort(error);
                    reject(error);
                }, timeoutMs);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

function ipv6ToBigInt(address: string): bigint | undefined {
    const [left, right = ""] = address.split("::");
    const leftParts = left ? left.split(":") : [];
    const rightParts = right ? right.split(":") : [];
    if (leftParts.length + rightParts.length > 8) return undefined;
    const parts = [...leftParts, ...Array(8 - leftParts.length - rightParts.length).fill("0"), ...rightParts];
    if (parts.some(part => !/^[0-9a-f]{1,4}$/i.test(part))) return undefined;
    return BigInt(`0x${parts.map(part => part.padStart(4, "0")).join("")}`);
}

function hostnameOf(url: URL): string {
    return url.hostname.replace(/^\[|\]$/g, "");
}

function inIpv6Range(value: bigint, prefix: string, bits: number): boolean {
    const start = ipv6ToBigInt(prefix);
    if (start === undefined) return false;
    const shift = BigInt(128 - bits);
    return (value >> shift) === (start >> shift);
}

function ipv4FromWellKnownNat64(value: bigint): string | undefined {
    if (!inIpv6Range(value, "64:ff9b::", 96)) return undefined;
    const embedded = Number(value & 0xffff_ffffn);
    return [24, 16, 8, 0].map(shift => (embedded >>> shift) & 0xff).join(".");
}
