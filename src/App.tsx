import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/common/Layout';
import HomePage from './pages/Home';
import LearnPage from './pages/Learn';
import PracticePage from './pages/Practice';
import ReviewPage from './pages/Review';
import RestPage from './pages/Rest';
import ProfilePage from './pages/Profile';
import SettingsPage from './pages/Settings';
import ParentPage from './pages/Parent';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/home" replace />} />
          <Route path="home" element={<HomePage />} />
          <Route path="learn" element={<LearnPage />} />
          <Route path="review" element={<ReviewPage />} />
          <Route path="rest" element={<RestPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="parent" element={<ParentPage />} />
        </Route>
        {/* 做题页独立于 Layout（全屏沉浸） */}
        <Route path="practice" element={<PracticePage />} />
        <Route path="practice/:unitId" element={<PracticePage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;

