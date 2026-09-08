import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "คลินิกหมอปิยะพันธ์ | ClinicCare",
  description: "ระบบจองคิวและบริการผู้ป่วยของคลินิกหมอปิยะพันธ์",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
