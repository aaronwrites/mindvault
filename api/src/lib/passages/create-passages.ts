const maximumPassageLength = 1_000;

export function createPassageTexts(text: string): string[] {
    const remaining = text.trim();
    if (!remaining) return [];
    if (remaining.length <= maximumPassageLength) return [remaining];

    const passages: string[] = [];
    let start = 0;
    while (start < remaining.length) {
        const end = Math.min(start + maximumPassageLength, remaining.length);
        const boundary = end === remaining.length ? end : whitespaceBoundaryBefore(remaining, end);
        passages.push(remaining.slice(start, boundary).trim());
        start = boundary;
        while (/\s/.test(remaining[start] ?? "")) start += 1;
    }
    return passages;
}

function whitespaceBoundaryBefore(text: string, end: number): number {
    for (let index = end - 1; index > 0; index -= 1) {
        if (/\s/.test(text[index]!)) return index;
    }
    return end;
}
