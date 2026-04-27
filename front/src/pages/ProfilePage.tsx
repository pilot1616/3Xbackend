import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { buildAssetUrl } from '../api/client';
import { getMe, updateMe, uploadAvatar } from '../api/auth';
import { listMyComments, listMyLikes, getMySummary } from '../api/forum';
import { useSession } from '../lib/session';
import type { MyCommentListPage, MyLikeListPage, MySummaryResult, User } from '../types/api';

const emptySummary: MySummaryResult = {
  questionsCount: 0,
  commentsCount: 0,
  likesCount: 0,
};

const emptyComments: MyCommentListPage = {
  page: 1,
  page_size: 20,
  total: 0,
  records: [],
};

const emptyLikes: MyLikeListPage = {
  page: 1,
  page_size: 20,
  total: 0,
  records: [],
};

export function ProfilePage() {
  const session = useSession();
  const [user, setUser] = useState<User | null>(null);
  const [summary, setSummary] = useState(emptySummary);
  const [comments, setComments] = useState(emptyComments);
  const [likes, setLikes] = useState(emptyLikes);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!session) {
      return;
    }
    void loadProfile();
  }, [session]);

  async function loadProfile() {
    try {
      const [me, nextSummary, nextComments, nextLikes] = await Promise.all([
        getMe(),
        getMySummary(),
        listMyComments(),
        listMyLikes(),
      ]);
      setUser(me);
      setSummary(nextSummary);
      setComments(nextComments);
      setLikes(nextLikes);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '加载资料失败');
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) {
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const result = await updateMe({
        nickname: user.nickname,
        age: user.age,
        hobby: user.hobby,
        sign: user.sign,
      });
      setUser(result.user);
      setMessage(result.message);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleAvatarChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      await uploadAvatar(file);
      await loadProfile();
      setMessage('头像上传成功');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '头像上传失败');
    }
  }

  if (!session) {
    return (
      <section className="page-section narrow">
        <div className="legacy-empty-card">
          <h2>请先登录</h2>
          <p>这里对应旧版 `about.html`，以后资料、头像、我的评论、我的点赞都会统一走真实后端。</p>
          <Link className="legacy-action-button" to="/auth">
            去登录
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="about-content page-section">
      <div className="legacy-toolbar-card">
        <div>
          <h2>我的资料</h2>
          <p>这里对应旧版 `about.html`。当前已经接上真实头像、资料、我的评论、我的点赞和汇总统计。</p>
        </div>
        <div className="legacy-summary-strip">
          <span className="legacy-summary-chip">帖子 {summary.questionsCount}</span>
          <span className="legacy-summary-chip">评论 {summary.commentsCount}</span>
          <span className="legacy-summary-chip">点赞 {summary.likesCount}</span>
        </div>
      </div>

      {message ? <div className="legacy-feedback">{message}</div> : null}

      {user ? (
        <div className="legacy-grid two-column">
          <form className="legacy-panel" onSubmit={handleSubmit}>
            <img alt={user.nickname} className="legacy-profile-avatar" src={buildAssetUrl(user.avatar_path)} />
            <input accept=".png,.jpg,.jpeg,.gif" onChange={handleAvatarChange} type="file" />
            <div className="legacy-card-list" style={{ marginTop: 16 }}>
              <input onChange={(event) => setUser({ ...user, nickname: event.target.value })} placeholder="昵称" value={user.nickname} />
              <input
                onChange={(event) => setUser({ ...user, age: Number(event.target.value) || 0 })}
                placeholder="年龄"
                type="number"
                value={user.age}
              />
              <input onChange={(event) => setUser({ ...user, hobby: event.target.value })} placeholder="爱好" value={user.hobby} />
              <textarea onChange={(event) => setUser({ ...user, sign: event.target.value })} rows={4} value={user.sign} />
            </div>
            <button className="legacy-action-button" disabled={saving} style={{ marginTop: 16 }} type="submit">
              {saving ? '保存中...' : '保存资料'}
            </button>
          </form>

          <div className="legacy-card-list">
            <section className="legacy-panel">
              <h2>我的评论</h2>
              {comments.records.map((item) => (
                <div className="legacy-mini-card" key={item.id}>
                  <strong>QID {item.qid}</strong>
                  <p>{item.text}</p>
                  <span>{item.time}</span>
                </div>
              ))}
            </section>

            <section className="legacy-panel">
              <h2>我的点赞</h2>
              {likes.records.map((item) => (
                <div className="legacy-mini-card" key={item.id}>
                  <strong>{item.questionNickName || item.questionUser}</strong>
                  <p>{item.questionText}</p>
                  <span>{item.likedAt}</span>
                </div>
              ))}
            </section>
          </div>
        </div>
      ) : null}
    </section>
  );
}
