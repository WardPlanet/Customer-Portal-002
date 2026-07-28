import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

// Closest free web equivalent to Planet DDS's primary typeface Eina 03
const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-jakarta',
  display: 'swap',
})

export const metadata: Metadata = {
  title: "Planet DDS Onboarding Portal",
  description: "Planet DDS Client Onboarding Portal",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={jakarta.variable}>
      <body className="bg-white min-h-screen">{children}</body>
    </html>
  );
}
