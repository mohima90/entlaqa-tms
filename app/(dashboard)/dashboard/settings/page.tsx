'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Settings, Building, Users, Bell, Shield, Palette, Link2, RefreshCw, Save, Loader2, CheckCircle, AlertCircle, Upload } from 'lucide-react';
import Header from '@/components/layout/Header';
import { createClient } from '@/lib/supabase';

type TabId = 'organization' | 'users' | 'notifications' | 'security' | 'appearance' | 'integrations' | 'lms';

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabId>('organization');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const supabase = createClient();

  const [orgSettings, setOrgSettings] = useState({
    name: '', name_ar: '', email: '', phone: '', address: '', city: '', country: '', website: '', logo_url: '', timezone: 'Asia/Riyadh', language: 'en', currency: 'SAR'
  });

  const [notificationSettings, setNotificationSettings] = useState({
    email_notifications: true, session_reminders: true, certificate_alerts: true, weekly_reports: false
  });

  const [securitySettings, setSecuritySettings] = useState({
    two_factor: false, session_timeout: 60, password_expiry: 90, min_password_length: 8
  });

  const [appearanceSettings, setAppearanceSettings] = useState({
    primary_color: '#0066CC', theme: 'light', sidebar_collapsed: false, compact_mode: false
  });

  useEffect(() => { fetchSettings(); }, []);

  const fetchSettings = async () => {
    setIsLoading(true);
    const { data: org } = await supabase.from('organizations').select('*').eq('id', 'org_001').single();
    if (org) {
      setOrgSettings({
        name: org.name || '', name_ar: org.name_ar || '', email: org.settings?.email || '',
        phone: org.settings?.phone || '', address: org.settings?.address || '',
        city: org.settings?.city || '', country: org.settings?.country || '',
        website: org.settings?.website || '', logo_url: org.logo_url || '',
        timezone: org.settings?.timezone || 'Asia/Riyadh', language: org.settings?.language || 'en',
        currency: org.settings?.currency || 'SAR'
      });
      if (org.settings?.notifications) setNotificationSettings(org.settings.notifications);
      if (org.settings?.security) setSecuritySettings(org.settings.security);
      if (org.settings?.appearance) setAppearanceSettings(org.settings.appearance);
    }
    setIsLoading(false);
  };

  const saveSettings = async () => {
    setIsSaving(true); setError('');
    const settings = {
      email: orgSettings.email, phone: orgSettings.phone, address: orgSettings.address,
      city: orgSettings.city, country: orgSettings.country, website: orgSettings.website,
      timezone: orgSettings.timezone, language: orgSettings.language, currency: orgSettings.currency,
      notifications: notificationSettings, security: securitySettings, appearance: appearanceSettings
    };

    const { error } = await supabase.from('organizations').update({
      name: orgSettings.name, name_ar: orgSettings.name_ar, logo_url: orgSettings.logo_url,
      settings, updated_at: new Date().toISOString()
    }).eq('id', 'org_001');

    if (error) setError('Failed to save: ' + error.message);
    else setSuccess('Settings saved successfully!');
    
    setTimeout(() => setSuccess(''), 3000);
    setIsSaving(false);
  };

  const tabs = [
    { id: 'organization' as TabId, label: 'Organization', icon: Building },
    { id: 'users' as TabId, label: 'Users', icon: Users },
    { id: 'notifications' as TabId, label: 'Notifications', icon: Bell },
    { id: 'security' as TabId, label: 'Security', icon: Shield },
    { id: 'appearance' as TabId, label: 'Appearance', icon: Palette },
    { id: 'integrations' as TabId, label: 'Integrations', icon: Link2 },
    { id: 'lms' as TabId, label: 'LMS Sync', icon: RefreshCw },
  ];

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header title="Settings" subtitle="Manage your organization settings" />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 text-gray-400 animate-spin" /></div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header title="Settings" subtitle="Manage your organization settings" />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700"><AlertCircle className="w-5 h-5" />{error}<button onClick={() => setError('')} className="ml-auto">×</button></div>}
        {success && <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-700"><CheckCircle className="w-5 h-5" />{success}</div>}

        <div className="flex gap-6">
          {/* Sidebar */}
          <div className="w-64 flex-shrink-0">
            <div className="bg-white rounded-xl border border-gray-200 p-2">
              {tabs.map((tab) => (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors ${activeTab === tab.id ? 'bg-primary-50 text-primary-700' : 'text-gray-600 hover:bg-gray-50'}`}>
                  <tab.icon className="w-5 h-5" />
                  <span className="font-medium">{tab.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1">
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              
              {/* Organization Tab */}
              {activeTab === 'organization' && (
                <div className="space-y-6">
                  <h2 className="text-xl font-semibold text-gray-900">Organization Settings</h2>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Organization Name</label><input type="text" value={orgSettings.name} onChange={e => setOrgSettings({...orgSettings, name: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg" /></div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Name (Arabic)</label><input type="text" value={orgSettings.name_ar} onChange={e => setOrgSettings({...orgSettings, name_ar: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg" dir="rtl" /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Email</label><input type="email" value={orgSettings.email} onChange={e => setOrgSettings({...orgSettings, email: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg" /></div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Phone</label><input type="tel" value={orgSettings.phone} onChange={e => setOrgSettings({...orgSettings, phone: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg" /></div>
                  </div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Address</label><input type="text" value={orgSettings.address} onChange={e => setOrgSettings({...orgSettings, address: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg" /></div>
                  <div className="grid grid-cols-3 gap-4">
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">City</label><input type="text" value={orgSettings.city} onChange={e => setOrgSettings({...orgSettings, city: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg" /></div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Country</label><input type="text" value={orgSettings.country} onChange={e => setOrgSettings({...orgSettings, country: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg" /></div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Website</label><input type="url" value={orgSettings.website} onChange={e => setOrgSettings({...orgSettings, website: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg" /></div>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Timezone</label><select value={orgSettings.timezone} onChange={e => setOrgSettings({...orgSettings, timezone: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg"><option value="Asia/Riyadh">Asia/Riyadh</option><option value="Asia/Dubai">Asia/Dubai</option><option value="Africa/Cairo">Africa/Cairo</option><option value="Europe/London">Europe/London</option></select></div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Language</label><select value={orgSettings.language} onChange={e => setOrgSettings({...orgSettings, language: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg"><option value="en">English</option><option value="ar">Arabic</option></select></div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Currency</label><select value={orgSettings.currency} onChange={e => setOrgSettings({...orgSettings, currency: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg"><option value="SAR">SAR</option><option value="AED">AED</option><option value="EGP">EGP</option><option value="USD">USD</option></select></div>
                  </div>
                </div>
              )}

              {/* Users Tab */}
              {activeTab === 'users' && (
                <div className="space-y-6">
                  <h2 className="text-xl font-semibold text-gray-900">User Management</h2>
                  <p className="text-gray-600">Manage user roles and permissions for your organization.</p>
                  <div className="bg-gray-50 rounded-lg p-4">
                    <p className="text-sm text-gray-500">User management is available in the Users section of the Super Admin panel.</p>
                    <a href="/superadmin/users" className="text-primary-600 hover:underline text-sm mt-2 inline-block">Go to User Management →</a>
                  </div>
                </div>
              )}

              {/* Notifications Tab */}
              {activeTab === 'notifications' && (
                <div className="space-y-6">
                  <h2 className="text-xl font-semibold text-gray-900">Notification Settings</h2>
                  <div className="space-y-4">
                    {[
                      { key: 'email_notifications', label: 'Email Notifications', desc: 'Receive notifications via email' },
                      { key: 'session_reminders', label: 'Session Reminders', desc: 'Get reminded before sessions start' },
                      { key: 'certificate_alerts', label: 'Certificate Alerts', desc: 'Notifications when certificates are issued' },
                      { key: 'weekly_reports', label: 'Weekly Reports', desc: 'Receive weekly summary reports' },
                    ].map((item) => (
                      <div key={item.key} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                        <div><p className="font-medium text-gray-900">{item.label}</p><p className="text-sm text-gray-500">{item.desc}</p></div>
                        <button onClick={() => setNotificationSettings({...notificationSettings, [item.key]: !notificationSettings[item.key as keyof typeof notificationSettings]})} className={`w-12 h-6 rounded-full transition-colors ${notificationSettings[item.key as keyof typeof notificationSettings] ? 'bg-primary-600' : 'bg-gray-300'}`}>
                          <span className={`block w-5 h-5 bg-white rounded-full shadow transform transition-transform ${notificationSettings[item.key as keyof typeof notificationSettings] ? 'translate-x-6' : 'translate-x-0.5'}`} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Security Tab */}
              {activeTab === 'security' && (
                <div className="space-y-6">
                  <h2 className="text-xl font-semibold text-gray-900">Security Settings</h2>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                      <div><p className="font-medium text-gray-900">Two-Factor Authentication</p><p className="text-sm text-gray-500">Require 2FA for all users</p></div>
                      <button onClick={() => setSecuritySettings({...securitySettings, two_factor: !securitySettings.two_factor})} className={`w-12 h-6 rounded-full transition-colors ${securitySettings.two_factor ? 'bg-primary-600' : 'bg-gray-300'}`}>
                        <span className={`block w-5 h-5 bg-white rounded-full shadow transform transition-transform ${securitySettings.two_factor ? 'translate-x-6' : 'translate-x-0.5'}`} />
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <div><label className="block text-sm font-medium text-gray-700 mb-1">Session Timeout (min)</label><input type="number" value={securitySettings.session_timeout} onChange={e => setSecuritySettings({...securitySettings, session_timeout: parseInt(e.target.value)})} className="w-full px-4 py-2 border border-gray-300 rounded-lg" /></div>
                      <div><label className="block text-sm font-medium text-gray-700 mb-1">Password Expiry (days)</label><input type="number" value={securitySettings.password_expiry} onChange={e => setSecuritySettings({...securitySettings, password_expiry: parseInt(e.target.value)})} className="w-full px-4 py-2 border border-gray-300 rounded-lg" /></div>
                      <div><label className="block text-sm font-medium text-gray-700 mb-1">Min Password Length</label><input type="number" value={securitySettings.min_password_length} onChange={e => setSecuritySettings({...securitySettings, min_password_length: parseInt(e.target.value)})} className="w-full px-4 py-2 border border-gray-300 rounded-lg" /></div>
                    </div>
                  </div>
                </div>
              )}

              {/* Appearance Tab */}
              {activeTab === 'appearance' && (
                <div className="space-y-6">
                  <h2 className="text-xl font-semibold text-gray-900">Appearance Settings</h2>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Primary Color</label><div className="flex gap-2"><input type="color" value={appearanceSettings.primary_color} onChange={e => setAppearanceSettings({...appearanceSettings, primary_color: e.target.value})} className="w-12 h-10 border border-gray-300 rounded-lg cursor-pointer" /><input type="text" value={appearanceSettings.primary_color} onChange={e => setAppearanceSettings({...appearanceSettings, primary_color: e.target.value})} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg" /></div></div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Theme</label><select value={appearanceSettings.theme} onChange={e => setAppearanceSettings({...appearanceSettings, theme: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg"><option value="light">Light</option><option value="dark">Dark</option><option value="system">System</option></select></div>
                  </div>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                      <div><p className="font-medium text-gray-900">Compact Mode</p><p className="text-sm text-gray-500">Use smaller spacing and fonts</p></div>
                      <button onClick={() => setAppearanceSettings({...appearanceSettings, compact_mode: !appearanceSettings.compact_mode})} className={`w-12 h-6 rounded-full transition-colors ${appearanceSettings.compact_mode ? 'bg-primary-600' : 'bg-gray-300'}`}>
                        <span className={`block w-5 h-5 bg-white rounded-full shadow transform transition-transform ${appearanceSettings.compact_mode ? 'translate-x-6' : 'translate-x-0.5'}`} />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Integrations Tab */}
              {activeTab === 'integrations' && (
                <div className="space-y-6">
                  <h2 className="text-xl font-semibold text-gray-900">Integrations</h2>
                  <div className="grid grid-cols-2 gap-4">
                    {[
                      { name: 'Google Calendar', desc: 'Sync sessions with Google Calendar', connected: false },
                      { name: 'Microsoft Teams', desc: 'Virtual sessions via Teams', connected: false },
                      { name: 'Zoom', desc: 'Virtual sessions via Zoom', connected: true },
                      { name: 'Slack', desc: 'Send notifications to Slack', connected: false },
                    ].map((integration) => (
                      <div key={integration.name} className="p-4 border border-gray-200 rounded-lg">
                        <div className="flex items-center justify-between mb-2">
                          <p className="font-medium text-gray-900">{integration.name}</p>
                          <span className={`px-2 py-1 rounded-full text-xs ${integration.connected ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>{integration.connected ? 'Connected' : 'Not Connected'}</span>
                        </div>
                        <p className="text-sm text-gray-500 mb-3">{integration.desc}</p>
                        <button className={`w-full py-2 rounded-lg text-sm font-medium ${integration.connected ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-primary-50 text-primary-600 hover:bg-primary-100'}`}>{integration.connected ? 'Disconnect' : 'Connect'}</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* LMS Sync Tab */}
              {activeTab === 'lms' && (
                <div className="space-y-6">
                  <h2 className="text-xl font-semibold text-gray-900">LMS Synchronization</h2>
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <p className="text-blue-800">Connect your Learning Management System to sync courses, learners, and completion data.</p>
                  </div>
                  <div className="space-y-4">
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">LMS Platform</label><select className="w-full px-4 py-2 border border-gray-300 rounded-lg"><option value="">Select LMS</option><option value="moodle">Moodle</option><option value="blackboard">Blackboard</option><option value="canvas">Canvas</option><option value="custom">Custom API</option></select></div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">API Endpoint</label><input type="url" placeholder="https://your-lms.com/api" className="w-full px-4 py-2 border border-gray-300 rounded-lg" /></div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">API Key</label><input type="password" placeholder="Enter API key" className="w-full px-4 py-2 border border-gray-300 rounded-lg" /></div>
                    <button className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">Test Connection</button>
                  </div>
                </div>
              )}

              {/* Save Button */}
              <div className="mt-8 pt-6 border-t border-gray-200 flex justify-end">
                <button onClick={saveSettings} disabled={isSaving} className="flex items-center gap-2 px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50">
                  {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                  Save Settings
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
