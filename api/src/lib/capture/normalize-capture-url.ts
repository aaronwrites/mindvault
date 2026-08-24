const trackingParameterNames = new Set([
    "_ga",
    "dclid",
    "fbclid",
    "gclid",
    "mc_cid",
    "mc_eid",
    "msclkid",
]);

export function normalizeCaptureUrl(value: string): string {
    const url = new URL(value);
    url.hash = "";

    for (const parameter of [...url.searchParams.keys()]) {
        const normalizedName = parameter.toLowerCase();
        if (normalizedName.startsWith("utm_") || trackingParameterNames.has(normalizedName)) {
            url.searchParams.delete(parameter);
        }
    }

    return url.toString();
}
