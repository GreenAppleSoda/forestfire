import type { Metadata } from "next";
import { Noto_Sans_KR, Outfit } from "next/font/google";
import { ChatWidget } from "@/components/ChatWidget";
import { AuthProvider } from "@/lib/authContext";
import "./globals.css";

const display = Outfit({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["600", "700"],
});

const sans = Noto_Sans_KR({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "대한민국 산불예보 웹서비스",
  description:
    "시도별 산불 발생 밀도와 최근 산불 이력·매칭 산 정보를 확인합니다.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className={`${display.variable} ${sans.variable} antialiased`}>
        <AuthProvider>
          {children}
          <ChatWidget />
        </AuthProvider>
      </body>
    </html>
  );
}
