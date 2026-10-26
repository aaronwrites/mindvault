import { OPS, Util } from "pdfjs-dist/legacy/build/pdf.mjs";

// A native footer/watermark does not establish that a page-sized scan was read.
// Count drawn image area in PDF coordinates, including tiled/repeated images.
export function hasSubstantialRaster(page, operations) {
    const pageArea = (page.view[2] - page.view[0]) * (page.view[3] - page.view[1]);
    let matrix = [1, 0, 0, 1, 0, 0];
    const stack = [];
    let area = 0;
    const addImage = transform => {
        area += Math.abs(transform[0] * transform[3] - transform[1] * transform[2]);
    };
    for (let index = 0; index < operations.fnArray.length; index++) {
        const operation = operations.fnArray[index];
        const args = operations.argsArray[index];
        if (operation === OPS.save || operation === OPS.paintFormXObjectBegin) {
            stack.push(matrix);
            if (operation === OPS.paintFormXObjectBegin && args[0]) matrix = Util.transform(matrix, args[0]);
        } else if (operation === OPS.restore || operation === OPS.paintFormXObjectEnd) {
            matrix = stack.pop() ?? [1, 0, 0, 1, 0, 0];
        } else if (operation === OPS.transform) {
            matrix = Util.transform(matrix, args);
        } else if ([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject].includes(operation)) {
            addImage(matrix);
        } else if (operation === OPS.paintImageXObjectRepeat) {
            for (let offset = 0; offset < args[3].length; offset += 2) {
                addImage(Util.transform(matrix, [args[1], 0, 0, args[2], args[3][offset], args[3][offset + 1]]));
            }
        } else if (operation === OPS.paintInlineImageXObjectGroup) {
            for (const image of args[1]) addImage(Util.transform(matrix, image.transform));
        }
        if (area >= pageArea * 0.25) return true;
    }
    return false;
}
