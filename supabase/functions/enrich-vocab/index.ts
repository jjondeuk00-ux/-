// 단어 확장정보 생성 Edge Function (Groq 무료 API)
//
// 공용 캐시(vocab_enrichment): 단어(정규화 키) 기준 전 유저 공유.
//   - 이미 만든 단어면 AI 호출 없이 캐시에서 바로 가져온다.
//   - 처음 보는 단어만 Groq로 생성하고 캐시에 저장한다.
//
// 입력: { vocab_id }
// 필요 시크릿: GROQ_API_KEY

import { createClient } from 'jsr:@supabase/supabase-js@2';

const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY') ?? '';
const MODEL = 'openai/gpt-oss-120b';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

interface Enrichment {
  meaning: string;
  collocations: string;
  synonyms: string;
  derivatives: string;
  example: string;
}

function buildPrompt(en: string, ko: string): string {
  return `너는 편입영어 어휘 전문가야. 아래 영단어에 대해 편입 수험생에게 도움되는 정보를 JSON으로만 만들어줘.\n\n단어: ${en}${ko ? ` (뜻: ${ko})` : ''}\n\nJSON 키는 meaning, collocations, synonyms, derivatives, example 다섯 개야. 각 값은 문자열.\n- meaning: 핵심 한국어 뜻 (간결하게, 여러 뜻이면 쉼표로).\n- collocations: 편입시험에 자주 나오는 연어 2~3개. 각 항목은 '영어표현 - 한국어뜻' 형식, 줄바꿈으로 구분.\n- synonyms: 동의어/유의어 2~4개를 쉼표로. 가능하면 뉘앙스 차이 간단히.\n- derivatives: 파생어를 품사와 함께 2~4개. '단어(품사): 뜻' 형식, 줄바꿈 구분.\n- example: 편입 수준의 예문 1개. '영어문장 (한국어 해석)' 형식.\n\n별표나 굵게 같은 마크다운 기호는 쓰지 마. JSON 외 다른 텍스트는 출력하지 마.`;
}

async function generateWithAI(en: string, ko: string): Promise<{ enr?: Enrichment; error?: string; status?: number }> {
  const reqBody = JSON.stringify({
    model: MODEL,
    temperature: 0.5,
    max_tokens: 1024,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: '너는 편입영어 어휘 전문가야. 반드시 유효한 JSON만 출력해.' },
      { role: 'user', content: buildPrompt(en, ko) },
    ],
  });

  const url = 'https://api.groq.com/openai/v1/chat/completions';
  let res: Response | null = null;
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
      body: reqBody,
    });
    if (res.ok) break;
    lastStatus = res.status;
    if (res.status === 429 || res.status === 500 || res.status === 503) {
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
      continue;
    }
    break;
  }

  if (!res || !res.ok) {
    const detail = res ? await res.text() : '(no response)';
    console.error('Groq error', lastStatus, detail);
    if (lastStatus === 429) return { error: 'AI 무료 사용량이 잠시 초과됐어. 1~2분 뒤 다시 시도해.', status: 429 };
    return { error: 'AI 정보 생성에 실패했어. 잠시 후 다시 시도해.', status: 502 };
  }

  const data = await res.json();
  const text = String(data?.choices?.[0]?.message?.content ?? '').trim();

  let parsed: Record<string, string> = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: 'AI 응답을 해석하지 못했어.', status: 502 };
  }

  return {
    enr: {
      meaning: String(parsed.meaning ?? '').trim(),
      collocations: String(parsed.collocations ?? '').trim(),
      synonyms: String(parsed.synonyms ?? '').trim(),
      derivatives: String(parsed.derivatives ?? '').trim(),
      example: String(parsed.example ?? '').trim(),
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!GROQ_API_KEY) return json({ error: 'AI 키가 서버에 설정되지 않았어. (GROQ_API_KEY)' }, 500);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return json({ error: '로그인이 필요해.' }, 401);

  let vocabId = '';
  try {
    const body = await req.json();
    vocabId = String(body?.vocab_id ?? '');
  } catch {
    return json({ error: '잘못된 요청이야.' }, 400);
  }
  if (!vocabId) return json({ error: 'vocab_id 가 필요해.' }, 400);

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: '세션이 유효하지 않아.' }, 401);

  const { data: row, error: rowErr } = await userClient
    .from('vocabulary')
    .select('id, en, ko')
    .eq('id', vocabId)
    .maybeSingle();
  if (rowErr || !row) return json({ error: '단어를 찾을 수 없거나 접근 권한이 없어.' }, 404);

  const wordKey = String(row.en).trim().toLowerCase();
  if (!wordKey) return json({ error: '단어가 비어 있어.' }, 400);

  // 1) 공용 캐시 확인
  const { data: cached } = await adminClient
    .from('vocab_enrichment')
    .select('meaning, collocations, synonyms, derivatives, example')
    .eq('word_key', wordKey)
    .maybeSingle();

  let enr: Enrichment;
  const fromCache = !!(cached && (cached.collocations || cached.synonyms || cached.derivatives || cached.example));

  if (fromCache) {
    enr = {
      meaning: cached!.meaning ?? '',
      collocations: cached!.collocations ?? '',
      synonyms: cached!.synonyms ?? '',
      derivatives: cached!.derivatives ?? '',
      example: cached!.example ?? '',
    };
  } else {
    const { enr: generated, error, status } = await generateWithAI(String(row.en), row.ko || '');
    if (!generated) return json({ error: error ?? 'AI 생성 실패' }, status ?? 502);
    enr = generated;

    const { error: cacheErr } = await adminClient.from('vocab_enrichment').upsert({
      word_key: wordKey,
      en: row.en,
      meaning: enr.meaning,
      collocations: enr.collocations,
      synonyms: enr.synonyms,
      derivatives: enr.derivatives,
      example: enr.example,
    }, { onConflict: 'word_key' });
    if (cacheErr) console.error('cache upsert error', cacheErr);
  }

  const update = {
    collocations: enr.collocations,
    synonyms: enr.synonyms,
    derivatives: enr.derivatives,
    example: enr.example,
    enriched: true,
    ...(row.ko ? {} : { ko: enr.meaning }),
  };

  const { error: updErr } = await userClient.from('vocabulary').update(update).eq('id', row.id);
  if (updErr) {
    console.error('update error', updErr);
    return json({ error: '저장에 실패했어.' }, 500);
  }

  return json({ ok: true, data: update, cached: fromCache });
});
