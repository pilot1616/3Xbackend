import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { buildUploadAssetUrl } from '../api/client';
import { createQuestion, listMyQuestions, uploadQuestionFiles } from '../api/forum';
import { useSession } from '../lib/session';
import type { QuestionListPage } from '../types/api';

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
  const [composerUploadProgress, setComposerUploadProgress] = useState<number | null>(null);
  const [composerBusy, setComposerBusy] = useState(false);

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
    setComposerUploadProgress(null);
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
        setComposerUploadProgress(0);
        await uploadQuestionFiles(created.qid, createFiles, (percent) => setComposerUploadProgress(percent));
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

  if (!session) {
    return (
      <div id="noLogined">
        <div id="loginReminder" style={{ textAlign: 'center', padding: 50 }}>
          <h2>请先登录</h2>
          <p>当前页面需要登录才能访问，请先登录。</p>
          <Link className="legacy-action-button" to="/auth">
            去登录
          </Link>
        </div>
      </div>
    );
  }

  return (
    <section className="content whisper-content leacots-content">
      <div className="cont w1000">
        <div className="review-version">
          <div className="form-box legacy-publish-form-box">
            <div className="form legacy-panel legacy-publish-form-panel">
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
                <label className="file-upload">
                  选择文件
                  <input accept=".png,.jpg,.jpeg,.gif,.mp4" multiple onChange={handleCreateFilesChange} type="file" />
                </label>
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
              {composerUploadProgress !== null ? (
                <div className="legacy-progress-block">
                  <div className="legacy-progress-label">附件上传进度 {composerUploadProgress}%</div>
                  <div className="legacy-progress-track">
                    <div className="legacy-progress-fill" style={{ width: `${composerUploadProgress}%` }}></div>
                  </div>
                </div>
              ) : null}
              <div className="layui-form-item">
                <div className="layui-input-block" style={{ textAlign: 'right' }}>
                  <button className="img-upload-btn" disabled={composerBusy} type="submit">
                    {composerBusy ? '发布中...' : '发布帖子'}
                  </button>
                </div>
              </div>
            </form>
            {message ? <div className="legacy-feedback" style={{ marginTop: 16 }}>{message}</div> : null}
            </div>
          </div>
        </div>

        <div className="volume">
          我发表的问题 <span>{page.total}</span>
        </div>

        <div className="whisper-list">
          {page.records.length === 0 ? (
            <div className="legacy-feedback">
              {keyword || uploadFilter ? '当前筛选条件下还没有帖子，换个关键字或发布状态再看。' : '你还没有发过帖子，先在上面发布第一条内容。'}
            </div>
          ) : null}

          <div className="legacy-my-question-list">
            {page.records.map((question) => {
              const previewFile = question.files[0];
              const previewName = question.imgName[0] || previewFile;

              return (
                <article className="legacy-my-question-card" key={question.qid}>
                  <div className="legacy-my-question-body">
                    <div className="legacy-my-question-topline">
                      <strong>{question.nickName}</strong>
                      <span>{question.isUpload ? '已发布' : '未发布'}</span>
                    </div>
                    <p>{question.text.length > 88 ? `${question.text.slice(0, 88)}...` : question.text}</p>
                    <div className="legacy-my-question-meta">
                      <span>{question.time}</span>
                      <span>{question.files.length} 个附件</span>
                      <span>{question.commentsNum} 条评论</span>
                      <span>{question.likesNum} 个点赞</span>
                    </div>
                    <div className="legacy-my-question-actions">
                      <Link className="legacy-action-button secondary small" to={`/questions/${question.qid}`}>
                        进入详情页操作
                      </Link>
                    </div>
                  </div>

                  {previewFile ? (
                    <div className="legacy-my-question-media">
                      {isImage(previewFile) ? (
                        <img alt={previewName} src={buildUploadAssetUrl(previewFile)} />
                      ) : (
                        <video controls src={buildUploadAssetUrl(previewFile)} />
                      )}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
