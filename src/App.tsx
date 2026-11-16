import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import ErrorNote from './pages/ErrorNote';
import Plan from './pages/Plan';
import Vocab from './pages/Vocab';
import Mentor from './pages/Mentor';
import Board from './pages/Board';

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/errors" element={<ErrorNote />} />
        <Route path="/plan" element={<Plan />} />
        <Route path="/vocab" element={<Vocab />} />
        <Route path="/mentor" element={<Mentor />} />
        <Route path="/board" element={<Board />} />
      </Routes>
    </BrowserRouter>
  );
}
