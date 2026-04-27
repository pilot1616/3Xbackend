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
  const [commentPage, setCommentPage] = useState(1);
  const [likePage, setLikePage] = useState(1);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [likesLoading, setLikesLoading] = useState(false);

  useEffect(() => {
    if (!session) {
      return;
    }
    void loadBaseProfile();
  }, [session]);

  useEffect(() => {
    if (!session) {
      return;
    }
    void loadCommentsPage(commentPage);
  }, [session, commentPage]);

  useEffect(() => {
    if (!session) {
      return;
    }
    void loadLikesPage(likePage);
  }, [session, likePage]);

  async function loadBaseProfile() {
    try {
      const [me, nextSummary] = await Promise.all([
        getMe(),
        getMySummary(),
      ]);
      setUser(me);
      setSummary(nextSummary);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '加载资料失败');
    }
  }

  async function loadCommentsPage(page: number) {
    setCommentsLoading(true);
    try {
      const nextComments = await listMyComments(page);
      setComments(nextComments);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '加载我的评论失败');
    } finally {
      setCommentsLoading(false);
    }
  }

  async function loadLikesPage(page: number) {
    setLikesLoading(true);
    try {
      const nextLikes = await listMyLikes(page);
      setLikes(nextLikes);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '加载我的点赞失败');
    } finally {
      setLikesLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) {
      return;
    }

    if (!user.nickname.trim()) {
      setMessage('昵称不能为空');
      return;
    }

    if (!Number.isInteger(user.age) || user.age < 0 || user.age > 120) {
      setMessage('年龄必须是 0 到 120 之间的整数');
      return;
    }

    setSaving(true);
    setMessage('');
    try {
      const result = await updateMe({
        nickname: user.nickname.trim(),
        age: user.age,
        hobby: user.hobby.trim(),
        sign: user.sign.trim(),
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

    const validTypes = ['image/png', 'image/jpeg', 'image/gif'];
    if (!validTypes.includes(file.type)) {
      setMessage('头像只支持 png、jpg、jpeg、gif');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setMessage('头像大小不能超过 5MB');
      return;
    }

    setAvatarUploading(true);
    setMessage('');
    try {
      await uploadAvatar(file);
      await loadBaseProfile();
      setMessage('头像上传成功');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '头像上传失败');
    } finally {
      setAvatarUploading(false);
    }
  }

  const totalCommentPages = Math.max(1, Math.ceil(comments.total / Math.max(1, comments.page_size)));
  const totalLikePages = Math.max(1, Math.ceil(likes.total / Math.max(1, likes.page_size)));

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
            {avatarUploading ? <div style={{ marginTop: 10, color: '#8d8d8d' }}>头像上传中...</div> : null}
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
              {commentsLoading ? <div className="legacy-empty-inline">正在加载我的评论...</div> : null}
              {!commentsLoading && comments.records.length === 0 ? <div className="legacy-empty-inline">你还没有发表过评论。</div> : null}
              {comments.records.map((item) => (
                <div className="legacy-mini-card" key={item.id}>
                  <strong>QID {item.qid}</strong>
                  <p>{item.text}</p>
                  <span>{item.time}</span>
                  <Link className="legacy-action-button secondary small" to={`/questions/${item.qid}`}>
                    查看原帖
                  </Link>
                </div>
              ))}
              {comments.total > comments.page_size ? (
                <div className="legacy-list-pagination">
                  <button className="legacy-action-button secondary small" disabled={commentsLoading || commentPage <= 1} onClick={() => setCommentPage((current) => current - 1)} type="button">
                    上一页
                  </button>
                  <span>
                    第 {commentPage} / {totalCommentPages} 页
                  </span>
                  <button
                    className="legacy-action-button secondary small"
                    disabled={commentsLoading || commentPage >= totalCommentPages}
                    onClick={() => setCommentPage((current) => current + 1)}
                    type="button"
                  >
                    下一页
                  </button>
                </div>
              ) : null}
            </section>

            <section className="legacy-panel">
              <h2>我的点赞</h2>
              {likesLoading ? <div className="legacy-empty-inline">正在加载我的点赞...</div> : null}
              {!likesLoading && likes.records.length === 0 ? <div className="legacy-empty-inline">你还没有点赞过任何帖子。</div> : null}
              {likes.records.map((item) => (
                <div className="legacy-mini-card" key={item.id}>
                  <strong>{item.questionNickName || item.questionUser}</strong>
                  <p>{item.questionText}</p>
                  <span>{item.likedAt}</span>
                  <Link className="legacy-action-button secondary small" to={`/questions/${item.qid}`}>
                    查看原帖
                  </Link>
                </div>
              ))}
              {likes.total > likes.page_size ? (
                <div className="legacy-list-pagination">
                  <button className="legacy-action-button secondary small" disabled={likesLoading || likePage <= 1} onClick={() => setLikePage((current) => current - 1)} type="button">
                    上一页
                  </button>
                  <span>
                    第 {likePage} / {totalLikePages} 页
                  </span>
                  <button
                    className="legacy-action-button secondary small"
                    disabled={likesLoading || likePage >= totalLikePages}
                    onClick={() => setLikePage((current) => current + 1)}
                    type="button"
                  >
                    下一页
                  </button>
                </div>
              ) : null}
            </section>
          </div>
        </div>
      ) : null}
    </section>
  );
}
