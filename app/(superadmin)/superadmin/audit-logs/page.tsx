'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Search, Download, User, Building2, Activity, RefreshCw, AlertTriangle, CheckCircle, XCircle, Clock } from 'lucide-react';

interface AuditLog {
  id: string;
  timestamp: string;
  user_email: string;
  user_name: string;
  organization: string;
  action: string;
  resource: string;
  details: string;
  ip_address: string;
  status: 'success' | 'failure' | 'warning';
}

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [filteredLogs, setFilteredLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateRange, setDateRange] = useState('7d');

  const mockLogs: AuditLog[] = [
    { id: '1', timestamp: new Date(Date.now() - 1000 * 60 * 5).toISOString(), user_email: 'admin@corp.com', user_name: 'John Admin', organization: 'Tech Corp', action: 'user.login', resource: 'Auth', details: 'Successful login', ip_address: '192.168.1.1', status: 'success' },
    { id: '2', timestamp: new Date(Date.now() - 1000 * 60 * 15).toISOString(), user_email: 'demo@entlaqa.com', user_name: 'Demo User', organization: 'Entlaqa', action: 'learner.create', resource: 'Learners', details: 'Created learner: Ahmed Ali', ip_address: '10.0.0.1', status: 'success' },
    { id: '3', timestamp: new Date(Date.now() - 1000 * 60 * 30).toISOString(), user_email: 'hr@acme.com', user_name: 'HR Manager', organization: 'Acme Inc', action: 'session.update', resource: 'Sessions', details: 'Updated session: Python Basics', ip_address: '172.16.0.1', status: 'success' },
    { id: '4', timestamp: new Date(Date.now() - 1000 * 60 * 45).toISOString(), user_email: 'unknown@test.com', user_name: 'Unknown', organization: 'N/A', action: 'user.login', resource: 'Auth', details: 'Failed login attempt - invalid password', ip_address: '203.0.113.1', status: 'failure' },
    { id: '5', timestamp: new Date(Date.now() - 1000 * 60 * 60).toISOString(), user_email: 'admin@corp.com', user_name: 'John Admin', organization: 'Tech Corp', action: 'user.delete', resource: 'Users', details: 'Deleted user: old.employee@corp.com', ip_address: '192.168.1.1', status: 'warning' },
    { id: '6', timestamp: new Date(Date.now() - 1000 * 60 * 90).toISOString(), user_email: 'super@entlaqa.com', user_name: 'Super Admin', organization: 'System', action: 'org.create', resource: 'Organizations', details: 'Created organization: New Client Ltd', ip_address: '10.10.10.1', status: 'success' },
    { id: '7', timestamp: new Date(Date.now() - 1000 * 60 * 120).toISOString(), user_email: 'instructor@edu.com', user_name: 'Prof Smith', organization: 'Edu Corp', action: 'certificate.issue', resource: 'Certificates', details: 'Issued 25 certificates for course completion', ip_address: '172.20.0.1', status: 'success' },
  ];

  useEffect(() => { setTimeout(() => { setLogs(mockLogs); setFilteredLogs(mockLogs); setIsLoading(false); }, 500); }, []);
  useEffect(() => { filterLogs(); }, [searchQuery, actionFilter, statusFilter, logs]);

  const filterLogs = () => {
    let filtered = [...logs];
    if (searchQuery) { const query = searchQuery.toLowerCase(); filtered = filtered.filter(log => log.user_email.toLowerCase().includes(query) || log.user_name.toLowerCase().includes(query) || log.organization.toLowerCase().includes(query) || log.details.toLowerCase().includes(query)); }
    if (actionFilter !== 'all') filtered = filtered.filter(log => log.action.startsWith(actionFilter));
    if (statusFilter !== 'all') filtered = filtered.filter(log => log.status === statusFilter);
    setFilteredLogs(filtered);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success': return <CheckCircle className="w-4 h-4 text-green-400" />;
      case 'failure': return <XCircle className="w-4 h-4 text-red-400" />;
      case 'warning': return <AlertTriangle className="w-4 h-4 text-yellow-400" />;
      default: return <Activity className="w-4 h-4 text-slate-400" />;
    }
  };

  const getActionColor = (action: string) => {
    if (action.startsWith('user.login')) return 'bg-blue-500/20 text-blue-400';
    if (action.includes('create')) return 'bg-green-500/20 text-green-400';
    if (action.includes('update')) return 'bg-yellow-500/20 text-yellow-400';
    if (action.includes('delete')) return 'bg-red-500/20 text-red-400';
    return 'bg-slate-500/20 text-slate-400';
  };

  const exportLogs = () => {
    const csv = [['Timestamp', 'User', 'Email', 'Organization', 'Action', 'Resource', 'Details', 'IP', 'Status'].join(','), ...filteredLogs.map(log => [log.timestamp, log.user_name, log.user_email, log.organization, log.action, log.resource, `"${log.details}"`, log.ip_address, log.status].join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit_logs_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  const stats = { total: logs.length, success: logs.filter(l => l.status === 'success').length, failures: logs.filter(l => l.status === 'failure').length, warnings: logs.filter(l => l.status === 'warning').length };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-white">Audit Logs</h1><p className="text-slate-400">Monitor all system activities across organizations</p></div>
        <div className="flex items-center gap-3">
          <button onClick={() => setLogs([...mockLogs])} className="flex items-center gap-2 px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600"><RefreshCw className="w-4 h-4" />Refresh</button>
          <button onClick={exportLogs} className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"><Download className="w-4 h-4" />Export CSV</button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700"><div className="flex items-center gap-3"><Activity className="w-8 h-8 text-slate-400" /><div><p className="text-2xl font-bold text-white">{stats.total}</p><p className="text-sm text-slate-400">Total Events</p></div></div></div>
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700"><div className="flex items-center gap-3"><CheckCircle className="w-8 h-8 text-green-400" /><div><p className="text-2xl font-bold text-green-400">{stats.success}</p><p className="text-sm text-slate-400">Successful</p></div></div></div>
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700"><div className="flex items-center gap-3"><XCircle className="w-8 h-8 text-red-400" /><div><p className="text-2xl font-bold text-red-400">{stats.failures}</p><p className="text-sm text-slate-400">Failures</p></div></div></div>
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700"><div className="flex items-center gap-3"><AlertTriangle className="w-8 h-8 text-yellow-400" /><div><p className="text-2xl font-bold text-yellow-400">{stats.warnings}</p><p className="text-sm text-slate-400">Warnings</p></div></div></div>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 max-w-md"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" /><input type="text" placeholder="Search logs..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-10 pr-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-400" /></div>
        <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white"><option value="all">All Actions</option><option value="user">User Actions</option><option value="learner">Learner Actions</option><option value="session">Session Actions</option><option value="certificate">Certificate Actions</option><option value="org">Organization Actions</option></select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white"><option value="all">All Status</option><option value="success">Success</option><option value="failure">Failure</option><option value="warning">Warning</option></select>
        <select value={dateRange} onChange={(e) => setDateRange(e.target.value)} className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white"><option value="1h">Last Hour</option><option value="24h">Last 24 Hours</option><option value="7d">Last 7 Days</option><option value="30d">Last 30 Days</option></select>
      </div>

      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-700/50"><tr><th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Time</th><th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">User</th><th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Organization</th><th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Action</th><th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Details</th><th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">IP Address</th><th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Status</th></tr></thead>
          <tbody className="divide-y divide-slate-700">
            {filteredLogs.map((log) => (
              <motion.tr key={log.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="hover:bg-slate-700/30">
                <td className="px-4 py-3"><div className="flex items-center gap-2 text-sm"><Clock className="w-4 h-4 text-slate-500" /><div><p className="text-slate-300">{new Date(log.timestamp).toLocaleTimeString()}</p><p className="text-xs text-slate-500">{new Date(log.timestamp).toLocaleDateString()}</p></div></div></td>
                <td className="px-4 py-3"><div className="flex items-center gap-2"><div className="w-8 h-8 bg-slate-700 rounded-full flex items-center justify-center"><User className="w-4 h-4 text-slate-400" /></div><div><p className="text-sm font-medium text-white">{log.user_name}</p><p className="text-xs text-slate-500">{log.user_email}</p></div></div></td>
                <td className="px-4 py-3"><div className="flex items-center gap-2 text-sm text-slate-300"><Building2 className="w-4 h-4 text-slate-500" />{log.organization}</div></td>
                <td className="px-4 py-3"><span className={`px-2 py-1 rounded text-xs font-medium ${getActionColor(log.action)}`}>{log.action}</span></td>
                <td className="px-4 py-3 text-sm text-slate-400 max-w-xs truncate">{log.details}</td>
                <td className="px-4 py-3 text-sm text-slate-500 font-mono">{log.ip_address}</td>
                <td className="px-4 py-3"><div className="flex items-center gap-2">{getStatusIcon(log.status)}<span className={`text-xs ${log.status === 'success' ? 'text-green-400' : log.status === 'failure' ? 'text-red-400' : 'text-yellow-400'}`}>{log.status}</span></div></td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
