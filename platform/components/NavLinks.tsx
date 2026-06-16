'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type NavLinkItem = {
  href: string;
  label: string;
};

export default function NavLinks({ links }: { links: NavLinkItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="nav">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={`nav-link${pathname === link.href ? ' nav-link-active' : ''}`}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}