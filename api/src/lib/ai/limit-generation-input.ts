export const MAXIMUM_GENERATION_INPUT_BYTES = 28_000;

const OMITTED_CONTENT_NOTICE = "\n\n[Additional Source content was omitted because it exceeds the generation input limit.]";

/**
 * Preserves the beginning of a prompt, where its instructions and source
 * attribution live, while dropping overflow without splitting UTF-8 text.
 */
export function limitGenerationInput(prompt: string, closingInstructions = "", options: { requireComplete?: boolean } = {}): string {
    const encoder = new TextEncoder();
    const promptBudget = MAXIMUM_GENERATION_INPUT_BYTES - encoder.encode(closingInstructions).byteLength;
    if (promptBudget < encoder.encode(OMITTED_CONTENT_NOTICE).byteLength) throw new Error("Generation instructions exceed the input budget");
    if (encoder.encode(prompt).byteLength <= promptBudget) return prompt + closingInstructions;

    if (options.requireComplete) throw new Error("PDF evidence exceeds the generation input limit; whole-document enrichment was not generated");

    const contentBudget = promptBudget - encoder.encode(OMITTED_CONTENT_NOTICE).byteLength;
    let bytes = 0;
    let prefix = "";
    for (const character of prompt) {
        const characterBytes = encoder.encode(character).byteLength;
        if (bytes + characterBytes > contentBudget) break;
        prefix += character;
        bytes += characterBytes;
    }
    return `${prefix}${OMITTED_CONTENT_NOTICE}${closingInstructions}`;
}
