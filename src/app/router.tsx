import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

export function navigate(path: string, replace = false) {
  if (replace) history.replaceState({}, '', path);
  else history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function usePathname() {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const handler = () => setPath(window.location.pathname);
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);
  return path;
}

export function AppLink({ href, children, className = '', onClick }: { href: string; children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <a href={href} className={className} onClick={(event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      onClick?.();
      navigate(href);
    }}>{children}</a>
  );
}
