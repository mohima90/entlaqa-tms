'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Settings, Mail, Shield, Zap, Save, Loader2, CheckCircle, AlertTriangle, ToggleLeft, ToggleRight } from 'lucide-react';

export default function SystemConfigPage() {
  const [activeTab, setActiveTab] = useState('general');
  const [isSaving, setIsSaving] = useState(false);
  const [success, setSuccess] = useState('');

  const [generalSettings, setGeneralSettings] = useState({ platform_name: 'ENTLAQA TMS', default_language: 'en', default_timezone: 'Asia/Riyadh', default_currency: 'SAR', support_email: 'support@entlaqa.com', max_file_upload_mb: 50, session_timeout_minutes: 60 });
  const [emailSettings, setEmailSettings] = useState({ smtp_host: 'smtp.sendgrid.net', smtp_port: 587, smtp_user: '', smtp_password: '', from_email: 'noreply@entlaqa.com', from_name: 'ENTLAQA TMS' });
  const [featureFlags, setFeatureFlags] = useState([
    { id: 'ff_lms_sync', name: 'LMS Sync', description: 'Enable LMS synchronization for organizations', enabled: true, category: 'Integration' },
    { id: 'ff_certificates', name: 'Certificates', description: 'Allow certificate generation', enabled: true, category: 'Features' },
    { id: 'ff_reports', name: 'Advanced Reports', description: 'Enable advanced reporting features', enabled: true, category: 'Features' },
    { id: 'ff_api_access', name: 'API Access', description: 'Allow organizations to use API', enabled: false, category: 'Integration' },
    { id: 'ff_sso', name: 'Single Sign-On', description: 'Enable SSO authentication', enabled: false, category: 'Security' },
    { id: 'ff_2fa', name: 'Two-Factor Auth', description: 'Enable 2FA for all users', enabled: true, category: 'Security' },
    { id: 'ff_bulk_import', name: 'Bulk Import', description: 'Allow bulk data imports', enabled: true, category: 'Features' },
    { id: 'ff_webhooks', name: 'Webhooks', description: 'Enable webhook integrations', enabled: false, category: 'Integration' },
  ]);
  const [rateLimits, setRateLimits] = useState({ api_requests_per_minute: 100, api_requests_per_day: 10000, file_uploads_per_day: 100, email_sends_per_hour: 500 });

  const toggleFeature = (id: string) => { setFeatureFlags(flags => flags.map(f => f.id === id ? { ...f, enabled: !f.enabled } : f)); };

  const handleSave = async () => {
    setIsSaving(true);
    await new Promise(resolve => setTimeout(resolve, 1000));
    setSuccess('Settings saved successfully!');
    setIsSaving(false);
    setTimeout(() => setSuccess(''), 3000);
  };

  const tabs = [
    { id: 'general', label: 'General', icon: Settings },
    { id: 'email', label: 'Email', icon: Mail },
    { id: 'features', label: 'Feature Flags', icon: Zap },
    { id: 'limits', label: 'Rate Limits', icon: Shield },
  ];

  return (
    <div className="space-y-6">
      {success && <div className="p-4 bg-green-500/20 border border-green-500 rounded-lg flex items-center gap-3"><CheckCircle className="w-5 h-5 text-green-400" /><p className="text-green-400">{success}</p></div>}

      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-white">System Configuration</h1><p className="text-slate-400">Manage global platform settings</p></div>
        <button onClick={handleSave} disabled={isSaving} className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">{isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}Save All Changes</button>
      </div>

      <div className="flex gap-2 border-b border-slate-700 pb-4">
        {tabs.map(tab => (<button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === tab.id ? 'bg-red-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}><tab.icon className="w-4 h-4" />{tab.label}</button>))}
      </div>

      {activeTab === 'general' && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-slate-800 rounded-xl border border-slate-700 p-6">
          <h2 className="text-lg font-semibold text-white mb-6">General Settings</h2>
          <div className="grid grid-cols-2 gap-6">
            <div><label className="block text-sm font-medium text-slate-300 mb-2">Platform Name</label><input type="text" value={generalSettings.platform_name} onChange={(e) => setGeneralSettings({ ...generalSettings, platform_name: e.target.value })} className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white" /></div>
            <div><label className="block text-sm font-medium text-slate-300 mb-2">Support Email</label><input type="email" value={generalSettings.support_email} onChange={(e) => setGeneralSettings({ ...generalSettings, support_email: e.target.value })} className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white" /></div>
            <div><label className="block text-sm font-medium text-slate-300 mb-2">Default Language</label><select value={generalSettings.default_language} onChange={(e) => setGeneralSettings({ ...generalSettings, default_language: e.target.value })} className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"><option value="en">English</option><option value="ar">Arabic</option></select></div>
            <div><label className="block text-sm font-medium text-slate-300 mb-2">Default Timezone</label><select value={generalSettings.default_timezone} onChange={(e) => setGeneralSettings({ ...generalSettings, default_timezone: e.target.value })} className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"><option value="Asia/Riyadh">Asia/Riyadh (UTC+3)</option><option value="Asia/Dubai">Asia/Dubai (UTC+4)</option><option value="Africa/Cairo">Africa/Cairo (UTC+2)</option><option value="Europe/London">Europe/London (UTC+0)</option></select></div>
            <div><label className="block text-sm font-medium text-slate-300 mb-2">Default Currency</label><select value={generalSettings.default_currency} onChange={(e) => setGeneralSettings({ ...generalSettings, default_currency: e.target.value })} className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"><option value="SAR">SAR - Saudi Riyal</option><option value="AED">AED - UAE Dirham</option><option value="EGP">EGP - Egyptian Pound</option><option value="USD">USD - US Dollar</option></select></div>
            <div><label className="block text-sm font-medium text-slate-300 mb-2">Max File Upload (MB)</label><input type="number" value={generalSettings.max_file_upload_mb} onChange={(e) => setGeneralSettings({ ...generalSettings, max_file_upload_mb: parseInt(e.target.value) })} className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white" /></div>
          </div>
        </motion.div>
      )}

      {activeTab === 'email' && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-slate-800 rounded-xl border border-slate-700 p-6">
          <h2 className="text-lg font-semibold text-white mb-6">Email Configuration</h2>
          <div className="grid grid-cols-2 gap-6">
            <div><label className="block text-sm font-medium text-slate-300 mb-2">SMTP Host</label><input type="text" value={emailSettings.smtp_host} onChange={(e) => setEmailSettings({ ...emailSettings, smtp_host: e.target.value })} className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white" /></div>
            <div><label className="block text-sm font-medium text-slate-300 mb-2">SMTP Port</label><input type="number" value={emailSettings.smtp_port} onChange={(e) => setEmailSettings({ ...emailSettings, smtp_port: parseInt(e.target.value) })} className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white" /></div>
            <div><label className="block text-sm font-medium text-slate-300 mb-2">SMTP Username</label><input type="text" value={emailSettings.smtp_user} onChange={(e) => setEmailSettings({ ...emailSettings, smtp_user: e.target.value })} placeholder="Enter SMTP username" className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500" /></div>
            <div><label className="block text-sm font-medium text-slate-300 mb-2">SMTP Password</label><input type="password" value={emailSettings.smtp_password} onChange={(e) => setEmailSettings({ ...emailSettings, smtp_password: e.target.value })} placeholder="Enter SMTP password" className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500" /></div>
            <div><label className="block text-sm font-medium text-slate-300 mb-2">From Email</label><input type="email" value={emailSettings.from_email} onChange={(e) => setEmailSettings({ ...emailSettings, from_email: e.target.value })} className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white" /></div>
            <div><label className="block text-sm font-medium text-slate-300 mb-2">From Name</label><input type="text" value={emailSettings.from_name} onChange={(e) => setEmailSettings({ ...emailSettings, from_name: e.target.value })} className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white" /></div>
          </div>
          <div className="mt-6"><button className="px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600">Send Test Email</button></div>
        </motion.div>
      )}

      {activeTab === 'features' && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-slate-800 rounded-xl border border-slate-700 p-6">
          <div className="flex items-center justify-between mb-6"><h2 className="text-lg font-semibold text-white">Feature Flags</h2><div className="flex items-center gap-2 text-sm text-slate-400"><AlertTriangle className="w-4 h-4 text-yellow-400" />Changes take effect immediately</div></div>
          <div className="space-y-4">
            {['Features', 'Integration', 'Security'].map(category => (
              <div key={category}>
                <h3 className="text-sm font-medium text-slate-500 uppercase mb-3">{category}</h3>
                <div className="space-y-2">
                  {featureFlags.filter(f => f.category === category).map(flag => (
                    <div key={flag.id} className="flex items-center justify-between p-4 bg-slate-700/50 rounded-lg">
                      <div><p className="font-medium text-white">{flag.name}</p><p className="text-sm text-slate-400">{flag.description}</p></div>
                      <button onClick={() => toggleFeature(flag.id)} className={`p-1 rounded-full transition-colors ${flag.enabled ? 'text-green-400' : 'text-slate-500'}`}>{flag.enabled ? <ToggleRight className="w-8 h-8" /> : <ToggleLeft className="w-8 h-8" />}</button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {activeTab === 'limits' && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-slate-800 rounded-xl border border-slate-700 p-6">
          <h2 className="text-lg font-semibold text-white mb-6">API Rate Limits</h2>
          <div className="grid grid-cols-2 gap-6">
            <div><label className="block text-sm font-medium text-slate-300 mb-2">API Requests / Minute</label><input type="number" value={rateLimits.api_requests_per_minute} onChange={(e) => setRateLimits({ ...rateLimits, api_requests_per_minute: parseInt(e.target.value) })} className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white" /></div>
            <div><label className="block text-sm font-medium text-slate-300 mb-2">API Requests / Day</label><input type="number" value={rateLimits.api_requests_per_day} onChange={(e) => setRateLimits({ ...rateLimits, api_requests_per_day: parseInt(e.target.value) })} className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white" /></div>
            <div><label className="block text-sm font-medium text-slate-300 mb-2">File Uploads / Day</label><input type="number" value={rateLimits.file_uploads_per_day} onChange={(e) => setRateLimits({ ...rateLimits, file_uploads_per_day: parseInt(e.target.value) })} className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white" /></div>
            <div><label className="block text-sm font-medium text-slate-300 mb-2">Email Sends / Hour</label><input type="number" value={rateLimits.email_sends_per_hour} onChange={(e) => setRateLimits({ ...rateLimits, email_sends_per_hour: parseInt(e.target.value) })} className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white" /></div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
