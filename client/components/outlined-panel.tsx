import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function OutlinedPanel({ title, children, className, ...props }: Omit<ComponentProps<"section">, "title"> & { title: ReactNode }) {
  return <section className={cn("content-section", className)} {...props}>
    <h3 className="section-label">{title}</h3>
    {children}
  </section>;
}
