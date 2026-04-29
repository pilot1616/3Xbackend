import { FormEvent, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { likeQuestion, listQuestions, unlikeQuestion } from '../api/forum';
import { QuestionCard } from '../components/QuestionCard';
import { useSession } from '../lib/session';
import type { QuestionListPage, QuestionRecord } from '../types/api';

type HomeFilters = {
  keyword: string;
  author: string;
  sort: string;
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
  sort: 'latest',
};

const sortLabelMap: Record<string, string> = {
  latest: '最新发布',
  oldest: '最早发布',
  most_liked: '点赞最多',
  most_commented: '评论最多',
};

function readFiltersFromSearchParams(searchParams: URLSearchParams): HomeFilters {
  const nextSort = searchParams.get('sort')?.trim() ?? defaultFilters.sort;
  return {
    keyword: searchParams.get('keyword')?.trim() ?? defaultFilters.keyword,
    author: searchParams.get('author')?.trim() ?? defaultFilters.author,
    sort: sortLabelMap[nextSort] ? nextSort : defaultFilters.sort,
  };
}

export function HomePage() {
  const session = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const [page, setPage] = useState(emptyPage);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [message, setMessage] = useState('');
  const [filters, setFilters] = useState<HomeFilters>(defaultFilters);
  const [keywordInput, setKeywordInput] = useState(defaultFilters.keyword);
  const [authorInput, setAuthorInput] = useState(defaultFilters.author);
  const [sortInput, setSortInput] = useState(defaultFilters.sort);
  const [submittingQid, setSubmittingQid] = useState<number | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    const nextFilters = readFiltersFromSearchParams(searchParams);
    setKeywordInput(nextFilters.keyword);
    setAuthorInput(nextFilters.author);
    setSortInput(nextFilters.sort);
    setFilters((current) =>
      current.keyword === nextFilters.keyword && current.author === nextFilters.author && current.sort === nextFilters.sort ? current : nextFilters,
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
        sort: filters.sort,
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
            sort: filters.sort,
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
      setMessage('请先登录后再点赞');
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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextKeyword = keywordInput.trim();
    const nextAuthor = authorInput.trim();
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (nextKeyword) {
        next.set('keyword', nextKeyword);
      } else {
        next.delete('keyword');
      }
      if (nextAuthor) {
        next.set('author', nextAuthor);
      } else {
        next.delete('author');
      }
      if (sortInput !== defaultFilters.sort) {
        next.set('sort', sortInput);
      } else {
        next.delete('sort');
      }
      return next;
    });
  }

  function handleReset() {
    setKeywordInput(defaultFilters.keyword);
    setAuthorInput(defaultFilters.author);
    setSortInput(defaultFilters.sort);
    setSearchParams({});
  }

  function clearFilter(key: 'keyword' | 'author' | 'sort') {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete(key);
      return next;
    });
  }

  const activeFilterEntries = [
    filters.keyword ? `关键字：${filters.keyword}` : '',
    filters.author ? `作者：${filters.author}` : '',
    filters.sort !== defaultFilters.sort ? `排序：${sortLabelMap[filters.sort]}` : '',
  ].filter(Boolean);

  return (
    <>
      <section className="content whisper-content">
        <div className="cont">
          <form className="legacy-home-filter-row" onSubmit={handleSubmit}>
            <div className="legacy-home-filter-copy">
              <strong>帖子筛选</strong>
              <span>在这里统一按作者、正文关键字和排序方式筛选首页内容。</span>
            </div>
            <input
              onChange={(event) => setAuthorInput(event.target.value)}
              placeholder="按作者昵称或手机号筛选"
              value={authorInput}
            />
            <input onChange={(event) => setKeywordInput(event.target.value)} placeholder="按帖子内容关键字筛选" value={keywordInput} />
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
              <button className="legacy-action-button secondary small" onClick={handleReset} type="button">
                重置
              </button>
            </div>
          </form>

          {activeFilterEntries.length > 0 ? (
            <div className="legacy-active-filters">
              {filters.keyword ? (
                <button className="legacy-summary-chip legacy-summary-chip-button" onClick={() => clearFilter('keyword')} type="button">
                  关键字：{filters.keyword} ×
                </button>
              ) : null}
              {filters.author ? (
                <button className="legacy-summary-chip legacy-summary-chip-button" onClick={() => clearFilter('author')} type="button">
                  作者：{filters.author} ×
                </button>
              ) : null}
              {filters.sort !== defaultFilters.sort ? (
                <button className="legacy-summary-chip legacy-summary-chip-button" onClick={() => clearFilter('sort')} type="button">
                  排序：{sortLabelMap[filters.sort]} ×
                </button>
              ) : null}
              <button className="legacy-action-button secondary small" onClick={handleReset} type="button">
                清除全部
              </button>
            </div>
          ) : null}

          {message ? <div className="legacy-feedback legacy-home-feedback">{message}</div> : null}
          {loading ? <div className="legacy-feedback">正在加载帖子...</div> : null}

          <div className="whisper-list">
            {!loading && page.records.length === 0 ? <div className="legacy-feedback">当前没有匹配的帖子，换个筛选条件再试。</div> : null}

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
    </>
  );
}
