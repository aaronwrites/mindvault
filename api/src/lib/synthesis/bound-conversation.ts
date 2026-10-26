import type { SynthesisConversationTurn, SynthesisGenerationInput } from "../ai/providers";

/** History is interpretation context, so retain recent turns within a byte budget. */
export function boundConversation(conversation: SynthesisConversationTurn[]): SynthesisConversationTurn[] {
    const bounded: SynthesisConversationTurn[] = [];
    for (const turn of conversation.slice(-6).reverse()) {
        const candidate = {
            question: utf8Prefix(turn.question, 2_000),
            answer: utf8Prefix(turn.answer, 1_000),
        };
        if (Buffer.byteLength(JSON.stringify([candidate, ...bounded])) > 6_000) break;
        bounded.unshift(candidate);
    }
    return bounded;
}

export function utf8Prefix(value: string, maximumBytes: number): string {
    let prefix = "";
    let bytes = 0;
    for (const character of value) {
        bytes += Buffer.byteLength(character);
        if (bytes > maximumBytes) break;
        prefix += character;
    }
    return prefix;
}

/** Keep the actual supplied evidence and returned citation excerpts in agreement. */
export function boundSynthesisInput(input: SynthesisGenerationInput): SynthesisGenerationInput {
    const context: SynthesisGenerationInput = { ...input, conversation: boundConversation(input.conversation), evidence: [] };
    const maximumContextBytes = 26_000; // The provider reserves 2,000 bytes for grounding instructions.
    for (const item of input.evidence) {
        let text = item.text;
        while (text) {
            const candidate = { ...item, text };
            const bytes = Buffer.byteLength(JSON.stringify({ ...context, evidence: [...context.evidence, candidate] }));
            if (bytes <= maximumContextBytes) {
                context.evidence.push(candidate);
                break;
            }
            text = utf8Prefix(text, Math.max(0, Buffer.byteLength(text) - Math.max(256, bytes - maximumContextBytes)));
        }
    }
    return context;
}
