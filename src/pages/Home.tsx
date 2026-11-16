import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';

const SHORTCUTS = [
  { icon: '📝', label: '오답노트', desc: '틀린 문제 기록·복습', path: '/errors' },
  { icon: '📚', label: '암기장', desc: '단어·문법·공식', path: '/vocab' },
  { icon: '🎯', label: '맞춤학습', desc: '약점 맞춤 문제·기출', path: '/plan' },
  { icon: '👥', label: '커뮤니티', desc: '질문·멘토·랭킹', path: '/board' },
];

const HOW_TO = [
  { num: '①', title: '틀린 문제 기록', desc: '왜 틀렸는지 사고 과정을 구조화해서 남겨요.' },
  { num: '②', title: '핵심복습 · 다시풀기', desc: 'AI 코치가 핵심을 짚어주고 제대로 교정했는지 확인해요.' },
  { num: '③', title: '완전히 내 것으로', desc: '몰랐던 단어·문법·공식을 암기장으로, 동료는 커뮤니티에서.' },
];

export default function Home() {
  const navigate = useNavigate();
  return (
    <Layout>
      {/* Hero */}
      <div className="bg-green-primary text-white px-5 pt-6 pb-7">
        <p className="text-sm mb-1 opacity-80">김방장2님, 안녕하세요 👋</p>
        <h1 className="text-[22px] font-bold leading-tight mb-3">
          틀린 문제를<br />'사고 과정'부터 교정하는 곳
        </h1>
        <p className="text-[13px] opacity-80 leading-relaxed mb-5">
          꼬집은 단순히 오답을 모으는 노트가 아니에요. 왜 틀렸는지<br />
          생각의 흐름을 교정해 같은 실수를 반복하지 않게 만드는<br />
          오답 사고교정 서비스예요.
        </p>
        <button
          onClick={() => navigate('/errors')}
          className="bg-white text-green-primary font-bold text-[14px] px-5 py-2.5 rounded-full"
        >
          오답 기록 시작하기 →
        </button>
      </div>

      {/* How to use */}
      <div className="px-4 pt-5 pb-2">
        <h2 className="text-[15px] font-bold text-gray-text mb-3">꼬집은 이렇게 써요</h2>
        <div className="space-y-3">
          {HOW_TO.map(item => (
            <div key={item.num} className="flex items-start gap-3 bg-white rounded-xl p-4">
              <span className="text-green-primary text-[22px] mt-0.5">
                {item.num === '①' ? '📝' : item.num === '②' ? '🔁' : '🎓'}
              </span>
              <div>
                <p className="text-[14px] font-bold text-gray-text">
                  {item.num} {item.title}
                </p>
                <p className="text-[13px] text-gray-secondary mt-0.5">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Shortcuts */}
      <div className="px-4 pt-4">
        <h2 className="text-[15px] font-bold text-gray-text mb-3">바로가기</h2>
        <div className="grid grid-cols-2 gap-3">
          {SHORTCUTS.map(s => (
            <button
              key={s.path}
              onClick={() => navigate(s.path)}
              className="bg-white rounded-xl p-4 text-left"
            >
              <span className="text-2xl">{s.icon}</span>
              <p className="text-[14px] font-bold text-gray-text mt-2">{s.label}</p>
              <p className="text-[12px] text-gray-secondary">{s.desc}</p>
            </button>
          ))}
        </div>
      </div>
    </Layout>
  );
}
