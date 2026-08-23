import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Estrellas del Equipo",
  description: "Evaluaciones de equipo y distribución transparente de propinas con datos reales.",
  openGraph: {
    title: "Estrellas del Equipo",
    description: "Evaluaciones de equipo y distribución transparente de propinas con datos reales.",
    images: [{ url: "/team-service-ledger.png", width: 1536, height: 1024, alt: "Seis estrellas sobre una libreta de servicio" }],
    locale: "es_CL",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Estrellas del Equipo",
    description: "Evaluaciones de equipo y distribución transparente de propinas con datos reales.",
    images: ["/team-service-ledger.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
