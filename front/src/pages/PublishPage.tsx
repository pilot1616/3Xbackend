import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { buildAssetUrl } from '../api/client';
import {
  createQuestion,
  deleteQuestion,
  deleteQuestionFile,
  listMyQuestions,
  toggleQuestionUpload,
  updateQuestion,
  uploadQuestionFiles,
} from '../api/forum';
import { QuestionCard } from '../components/QuestionCard';
import { useSession } from '../lib/session';
import type { QuestionListPage, QuestionRecord } from '../types/api';

const emptyPage: QuestionListPage = {
  page: 1,
  page_size: 20,
  total: 0,
  records: [],
};

const maxUploadSize = 20 * 1024 * 1024;
const allowedVideoPattern = /\.mp4$/i;

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

export function PublishPage() {
  const session = useSession();
  const [text, setText] = useState('');
  const [message, setMessage] = useState('');
  const [page, setPage] = useState(emptyPage);
  const [sort, setSort] = useState('latest');
  const [uploadFilter, setUploadFilter] = useState('');
  const [keyword, setKeyword] = useState('');
  const [createFiles, setCreateFiles] = useState<File[]>([]);
  const [busyQid, setBusyQid] = useState<number | null>(null);
  const [composerBusy, setComposerBusy] = useState(false);
  const [editingQid, setEditingQid] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [fileSelections, setFileSelections] = useState<Record<number, File[]>>({});

  useEffect(() => {
    if (session) {
      void loadMyQuestions(sort, uploadFilter, keyword);
    }
  }, [session, sort, uploadFilter, keyword]);

  async function loadMyQuestions(currentSort: string, currentUploadFilter: string, currentKeyword: string) {
    const result = await listMyQuestions({ sort: currentSort, isUpload: currentUploadFilter, keyword: currentKeyword });
    setPage(result);
  }

  function resetComposer() {
    setText('');
    setCreateFiles([]);
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

  function handleCreateFilesChange(event: ChangeEvent<HTMLInputElement>) {
    setCreateFiles(normalizeSelectedFiles(event.target.files));
  }

  function startEditing(question: QuestionRecord) {
    setEditingQid(question.qid);
    setEditText(question.text);
  }

  function cancelEditing() {
    setEditingQid(null);
    setEditText('');
  }

  function handleFileSelection(qid: number, event: ChangeEvent<HTMLInputElement>) {
    const validFiles = normalizeSelectedFiles(event.target.files);
    setFileSelections((current) => ({
      ...current,
      [qid]: validFiles,
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!text.trim()) {
      setMessage('帖子正文不能为空');
      return;
    }

    setComposerBusy(true);
    setMessage('');
    try {
      const created = await createQuestion({ text });
      if (createFiles.length > 0) {
        await uploadQuestionFiles(created.qid, createFiles);
      }
      resetComposer();
      setMessage('发帖成功');
      await loadMyQuestions(sort, uploadFilter, keyword);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '发帖失败');
    } finally {
      setComposerBusy(false);
    }
  }

  async function handleUpdateQuestion(qid: number) {
    if (!editText.trim()) {
      setMessage('修改内容不能为空');
      return;
    }

    setBusyQid(qid);
    setMessage('');
    try {
      await updateQuestion(qid, { text: editText });
      cancelEditing();
      setMessage('帖子已更新');
      await loadMyQuestions(sort, uploadFilter, keyword);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '更新帖子失败');
    } finally {
      setBusyQid(null);
    }
  }

  async function handleToggleUpload(qid: number) {
    setBusyQid(qid);
    setMessage('');
    try {
      await toggleQuestionUpload(qid);
      setMessage('发布状态已切换');
      await loadMyQuestions(sort, uploadFilter, keyword);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '切换发布状态失败');
    } finally {
      setBusyQid(null);
    }
  }

  async function handleDeleteQuestion(qid: number) {
    const confirmed = window.confirm('确认删除这条帖子吗？删除后评论、点赞和附件都会一起删除。');
    if (!confirmed) {
      return;
    }

    setBusyQid(qid);
    setMessage('');
    try {
      await deleteQuestion(qid);
      setMessage('帖子已删除');
      await loadMyQuestions(sort, uploadFilter, keyword);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '删除帖子失败');
    } finally {
      setBusyQid(null);
    }
  }

  async function handleUploadExtraFiles(qid: number) {
    const files = fileSelections[qid] ?? [];
    if (files.length === 0) {
      setMessage('请先选择附件');
      return;
    }

    setBusyQid(qid);
    setMessage('');
    try {
      await uploadQuestionFiles(qid, files);
      setFileSelections((current) => ({ ...current, [qid]: [] }));
      setMessage('附件上传成功');
      await loadMyQuestions(sort, uploadFilter, keyword);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '上传附件失败');
    } finally {
      setBusyQid(null);
    }
  }

  async function handleDeleteFile(qid: number, fileName: string) {
    setBusyQid(qid);
    setMessage('');
    try {
      await deleteQuestionFile(qid, fileName);
      setMessage('附件已删除');
      await loadMyQuestions(sort, uploadFilter, keyword);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '删除附件失败');
    } finally {
      setBusyQid(null);
    }
  }

  if (!session) {
    return (
      <section className="page-section narrow">
        <div className="legacy-empty-card">
          <h2>请先登录</h2>
          <p>这里对应旧版 `leacots.html`，现在开始承接真实的发帖、附件上传和我的帖子管理。</p>
          <Link className="legacy-action-button" to="/auth">
            去登录
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="content whisper-content leacots-content">
      <div className="cont w1000">
        <div className="legacy-toolbar-card">
          <div>
            <h2>发布问题</h2>
            <p>这页现在已经接上真实发帖、编辑、删除、切换发布和附件管理，UI 先保持旧版风格。</p>
          </div>
          <div className="legacy-toolbar-actions">
            <input onChange={(event) => setKeyword(event.target.value)} placeholder="按正文关键字筛选我的帖子" value={keyword} />
            <select onChange={(event) => setSort(event.target.value)} value={sort}>
              <option value="latest">按最新</option>
              <option value="oldest">按最早</option>
              <option value="most_liked">按点赞数</option>
              <option value="most_commented">按评论数</option>
            </select>
            <select onChange={(event) => setUploadFilter(event.target.value)} value={uploadFilter}>
              <option value="">全部状态</option>
              <option value="true">仅看已发布</option>
              <option value="false">仅看未发布</option>
            </select>
          </div>
        </div>

        <div className="review-version">
          <div className="form legacy-panel">
            <form className="layui-form" onSubmit={handleSubmit}>
              <div className="layui-form-item layui-form-text">
                <div className="layui-input-block">
                  <textarea
                    className="layui-textarea"
                    onChange={(event) => setText(event.target.value)}
                    placeholder="既然来了，就说几句"
                    rows={6}
                    value={text}
                  ></textarea>
                </div>
              </div>
              <div className="legacy-upload-row">
                <input accept=".png,.jpg,.jpeg,.gif,.mp4" multiple onChange={handleCreateFilesChange} type="file" />
                <span className="legacy-upload-hint">仅支持 png/jpg/jpeg/gif/mp4，单文件最大 20MB</span>
              </div>
              {createFiles.length > 0 ? (
                <>
                  <div className="legacy-file-chip-list">
                    {createFiles.map((file) => (
                      <span className="legacy-file-chip" key={file.name}>
                        {file.name}
                      </span>
                    ))}
                  </div>
                  <SelectedFilePreviewGrid files={createFiles} />
                </>
              ) : null}
              <div className="layui-form-item">
                <div className="layui-input-block" style={{ textAlign: 'right' }}>
                  <button className="legacy-action-button" disabled={composerBusy} type="submit">
                    {composerBusy ? '发布中...' : '发布帖子'}
                  </button>
                </div>
              </div>
            </form>
            {message ? <div className="legacy-feedback" style={{ marginTop: 16 }}>{message}</div> : null}
          </div>
        </div>

        <div className="whisper-list">
          {page.records.length === 0 ? (
            <div className="legacy-feedback">
              {keyword || uploadFilter ? '当前筛选条件下还没有帖子，换个关键字或发布状态再看。' : '你还没有发过帖子，先在上面发布第一条内容。'}
            </div>
          ) : null}

          {page.records.map((question) => {
            const selectedFiles = fileSelections[question.qid] ?? [];
            const isEditing = editingQid === question.qid;
            const isBusy = busyQid === question.qid;

            return (
              <div className="legacy-manage-group" key={question.qid}>
                <QuestionCard compact question={question} />

                <div className="legacy-manage-panel">
                  <div className="legacy-manage-actions">
                    <button className="legacy-action-button" onClick={() => void handleToggleUpload(question.qid)} type="button">
                      {isBusy ? '处理中...' : question.isUpload ? '撤销发布' : '重新发布'}
                    </button>
                    <button className="legacy-action-button secondary" onClick={() => startEditing(question)} type="button">
                      编辑正文
                    </button>
                    <button className="legacy-action-button danger" onClick={() => void handleDeleteQuestion(question.qid)} type="button">
                      删除帖子
                    </button>
                  </div>

                  {isEditing ? (
                    <div className="legacy-edit-box">
                      <textarea onChange={(event) => setEditText(event.target.value)} rows={4} value={editText}></textarea>
                      <div className="legacy-manage-actions">
                        <button className="legacy-action-button" onClick={() => void handleUpdateQuestion(question.qid)} type="button">
                          {isBusy ? '保存中...' : '保存修改'}
                        </button>
                        <button className="legacy-action-button secondary" onClick={cancelEditing} type="button">
                          取消
                        </button>
                      </div>
                    </div>
                  ) : null}

                  <div className="legacy-attachment-box">
                    <div className="legacy-section-title">附件管理</div>
                    <div className="legacy-manage-actions">
                      <input accept=".png,.jpg,.jpeg,.gif,.mp4" multiple onChange={(event) => handleFileSelection(question.qid, event)} type="file" />
                      <button className="legacy-action-button" onClick={() => void handleUploadExtraFiles(question.qid)} type="button">
                        {isBusy ? '上传中...' : '上传附件'}
                      </button>
                    </div>

                    {selectedFiles.length > 0 ? (
                      <>
                        <div className="legacy-file-chip-list">
                          {selectedFiles.map((file) => (
                            <span className="legacy-file-chip" key={`${question.qid}-${file.name}`}>
                              {file.name}
                            </span>
                          ))}
                        </div>
                        <SelectedFilePreviewGrid files={selectedFiles} />
                      </>
                    ) : null}

                    {question.files.length > 0 ? (
                      <div className="legacy-attachment-grid">
                        {question.files.map((fileName, index) => (
                          <div className="legacy-attachment-item" key={fileName}>
                            {isImage(fileName) ? (
                              <img alt={fileName} src={buildAssetUrl(`/public/uploads/${fileName}`)} />
                            ) : (
                              <video controls src={buildAssetUrl(`/public/uploads/${fileName}`)} />
                            )}
                            <div className="legacy-attachment-meta">
                              <strong>{question.imgName[index] || fileName}</strong>
                              <span>{fileName}</span>
                            </div>
                            <button className="legacy-action-button danger small" onClick={() => void handleDeleteFile(question.qid, fileName)} type="button">
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
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
