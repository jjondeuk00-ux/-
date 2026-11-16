// diagnose-error — 학생 자가진단(체크한 오답원인·정답근거 a2·교정 a3) 검증 + 사고/지식 판정 + error_events 태깅. Claude 비전.
import { encodeBase64 } from 'jsr:@std/encoding/base64';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const MODEL = 'claude-sonnet-4-6';
const NOTE_BUCKET = 'note-images';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
function json(b, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } }); }

const ONTOLOGY = {
  '독해': { thinking: ['주제·요지 착각', '선지 왜곡', '논리흐름·연결어 놓침', '필자 의도 오판'], knowledge: ['단어·구문 모름', '배경지식 부족'] },
  '논리': { thinking: ['논리방향 오판', '연결어 신호 무시', '선지에 끕림'], knowledge: ['단어·구문 모름'] },
  '문법': { thinking: ['문장구조 오독', '수식어에 속음', '감으로 선택'], knowledge: ['문법규칙·예외 모름'] },
  'math': { thinking: ['접근법 오판', '조건 오독', '함정', '검산없이 감'], knowledge: ['개념·공식 부족', '계산실수'] },
};

function noteImagePath(v) {
  if (!v) return null;
  const marker = '/' + NOTE_BUCKET + '/';
  const at = v.indexOf(marker);
  if (at >= 0) return v.slice(at + marker.length).split('?')[0];
  if (/^https?:\/\//i.test(v)) return null;
  return v.split('?')[0];
}

function extractJson(text) {
  if (!text) return null;
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const s = t.indexOf('{'); const e = t.lastIndexOf('}');
  if (s >= 0 && e > s) t = t.slice(s, e + 1);
  try { return JSON.parse(t); } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!ANTHROPIC_API_KEY) return json({ error: 'ANTHROPIC_API_KEY 미설정' }, 500);

  let noteId = '';
  try { const b = await req.json(); noteId = String(b?.note_id ?? ''); } catch { return json({ error: 'bad request' }, 400); }
  if (!noteId) return json({ error: 'note_id 필요' }, 400);

  const admin = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
  // MVP: admin으로 note_id 조회. (운영 강화 시 호출자 JWT로 본인 노트만 허용 추가 예정)
  const { data: note, error: nErr } = await admin.from('notes')
    .select('user_id, subject, area, topic, problem_text, image_url, image_urls, fields, causes')
    .eq('id', noteId).maybeSingle();
  if (nErr || !note) return json({ error: '노트 없음' }, 404);

  const isMath = String(note.subject ?? '') === 'math';
  const area = String(note.area ?? '');
  const onto = ONTOLOGY[isMath ? 'math' : area] ?? { thinking: [], knowledge: [] };
  const fields = (note.fields ?? {});
  const causes = (note.causes ?? []);

  const content = [];
  const imgs = (note.image_urls && note.image_urls.length) ? note.image_urls : (note.image_url ? [note.image_url] : []);
  for (const ref of imgs.slice(0, 4)) {
    try {
      const path = noteImagePath(ref);
      let bytes, mt = 'image/jpeg';
      if (path) { const { data } = await admin.storage.from(NOTE_BUCKET).download(path); if (!data) continue; if (data.type && data.type.startsWith('image/')) mt = data.type.split(';')[0]; bytes = new Uint8Array(await data.arrayBuffer()); }
      else { const r = await fetch(ref); if (!r.ok) continue; const ct = r.headers.get('content-type') || ''; if (ct.startsWith('image/')) mt = ct.split(';')[0]; bytes = new Uint8Array(await r.arrayBuffer()); }
      content.push({ type: 'image', source: { type: 'base64', media_type: mt, data: encodeBase64(bytes) } });
    } catch { /* skip */ }
  }

  const txt = [
    '[과목] ' + (isMath ? '편입수학' : '편입영어') + '  [영역] ' + area,
    '[문제] ' + (note.problem_text || '(텍스트 없음 — 이미지 참고)'),
    '[학생이 체크한 오답원인] ' + (causes.length ? causes.join(', ') : '없음'),
    '[학생 오답사고분석 a1] ' + (fields.a1 || '없음'),
    '[학생 정답근거 a2] ' + (fields.a2 || '없음'),
    '[학생 교정 a3] ' + (fields.a3 || '없음'),
    '',
    '사고오류 후보: ' + (onto.thinking.join(' / ') || '(없음)'),
    '지식부족 후보: ' + (onto.knowledge.join(' / ') || '(없음)'),
  ].join('\n');

  const sys = [
    "너는 편입 오답 진단관이야. 학생이 쓴 자가진단(체크한 오답원인·정답근거 a2·교정 a3)을 검증하고, 이 문제를 왜 틀렸는지 '사고오류(알았는데 사고에서 틀림, thinking)' vs '지식부족(몰라서 틀림, knowledge)'로 판정해.",
    "규칙:",
    "- 반드시 네가 직접 문제를 처음부터 풀어 객관적 정답을 확정한 뒤 판단해. 사진의 체크·동그라미 표시는 학생이 고른 오답일 수 있으니 믿지 마.",
    "- 같은 오답도 몰라서일 수도, 알았는데 실수일 수도 있어. 근거가 애매하면 confidence를 낮게(0.4~0.6) 줘. 자신있게 틀린 라벨 금지.",
    "- subtype은 아래 제시된 후보 중에서만 골라.",
    "- 말투는 학생에게 친근한 존댓말, 한 문장씩 짧게. 마크다운 기호 금지.",
    '반드시 JSON만 출력(다른 텍스트 금지):',
    '{"answer":"정답(간단히)","verdict":"thinking|knowledge","subtype":"후보 중 하나","confidence":0.0,"cause_check":{"ok":true,"say":"학생이 체크한 원인이 맞는지 + 아니면 진짜 원인"},"evidence_check":{"ok":true,"say":"정답근거가 타당한지 + 부족하면 진짜 근거"},"correction_check":{"ok":true,"say":"교정이 충분한지 + 부족하면 뭐를 더"},"solution":"다음에 이렇게(맞춤 한 줄)"}',
  ].join('\n');

  content.push({ type: 'text', text: txt });

  const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 1500, system: sys, messages: [{ role: 'user', content }] }),
  });
  if (!aiRes.ok) { let d = ''; try { d = await aiRes.text(); } catch { /*noop*/ } console.error('anthropic', aiRes.status, d); return json({ error: 'AI 실패', status: aiRes.status }, 502); }
  const aiData = await aiRes.json();
  const text = (aiData?.content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '').join('').trim();
  const parsed = extractJson(text);
  if (!parsed) return json({ error: '파싱 실패', raw: text.slice(0, 300) }, 502);

  const verdict = parsed.verdict === 'knowledge' ? 'knowledge' : (parsed.verdict === 'thinking' ? 'thinking' : null);
  const ce = (x) => (x && typeof x.ok === 'boolean') ? x.ok : null;
  try {
    await admin.from('error_events').insert({
      note_id: noteId, user_id: note.user_id, subject: note.subject, area,
      verdict, subtype: String(parsed.subtype ?? '').slice(0, 60),
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
      student_cause_ok: ce(parsed.cause_check), evidence_ok: ce(parsed.evidence_check), correction_ok: ce(parsed.correction_check),
      model_ver: MODEL,
    });
  } catch (e) { console.error('insert error_events', String(e)); }

  return json({ ok: true, diagnosis: parsed });
});
