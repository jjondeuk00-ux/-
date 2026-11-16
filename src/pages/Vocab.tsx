import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { supabase } from '../lib/supabase';

type Word = {
  id: string;
  en: string;
  ko: string;
  memorized: boolean;
  enrichment?: { meaning: string; example: string } | null;
};

const TABS = ['단어', '문법', '공식'] as const;
type Tab = (typeof TABS)[number];

export default function Vocab() {
  const [words, setWords] = useState<Word[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('단어');
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (tab === '단어') fetchWords();
  }, [tab]);

  async function fetchWords() {
    setLoading(true);
    const { data, error } = await supabase
      .from('vocabulary')
      .select('id, en, ko, memorized')
      .order('created_at', { ascending: false })
      .limit(50);
    if (!error && data) setWords(data);
    setLoading(false);
  }

  function toggle(id: string) {
    setRevealed(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function toggleMemorized(id: string, current: boolean) {
    await supabase.from('vocabulary').update({ memorized: !current }).eq('id', id);
    setWords(prev => prev.map(w => w.id === id ? { ...w, memorized: !current } : w));
  }

  const memorized = words.filter(w => w.memorized).length;

  return (
    <Layout>
      {/* Stats */}
      <div className="bg-white border-b border-gray-border px-4 py-3 flex gap-6 items-center">
        <div>
          <p className="text-[20px] font-bold text-green-primary">{words.length}</p>
          <p className="text-[11px] text-gray-secondary">총 단어</p>
        </div>
        <div>
          <p className="text-[20px] font-bold text-green-primary">{memorized}</p>
          <p className="text-[11px] text-gray-secondary">암기 완료</p>
        </div>
        <div>
          <p className="text-[20px] font-bold text-green-primary">{words.length - memorized}</p>
          <p className="text-[11px] text-gray-secondary">학습 중</p>
        </div>
        <button className="ml-auto bg-green-primary text-white text-[12px] font-bold px-3 py-1.5 rounded-lg">
          + 단어 추가
        </button>
      </div>

      {/* Category tabs */}
      <div className="flex bg-white border-b border-gray-border">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2.5 text-[13px] font-medium ${
              tab === t
                ? 'text-green-primary border-b-2 border-green-primary font-bold'
                : 'text-gray-secondary'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Word cards */}
      <div className="px-4 py-3 space-y-3">
        {loading && tab === '단어' && (
          <p className="text-center text-sm text-gray-secondary py-8">불러오는 중...</p>
        )}
        {!loading && tab === '단어' && words.length === 0 && (
          <p className="text-center text-sm text-gray-secondary py-8">단어 목록이 없어요</p>
        )}
        {tab !== '단어' && (
          <p className="text-center text-sm text-gray-secondary py-8">준비 중이에요</p>
        )}
        {tab === '단어' && words.map(w => (
          <div
            key={w.id}
            className="bg-white rounded-xl border border-gray-border p-4 cursor-pointer"
            onClick={() => toggle(w.id)}
          >
            <div className="flex justify-between items-start">
              <div className="flex-1 min-w-0">
                <p className="text-[16px] font-bold text-gray-text">{w.en}</p>
                {revealed.has(w.id) ? (
                  <p className="text-[14px] text-green-primary font-medium mt-1">{w.ko}</p>
                ) : (
                  <p className="text-[13px] text-gray-secondary mt-1">탭해서 뜻 보기</p>
                )}
              </div>
              <button
                onClick={e => { e.stopPropagation(); toggleMemorized(w.id, w.memorized); }}
                className={`ml-3 flex-shrink-0 text-[11px] px-2 py-1 rounded-lg font-medium ${
                  w.memorized
                    ? 'bg-green-primary text-white'
                    : 'bg-gray-bg text-gray-secondary'
                }`}
              >
                {w.memorized ? '암기완료' : '미완료'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </Layout>
  );
}
