import type { ReactNode } from 'react';
import Header from './Header';
import TabNav from './TabNav';

interface LayoutProps {
  children: ReactNode;
  headerRight?: { label: string; onClick?: () => void };
}

export default function Layout({ children, headerRight }: LayoutProps) {
  return (
    <div className="flex flex-col min-h-screen bg-gray-bg">
      <Header rightAction={headerRight ?? { label: '편입 가이드' }} />
      <TabNav />
      <main className="flex-1 overflow-y-auto pb-6">{children}</main>
    </div>
  );
}
