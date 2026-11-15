import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ASFAI Information Integrity",
  description: "An MCP server over the organizations in the Information Integrity Navigator.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
