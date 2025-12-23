'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Activity, Server, Database, HardDrive, Clock, CheckCircle, AlertTriangle, XCircle, RefreshCw, Zap, Globe } from 'lucide-react';

export default function SystemHealthPage() {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  const [services, setServices] = useState([
    { name: 'API Server', status: 'healthy', latency: 45, uptime: 99.99 },
    { name: 'Database (Supabase)', status: 'healthy', latency: 12, uptime: 99.95 },
    { name: 'Authentication', status: 'healthy', latency: 89, uptime: 99.98 },
    { name: 'File Storage', status: 'healthy', latency: 156, uptime: 99.90 },
    { name: 'Email Service', status: 'degraded', latency: 450, uptime: 98.50 },
    { name: 'CDN', status: 'healthy', latency: 23, uptime: 99.99 },
  ]);

  const [metrics, setMetrics] = useState([
    { name: 'CPU Usage', value: 34, max: 100, unit: '%' },
    { name: 'Memory Usage', value: 62, max: 100, unit: '%' },
    { name: 'Disk Usage', value: 45, max: 100, unit: '%' },
    { name: 'Network I/O', value: 128, max: 1000, unit: 'MB/s' },
  ]);

  const [recentIncidents] = useState([
    { id: 1, title: 'Email service latency spike', status: 'investigating', time: '15 minutes ago', severity: 'minor' },
    { id: 2, title: 'API rate limiting triggered', status: 'resolved', time: '2 hours ago', severity: 'minor' },
    { id: 3, title: 'Database maintenance completed', status: 'resolved', time: '1 day ago', severity: 'maintenance' },
  ]);

  const refreshHealth = async () => {
    setIsRefreshing(true);
    await new Promise(resolve => setTimeout(resolve, 1500));
    setMetrics(prev => prev.map(m => ({ ...m, value: Math.min(m.max, Math.max(0, m.value + (Math.random() - 0.5) * 10)) })));
    setServices(prev => prev.map(s => ({ ...s, latency: Math.max(10, s.latency + (Math.random() - 0.5) * 20) })));
    setLastUpdated(new Date());
    setIsRefreshing(false);
  };

  useEffect(() => { const interval = setInterval(refreshHealth, 30000); return () => clearInterval(interval); }, []);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'healthy': return <CheckCircle className="w-5 h-5 text-green-400" />;
      case 'degraded': return <AlertTriangle className="w-5 h-5 text-yellow-400" />;
      case 'down': return <XCircle className="w-5 h-5 text-red-400" />;
      default: return <Activity className="w-5 h-5 text-slate-400" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) { case 'healthy': return 'bg-green-500'; case 'degraded': return 'bg-yellow-500'; case 'down': return 'bg-red-500'; default: return 'bg-slate-500'; }
  };

  const getMetricColor = (value: number, max: number) => {
    const percentage = (value / max) * 100;
    if (percentage < 60) return 'bg-green-500';
    if (percentage < 80) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const overallStatus = services.every(s => s.status === 'healthy') ? 'All Systems Operational' : services.some(s => s.status === 'down') ? 'Major Outage' : 'Partial Degradation';
  const overallStatusColor = services.every(s => s.status === 'healthy') ? 'bg-green-500/20 border-green-500 text-green-400' : services.some(s => s.status === 'down') ? 'bg-red-500/20 border-red-500 text-red-400' : 'bg-yellow-500/20 border-yellow-500 text-yellow-400';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-white">System Health</h1><p className="text-slate-400">Monitor platform infrastructure and services</p></div>
        <div className="flex items-center gap-4">
          <div className="text-sm text-slate-400">Last updated: {lastUpdated.toLocaleTimeString()}</div>
          <button onClick={refreshHealth} disabled={isRefreshing} className="flex items-center gap-2 px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 disabled:opacity-50"><RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />Refresh</button>
        </div>
      </div>

      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className={`p-6 rounded-xl border ${overallStatusColor}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className={`p-3 rounded-full ${overallStatusColor.split(' ')[0]}`}>{services.every(s => s.status === 'healthy') ? <CheckCircle className="w-8 h-8" /> : services.some(s => s.status === 'down') ? <XCircle className="w-8 h-8" /> : <AlertTriangle className="w-8 h-8" />}</div>
            <div><h2 className="text-xl font-bold">{overallStatus}</h2><p className="text-sm opacity-80">{services.filter(s => s.status === 'healthy').length} of {services.length} services operational</p></div>
          </div>
          <div className="text-right"><p className="text-3xl font-bold">99.95%</p><p className="text-sm opacity-80">30-day uptime</p></div>
        </div>
      </motion.div>

      <div>
        <h2 className="text-lg font-semibold text-white mb-4">Service Status</h2>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {services.map((service, index) => (
            <motion.div key={service.name} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }} className="bg-slate-800 rounded-xl border border-slate-700 p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">{getStatusIcon(service.status)}<span className="font-medium text-white">{service.name}</span></div>
                <span className={`w-2 h-2 rounded-full ${getStatusColor(service.status)} animate-pulse`} />
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><p className="text-slate-500">Latency</p><p className={`font-medium ${service.latency > 200 ? 'text-yellow-400' : 'text-white'}`}>{Math.round(service.latency)}ms</p></div>
                <div><p className="text-slate-500">Uptime</p><p className="font-medium text-white">{service.uptime.toFixed(2)}%</p></div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-white mb-4">Resource Usage</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {metrics.map((metric, index) => (
            <motion.div key={metric.name} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }} className="bg-slate-800 rounded-xl border border-slate-700 p-4">
              <div className="flex items-center justify-between mb-2"><span className="text-sm text-slate-400">{metric.name}</span></div>
              <p className="text-2xl font-bold text-white mb-2">{Math.round(metric.value)}{metric.unit}</p>
              <div className="h-2 bg-slate-700 rounded-full overflow-hidden"><motion.div initial={{ width: 0 }} animate={{ width: `${(metric.value / metric.max) * 100}%` }} className={`h-full ${getMetricColor(metric.value, metric.max)} rounded-full`} /></div>
            </motion.div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Recent Incidents</h2>
          <div className="space-y-3">
            {recentIncidents.map((incident) => (
              <div key={incident.id} className="flex items-start gap-3 p-3 bg-slate-700/50 rounded-lg">
                <div className={`p-1.5 rounded ${incident.severity === 'major' ? 'bg-red-500/20' : incident.severity === 'minor' ? 'bg-yellow-500/20' : 'bg-blue-500/20'}`}>{incident.severity === 'major' ? <XCircle className="w-4 h-4 text-red-400" /> : incident.severity === 'minor' ? <AlertTriangle className="w-4 h-4 text-yellow-400" /> : <Server className="w-4 h-4 text-blue-400" />}</div>
                <div className="flex-1"><p className="font-medium text-white">{incident.title}</p><div className="flex items-center gap-2 mt-1"><span className={`px-2 py-0.5 rounded text-xs ${incident.status === 'resolved' ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'}`}>{incident.status}</span><span className="text-xs text-slate-500">{incident.time}</span></div></div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Performance Overview</h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-slate-700/50 rounded-lg"><div className="flex items-center gap-3"><Zap className="w-5 h-5 text-yellow-400" /><span className="text-slate-300">API Requests (24h)</span></div><span className="font-bold text-white">1.2M</span></div>
            <div className="flex items-center justify-between p-3 bg-slate-700/50 rounded-lg"><div className="flex items-center gap-3"><Clock className="w-5 h-5 text-blue-400" /><span className="text-slate-300">Avg Response Time</span></div><span className="font-bold text-white">89ms</span></div>
            <div className="flex items-center justify-between p-3 bg-slate-700/50 rounded-lg"><div className="flex items-center gap-3"><Globe className="w-5 h-5 text-green-400" /><span className="text-slate-300">Active Connections</span></div><span className="font-bold text-white">2,847</span></div>
            <div className="flex items-center justify-between p-3 bg-slate-700/50 rounded-lg"><div className="flex items-center gap-3"><Database className="w-5 h-5 text-purple-400" /><span className="text-slate-300">Database Queries (24h)</span></div><span className="font-bold text-white">4.5M</span></div>
            <div className="flex items-center justify-between p-3 bg-slate-700/50 rounded-lg"><div className="flex items-center gap-3"><HardDrive className="w-5 h-5 text-cyan-400" /><span className="text-slate-300">Storage Used</span></div><span className="font-bold text-white">45.2 GB</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
