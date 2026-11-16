import { useState } from 'react';
import Layout from '../components/Layout';

const WORDS = [
  { word: 'aberration', meaning: '이탈, 변칙', example: 'The warm winter was an aberration.', level: 3 },
  { word: 'pertinent', meaning: '적절한, 관련된', example: 'Please make pertinent remarks.', level: 2 },
  { word: 'ameliorate', meaning: '개선하다', example: 'Measures to ameliorate the situation.', level: 4 },
  { word: 'benevolent', meaning: '자애로운, 인자한', example: 'A benevolent leader.', level: 2 },
];

export default function Vocab() {
  const [revealed, setRevealed] = useState<number[]>([]);

  const toggle = (id: number) =>
    setRevealed(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  return (
    <Layout>
      {/* Stats */}
      <div className="bg-white border-b border-gray-border px-4 py-3 flex gap-6 items-center">
        <div>
          <p className="text-[20px] font-bold text-green-primary">127</p>
          <p className="text-[11px] text-gray-secondary">총 단어</p>
        </div>
        <div>
          <p className="text-[20px] font-bold text-green-primary">84</p>
          <p className="text-[11px] text-gray-secondary">암기 완료</p>
        </div>
        <div>
          <p className="text-[20px] font-bold text-green-primary">43</p>
          <p className="text-[11px] text-gray-secondary">학습 중</p>
        </div>
        <button className="ml-auto bg-green-primary text-white text-[12px] font-bold px-3 py-1.5 rounded-lg">
          + 단어 추가
        </button>
      </div>

      {/* Category tabs */}
      <div className="flex bg-white border-b border-gray-border">
        {['단어', '문법', '공식'].map((tab, i) => (
          <button
            key={tab}
            className={`flex-1 py-2.5 text-[13px] font-medium ${
              i === 0
                ? 'text-green-primary border-b-2 border-green-primary font-bold'
                : 'text-gray-secondary'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Word cards */}
      <div className="px-4 py-3 space-y-3">
        {WORDS.map((w, i) => (
          <div
            key={i}
            className="bg-white rounded-xl border border-gray-border p-4 cursor-pointer"
            onClick={() => toggle(i)}
          >
            <div className="flex justify-between items-start">
              <div>
                <p className="text-[16px] font-bold text-gray-text">{w.word}</p>
                {revealed.includes(i) ? (
                  <>
                    <p className="text-[14px] text-green-primary font-medium mt-1">{w.meaning}</p>
                    <p className="text-[12px] text-gray-secondary italic mt-1">{w.example}</p>
                  </>
                ) : (
                  <p className="text-[13px] text-gray-secondary mt-1">탭해서 뜻 보기</p>
                )}
              </div>
              <div className="flex flex-col items-end gap-1">
                {'★'.repeat(w.level).split('').map((_, j) => (
                  <span key={j} className="text-yellow-400 text-xs">★</span>
                ))}
                <span className={`text-[11px] px-1.5 py-0.5 rounded ${
                  revealed.includes(i) ? 'bg-green-chip text-green-primary' : 'bg-gray-bg text-gray-secondary'
                }`}>
                  {revealed.includes(i) ? '확인' : '미확인'}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Layout>
  );
}
