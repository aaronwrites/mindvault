"use client";

import { useEffect, useRef, useState } from "react";

function itemFromLocation() {
  const match = window.location.hash.match(/^#item=(\d+)$/);
  const id = match ? Number(match[1]) : null;
  return id && Number.isSafeInteger(id) ? id : null;
}

export function useItemNavigation() {
  const [itemId, setItemId] = useState<number | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const update = () => setItemId(itemFromLocation());
    update();
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  function openItem(id: number) {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.history.pushState({ ...window.history.state, mindvaultDetail: true }, "", `#item=${id}`);
    setItemId(id);
  }
  function closeItem(expectedId?: number, fallbackFocus?: HTMLElement | null) {
    if (expectedId !== undefined && itemFromLocation() !== expectedId) return;
    if (fallbackFocus) returnFocus.current = fallbackFocus;
    if (window.history.state?.mindvaultDetail) window.history.back();
    else {
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
      setItemId(null);
    }
  }
  return { itemId, openItem, closeItem, returnFocus };
}
