import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

const metadataBase = new URL(process.env.SITE_ORIGIN ?? 'http://localhost:3000');
const socialImage = new URL('/og.png', metadataBase).toString();

export const metadata: Metadata = {
  metadataBase,
  title: 'Watercooler Werewolf',
  description:
    'A month-long office Werewolf game with private roles, official ballots, and moderator-reviewed outcomes.',
  icons: { icon: '/favicon.svg' },
  openGraph: {
    type: 'website',
    title: 'Watercooler Werewolf',
    description: 'Private roles. Official ballots. One delightfully suspicious office campaign.',
    images: [{ url: socialImage, width: 1731, height: 909, alt: 'Watercooler Werewolf office game' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Watercooler Werewolf',
    description: 'Private roles. Official ballots. One delightfully suspicious office campaign.',
    images: [socialImage],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
