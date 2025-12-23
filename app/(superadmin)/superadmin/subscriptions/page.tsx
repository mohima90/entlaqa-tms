'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { CreditCard, Building2, TrendingUp, DollarSign, CheckCircle, ArrowUpRight, Edit, Loader2, X, Check } from 'lucide-react';
import { createClient } from '@/lib/supabase';

const plans = [
  { id: 'free', name: 'Free', price: 0, users: 5, learners: 50, storage: 1 },
  { id: 'basic', name: 'Basic', price: 99, users: 25, learners: 500, storage: 10 },
  { id: 'pro', name: 'Pro', price: 299, users: 100, learners: 2000, storage: 50 },
  { id: 'enterprise', name: 'Enterprise', price: 999, users: -1, learners: -1, storage: -1 },
];

export default function SubscriptionsPage() {
  const [subscriptions, setSubscriptions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedOrg, setSelectedOrg] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState('basic');
  const [isSaving, setIsSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const supabase = createClient();

  useEffect(() => { fetchSubscriptions(); }, []);

  const fetchSubscriptions = async () => {
    setIsLoading(true);
    const { data: orgs } = await supabase.from('organizations').select('id, name, subscription_plan, status, created_at, settings').order('name');
    const subs = await Promise.all((orgs || []).map(async (org) => {
      const { count: userCount } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('organization_id', org.id);
      const plan = plans.find((p) => p.id === org.subscription_plan) || plans[0];
      return { organization_id: org.id, organization_name: org.name, plan: org.subscription_plan || 'free', status: org.status === 'active' ? 'active' : 'suspended', amount: plan.price, billing_cycle: 'monthly', start_date: org.created_at, next_billing: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), users_count: userCount || 0, users_limit: plan.users };
    }));
    setSubscriptions(subs);
    setIsLoading(false);
  };

  const openChangePlan = (orgId: string, currentPlan: string) => { setSelectedOrg(orgId); setSelectedPlan(currentPlan); setIsModalOpen(true); };

  const handlePlanChange = async () => {
    if (!selectedOrg) return;
    setIsSaving(true);
    const { error } = await supabase.from('organizations').update({ subscription_plan: selectedPlan, updated_at: new Date().toISOString() }).eq('id', selectedOrg);
    if (!error) { setSuccess('Plan updated successfully!'); fetchSubscriptions(); setIsModalOpen(false); }
    setIsSaving(false);
    setTimeout(() => setSuccess(''), 3000);
  };

  const planColors: Record<string, string> = { free: 'bg-slate-500/20 text-slate-400 border-slate-500', basic: 'bg-blue-500/20 text-blue-400 border-blue-500', pro: 'bg-purple-500/20 text-purple-400 border-purple-500', enterprise: 'bg-yellow-500/20 text-yellow-400 border-yellow-500' };
  const totalMRR = subscriptions.reduce((sum, sub) => sum + sub.amount, 0);

  return (
    <div className="space-y-6">
      {success && <div className="p-4 bg-green-500/20 border border-green-500 rounded-lg flex items-center gap-3"><CheckCircle className="w-5 h-5 text-green-400" /><p className="text-green-400">{success}</p></div>}

      <div><h1 className="text-2xl font-bold text-white">Subscriptions & Billing</h1><p className="text-slate-400">Manage organization subscriptions and revenue</p></div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-gradient-to-br from-green-600 to-green-700 rounded-xl p-6">
          <div className="flex items-center justify-between mb-2"><DollarSign className="w-8 h-8 text-green-200" /><span className="flex items-center gap-1 text-green-200 text-sm"><ArrowUpRight className="w-4 h-4" /> 23%</span></div>
          <p className="text-3xl font-bold text-white">${totalMRR.toLocaleString()}</p>
          <p className="text-green-200 text-sm">Monthly Recurring Revenue</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2"><TrendingUp className="w-8 h-8 text-blue-400" /></div>
          <p className="text-3xl font-bold text-white">${(totalMRR * 12).toLocaleString()}</p>
          <p className="text-slate-400 text-sm">Annual Run Rate</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2"><Building2 className="w-8 h-8 text-purple-400" /></div>
          <p className="text-3xl font-bold text-white">{subscriptions.filter((s) => s.plan !== 'free').length}</p>
          <p className="text-slate-400 text-sm">Paying Customers</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2"><CreditCard className="w-8 h-8 text-yellow-400" /></div>
          <p className="text-3xl font-bold text-white">${Math.round(totalMRR / Math.max(subscriptions.filter((s) => s.plan !== 'free').length, 1))}</p>
          <p className="text-slate-400 text-sm">Avg Revenue Per Customer</p>
        </motion.div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {plans.map((plan) => {
          const count = subscriptions.filter((s) => s.plan === plan.id).length;
          return (
            <div key={plan.id} className={`bg-slate-800 rounded-xl p-4 border ${planColors[plan.id].split(' ')[2]}`}>
              <div className="flex items-center justify-between mb-2"><span className={`px-2 py-1 rounded text-xs font-medium ${planColors[plan.id].split(' ').slice(0, 2).join(' ')}`}>{plan.name}</span><span className="text-2xl font-bold text-white">{count}</span></div>
              <p className="text-slate-400 text-sm">${plan.price === 0 ? 'Free' : `${plan.price}/mo`}</p>
            </div>
          );
        })}
      </div>

      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <div className="p-4 border-b border-slate-700"><h2 className="text-lg font-semibold text-white">All Subscriptions</h2></div>
        <table className="w-full">
          <thead className="bg-slate-700/50"><tr><th className="px-6 py-4 text-left text-xs font-medium text-slate-400 uppercase">Organization</th><th className="px-6 py-4 text-left text-xs font-medium text-slate-400 uppercase">Plan</th><th className="px-6 py-4 text-left text-xs font-medium text-slate-400 uppercase">Status</th><th className="px-6 py-4 text-left text-xs font-medium text-slate-400 uppercase">Amount</th><th className="px-6 py-4 text-left text-xs font-medium text-slate-400 uppercase">Users</th><th className="px-6 py-4 text-left text-xs font-medium text-slate-400 uppercase">Next Billing</th><th className="px-6 py-4 text-right text-xs font-medium text-slate-400 uppercase">Actions</th></tr></thead>
          <tbody className="divide-y divide-slate-700">
            {isLoading ? <tr><td colSpan={7} className="px-6 py-12 text-center"><Loader2 className="w-8 h-8 text-slate-400 animate-spin mx-auto" /></td></tr> : subscriptions.map((sub) => (
              <tr key={sub.organization_id} className="hover:bg-slate-700/30">
                <td className="px-6 py-4"><div className="flex items-center gap-3"><div className="w-10 h-10 bg-slate-700 rounded-lg flex items-center justify-center"><Building2 className="w-5 h-5 text-slate-400" /></div><span className="font-medium text-white">{sub.organization_name}</span></div></td>
                <td className="px-6 py-4"><span className={`px-2.5 py-1 rounded-full text-xs font-medium ${planColors[sub.plan].split(' ').slice(0, 2).join(' ')}`}>{sub.plan.charAt(0).toUpperCase() + sub.plan.slice(1)}</span></td>
                <td className="px-6 py-4"><span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${sub.status === 'active' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}><span className={`w-1.5 h-1.5 rounded-full ${sub.status === 'active' ? 'bg-green-400' : 'bg-red-400'}`} />{sub.status}</span></td>
                <td className="px-6 py-4 text-white font-medium">{sub.amount === 0 ? 'Free' : `$${sub.amount}/mo`}</td>
                <td className="px-6 py-4"><div className="flex items-center gap-2"><span className="text-slate-300">{sub.users_count}</span><span className="text-slate-500">/</span><span className="text-slate-500">{sub.users_limit === -1 ? '∞' : sub.users_limit}</span></div></td>
                <td className="px-6 py-4 text-slate-400 text-sm">{sub.amount === 0 ? '—' : new Date(sub.next_billing).toLocaleDateString()}</td>
                <td className="px-6 py-4"><button onClick={() => openChangePlan(sub.organization_id, sub.plan)} className="flex items-center gap-2 px-3 py-1.5 text-sm text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg"><Edit className="w-4 h-4" />Change Plan</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-slate-800 rounded-xl border border-slate-700 w-full max-w-2xl">
            <div className="flex items-center justify-between p-6 border-b border-slate-700"><h2 className="text-xl font-semibold text-white">Change Subscription Plan</h2><button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-white"><X className="w-6 h-6" /></button></div>
            <div className="p-6">
              <div className="grid grid-cols-2 gap-4">
                {plans.map((plan) => (
                  <button key={plan.id} onClick={() => setSelectedPlan(plan.id)} className={`p-4 rounded-xl border-2 text-left transition-all ${selectedPlan === plan.id ? 'border-red-500 bg-red-500/10' : 'border-slate-700 hover:border-slate-600'}`}>
                    <div className="flex items-center justify-between mb-2"><span className={`px-2 py-1 rounded text-xs font-medium ${planColors[plan.id].split(' ').slice(0, 2).join(' ')}`}>{plan.name}</span>{selectedPlan === plan.id && <Check className="w-5 h-5 text-red-500" />}</div>
                    <p className="text-2xl font-bold text-white mb-2">{plan.price === 0 ? 'Free' : `$${plan.price}`}{plan.price > 0 && <span className="text-sm text-slate-400">/mo</span>}</p>
                    <ul className="space-y-1 text-sm text-slate-400"><li>{plan.users === -1 ? 'Unlimited' : plan.users} users</li><li>{plan.learners === -1 ? 'Unlimited' : plan.learners} learners</li><li>{plan.storage === -1 ? 'Unlimited' : `${plan.storage}GB`} storage</li></ul>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-3 p-6 border-t border-slate-700"><button onClick={() => setIsModalOpen(false)} className="px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600">Cancel</button><button onClick={handlePlanChange} disabled={isSaving} className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">{isSaving && <Loader2 className="w-4 h-4 animate-spin" />}Update Plan</button></div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
