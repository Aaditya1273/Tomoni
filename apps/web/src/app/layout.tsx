import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { RootDocument } from '@tomoni/web-shared/root';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Tomoni', template: '%s · Tomoni' },
  description: 'The care team between doctor visits.',
  applicationName: 'Tomoni',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f6fb' },
    { media: '(prefers-color-scheme: dark)', color: '#0f1230' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export default function Layout({ children }: { children: ReactNode }) {
  return <RootDocument>{children}</RootDocument>;
}
