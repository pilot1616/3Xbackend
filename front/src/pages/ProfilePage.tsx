import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { buildAssetUrl } from '../api/client';
import { getMe, updateMe, uploadAvatar } from '../api/auth';
import { getMySummary, listMyComments, listMyLikes, listMyQuestions } from '../api/forum';
import { updateSessionUser, useSession } from '../lib/session';
import type { MyCommentListPage, MyLikeListPage, MySummaryResult, QuestionListPage, User } from '../types/api';

const maxAvatarSize = 5 * 1024 * 1024;

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

const emptyQuestions: QuestionListPage = {
  page: 1,
  page_size: 6,
  total: 0,
  records: [],
};

export function ProfilePage() {
  const session = useSession();
  const [user, setUser] = useState<User | null>(null);
  const [summary, setSummary] = useState(emptySummary);
  const [comments, setComments] = useState(emptyComments);
  const [likes, setLikes] = useState(emptyLikes);
  const [questions, setQuestions] = useState(emptyQuestions);
  const [commentPage, setCommentPage] = useState(1);
  const [likePage, setLikePage] = useState(1);
  const [commentKeyword, setCommentKeyword] = useState('');
  const [commentKeywordInput, setCommentKeywordInput] = useState('');
  const [likeKeyword, setLikeKeyword] = useState('');
  const [likeKeywordInput, setLikeKeywordInput] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [viewMode, setViewMode] = useState<'show' | 'edit'>('show');

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
    void loadCommentsPage(commentPage, commentKeyword);
  }, [session, commentPage, commentKeyword]);

  useEffect(() => {
    if (!session) {
      return;
    }
    void loadLikesPage(likePage, likeKeyword);
  }, [session, likePage, likeKeyword]);

  async function loadBaseProfile() {
    try {
      const [me, nextSummary, nextQuestions] = await Promise.all([getMe(), getMySummary(), listMyQuestions({ page: 1, pageSize: 6, sort: 'latest' })]);
      setUser(me);
      setSummary(nextSummary);
      setQuestions(nextQuestions);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '加载资料失败');
    }
  }

  async function loadCommentsPage(page: number, keyword: string) {
    try {
      const nextComments = await listMyComments(page, 20, keyword);
      setComments(nextComments);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '加载我的评论失败');
    }
  }

  async function loadLikesPage(page: number, keyword: string) {
    try {
      const nextLikes = await listMyLikes(page, 20, keyword);
      setLikes(nextLikes);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '加载我的点赞失败');
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
      updateSessionUser(result.user);
      setMessage(result.message);
      setViewMode('show');
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
    if (file.size > maxAvatarSize) {
      setMessage('头像文件不能超过 5MB');
      return;
    }

    setAvatarUploading(true);
    setMessage('');
    try {
      await uploadAvatar(file);
      const me = await getMe();
      setUser(me);
      updateSessionUser(me);
      setMessage('头像上传成功');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '头像上传失败');
    } finally {
      setAvatarUploading(false);
    }
  }

  function handleCommentFilterSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextKeyword = commentKeywordInput.trim();
    if (commentPage !== 1) {
      setCommentPage(1);
    }
    if (nextKeyword !== commentKeyword) {
      setCommentKeyword(nextKeyword);
      return;
    }
    void loadCommentsPage(1, nextKeyword);
  }

  function handleCommentFilterReset() {
    setCommentKeywordInput('');
    if (commentPage !== 1) {
      setCommentPage(1);
    }
    if (commentKeyword !== '') {
      setCommentKeyword('');
      return;
    }
    void loadCommentsPage(1, '');
  }

  function handleLikeFilterSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextKeyword = likeKeywordInput.trim();
    if (likePage !== 1) {
      setLikePage(1);
    }
    if (nextKeyword !== likeKeyword) {
      setLikeKeyword(nextKeyword);
      return;
    }
    void loadLikesPage(1, nextKeyword);
  }

  function handleLikeFilterReset() {
    setLikeKeywordInput('');
    if (likePage !== 1) {
      setLikePage(1);
    }
    if (likeKeyword !== '') {
      setLikeKeyword('');
      return;
    }
    void loadLikesPage(1, '');
  }

  const totalCommentPages = Math.max(1, Math.ceil(comments.total / Math.max(1, comments.page_size)));
  const totalLikePages = Math.max(1, Math.ceil(likes.total / Math.max(1, likes.page_size)));

  if (!session) {
    return (
      <div id="noLogined">
        <div id="loginReminder" style={{ textAlign: 'center', padding: 50 }}>
          <h2>请登录</h2>
          <p>当前页面需要登录才能访问，请先登录。</p>
          <Link className="legacy-action-button" to="/auth">
            去登录
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="about-content">
      <div className="w1000 legacy-profile-page">
        {message ? <div className="legacy-feedback legacy-home-feedback">{message}</div> : null}

        {user ? (
          <>
            <div className="item info" id="showInfo" style={{ display: viewMode === 'show' ? 'block' : 'none', position: 'relative' }}>
              <div className="title">
                <h3>我的介绍</h3>
              </div>
              <div className="cont legacy-profile-info-wrap">
                <img alt={user.nickname} id="showUserImg" src={buildAssetUrl(user.avatar_path)} style={{ borderRadius: 20, maxWidth: 300 }} />
                <div className="per-info">
                  <p>
                    昵称：<span className="name">{user.nickname || '无'}</span>
                    <br />
                    年龄：<span className="age">{user.age || 0}</span>
                    <br />
                    爱好：<span className="interest">{user.hobby || '无'}</span>
                    <br />
                    签名档：<span className="Career">{user.sign || '无'}</span>
                    <br />
                  </p>
                  <div className="legacy-summary-strip legacy-profile-summary">
                    <span className="legacy-summary-chip">帖子 {summary.questionsCount}</span>
                    <span className="legacy-summary-chip">评论 {summary.commentsCount}</span>
                    <span className="legacy-summary-chip">点赞 {summary.likesCount}</span>
                  </div>
                </div>
              </div>
              <button className="layui-btn layui-btn-normal layui-btn-radius" id="gotoEdit" onClick={() => setViewMode('edit')} style={{ position: 'absolute', right: 0, top: 0 }} type="button">
                编辑信息
              </button>
            </div>

            <div className="item info" id="editInfo" style={{ display: viewMode === 'edit' ? 'flex' : 'none', position: 'relative' }}>
              <div className="layui-form-item legacy-profile-upload-col">
                <h3>个人头像</h3>
                <div className="layui-input-inline sortable-container legacy-sortable-container">
                  <img alt={user.nickname} id="userImg" src={buildAssetUrl(user.avatar_path)} style={{ borderRadius: 20, maxWidth: 300 }} />
                  <label className="upload-dragger" htmlFor="upload-input">
                    <svg className="upload-icon" height="65" viewBox="0 0 1024 1024" width="65">
                      <path d="M815.104 363.008a307.2 307.2 0 0 0-606.72 0A256 256 0 0 0 256 870.4h204.8v-204.8H358.4l153.6-204.8 153.6 204.8h-102.4v204.8h204.8a256 256 0 0 0 47.104-507.392z" fill="#8a8a8a"></path>
                    </svg>
                    <span className="upload-text">点击上传</span>
                    <span className="upload-text">或拖拽文件到此处</span>
                  </label>
                  <input accept=".png,.jpg,.jpeg,.gif" id="upload-input" onChange={handleAvatarChange} type="file" />
                  {avatarUploading ? <div className="legacy-upload-hint">头像上传中...</div> : null}
                </div>
              </div>

              <form className="layui-form layui-form-pane legacy-profile-form" onSubmit={handleSubmit}>
                <div className="layui-form-item">
                  <label className="layui-form-label">昵称</label>
                  <div className="layui-input-inline">
                    <input className="layui-input" onChange={(event) => setUser({ ...user, nickname: event.target.value })} placeholder="请输入昵称" type="text" value={user.nickname} />
                  </div>
                </div>
                <div className="layui-form-item">
                  <label className="layui-form-label">年龄</label>
                  <div className="layui-input-inline">
                    <input
                      className="layui-input"
                      onChange={(event) => setUser({ ...user, age: Number(event.target.value) || 0 })}
                      placeholder="请输入年龄"
                      type="number"
                      value={user.age}
                    />
                  </div>
                </div>
                <div className="layui-form-item">
                  <label className="layui-form-label">爱好</label>
                  <div className="layui-input-inline">
                    <input className="layui-input" onChange={(event) => setUser({ ...user, hobby: event.target.value })} placeholder="请输入爱好" type="text" value={user.hobby} />
                  </div>
                </div>
                <div className="layui-form-item">
                  <label className="layui-form-label">签名档</label>
                  <div className="layui-input-inline">
                    <textarea className="layui-textarea" onChange={(event) => setUser({ ...user, sign: event.target.value })} placeholder="请输入签名档" value={user.sign}></textarea>
                  </div>
                </div>
                <div className="layui-form-item">
                  <div className="layui-input-block">
                    <button className="layui-btn" disabled={saving} type="submit">
                      {saving ? '保存中...' : '保存'}
                    </button>
                  </div>
                </div>
              </form>

              <button className="layui-btn layui-btn-normal layui-btn-radius" id="gotoShow" onClick={() => setViewMode('show')} style={{ position: 'absolute', top: 0, right: 0 }} type="button">
                显示信息
              </button>
            </div>

            <div className="legacy-profile-records">
              <section className="item info legacy-record-panel">
                <div className="title">
                  <h3>最近帖子</h3>
                </div>
                <div className="legacy-card-list">
                  {questions.records.length === 0 ? <div className="legacy-empty-inline">你还没有发布过帖子。</div> : null}
                  {questions.records.map((item) => (
                    <div className="legacy-mini-card" key={item.qid}>
                      <strong>{item.isUpload ? '已发布' : '未发布'}</strong>
                      <p>{item.text}</p>
                      <span>{item.time}</span>
                      <Link className="legacy-action-button secondary small" to={`/questions/${item.qid}`}>
                        查看详情
                      </Link>
                    </div>
                  ))}
                  {questions.total > questions.records.length ? (
                    <div className="legacy-list-pagination">
                      <span>已展示最近 {questions.records.length} / {questions.total} 条帖子</span>
                      <Link className="legacy-action-button secondary small" to="/publish">
                        去管理全部帖子
                      </Link>
                    </div>
                  ) : null}
                </div>
              </section>

              <section className="item info legacy-record-panel">
                <div className="title">
                  <h3>我的评论</h3>
                </div>
                <div className="legacy-card-list">
                  <form className="legacy-home-filter-row legacy-publish-filter-row" onSubmit={handleCommentFilterSubmit}>
                    <input onChange={(event) => setCommentKeywordInput(event.target.value)} placeholder="按评论内容关键字筛选" value={commentKeywordInput} />
                    <div className="legacy-home-filter-actions">
                      <button className="legacy-action-button small" type="submit">
                        搜索评论
                      </button>
                      <button className="legacy-action-button secondary small" onClick={handleCommentFilterReset} type="button">
                        重置
                      </button>
                    </div>
                  </form>

                  {comments.records.length === 0 ? <div className="legacy-empty-inline">{commentKeyword ? '没有匹配的评论。' : '你还没有发表过评论。'}</div> : null}
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
                      <button className="legacy-action-button secondary small" disabled={commentPage <= 1} onClick={() => setCommentPage((current) => current - 1)} type="button">
                        上一页
                      </button>
                      <span>
                        第 {commentPage} / {totalCommentPages} 页
                      </span>
                      <button className="legacy-action-button secondary small" disabled={commentPage >= totalCommentPages} onClick={() => setCommentPage((current) => current + 1)} type="button">
                        下一页
                      </button>
                    </div>
                  ) : null}
                </div>
              </section>

              <section className="item info legacy-record-panel">
                <div className="title">
                  <h3>我的点赞</h3>
                </div>
                <div className="legacy-card-list">
                  <form className="legacy-home-filter-row legacy-publish-filter-row" onSubmit={handleLikeFilterSubmit}>
                    <input onChange={(event) => setLikeKeywordInput(event.target.value)} placeholder="按帖子内容关键字筛选" value={likeKeywordInput} />
                    <div className="legacy-home-filter-actions">
                      <button className="legacy-action-button small" type="submit">
                        搜索点赞
                      </button>
                      <button className="legacy-action-button secondary small" onClick={handleLikeFilterReset} type="button">
                        重置
                      </button>
                    </div>
                  </form>

                  {likes.records.length === 0 ? <div className="legacy-empty-inline">{likeKeyword ? '没有匹配的点赞记录。' : '你还没有点赞过任何帖子。'}</div> : null}
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
                      <button className="legacy-action-button secondary small" disabled={likePage <= 1} onClick={() => setLikePage((current) => current - 1)} type="button">
                        上一页
                      </button>
                      <span>
                        第 {likePage} / {totalLikePages} 页
                      </span>
                      <button className="legacy-action-button secondary small" disabled={likePage >= totalLikePages} onClick={() => setLikePage((current) => current + 1)} type="button">
                        下一页
                      </button>
                    </div>
                  ) : null}
                </div>
              </section>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
