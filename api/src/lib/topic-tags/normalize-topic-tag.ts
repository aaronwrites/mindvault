export function normalizeTopicTagAlias(value: string): string {
    return value
        .normalize("NFKC")
        .trim()
        .toLocaleLowerCase("en-US")
        .replace(/[\s\-_]+/g, " ")
        .replace(/\s+/g, " ");
}

export function displayTopicTagName(value: string): string {
    return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}
