import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI固有創造性診断",
  description:
    "AIとの対話から、あなた自身の思考・創造の特性を100要素・10軸の暫定モデルとして可視化します。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
