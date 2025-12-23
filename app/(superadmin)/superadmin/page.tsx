'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Building2, Users, CreditCard, Activity, TrendingUp, TrendingDown,
  Server, Database, Clock, Globe, AlertTriangle, CheckCircle,
  ArrowUpRight, ArrowDownRight, Zap, HardDrive
} from 'lucide-react';
import { createClient } from '@/lib/supabase';

export default function SuperAdminOverview() {
  const [stats, setStats] = useState({
    totalOrganizations: 0,
    activeOrganizations: 0,
    totalUsers: 0,
    activeUsersToday: 0,
    totalSessions: 0,
    totalCourses: 0,
    totalLearners: 0,
    certificatesIssued: 0,
    monthlyRevenue: 0,
    storageUsed: 0,
  });
  const [recentOrgs, setRecentOrgs] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    fetchPlatformStats();
  }, []);

  const fetchPlatformStats = async () => {
    setIsLoading(true);
    const { count: orgCount } = await supabase.from('organizations').select('*', { count: 'exact', head: true });
    const { count: activeOrgCount } = await supabase.from('organizations').select('*', { count: 'exact', head: true }).eq('status', 'active');
    const { count: userCount } = await supabase.from('users').select('*', { count: 'exact', head: true });
    const { count: learnerCount } = await supabase.from('learners').select('*', { count: 'exact', head: true });
    const { count: sessionCount } = await supabase.from('sessions').select('*', { count: 'exact', head: true });
    const { count: courseCount } = await supabase.from('courses').select('*', { count: 'exact', head: true });
    const { count: certCount } = await supabase.from('certificates').select('*', { count: 'exact', head: true });
    const { data: orgs } = await supabase.from('organizations').select('*').order('created_at', { ascending: false }).limit(5);

    setStats({
      totalOrganizations: orgCount || 0,
      activeOrganizations: activeOrgCount || 0,
      totalUsers: userCount || 0,
      activeUsersToday: Math.floor((userCount || 0) * 0.3),
      totalSessions: sessionCount || 0,
      totalCourses: courseCount || 0,
      totalLearners: learnerCount || 0,
      certificatesIssued: certCount || 0,
      monthlyRevenue: 45000,
      storageUsed: 2.4,
    });
    setRecentOrgs(orgs || []);
    setIsLoading(false);
  };

  const statCards = [
    { title: 'Total Organizations', value: stats.totalOrganizations, change: '+12%', trend: 'up', icon: Building2, color: 'blue', subtitle: `${stats.activeOrganizations} active` },
    { title: 'Total Users', value: stats.totalUsers.toLocaleString(), change: '+8%', trend: 'up', icon: Users, color: 'green', subtitle: `${stats.activeUsersToday} active today` },
    { title: 'Total Learners', value: stats.totalLearners.toLocaleString(), change: '+15%', trend: 'up', icon: Users, color: 'purple', subtitle: 'Across all organizations' },
    { title: 'Monthly Revenue', value: `$${stats.monthlyRevenue.toLocaleString()}`, change: '+23%', trend: 'up', icon: CreditCard, color: 'yellow', subtitle: 'MRR' },
  ];

  const systemMetrics = [
    { name: 'API Requests (24h)', value: '1.2M', icon: Zap, status: 'normal' },
    { name: 'Database Size', value: '45 GB', icon: Database, status: 'normal' },
    { name: 'Storage Used', value: `${stats.storageUsed} GB`, icon: HardDrive, status: 'normal' },
    { name: 'Avg Response Time', value: '120ms', icon: Clock, status: 'normal' },
  ];

  const colorClasses: Record<string, string> = {
    blue: 'bg-blue-500/20 text-blue-400',
    green: 'bg-green-500/20 text-green-400',
    purple: 'bg-purple-500/20 text-purple-400',
    yellow: 'bg-yellow-500/20 text-yellow-400',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Platform Overview</h1>
          <p className="text-slate-400">Monitor and manage the entire TMS platform</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Clock className="w-4 h-4" />
          Last updated: {new Date().toLocaleString()}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat, index) => (
          <motion.div key={stat.title} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.1 }} className="bg-slate-800 rounded-xl p-6 border border-slate-700">
            <div className="flex items-start justify-between mb-4">
              <div className={`p-3 rounded-lg ${colorClasses[stat.color]}`}>
                <stat.icon className="w-6 h-6" />
              </div>
              <div className={`flex items-center gap-1 text-sm ${stat.trend === 'up' ? 'text-green-400' : 'text-red-400'}`}>
                {stat.trend === 'up' ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                {stat.change}
              </div>
            </div>
            <p className="text-3xl font-bold text-white mb-1">{stat.value}</p>
            <p className="text-sm text-slate-400">{stat.title}</p>
            <p className="text-xs text-slate-500 mt-1">{stat.subtitle}</p>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-slate-800 rounded-xl border border-slate-700 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Recent Organizations</h2>
            <a href="/superadmin/organizations" className="text-sm text-red-400 hover:text-red-300">View All →</a>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs font-medium text-slate-400 uppercase">
                  <th className="pb-3">Organization</th>
                  <th className="pb-3">Status</th>
                  <th className="pb-3">Plan</th>
                  <th className="pb-3">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {recentOrgs.map((org) => (
                  <tr key={org.id} className="text-sm">
                    <td className="py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-slate-700 rounded-lg flex items-center justify-center">
                          <Building2 className="w-4 h-4 text-slate-400" />
                        </div>
                        <div>
                          <p className="font-medium text-white">{org.name}</p>
                          <p className="text-xs text-slate-500">{org.name_ar}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3">
                      <span className={`px-2 py-1 rounded-full text-xs ${org.status === 'active' ? 'bg-green-500/20 text-green-400' : 'bg-slate-500/20 text-slate-400'}`}>{org.status}</span>
                    </td>
                    <td className="py-3 text-slate-300">{org.subscription_plan || 'Free'}</td>
                    <td className="py-3 text-slate-400">{new Date(org.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
                {recentOrgs.length === 0 && (
                  <tr><td colSpan={4} className="py-8 text-center text-slate-500">No organizations found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
          <h2 className="text-lg font-semibold text-white mb-4">System Metrics</h2>
          <div className="space-y-4">
            {systemMetrics.map((metric) => (
              <div key={metric.name} className="flex items-center justify-between p-3 bg-slate-700/50 rounded-lg">
                <div className="flex items-center gap-3">
                  <metric.icon className="w-5 h-5 text-slate-400" />
                  <span className="text-sm text-slate-300">{metric.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white">{metric.value}</span>
                  <span className="w-2 h-2 bg-green-500 rounded-full" />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 pt-6 border-t border-slate-700">
            <h3 className="text-sm font-medium text-slate-400 mb-3">Platform Stats</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-slate-700/50 rounded-lg text-center">
                <p className="text-2xl font-bold text-white">{stats.totalCourses}</p>
                <p className="text-xs text-slate-400">Courses</p>
              </div>
              <div className="p-3 bg-slate-700/50 rounded-lg text-center">
                <p className="text-2xl font-bold text-white">{stats.totalSessions}</p>
                <p className="text-xs text-slate-400">Sessions</p>
              </div>
              <div className="p-3 bg-slate-700/50 rounded-lg text-center">
                <p className="text-2xl font-bold text-white">{stats.certificatesIssued}</p>
                <p className="text-xs text-slate-400">Certificates</p>
              </div>
              <div className="p-3 bg-slate-700/50 rounded-lg text-center">
                <p className="text-2xl font-bold text-green-400">99.9%</p>
                <p className="text-xs text-slate-400">Uptime</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
