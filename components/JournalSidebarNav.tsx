'use client';

type NavItem = {
  label: string;
  href?: string;
  external?: boolean;
  active?: boolean;
};

type NavGroup = {
  title: string;
  items: NavItem[];
};

export function JournalSidebarNav({
  clientId,
  active = 'ledger',
}: {
  clientId?: string | null;
  active?: 'ledger' | 'general-ledger' | 'tax-summary' | 'budget' | 'cash-projection' | 'departments' | 'templates' | 'user-roles' | 'ar-ap' | 'edocuments' | 'audit-log';
}) {
  const q = clientId ? `?clientId=${clientId}` : '';

  const groups: NavGroup[] = [
    {
      title: '仕訳・帳簿',
      items: [
        { label: '仕訳日記帳', active: active === 'ledger' },
        { label: '総勘定元帳', href: `/general-ledger${q}`, external: true, active: active === 'general-ledger' },
      ],
    },
    {
      title: 'レポート',
      items: [
        { label: '消費税集計', href: `/tax-summary${q}`, external: true, active: active === 'tax-summary' },
        { label: '予算管理', href: `/budget${q}`, external: true, active: active === 'budget' },
        { label: '資金繰り', href: `/cash-projection${q}`, external: true, active: active === 'cash-projection' },
      ],
    },
    {
      title: 'マスタ管理',
      items: [
        { label: '部門管理', href: `/departments${q}`, external: true, active: active === 'departments' },
        { label: 'テンプレート', href: `/templates${q}`, external: true, active: active === 'templates' },
        { label: 'ユーザー管理', href: `/user-roles${q}`, external: true, active: active === 'user-roles' },
      ],
    },
    {
      title: 'その他',
      items: [
        { label: '消込管理', href: `/ar-ap${q}`, external: true, active: active === 'ar-ap' },
        { label: '電子帳票', href: `/edocuments${q}`, external: true, active: active === 'edocuments' },
        { label: '監査証跡', href: `/audit-log${q}`, external: true, active: active === 'audit-log' },
        { label: 'freee CSV出力', href: `/api/export?format=freee${clientId ? `&clientId=${clientId}` : ''}`, external: true },
      ],
    },
  ];

  return (
    <aside className="hidden md:block w-[220px] shrink-0">
      <nav className="bg-white border border-slate-100 rounded-2xl p-3 shadow-sm sticky top-4 space-y-4">
        {groups.map((g) => (
          <div key={g.title}>
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest px-2 pb-1.5">
              {g.title}
            </p>
            <ul className="space-y-0.5">
              {g.items.map((item) => {
                const baseCls = 'block text-xs px-2.5 py-2 rounded-lg transition-all';
                const activeCls = 'bg-sky-50 text-sky-700 font-semibold';
                const idleCls = 'text-slate-600 hover:bg-slate-50 hover:text-slate-900';
                const cls = `${baseCls} ${item.active ? activeCls : idleCls}`;
                if (!item.href) {
                  return (
                    <li key={item.label}>
                      <span className={`${cls} cursor-default`}>{item.label}</span>
                    </li>
                  );
                }
                return (
                  <li key={item.label}>
                    <a
                      href={item.href}
                      target={item.external ? '_blank' : undefined}
                      rel={item.external ? 'noopener noreferrer' : undefined}
                      className={cls}
                    >
                      {item.label}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
