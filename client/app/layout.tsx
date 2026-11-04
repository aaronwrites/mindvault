import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Providers } from "./providers";
import { themeInitializationScript } from "@/lib/theme";

const lora = localFont({ src: "../public/fonts/lora-variable.ttf", variable: "--font-lora", display: "swap", weight: "400 700", fallback: ["Georgia", "serif"] });
const manrope = localFont({ src: "../public/fonts/manrope-variable.ttf", variable: "--font-manrope", display: "swap", weight: "200 800", fallback: ["Arial", "sans-serif"] });

export const metadata: Metadata = {
  title: "MindVault",
  description: "Capture useful knowledge and recall it when it matters.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${lora.variable} ${manrope.variable} h-full antialiased`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeInitializationScript }} /></head>
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
