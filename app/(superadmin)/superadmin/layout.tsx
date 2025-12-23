'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Shield, Building2, Users, Settings, CreditCard, BarChart3, FileText, Activity, Bell, Search, LogOut, Home } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';

const superAdminMenuItems = [
  { name: 'Overview', href: '/superadmin', icon: BarChart3 },
  { name: 'Organizations', href: '/superadmin/organizations', icon: Building2 },
  { name: 'All Users', href: '/superadmin/users', icon: Users },
  { name: 'Subscriptions', href: '/superadmin/subscriptions', icon: CreditCard },
  { name: 'System Config', href: '/superadmin/config', icon: Settings },
  { name: 'Audit Logs', href: '/superadmin/audit-logs', icon: FileText },
  { name: 'Announcements', href: '/superadmin/announcements', icon: Bell },
  { name: 'System Health', href: '/superadmin/health', icon: Activity },
];

export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const { user, role, signOut, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [isAuthorized, setIsAuthorized] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      if (!user) {
        router.push('/login');
      } else if (role !== 'super_admin') {
        router.push('/dashboard');
      } else {
        setIsAuthorized(true);
      }
    }
  }, [user, role, isLoading, router]);

  if (isLoading || !isAuthorized) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <Shield className="w-16 h-16 text-red-500 mx-auto mb-4 animate-pulse" />
          <p className="text-white">Verifying Super Admin Access...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 flex">
      <aside className="w-64 bg-slate-800 border-r border-slate-700 flex flex-col">
        <div className="h-16 flex items-center justify-center border-b border-slate-700 px-4">
          <div className="flex items-center gap-2">
            <Shield className="w-8 h-8 text-red-500" />
            <div>
              <span className="text-lg font-bold text-white">Super Admin</span>
              <p className="text-xs text-slate-400">System Control Panel</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-3">
          <ul className="space-y-1">
            {superAdminMenuItems.map((item) => {
              const isActive = pathname === item.href || (item.href !== '/superadmin' && pathname?.startsWith(item.href));
              return (
                <li key={item.name}>
                  <Link href={item.href} className={cn('flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all', isActive ? 'bg-red-600 text-white' : 'text-slate-300 hover:bg-slate-700 hover:text-white')}>
                    <item.icon className="w-5 h-5 flex-shrink-0" />
                    <span className="text-sm font-medium">{item.name}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="my-4 border-t border-slate-700" />
          <p className="px-3 text-xs font-medium text-slate-500 uppercase mb-2">Quick Actions</p>
          <ul className="space-y-1">
            <li>
              <Link href="/dashboard" className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-slate-300 hover:bg-slate-700 hover:text-white transition-all">
                <Home className="w-5 h-5" />
                <span className="text-sm font-medium">Back to TMS</span>
              </Link>
            </li>
          </ul>
        </nav>

        <div className="border-t border-slate-700 p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-red-600 rounded-full flex items-center justify-center">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{user?.email}</p>
              <p className="text-xs text-red-400">Super Administrator</p>
            </div>
          </div>
          <button onClick={() => signOut()} className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-slate-300 text-sm transition-all">
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <header className="h-16 bg-slate-800 border-b border-slate-700 flex items-center justify-between px-6">
          <div className="flex items-center gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input type="text" placeholder="Search organizations, users..." className="w-80 pl-10 pr-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent" />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-green-900/50 border border-green-700 rounded-full">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              <span className="text-xs text-green-400">All Systems Operational</span>
            </div>
            <button className="relative p-2 text-slate-400 hover:text-white">
              <Bell className="w-5 h-5" />
              <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
            </button>
          </div>
        </header>
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
