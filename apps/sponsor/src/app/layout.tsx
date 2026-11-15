import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { RootDocument } from '@tomoni/web-shared/root';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Tomoni research partners', template: '%s · Tomoni research partners' },
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: ReactNode }) {
  return <RootDocument>{children}</RootDocument>;
}
