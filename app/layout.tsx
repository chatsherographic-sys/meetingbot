import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Recall Zoom Bot Control Panel",
  description: "Local MVP for Recall.ai transcript trigger testing",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
