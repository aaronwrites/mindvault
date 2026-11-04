"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Row spans keep a variable-height collection in its original reading order. */
export function CollectionGrid({ children, list = false }: { children: ReactNode; list?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const grid = ref.current;
    if (!grid || list || typeof ResizeObserver === "undefined") return;
    const size = () => {
      for (const cell of Array.from(grid.children)) {
        const content = cell.firstElementChild;
        if (cell instanceof HTMLElement && content) {
          cell.style.gridRowEnd = `span ${Math.ceil((content.getBoundingClientRect().height + 24) / 8)}`;
        }
      }
      grid.dataset.measured = "true";
    };
    const observer = new ResizeObserver(size);
    for (const cell of Array.from(grid.children)) if (cell.firstElementChild) observer.observe(cell.firstElementChild);
    size();
    return () => observer.disconnect();
  }, [children, list]);
  return <div ref={ref} className={list ? "result-list" : "collection-grid"}>{children}</div>;
}
