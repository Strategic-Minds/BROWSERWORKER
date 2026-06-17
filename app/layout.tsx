import type { ReactNode } from 'react';

export const metadata = {
  title: 'Browser Worker',
  description: 'Chromium-capable validation worker'
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
