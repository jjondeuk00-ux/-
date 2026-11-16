import { useState } from 'react';
import Layout from '../components/Layout';

const FILTER_TYPES = ['전체', '학습방향', '방법 고민', '슬럼프', '대학별 전략'];

const MENTORS = [
  {
    id: 1,
    name: '김OO',
    univ: '한양대 편입 (2023)',
    tag: '학습방향',
    emoji: '🎯',
    intro: '"인강만으로 합격했어요. 커리 짜는 법부터 약점 파악까지 도와드릴게요 :)"',
    reply: 24,
  },
  {
    id: 2,
    name: '이OO',
    univ: '중앙대 편입 (2024)',
    tag: '방법 고민',
    emoji: '📖',
    intro: '"독해 기초부터 논리까지 혼자 공부하면서 느낀 함정들 솔직하게 얘기해드려요."',
    reply: 31,
  },
  {
    id: 3,
    name: '박OO',
    univ: '건국대 편입 (2023)',
    tag: '슬럼프',
    emoji: '💪',
    intro: '"슬럼프 3번 왔다 갔어요. 멘탈 관리법이랑 루틴 회복 같이 고민해요."',
    reply: 18,
  },
  {
    id: 4,
    name: '최OO',
    univ: '경희대 편입 (2024)',
    tag: '대학별 전략',
    emoji: '🏫',
    intro: '"경희대 영어·논술 비중이 헷갈리죠? 실제 경험 기반으로 전략 같이 세워요."',
    reply: 12,
  },
];

export default function Mentor() {
  const [activeFilter, setActiveFilter] = useState('전체');

  const filtered = activeFilter === '전체'
    ? MENTORS
    : MENTORS.filter(m => m.tag === activeFilter);

  return (
    <Layout>
      {/* Hero */}
      <div className="bg-green-primary text-white px-5 py-5">
        <h1 className="text-[17px] font-bold mb-2">합격자에게 편입 고민 상담받기 🎓</h1>
        <p className="text-[13px] opacity-85 leading-relaxed">
          같은 과정 거친 합격자와 1:1 비공개 상담<br />
          학습방향 · 방법 고민 · 슬럼프 모두 OK
        </p>
      </div>

      {/* Filter */}
      <div className="bg-white px-4 py-4 border-b border-gray-border">
        <p className="text-[14px] font-bold text-gray-text mb-3">고민 유형을 선택하세요</p>
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          {FILTER_TYPES.map(f => (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors ${
                activeFilter === f
                  ? 'bg-green-primary text-white'
                  : 'bg-green-chip text-green-primary'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* List header */}
      <div className="flex justify-between items-center px-4 pt-4 pb-2">
        <span className="text-[15px] font-bold text-gray-text">활동 중인 합격자 멘토</span>
        <span className="text-[13px] text-gray-secondary">총 {filtered.length}명</span>
      </div>

      {/* Mentor cards */}
      <div className="px-4 space-y-3 pb-6">
        {filtered.map(mentor => (
          <div key={mentor.id} className="bg-white rounded-xl border border-gray-border p-4">
            {/* Top row */}
            <div className="flex items-center gap-3 mb-3">
              <div className="w-11 h-11 rounded-full bg-green-chip flex items-center justify-center text-xl flex-shrink-0">
                {mentor.emoji}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-bold text-gray-text">{mentor.name}</p>
                <p className="text-[12px] text-gray-secondary">{mentor.univ}</p>
              </div>
              <span className="flex-shrink-0 px-2 py-1 bg-green-chip text-green-primary text-[11px] font-medium rounded-md">
                {mentor.tag}
              </span>
            </div>

            {/* Intro */}
            <p className="text-[13px] text-gray-text leading-5 mb-3">{mentor.intro}</p>

            {/* Stats */}
            <p className="text-[12px] text-gray-secondary mb-3">상담 완료 {mentor.reply}건</p>

            {/* CTA */}
            <button className="w-full bg-green-primary text-white font-bold text-[13px] py-2.5 rounded-lg">
              상담 신청하기
            </button>
          </div>
        ))}
      </div>

      {/* Bottom note */}
      <div className="mx-4 mb-6 bg-green-light rounded-xl p-4">
        <p className="text-[13px] text-green-primary font-medium mb-1">💡 멘토 상담 안내</p>
        <p className="text-[12px] text-gray-secondary leading-relaxed">
          멘토는 준비생의 미션 완수 여부나 진도를 직접 확인하지 않아요.
          학습 관리는 앱이 하고, 멘토는 고민 상담 채널이에요.
        </p>
      </div>
    </Layout>
  );
}
