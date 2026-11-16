import { useNavigate, useLocation } from 'react-router-dom';

const TABS = [
  { label: '홈', path: '/' },
  { label: '오답노트', path: '/errors' },
  { label: '맞춤학습', path: '/plan' },
  { label: '암기장', path: '/vocab' },
  { label: '멘토', path: '/mentor' },
];

export default function TabNav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  return (
    <nav className="flex bg-white border-b border-gray-border">
      {TABS.map(tab => {
        const isActive = pathname === tab.path;
        return (
          <button
            key={tab.path}
            onClick={() => navigate(tab.path)}
            className="flex-1 flex flex-col items-center justify-center h-10 relative"
          >
            <span
              className={`text-[13px] ${isActive ? 'font-bold text-green-primary' : 'font-medium text-gray-secondary'}`}
            >
              {tab.label}
            </span>
            {isActive && (
              <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-10 h-0.5 bg-green-primary rounded-full" />
            )}
          </button>
        );
      })}
    </nav>
  );
}
