import { useState } from 'react';
import Layout from '../components/Layout';

const ERRORS = [
  {
    id: 1,
    source: '2024 한양대 기출 · 12번',
    subject: '독해',
    date: '9/12',
    content: '밑줄 친 부분의 의미로 가장 적절한 것을 못 고르겠어요.',
    myAnswer: '③',
    correct: '⑤',
    aiAnalysis: '이 문제에서 ③은 단어의 표면적 의미만 보면 그럴듯하지만, 문단 전체 맥락에서 ⑤가 필자의 주장과 일치합니다. 주어진 지문에서 필자는 "despite appearances"를 반복하는데, 이는 반전을 암시해요.',
    reviewCount: 2,
  },
  {
    id: 2,
    source: 'aberration b',
    subject: '문법',
    date: '9/11',
    content: '가정법 도치에서 were 위치 혼동',
    myAnswer: '②',
    correct: '④',
    aiAnalysis: '"Were it not for..."는 If it were not for의 도치형으로, Were가 문두에 위치해요. ②는 일반 현재 조건절 형태라 오답이에요.',
    reviewCount: 1,
  },
  {
    id: 3,
    source: 'gnrok &',
    subject: '논리',
    date: '9/10',
    content: '빈칸 추론 — 선택지 ③④ 혼동',
    myAnswer: '③',
    correct: '④',
    aiAnalysis: '③은 지엽적 사례를 일반화한 함정 선택지예요. ④가 본문의 핵심 주장("구조보다 맥락")을 올바르게 담고 있습니다.',
    reviewCount: 0,
  },
];

export default function ErrorNote() {
  const [expanded, setExpanded] = useState<number | null>(null);

  return (
    <Layout>
      {/* Summary bar */}
      <div className="bg-white border-b border-gray-border px-4 py-3 flex gap-4">
        <div className="text-center">
          <p className="text-[20px] font-bold text-green-primary">48</p>
          <p className="text-[11px] text-gray-secondary">총 오답</p>
        </div>
        <div className="text-center">
          <p className="text-[20px] font-bold text-green-primary">62</p>
          <p className="text-[11px] text-gray-secondary">복습 완료</p>
        </div>
        <div className="text-center">
          <p className="text-[20px] font-bold text-green-primary">25</p>
          <p className="text-[11px] text-gray-secondary">미복습</p>
        </div>
        <div className="ml-auto flex items-center">
          <button className="bg-green-primary text-white text-[12px] font-bold px-3 py-1.5 rounded-lg">
            + 오답 추가
          </button>
        </div>
      </div>

      {/* Filter */}
      <div className="bg-white border-b border-gray-border px-4 py-2 flex gap-2 overflow-x-auto scrollbar-none">
        {['전체', '독해', '논리', '문법', '어휘'].map((f, i) => (
          <button
            key={f}
            className={`flex-shrink-0 px-3 py-1 rounded-full text-[12px] font-medium ${
              i === 0 ? 'bg-green-primary text-white' : 'bg-gray-bg text-gray-secondary'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Error list */}
      <div className="px-4 py-3 space-y-3">
        {ERRORS.map(err => (
          <div
            key={err.id}
            className="bg-white rounded-xl border border-gray-border overflow-hidden"
          >
            {/* Header */}
            <div
              className="p-4 cursor-pointer"
              onClick={() => setExpanded(expanded === err.id ? null : err.id)}
            >
              <div className="flex items-start justify-between mb-2">
                <div>
                  <span className="px-2 py-0.5 bg-green-chip text-green-primary text-[11px] font-medium rounded mr-2">
                    {err.subject}
                  </span>
                  <span className="text-[12px] text-gray-secondary">{err.source}</span>
                </div>
                <span className="text-[11px] text-gray-secondary">{err.date}</span>
              </div>
              <p className="text-[13px] text-gray-text">{err.content}</p>
              <div className="flex items-center gap-4 mt-2 text-[12px] text-gray-secondary">
                <span>내 답 <strong>{err.myAnswer}</strong></span>
                <span>정답 <strong className="text-green-primary">{err.correct}</strong></span>
                {err.reviewCount > 0 && (
                  <span className="ml-auto text-green-primary">복습 {err.reviewCount}회</span>
                )}
              </div>
            </div>

            {/* AI Analysis (expanded) */}
            {expanded === err.id && (
              <div className="border-t border-gray-border bg-green-light px-4 py-3">
                <p className="text-[12px] font-bold text-green-primary mb-1">🤖 AI 오답 분석</p>
                <p className="text-[13px] text-gray-text leading-5">{err.aiAnalysis}</p>
                <div className="flex gap-2 mt-3">
                  <button className="flex-1 bg-white border border-green-primary text-green-primary text-[12px] font-bold py-2 rounded-lg">
                    → 다시 풀기
                  </button>
                  <button className="flex-1 bg-green-primary text-white text-[12px] font-bold py-2 rounded-lg">
                    ✓ 복습 완료
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </Layout>
  );
}
