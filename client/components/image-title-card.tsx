"use client";

import { useState, type ReactNode } from "react";
import { ItemQuickActions } from "@/components/item-quick-actions";
import { SourcePreviewMedia, formatByteSize } from "@/components/source-preview";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { KnowledgeItem, RecallKnowledgeItem } from "@/lib/types";
import { FileText } from "lucide-react";

export function itemSourceName(item: KnowledgeItem | RecallKnowledgeItem) {
  if (item.source.filename !== undefined) return item.source.kind.toUpperCase();
  if (item.sourcePreview?.websiteName) return item.sourcePreview.websiteName;
  try { return new URL(item.source.submittedUrl).hostname.replace(/^www\./, ""); } catch { return "Saved link"; }
}

export function ImageTitleCard({ item, title, onOpen, onTrash, children }: {
  item: KnowledgeItem | RecallKnowledgeItem;
  title: string;
  onOpen?: (id: number) => void;
  onTrash?: (id: number, title: string) => void;
  children?: ReactNode;
}) {
  const file = item.source.filename !== undefined;
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const image = !file && Boolean(item.sourcePreview?.previewImageUrl) && item.sourcePreview?.previewImagePresentation !== "icon" && failedImage !== item.sourcePreview?.previewImageUrl;
  return <Card data-treatment={file ? "document" : image ? "image" : "text"} className="vault-card group/card relative gap-0 overflow-hidden py-0 shadow-none ring-0 dark:ring-0">
    {onOpen && <Button variant="ghost" className="card-open absolute inset-0 z-10 size-full cursor-pointer hover:bg-transparent active:translate-y-0 dark:hover:bg-transparent" aria-label={`View ${title}`} onClick={() => onOpen(item.id)} />}
    {image && <div className="vault-card-media overflow-hidden"><div className="vault-card-image"><SourcePreviewMedia preview={item.sourcePreview} onUnavailable={() => setFailedImage(item.sourcePreview?.previewImageUrl ?? null)} /></div></div>}
    <div className="card-caption">
      {file && <p className="document-format"><FileText aria-hidden="true" className="size-4" />{item.source.kind.toUpperCase()}{formatByteSize(item.source.byteSize) && <span>{formatByteSize(item.source.byteSize)}</span>}</p>}
      <h3 className="card-title">{title}</h3>
      {!file && <p className="card-source">{itemSourceName(item)}</p>}
      {children}
    </div>
    {onTrash && <div className="card-actions absolute right-2 top-2 z-20"><ItemQuickActions item={item} title={title} onTrash={onTrash} /></div>}
  </Card>;
}
