import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { buildAssetUrl } from '../api/client';
import { getMe, updateMe, uploadAvatar } from '../api/auth';
import { getMySummary, listMyComments, listMyLikes, listMyQuestions } from '../api/forum';
import { updateSessionUser, useSession } from '../lib/session';
import type { MyCommentListPage, MyLikeListPage, MySummaryResult, QuestionListPage, User } from '../types/api';

const maxAvatarSize = 5 * 1024 * 1024;

function buildExcerpt(text: string | undefined, fallback: string, maxLength = 88) {
  const content = (text ?? '').trim();
  if (!content) {
    return fallback;
  }
  if (content.length <= maxLength) {
    return content;
  }
  return `${content.slice(0, maxLength).trimEnd()}...`;
}

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

type EditableProfileSnapshot = Pick<User, 'nickname' | 'age' | 'hobby' | 'sign'>;

function toEditableProfileSnapshot(user: User): EditableProfileSnapshot {
  return {
    nickname: user.nickname,
    age: user.age,
    hobby: user.hobby,
    sign: user.sign,
  };
}

export function ProfilePage() {
  const session = useSession();
  const [user, setUser] = useState<User | null>(null);
  const [summary, setSummary] = useState(emptySummary);
  const [comments, setComments] = useState(emptyComments);
  const [likes, setLikes] = useState(emptyLikes);
  const [questions, setQuestions] = useState(emptyQuestions);
  const [savedProfile, setSavedProfile] = useState<EditableProfileSnapshot | null>(null);
  const [commentPage, setCommentPage] = useState(1);
  const [likePage, setLikePage] = useState(1);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [likesLoading, setLikesLoading] = useState(false);
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

  useEffect(() => {
    if (!user || !savedProfile || viewMode !== 'edit') {
      return;
    }

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (!isProfileDirty) {
        return;
      }
      event.preventDefault();
      event.returnValue = '';
    }

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [savedProfile, user, viewMode]);

  async function loadBaseProfile() {
    try {
      const [me, nextSummary, nextQuestions] = await Promise.all([getMe(), getMySummary(), listMyQuestions({ page: 1, pageSize: 6, sort: 'latest' })]);
      setUser(me);
      setSavedProfile(toEditableProfileSnapshot(me));
      setSummary(nextSummary);
      setQuestions(nextQuestions);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '加载资料失败');
    }
  }

  async function loadCommentsPage(page: number, keyword: string) {
    setCommentsLoading(true);
    try {
      const nextComments = await listMyComments(page, 20, keyword);
      setComments(nextComments);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '加载我的评论失败');
    } finally {
      setCommentsLoading(false);
    }
  }

  async function loadLikesPage(page: number, keyword: string) {
    setLikesLoading(true);
    try {
      const nextLikes = await listMyLikes(page, 20, keyword);
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
      setSavedProfile(toEditableProfileSnapshot(result.user));
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
      setSavedProfile(toEditableProfileSnapshot(me));
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
  const isProfileDirty = Boolean(user && savedProfile && JSON.stringify(toEditableProfileSnapshot(user)) !== JSON.stringify(savedProfile));
  const commentScopeHint = commentsLoading
    ? '正在同步你的评论记录。'
    : commentKeyword
      ? `当前仅展示评论内容匹配“${commentKeyword}”的记录。`
      : '当前展示你发表过的全部评论记录，可按评论内容关键字筛选。';
  const likeScopeHint = likesLoading
    ? '正在同步你的点赞记录。'
    : likeKeyword
      ? `当前仅展示原帖内容匹配“${likeKeyword}”的点赞记录。`
      : '当前展示你点赞过的全部帖子记录，可按原帖内容关键字筛选。';

  function handleReturnToShow() {
    if (isProfileDirty) {
      const confirmed = window.confirm('当前资料修改还没有保存，确认放弃这些改动吗？');
      if (!confirmed) {
        return;
      }
      if (user && savedProfile) {
        setUser({ ...user, ...savedProfile });
      }
    }
    setViewMode('show');
  }

  function handleResetProfileChanges() {
    if (!user || !savedProfile) {
      return;
    }
    setUser({ ...user, ...savedProfile });
    setMessage('已撤销未保存的资料修改');
  }

  function scrollToSection(section: 'questions' | 'comments' | 'likes') {
    const targetId = `profile-${section}`;
    const target = document.getElementById(targetId);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  if (!session) {
    return (
      <div className="legacy-gated-scene" id="noLogined">
        <div className="legacy-gated-card" id="loginReminder">
          <span className="legacy-home-stage-kicker">Access Required</span>
          <h2>请登录</h2>
          <p>当前页面需要登录才能访问，请先登录。</p>
          <Link className="legacy-action-button" to="/auth?redirect=/profile">
            去登录
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="about-content profile-scene">
      <div className="w1000 legacy-profile-page">
        {message ? <div className="legacy-feedback legacy-home-feedback">{message}</div> : null}

        {user ? (
          <>
            <div className="legacy-profile-stage">
              <div className="legacy-profile-stage-copy">
                <span className="legacy-home-stage-kicker">3X Personal Hub</span>
                <h2>把你的资料、互动和历史内容集中到一块个人工作台</h2>
                <p>这里承接头像、个人信息、最近帖子、评论和点赞记录，帮助你在同一块空间里回看自己的社区轨迹。</p>
                <div className="legacy-summary-strip legacy-profile-stage-actions">
                  <button className="legacy-action-button secondary small" onClick={() => setViewMode('edit')} type="button">
                    编辑资料
                  </button>
                  <button className="legacy-action-button secondary small" onClick={() => scrollToSection('questions')} type="button">
                    最近帖子
                  </button>
                  <button className="legacy-action-button secondary small" onClick={() => scrollToSection('comments')} type="button">
                    我的评论
                  </button>
                  <button className="legacy-action-button secondary small" onClick={() => scrollToSection('likes')} type="button">
                    我的点赞
                  </button>
                </div>
              </div>
              <div className="legacy-profile-stage-metrics">
                <article className="legacy-home-stage-card">
                  <strong>{summary.questionsCount}</strong>
                  <span>发布帖子</span>
                </article>
                <article className="legacy-home-stage-card">
                  <strong>{summary.commentsCount}</strong>
                  <span>参与评论</span>
                </article>
                <article className="legacy-home-stage-card">
                  <strong>{summary.likesCount}</strong>
                  <span>累计点赞</span>
                </article>
              </div>
            </div>

            <div className={`item info legacy-profile-panel${viewMode === 'show' ? '' : ' is-hidden'}`} id="showInfo">
              <div className="title">
                <h3>我的介绍</h3>
              </div>
              <div className="cont legacy-profile-info-wrap">
                <img alt={user.nickname} className="legacy-profile-avatar-preview" id="showUserImg" src={buildAssetUrl(user.avatar_path)} />
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
              <button className="layui-btn layui-btn-normal layui-btn-radius legacy-profile-toggle" id="gotoEdit" onClick={() => setViewMode('edit')} type="button">
                编辑信息
              </button>
            </div>

            <div className={`item info legacy-profile-panel legacy-profile-editor${viewMode === 'edit' ? '' : ' is-hidden'}`} id="editInfo">
              <div className="layui-form-item legacy-profile-upload-col">
                <h3>个人头像</h3>
                <div className="layui-input-inline sortable-container legacy-sortable-container">
                  <img alt={user.nickname} className="legacy-profile-avatar-preview" id="userImg" src={buildAssetUrl(user.avatar_path)} />
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
                  <div className="layui-input-block legacy-profile-form-actions">
                    {isProfileDirty ? (
                      <button className="layui-btn legacy-profile-reset-button" onClick={handleResetProfileChanges} type="button">
                        撤销修改
                      </button>
                    ) : null}
                    <button className="layui-btn" disabled={saving} type="submit">
                      {saving ? '保存中...' : '保存'}
                    </button>
                  </div>
                </div>
              </form>

              <button className="layui-btn layui-btn-normal layui-btn-radius legacy-profile-toggle" id="gotoShow" onClick={handleReturnToShow} type="button">
                显示信息
              </button>
            </div>

            <div className="legacy-profile-records">
              <section className="item info legacy-record-panel" id="profile-questions">
                <div className="title">
                  <h3>最近帖子</h3>
                </div>
                <div className="legacy-card-list">
                  {questions.records.length === 0 ? <div className="legacy-empty-inline">你还没有发布过帖子。</div> : null}
                  {questions.records.map((item) => (
                    <div className="legacy-mini-card" key={item.qid}>
                      <div className="legacy-mini-card-header">
                        <strong className="legacy-mini-card-title">QID {item.qid}</strong>
                        <div className="legacy-mini-card-badges">
                          <span className={`legacy-mini-card-badge ${item.isUpload ? 'is-published' : 'is-draft'}`}>{item.isUpload ? '已发布' : '未发布'}</span>
                        </div>
                      </div>
                      <p className="legacy-mini-card-main" title={item.text}>
                        {buildExcerpt(item.text, '该帖子暂无正文内容。')}
                      </p>
                      <div className="legacy-mini-card-meta">
                        <span>点赞 {item.likesNum}</span>
                        <span>评论 {item.commentsNum}</span>
                        <span>{item.time}</span>
                      </div>
                      <div className="legacy-mini-card-footer">
                        <Link className="legacy-action-button secondary small" to={`/questions/${item.qid}`}>
                          查看详情
                        </Link>
                      </div>
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

              <section className="item info legacy-record-panel" id="profile-comments">
                <div className="title">
                  <h3>我的评论</h3>
                </div>
                <div className="legacy-card-list">
                  <div className="legacy-home-result-summary legacy-home-status-card">
                    <div className="legacy-home-result-copy">
                      <span className="legacy-home-stage-kicker">Comment Scope</span>
                      <strong>我的评论 · {comments.total} 条记录</strong>
                      <p>{commentScopeHint}</p>
                    </div>
                    <div className="legacy-summary-strip">
                      <span className="legacy-summary-chip">当前页 {comments.records.length}</span>
                      <span className="legacy-summary-chip">第 {commentPage} / {totalCommentPages} 页</span>
                      {commentKeyword ? <span className="legacy-summary-chip">关键字：{commentKeyword}</span> : null}
                    </div>
                  </div>

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

                  {comments.total > 0 ? (
                    <div className="legacy-home-load-status">
                      <span>
                        共 {comments.total} 条评论，当前第 {commentPage} / {totalCommentPages} 页，本页 {comments.records.length} 条
                      </span>
                      <button className="legacy-action-button secondary small" disabled={commentsLoading} onClick={() => void loadCommentsPage(commentPage, commentKeyword)} type="button">
                        {commentsLoading ? '刷新中...' : '刷新评论记录'}
                      </button>
                    </div>
                  ) : null}

                  {commentKeyword ? (
                    <div className="legacy-active-filters">
                      <button className="legacy-summary-chip legacy-summary-chip-button" onClick={handleCommentFilterReset} type="button">
                        关键字：{commentKeyword} ×
                      </button>
                    </div>
                  ) : null}

                  {commentsLoading ? <div className="legacy-empty-inline">正在加载评论记录...</div> : null}
                  {!commentsLoading && comments.records.length === 0 ? <div className="legacy-empty-inline">{commentKeyword ? '没有匹配的评论。' : '你还没有发表过评论。'}</div> : null}
                  {comments.records.map((item) => (
                    <div className="legacy-mini-card" key={item.id}>
                      <div className="legacy-mini-card-header">
                        <strong className="legacy-mini-card-title">评论于帖子 #{item.qid}</strong>
                      </div>
                      <p className="legacy-mini-card-quote" title={item.questionText || ''}>
                        原帖摘要：{buildExcerpt(item.questionText, '原帖摘要暂不可用。', 72)}
                      </p>
                      <p className="legacy-mini-card-main" title={item.text}>
                        我的评论：{buildExcerpt(item.text, '该评论内容为空。', 72)}
                      </p>
                      <div className="legacy-mini-card-meta">
                        <span>{item.time}</span>
                      </div>
                      <div className="legacy-mini-card-footer">
                        <Link className="legacy-action-button secondary small" to={`/questions/${item.qid}`}>
                          查看原帖
                        </Link>
                      </div>
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
                      <button className="legacy-action-button secondary small" disabled={commentsLoading || commentPage >= totalCommentPages} onClick={() => setCommentPage((current) => current + 1)} type="button">
                        下一页
                      </button>
                    </div>
                  ) : null}
                </div>
              </section>

              <section className="item info legacy-record-panel" id="profile-likes">
                <div className="title">
                  <h3>我的点赞</h3>
                </div>
                <div className="legacy-card-list">
                  <div className="legacy-home-result-summary legacy-home-status-card">
                    <div className="legacy-home-result-copy">
                      <span className="legacy-home-stage-kicker">Like Scope</span>
                      <strong>我的点赞 · {likes.total} 条记录</strong>
                      <p>{likeScopeHint}</p>
                    </div>
                    <div className="legacy-summary-strip">
                      <span className="legacy-summary-chip">当前页 {likes.records.length}</span>
                      <span className="legacy-summary-chip">第 {likePage} / {totalLikePages} 页</span>
                      {likeKeyword ? <span className="legacy-summary-chip">关键字：{likeKeyword}</span> : null}
                    </div>
                  </div>

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

                  {likes.total > 0 ? (
                    <div className="legacy-home-load-status">
                      <span>
                        共 {likes.total} 条点赞，当前第 {likePage} / {totalLikePages} 页，本页 {likes.records.length} 条
                      </span>
                      <button className="legacy-action-button secondary small" disabled={likesLoading} onClick={() => void loadLikesPage(likePage, likeKeyword)} type="button">
                        {likesLoading ? '刷新中...' : '刷新点赞记录'}
                      </button>
                    </div>
                  ) : null}

                  {likeKeyword ? (
                    <div className="legacy-active-filters">
                      <button className="legacy-summary-chip legacy-summary-chip-button" onClick={handleLikeFilterReset} type="button">
                        关键字：{likeKeyword} ×
                      </button>
                    </div>
                  ) : null}

                  {likesLoading ? <div className="legacy-empty-inline">正在加载点赞记录...</div> : null}
                  {!likesLoading && likes.records.length === 0 ? <div className="legacy-empty-inline">{likeKeyword ? '没有匹配的点赞记录。' : '你还没有点赞过任何帖子。'}</div> : null}
                  {likes.records.map((item) => (
                    <div className="legacy-mini-card" key={item.id}>
                      <div className="legacy-mini-card-header">
                        <strong className="legacy-mini-card-title">{item.questionNickName || item.questionUser || `帖子 #${item.qid}`}</strong>
                        <div className="legacy-mini-card-badges">
                          <span className={`legacy-mini-card-badge ${item.isUpload ? 'is-published' : 'is-draft'}`}>{item.isUpload ? '已发布' : '未发布'}</span>
                        </div>
                      </div>
                      <p className="legacy-mini-card-main" title={item.questionText || ''}>
                        {buildExcerpt(item.questionText, '该帖子正文暂不可用。')}
                      </p>
                      <div className="legacy-mini-card-meta">
                        <span>点赞于 {item.likedAt}</span>
                        <span>总点赞 {item.likesNum}</span>
                        <span>总评论 {item.commentsNum}</span>
                      </div>
                      <div className="legacy-mini-card-footer">
                        <Link className="legacy-action-button secondary small" to={`/questions/${item.qid}`}>
                          查看原帖
                        </Link>
                      </div>
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
                      <button className="legacy-action-button secondary small" disabled={likesLoading || likePage >= totalLikePages} onClick={() => setLikePage((current) => current + 1)} type="button">
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
