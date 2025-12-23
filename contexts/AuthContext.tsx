'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';

interface User {
  id: string;
  email: string;
  full_name?: string;
}

interface AuthContextType {
  user: User | null;
  role: string | null;
  organizationId: string | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    checkUser();
  }, []);

  const checkUser = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const { data: userData } = await supabase
          .from('users')
          .select('id, email, full_name, role, organization_id')
          .eq('email', session.user.email)
          .single();

        if (userData) {
          setUser({ id: userData.id, email: userData.email, full_name: userData.full_name });
          setRole(userData.role);
          setOrganizationId(userData.organization_id);
        } else {
          setUser({ id: session.user.id, email: session.user.email || '' });
        }
      }
    } catch (error) {
      console.error('Auth error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const signIn = async (email: string, password: string) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { error: error.message };

      if (data.user) {
        const { data: userData } = await supabase
          .from('users')
          .select('id, email, full_name, role, organization_id')
          .eq('email', data.user.email)
          .single();

        if (userData) {
          setUser({ id: userData.id, email: userData.email, full_name: userData.full_name });
          setRole(userData.role);
          setOrganizationId(userData.organization_id);
        } else {
          setUser({ id: data.user.id, email: data.user.email || '' });
        }
      }
      return {};
    } catch (error: any) {
      return { error: error.message };
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setRole(null);
    setOrganizationId(null);
    router.push('/login');
  };

  const hasPermission = (permission: string) => {
    if (role === 'super_admin') return true;
    if (role === 'org_admin') return true;
    return false;
  };

  return (
    <AuthContext.Provider value={{ user, role, organizationId, isLoading, signIn, signOut, hasPermission }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
