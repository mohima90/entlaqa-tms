'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Settings,
  Building2,
  Users,
  Bell,
  Shield,
  Palette,
  Globe,
  Database,
  Link,
  Mail,
  Save,
  Upload,
  Key,
  Clock,
  Calendar,
  Layers,
  RefreshCw,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';
import Header from '@/components/layout/Header';
import { cn } from '@/lib/utils';

type SettingsTab = 'organization' | 'users' | 'notifications' | 'security' | 'appearance' | 'integrations' | 'lms';

const settingsTabs = [
  { key: 'organization', label: 'Organization', icon: Building2 },
  { key: 'users', label: 'Users & Roles', icon: Users },
  { key: 'notifications', label: 'Notifications', icon: Bell },
  { key: 'security', label: 'Security', icon: Shield },
  { key: 'appearance', label: 'Appearance', icon: Palette },
  { key: 'integrations', label: 'Integrations', icon: Link },
  { key: 'lms', label: 'LMS Sync', icon: Layers },
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('organization');
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    await new Promise(resolve => setTimeout(resolve, 1000));
    setIsSaving(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <Header title="Settings" subtitle="Manage your system configuration" />

      <div className="p-6">
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Sidebar */}
          <div className="lg:w-64 flex-shrink-0">
            <nav className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              {settingsTabs.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setActiveTab(key as SettingsTab)}
                  className={cn(
                    'w-full flex items-center gap-3 px-4 py-3 text-left transition-colors',
                    activeTab === key
                      ? 'bg-entlaqa-50 dark:bg-entlaqa-950/30 text-entlaqa-700 dark:text-entlaqa-300 border-l-4 border-entlaqa-600'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50 border-l-4 border-transparent'
                  )}
                >
                  <Icon className="w-5 h-5" />
                  <span className="font-medium text-sm">{label}</span>
                </button>
              ))}
            </nav>
          </div>

          {/* Content */}
          <div className="flex-1">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700"
            >
              {/* Organization Settings */}
              {activeTab === 'organization' && (
                <div>
                  <div className="p-6 border-b border-slate-200 dark:border-slate-700">
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Organization Settings</h2>
                    <p className="text-sm text-slate-500 mt-1">Manage your organization's profile and preferences</p>
                  </div>
                  <div className="p-6 space-y-6">
                    {/* Logo Upload */}
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
                        Organization Logo
                      </label>
                      <div className="flex items-center gap-6">
                        <div className="w-20 h-20 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                          <Building2 className="w-8 h-8 text-slate-400" />
                        </div>
                        <div>
                          <button className="btn-secondary text-sm">
                            <Upload className="w-4 h-4" />
                            Upload Logo
                          </button>
                          <p className="text-xs text-slate-500 mt-2">PNG, JPG up to 2MB. Recommended: 200x200px</p>
                        </div>
                      </div>
                    </div>

                    {/* Organization Name */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                          Organization Name (English)
                        </label>
                        <input type="text" defaultValue="ENTLAQA Training" className="input-modern" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                          Organization Name (Arabic)
                        </label>
                        <input type="text" defaultValue="انطلاقة للتدريب" className="input-modern text-right" dir="rtl" />
                      </div>
                    </div>

                    {/* Contact Info */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                          Primary Email
                        </label>
                        <input type="email" defaultValue="training@entlaqa.com" className="input-modern" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                          Phone Number
                        </label>
                        <input type="tel" defaultValue="+966 11 234 5678" className="input-modern" />
                      </div>
                    </div>

                    {/* Address */}
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        Address
                      </label>
                      <textarea rows={3} defaultValue="King Fahd Road, Al Olaya District, Riyadh, Saudi Arabia" className="input-modern" />
                    </div>

                    {/* Regional Settings */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                          Timezone
                        </label>
                        <select className="input-modern" defaultValue="Asia/Riyadh">
                          <option value="Asia/Riyadh">Asia/Riyadh (UTC+3)</option>
                          <option value="Asia/Dubai">Asia/Dubai (UTC+4)</option>
                          <option value="Africa/Cairo">Africa/Cairo (UTC+2)</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                          Currency
                        </label>
                        <select className="input-modern" defaultValue="SAR">
                          <option value="SAR">SAR - Saudi Riyal</option>
                          <option value="USD">USD - US Dollar</option>
                          <option value="EUR">EUR - Euro</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                          Date Format
                        </label>
                        <select className="input-modern" defaultValue="dd/mm/yyyy">
                          <option value="dd/mm/yyyy">DD/MM/YYYY</option>
                          <option value="mm/dd/yyyy">MM/DD/YYYY</option>
                          <option value="yyyy-mm-dd">YYYY-MM-DD</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Notifications Settings */}
              {activeTab === 'notifications' && (
                <div>
                  <div className="p-6 border-b border-slate-200 dark:border-slate-700">
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Notification Settings</h2>
                    <p className="text-sm text-slate-500 mt-1">Configure how and when you receive notifications</p>
                  </div>
                  <div className="p-6 space-y-6">
                    {[
                      { title: 'Email Notifications', items: [
                        { label: 'New enrollment requests', description: 'When learners request to join a session', enabled: true },
                        { label: 'Session reminders', description: 'Reminder emails before sessions start', enabled: true },
                        { label: 'Completion notifications', description: 'When learners complete a course', enabled: true },
                        { label: 'Certificate issuance', description: 'When certificates are generated', enabled: false },
                      ]},
                      { title: 'System Notifications', items: [
                        { label: 'Low enrollment alerts', description: 'When sessions have low enrollment', enabled: true },
                        { label: 'Instructor availability', description: 'When instructor schedules change', enabled: false },
                        { label: 'LMS sync status', description: 'Updates about Jadarat sync', enabled: true },
                      ]},
                    ].map((section) => (
                      <div key={section.title}>
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-4">{section.title}</h3>
                        <div className="space-y-4">
                          {section.items.map((item) => (
                            <div key={item.label} className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900/50 rounded-xl">
                              <div>
                                <p className="font-medium text-slate-900 dark:text-white">{item.label}</p>
                                <p className="text-sm text-slate-500">{item.description}</p>
                              </div>
                              <label className="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" defaultChecked={item.enabled} className="sr-only peer" />
                                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-entlaqa-500/20 rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-entlaqa-600"></div>
                              </label>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Security Settings */}
              {activeTab === 'security' && (
                <div>
                  <div className="p-6 border-b border-slate-200 dark:border-slate-700">
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Security Settings</h2>
                    <p className="text-sm text-slate-500 mt-1">Manage authentication and security preferences</p>
                  </div>
                  <div className="p-6 space-y-6">
                    {/* Password Policy */}
                    <div className="p-4 bg-slate-50 dark:bg-slate-900/50 rounded-xl">
                      <div className="flex items-center gap-3 mb-4">
                        <Key className="w-5 h-5 text-slate-600" />
                        <h3 className="font-semibold text-slate-900 dark:text-white">Password Policy</h3>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                            Minimum Length
                          </label>
                          <select className="input-modern" defaultValue="8">
                            <option value="6">6 characters</option>
                            <option value="8">8 characters</option>
                            <option value="10">10 characters</option>
                            <option value="12">12 characters</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                            Password Expiry
                          </label>
                          <select className="input-modern" defaultValue="90">
                            <option value="30">30 days</option>
                            <option value="60">60 days</option>
                            <option value="90">90 days</option>
                            <option value="never">Never</option>
                          </select>
                        </div>
                      </div>
                      <div className="mt-4 space-y-2">
                        {['Require uppercase letters', 'Require numbers', 'Require special characters'].map((req) => (
                          <label key={req} className="flex items-center gap-2">
                            <input type="checkbox" defaultChecked className="rounded border-slate-300 text-entlaqa-600 focus:ring-entlaqa-500" />
                            <span className="text-sm text-slate-600 dark:text-slate-400">{req}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Two-Factor Authentication */}
                    <div className="p-4 bg-slate-50 dark:bg-slate-900/50 rounded-xl">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Shield className="w-5 h-5 text-slate-600" />
                          <div>
                            <h3 className="font-semibold text-slate-900 dark:text-white">Two-Factor Authentication</h3>
                            <p className="text-sm text-slate-500">Require 2FA for all admin users</p>
                          </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input type="checkbox" defaultChecked className="sr-only peer" />
                          <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-entlaqa-500/20 rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-entlaqa-600"></div>
                        </label>
                      </div>
                    </div>

                    {/* Session Timeout */}
                    <div className="p-4 bg-slate-50 dark:bg-slate-900/50 rounded-xl">
                      <div className="flex items-center gap-3 mb-4">
                        <Clock className="w-5 h-5 text-slate-600" />
                        <h3 className="font-semibold text-slate-900 dark:text-white">Session Settings</h3>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                          Auto-logout after inactivity
                        </label>
                        <select className="input-modern w-48" defaultValue="30">
                          <option value="15">15 minutes</option>
                          <option value="30">30 minutes</option>
                          <option value="60">1 hour</option>
                          <option value="120">2 hours</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* LMS Integration Settings */}
              {activeTab === 'lms' && (
                <div>
                  <div className="p-6 border-b border-slate-200 dark:border-slate-700">
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Jadarat LMS Integration</h2>
                    <p className="text-sm text-slate-500 mt-1">Configure synchronization with Jadarat Learning Management System</p>
                  </div>
                  <div className="p-6 space-y-6">
                    {/* Connection Status */}
                    <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl">
                      <div className="flex items-center gap-3">
                        <CheckCircle className="w-6 h-6 text-emerald-600" />
                        <div>
                          <p className="font-semibold text-emerald-700 dark:text-emerald-400">Connected to Jadarat LMS</p>
                          <p className="text-sm text-emerald-600 dark:text-emerald-500">Last sync: 5 minutes ago</p>
                        </div>
                        <button className="ml-auto btn-secondary text-sm">
                          <RefreshCw className="w-4 h-4" />
                          Sync Now
                        </button>
                      </div>
                    </div>

                    {/* API Configuration */}
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-4">API Configuration</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                            API Endpoint
                          </label>
                          <input type="url" defaultValue="https://api.jadarat.sa/v1" className="input-modern" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                            API Key
                          </label>
                          <input type="password" defaultValue="sk_live_xxxxxxxxxxxxx" className="input-modern" />
                        </div>
                      </div>
                    </div>

                    {/* Sync Settings */}
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-4">Synchronization Settings</h3>
                      <div className="space-y-4">
                        <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900/50 rounded-xl">
                          <div>
                            <p className="font-medium text-slate-900 dark:text-white">Auto-sync enabled</p>
                            <p className="text-sm text-slate-500">Automatically sync data every hour</p>
                          </div>
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" defaultChecked className="sr-only peer" />
                            <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-entlaqa-500/20 rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-entlaqa-600"></div>
                          </label>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                              Sync Interval
                            </label>
                            <select className="input-modern" defaultValue="60">
                              <option value="15">Every 15 minutes</option>
                              <option value="30">Every 30 minutes</option>
                              <option value="60">Every hour</option>
                              <option value="360">Every 6 hours</option>
                              <option value="1440">Daily</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                              Sync Direction
                            </label>
                            <select className="input-modern" defaultValue="bidirectional">
                              <option value="pull">Pull from LMS only</option>
                              <option value="push">Push to LMS only</option>
                              <option value="bidirectional">Bidirectional</option>
                            </select>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Data Mapping */}
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-4">Data to Sync</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {[
                          { label: 'Learner Profiles', synced: 1284, enabled: true },
                          { label: 'Course Catalog', synced: 48, enabled: true },
                          { label: 'Enrollments', synced: 3456, enabled: true },
                          { label: 'Attendance Records', synced: 12890, enabled: true },
                          { label: 'Certificates', synced: 892, enabled: false },
                          { label: 'Assessments', synced: 2341, enabled: true },
                        ].map((item) => (
                          <div key={item.label} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-900/50 rounded-lg">
                            <div className="flex items-center gap-3">
                              <input type="checkbox" defaultChecked={item.enabled} className="rounded border-slate-300 text-entlaqa-600 focus:ring-entlaqa-500" />
                              <div>
                                <p className="text-sm font-medium text-slate-900 dark:text-white">{item.label}</p>
                                <p className="text-xs text-slate-500">{item.synced.toLocaleString()} records</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Appearance Settings */}
              {activeTab === 'appearance' && (
                <div>
                  <div className="p-6 border-b border-slate-200 dark:border-slate-700">
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Appearance</h2>
                    <p className="text-sm text-slate-500 mt-1">Customize the look and feel of your platform</p>
                  </div>
                  <div className="p-6 space-y-6">
                    {/* Theme */}
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-4">Theme</h3>
                      <div className="grid grid-cols-3 gap-4">
                        {['Light', 'Dark', 'System'].map((theme) => (
                          <button
                            key={theme}
                            className={cn(
                              'p-4 rounded-xl border-2 transition-all',
                              theme === 'Light'
                                ? 'border-entlaqa-600 bg-entlaqa-50 dark:bg-entlaqa-950/30'
                                : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'
                            )}
                          >
                            <div className={cn(
                              'w-full h-16 rounded-lg mb-3',
                              theme === 'Light' ? 'bg-white border border-slate-200' : theme === 'Dark' ? 'bg-slate-900' : 'bg-gradient-to-r from-white to-slate-900'
                            )} />
                            <p className="text-sm font-medium text-slate-900 dark:text-white">{theme}</p>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Primary Color */}
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-4">Primary Color</h3>
                      <div className="flex items-center gap-3">
                        {['#1d65d8', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'].map((color) => (
                          <button
                            key={color}
                            className={cn(
                              'w-10 h-10 rounded-full ring-2 ring-offset-2 ring-offset-white dark:ring-offset-slate-800 transition-all',
                              color === '#1d65d8' ? 'ring-slate-900 dark:ring-white' : 'ring-transparent hover:ring-slate-300'
                            )}
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </div>
                    </div>

                    {/* Language */}
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-4">Language & Region</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                            Interface Language
                          </label>
                          <select className="input-modern" defaultValue="en">
                            <option value="en">English</option>
                            <option value="ar">العربية (Arabic)</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                            Default Content Language
                          </label>
                          <select className="input-modern" defaultValue="both">
                            <option value="en">English only</option>
                            <option value="ar">Arabic only</option>
                            <option value="both">Bilingual</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Users & Roles */}
              {activeTab === 'users' && (
                <div>
                  <div className="p-6 border-b border-slate-200 dark:border-slate-700">
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Users & Roles</h2>
                    <p className="text-sm text-slate-500 mt-1">Manage user accounts and permissions</p>
                  </div>
                  <div className="p-6">
                    <p className="text-slate-500">User management functionality coming soon...</p>
                  </div>
                </div>
              )}

              {/* Integrations */}
              {activeTab === 'integrations' && (
                <div>
                  <div className="p-6 border-b border-slate-200 dark:border-slate-700">
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Integrations</h2>
                    <p className="text-sm text-slate-500 mt-1">Connect with third-party services</p>
                  </div>
                  <div className="p-6 space-y-4">
                    {[
                      { name: 'Microsoft 365', description: 'Calendar and email integration', connected: true, icon: '📧' },
                      { name: 'Google Workspace', description: 'Calendar and drive integration', connected: false, icon: '📅' },
                      { name: 'Zoom', description: 'Virtual training sessions', connected: true, icon: '📹' },
                      { name: 'Slack', description: 'Notifications and alerts', connected: false, icon: '💬' },
                    ].map((integration) => (
                      <div key={integration.name} className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900/50 rounded-xl">
                        <div className="flex items-center gap-4">
                          <span className="text-2xl">{integration.icon}</span>
                          <div>
                            <p className="font-medium text-slate-900 dark:text-white">{integration.name}</p>
                            <p className="text-sm text-slate-500">{integration.description}</p>
                          </div>
                        </div>
                        <button className={cn(
                          'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                          integration.connected
                            ? 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                            : 'bg-entlaqa-600 text-white hover:bg-entlaqa-700'
                        )}>
                          {integration.connected ? 'Disconnect' : 'Connect'}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Save Button */}
              <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900/50 border-t border-slate-200 dark:border-slate-700 flex justify-end">
                <button onClick={handleSave} disabled={isSaving} className="btn-primary">
                  {isSaving ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      Save Changes
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
}
