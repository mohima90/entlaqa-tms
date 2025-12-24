'use client';

import { useState, useEffect } from 'react';
import { BarChart3, Users, BookOpen, Award, Calendar, TrendingUp, Download, Loader2, Building, Clock } from 'lucide-react';
import Header from '@/components/layout/Header';
import { createClient } from '@/lib/supabase';

export default function ReportsPage() {
  const [stats, setStats] = useState({
    totalCourses: 0,
    totalSessions: 0,
    totalLearners: 0,
    totalInstructors: 0,
    totalVenues: 0,
    totalCertificates: 0,
    totalAttendance: 0,
    attendanceRate: 0,
  });
  const [recentSessions, setRecentSessions] = useState<any[]>([]);
  const [topCourses, setTopCourses] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => { fetchReportData(); }, []);

  const fetchReportData = async () => {
    setIsLoading(true);

    const [coursesRes, sessionsRes, learnersRes, instructorsRes, venuesRes, certsRes, attendanceRes] = await Promise.all([
      supabase.from('courses').select('*', { count: 'exact' }),
      supabase.from('sessions').select('*').order('start_date', { ascending: false }).limit(10),
      supabase.from('learners').select('*', { count: 'exact' }),
      supabase.from('instructors').select('*', { count: 'exact' }),
      supabase.from('venues').select('*', { count: 'exact' }),
      supabase.from('certificates').select('*', { count: 'exact' }),
      supabase.from('attendance').select('*'),
    ]);

    const attendance = attendanceRes.data || [];
    const presentCount = attendance.filter(a => a.status === 'present').length;
    const attendanceRate = attendance.length > 0 ? Math.round((presentCount / attendance.length) * 100) : 0;

    setStats({
      totalCourses: coursesRes.count || 0,
      totalSessions: sessionsRes.data?.length || 0,
      totalLearners: learnersRes.count || 0,
      totalInstructors: instructorsRes.count || 0,
      totalVenues: venuesRes.count || 0,
      totalCertificates: certsRes.count || 0,
      totalAttendance: attendance.length,
      attendanceRate,
    });

    setRecentSessions(sessionsRes.data || []);

    // Get course enrollment counts
    const courses = coursesRes.data || [];
    const coursesWithStats = courses.slice(0, 5).map(course => ({
      ...course,
      sessions: sessionsRes.data?.filter(s => s.course_id === course.id).length || 0,
    }));
    setTopCourses(coursesWithStats);

    setIsLoading(false);
  };

  const exportReport = () => {
    const reportData = {
      generatedAt: new Date().toISOString(),
      summary: stats,
      recentSessions: recentSessions.map(s => ({ title: s.title, date: s.start_date, status: s.status })),
    };
    
    const blob = new Blob([JSON.stringify(reportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tms-report-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header title="Reports" subtitle="Training analytics and insights" />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 text-gray-400 animate-spin" /></div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header title="Reports" subtitle="Training analytics and insights" />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Export Button */}
        <div className="flex justify-end mb-6">
          <button onClick={exportReport} className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">
            <Download className="w-5 h-5" />Export Report
          </button>
        </div>

        {/* Overview Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-xl p-6 border border-gray-200">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center"><BookOpen className="w-6 h-6 text-blue-600" /></div>
              <div><p className="text-3xl font-bold text-gray-900">{stats.totalCourses}</p><p className="text-sm text-gray-500">Courses</p></div>
            </div>
          </div>
          <div className="bg-white rounded-xl p-6 border border-gray-200">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center"><Users className="w-6 h-6 text-green-600" /></div>
              <div><p className="text-3xl font-bold text-gray-900">{stats.totalLearners}</p><p className="text-sm text-gray-500">Learners</p></div>
            </div>
          </div>
          <div className="bg-white rounded-xl p-6 border border-gray-200">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center"><Calendar className="w-6 h-6 text-purple-600" /></div>
              <div><p className="text-3xl font-bold text-gray-900">{stats.totalSessions}</p><p className="text-sm text-gray-500">Sessions</p></div>
            </div>
          </div>
          <div className="bg-white rounded-xl p-6 border border-gray-200">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-yellow-100 rounded-xl flex items-center justify-center"><Award className="w-6 h-6 text-yellow-600" /></div>
              <div><p className="text-3xl font-bold text-gray-900">{stats.totalCertificates}</p><p className="text-sm text-gray-500">Certificates</p></div>
            </div>
          </div>
        </div>

        {/* Secondary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-xl p-4 border border-gray-200">
            <div className="flex items-center justify-between">
              <div><p className="text-2xl font-bold text-gray-900">{stats.totalInstructors}</p><p className="text-sm text-gray-500">Instructors</p></div>
              <Users className="w-8 h-8 text-orange-400" />
            </div>
          </div>
          <div className="bg-white rounded-xl p-4 border border-gray-200">
            <div className="flex items-center justify-between">
              <div><p className="text-2xl font-bold text-gray-900">{stats.totalVenues}</p><p className="text-sm text-gray-500">Venues</p></div>
              <Building className="w-8 h-8 text-indigo-400" />
            </div>
          </div>
          <div className="bg-white rounded-xl p-4 border border-gray-200">
            <div className="flex items-center justify-between">
              <div><p className="text-2xl font-bold text-gray-900">{stats.totalAttendance}</p><p className="text-sm text-gray-500">Attendance Records</p></div>
              <Clock className="w-8 h-8 text-cyan-400" />
            </div>
          </div>
          <div className="bg-white rounded-xl p-4 border border-gray-200">
            <div className="flex items-center justify-between">
              <div><p className="text-2xl font-bold text-green-600">{stats.attendanceRate}%</p><p className="text-sm text-gray-500">Attendance Rate</p></div>
              <TrendingUp className="w-8 h-8 text-green-400" />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent Sessions */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2"><Calendar className="w-5 h-5 text-primary-600" />Recent Sessions</h3>
            <div className="space-y-3">
              {recentSessions.length === 0 ? (
                <p className="text-gray-500 text-center py-4">No sessions found</p>
              ) : recentSessions.slice(0, 5).map((session) => (
                <div key={session.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium text-gray-900">{session.title || 'Untitled Session'}</p>
                    <p className="text-sm text-gray-500">{session.start_date || 'No date'}</p>
                  </div>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    session.status === 'completed' ? 'bg-green-100 text-green-800' :
                    session.status === 'ongoing' ? 'bg-blue-100 text-blue-800' :
                    session.status === 'scheduled' ? 'bg-yellow-100 text-yellow-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>{session.status || 'unknown'}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Top Courses */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2"><BarChart3 className="w-5 h-5 text-primary-600" />Courses Overview</h3>
            <div className="space-y-3">
              {topCourses.length === 0 ? (
                <p className="text-gray-500 text-center py-4">No courses found</p>
              ) : topCourses.map((course) => (
                <div key={course.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center"><BookOpen className="w-5 h-5 text-primary-600" /></div>
                    <div>
                      <p className="font-medium text-gray-900">{course.name}</p>
                      <p className="text-sm text-gray-500">{course.category || 'No category'}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-gray-900">{course.sessions}</p>
                    <p className="text-xs text-gray-500">sessions</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Summary Card */}
        <div className="mt-8 bg-gradient-to-r from-primary-600 to-primary-700 rounded-xl p-6 text-white">
          <h3 className="text-xl font-semibold mb-2">Training Summary</h3>
          <p className="text-primary-100 mb-4">Overview of your organization's training activities</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white/10 rounded-lg p-3">
              <p className="text-2xl font-bold">{stats.totalCourses}</p>
              <p className="text-sm text-primary-100">Active Courses</p>
            </div>
            <div className="bg-white/10 rounded-lg p-3">
              <p className="text-2xl font-bold">{stats.totalLearners}</p>
              <p className="text-sm text-primary-100">Enrolled Learners</p>
            </div>
            <div className="bg-white/10 rounded-lg p-3">
              <p className="text-2xl font-bold">{stats.totalCertificates}</p>
              <p className="text-sm text-primary-100">Certificates Issued</p>
            </div>
            <div className="bg-white/10 rounded-lg p-3">
              <p className="text-2xl font-bold">{stats.attendanceRate}%</p>
              <p className="text-sm text-primary-100">Avg Attendance</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
