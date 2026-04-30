import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { likeQuestion, listQuestions, unlikeQuestion } from '../api/forum';
import { QuestionCard } from '../components/QuestionCard';
import { useSession } from '../lib/session';
import type { QuestionListPage, QuestionRecord } from '../types/api';

type HomeFilters = {
  keyword: string;
  author: string;
  searchType: 'content' | 'author' | 'phone';
};

const emptyPage: QuestionListPage = {
  page: 1,
  page_size: 30,
  total: 0,
  records: [],
};

const homePageSize = 30;
const defaultFilters: HomeFilters = {
  keyword: '',
  author: '',
  searchType: 'content',
};

function readFiltersFromSearchParams(searchParams: URLSearchParams): HomeFilters {
  const nextKeyword = searchParams.get('keyword')?.trim() ?? defaultFilters.keyword;
  const nextAuthor = searchParams.get('author')?.trim() ?? defaultFilters.author;
  const nextSearchType = nextAuthor ? (searchParams.get('searchType') === 'phone' ? 'phone' : 'author') : 'content';
  return {
    keyword: nextKeyword,
    author: nextAuthor,
    searchType: nextSearchType,
  };
}

export function HomePage() {
  const session = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [page, setPage] = useState(emptyPage);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [message, setMessage] = useState('');
  const [filters, setFilters] = useState<HomeFilters>(defaultFilters);
  const [submittingQid, setSubmittingQid] = useState<number | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const listBusy = loading || loadingMore;

  useEffect(() => {
    const nextFilters = readFiltersFromSearchParams(searchParams);
    setFilters((current) =>
      current.keyword === nextFilters.keyword && current.author === nextFilters.author && current.searchType === nextFilters.searchType ? current : nextFilters,
    );
  }, [searchParams]);

  useEffect(() => {
    void loadData(1, true);
  }, [filters, session?.token]);

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

  async function loadData(targetPage = 1, reset = false) {
    if (reset) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }
    setMessage('');
    try {
      const result = await listQuestions({
        page: targetPage,
        pageSize: homePageSize,
        keyword: filters.keyword,
        author: filters.author,
        isUpload: 'true',
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
      setMessage(err instanceof Error ? err.message : '加载帖子失败');
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
    await loadData(page.page + 1, false);
  }

  async function reloadCurrentWindow() {
    const loadedPages = Math.max(1, Math.ceil(page.records.length / Math.max(1, homePageSize)));
    setLoading(true);
    setMessage('');
    try {
      const results = await Promise.all(
        Array.from({ length: loadedPages }, (_, index) =>
          listQuestions({
            page: index + 1,
            pageSize: homePageSize,
            keyword: filters.keyword,
            author: filters.author,
            isUpload: 'true',
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
      setMessage(err instanceof Error ? err.message : '刷新帖子失败');
    } finally {
      setLoading(false);
    }
  }

  async function handleLikeToggle(question: QuestionRecord) {
    if (!session) {
      navigate(`/auth?redirect=${encodeURIComponent(`${location.pathname}${location.search}`)}`);
      return;
    }

    setSubmittingQid(question.qid);
    setMessage('');
    try {
      if (question.likedByMe) {
        await unlikeQuestion(question.qid);
      } else {
        await likeQuestion(question.qid);
      }
      setPage((current) => ({
        ...current,
        records: current.records.map((item) =>
          item.qid === question.qid
            ? {
                ...item,
                likedByMe: !item.likedByMe,
                likesNum: Math.max(0, item.likesNum + (item.likedByMe ? -1 : 1)),
              }
            : item,
        ),
      }));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '点赞操作失败');
    } finally {
      setSubmittingQid(null);
    }
  }

  function handleReset() {
    setSearchParams({});
  }

  function clearFilter(key: 'keyword' | 'author' | 'searchType') {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete(key);
      if (key === 'author' || key === 'searchType') {
        next.delete('author');
        next.delete('searchType');
      }
      return next;
    });
  }

  const hasActiveFilters = Boolean(filters.keyword || filters.author);
  const activeSearchLabel = filters.author ? (filters.searchType === 'phone' ? '手机号检索' : '作者检索') : filters.keyword ? '内容检索' : '公开动态';

  return (
    <>
      <section className="content whisper-content legacy-home-scene">
        <div className="cont">
          <div className="legacy-home-stage">
            <div className="legacy-home-stage-copy">
              <span className="legacy-home-stage-kicker">3X Future Console</span>
              <h2>在一块悬浮控制台里浏览社区动态</h2>
              <p>首页现在作为整个论坛的主舞台：搜索、筛选和帖子流被组织成分层模块，重点内容会像实体装置一样浮在背景之上。</p>
            </div>
            <div className="legacy-home-stage-metrics">
              <article className="legacy-home-stage-card">
                <strong>{loading ? '--' : page.total}</strong>
                <span>当前可浏览帖子</span>
              </article>
              <article className="legacy-home-stage-card">
                <strong>{page.records.length}</strong>
                <span>已装载到视野</span>
              </article>
              <article className="legacy-home-stage-card">
                <strong>{activeSearchLabel}</strong>
                <span>当前浏览模式</span>
              </article>
            </div>
          </div>

          {hasActiveFilters ? (
            <div className="legacy-active-filters">
              {filters.keyword ? (
                <button className="legacy-summary-chip legacy-summary-chip-button" onClick={() => clearFilter('keyword')} type="button">
                  关键字：{filters.keyword} ×
                </button>
              ) : null}
              {filters.author ? (
                <button className="legacy-summary-chip legacy-summary-chip-button" onClick={() => clearFilter('author')} type="button">
                  {filters.searchType === 'phone' ? '手机号' : '作者'}：{filters.author} ×
                </button>
              ) : null}
              <button className="legacy-action-button secondary small" disabled={listBusy} onClick={handleReset} type="button">
                清除全部
              </button>
            </div>
          ) : null}

          {message ? <div className="legacy-feedback legacy-home-feedback legacy-home-status-card">{message}</div> : null}
          {loading ? <div className="legacy-feedback legacy-home-status-card">正在加载帖子...</div> : null}

          <div className="whisper-list legacy-home-deck">
            {!loading && page.records.length === 0 ? (
              <div className="legacy-home-empty-state">
                <span className="legacy-home-stage-kicker">No Signal</span>
                <h3>{hasActiveFilters ? '当前筛选条件下没有匹配帖子' : '广场里暂时还没有公开帖子'}</h3>
                <p>{hasActiveFilters ? '可以清空搜索条件，或者切换作者 / 手机号 / 内容重新检索。' : '等第一批公开帖子进入广场后，这里会开始持续滚动加载。'}</p>
                {hasActiveFilters ? (
                  <button className="legacy-action-button secondary" disabled={listBusy} onClick={handleReset} type="button">
                    清空当前筛选
                  </button>
                ) : null}
              </div>
            ) : null}

            {page.records.map((question) => (
              <QuestionCard
                canInteract={Boolean(session)}
                compact
                currentUsername={session?.user.username}
                detailPageOnly
                viewerAvatarPath={session?.user.avatar_path}
                detailHref={`/questions/${question.qid}`}
                key={question.qid}
                onLikeToggle={handleLikeToggle}
                question={question}
                submitting={submittingQid === question.qid}
              />
            ))}

            {!loading && page.records.length > 0 ? (
              <div className="legacy-home-load-status legacy-home-status-card">
                <span>
                  已加载 {page.records.length} / {page.total} 条帖子
                </span>
                <button className="legacy-action-button secondary small" disabled={listBusy} onClick={() => void reloadCurrentWindow()} type="button">
                  {listBusy ? '刷新中...' : '刷新当前列表'}
                </button>
              </div>
            ) : null}

            {loadingMore ? <div className="legacy-feedback legacy-home-feedback legacy-home-status-card">正在继续加载更多帖子...</div> : null}
            {!loading && !hasMore && page.records.length > 0 ? <div className="legacy-feedback legacy-home-feedback legacy-home-status-card">已经到底了，全部帖子都加载完成。</div> : null}
            <div className="legacy-home-load-anchor" ref={loadMoreRef}></div>
          </div>
        </div>
      </section>
    </>
  );
}
