'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function PageContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [animKey, setAnimKey] = useState(0);

  useEffect(() => {
    setAnimKey((k) => k + 1);
  }, [pathname]);

  return (
    <div className="page-animate-enter" key={animKey}>
      {children}
    </div>
  );
}
