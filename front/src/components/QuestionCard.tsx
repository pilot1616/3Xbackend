import { FormEvent, useEffect, useState } from 'react';

import { buildAssetUrl } from '../api/client';
import { listQuestionLikes } from '../api/forum';
import type { LikeListPage, QuestionRecord } from '../types/api';

const emptyLikes: LikeListPage = {
  page: 1,
  page_size: 8,
  total: 0,
  records: [],
};

interface QuestionCardProps {
  question: QuestionRecord;
  compact?: boolean;
  canInteract?: boolean;
  submitting?: boolean;
  currentUsername?: string;
  onLikeToggle?: (question: QuestionRecord) => Promise<void> | void;
  onCommentSubmit?: (question: QuestionRecord, text: string) => Promise<void> | void;
  onCommentUpdate?: (question: QuestionRecord, commentID: number, text: string) => Promise<void> | void;
  onCommentDelete?: (question: QuestionRecord, commentID: number) => Promise<void> | void;
}

function isImage(fileName: string) {
  return /\.(png|jpg|jpeg|gif)$/i.test(fileName);
}

function avatarSrc(path?: string) {
  if (path) {
    return buildAssetUrl(path);
  }
  return '/legacy/res/img/userImgDefault.png';
}

export function QuestionCard({
  question,
  compact = false,
  canInteract = false,
  submitting = false,
  currentUsername,
  onLikeToggle,
  onCommentSubmit,
  onCommentUpdate,
  onCommentDelete,
}: QuestionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
  const [editingCommentText, setEditingCommentText] = useState('');
  const [likesOpen, setLikesOpen] = useState(false);
  const [likesLoading, setLikesLoading] = useState(false);
  const [likesMessage, setLikesMessage] = useState('');
  const [likesPage, setLikesPage] = useState(emptyLikes);

  useEffect(() => {
    if (!likesOpen) {
      return;
    }
    void loadLikes();
  }, [likesOpen, question.qid, question.likesNum]);

  async function handleCommentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = commentText.trim();
    if (!text || !onCommentSubmit) {
      return;
    }
    await onCommentSubmit(question, text);
    setCommentText('');
  }

  async function loadLikes() {
    setLikesLoading(true);
    setLikesMessage('');
    try {
      const result = await listQuestionLikes(question.qid, 1, 8);
      setLikesPage(result);
    } catch (err) {
      setLikesMessage(err instanceof Error ? err.message : '加载点赞列表失败');
    } finally {
      setLikesLoading(false);
    }
  }

  function startEditingComment(commentID: number, text: string) {
    setEditingCommentId(commentID);
    setEditingCommentText(text);
  }

  function cancelEditingComment() {
    setEditingCommentId(null);
    setEditingCommentText('');
  }

  async function handleCommentUpdate(commentID: number) {
    const nextText = editingCommentText.trim();
    if (!nextText || !onCommentUpdate) {
      return;
    }
    await onCommentUpdate(question, commentID, nextText);
    cancelEditingComment();
  }

  async function handleCommentDelete(commentID: number) {
    if (!onCommentDelete) {
      return;
    }
    const confirmed = window.confirm('确认删除这条评论吗？');
    if (!confirmed) {
      return;
    }
    await onCommentDelete(question, commentID);
    cancelEditingComment();
  }

  return (
    <div className="item-box forum-question-card">
      <div className="item">
        <div className="whisper-title">
          <i className="layui-icon layui-icon-friends" style={{ color: 'gray' }}></i>
          <span className="nickname">{question.nickName}</span>
          <br />
          <i className="layui-icon layui-icon-date"></i>
          <span className="hour">{question.time.split(' ')[1]?.slice(0, 5) ?? question.time}</span>
          <span className="date">{question.time.split(' ')[0] ?? ''}</span>
        </div>

        <p className="text-cont">{question.text}</p>

        {question.files.length > 0 ? (
          <div className="img-box forum-media-grid">
            {question.files.slice(0, compact ? 4 : question.files.length).map((fileName) =>
              isImage(fileName) ? (
                <img key={fileName} alt={fileName} src={buildAssetUrl(`/public/uploads/${fileName}`)} />
              ) : (
                <video key={fileName} controls src={buildAssetUrl(`/public/uploads/${fileName}`)} />
              ),
            )}
          </div>
        ) : null}

        <div className="forum-status-line">
          <span>{question.isUpload ? '已发布' : '未发布'}</span>
          <span>{question.ownedByMe ? '我的帖子' : `作者：${question.user}`}</span>
        </div>

        <div className="op-list">
          <p className={`like${question.likedByMe ? ' active' : ''}`} onClick={() => onLikeToggle?.(question)}>
            <i className="layui-icon layui-icon-praise"></i>
            <span>{question.likesNum}</span>
          </p>
          <p className="edit" onClick={() => setExpanded((current) => !current)}>
            <i className="layui-icon layui-icon-reply-fill"></i>
            <span>{question.commentsNum}</span>
          </p>
          <p className="off" onClick={() => setExpanded((current) => !current)}>
            <span>{expanded ? '收起' : '展开'}</span>
            <i className={`layui-icon ${expanded ? 'layui-icon-up' : 'layui-icon-down'}`}></i>
          </p>
        </div>

        <div className="forum-detail-toolbar">
          <button className="forum-inline-button" onClick={() => setLikesOpen((current) => !current)} type="button">
            {likesOpen ? '收起点赞列表' : `查看点赞列表 (${question.likesNum})`}
          </button>
        </div>

        {likesOpen ? (
          <div className="forum-like-panel">
            {likesMessage ? <div className="forum-empty-likes">{likesMessage}</div> : null}
            {likesLoading ? <div className="forum-empty-likes">正在加载点赞列表...</div> : null}
            {!likesLoading && likesPage.records.length === 0 && !likesMessage ? <div className="forum-empty-likes">暂时还没有人点赞。</div> : null}
            {likesPage.records.length > 0 ? (
              <div className="forum-like-list">
                {likesPage.records.map((item) => (
                  <div className="forum-like-chip" key={item.id}>
                    <strong>{item.nickName}</strong>
                    <span>{item.time}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {expanded ? (
        <div className="review-version">
          <div className="form">
            <img alt="avatar" className="now-header forum-comment-avatar" src={avatarSrc(question.avatarPath)} />
            <form className="layui-form" onSubmit={handleCommentSubmit}>
              <div className="layui-form-item layui-form-text">
                <div className="layui-input-block">
                  <textarea
                    className="layui-textarea"
                    disabled={!canInteract || submitting}
                    onChange={(event) => setCommentText(event.target.value)}
                    placeholder={canInteract ? '在这里评论' : '登录后可评论'}
                    value={commentText}
                  ></textarea>
                </div>
              </div>
              <div className="layui-form-item layui-form-item-btn">
                <div className="layui-input-block forum-comment-submit-wrap">
                  <button className="comment-upload-btn layui-btn" disabled={!canInteract || submitting} type="submit">
                    {submitting ? '提交中' : '确定'}
                  </button>
                </div>
              </div>
            </form>
          </div>

          <div className="list-cont">
            {question.comments.length === 0 ? <div className="forum-empty-comments">暂时还没有评论。</div> : null}
            {question.comments.map((comment) => (
              <div className="cont" key={comment.id}>
                <div className="img">
                  <img alt={comment.nickName} className="header-img" src="/legacy/res/img/userImgDefault.png" />
                </div>
                <div className="text">
                  <p className="tit">
                    <span className="name">{comment.nickName}</span>
                    <span className="data">{comment.time}</span>
                  </p>
                  {editingCommentId === comment.id ? (
                    <div className="forum-comment-editor">
                      <textarea onChange={(event) => setEditingCommentText(event.target.value)} rows={3} value={editingCommentText}></textarea>
                      <div className="forum-comment-actions">
                        <button className="legacy-action-button small" disabled={submitting} onClick={() => void handleCommentUpdate(comment.id)} type="button">
                          {submitting ? '保存中...' : '保存'}
                        </button>
                        <button className="legacy-action-button secondary small" disabled={submitting} onClick={cancelEditingComment} type="button">
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="ct">{comment.text}</p>
                      {canInteract && currentUsername === comment.user ? (
                        <div className="forum-comment-actions">
                          <button className="forum-inline-button" onClick={() => startEditingComment(comment.id, comment.text)} type="button">
                            编辑评论
                          </button>
                          <button className="forum-inline-button danger" onClick={() => void handleCommentDelete(comment.id)} type="button">
                            删除评论
                          </button>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
