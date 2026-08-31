import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { BrandingProvider } from "@/components/branding";

const inter = Inter({ subsets: ["latin"] });
export const metadata: Metadata = { title: "JPI Fiscal", description: "Gestão escolar e fiscal" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body className={inter.className}><BrandingProvider>{children}</BrandingProvider></body></html>;
}

