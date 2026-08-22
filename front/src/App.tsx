import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { AppShell } from './components/AppShell';
import { AIChatPage } from './pages/AIChatPage';
import { AIDailyPage } from './pages/AIDailyPage';
import { AnalysisPage } from './pages/AnalysisPage';
import { AuthPage } from './pages/AuthPage';
import { HomePage } from './pages/HomePage';
import { MarketPage } from './pages/MarketPage';
import { ProfilePage } from './pages/ProfilePage';
import { PublishPage } from './pages/PublishPage';
import { QuestionDetailPage } from './pages/QuestionDetailPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AuthPage />} path="/auth" />
        <Route element={<AppShell />} path="/">
          <Route element={<HomePage />} index />
          <Route element={<MarketPage />} path="market" />
          <Route element={<AnalysisPage />} path="analysis" />
          <Route element={<AIDailyPage />} path="ai-daily" />
          <Route element={<PublishPage />} path="publish" />
          <Route element={<AIChatPage />} path="ai-chat" />
          <Route element={<Navigate replace to="/ai-chat" />} path="album" />
          <Route element={<ProfilePage />} path="profile" />
          <Route element={<QuestionDetailPage />} path="questions/:qid" />
          <Route element={<Navigate replace to="/" />} path="*" />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
