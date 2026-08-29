import { API_URL } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ sourceSnapshotId: string }> }) {
  const { sourceSnapshotId } = await params;
  if (!/^\d+$/.test(sourceSnapshotId)) return new Response(null, { status: 404 });

  const upstream = await fetch(`${API_URL}/source-preview-media/${sourceSnapshotId}`);
  if (!upstream.ok) return new Response(null, { status: upstream.status });

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "Cache-Control": upstream.headers.get("cache-control") ?? "private, max-age=31536000, immutable",
      "Content-Disposition": "inline",
      "Cross-Origin-Resource-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
