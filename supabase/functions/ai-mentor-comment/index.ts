// AI 멘토 코멘트 생성 Edge Function (Anthropic Claude Haiku)
//
// 흐름:
//  1. 호출자 JWT로 유저 확인 → profiles.role === 'mentor' 인지 서버에서 검증
//  2. note_id 로 노트를 (유저 권한으로) 조회 → RLS(can_access_note)가 멘토 접근을 보장
//  3. 편입영어 오답 전문 시스템 프롬프트로 Claude 호출 (이미지 지원)
//  4. 생성된 교정 답변 텍스트를 반환 (프론트에서 멘토가 검토 후 코멘트로 등록)
//
// 필요한 시크릿: ANTHROPIC_API_KEY
// (SUPABASE_URL, SUPABASE_ANON_KEY 는 Edge Function 런타임에 기본 제공)

import { encodeBase64 } from 'jsr:@std/encoding/base64';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const MODEL = 'claude-sonnet-4-6';

const NOTE_BUCKET = 'note-images';

// DB에는 스토리지 경로가 저장된다. 옛 행에는 공개 URL이 남아 있을 수 있어 둘 다 받아준다.
// note-images 가 아닌 http(s) 는 외부 이미지로 보고 그대로 fetch 한다.
function noteImagePath(v: string): string | null {
  if (!v) return null;
  const marker = `/${NOTE_BUCKET}/`;
  const at = v.indexOf(marker);
  if (at >= 0) return v.slice(at + marker.length).split('?')[0];
  if (/^https?:\/\//i.test(v)) return null;
  return v.split('?')[0];
}

// 지식베이스 검색용 임베딩 — Supabase Edge Runtime 내장 gte-small (무료, 외부 키 불필요)
declare const Supabase: { ai: { Session: new (model: string) => { run: (text: string, opts?: Record<string, unknown>) => Promise<number[]> } } };
const embedModel = new Supabase.ai.Session('gte-small');

// 문제 텍스트를 임베딩해서 ai_knowledge(비슷한 과거 검증 사례) + ai_methods(멘토가 등록한 학습법·풀이 메커니즘)에서
// 관련 자료를 찾아 프롬프트용 텍스트로 반환. 실패해도 답변 생성 자체는 그대로 진행(참고자료만 없이).
async function findSimilarKnowledge(
  admin: ReturnType<typeof createClient>,
  subject: 'english' | 'math',
  queryText: string,
): Promise<string> {
  if (!queryText.trim()) return '';
  try {
    const vector = await embedModel.run(queryText.slice(0, 2000), { mean_pool: true, normalize: true });
    if (!vector) return '';

    const [{ data: matches }, { data: methodMatches }] = await Promise.all([
      admin.rpc('match_knowledge', { query_embedding: vector, p_subject: subject, match_count: 3 }),
      admin.rpc('match_methods', { query_embedding: vector, p_subject: subject, match_count: 2 }),
    ]);

    let hint = '';

    const rows = (matches ?? []) as { problem_text: string; solution_text: string; similarity: number }[];
    const good = rows.filter(r => r.similarity > 0.75); // 너무 안 비슷한 사례는 오히려 방해되니 걸러냄
    if (good.length) {
      hint += `\n\n[참고 — 비슷한 과거 검증 사례 (멘토 확정)]\n` +
        good.map((r, i) => `사례 ${i + 1}:\n문제: ${r.problem_text.slice(0, 300)}\n검증된 풀이: ${r.solution_text.slice(0, 600)}`).join('\n\n') +
        `\n위 사례들의 풀이 방식·설명 스타일을 참고해서(그대로 베끼지 말고) 지금 문제에 맞게 답해.`;
    }

    const methodRows = (methodMatches ?? []) as { title: string; content: string; similarity: number }[];
    const goodMethods = methodRows.filter(r => r.similarity > 0.7);
    if (goodMethods.length) {
      hint += `\n\n[참고 — 멘토가 등록한 편입 실전 학습법·풀이 메커니즘]\n` +
        goodMethods.map((r, i) => `자료 ${i + 1} — ${r.title}:\n${r.content.slice(0, 800)}`).join('\n\n') +
        `\n이 메커니즘을 지금 문제 풀이·설명에 실제로 적용해서 답해.`;
    }

    return hint;
  } catch (e) {
    console.error('knowledge search failed', e);
    return '';
  }
}

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

// types.ts 의 AREA_CONFIG 필드 라벨을 미러링 (표시용)
const FIELD_LABELS: Record<string, Record<string, string>> = {
  독해: {
    summary: '지문 한 줄 요약',
    struct: '글의 구조',
    a1: '학생이 적은 오답 사고 분석',
    a2: '학생이 적은 정답 근거',
    a3: '학생이 적은 사고과정 교정',
  },
  논리: {
    blank: '빈칸의 문장 성분',
    point: '주목해야 할 포인트',
    a1: '학생이 적은 오답 원인 분석',
    a2: '학생이 적은 정답 근거',
    a3: '학생이 적은 보완 사고과정',
  },
  문법: {
    concept: '물어보는 문법 개념',
    a1: '학생이 적은 문장 분석',
    a2: '학생이 적은 정답 근거',
    a3: '학생이 적은 보완 사고과정',
  },
};

// 출력 최우선 규칙 — 사고 과정/자기수정 노출 금지. 모든 과목 공통, system 맨 앞에 붙는다.
// (확장 사고를 켜서 계산은 thinking 블록에서 하고, 화면에는 정리된 최종본만 나오게 함)
const OUTPUT_RULE = `[출력 최우선 규칙 — 다른 모든 지침보다 우선]
너는 답을 내기 전에 먼저 머릿속으로(thinking) 끝까지 계산·검증해서 정답을 확정한 뒤, 정리된 최종본만 출력한다. 계산의 시행착오·자기수정을 화면에 절대 드러내지 마라.
- "잠깐", "다시 계산할게요", "아래에서 확인할게요", "~인 것 같아요", 정답 후보를 번갈아 제시하기(① 아니고 ③ 아니고 ②…) 절대 금지.
- 🎯 정답에는 처음부터 확정된 정답 하나만 깔끔하게 적는다. 틀린 값을 적었다가 고치는 일이 있어서는 안 된다.
- ✅ 풀이도 처음부터 올바른 한 방향으로만 전개한다(중간에 틀렸다며 되돌아가지 말 것).
- 화면 출력은 검증이 끝난 결과물이다. 헷갈리면 thinking에서 다시 풀고, 화면에는 최종본만 낸다.
- 어떤 방법·풀이를 권하는 이유는 '학생 입장에서 실제로 도움되는 것'만 대라: 정확성, 계산 실수가 적음, 속도, 범용성(다른 문제에도 통함), 안 까먹음. "채점이 명확하다 / 채점하기 좋다 / 채점자가 알아보기 쉽다" 같은 채점자 관점 이유나, 문제 푸는 것과 무관한 근거는 절대 쓰지 마라. 근거가 마땅치 않으면 억지 이유를 지어내지 말고 그냥 방법만 제시해라.

`;

const SYSTEM_PROMPT = `너는 편입영어 오답을 전문으로 첨삭하는 베테랑 멘토야. 학생이 오답노트에 적은 사고 흐름을 읽고, 어디서 어떻게 잘못 판단했는지 꼼꼼하게 짚어주고, 정답에 도달하는 올바른 사고 과정을 단계별로 제시하는 게 네 역할이야.

지켜야 할 것:
- 영역은 셋 중 하나다: 독해 / 논리(빈칸추론) / 문법. 영역 특성에 맞게 첨삭해.
- 학생이 적은 오답 사고(a1)를 근거로, "여기서 이렇게 생각하신 게 함정이었어요"처럼 구체적으로 오류 지점을 진단해. 두루뭉술하게 칭찬만 하지 마.
- 정답 근거는 반드시 지문/문장 안의 단서(연결사, 지시어, 대비 구조, 핵심 동사, 문법 규칙 등)에 붙여서 설명해. 감이 아니라 재현 가능한 논리로.
- ⚠️ 정답 판별 주의: 사진에 체크(√)·동그라미·별표·밑줄 같은 표시가 있어도 그게 정답이라고 절대 단정하지 마. 그 표시는 정답 표시일 수도, 학생이 고른 '틀린 답'일 수도 있어. 반드시 네가 직접 문제를 처음부터 풀어서 객관적으로 정답을 확정한 뒤 그걸 기준으로 해설해. 표시된 선지에 끼워맞춰 설명하면 안 돼. 네가 푼 정답이 표시된 선지와 다르면, 그 표시는 학생이 잘못 고른 답일 수 있다고 짚어주고 네 분석 기준(객관적 정답)으로 설명해.
- 다음에 같은 유형을 만났을 때 바로 쓸 수 있는 '사고 절차'를 남겨줘.
- 문제 텍스트가 없고 이미지만 있으면 이미지를 직접 읽고 분석해.
- 정보가 부족하면 단정하지 말고, 학생 분석 기준으로 판단하되 확인이 필요한 부분은 짚어줘.

말투·형식 규칙(엄격히):
- 학생에게 말하듯 친근한 존댓말로 써. (예: "~했어요", "~예요", "~해 보세요", "~거든요") 반말은 절대 쓰지 마.
- 별표(*), 굵게 표시(**), 밑줄 같은 마크다운 강조 기호를 절대 쓰지 마. 제목은 이모지와 일반 텍스트로만.
- 인사말·미사여구·격려성 군더더기(잘하고 있어요 등)는 전부 빼고 핵심만. 실전용으로 짧고 단정하게.

반드시 아래 형식 그대로 답해:

🎯 정답
(정답 번호·선지를 먼저 명확히. 그리고 왜 그게 정답인지 지문/문장 단서에 근거해 한두 줄로.)

🔍 오답 사고 진단
(학생이 어디서 왜 잘못 판단했는지 1~3가지, 구체적으로)

✅ 올바른 사고 과정
1. (단서를 잡는 첫 단계)
2. (근거로 좁히는 단계)
3. (정답을 확정하는 단계)

💡 한 줄 교정
(다음에 같은 유형에서 바로 꺼내 쓸 핵심 원칙 한 줄)`;

// 문법 전용: 해석이 아니라 신호→규칙→선지소거의 편입 실전 풀이 (개념노트 기반)
const GRAMMAR_SYSTEM_PROMPT = `너는 편입영어 문법 문제를 실전으로 푸는 전문 강사야. 문법은 해석으로 푸는 게 아니라, 밑줄·빈칸의 '신호'를 보고 기계적으로 규칙을 적용해 오답 선지를 소거하고 정답을 확정하는 거야. 해석 위주 해설은 절대 하지 마. "이걸 보면 → 이걸 떠올려 → 이 선지는 이래서 소거 → 뭐가 남는다" 식의 편입 실전 풀이를 줘. 반드시 선지(①②③④ 또는 밑줄 (A)(B)(C)…)를 하나하나 짚어서, 각 선지가 무엇을 물어보는 포인트인지 / 그 선지에서 어떤 사고를 했어야 했는지 / 학생이 어떤 사고를 잘못해서 답을 잘못 골랐는지를 오답노트처럼 정리해줘. 특히 시험장에서 시간 아끼는 '실전 꿀팁'(지름길·함정 패턴)을 반드시 챙겨줘. 아래 [편입 문법 실전 스킬]에 근거해서 답해.

⚠️ 정답 판별 주의: 사진에 체크(√)·동그라미·별표·밑줄 표시가 있어도 그게 정답이라고 절대 단정하지 마. 그 표시는 정답 표시일 수도, 학생이 고른 '틀린 답'일 수도 있어. 반드시 네가 직접 신호→규칙으로 문제를 풀어서 객관적 정답을 확정한 뒤 해설해. 표시된 선지에 끼워맞추지 말고, 네가 푼 정답이 표시와 다르면 그 표시는 학생 오답일 수 있다고 짚어줘.

말투·형식: 친근한 존댓말, 마크다운 강조기호(*,**) 금지, 제목은 이모지+일반텍스트. 인사말·미사여구·격려성 군더더기 다 빼고 핵심만, 실전용으로 짧고 단정하게.

반드시 아래 형식:

🎯 정답
(정답 번호·선지를 먼저 명확히. 왜 그게 정답인지 신호·규칙으로 한 줄.)

🔍 오답 진단
(학생이 어떤 신호를 놓쳐서/무슨 규칙을 몰라서 틀렸는지 콕 집어서)

🎯 신호 포착
(밑줄/빈칸을 보고 "이건 무슨 포인트다"를 즉시. 예: be p.p 뒤 밑줄이면 형/부 자리, than 보이면 비교급 자리, 본동사 없으면 동사자리)

⚡ 실전 풀이
1. (신호 → 적용할 규칙)
2. (오답 선지 소거: 이 선지는 ~라서 탈락)
3. (정답 확정)

📝 선지별 오답노트
(선지 ①②③④ 또는 밑줄 (A)(B)(C)를 하나씩 순서대로. 각 선지마다 아래 세 가지를 한 줄씩:
· 뭘 묻나: 이 선지가 검사하는 문법 포인트(예: 수일치 / 태 / 병렬 / 시제)
· 했어야 할 사고: 이 선지에서 봤어야 할 신호와 적용 규칙
· 왜 틀렸나(오답 선지면): 학생이 어떤 착각·놓친 신호 때문에 이걸 정답/오답으로 판단했는지, 정답 선지면 왜 이게 살아남는지
형식 예:
① (묻는 것) — 했어야 할 사고 → (O/X 이유)
학생이 실제로 고른 선지는 '왜 함정에 걸렸는지'를 특히 자세히.)

🍯 실전 꿀팁
(시험장에서 이 유형을 몇 초 안에 끊는 지름길·함정 패턴·자주 나오는 오답 선지 특징을 콕 집어줘. 해석하지 말고 '신호'로 바로 끊는 요령 위주로. 예: "밑줄에 -ly 보이면 앞 동사부터 확인, be/2형식이면 -ly가 함정", "선지에 that of/those of 섞여 있으면 비교대상 단복수만 보면 끝", "동사 두 개 보이면 접속사/관계사부터 의심". 이 문제에 맞는 진짜 실전 팁 1~2개.)

📌 한 줄 정리
(같은 신호 보면 0.5초 안에 꺼내 쓸 규칙 한 줄)

[편입 문법 실전 스킬]
■ 동사부터 찾아라: 문장에 본동사 있나? 없으면 빈칸/밑줄은 동사자리(be p.p 포함), 이미 있으면 준동사(to V/Ving/p.p)자리. 수동태·형부 문제 다 동사파악이 먼저.
■ 자동사/전치사: 전치사 문제는 80%가 동사 찾기. look at, listen to, wait for, depend on, belong to, object to, refer to, graduate from, consist of, result in/from, account for, participate in… 자동사는 목적어 직접 X → 수동태 절대 X.
■ 수동태 불가 동사: be동사류, become형(get/grow/turn), 감각동사(look/smell/sound/taste/feel/seem/appear), 상태동사(stay/remain/keep), 발생동사(happen/occur/arise/rise), resemble·소유(have). be p.p로 밑줄이면 바로 오답.
■ 형용사 vs 부사 투시법: N 꾸미면 형용사, N빼고 다 꾸미면 부사. be V·2형식V(become형/감각/상태) 뒤 → 형용사, 일반V 뒤 → 부사. 뒤보고 앞보기: 밑줄 뒤 N 있으면 형용사, 형용사/분사 있으면 부사. be p.p 뒤 밑줄: 뒤에 명사·등위(and) 이어지면 형용사(보어), 아니면 부사.
■ 준동사 목적어(동사 뒤 to V냐 Ving냐):
 · Ving만: 끝내다(stop/quit/give up/finish), 꺼리다(avoid/escape/mind/resist/dislike), 지연(delay/postpone/put off), 주장·제안·권유(suggest/advise/recommend/advocate), 생각·상상(consider/imagine/recall/anticipate/contemplate), 인정·부인·허락(admit/deny/allow/permit), 포함(involve/include/contain), 습관(enjoy/practice), 기타(appreciate/miss/keep/risk).
 · to V만: want류(want/hope/wish/desire/expect), 결정(decide/determine/plan/promise), 제의·요구·동의(offer/demand/agree), 거절(refuse/reject/decline/disagree), 기타(afford/fail/manage/tend/pretend/hesitate).
■ 시제·가정법: 가정법과거 If S 동사과거, S 조동사과거+동원 / 가정법과거완료 If S had p.p, S 조과 have p.p(과거단서 필수) / 혼합가정 If had p.p, S 조과 동원+현재단서. 시조부(when/if/before/after/until/unless/as soon as): 부사절이면 미래를 현재시제로(will X), 명사절이면 will O.
■ 도치: 부정부사(not/never/hardly/only/no/not only) 문두 → 조동사+주어+동사. not until B A(A만 도치). 장소부사구 문두 → 자동사+명사주어 도치, do 안 씀(stand/lie/come). 단 Only/Not only가 주어를 강조하면 도치 X.
■ 비교: than 보이면 무조건 비교급 자리. the 비교급 S V, the 비교급 S V. 비교대상 격·대동사 주의(than she is / she does). 대상 비교는 that of(단수)/those of(복수). than any other 단수N = 최상급.
■ that/what/All: All(that) S V is + (to)V 또는 V (Ving 안 됨). what절=불완전문+명사절, that절=완전문.
■ 대명사: one…the other(둘), some…others(불특정 다수), another 단수N, other 복수N=others, the other 단복수 OK. 중복부정 금지(doesn't ~ any). most+N / most of+한정사N / almost+형·합성어.
■ 명사: 가산/불가산 구분. a kind of 단수N(무관사), kinds of 복수N.`;

// 편입수학 오답노트 필드 라벨 (types.ts MATH_CONFIG 미러링)
const MATH_LABELS: Record<string, string> = {
  a1: '학생이 적은 내 풀이·틀린 지점',
  a2: '학생이 적은 정답 풀이·핵심 아이디어',
  a3: '학생이 적은 풀이 교정',
};

const MATH_SYSTEM_PROMPT = `너는 편입수학을 전문으로 첨삭하는 베테랑 조교야. 학생이 손으로 푼 풀이(대부분 사진)를 읽고, 정확히 어느 단계에서 어떤 계산·개념 오류가 났는지 짚어주고, 올바른 풀이를 단계별로 제시하는 게 네 역할이야.

지켜야 할 것:
- 단원은 미적분학 / 다변수 미적분 / 선형대수 / 공학수학(미분방정식) / 기타 중 하나다. 단원 특성에 맞게 첨삭해.
- 이 단원에서 '이런 문제 형태(신호)를 보면 기계적으로 떠올려야 하는 사고·공식·풀이법'을 반드시 짚어줘. 아래에 [단원 실전 스킬]이 주어지면 그걸 근거로, 지금 문제가 그 단원의 어느 유형인지 특정하고 그 유형의 트리거(신호 → 떠올릴 공식·정리 → 첫 수)를 줘. 학생이 다음에 같은 형태를 보면 0에서 고민하지 말고 이 트리거가 즉시 나와야 해.
- 풀이는 대부분 손글씨 이미지로 온다. 이미지를 꼼꼼히 읽어서 학생이 쓴 식을 그대로 따라가며 "이 줄에서 부호가 바뀌었어요", "여기서 적분 상수를 빼먹으셨어요"처럼 틀린 지점을 정확히 특정해.
- 계산 실수인지, 개념/공식을 잘못 안 건지, 접근법 자체가 틀린 건지 구분해서 진단해.
- 올바른 풀이는 학생이 다시 스스로 풀 수 있게 단계별로. 핵심 공식·정리(예: 부분적분, 로피탈, 고유값 정의)는 이름을 밝혀줘.
- 수식은 반드시 LaTeX로 써. 문장 속 짧은 수식은 $...$ 로, 별도 줄에 크게 보여줄 식은 $$...$$ 로 감싸. (예: $f'(x)=2x$, 분수는 $\\frac{a}{b}$, 적분 $\\int x^n\\,dx=\\frac{x^{n+1}}{n+1}+C$, 극한 $\\lim_{x\\to0}$, 루트 $\\sqrt{x}$, 위첨자 $x^2$, 아래첨자 $a_1$). 한글 설명은 $ 밖에 쓰고, 수식만 $ 안에 넣어. 유니코드 수식기호(∫,√,² 등)를 그냥 쓰지 말고 꼭 LaTeX로.
- 문제 텍스트가 없고 이미지만 있으면 이미지를 직접 읽고 분석해.
- 정보가 부족하면 단정하지 말고, 확인이 필요한 부분은 짚어줘.

말투·형식 규칙(엄격히):
- 학생에게 말하듯 친근한 존댓말로 써. (예: "~했어요", "~예요", "~해 보세요") 반말은 절대 쓰지 마.
- 별표(*), 굵게(**), 밑줄 같은 마크다운 강조 기호를 절대 쓰지 마. 제목은 이모지와 일반 텍스트로만.
- 인사말·미사여구·격려성 군더더기 다 빼고 핵심만. 실전용으로 짧고 단정하게.

반드시 아래 형식 그대로 답해:

🎯 정답
(최종 정답을 먼저 명확히. 왜 그게 정답인지 핵심 근거 한 줄.)

🔍 오답 진단
(어느 단계에서 무엇을 왜 틀렸는지 1~3가지, 구체적으로)

✅ 정석 풀이
1. (첫 단계 — 어떤 공식·정리를 잡는지)
2. (계산 전개)
3. (정답 도출)

🧠 이 유형 사고 트리거
(이 문제를 보자마자 기계적으로 떠올렸어야 할 것. "이런 신호·형태 → 이 공식·정리·풀이법 → 첫 수는 이것" 순서로 짧게. 아래 [단원 실전 스킬]의 해당 유형에 근거해서. 다음에 같은 형태를 만나면 0에서 생각하지 말고 이게 반사적으로 나와야 함.)

⚡ 빠른 풀이 (편법·요령)
(시험에서 시간을 줄이는 지름길·치환·대입·객관식 소거 등 요령이 있으면 정리해. 마땅한 편법이 없으면 "이 유형은 정석대로가 가장 빠르고 안전해요"라고 써.)

💡 한 줄 교정
(다음에 같은 유형에서 바로 꺼내 쓸 핵심 한 줄)

[암기공식]
(이 문제를 풀려면 외워야 할 핵심 공식·정리를 한 줄에 하나씩. 형식은 "공식 | 언제 쓰는지". 공식은 반드시 LaTeX로 $...$ 안에 써. 예: $\\int x^n\\,dx=\\frac{x^{n+1}}{n+1}+C$ | 다항식 적분. 외울 공식이 없으면 이 [암기공식] 줄만 남기고 비워둬.)`;

// 단원별 편입수학 실전 스킬 — "이 신호(문제 형태) 보면 → 이 사고·공식·풀이법을 기계적으로 떠올려라".
// 노트의 area에 해당하는 블록만 시스템 프롬프트에 붙는다(문법 프롬프트와 같은 방식, 단원마다 접근이 완전히 달라서).
// 표기는 읽기용 일반 수식(λ,∇,∫,√ 등) — Claude가 출력에서 LaTeX로 변환한다.
const MATH_SKILLS: Record<string, string> = {
  '미적분학': `

[단원 실전 스킬 — 미적분학]
■ 극한 신호: 0/0·∞/∞ → 로피탈(미분이 간단할 때) 또는 테일러 전개(초월함수 섞이면 테일러가 더 빠르고 안전). 1^∞ → e^(lim(밑−1)·지수) 또는 (1+1/n)^n=e. ∞−∞ → 통분/유리화(√ 차이 보이면 반사적으로 유리화). x→∞ 유리식 → 최고차항끼리 비교. 삼각 0/0 → sinx/x→1, (1−cosx)/x²→1/2 기본극한.
■ 미분 신호: 밑·지수 둘 다 변수(x^x 등) → 로그미분. F(x,y)=0 꼴 → 음함수 미분 후 y′ 정리. 매개변수 x(t),y(t) → dy/dx=(dy/dt)/(dx/dt), 2계는 (d/dt[dy/dx])/(dx/dt). 곱·몫·연쇄는 반사.
■ 미분 응용: 접선·법선=f′. 극값·변곡 → f′=0·f″부호. 최적화 → 변수 하나로 줄여 f′=0. 관련변화율 → t로 양변 미분. 평균값·롤 정리(연속+미분가능 신호).
■ 적분 신호(핵심): (다항)×(지수/삼각/로그) → 부분적분, u는 LIATE(로그>역삼각>다항>지수>삼각) 순. 유리식 → 부분분수. √(a²−x²)→x=a sinθ, √(a²+x²)→x=a tanθ, √(x²−a²)→x=a secθ 삼각치환. 대칭구간 기함수 → 0. ∫sinⁿcosⁿ → 차수 낮추기/왈리스.
■ 정적분 응용: 넓이 ∫|위−아래|. 회전체 부피 → 회전축과 적분변수 수직이면 원판 π∫R², 평행이면 원통껍질 2π∫(반지름)(높이). 곡선길이 ∫√(1+(y′)²).
■ 무한급수 신호: 팩토리얼/지수 → 비판정, n제곱꼴 → 근판정, 양의 감소항+적분쉬움 → 적분판정, (−1)ⁿ → 교대급수(라이프니츠). 멱급수 → 비판정으로 수렴반경 R. 전개 → 테일러/매클로린(e^x, sinx, cosx, 1/(1−x), ln(1+x), (1+x)^k 기본형 암기).
■ 이상적분: 무한구간·특이점 → 극한 정의. 판정은 p적분(∫1/xᵖ) 기준·비교판정.`,
  '다변수 미적분': `

[단원 실전 스킬 — 다변수 미적분]
■ 편도함수: 한 변수만 변수·나머지 상수. 전미분 df=f_x dx+f_y dy. 연쇄법칙은 나무그림(경로마다 곱→모두 합).
■ 기울기·방향 신호: ∇f=(f_x,f_y,f_z). 방향도함수 D_u f=∇f·û(û는 반드시 단위벡터). 최대증가 방향=∇f, 최대율=|∇f|. 곡면 F=상수의 법선=∇F → 접평면·법선.
■ 다변수 극값 신호: 임계점 ∇f=0 → 판별식 D=f_xx·f_yy−(f_xy)²: D>0&f_xx>0 극소, D>0&f_xx<0 극대, D<0 안장점, D=0 미정. "제약 g=0 하 최대/최소" → 라그랑주 ∇f=λ∇g.
■ 중적분 신호: 영역이 원·부채꼴 → 극좌표(dA=r dr dθ). 안 풀리면 적분순서 변경(영역 다시 그리기). 일반치환 → 야코비안 |∂(x,y)/∂(u,v)| 곱. 삼중적분은 원기둥/구면좌표(dV=r dz dr dθ / ρ²sinφ dρ dφ dθ).
■ 선적분·벡터해석 신호: ∮F·dr에서 curl F=0(보존장)이면 퍼텐셜 f 찾아 끝점값 차. 평면 닫힌곡선 → 그린정리 ∮=∬(Q_x−P_y)dA. 닫힌곡면 → 발산정리 ∯F·dS=∭(∇·F)dV. 곡선이 두른 면 → 스토크스 ∮F·dr=∬(∇×F)·dS.`,
  '선형대수': `

[단원 실전 스킬 — 선형대수]
■ 행렬식 신호: 3×3↑ → 0 많은 행/열로 여인수전개, 또는 행연산으로 상삼각 만들어 대각곱. det=0 ↔ 역행렬 없음 ↔ 열벡터 일차종속 ↔ 동차계 비자명해 존재.
■ 연립방정식 신호: 첨가행렬 [A|b] 가우스소거 → rank 판정. rank(A)=rank(A|b)=미지수 → 유일해, <미지수 → 무수히(자유변수=미지수−rank), rank(A)<rank(A|b) → 해없음. 동차 Ax=0 비자명해 ↔ det A=0.
■ 벡터공간 신호: 일차독립 판정 → 벡터를 열로 rank=개수인지. 기저=독립+생성, dim=기저 수. rank+nullity=열 수(차원정리). 부분공간은 0포함·덧셈·스칼라배 닫힘.
■ 선형변환: 표준행렬=T(e_i)를 열로. 핵=Ax=0(nullity), 상=열공간(rank).
■ 고유값·대각화 신호(핵심): "고유값/고유벡터/대각화/A^n/2차형식" 보이면 → 특성방정식 det(A−λI)=0 → λ, 각 λ마다 (A−λI)x=0로 고유벡터. 대각화 A=PDP⁻¹(P=고유벡터, D=고유값), A^n=PDⁿP⁻¹. 서로 다른 고유값 → 대각화 가능. 대칭행렬 → 실고유값·직교대각화 항상 가능.
■ 내적·직교화 신호: 정사영 proj_u v=(v·u/u·u)u. 임의 기저 → 그람-슈미트로 정규직교화. 직교행렬 QᵀQ=I. 최소제곱 → 정규방정식 AᵀAx=Aᵀb.`,
  '공학수학': `

[단원 실전 스킬 — 공학수학(미분방정식)]
■ 1계 신호: 변수분리 가능 → 분리 후 양변 적분. M dx+N dy=0에서 M_y=N_x → 완전미분(퍼텐셜). y′+P(x)y=Q 선형 → 적분인자 μ=e^(∫P dx). y′=f(y/x) 동차 → v=y/x 치환. 베르누이 y′+Py=Qy^n → v=y^(1−n) 치환.
■ 2계 상수계수 신호: ay″+by′+cy=0 → 특성방정식 ar²+br+c=0. 실서로다른근 c₁e^(r₁x)+c₂e^(r₂x), 중근 (c₁+c₂x)e^(rx), 복소근 α±βi → e^(αx)(c₁cosβx+c₂sinβx). 비제차: 우변 지수·다항·sin/cos → 미정계수법, tanx·secx·일반형 → 매개변수변화법.
■ 코시-오일러 신호: x²y″+axy′+by=0(계수 x차수=미분횟수) → y=x^m 대입 또는 x=eᵗ 치환.
■ 라플라스 신호: 초기값문제·불연속 우변·단위계단 u(t−a)·충격 δ(t−a) → 라플라스. L{y′}=sY−y(0). 이동정리 e^(at)f→F(s−a), u(t−a)f(t−a)→e^(−as)F(s). 곱형태 역변환 → 합성곱 f*g. 기본표(1,tⁿ,e^(at),sin,cos,sinh,cosh) 암기 필수.
■ 연립/급수: 연립 → 행렬 X′=AX, A의 고유값·고유벡터(선형대수 연결). 변수계수·초등해 없음 → 멱급수해/프로베니우스. 경계값·주기함수 → 푸리에 급수(a₀·aₙ·bₙ, 우/기함수는 코사인/사인만).`,
};

// 소단원(topic)별 정밀 트리거 — area 뱅크에 이어 붙는다. 신호→풀이 / 자주 실수 / 필수 공식 순.
// note.topic 이 아래 키와 일치하면 추가로 주입(더 정밀). 키는 types.ts MATH_UNITS의 topic 문자열과 정확히 일치.
const MATH_TOPIC_SKILLS: Record<string, string> = {
  '극한·연속': `

[소단원 트리거 — 극한·연속]
신호→풀이: 0/0·∞/∞ → 로피탈(간단할 때)/테일러(초월함수). 1^∞ → e^(lim(밑−1)·지수). ∞−∞ → 통분·유리화. 삼각 → sinx/x→1, (1−cosx)/x²→1/2. 연속 판정 → 좌극한=우극한=함숫값.
자주 실수: 부정형 아닌데 로피탈 적용, 테일러 차수 부족, 좌우극한 방향(x→a±) 착각.
필수: 기본극한들, 연속·미분가능(미분가능⇒연속, 역 아님).`,
  '미분법': `

[소단원 트리거 — 미분법]
신호→풀이: 곱·몫·연쇄는 반사. 밑·지수 둘다 변수 → 로그미분. F(x,y)=0 → 음함수 미분. 매개변수 → dy/dx=(dy/dt)/(dx/dt). 역함수 → 1/f′.
자주 실수: 연쇄법칙 안쪽 도함수 누락, 음함수에서 y′ 곱 빠뜨림, 몫미분 부호.
필수: (fg)′=f′g+fg′, (f/g)′=(f′g−fg′)/g², 연쇄법칙.`,
  '미분 응용': `

[소단원 트리거 — 미분 응용]
신호→풀이: 접선/법선 → f′로 기울기. 극값·변곡 → f′=0, f″부호. 최적화 → 변수 하나로 줄여 f′=0. 관련변화율 → t로 양변 미분. 부등식 증명 → 함수 차 f−g 단조성.
자주 실수: 정의역 끝점 극값 누락, 이차판정(f″) 부호 혼동, 최적화에서 제약 반영 안 함.
필수: 평균값정리, 1·2계 판정.`,
  '적분법': `

[소단원 트리거 — 적분법]
신호→풀이: (다항)×(지수/삼각/로그) → 부분적분(u는 LIATE 순). 유리식 → 부분분수. √(a²±x²)·√(x²−a²) → 삼각치환. 대칭구간 기함수 → 0. ∫sinⁿcosⁿ → 차수↓/왈리스.
자주 실수: 치환 후 dx 안 바꿈, 부분적분 부호·반복, 적분상수 누락.
필수: ∫u dv=uv−∫v du, ∫dx/(x²+a²)=(1/a)arctan(x/a), ∫dx/√(a²−x²)=arcsin(x/a).`,
  '정적분 응용': `

[소단원 트리거 — 정적분 응용]
신호→풀이: 넓이=∫|위−아래|. 회전체 부피 → 회전축⊥적분변수면 원판 π∫R², 평행이면 원통껍질 2π∫(반지름)(높이). 곡선길이 ∫√(1+(y′)²). 회전면 표면적 2π∫y ds.
자주 실수: 원판/셸 선택 착오, 회전축이 x축이 아닐 때 반지름=|f−축|, 상하/좌우 함수 뒤바뀜.
필수: 디스크·셸·호길이·표면적 공식.`,
  '무한급수': `

[소단원 트리거 — 무한급수]
신호→풀이: 팩토리얼/지수 → 비판정. nⁿ → 근판정. 양의 감소항+적분쉬움 → 적분판정. (−1)ⁿ → 교대급수(라이프니츠). p급수/기하급수 즉시 판정. 멱급수 → 비판정으로 수렴반경 R, 끝점 따로.
자주 실수: 절대/조건수렴 구분, 멱급수 끝점 판정 누락, 발산인데 부분합 착각.
필수: 기하급수 합 a/(1−r), 테일러(e^x, sinx, cosx, 1/(1−x), ln(1+x)).`,
  '이상적분': `

[소단원 트리거 — 이상적분]
신호→풀이: 무한구간·피적분 특이점 → 극한으로 정의해 계산. 수렴 판정 → p적분 기준, 비교판정·극한비교판정.
자주 실수: 특이점 무시하고 그냥 대입, 수렴/발산 경계 p=1, 두 특이점을 한 극한으로 처리.
필수: ∫₁^∞ x^(−p) 수렴 ↔ p>1, ∫₀¹ x^(−p) 수렴 ↔ p<1.`,
  '편도함수·전미분': `

[소단원 트리거 — 편도함수·전미분]
신호→풀이: 편미분은 한 변수만 변수·나머지 상수. 전미분 df=f_x dx+f_y dy(근사 Δf≈df). 합성 → 연쇄법칙 나무그림(경로마다 곱→모두 합).
자주 실수: 연쇄 경로 하나 빠뜨림, 어느 변수로 미분하는지 혼동, 이계 편미분 순서.
필수: 전미분·연쇄법칙, f_xy=f_yx(연속이면).`,
  '다변수 극값': `

[소단원 트리거 — 다변수 극값]
신호→풀이: ∇f=0으로 임계점 → 판별식 D=f_xx·f_yy−(f_xy)². D>0&f_xx>0 극소 / D>0&f_xx<0 극대 / D<0 안장 / D=0 미정. 제약 g=0 → 라그랑주 ∇f=λ∇g.
자주 실수: 안장점 놓침, 제약식 g=0 자체를 방정식에 안 넣음, 경계·구석 미검토.
필수: 헤시안 판별식, 라그랑주 승수.`,
  '중적분': `

[소단원 트리거 — 중적분]
신호→풀이: 영역이 원·부채꼴·환형 → 극좌표 dA=r dr dθ. 적분 안 풀리면 순서 변경(영역 다시 그림). 일반치환 → 야코비안 |∂(x,y)/∂(u,v)| 곱. 삼중 → 원기둥/구면좌표.
자주 실수: 극좌표에서 r 빠뜨림, 적분한계를 영역과 안 맞춤, 야코비안 누락.
필수: 극 dA=r dr dθ, 구면 dV=ρ²sinφ dρ dφ dθ.`,
  '선적분·면적분': `

[소단원 트리거 — 선적분·면적분]
신호→풀이: 스칼라 선적분=호길이요소 ds, 벡터=∫F·dr. 보존장(curl F=0)이면 퍼텐셜 f 찾아 끝점차. 면적분 스칼라=면적요소 dS, 벡터=플럭스 ∫F·n dS.
자주 실수: 매개변수화 방향(향), ds와 dr 혼동, 법선벡터 방향.
필수: F·dr=F·T ds, dS=|r_u×r_v| du dv.`,
  '벡터해석(그린·발산·스토크스)': `

[소단원 트리거 — 벡터해석(그린·발산·스토크스)]
신호→풀이: 평면 닫힌곡선 → 그린 ∮=∬(Q_x−P_y)dA. 닫힌곡면 플럭스 → 발산 ∯F·dS=∭(∇·F)dV. 곡선이 두른 곡면 → 스토크스 ∮F·dr=∬(∇×F)·dS.
자주 실수: 방향(반시계/바깥법선) 부호, 곡면이 닫혔는지 여부, 그린·스토크스 혼용.
필수: 세 정리 형태 + ∇·F, ∇×F 계산.`,
  '행렬·연립방정식': `

[소단원 트리거 — 행렬·연립방정식]
신호→풀이: 첨가행렬 [A|b] 가우스소거 → rank 비교. rank(A)=rank(A|b)=n → 유일해 / <n → 무수히(자유변수=n−rank) / rank(A)<rank(A|b) → 해없음. 동차 Ax=0 비자명해 ↔ det A=0.
자주 실수: 자유변수 수 오산, 후진대입 계산실수, 무해/무수 판정 뒤바뀜.
필수: rank 정리, 기약행사다리꼴(RREF).`,
  '행렬식': `

[소단원 트리거 — 행렬식]
신호→풀이: 0 많은 행/열로 여인수전개, 또는 행연산으로 상삼각 만들어 대각곱. det(AB)=detA·detB, det(A⁻¹)=1/detA, det=0 ↔ 특이(역행렬 없음).
자주 실수: 행교환 부호(−1), 여인수 부호 (−1)^(i+j), 행연산 중 배수 곱하면 det도 배수.
필수: 여인수전개, 행렬식 성질, 크래머 공식.`,
  '벡터공간': `

[소단원 트리거 — 벡터공간]
신호→풀이: 일차독립 판정 → 벡터를 열로 만들어 rank=벡터개수인지. 기저=일차독립+생성, dim=기저 벡터 수. rank+nullity=열 개수(차원정리).
자주 실수: 부분공간 판정에서 0포함·덧셈·스칼라배 닫힘 확인 안 함, 생성/독립 혼동.
필수: 차원정리, 기저·차원 정의.`,
  '선형변환': `

[소단원 트리거 — 선형변환]
신호→풀이: 표준행렬=T(e_i)를 열로 배열. 핵(kernel)=Ax=0 해공간(dim=nullity), 상(image)=열공간(dim=rank). 단사↔ker={0}, 전사↔rank=공역차원.
자주 실수: 기저 변환행렬 방향, 핵과 상 혼동, 표준행렬 열/행 뒤바뀜.
필수: rank-nullity, 표준행렬 구성.`,
  '고유값·대각화': `

[소단원 트리거 — 고유값·대각화]
신호→풀이: "고유값/대각화/Aⁿ/2차형식" → 특성방정식 det(A−λI)=0 → λ, 각 λ마다 (A−λI)x=0로 고유벡터. 대각화 A=PDP⁻¹, Aⁿ=PDⁿP⁻¹. 대칭행렬 → 직교대각화(P 직교).
자주 실수: 중복 고유값에서 기하중복도<대수중복도면 대각화 불가, 고유벡터 정규화 누락, P·D 순서.
필수: 특성방정식, A=PDP⁻¹, 대칭⇒실고유값·직교고유벡터.`,
  '내적공간·직교화': `

[소단원 트리거 — 내적공간·직교화]
신호→풀이: 정사영 proj_u v=(v·u/u·u)u. 임의 기저 → 그람-슈미트로 정규직교화. 직교행렬 QᵀQ=I. 최소제곱해 → 정규방정식 AᵀAx=Aᵀb.
자주 실수: 그람슈미트에서 정규화 누락, 정사영 분모 u·u 빠뜨림, 직교여공간 혼동.
필수: 정사영·그람슈미트·정규방정식.`,
  '1계 미분방정식': `

[소단원 트리거 — 1계 미분방정식]
신호→풀이: 변수분리 가능 → 분리 후 적분. M dx+N dy=0에서 M_y=N_x → 완전미분(퍼텐셜 F). y′+P(x)y=Q → 선형, 적분인자 μ=e^(∫P dx). y′=f(y/x) → v=y/x. 베르누이 y′+Py=Qyⁿ → v=y^(1−n).
자주 실수: 적분인자 곱 후 (μy)′로 안 묶음, 완전 판정 M_y=N_x 착오, 변수분리 상수 C.
필수: 적분인자 μ=e^(∫P dx), 완전미분 조건.`,
  '2계 선형 미분방정식': `

[소단원 트리거 — 2계 선형 미분방정식]
신호→풀이: 제차 ay″+by′+cy=0 → 특성방정식 ar²+br+c=0. 실서로다른근 c₁e^(r₁x)+c₂e^(r₂x) / 중근 (c₁+c₂x)e^(rx) / 복소근 α±βi → e^(αx)(c₁cosβx+c₂sinβx). 비제차 → 우변 지수·다항·sin/cos면 미정계수법, tan·sec·일반형이면 매개변수변화법.
자주 실수: 중근에서 x 곱 누락, 특수해가 제차해와 겹치면 x 곱, 복소근 실수형 변환.
필수: 세 근 케이스, 미정계수 시행함수 표.`,
  '연립 미분방정식': `

[소단원 트리거 — 연립 미분방정식]
신호→풀이: X′=AX 꼴 → A의 고유값·고유벡터(선형대수 연결). 일반해 X=Σc_i e^(λ_i t) v_i. 복소 고유값 → 실수형(cos·sin), 중복 → 일반화 고유벡터.
자주 실수: 고유벡터로 해 구성 실수, 중복 고유값 처리, 복소해 실수화.
필수: X=Σc_i e^(λ_i t) v_i, 기본행렬.`,
  '라플라스 변환': `

[소단원 트리거 — 라플라스 변환]
신호→풀이: 초기값문제·불연속 우변·단위계단 u(t−a)·충격 δ(t−a) → 라플라스로. L{y′}=sY−y(0), L{y″}=s²Y−sy(0)−y′(0). 이동정리 e^(at)f→F(s−a), u(t−a)f(t−a)→e^(−as)F(s). 곱형태 역변환 → 합성곱 f*g.
자주 실수: u(t−a)에서 t−a로 안 맞춤, 부분분수 후 역변환, 초기값 대입.
필수: 변환표(1,tⁿ,e^(at),sin,cos), 이동·미분 정리, 합성곱.`,
  '급수해': `

[소단원 트리거 — 급수해]
신호→풀이: 정상점 → 멱급수 y=Σaₙxⁿ 대입해 점화식. 정칙특이점 → 프로베니우스 y=x^r Σaₙxⁿ, 지표방정식으로 r.
자주 실수: 점화식 인덱스 이동, 지표방정식 근 두 개 처리, 수렴반경.
필수: 정상점/정칙특이점 판정, 점화식 세우기.`,
  '푸리에 급수': `

[소단원 트리거 — 푸리에 급수]
신호→풀이: 주기 2L 함수 전개 → a₀, aₙ, bₙ 적분. 우함수 → 코사인만(bₙ=0), 기함수 → 사인만(aₙ=0). 수렴은 디리클레(불연속점은 평균값).
자주 실수: a₀ 계수(1/2 여부), 우/기함수 판정, 반구간 전개(코사인/사인 급수).
필수: aₙ=(1/L)∫f cos(nπx/L)dx, bₙ=(1/L)∫f sin(nπx/L)dx.`,
  '확률·통계': `

[소단원 트리거 — 확률·통계]
신호→풀이: 경우의 수 → 순열/조합. 조건부·"~일 때" → 베이즈 P(A|B)=P(B|A)P(A)/P(B). 기댓값 E[X]=Σx p(x) 또는 ∫x f(x)dx, 분산 Var=E[X²]−(E[X])². 분포 식별(이항·포아송·정규).
자주 실수: 독립 가정 남용, 이산/연속 혼동, 조건부에서 분모 P(B).
필수: 베이즈, E·Var 정의, 주요 분포 평균·분산.`,
  '복소해석': `

[소단원 트리거 — 복소해석]
신호→풀이: z=re^(iθ)=r(cosθ+isinθ). 해석성 → 코시-리만 u_x=v_y, u_y=−v_x. 폐곡선 적분 → 유수정리 ∮=2πi·Σ Res. 극점 차수 파악 후 유수 계산.
자주 실수: 극점 차수(단순/고차) 판정, 유수 계산 공식 선택, 편각 범위.
필수: 코시적분공식, 유수정리, 코시-리만.`,
};

function buildNoteText(note: Record<string, unknown>): string {
  const isMath = String(note.subject ?? '') === 'math';
  const area = String(note.area ?? '');
  const labels = isMath ? MATH_LABELS : (FIELD_LABELS[area] ?? {});
  const fields = (note.fields ?? {}) as Record<string, string>;
  const causes = (note.causes ?? []) as string[];

  const lines: string[] = [];
  if (isMath) {
    const topic = String(note.topic ?? '');
    lines.push(`[과목] 편입수학`);
    lines.push(`[단원] ${area}${topic ? ` > ${topic}` : ''}`);
  } else {
    lines.push(`[영역] ${area}`);
  }
  if (note.problem_text) lines.push(`\n[문제]\n${note.problem_text}`);
  else lines.push(`\n[문제] (텍스트 없음 — 첨부 이미지를 참고할 것)`);

  const fieldParts: string[] = [];
  for (const [k, label] of Object.entries(labels)) {
    const v = fields[k];
    if (v && String(v).trim()) fieldParts.push(`${label}: ${v}`);
  }
  if (fieldParts.length) lines.push(`\n[학생 분석]\n${fieldParts.join('\n')}`);

  if (causes.length) lines.push(`\n[학생이 체크한 오답 원인] ${causes.join(', ')}`);
  if (note.one_line) lines.push(`\n[학생의 한 줄 정리] ${note.one_line}`);

  return lines.join('\n');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  if (!ANTHROPIC_API_KEY) return json({ error: 'AI 키가 서버에 설정되지 않았어. (ANTHROPIC_API_KEY)' }, 500);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return json({ error: '로그인이 필요해.' }, 401);

  let noteId = '';
  let auto = false;
  let instruction = '';
  try {
    const body = await req.json();
    noteId = String(body?.note_id ?? '');
    auto = body?.auto === true; // 자동 모드: 학생이 오답노트 저장 시 AI가 바로 코멘트를 삽입
    instruction = String(body?.instruction ?? '').trim(); // 멘토가 부적절한 답변을 고치려고 준 지시
  } catch {
    return json({ error: '잘못된 요청이야.' }, 400);
  }
  if (!noteId) return json({ error: 'note_id 가 필요해.' }, 400);

  // 호출자 권한으로 동작하는 클라이언트 — RLS 그대로 적용됨
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) return json({ error: '세션이 유효하지 않아.' }, 401);

  // 멘토 검증 (서버 측 강제)
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userData.user.id)
    .maybeSingle();
  const isMentor = profile?.role === 'mentor';
  // 버튼(수동) 모드는 멘토만. 자동 모드는 본인 오답노트인 학생도 허용.
  if (!auto && !isMentor) {
    return json({ error: '멘토만 AI 자동답변을 쓸 수 있어.' }, 403);
  }

  // 노트 조회 — RLS(can_access_note)가 멘토의 그룹 접근을 보장
  const { data: note, error: noteErr } = await supabase
    .from('notes')
    .select('user_id, subject, topic, area, problem_text, image_url, image_urls, fields, causes, one_line')
    .eq('id', noteId)
    .maybeSingle();
  if (noteErr || !note) return json({ error: '노트를 찾을 수 없거나 접근 권한이 없어.' }, 404);

  // 자동 모드는 본인 노트에만 (멘토는 그룹 내 모두)
  if (auto && !isMentor && note.user_id !== userData.user.id) {
    return json({ error: '본인 오답노트만 AI 첨삭을 받을 수 있어.' }, 403);
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Claude 메시지 content 구성 (라벨+이미지들, 그다음 텍스트)
  const content: unknown[] = [];
  async function pushImage(ref: string, label: string) {
    try {
      const path = noteImagePath(ref);
      let bytes: Uint8Array;
      let mediaType = 'image/jpeg';

      if (path) {
        // note-images 는 private 버킷이라 공개 URL로 못 받는다 → service_role 로 직접 내려받는다.
        // 노트 조회는 위에서 호출자 권한(RLS)으로 이미 통과했으므로 접근 권한은 검증된 상태.
        const { data, error } = await admin.storage.from(NOTE_BUCKET).download(path);
        if (error || !data) return;
        if (data.type?.startsWith('image/')) mediaType = data.type.split(';')[0];
        bytes = new Uint8Array(await data.arrayBuffer());
      } else {
        const imgRes = await fetch(ref);
        if (!imgRes.ok) return;
        const ct = imgRes.headers.get('content-type') || '';
        if (ct.startsWith('image/')) mediaType = ct.split(';')[0];
        bytes = new Uint8Array(await imgRes.arrayBuffer());
      }

      content.push({ type: 'text', text: label });
      content.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: encodeBase64(bytes) } });
    } catch {
      // 이미지 로드 실패해도 나머지로 진행
    }
  }

  // 문제 사진은 여러 장일 수 있음 (image_urls). 없으면 옛 단일 image_url로 하위호환.
  const problemImages = (note.image_urls as string[] | null)?.length
    ? (note.image_urls as string[])
    : (note.image_url ? [note.image_url as string] : []);
  for (let i = 0; i < problemImages.length; i++) {
    await pushImage(problemImages[i], problemImages.length > 1 ? `[문제 이미지 ${i + 1}/${problemImages.length}]` : '[문제 이미지]');
  }

  // 각 풀이 칸의 손글씨·사진 (fields['a1_img'] 등)
  const noteFields = (note.fields ?? {}) as Record<string, string>;
  const isMath = String(note.subject ?? '') === 'math';
  for (const [k, v] of Object.entries(noteFields)) {
    if (k.endsWith('_img') && v) {
      const base = k.slice(0, -4);
      const lbl = (isMath ? MATH_LABELS[base] : FIELD_LABELS[String(note.area ?? '')]?.[base]) ?? base;
      await pushImage(v, `[${lbl} 이미지]`);
    }
  }

  // 지식베이스에서 비슷한 과거 검증 사례 검색 (있으면 참고자료로 첨부, 없어도 정상 진행)
  const knowledgeHint = await findSimilarKnowledge(admin, isMath ? 'math' : 'english', String(note.problem_text ?? ''));

  content.push({ type: 'text', text: buildNoteText(note) + knowledgeHint });

  // 멘토가 이전 답변을 부적절하다고 판단해 준 지시 — 최우선 반영
  if (instruction) {
    content.push({ type: 'text', text: `\n[멘토 지시 — 최우선 반영] 방금 단 AI 첨삭이 부적절하다고 멘토가 판단했어. 아래 지시를 반드시 우선으로 반영해서 처음부터 다시 첨삭해. 지시가 정답·근거를 지정하면 그걸 사실로 받아들이고 거기에 맞춰 설명해.\n지시: ${instruction}` });
  }

  const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      // 확장 사고: 지저분한 계산·자기수정은 thinking 블록에서 → 아래에서 type==='text'만 저장하므로 학생에겐 최종본만 보임
      thinking: { type: 'enabled', budget_tokens: 4000 },
      system: OUTPUT_RULE + (String(note.subject ?? '') === 'math'
        ? MATH_SYSTEM_PROMPT + (MATH_SKILLS[String(note.area ?? '')] ?? '') + (MATH_TOPIC_SKILLS[String(note.topic ?? '')] ?? '')
        : (String(note.area ?? '') === '문법' ? GRAMMAR_SYSTEM_PROMPT : SYSTEM_PROMPT)),
      messages: [{ role: 'user', content }],
    }),
  });

  if (!aiRes.ok) {
    const detail = await aiRes.text();
    console.error('Anthropic error', aiRes.status, detail);
    if (aiRes.status === 429) return json({ error: 'AI 사용량이 잠시 많아. 잠시 후 다시 시도해.' }, 429);
    return json({ error: 'AI 답변 생성에 실패했어. 잠시 후 다시 시도해.' }, 502);
  }

  const aiData = await aiRes.json();
  const text = (aiData?.content ?? [])
    .filter((b: { type?: string }) => b.type === 'text')
    .map((b: { text?: string }) => b.text ?? '')
    .join('')
    .trim();

  if (!text) return json({ error: 'AI가 빈 답변을 냈어. 다시 시도해.' }, 502);

  // 수동(버튼) 모드: 텍스트만 반환 → 멘토가 검토 후 등록
  if (!auto) return json({ text });

  // 자동 모드: service role 로 comments 에 AI 멘토 코멘트를 바로 삽입

  // 수학이면 [암기공식] 블록을 분리 → 공식암기장(formulas) + 노트 '외울 공식' 칸에 저장
  let commentBody = text;
  if (isMath) {
    const marker = '[암기공식]';
    const mi = text.indexOf(marker);
    if (mi !== -1) {
      commentBody = text.slice(0, mi).trim();
      const lines = text.slice(mi + marker.length)
        .split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('(') && (l.includes('|') || /[=√∫∑]/.test(l)));
      const MATHSEG = /[=∫∑∇√±×÷^<>≤≥πθλεδμσ∞→∂]|\\[a-zA-Z]|\$/;
      const rows = lines.map(l => {
        const clean = l.replace(/^[-•\d.\s]+/, '');
        const segs = clean.split('|').map(s => s.trim()).filter(Boolean);
        // 공식(수식)이 이름 뒤에 오더라도 수식 조각을 formula로, 나머지를 설명으로
        const formula = segs.find(s => MATHSEG.test(s)) || segs[0] || '';
        const description = segs.filter(s => s !== formula).join(' · ');
        return { user_id: note.user_id as string, note_id: noteId, formula, description, unit: String(note.area ?? '') };
      }).filter(r => r.formula);
      if (rows.length) {
        await admin.from('formulas').insert(rows);
        const mergedFields = {
          ...((note.fields ?? {}) as Record<string, string>),
          formula: rows.map(r => (r.description ? `${r.formula}  (${r.description})` : r.formula)).join('\n'),
        };
        await admin.from('notes').update({ fields: mergedFields }).eq('id', noteId);
      }
    }
  }

  const { error: insErr } = await admin.from('comments').insert({
    note_id: noteId,
    author_id: note.user_id,
    author_name: '🤖 AI 멘토',
    author_role: 'mentor',
    body: commentBody,
    ai_generated: true,
  });
  if (insErr) {
    console.error('insert comment error', insErr);
    return json({ error: 'AI 첨삭 저장에 실패했어.' }, 500);
  }
  return json({ ok: true });
});
