'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase';

// Generic fetch hook
interface UseFetchOptions<T> {
  initialData?: T;
  enabled?: boolean;
}

interface UseFetchResult<T> {
  data: T | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useFetch<T>(
  fetcher: () => Promise<T>,
  deps: any[] = [],
  options: UseFetchOptions<T> = {}
): UseFetchResult<T> {
  const { initialData = null, enabled = true } = options;
  const [data, setData] = useState<T | null>(initialData);
  const [isLoading, setIsLoading] = useState(enabled);
  const [error, setError] = useState<Error | null>(null);

  const fetch = useCallback(async () => {
    if (!enabled) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await fetcher();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('An error occurred'));
    } finally {
      setIsLoading(false);
    }
  }, [fetcher, enabled]);

  useEffect(() => {
    fetch();
  }, [...deps, fetch]);

  return { data, isLoading, error, refetch: fetch };
}

// Supabase specific hooks
export function useSupabaseQuery<T>(
  table: string,
  options?: {
    select?: string;
    filters?: Record<string, any>;
    order?: { column: string; ascending?: boolean };
    limit?: number;
    enabled?: boolean;
  }
) {
  const { select = '*', filters = {}, order, limit, enabled = true } = options || {};

  const fetcher = useCallback(async () => {
    const supabase = createClient();
    let query = supabase.from(table).select(select);

    // Apply filters
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        query = query.eq(key, value);
      }
    });

    // Apply ordering
    if (order) {
      query = query.order(order.column, { ascending: order.ascending ?? true });
    }

    // Apply limit
    if (limit) {
      query = query.limit(limit);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data as T[];
  }, [table, select, JSON.stringify(filters), JSON.stringify(order), limit]);

  return useFetch(fetcher, [table, select, JSON.stringify(filters)], { enabled });
}

// Mutation hook
interface UseMutationOptions<T, V> {
  onSuccess?: (data: T) => void;
  onError?: (error: Error) => void;
}

interface UseMutationResult<T, V> {
  mutate: (variables: V) => Promise<T | null>;
  isLoading: boolean;
  error: Error | null;
  data: T | null;
  reset: () => void;
}

export function useMutation<T, V>(
  mutationFn: (variables: V) => Promise<T>,
  options: UseMutationOptions<T, V> = {}
): UseMutationResult<T, V> {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [data, setData] = useState<T | null>(null);

  const mutate = useCallback(async (variables: V) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await mutationFn(variables);
      setData(result);
      options.onSuccess?.(result);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('An error occurred');
      setError(error);
      options.onError?.(error);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [mutationFn, options.onSuccess, options.onError]);

  const reset = useCallback(() => {
    setData(null);
    setError(null);
  }, []);

  return { mutate, isLoading, error, data, reset };
}

// Specific data hooks
export function useCourses(organizationId?: string) {
  return useSupabaseQuery<any>('courses', {
    filters: organizationId ? { organization_id: organizationId } : {},
    order: { column: 'created_at', ascending: false },
  });
}

export function useSessions(options?: { courseId?: string; status?: string }) {
  return useSupabaseQuery<any>('sessions', {
    filters: {
      ...(options?.courseId && { course_id: options.courseId }),
      ...(options?.status && { status: options.status }),
    },
    order: { column: 'start_date', ascending: true },
  });
}

export function useLearners(options?: { departmentId?: string; status?: string }) {
  return useSupabaseQuery<any>('users', {
    filters: {
      role: 'learner',
      ...(options?.departmentId && { department_id: options.departmentId }),
      ...(options?.status && { status: options.status }),
    },
    order: { column: 'full_name', ascending: true },
  });
}

export function useVenues(organizationId?: string) {
  return useSupabaseQuery<any>('venues', {
    filters: organizationId ? { organization_id: organizationId } : {},
    order: { column: 'name', ascending: true },
  });
}

export function useInstructors(options?: { type?: string; status?: string }) {
  return useSupabaseQuery<any>('instructors', {
    filters: {
      ...(options?.type && { instructor_type: options.type }),
      ...(options?.status && { status: options.status }),
    },
    order: { column: 'full_name', ascending: true },
  });
}

export function useCertificates(options?: { learnerId?: string; courseId?: string }) {
  return useSupabaseQuery<any>('certificates', {
    filters: {
      ...(options?.learnerId && { learner_id: options.learnerId }),
      ...(options?.courseId && { course_id: options.courseId }),
    },
    order: { column: 'issue_date', ascending: false },
  });
}

export function useAttendance(sessionId: string) {
  return useSupabaseQuery<any>('attendance', {
    filters: { session_id: sessionId },
    order: { column: 'created_at', ascending: true },
  });
}

// Dashboard stats hook
export function useDashboardStats() {
  const fetcher = useCallback(async () => {
    const supabase = createClient();
    
    // Get counts
    const [coursesResult, sessionsResult, learnersResult, certificatesResult] = await Promise.all([
      supabase.from('courses').select('id, data_source', { count: 'exact' }),
      supabase.from('sessions').select('id, data_source', { count: 'exact' }),
      supabase.from('users').select('id, data_source', { count: 'exact' }).eq('role', 'learner'),
      supabase.from('certificates').select('id, data_source', { count: 'exact' }),
    ]);

    return {
      courses: {
        total: coursesResult.count || 0,
        // Added (c: any) to fix build error
        offline: coursesResult.data?.filter((c: any) => c.data_source === 'offline').length || 0,
        lms: coursesResult.data?.filter((c: any) => c.data_source === 'lms').length || 0,
      },
      sessions: {
        total: sessionsResult.count || 0,
        // Added (s: any) to fix build error
        offline: sessionsResult.data?.filter((s: any) => s.data_source === 'offline').length || 0,
        lms: sessionsResult.data?.filter((s: any) => s.data_source === 'lms').length || 0,
      },
      learners: {
        total: learnersResult.count || 0,
        // Added (l: any) to fix build error
        offline: learnersResult.data?.filter((l: any) => l.data_source === 'offline').length || 0,
        lms: learnersResult.data?.filter((l: any) => l.data_source === 'lms').length || 0,
      },
      certificates: {
        total: certificatesResult.count || 0,
        // Added (c: any) to fix build error
        offline: certificatesResult.data?.filter((c: any) => c.data_source === 'offline').length || 0,
        lms: certificatesResult.data?.filter((c: any) => c.data_source === 'lms').length || 0,
      },
    };
  }, []);

  return useFetch(fetcher, []);
}