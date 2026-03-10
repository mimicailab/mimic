import type { ExplorerConfig } from '@/lib/api';
import type { Page } from '@/App';

interface HeaderProps {
  config: ExplorerConfig;
  page: Page;
  onNavigate: (page: Page) => void;
}

export function Header({ config, page, onNavigate }: HeaderProps) {
  const breadcrumbs = getBreadcrumbs(page);

  return (
    <header className="flex h-14 items-center justify-between border-b px-6">
      <div className="flex items-center gap-2 text-sm">
        {breadcrumbs.map((crumb, i) => (
          <span key={i} className="flex items-center gap-2">
            {i > 0 && <span className="text-muted-foreground">/</span>}
            {crumb.onClick ? (
              <button
                onClick={crumb.onClick}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                {crumb.label}
              </button>
            ) : (
              <span className="font-medium">{crumb.label}</span>
            )}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs font-mono text-muted-foreground">
          {config.domain}
        </span>
      </div>
    </header>
  );
}

function getBreadcrumbs(page: Page): Array<{ label: string; onClick?: () => void }> {
  switch (page.type) {
    case 'dashboard':
      return [{ label: 'Dashboard' }];
    case 'adapter':
      return [{ label: 'Adapters' }, { label: page.adapterId }];
    case 'data':
      return [
        { label: 'Data' },
        { label: page.persona },
        ...(page.source ? [{ label: page.source }] : []),
        ...(page.resource ? [{ label: page.resource }] : []),
      ];
    case 'tester':
      return [{ label: 'Adapters' }, { label: page.adapterId }, { label: 'Test' }];
  }
}
