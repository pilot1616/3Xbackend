import { Suspense, lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { AppShell } from './components/AppShell';

// 页面按路由分片加载，重页面（行情/分析）不再进入首屏 bundle。
const AIChatPage = lazy(() => import('./pages/AIChatPage').then((m) => ({ default: m.AIChatPage })));
const AIDailyPage = lazy(() => import('./pages/AIDailyPage').then((m) => ({ default: m.AIDailyPage })));
const AdminSyncPage = lazy(() => import('./pages/AdminSyncPage').then((m) => ({ default: m.AdminSyncPage })));
const AdminAgentLogsPage = lazy(() => import('./pages/AdminAgentLogsPage').then((m) => ({ default: m.AdminAgentLogsPage })));
const AnalysisPage = lazy(() => import('./pages/AnalysisPage').then((m) => ({ default: m.AnalysisPage })));
const AuthPage = lazy(() => import('./pages/AuthPage').then((m) => ({ default: m.AuthPage })));
const HomePage = lazy(() => import('./pages/HomePage').then((m) => ({ default: m.HomePage })));
const MarketPage = lazy(() => import('./pages/MarketPage').then((m) => ({ default: m.MarketPage })));
const ProfilePage = lazy(() => import('./pages/ProfilePage').then((m) => ({ default: m.ProfilePage })));
const PublishPage = lazy(() => import('./pages/PublishPage').then((m) => ({ default: m.PublishPage })));
const QuestionDetailPage = lazy(() => import('./pages/QuestionDetailPage').then((m) => ({ default: m.QuestionDetailPage })));

function RouteFallback() {
  return (
    <div style={{ padding: '48px 16px', textAlign: 'center', color: '#8a94a6' }} role="status" aria-label="页面加载中">
      加载中...
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route element={<AuthPage />} path="/auth" />
          <Route element={<AppShell />} path="/">
            <Route element={<HomePage />} index />
            <Route element={<MarketPage />} path="market" />
            <Route element={<AnalysisPage />} path="analysis" />
            <Route element={<AIDailyPage />} path="ai-daily" />
            <Route element={<AdminSyncPage />} path="admin/sync" />
            <Route element={<AdminAgentLogsPage />} path="admin/agent-logs" />
            <Route element={<PublishPage />} path="publish" />
            <Route element={<AIChatPage />} path="ai-chat" />
            <Route element={<Navigate replace to="/ai-chat" />} path="album" />
            <Route element={<ProfilePage />} path="profile" />
            <Route element={<QuestionDetailPage />} path="questions/:qid" />
            <Route element={<Navigate replace to="/" />} path="*" />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
