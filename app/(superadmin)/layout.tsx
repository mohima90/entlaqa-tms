import { AuthProvider } from '@/contexts/AuthContext';

export const dynamic = 'force-dynamic';

export default function SuperAdminRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      {children}
    </AuthProvider>
  );
}
