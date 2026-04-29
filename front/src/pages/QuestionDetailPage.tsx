import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { buildUploadAssetUrl } from '../api/client';
import {
  createComment,
  deleteComment,
  deleteQuestion,
  deleteQuestionFile,
  getQuestion,
  likeQuestion,
  listQuestions,
  toggleQuestionUpload,
  unlikeQuestion,
  updateComment,
  updateQuestion,
  uploadQuestionFiles,
} from '../api/forum';
import { QuestionCard } from '../components/QuestionCard';
import { useSession } from '../lib/session';
import type { QuestionListPage, QuestionRecord } from '../types/api';

const maxUploadSize = 20 * 1024 * 1024;
const allowedVideoPattern = /\.mp4$/i;
const authorMorePageSize = 6;

const emptyAuthorPage: QuestionListPage = {
  page: 1,
  page_size: authorMorePageSize,
  total: 0,
  records: [],
};

type RelatedFilters = {
  keyword: string;
  sort: string;
};

const defaultRelatedFilters: RelatedFilters = {
  keyword: '',
  sort: 'latest',
};

function isImage(fileName: string) {
  return /\.(png|jpg|jpeg|gif)$/i.test(fileName);
}

function isAllowedUploadFile(file: File) {
  return isImage(file.name) || allowedVideoPattern.test(file.name);
}

function formatFileSize(size: number) {
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

function SelectedFilePreviewGrid({ files }: { files: File[] }) {
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);

  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file));
    setPreviewUrls(urls);

    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [files]);

  if (files.length === 0) {
    return null;
  }

  return (
    <div className="legacy-attachment-grid legacy-selected-preview-grid">
      {files.map((file, index) => (
        <div className="legacy-attachment-item" key={`${file.name}-${file.size}-${index}`}>
          {isImage(file.name) ? <img alt={file.name} src={previewUrls[index]} /> : <video controls src={previewUrls[index]} />}
          <div className="legacy-attachment-meta">
            <strong>{file.name}</strong>
            <span>{formatFileSize(file.size)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function QuestionDetailPage() {
  const { qid } = useParams<{ qid: string }>();
  const navigate = useNavigate();
  const session = useSession();
  const [question, setQuestion] = useState<QuestionRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [relatedQuestionsPage, setRelatedQuestionsPage] = useState<QuestionListPage>(emptyAuthorPage);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [relatedPage, setRelatedPage] = useState(1);
  const [relatedFilters, setRelatedFilters] = useState<RelatedFilters>(defaultRelatedFilters);
  const [relatedKeywordInput, setRelatedKeywordInput] = useState(defaultRelatedFilters.keyword);
  const [relatedSortInput, setRelatedSortInput] = useState(defaultRelatedFilters.sort);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  useEffect(() => {
    void loadQuestion();
  }, [qid, session?.token]);

  useEffect(() => {
    if (!question?.user) {
      setRelatedQuestionsPage(emptyAuthorPage);
      return;
    }
    void loadRelatedQuestions(question.user, question.qid, relatedPage, relatedFilters);
  }, [question?.user, question?.qid, relatedPage, relatedFilters, session?.token]);

  useEffect(() => {
    setRelatedPage(1);
    setRelatedFilters(defaultRelatedFilters);
    setRelatedKeywordInput(defaultRelatedFilters.keyword);
    setRelatedSortInput(defaultRelatedFilters.sort);
  }, [question?.user, question?.qid]);

  async function loadQuestion() {
    if (!qid || Number.isNaN(Number(qid))) {
      setMessage('无效的帖子编号');
      setLoading(false);
      return;
    }

    setLoading(true);
    setMessage('');
    try {
      const result = await getQuestion(Number(qid));
      setQuestion(result);
    } catch (err) {
      setQuestion(null);
      setMessage(err instanceof Error ? err.message : '加载帖子详情失败');
    } finally {
      setLoading(false);
    }
  }

  async function loadRelatedQuestions(author: string, currentQid: number, page: number, filters: RelatedFilters) {
    setRelatedLoading(true);
    try {
      const result = await listQuestions({
        author,
        keyword: filters.keyword,
        sort: filters.sort,
        isUpload: 'true',
        page,
        pageSize: authorMorePageSize,
      });
      const filteredRecords = result.records.filter((item) => item.qid !== currentQid);
      const adjustedTotal = Math.max(0, result.total - 1);
      setRelatedQuestionsPage({
        ...result,
        total: adjustedTotal,
        records: filteredRecords,
      });
    } catch {
      setRelatedQuestionsPage(emptyAuthorPage);
    } finally {
      setRelatedLoading(false);
    }
  }

  function handleRelatedFilterSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextFilters = {
      keyword: relatedKeywordInput.trim(),
      sort: relatedSortInput,
    };

    if (relatedPage !== 1) {
      setRelatedPage(1);
    }

    if (nextFilters.keyword !== relatedFilters.keyword || nextFilters.sort !== relatedFilters.sort) {
      setRelatedFilters(nextFilters);
      return;
    }

    if (question?.user) {
      void loadRelatedQuestions(question.user, question.qid, 1, nextFilters);
    }
  }

  function handleRelatedFilterReset() {
    setRelatedKeywordInput(defaultRelatedFilters.keyword);
    setRelatedSortInput(defaultRelatedFilters.sort);

    if (relatedPage !== 1) {
      setRelatedPage(1);
    }

    if (relatedFilters.keyword !== defaultRelatedFilters.keyword || relatedFilters.sort !== defaultRelatedFilters.sort) {
      setRelatedFilters(defaultRelatedFilters);
      return;
    }

    if (question?.user) {
      void loadRelatedQuestions(question.user, question.qid, 1, defaultRelatedFilters);
    }
  }

  async function handleLikeToggle(currentQuestion: QuestionRecord) {
    if (!session) {
      setMessage('请先登录后再点赞');
      return;
    }

    setSubmitting(true);
    setMessage('');
    try {
      if (currentQuestion.likedByMe) {
        await unlikeQuestion(currentQuestion.qid);
      } else {
        await likeQuestion(currentQuestion.qid);
      }
      await loadQuestion();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '点赞操作失败');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCommentSubmit(currentQuestion: QuestionRecord, text: string) {
    if (!session) {
      setMessage('请先登录后再评论');
      return;
    }

    setSubmitting(true);
    setMessage('');
    try {
      const updated = await createComment(currentQuestion.qid, { text });
      setQuestion(updated);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '发表评论失败');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCommentUpdate(currentQuestion: QuestionRecord, commentID: number, text: string) {
    if (!session) {
      setMessage('请先登录后再操作评论');
      return;
    }

    setSubmitting(true);
    setMessage('');
    try {
      const updated = await updateComment(currentQuestion.qid, commentID, { text });
      setQuestion(updated);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '更新评论失败');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCommentDelete(currentQuestion: QuestionRecord, commentID: number) {
    if (!session) {
      setMessage('请先登录后再操作评论');
      return;
    }

    setSubmitting(true);
    setMessage('');
    try {
      const updated = await deleteComment(currentQuestion.qid, commentID);
      setQuestion(updated);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '删除评论失败');
    } finally {
      setSubmitting(false);
    }
  }

  function normalizeSelectedFiles(fileList: FileList | null) {
    const allFiles = Array.from(fileList ?? []);
    const validFiles: File[] = [];
    const rejectedFiles: string[] = [];

    allFiles.forEach((file) => {
      if (!isAllowedUploadFile(file)) {
        rejectedFiles.push(`${file.name}：仅支持 png/jpg/jpeg/gif/mp4`);
        return;
      }
      if (file.size > maxUploadSize) {
        rejectedFiles.push(`${file.name}：超过 20MB`);
        return;
      }
      validFiles.push(file);
    });

    if (rejectedFiles.length > 0) {
      setMessage(`以下文件未加入上传列表：${rejectedFiles.join('；')}`);
    }

    return validFiles;
  }

  function handleFileSelection(event: ChangeEvent<HTMLInputElement>) {
    setSelectedFiles(normalizeSelectedFiles(event.target.files));
  }

  function startEditing() {
    if (!question) {
      return;
    }
    setEditing(true);
    setEditText(question.text);
  }

  function cancelEditing() {
    setEditing(false);
    setEditText('');
  }

  async function handleUpdateQuestion() {
    if (!question) {
      return;
    }
    if (!editText.trim()) {
      setMessage('修改内容不能为空');
      return;
    }

    setSubmitting(true);
    setMessage('');
    try {
      const updated = await updateQuestion(question.qid, { text: editText });
      setQuestion(updated);
      cancelEditing();
      setMessage('帖子已更新');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '更新帖子失败');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleUpload() {
    if (!question) {
      return;
    }

    setSubmitting(true);
    setMessage('');
    try {
      await toggleQuestionUpload(question.qid);
      await loadQuestion();
      setMessage('发布状态已切换');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '切换发布状态失败');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteQuestion() {
    if (!question) {
      return;
    }
    const confirmed = window.confirm('确认删除这条帖子吗？删除后评论、点赞和附件都会一起删除。');
    if (!confirmed) {
      return;
    }

    setSubmitting(true);
    setMessage('');
    try {
      await deleteQuestion(question.qid);
      navigate('/publish');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '删除帖子失败');
      setSubmitting(false);
    }
  }

  async function handleUploadExtraFiles() {
    if (!question) {
      return;
    }
    if (selectedFiles.length === 0) {
      setMessage('请先选择附件');
      return;
    }

    setSubmitting(true);
    setMessage('');
    try {
      setUploadProgress(0);
      await uploadQuestionFiles(question.qid, selectedFiles, (percent) => setUploadProgress(percent));
      setSelectedFiles([]);
      await loadQuestion();
      setMessage('附件上传成功');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '上传附件失败');
    } finally {
      setUploadProgress(null);
      setSubmitting(false);
    }
  }

  async function handleDeleteFile(fileName: string) {
    if (!question) {
      return;
    }

    setSubmitting(true);
    setMessage('');
    try {
      await deleteQuestionFile(question.qid, fileName);
      await loadQuestion();
      setMessage('附件已删除');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '删除附件失败');
    } finally {
      setSubmitting(false);
    }
  }

  const relatedTotalPages = Math.max(1, Math.ceil(relatedQuestionsPage.total / Math.max(1, relatedQuestionsPage.page_size)));

  return (
    <section className="content whisper-content">
      <div className="question-detail-shell">
      <div className="legacy-toolbar-card question-detail-toolbar-card">
        <div>
          <h2>帖子详情</h2>
          <p>这里展示单条帖子内容，并承接点赞、评论、评论编辑和删除。</p>
        </div>
        <div className="legacy-toolbar-actions">
          <Link className="legacy-action-button secondary" to="/">
            返回广场
          </Link>
        </div>
      </div>

      {message ? <div className="legacy-feedback">{message}</div> : null}
      {loading ? <div className="legacy-feedback">正在加载帖子详情...</div> : null}

      {!loading && !question && !message ? <div className="legacy-feedback">没有找到对应帖子。</div> : null}

      {question ? (
        <div className="question-detail-stage">
          <div className="cont question-detail-main">
          <div className="whisper-list">
            {question.ownedByMe ? (
              <div className="legacy-manage-panel legacy-detail-manage-panel">
                <div className="legacy-section-title">帖子管理</div>
                <div className="legacy-manage-actions">
                  <button className="legacy-action-button niceButton" disabled={submitting} onClick={() => void handleToggleUpload()} type="button">
                    {submitting ? '处理中...' : question.isUpload ? '撤销发布' : '重新发布'}
                  </button>
                  <button className="legacy-action-button niceButton secondary" disabled={submitting} onClick={startEditing} type="button">
                    编辑正文
                  </button>
                  <button className="legacy-action-button niceButton danger" disabled={submitting} onClick={() => void handleDeleteQuestion()} type="button">
                    删除帖子
                  </button>
                </div>

                {editing ? (
                  <div className="legacy-edit-box">
                    <textarea onChange={(event) => setEditText(event.target.value)} rows={5} value={editText}></textarea>
                    <div className="legacy-manage-actions">
                      <button className="legacy-action-button niceButton" disabled={submitting} onClick={() => void handleUpdateQuestion()} type="button">
                        {submitting ? '保存中...' : '保存修改'}
                      </button>
                      <button className="legacy-action-button niceButton secondary" disabled={submitting} onClick={cancelEditing} type="button">
                        取消
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="legacy-attachment-box">
                  <div className="legacy-section-title">附件管理</div>
                  <div className="legacy-manage-actions">
                    <label className="file-upload">
                      选择文件
                      <input accept=".png,.jpg,.jpeg,.gif,.mp4" multiple onChange={handleFileSelection} type="file" />
                    </label>
                    <button className="legacy-action-button niceButton" disabled={submitting} onClick={() => void handleUploadExtraFiles()} type="button">
                      {submitting ? '上传中...' : '上传附件'}
                    </button>
                  </div>

                  {selectedFiles.length > 0 ? <SelectedFilePreviewGrid files={selectedFiles} /> : null}

                  {uploadProgress !== null ? (
                    <div className="legacy-progress-block">
                      <div className="legacy-progress-label">附件上传进度 {uploadProgress}%</div>
                      <div className="legacy-progress-track">
                        <div className="legacy-progress-fill" style={{ width: `${uploadProgress}%` }}></div>
                      </div>
                    </div>
                  ) : null}

                  {question.files.length > 0 ? (
                    <div className="legacy-attachment-grid">
                      {question.files.map((fileName, index) => (
                        <div className="legacy-attachment-item" key={fileName}>
                          {isImage(fileName) ? <img alt={fileName} src={buildUploadAssetUrl(fileName)} /> : <video controls src={buildUploadAssetUrl(fileName)} />}
                          <div className="legacy-attachment-meta">
                            <strong>{question.imgName[index] || fileName}</strong>
                            <span>{fileName}</span>
                          </div>
                          <button className="legacy-action-button niceButton danger small" disabled={submitting} onClick={() => void handleDeleteFile(fileName)} type="button">
                            删除附件
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="legacy-empty-inline">当前帖子还没有附件。</div>
                  )}
                </div>
              </div>
            ) : null}

            <QuestionCard
              canInteract={Boolean(session)}
              currentUsername={session?.user.username}
              expandedByDefault
              viewerAvatarPath={session?.user.avatar_path}
              onCommentDelete={handleCommentDelete}
              onCommentSubmit={handleCommentSubmit}
              onCommentUpdate={handleCommentUpdate}
              onLikeToggle={handleLikeToggle}
              question={question}
              submitting={submitting}
            />
          </div>
          </div>

          <aside className="legacy-card-list question-detail-sidebar">
            <section className="legacy-panel">
              <h2>作者更多帖子</h2>
              <form className="legacy-home-filter-row legacy-sidebar-filter-row" onSubmit={handleRelatedFilterSubmit}>
                <input onChange={(event) => setRelatedKeywordInput(event.target.value)} placeholder="按正文关键字筛选" value={relatedKeywordInput} />
                <select onChange={(event) => setRelatedSortInput(event.target.value)} value={relatedSortInput}>
                  <option value="latest">最新发布</option>
                  <option value="oldest">最早发布</option>
                  <option value="most_liked">点赞最多</option>
                  <option value="most_commented">评论最多</option>
                </select>
                <div className="legacy-home-filter-actions">
                  <button className="legacy-action-button small" type="submit">
                    筛选
                  </button>
                  <button className="legacy-action-button secondary small" onClick={handleRelatedFilterReset} type="button">
                    重置
                  </button>
                </div>
              </form>
              {relatedLoading ? <div className="legacy-empty-inline">正在加载更多内容...</div> : null}
              {!relatedLoading && relatedQuestionsPage.records.length === 0 ? (
                <div className="legacy-empty-inline">{relatedFilters.keyword ? '当前筛选条件下没有匹配帖子。' : '当前没有更多可展示的帖子。'}</div>
              ) : null}
              {!relatedLoading && relatedQuestionsPage.total > 0 ? <div className="legacy-empty-inline">共 {relatedQuestionsPage.total} 条，当前第 {relatedPage} / {relatedTotalPages} 页。</div> : null}
              {relatedQuestionsPage.records.map((item) => (
                <article className="legacy-mini-card" key={item.qid}>
                  <div className="legacy-mini-card-header">
                    <strong className="legacy-mini-card-title">{item.nickName}</strong>
                    <div className="legacy-mini-card-badges">
                      <span className={`legacy-mini-card-badge ${item.isUpload ? 'is-published' : 'is-draft'}`}>{item.isUpload ? '已发布' : '未发布'}</span>
                    </div>
                  </div>
                  <p className="legacy-mini-card-main" title={item.text}>{item.text.length > 84 ? `${item.text.slice(0, 84)}...` : item.text}</p>
                  <div className="legacy-mini-card-meta">
                    <span>点赞 {item.likesNum}</span>
                    <span>评论 {item.commentsNum}</span>
                    <span>{item.time}</span>
                  </div>
                  <div className="legacy-mini-card-footer">
                    <Link className="legacy-action-button secondary small" to={`/questions/${item.qid}`}>
                      查看这条
                    </Link>
                  </div>
                </article>
              ))}
              {relatedQuestionsPage.total > relatedQuestionsPage.page_size ? (
                <div className="legacy-list-pagination">
                  <button className="legacy-action-button secondary small" disabled={relatedLoading || relatedPage <= 1} onClick={() => setRelatedPage((current) => current - 1)} type="button">
                    上一页
                  </button>
                  <span>
                    第 {relatedPage} / {relatedTotalPages} 页
                  </span>
                  <button className="legacy-action-button secondary small" disabled={relatedLoading || relatedPage >= relatedTotalPages} onClick={() => setRelatedPage((current) => current + 1)} type="button">
                    下一页
                  </button>
                </div>
              ) : null}
            </section>
          </aside>
        </div>
      ) : null}
      </div>
    </section>
  );
}
