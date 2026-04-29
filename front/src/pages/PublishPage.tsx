import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { buildUploadAssetUrl } from '../api/client';
import { createQuestion, listMyQuestions, uploadQuestionFiles } from '../api/forum';
import { LegacyIcon } from '../components/LegacyIcon';
import { useSession } from '../lib/session';
import type { QuestionListPage } from '../types/api';

type MyQuestionFilters = {
  keyword: string;
  uploadFilter: string;
  sort: string;
};

const emptyPage: QuestionListPage = {
  page: 1,
  page_size: 20,
  total: 0,
  records: [],
};

const maxUploadSize = 20 * 1024 * 1024;
const allowedVideoPattern = /\.mp4$/i;
const myQuestionPageSize = 20;
const defaultFilters: MyQuestionFilters = {
  keyword: '',
  uploadFilter: '',
  sort: 'latest',
};

function isDefaultMyQuestionFilters(filters: MyQuestionFilters) {
  return filters.keyword === defaultFilters.keyword && filters.uploadFilter === defaultFilters.uploadFilter && filters.sort === defaultFilters.sort;
}

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

function buildExcerpt(text: string, maxLength = 88) {
  const content = text.trim();
  if (!content) {
    return '该帖子暂无正文内容。';
  }
  if (content.length <= maxLength) {
    return content;
  }
  return `${content.slice(0, maxLength).trimEnd()}...`;
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
  const [filters, setFilters] = useState<MyQuestionFilters>(defaultFilters);
  const [sortInput, setSortInput] = useState(defaultFilters.sort);
  const [uploadFilterInput, setUploadFilterInput] = useState(defaultFilters.uploadFilter);
  const [keywordInput, setKeywordInput] = useState(defaultFilters.keyword);
  const [createFiles, setCreateFiles] = useState<File[]>([]);
  const [composerUploadProgress, setComposerUploadProgress] = useState<number | null>(null);
  const [composerBusy, setComposerBusy] = useState(false);
  const [latestCreatedQid, setLatestCreatedQid] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (session) {
      void loadMyQuestions(1, true);
    }
  }, [session, filters]);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || loading || loadingMore || !hasMore) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (!entry?.isIntersecting) {
          return;
        }
        void loadNextPage();
      },
      {
        rootMargin: '300px 0px',
      },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [loading, loadingMore, hasMore, page.page, page.total, filters]);

  async function loadMyQuestions(targetPage = 1, reset = false) {
    if (reset) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }
    setMessage('');
    try {
      const result = await listMyQuestions({
        page: targetPage,
        pageSize: myQuestionPageSize,
        sort: filters.sort,
        isUpload: filters.uploadFilter,
        keyword: filters.keyword,
      });

      setPage((current) => {
        if (reset) {
          return result;
        }

        const merged = [...current.records];
        result.records.forEach((record) => {
          if (!merged.some((item) => item.qid === record.qid)) {
            merged.push(record);
          }
        });

        return {
          ...result,
          records: merged,
        };
      });
      setHasMore(targetPage * result.page_size < result.total);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '加载我的帖子失败');
    } finally {
      if (reset) {
        setLoading(false);
      } else {
        setLoadingMore(false);
      }
    }
  }

  async function loadNextPage() {
    if (loading || loadingMore || !hasMore) {
      return;
    }
    await loadMyQuestions(page.page + 1, false);
  }

  async function reloadCurrentWindow() {
    const loadedPages = Math.max(1, Math.ceil(page.records.length / Math.max(1, myQuestionPageSize)));
    setLoading(true);
    setMessage('');
    try {
      const results = await Promise.all(
        Array.from({ length: loadedPages }, (_, index) =>
          listMyQuestions({
            page: index + 1,
            pageSize: myQuestionPageSize,
            sort: filters.sort,
            isUpload: filters.uploadFilter,
            keyword: filters.keyword,
          }),
        ),
      );

      const merged = results.flatMap((result) => result.records);
      const lastPage = results[results.length - 1] ?? emptyPage;
      setPage({
        ...lastPage,
        records: merged,
      });
      setHasMore(loadedPages * lastPage.page_size < lastPage.total);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '刷新我的帖子失败');
    } finally {
      setLoading(false);
    }
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
      setLatestCreatedQid(created.qid);
      setMessage('发帖成功');
      if (isDefaultMyQuestionFilters(filters)) {
        await loadMyQuestions(1, true);
      } else {
        setKeywordInput(defaultFilters.keyword);
        setUploadFilterInput(defaultFilters.uploadFilter);
        setSortInput(defaultFilters.sort);
        setFilters(defaultFilters);
      }
    } catch (err) {
      setLatestCreatedQid(null);
      setMessage(err instanceof Error ? err.message : '发帖失败');
    } finally {
      setComposerBusy(false);
    }
  }

  function handleFilterSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFilters({
      keyword: keywordInput.trim(),
      uploadFilter: uploadFilterInput,
      sort: sortInput,
    });
  }

  function handleFilterReset() {
    setKeywordInput(defaultFilters.keyword);
    setUploadFilterInput(defaultFilters.uploadFilter);
    setSortInput(defaultFilters.sort);
    setFilters(defaultFilters);
  }

  if (!session) {
    return (
      <div id="noLogined">
        <div id="loginReminder" style={{ textAlign: 'center', padding: 50 }}>
          <h2>请先登录</h2>
          <p>当前页面需要登录才能访问，请先登录。</p>
          <Link className="legacy-action-button" to="/auth?redirect=/publish">
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
            {latestCreatedQid ? (
              <div className="legacy-home-load-status" style={{ marginTop: 12, padding: 0 }}>
                <span>已创建帖子 #{latestCreatedQid}，可以直接进入详情继续管理内容。</span>
                <Link className="legacy-action-button secondary small" to={`/questions/${latestCreatedQid}`}>
                  查看刚发布的帖子
                </Link>
              </div>
            ) : null}
            </div>
          </div>
        </div>

        <div className="volume">
          我发表的问题 <span>{page.total}</span>
        </div>

        <form className="legacy-home-filter-row legacy-publish-filter-row" onSubmit={handleFilterSubmit}>
          <input onChange={(event) => setKeywordInput(event.target.value)} placeholder="按帖子内容关键字筛选" value={keywordInput} />
          <select onChange={(event) => setUploadFilterInput(event.target.value)} value={uploadFilterInput}>
            <option value="">全部状态</option>
            <option value="true">仅看已发布</option>
            <option value="false">仅看未发布</option>
          </select>
          <select onChange={(event) => setSortInput(event.target.value)} value={sortInput}>
            <option value="latest">最新发布</option>
            <option value="oldest">最早发布</option>
            <option value="most_liked">点赞最多</option>
            <option value="most_commented">评论最多</option>
          </select>
          <div className="legacy-home-filter-actions">
            <button className="legacy-action-button small" type="submit">
              应用筛选
            </button>
            <button className="legacy-action-button secondary small" onClick={handleFilterReset} type="button">
              重置
            </button>
          </div>
        </form>

        <div className="whisper-list">
          {loading ? <div className="legacy-feedback">正在加载我的帖子...</div> : null}

          {!loading && page.records.length === 0 ? (
            <div className="legacy-feedback">
              {filters.keyword || filters.uploadFilter ? '当前筛选条件下还没有帖子，换个关键字或发布状态再看。' : '你还没有发过帖子，先在上面发布第一条内容。'}
            </div>
          ) : null}

          <div className="legacy-my-question-list">
            {page.records.map((question) => {
              const previewFile = question.files[0];
              const previewName = question.imgName[0] || previewFile;
              const [datePart, timePart = ''] = question.time.split(' ');
              const previewTypeLabel = previewFile ? (isImage(previewFile) ? '图片附件' : '视频附件') : '无附件';

              return (
                <article className="item-box legacy-my-question-card" key={question.qid}>
                  <div className="item legacy-my-question-item">
                    <div className="whisper-title legacy-my-question-title">
                      <div className="legacy-my-question-title-main">
                        <LegacyIcon name="friends" size={16} style={{ color: 'gray' }} />
                        <span className="nickname">{question.nickName}</span>
                        <span className="legacy-my-question-qid">QID {question.qid}</span>
                        <span className={`legacy-my-question-status${question.isUpload ? ' is-published' : ''}`}>
                          {question.isUpload ? '已发布' : '未发布'}
                        </span>
                      </div>
                      <div className="legacy-my-question-title-time">
                        <LegacyIcon name="date" size={16} />
                        <span className="hour">{timePart.slice(0, 5)}</span>
                        <span className="date">{datePart}</span>
                      </div>
                    </div>

                    <div className="legacy-my-question-summary-row">
                      <span className={`legacy-mini-card-badge ${previewFile ? (isImage(previewFile) ? 'is-published' : 'is-draft') : 'is-draft'}`}>{previewTypeLabel}</span>
                      <span className="legacy-my-question-summary-meta">附件 {question.files.length}</span>
                      <span className="legacy-my-question-summary-meta">点赞 {question.likesNum}</span>
                      <span className="legacy-my-question-summary-meta">评论 {question.commentsNum}</span>
                    </div>

                    <p className="text-cont legacy-my-question-text" title={question.text}>{buildExcerpt(question.text)}</p>

                    {previewFile ? (
                      <div className="img-box legacy-my-question-media">
                        {isImage(previewFile) ? (
                          <img alt={previewName} src={buildUploadAssetUrl(previewFile)} />
                        ) : (
                          <video controls src={buildUploadAssetUrl(previewFile)} />
                        )}
                      </div>
                    ) : null}

                    <div className="op-list legacy-my-question-op-list">
                      <p className="like">
                        <LegacyIcon name="praise" size={16} />
                        <span>{question.likesNum}</span>
                      </p>
                      <p className="edit">
                        <LegacyIcon name="reply-fill" size={16} />
                        <span>{question.commentsNum}</span>
                      </p>
                      <p className="off">
                        <Link className="legacy-my-question-detail-link" to={`/questions/${question.qid}`}>
                          <span>进入详情</span>
                          <LegacyIcon name="right" size={16} />
                        </Link>
                      </p>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          {!loading && page.records.length > 0 ? (
            <div className="legacy-home-load-status">
              <span>
                已加载 {page.records.length} / {page.total} 条帖子
              </span>
              <button className="legacy-action-button secondary small" onClick={() => void reloadCurrentWindow()} type="button">
                刷新当前列表
              </button>
            </div>
          ) : null}

          {loadingMore ? <div className="legacy-feedback legacy-home-feedback">正在继续加载更多帖子...</div> : null}
          {!loading && !hasMore && page.records.length > 0 ? <div className="legacy-feedback legacy-home-feedback">已经到底了，全部帖子都加载完成。</div> : null}
          <div className="legacy-home-load-anchor" ref={loadMoreRef}></div>
        </div>
      </div>
    </section>
  );
}
