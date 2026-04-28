import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { buildUploadAssetUrl } from '../api/client';
import { listMyQuestions } from '../api/forum';
import { useSession } from '../lib/session';

const albumQuestionPageSize = 20;

type AlbumQuestionPageInfo = {
  page: number;
  pageSize: number;
  total: number;
  loaded: number;
};

const emptyPageInfo: AlbumQuestionPageInfo = {
  page: 1,
  pageSize: albumQuestionPageSize,
  total: 0,
  loaded: 0,
};

interface AlbumItem {
  qid: number;
  fileName: string;
  text: string;
  time: string;
}

function isImage(fileName: string) {
  return /\.(png|jpg|jpeg|gif)$/i.test(fileName);
}

export function AlbumPage() {
  const session = useSession();
  const [items, setItems] = useState<AlbumItem[]>([]);
  const [message, setMessage] = useState('');
  const [pageInfo, setPageInfo] = useState<AlbumQuestionPageInfo>(emptyPageInfo);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!session) {
      return;
    }
    void loadAlbum(1, true);
  }, [session]);

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
  }, [loading, loadingMore, hasMore, pageInfo.page, pageInfo.total]);

  async function loadAlbum(targetPage = 1, reset = false) {
    if (reset) {
      setLoading(true);
      setPageInfo(emptyPageInfo);
    } else {
      setLoadingMore(true);
    }
    setMessage('');
    try {
      const page = await listMyQuestions({
        page: targetPage,
        pageSize: albumQuestionPageSize,
        sort: 'latest',
      });
      const nextItems = page.records.flatMap((question) =>
        question.files.map((fileName) => ({
          qid: question.qid,
          fileName,
          text: question.text,
          time: question.time,
        })),
      );

      setItems((current) => {
        if (reset) {
          return nextItems;
        }

        const merged = [...current];
        nextItems.forEach((item) => {
          if (!merged.some((currentItem) => currentItem.qid === item.qid && currentItem.fileName === item.fileName)) {
            merged.push(item);
          }
        });
        return merged;
      });

      setPageInfo((current) => ({
        page: page.page,
        pageSize: page.page_size,
        total: page.total,
        loaded: reset ? page.records.length : current.loaded + page.records.length,
      }));
      setHasMore(targetPage * page.page_size < page.total);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '加载相册失败');
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
    await loadAlbum(pageInfo.page + 1, false);
  }

  async function reloadCurrentWindow() {
    const loadedPages = Math.max(1, Math.ceil(pageInfo.loaded / Math.max(1, albumQuestionPageSize)));
    setLoading(true);
    setMessage('');
    try {
      const results = await Promise.all(
        Array.from({ length: loadedPages }, (_, index) =>
          listMyQuestions({
            page: index + 1,
            pageSize: albumQuestionPageSize,
            sort: 'latest',
          }),
        ),
      );

      const merged = results.flatMap((result) =>
        result.records.flatMap((question) =>
          question.files.map((fileName) => ({
            qid: question.qid,
            fileName,
            text: question.text,
            time: question.time,
          })),
        ),
      );

      const loaded = results.reduce((sum, result) => sum + result.records.length, 0);
      const lastPage = results[results.length - 1];
      setItems(merged);
      setPageInfo({
        page: lastPage?.page ?? 1,
        pageSize: lastPage?.page_size ?? albumQuestionPageSize,
        total: lastPage?.total ?? 0,
        loaded,
      });
      setHasMore(lastPage ? loaded < lastPage.total : false);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '刷新相册失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {!session ? (
        <div id="noLogined">
          <div id="loginReminder" style={{ textAlign: 'center', padding: 50 }}>
            <h2>请登录</h2>
            <p>当前页面需要登录才能访问，请先登录。</p>
            <Link className="legacy-action-button" to="/auth">
              去登录
            </Link>
          </div>
        </div>
      ) : null}

      {session ? (
        <div className="album-content w1000 legacy-album-page">
          {message ? <div className="legacy-feedback legacy-home-feedback">{message}</div> : null}

          <div className="img-list">
            {loading ? <div className="legacy-feedback">正在加载相册...</div> : null}

            {!loading && pageInfo.loaded > 0 ? (
              <div className="legacy-home-load-status">
                <span>
                  已收集 {items.length} 个附件，已扫描 {pageInfo.loaded} / {pageInfo.total} 条帖子
                </span>
                <button className="legacy-action-button secondary small" onClick={() => void reloadCurrentWindow()} type="button">
                  刷新当前相册
                </button>
              </div>
            ) : null}

            {!loading && !loadingMore && !hasMore && items.length === 0 && !message ? <div className="legacy-feedback">你还没有上传过附件，先去发布一条带图片或视频的帖子。</div> : null}

            {items.length > 0 ? (
              <div className="legacy-album-grid">
                {items.map((item) => (
                  <article className="legacy-album-item" key={`${item.qid}-${item.fileName}`}>
                    <div className="imgBox legacy-album-media-box">
                      {isImage(item.fileName) ? (
                        <img alt={item.fileName} className="single-img" src={buildUploadAssetUrl(item.fileName)} />
                      ) : (
                        <video className="single-img" controls src={buildUploadAssetUrl(item.fileName)} />
                      )}
                    </div>
                    <div className="cont-text legacy-album-copy">
                      <div className="data">{item.time.split(' ')[0] ?? item.time}</div>
                      <p className="briefly">{item.text.length > 34 ? `${item.text.slice(0, 34)}...` : item.text}</p>
                      <Link className="legacy-inline-link" to={`/questions/${item.qid}`}>
                        查看原帖
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}

            {loadingMore ? <div className="legacy-feedback legacy-home-feedback">正在继续加载更多相册内容...</div> : null}
            {!loading && !hasMore && items.length > 0 ? <div className="legacy-feedback legacy-home-feedback">已经到底了，全部相册内容都加载完成。</div> : null}
            <div className="legacy-home-load-anchor" ref={loadMoreRef}></div>
          </div>
        </div>
      ) : null}
    </>
  );
}
