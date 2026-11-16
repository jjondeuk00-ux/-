import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import Auth from './pages/Auth';
import Home from './pages/Home';
import ErrorNote from './pages/ErrorNote';
import Plan from './pages/Plan';
import Vocab from './pages/Vocab';
import Mentor from './pages/Mentor';
import Board from './pages/Board';

function ProtectedRoutes() {
  const { session, loading } = useAuth();
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-[#F4F4F0]">
      <div className="text-[#0D5C46] text-sm">로딩 중...</div>
    </div>
  );
  if (!session) return <Navigate to="/auth" replace />;
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/errors" element={<ErrorNote />} />
      <Route path="/plan" element={<Plan />} />
      <Route path="/vocab" element={<Vocab />} />
      <Route path="/mentor" element={<Mentor />} />
      <Route path="/board" element={<Board />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/auth" element={<Auth />} />
        <Route path="/*" element={<ProtectedRoutes />} />
      </Routes>
    </BrowserRouter>
  );
}
