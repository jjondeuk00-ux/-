// 복습 교정 brief — 전날 틀리거나 몰랐던 단어·구문·오답(문제)을 다시 볼 때,
//  같은 실수를 안 하도록 '알아야 할 것 / 주의할 것'을 핵심 2줄로 압축한다.
// 입력: { kind:'word'|'syntax'|'note', front, back, example? }
// 출력: { must_know, caution }  (client가 vocabulary/sentences/notes.brief 에 캐시)
// 필요한 시크릿: ANTHROPIC_API_KEY

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const MODEL = 'claude-sonnet-4-6';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

const SYSTEM_PROMPT = `너는 편입 영어 복습 코치야. 학생이 '전날 틀리거나 몰랐던' 단어·구문·문제(오답)을 다시 볼 때, 같은 실수를 안 하도록 핵심만 딱 2가지로 정리해줘.

반드시 아래 JSON 하나만 출력해(다른 말·마크다운·코드블록 금지):
{"must_know":"...","caution":"..."}

- must_know(알아야 할 것): 꼭 기억할 핵심 1개. 단어면 가장 중요한 뜻·용법, 구문이면 구조의 핵심, 문제(오답)면 이 문제를 맞히는 데 꼭 필요한 개념·규칙. 한 줄.
- caution(주의할 것): 틀리기 쉬운 함정·혼동 1개. 단어면 헷갈리는 비슷한 단어·뉘앙스, 구문이면 해석에서 놓치기 쉬운 지점, 문제(오답)면 다음에 또 틀리기 쉬운 실수·함정. 한 줄.
- 말투: 친근한 반말(예: "~야", "~하기 쉬우니 조심해"). 짧고 담백하게. 과장·군더더기 금지.
- 근거가 빈약하면 일반적이지만 도움되는 핵심으로 채우되 사실을 지어내지 마.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!ANTHROPIC_API_KEY) return json({ error: 'AI 키가 서버에 설정되지 않았어. (ANTHROPIC_API_KEY)' }, 500);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return json({ error: '로그인이 필요해.' }, 401);

  let kind = 'word', front = '', back = '', example = '';
  try {
    const body = await req.json();
    kind = (body?.kind === 'syntax' || body?.kind === 'note') ? body.kind : 'word';
    front = String(body?.front ?? '').trim().slice(0, 2000);
    back = String(body?.back ?? '').trim().slice(0, 1200);
    example = String(body?.example ?? '').trim().slice(0, 400);
  } catch { return json({ error: '잘못된 요청이야.' }, 400); }
  if (!front) return json({ error: '복습 항목이 비어 있어.' }, 400);

  const meta = kind === 'word'
    ? { label: '단어', f: '영단어', b: '뜻' }
    : kind === 'syntax'
      ? { label: '구문', f: '문장', b: '해석' }
      : { label: '문제(오답)', f: '문제', b: '정답·해설·오류유형' };
  const userText = `[유형] 편입영어 ${meta.label}
[${meta.f}] ${front}
[${meta.b}] ${back}${example ? `\n[예문] ${example}` : ''}

이 항목을 복습할 때 '알아야 할 것 / 주의할 것'을 지정한 JSON으로만 내줘.`;

  const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 450, system: SYSTEM_PROMPT, messages: [{ role: 'user', content: userText }] }),
  });
  if (!aiRes.ok) {
    console.error('Anthropic error', aiRes.status, (await aiRes.text()).slice(0, 200));
    if (aiRes.status === 429) return json({ error: 'AI 사용량이 잠시 많아. 잠시 후 다시 시도해.' }, 429);
    return json({ error: '교정 요약 생성에 실패했어.' }, 502);
  }
  const aiData = await aiRes.json();
  const text = (aiData?.content ?? []).filter((b: { type?: string }) => b.type === 'text').map((b: { text?: string }) => b.text ?? '').join('').trim();

  let must_know = '', caution = '';
  try {
    const m = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(m ? m[0] : text);
    must_know = String(parsed?.must_know ?? '').trim();
    caution = String(parsed?.caution ?? '').trim();
  } catch {
    return json({ error: 'AI 응답 형식 오류.' }, 502);
  }
  if (!must_know && !caution) return json({ error: 'AI가 빈 답을 냈어.' }, 502);

  return json({ must_know, caution });
});
