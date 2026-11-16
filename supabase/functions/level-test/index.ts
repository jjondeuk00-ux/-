// 실력 진단 테스트: 편입영어 문법·어휘·논리·독해를 섞은 10문제 5지선다.
//  - 기본 동작은 '선발'이다. 사전 생성해 둔 level_test_items 풀에서 구성 규칙대로 뽑아 즉시 반환한다.
//    응시할 때마다 생성하면 대기 시간과 API 비용이 응시 수에 비례해 늘고, 문항 검수도 불가능하다.
//  - mode:'generate' 는 풀 적재용이며 멘토만 호출할 수 있다.
//  - 풀이 부족하면 즉석 생성으로 폴백한다. 서비스가 멈추지 않게 하기 위함이다.
//  - 저작권: 기출 원문·외부 저작물을 복제하지 않고 전부 새로 창작한다. 모든 문항에 지문 출처를 단다.
//
// 필요한 시크릿: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'jsr:@supabase/supabase-js@2';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const MODEL = 'claude-sonnet-4-6';

// 한 회차 구성 — 영역별 문항 수와 전체 난이도 분포
const AREA_PLAN: Record<string, number> = { 문법: 3, 어휘: 2, 논리: 2, 독해: 3 };
const DIFF_PLAN: Record<string, number> = { easy: 3, mid: 4, hard: 3 };
const TOTAL = 10;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

type Choice = { label: string; text: string };
type Item = {
  id?: string; area: string; difficulty?: string; passage?: string; passage_group?: string | null;
  source: string; question: string; choices: Choice[]; answer: string; explanation?: string;
};

const SYSTEM = `너는 편입영어 진단평가 출제 전문가야. 학생의 현재 실력을 가늠하기 위한 5지선다 진단 문제를 만든다.

난이도(difficulty)는 easy·mid·hard 중 하나를 반드시 지정해. easy는 중하위권도 맞히고, hard는 상위권만 맞히게.

규칙:
- 저작권: 실제 기출 지문·문장을 복제하지 마. 특정 저작물에서 발췌하지도 마. 전부 새로 창작해. 자연스러운 실제 영어로.
- source(지문 출처)는 모든 문항에 반드시 넣어. 새로 창작한 지문이면 "창작 지문", 특정 시험 유형을 참고했으면 "창작 지문 (○○ 유형 참고)"처럼 적어. 실제 기출을 쓴 적이 없으므로 학교명·연도를 출처로 적으면 안 돼.
- 독해는 passage(영어 지문 4~6문장)를 함께 제시. 하나의 지문에 문항 2~3개를 붙이면 그 문항들의 passage를 똑같이 써.
- 문법·어휘·논리는 passage 없이 question 안에 문장을 넣어도 됨.
- 정답은 정확히 하나. 만든 뒤 스스로 다시 풀어 검증. 애매하면 고쳐.
- choices는 5개(①~⑤). 함정 선지를 섞어.
- explanation은 한국어로 왜 정답인지 간단히.

출력은 아래 JSON 하나만. 다른 말·마크다운 없이:
{
  "questions": [
    { "area":"문법|어휘|논리|독해", "difficulty":"easy|mid|hard", "passage":"(독해면 영어 지문, 아니면 빈문자열)", "source":"창작 지문", "question":"지시문+문장", "choices":[{"label":"①","text":"..."}, ...5개], "answer":"①", "explanation":"한국어 해설" }
  ]
}`;

function extractJson(text: string): { questions?: unknown[] } | null {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const s = t.indexOf('{'); const e = t.lastIndexOf('}');
  if (s === -1 || e === -1) return null;
  try { return JSON.parse(t.slice(s, e + 1)); } catch { return null; }
}

function normalize(raw: unknown[]): Item[] {
  return (raw as Item[])
    .filter(q => q && q.question && Array.isArray(q.choices) && q.choices.length >= 4 && q.answer && AREA_PLAN[q.area] !== undefined)
    .map(q => ({
      area: q.area,
      difficulty: ['easy', 'mid', 'hard'].includes(String(q.difficulty)) ? String(q.difficulty) : 'mid',
      passage: String(q.passage ?? '').trim(),
      source: String(q.source ?? '').trim() || '창작 지문',   // 출처 없는 문항이 화면에 나가지 않게 한다
      question: q.question,
      choices: q.choices,
      answer: q.answer,
      explanation: String(q.explanation ?? ''),
    }));
}

async function callAI(count: number, plan: string): Promise<Item[]> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL, max_tokens: 8000, system: SYSTEM,
      messages: [{ role: 'user', content: `편입영어 진단 문제 ${count}개를 만들어. 구성: ${plan}. 반드시 스스로 다시 풀어 정답을 검증하고 JSON만 출력해.` }],
    }),
  });
  if (!res.ok) throw new Error(res.status === 429 ? 'rate' : 'ai');
  const data = await res.json();
  const text = (data?.content ?? []).filter((b: { type?: string }) => b.type === 'text').map((b: { text?: string }) => b.text ?? '').join('').trim();
  return normalize(extractJson(text)?.questions ?? []);
}

const shuffle = <T,>(a: T[]): T[] => a.map(v => [Math.random(), v] as const).sort((x, y) => x[0] - y[0]).map(([, v]) => v);

// 풀에서 한 회차를 선발한다. 영역별 목표 수를 채우되 전체 난이도 분포를 최대한 맞춘다.
function pick(pool: Item[]): Item[] {
  const out: Item[] = [];
  const diffLeft: Record<string, number> = { ...DIFF_PLAN };

  // 독해는 지문을 공유하는 묶음을 통째로 쓰는 편이 자연스럽다
  const groups = new Map<string, Item[]>();
  for (const q of pool.filter(x => x.area === '독해')) {
    const k = q.passage_group || `solo:${q.id}`;
    groups.set(k, [...(groups.get(k) ?? []), q]);
  }
  for (const g of shuffle([...groups.values()])) {
    const room = AREA_PLAN['독해'] - out.length;
    if (room <= 0) break;
    out.push(...g.slice(0, room));
  }

  for (const area of ['문법', '어휘', '논리']) {
    const cand = shuffle(pool.filter(q => q.area === area));
    // 아직 남은 난이도를 먼저 채워 분포가 한쪽으로 쏠리지 않게 한다
    const ordered = [...cand].sort((a, b) => (diffLeft[b.difficulty ?? 'mid'] ?? 0) - (diffLeft[a.difficulty ?? 'mid'] ?? 0));
    for (const q of ordered.slice(0, AREA_PLAN[area])) {
      out.push(q);
      const d = q.difficulty ?? 'mid';
      if (diffLeft[d] > 0) diffLeft[d] -= 1;
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const body = await req.json().catch(() => ({}));
  const mode = body?.mode === 'generate' ? 'generate' : 'serve';
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // ── 풀 적재 (멘토 전용) ──────────────────────────────────────────
  if (mode === 'generate') {
    if (!ANTHROPIC_API_KEY) return json({ error: 'AI 키가 서버에 설정되지 않았어.' }, 500);
    const auth = req.headers.get('Authorization') ?? '';
    const { data: me } = await admin.auth.getUser(auth.replace('Bearer ', ''));
    if (!me?.user) return json({ error: '로그인이 필요해.' }, 401);
    const { data: prof } = await admin.from('profiles').select('role').eq('id', me.user.id).maybeSingle();
    if (prof?.role !== 'mentor') return json({ error: '문항 적재 권한이 없어.' }, 403);

    const count = Math.min(Math.max(Number(body?.count) || 10, 1), 20);
    let items: Item[];
    try { items = await callAI(count, '문법·어휘·논리·독해를 고루 섞고 난이도도 easy/mid/hard를 고루'); }
    catch (e) { return json({ error: (e as Error).message === 'rate' ? 'AI 사용량이 잠시 많아. 잠시 후 다시 시도해.' : '문항 생성에 실패했어.' }, 502); }
    if (!items.length) return json({ error: '생성 결과가 비어 있어. 다시 시도해.' }, 502);

    // 같은 지문을 쓰는 독해 문항은 하나의 묶음으로 저장한다
    const groupOf = new Map<string, string>();
    const rows = items.map(q => {
      let pg: string | null = null;
      if (q.area === '독해' && q.passage) {
        if (!groupOf.has(q.passage)) groupOf.set(q.passage, crypto.randomUUID());
        pg = groupOf.get(q.passage)!;
      }
      return { ...q, passage_group: pg };
    });
    const { error } = await admin.from('level_test_items').insert(rows);
    if (error) return json({ error: '문항 저장에 실패했어.' }, 500);

    const { count: total } = await admin.from('level_test_items').select('id', { count: 'exact', head: true }).eq('active', true);
    return json({ inserted: rows.length, poolSize: total ?? 0 });
  }

  // ── 선발 (기본) ──────────────────────────────────────────────────
  const { data: pool } = await admin
    .from('level_test_items')
    .select('id, area, difficulty, passage, passage_group, source, question, choices, answer, explanation')
    .eq('active', true)
    .limit(400);

  const picked = pick((pool ?? []) as Item[]);
  if (picked.length >= TOTAL) {
    // 같은 지문끼리 붙여야 꼬리문제가 자연스럽게 읽힌다
    const ordered = [...picked].sort((a, b) => (a.passage || '').localeCompare(b.passage || ''));
    return json({ questions: ordered, from: 'pool' });
  }

  // 풀이 모자라면 즉석 생성으로 폴백한다 (첫 운영 구간·소진 대비)
  if (!ANTHROPIC_API_KEY) return json({ error: '진단 문제를 준비하지 못했어. 잠시 후 다시 시도해.' }, 503);
  try {
    const live = await callAI(TOTAL, '문법 3·어휘 2·논리 2·독해 3, 난이도 easy 3·mid 4·hard 3');
    if (live.length < 6) return json({ error: '진단 문제 형식이 올바르지 않아. 다시 시도해.' }, 502);
    return json({ questions: live, from: 'live' });
  } catch (e) {
    return json({ error: (e as Error).message === 'rate' ? 'AI 사용량이 잠시 많아. 잠시 후 다시 시도해.' : '진단 문제 생성에 실패했어.' }, 502);
  }
});
