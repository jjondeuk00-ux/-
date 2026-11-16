import { useState } from 'react';
import Layout from '../components/Layout';

const SUBJECTS = ['영어', '수학'];
const CATEGORIES = ['전체', '독해', '논리', '문법'];

const POSTS = [
  {
    id: 1,
    author: '김방장2',
    subject: '독해',
    source: '2024 한양대 기출 · 12번',
    date: '9/12 14:30',
    content: '밑줄 친 부분의 의미로 가장 적절한 것을 못 고르겠어요. 3번이랑 5번 중에 헷갈립니다.',
    likes: 2,
    hearts: 1,
  },
  {
    id: 2,
    author: '이도영',
    subject: '문법',
    source: '김영편입 문법 · p.42',
    date: '9/11 21:05',
    content: '가정법 도치 문제인데 왜 had가 앞으로 나오는지 설명 부탁드려요!',
    likes: 2,
    hearts: 1,
  },
  {
    id: 3,
    author: '박준서',
    subject: '논리',
    source: '2024 중앙대 기출 · 5번',
    date: '9/10 18:22',
    content: '빈칸 추론인데 선택지가 너무 비슷해요. AI 멘토 답변이 이해가 안 돼서요.',
    likes: 0,
    hearts: 3,
  },
];

export default function Board() {
  const [activeSubject, setActiveSubject] = useState('영어');
  const [activeCategory, setActiveCategory] = useState('전체');

  const filtered = POSTS.filter(p =>
    activeCategory === '전체' || p.subject === activeCategory
  );

  return (
    <Layout>
      {/* Header row */}
      <div className="flex justify-between items-center px-4 py-3 bg-white border-b border-gray-border">
        <div>
          <h2 className="text-[15px] font-bold text-gray-text">KIM2027 문제 게시판</h2>
          <p className="text-[12px] text-gray-secondary">모르는 문제 올리면 AI 멘토가 바로 답해줘.</p>
        </div>
        <button className="bg-green-primary text-white text-[13px] font-bold px-3 py-2 rounded-lg flex items-center gap-1">
          ✏️ 글쓰기
        </button>
      </div>

      {/* Search */}
      <div className="px-4 py-3 bg-white border-b border-gray-border">
        <div className="flex items-center gap-2 bg-gray-bg rounded-lg px-3 py-2">
          <span className="text-gray-secondary text-sm">🔍</span>
          <input
            type="text"
            placeholder="내용·출처·작성자로 검색"
            className="flex-1 bg-transparent text-[13px] text-gray-text outline-none placeholder:text-gray-secondary"
          />
        </div>
      </div>

      {/* Subject tabs */}
      <div className="flex px-4 pt-3 gap-2 bg-white">
        {SUBJECTS.map(s => (
          <button
            key={s}
            onClick={() => setActiveSubject(s)}
            className={`px-4 py-1.5 rounded-lg text-[13px] font-medium border ${
              activeSubject === s
                ? 'bg-green-chip border-green-primary text-green-primary'
                : 'border-gray-border text-gray-secondary bg-white'
            }`}
          >
            📚 {s}
          </button>
        ))}
      </div>

      {/* Category chips */}
      <div className="flex gap-2 px-4 py-3 bg-white border-b border-gray-border overflow-x-auto scrollbar-none">
        {CATEGORIES.map(c => (
          <button
            key={c}
            onClick={() => setActiveCategory(c)}
            className={`flex-shrink-0 px-3 py-1 rounded-full text-[12px] font-medium ${
              activeCategory === c
                ? 'bg-green-primary text-white'
                : 'bg-gray-bg text-gray-secondary'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Post list */}
      <div className="divide-y divide-gray-border">
        {filtered.map(post => (
          <div key={post.id} className="bg-white px-4 py-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="font-bold text-[14px] text-gray-text">{post.author}</span>
              <span className="px-2 py-0.5 bg-green-chip text-green-primary text-[11px] font-medium rounded">
                {post.subject}
              </span>
              <span className="text-[12px] text-gray-secondary">{post.source}</span>
              <span className="ml-auto text-[11px] text-gray-secondary">{post.date}</span>
            </div>
            <p className="text-[13px] text-gray-text leading-5 mb-3">{post.content}</p>
            <div className="flex items-center gap-3">
              <button className="flex items-center gap-1 text-[13px] text-gray-secondary">
                <span>👍</span> {post.likes}
              </button>
              <button className="flex items-center gap-1 text-[13px] text-gray-secondary">
                <span>❤️</span> {post.hearts}
              </button>
              <button className="text-[13px] text-gray-secondary">+</button>
              <button className="ml-auto text-[13px] text-green-primary font-medium">
                댓글 보기
              </button>
            </div>
          </div>
        ))}
      </div>
    </Layout>
  );
}
