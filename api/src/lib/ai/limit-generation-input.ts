export const MAXIMUM_GENERATION_INPUT_BYTES = 28_000;

const OMITTED_CONTENT_NOTICE = "\n\n[Additional Source content was omitted because it exceeds the generation input limit.]";

/**
 * Preserves the beginning of a prompt, where its instructions and source
 * attribution live, while dropping overflow without splitting UTF-8 text.
 */
export function limitGenerationInput(prompt: string): string {
    const encoder = new TextEncoder();
    if (encoder.encode(prompt).byteLength <= MAXIMUM_GENERATION_INPUT_BYTES) return prompt;

    const contentBudget = MAXIMUM_GENERATION_INPUT_BYTES - encoder.encode(OMITTED_CONTENT_NOTICE).byteLength;
    let bytes = 0;
    let prefix = "";
    for (const character of prompt) {
        const characterBytes = encoder.encode(character).byteLength;
        if (bytes + characterBytes > contentBudget) break;
        prefix += character;
        bytes += characterBytes;
    }
    return `${prefix}${OMITTED_CONTENT_NOTICE}`;
}
