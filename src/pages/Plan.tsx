import { useState } from 'react';
import Layout from '../components/Layout';

const DAYS = ['월', '화', '수', '목', '금', '토', '일'];
const SUBJECTS = ['수능 독해', '논리 빈칸', '문법 완성', '어휘 스프린트'];

type DayPlan = { hours: number; minutes: number };

export default function Plan() {
  const [activeTab, setActiveTab] = useState<'plan' | 'problems'>('plan');
  const [weekHours, setWeekHours] = useState(20);
  const [dayPlans] = useState<Record<string, DayPlan>>({
    월: { hours: 3, minutes: 0 },
    화: { hours: 3, minutes: 0 },
    수: { hours: 3, minutes: 0 },
    목: { hours: 3, minutes: 0 },
    금: { hours: 3, minutes: 0 },
    토: { hours: 4, minutes: 0 },
    일: { hours: 1, minutes: 0 },
  });

  return (
    <Layout>
      {/* Tabs */}
      <div className="flex bg-white border-b border-gray-border">
        {(['plan', 'problems'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-3 text-[14px] font-medium flex items-center justify-center gap-1.5 ${
              activeTab === tab
                ? 'text-green-primary border-b-2 border-green-primary font-bold'
                : 'text-gray-secondary'
            }`}
          >
            {tab === 'plan' ? '🗓️ 플랜짜기' : '📋 맞춤문제'}
          </button>
        ))}
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* AI 진단 */}
        <div className="bg-green-light rounded-xl px-4 py-3 border-l-4 border-green-primary">
          <div className="flex justify-between items-start mb-1">
            <span className="text-[13px] font-bold text-green-primary">🧠 현재 상태 진단</span>
            <span className="text-[11px] text-gray-secondary">단계: 중급</span>
          </div>
          <p className="text-[13px] text-gray-text leading-5">
            단어 마스터를 보니까, 토픽·문법 등급점수를 받을 수 있도록 현재 실력이<br />
            이 정도면 추천에 맞게 짜드리는 중이에요.
          </p>
          <button className="text-[12px] text-green-primary font-medium mt-2 underline">
            ▶ 현재 상태 진단하기
          </button>
        </div>

        {/* Weekly planner */}
        <div className="bg-white rounded-xl border border-gray-border p-4">
          <div className="flex justify-between items-center mb-3">
            <span className="text-[14px] font-bold text-gray-text">🗓️ 주간 플래너</span>
            <span className="text-[13px] text-gray-secondary">주 {weekHours}시간</span>
          </div>

          {/* Total hours slider */}
          <div className="mb-4">
            <div className="flex justify-between text-[12px] text-gray-secondary mb-1">
              <span>주당 목표</span>
              <span className="font-bold text-green-primary">{weekHours}시간</span>
            </div>
            <input
              type="range"
              min={5} max={40} value={weekHours}
              onChange={e => setWeekHours(Number(e.target.value))}
              className="w-full accent-green-primary"
            />
          </div>

          {/* Day rows */}
          <div className="space-y-2">
            {DAYS.map(day => {
              const plan = dayPlans[day];
              return (
                <div key={day} className="flex items-center gap-2">
                  <span className="w-5 text-[13px] font-medium text-gray-text">{day}</span>
                  <div className="flex-1 bg-gray-bg rounded-lg px-3 py-2 flex items-center justify-between">
                    <span className="text-[13px] text-gray-text">순공</span>
                    <span className="text-[13px] font-bold text-gray-text">
                      {plan.hours}시간 {plan.minutes > 0 ? `${plan.minutes}분` : ''}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Curriculum recs */}
        <div className="bg-white rounded-xl border border-gray-border p-4">
          <p className="text-[14px] font-bold text-gray-text mb-3">어떤 커리를 어떻게 들을지</p>
          <div className="space-y-2.5">
            {SUBJECTS.map((s, i) => (
              <div key={s} className="flex items-center gap-3">
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] flex-shrink-0 ${
                  i < 3 ? 'bg-green-primary text-white' : 'bg-gray-border text-gray-secondary'
                }`}>
                  {i < 3 ? '✓' : '✗'}
                </span>
                <div className="flex-1">
                  <p className="text-[13px] font-medium text-gray-text">{s}</p>
                  <p className="text-[11px] text-gray-secondary">
                    {i === 0 ? '14일 · 12h' : i === 1 ? '21일 · 14h' : i === 2 ? '20일 · 18h' : '12일 · 8h'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Layout>
  );
}
