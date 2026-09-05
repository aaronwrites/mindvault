import { describe, expect, test } from "bun:test";
import { safeDeliveryFilename } from "../src/lib/original-files/create-original-file-access";

describe("Original File delivery filenames", () => {
    test("removes path components, control characters, unsafe separators, and misleading whitespace", () => {
        expect(safeDeliveryFilename("../folder/  proposal\r\n; v1?.pdf  ", "pdf")).toBe("proposal- v1-.pdf");
    });

    test("uses a recognizable Source Kind fallback when the submitted filename is unusable", () => {
        expect(safeDeliveryFilename("../../", "plain-text")).toBe("original-file.txt");
    });
});
