import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { supabase, callFn } from '../lib/supabase';

type Note = {
  id: string;
  subject: string;
  area: string;
  topic: string;
  problem_text: string;
  created_at: string;
  reviewed_at: string | null;
  my_answer?: string;
  correct_answer?: string;
  one_line?: string;
};

type AnalysisResult = { diagnosis?: string; error_type?: string; brief?: string };

const FILTERS = ['전체', '독해', '논리', '문법', '어휘'];

export default function ErrorNote() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('전체');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Record<string, AnalysisResult>>({});
  const [analyzing, setAnalyzing] = useState<string | null>(null);

  useEffect(() => {
    fetchNotes();
  }, []);

  async function fetchNotes() {
    setLoading(true);
    const { data, error } = await supabase
      .from('notes')
      .select('id, subject, area, topic, problem_text, created_at, reviewed_at, one_line')
      .order('created_at', { ascending: false })
      .limit(30);
    if (!error && data) setNotes(data);
    setLoading(false);
  }

  async function analyze(noteId: string) {
    if (analysis[noteId]) {
      setExpanded(expanded === noteId ? null : noteId);
      return;
    }
    setExpanded(noteId);
    setAnalyzing(noteId);
    try {
      const result = await callFn<AnalysisResult>('diagnose-error', { note_id: noteId });
      setAnalysis(prev => ({ ...prev, [noteId]: result }));
    } catch {
      setAnalysis(prev => ({ ...prev, [noteId]: { brief: 'AI 분석을 불러올 수 없어요' } }));
    } finally {
      setAnalyzing(null);
    }
  }

  async function markReviewed(noteId: string) {
    await supabase.from('notes').update({ reviewed_at: new Date().toISOString() }).eq('id', noteId);
    setNotes(prev => prev.map(n => n.id === noteId ? { ...n, reviewed_at: new Date().toISOString() } : n));
  }

  const filtered = filter === '전체' ? notes : notes.filter(n => n.area === filter || n.subject === filter);
  const totalReviewed = notes.filter(n => n.reviewed_at).length;

  return (
    <Layout>
      {/* Summary bar */}
      <div className="bg-white border-b border-gray-border px-4 py-3 flex gap-4">
        <div className="text-center">
          <p className="text-[20px] font-bold text-green-primary">{notes.length}</p>
          <p className="text-[11px] text-gray-secondary">총 오답</p>
        </div>
        <div className="text-center">
          <p className="text-[20px] font-bold text-green-primary">{totalReviewed}</p>
          <p className="text-[11px] text-gray-secondary">복습 완료</p>
        </div>
        <div className="text-center">
          <p className="text-[20px] font-bold text-green-primary">{notes.length - totalReviewed}</p>
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
        {FILTERS.map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`flex-shrink-0 px-3 py-1 rounded-full text-[12px] font-medium ${
              filter === f ? 'bg-green-primary text-white' : 'bg-gray-bg text-gray-secondary'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Error list */}
      <div className="px-4 py-3 space-y-3">
        {loading && (
          <p className="text-center text-sm text-gray-secondary py-8">불러오는 중...</p>
        )}
        {!loading && filtered.length === 0 && (
          <p className="text-center text-sm text-gray-secondary py-8">오답 노트가 없어요</p>
        )}
        {filtered.map(note => (
          <div
            key={note.id}
            className="bg-white rounded-xl border border-gray-border overflow-hidden"
          >
            <div
              className="p-4 cursor-pointer"
              onClick={() => analyze(note.id)}
            >
              <div className="flex items-start justify-between mb-2">
                <div>
                  <span className="px-2 py-0.5 bg-green-chip text-green-primary text-[11px] font-medium rounded mr-2">
                    {note.area || note.subject}
                  </span>
                  <span className="text-[12px] text-gray-secondary">{note.topic}</span>
                </div>
                <span className="text-[11px] text-gray-secondary">
                  {new Date(note.created_at).toLocaleDateString('ko', { month: 'numeric', day: 'numeric' })}
                </span>
              </div>
              <p className="text-[13px] text-gray-text line-clamp-2">
                {note.one_line || note.problem_text}
              </p>
              <div className="flex items-center gap-4 mt-2 text-[12px] text-gray-secondary">
                {note.reviewed_at && (
                  <span className="ml-auto text-green-primary">✓ 복습 완료</span>
                )}
              </div>
            </div>

            {expanded === note.id && (
              <div className="border-t border-gray-border bg-green-light px-4 py-3">
                <p className="text-[12px] font-bold text-green-primary mb-1">🤖 AI 오답 분석</p>
                {analyzing === note.id ? (
                  <p className="text-[13px] text-gray-secondary">분석 중...</p>
                ) : (
                  <p className="text-[13px] text-gray-text leading-5">
                    {analysis[note.id]?.brief || analysis[note.id]?.diagnosis || '분석 결과가 없어요'}
                  </p>
                )}
                <div className="flex gap-2 mt-3">
                  <button className="flex-1 bg-white border border-green-primary text-green-primary text-[12px] font-bold py-2 rounded-lg">
                    → 다시 풀기
                  </button>
                  {!note.reviewed_at && (
                    <button
                      onClick={() => markReviewed(note.id)}
                      className="flex-1 bg-green-primary text-white text-[12px] font-bold py-2 rounded-lg"
                    >
                      ✓ 복습 완료
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </Layout>
  );
}
