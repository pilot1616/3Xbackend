import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { buildAssetUrl, buildUploadAssetUrl } from '../api/client';
import { listQuestionComments, listQuestionLikes } from '../api/forum';
import { LegacyIcon } from './LegacyIcon';
import type { CommentListPage, LikeListPage, QuestionRecord } from '../types/api';

const emptyComments: CommentListPage = {
  page: 1,
  page_size: 10,
  total: 0,
  records: [],
};

const emptyLikes: LikeListPage = {
  page: 1,
  page_size: 8,
  total: 0,
  records: [],
};

interface QuestionCardProps {
  question: QuestionRecord;
  compact?: boolean;
  detailPageOnly?: boolean;
  expandedByDefault?: boolean;
  canInteract?: boolean;
  submitting?: boolean;
  currentUsername?: string;
  viewerAvatarPath?: string;
  detailHref?: string;
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
  detailPageOnly = false,
  expandedByDefault = false,
  canInteract = false,
  submitting = false,
  currentUsername,
  viewerAvatarPath,
  detailHref,
  onLikeToggle,
  onCommentSubmit,
  onCommentUpdate,
  onCommentDelete,
}: QuestionCardProps) {
  const [expanded, setExpanded] = useState(expandedByDefault);
  const [commentText, setCommentText] = useState('');
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
  const [editingCommentText, setEditingCommentText] = useState('');
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsMessage, setCommentsMessage] = useState('');
  const [commentsPage, setCommentsPage] = useState<CommentListPage>(emptyComments);
  const [likesOpen, setLikesOpen] = useState(false);
  const [likesLoading, setLikesLoading] = useState(false);
  const [likesMessage, setLikesMessage] = useState('');
  const [likesPage, setLikesPage] = useState(emptyLikes);
  const [previewFile, setPreviewFile] = useState<string | null>(null);

  useEffect(() => {
    if (!expanded) {
      return;
    }
    void loadComments(1);
  }, [expanded, question.qid]);

  useEffect(() => {
    setExpanded(expandedByDefault);
  }, [expandedByDefault, question.qid]);

  useEffect(() => {
    if (!likesOpen) {
      return;
    }
    void loadLikes(1);
  }, [likesOpen, question.qid, question.likesNum]);

  useEffect(() => {
    setPreviewFile(null);
  }, [question.qid]);

  useEffect(() => {
    if (!previewFile) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setPreviewFile(null);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewFile]);

  async function handleCommentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = commentText.trim();
    if (!text || !onCommentSubmit) {
      return;
    }
    await onCommentSubmit(question, text);
    setCommentText('');
    await loadComments(1);
  }

  async function loadComments(page = 1) {
    setCommentsLoading(true);
    setCommentsMessage('');
    try {
      const result = await listQuestionComments(question.qid, page, 10);
      setCommentsPage(result);
    } catch (err) {
      setCommentsMessage(err instanceof Error ? err.message : '加载评论失败');
    } finally {
      setCommentsLoading(false);
    }
  }

  async function loadLikes(page = 1) {
    setLikesLoading(true);
    setLikesMessage('');
    try {
      const result = await listQuestionLikes(question.qid, page, 8);
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
    await loadComments(commentsPage.page || 1);
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
    await loadComments(1);
  }

  const totalCommentPages = Math.max(1, Math.ceil((commentsPage.total || 0) / Math.max(1, commentsPage.page_size || 10)));
  const totalLikePages = Math.max(1, Math.ceil((likesPage.total || 0) / Math.max(1, likesPage.page_size || 8)));
  const visibleFiles = question.files.slice(0, compact ? 4 : question.files.length);

  return (
    <div className="item-box forum-question-card">
      <div className="item">
        <div className="whisper-title">
          <div className="forum-title-bar">
            <img alt={question.nickName} className="forum-title-avatar" src={avatarSrc(question.avatarPath)} />
            <div className="forum-title-meta">
              <div className="forum-title-name-row">
                <LegacyIcon name="friends" size={16} style={{ color: 'gray' }} />
                <span className="nickname">{question.nickName}</span>
              </div>
              <div className="forum-title-time-row">
                <LegacyIcon name="date" size={16} />
                <span className="hour">{question.time.split(' ')[1]?.slice(0, 5) ?? question.time}</span>
                <span className="date">{question.time.split(' ')[0] ?? ''}</span>
              </div>
            </div>
          </div>
        </div>

        <p className="text-cont">{question.text}</p>

        {question.files.length > 0 ? (
          <div className="img-box forum-media-grid">
            {visibleFiles.map((fileName) => (
              <button className="forum-media-trigger" key={fileName} onClick={() => setPreviewFile(fileName)} type="button">
                {isImage(fileName) ? <img alt={fileName} src={buildUploadAssetUrl(fileName)} /> : <video muted src={buildUploadAssetUrl(fileName)} />}
              </button>
            ))}
          </div>
        ) : null}

        <div className="forum-status-line">
          <span>{question.isUpload ? '已发布' : '未发布'}</span>
          <span>{question.ownedByMe ? '我的帖子' : `作者：${question.user}`}</span>
        </div>

        <div className="op-list">
          <button className={`forum-op-button like${question.likedByMe ? ' active' : ''}`} disabled={submitting} onClick={() => onLikeToggle?.(question)} type="button">
            <LegacyIcon name="praise" size={16} />
            <span>{question.likesNum}</span>
          </button>
          {detailPageOnly && detailHref ? (
            <Link className="edit forum-summary-link" to={detailHref}>
              <LegacyIcon name="reply-fill" size={16} />
              <span>{question.commentsNum}</span>
            </Link>
          ) : (
            <button className="forum-op-button edit" disabled={submitting} onClick={() => setExpanded((current) => !current)} type="button">
              <LegacyIcon name="reply-fill" size={16} />
              <span>{question.commentsNum}</span>
            </button>
          )}
          {detailPageOnly && detailHref ? (
            <Link className="off forum-summary-link" to={detailHref}>
              <span>进入详情</span>
              <LegacyIcon name="right" size={16} />
            </Link>
          ) : (
            <button className="forum-op-button off" disabled={submitting} onClick={() => setExpanded((current) => !current)} type="button">
              <span>{expanded ? '收起' : '展开'}</span>
              <LegacyIcon name={expanded ? 'up' : 'down'} size={16} />
            </button>
          )}
        </div>

        {!detailPageOnly ? (
          <div className="forum-detail-toolbar">
            {detailHref ? (
              <Link className="forum-inline-button" to={detailHref}>
                查看详情
              </Link>
            ) : null}
            <button className="forum-inline-button" onClick={() => setLikesOpen((current) => !current)} type="button">
              {likesOpen ? '收起点赞列表' : `查看点赞列表 (${question.likesNum})`}
            </button>
          </div>
        ) : null}

        {likesOpen && !detailPageOnly ? (
          <div className="forum-like-panel">
            {likesMessage ? <div className="forum-empty-likes">{likesMessage}</div> : null}
            {likesLoading ? <div className="forum-empty-likes">正在加载点赞列表...</div> : null}
            {!likesLoading && likesPage.records.length === 0 && !likesMessage ? <div className="forum-empty-likes">暂时还没有人点赞。</div> : null}
            {likesPage.records.length > 0 ? (
              <>
                <div className="forum-like-list">
                  {likesPage.records.map((item) => (
                    <div className="forum-like-chip" key={item.id}>
                      <strong>{item.nickName}</strong>
                      <span>{item.time}</span>
                    </div>
                  ))}
                </div>
                {likesPage.total > likesPage.page_size ? (
                  <div className="forum-like-pagination">
                    <button className="legacy-action-button secondary small" disabled={likesLoading || likesPage.page <= 1} onClick={() => void loadLikes(likesPage.page - 1)} type="button">
                      上一页
                    </button>
                    <span>
                      第 {likesPage.page} / {totalLikePages} 页
                    </span>
                    <button
                      className="legacy-action-button secondary small"
                      disabled={likesLoading || likesPage.page >= totalLikePages}
                      onClick={() => void loadLikes(likesPage.page + 1)}
                      type="button"
                    >
                      下一页
                    </button>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {expanded && !detailPageOnly ? (
        <div className="review-version">
          <div className="form">
            <img alt="avatar" className="now-header forum-comment-avatar" src={avatarSrc(viewerAvatarPath)} />
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
            {commentsMessage ? <div className="forum-empty-comments">{commentsMessage}</div> : null}
            {commentsLoading ? <div className="forum-empty-comments">正在加载评论...</div> : null}
            {!commentsLoading && commentsPage.records.length === 0 && !commentsMessage ? <div className="forum-empty-comments">暂时还没有评论。</div> : null}
            <div className="forum-comment-timeline">
              {commentsPage.records.map((comment, index) => (
                <div className="forum-comment-node" key={comment.id}>
                  <div className="forum-comment-rail">
                    <span className="forum-comment-dot">{index + 1}</span>
                    <span className="forum-comment-line"></span>
                  </div>
                  <div className="forum-comment-card">
                    <div className="forum-comment-head">
                      <div className="forum-comment-user">
                        <img alt={comment.nickName} className="header-img" src={avatarSrc(comment.avatarPath)} />
                        <div>
                          <strong>{comment.nickName}</strong>
                          <span>{comment.user}</span>
                        </div>
                      </div>
                      <span className="forum-comment-time">{comment.time}</span>
                    </div>

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
                        <p className="forum-comment-body">{comment.text}</p>
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

            {commentsPage.total > commentsPage.page_size ? (
              <div className="forum-comment-pagination">
                <button className="legacy-action-button secondary small" disabled={commentsLoading || commentsPage.page <= 1} onClick={() => void loadComments(commentsPage.page - 1)} type="button">
                  上一页
                </button>
                <span>
                  第 {commentsPage.page} / {totalCommentPages} 页
                </span>
                <button
                  className="legacy-action-button secondary small"
                  disabled={commentsLoading || commentsPage.page >= totalCommentPages}
                  onClick={() => void loadComments(commentsPage.page + 1)}
                  type="button"
                >
                  下一页
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {previewFile ? (
        <div className="forum-media-preview" onClick={() => setPreviewFile(null)} role="presentation">
          <button aria-label="关闭预览" className="forum-media-preview-close" onClick={() => setPreviewFile(null)} type="button">
            x
          </button>
          <div className="forum-media-preview-stage" onClick={(event) => event.stopPropagation()} role="presentation">
            {isImage(previewFile) ? <img alt={previewFile} src={buildUploadAssetUrl(previewFile)} /> : <video autoPlay controls src={buildUploadAssetUrl(previewFile)} />}
          </div>
        </div>
      ) : null}
    </div>
  );
}
