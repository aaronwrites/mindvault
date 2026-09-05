import { parse } from "parse5";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

type HtmlNode = {
    nodeName?: string;
    tagName?: string;
    value?: string;
    attrs?: Array<{ name: string; value: string }>;
    childNodes?: HtmlNode[];
};

export type ExtractedSourcePreview = {
    title: string;
    description: string | null;
    websiteName: string | null;
    author: string | null;
    publishedAt: string | null;
    contentType: string | null;
    previewImageUrl: string | null;
    previewImageAlt: string | null;
    faviconUrl: string | null;
};

export type ParsedPublicTextualSource = {
    title: string;
    primaryText: string | null;
    canonicalUrl: string | null;
    sourcePreview: ExtractedSourcePreview;
    failureReason: string | null;
};

export function parsePublicTextualSource(html: string, finalUrl: string): ParsedPublicTextualSource {
    const document = parse(html) as unknown as HtmlNode;
    const elements = descendants(document);
    const meta = metadata(elements);
    const structured = structuredArticleData(elements);
    const extractionTitle = firstUsable(textOf(firstElement(elements, "h1")), textOf(firstElement(elements, "title")));
    const semanticPrimaryRoot = firstElement(elements, "article") ?? firstElement(elements, "main");
    const primaryRoot = semanticPrimaryRoot ?? firstElement(elements, "body") ?? document;
    const primaryText = withoutRepeatedTitle(
        semanticPrimaryRoot ? cleanText(primaryRoot) : readabilityText(html) ?? cleanText(primaryRoot),
        extractionTitle,
    );
    const previewTitle = firstUsable(meta.get("og:title"), structured.headline, extractionTitle, readableHostname(finalUrl));
    const qualityFailure = qualityFailureFor(elements, primaryText, extractionTitle);

    const canonicalUrl = absoluteHttpUrl(meta.get("link:canonical"), finalUrl);
    const title = previewTitle!;
    return {
        title: extractionTitle ?? title,
        primaryText: qualityFailure ? null : primaryText,
        canonicalUrl,
        sourcePreview: {
            title,
            description: firstUsable(meta.get("og:description"), meta.get("description"), structured.description),
            websiteName: firstUsable(meta.get("og:site_name"), structured.publisher),
            author: firstUsable(meta.get("article:author"), meta.get("author"), structured.author),
            publishedAt: validPublicationDate(firstUsable(meta.get("article:published_time"), meta.get("date"), meta.get("datepublished"), structured.datePublished))?.toISOString() ?? null,
            contentType: firstUsable(meta.get("og:type"), structured.type),
            previewImageUrl: absoluteHttpUrl(firstUsable(meta.get("og:image"), meta.get("twitter:image"), structured.image), finalUrl),
            previewImageAlt: firstUsable(meta.get("og:image:alt"), meta.get("twitter:image:alt"), structured.imageAlt),
            faviconUrl: absoluteHttpUrl(meta.get("link:icon"), finalUrl),
        },
        failureReason: qualityFailure ?? null,
    };
}

function readabilityText(html: string): string | null {
    try {
        const article = new Readability(parseHTML(html).document).parse();
        return article?.textContent?.replace(/\s+/g, " ").trim() || null;
    } catch {
        return null;
    }
}

function descendants(root: HtmlNode): HtmlNode[] {
    const result: HtmlNode[] = [];
    const visit = (node: HtmlNode) => {
        result.push(node);
        node.childNodes?.forEach(visit);
    };
    visit(root);
    return result;
}

function firstElement(nodes: HtmlNode[], tagName: string): HtmlNode | undefined {
    return nodes.find(node => node.tagName === tagName);
}

function metadata(nodes: HtmlNode[]): Map<string, string> {
    const values = new Map<string, string>();
    for (const node of nodes) {
        if (node.tagName === "meta") {
            const attributes = attributesFor(node);
            const key = (attributes.get("property") ?? attributes.get("name") ?? "").toLowerCase();
            const content = attributes.get("content");
            if (key && content && !values.has(key)) values.set(key, content);
        }
        if (node.tagName === "link") {
            const attributes = attributesFor(node);
            const rel = (attributes.get("rel") ?? "").toLowerCase().split(/\s+/);
            const href = attributes.get("href");
            if (href && rel.includes("canonical") && !values.has("link:canonical")) values.set("link:canonical", href);
            if (href && rel.some(value => value === "icon" || value === "shortcut" || value === "apple-touch-icon") && !values.has("link:icon")) values.set("link:icon", href);
        }
    }
    return values;
}

function attributesFor(node: HtmlNode): Map<string, string> {
    return new Map((node.attrs ?? []).map(attribute => [attribute.name.toLowerCase(), attribute.value.trim()]));
}

function textOf(node: HtmlNode | undefined): string | null {
    return node ? cleanText(node) : null;
}

function cleanText(node: HtmlNode): string {
    const collect = (current: HtmlNode): string => isBoilerplate(current)
        ? ""
        : current.nodeName === "#text"
        ? current.value ?? ""
        : (current.childNodes ?? []).map(collect).join(" ");
    return collect(node).replace(/\s+/g, " ").trim();
}

function isBoilerplate(node: HtmlNode): boolean {
    if (["script", "style", "noscript", "nav", "header", "footer", "aside", "form"].includes(node.tagName ?? "")) return true;
    const attributes = attributesFor(node);
    return /\b(navigation|menu|cookie|consent|banner|sidebar|related|footer)\b/i.test(
        [attributes.get("class"), attributes.get("id"), attributes.get("role")].filter(Boolean).join(" "),
    );
}

function withoutRepeatedTitle(primaryText: string, title: string | null): string {
    return title && primaryText.startsWith(title) ? primaryText.slice(title.length).trim() : primaryText;
}

function firstUsable(...candidates: Array<string | null | undefined>): string | null {
    for (const candidate of candidates) {
        const value = candidate?.replace(/\s+/g, " ").trim();
        if (!value || value.length > 500 || /^(home|untitled|default|website|loading|index)$/i.test(value)) continue;
        return value;
    }
    return null;
}

function absoluteHttpUrl(value: string | null | undefined, baseUrl: string): string | null {
    if (!value) return null;
    try {
        const url = new URL(value, baseUrl);
        return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
    } catch {
        return null;
    }
}

function readableHostname(address: string): string | null {
    try {
        return new URL(address).hostname.replace(/^www\./, "") || null;
    } catch {
        return null;
    }
}

function validPublicationDate(value: string | null): Date | null {
    if (!value || value.length > 100) return null;
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (dateOnly) {
        const date = new Date(`${value}T00:00:00.000Z`);
        return date.getUTCFullYear() === Number(dateOnly[1]) && date.getUTCMonth() + 1 === Number(dateOnly[2]) && date.getUTCDate() === Number(dateOnly[3]) ? date : null;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function qualityFailureFor(elements: HtmlNode[], primaryText: string, extractionTitle: string | null): string | undefined {
    const surfaceText = `${textOf(firstElement(elements, "title")) ?? ""} ${textOf(firstElement(elements, "h1")) ?? ""}`.toLowerCase();
    const pageText = cleanText(firstElement(elements, "body") ?? { childNodes: elements }).toLowerCase();
    const hasPasswordForm = elements.some(node => node.tagName === "input" && attributesFor(node).get("type")?.toLowerCase() === "password");
    if (hasPasswordForm && /\b(sign in|log in|authentication required)\b/.test(surfaceText)) return "This Source requires authentication";
    if (/\b(verify you are human|bot challenge)\b/.test(surfaceText) && /\b(captcha|challenge)\b/.test(pageText)) return "This Source is protected by a bot challenge";
    if (/\b(subscriber|subscription|subscribe|paywall)\b/.test(surfaceText) && /\b(subscribe to continue|subscription required)\b/.test(pageText)) return "This Source is behind a paywall";
    if (/\b(page not found|not found|something went wrong|internal server error)\b/.test(surfaceText)) return "This Source appears to be an error page";
    if (primaryText.length < 120) return "This Source has inadequate meaningful text";
    return undefined;
}

function structuredArticleData(nodes: HtmlNode[]) {
    const scripts = nodes.filter(node => node.tagName === "script" && attributesFor(node).get("type")?.toLowerCase() === "application/ld+json");
    for (const script of scripts) {
        try {
            const parsed = JSON.parse(rawTextOf(script)) as unknown;
            const candidates = jsonObjects(parsed);
            const article = candidates.find(candidate => typeIncludes(candidate, "article") || typeIncludes(candidate, "newsarticle"));
            if (!article) continue;
            return {
                headline: stringValue(article.headline), description: stringValue(article.description),
                author: stringValue(article.author?.name ?? article.author), datePublished: stringValue(article.datePublished),
                image: stringValue(article.image?.url ?? article.image), imageAlt: stringValue(article.image?.caption),
                publisher: stringValue(article.publisher?.name ?? article.publisher), type: stringValue(article["@type"]),
            };
        } catch { /* Invalid structured data is optional Source Preview input. */ }
    }
    return {};
}

function rawTextOf(node: HtmlNode): string {
    return (node.childNodes ?? []).map(child => child.nodeName === "#text" ? child.value ?? "" : rawTextOf(child)).join("");
}

function jsonObjects(value: unknown): Array<Record<string, any>> {
    if (Array.isArray(value)) return value.flatMap(jsonObjects);
    if (!value || typeof value !== "object") return [];
    const object = value as Record<string, any>;
    return [object, ...jsonObjects(object["@graph"])];
}

function typeIncludes(value: Record<string, any>, expected: string): boolean {
    const types = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
    return types.some(type => typeof type === "string" && type.toLowerCase() === expected);
}

function stringValue(value: unknown): string | null {
    return typeof value === "string" ? value : null;
}
