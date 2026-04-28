import { FormEvent, useEffect, useState } from 'react';
import { createComment, deleteComment, likeQuestion, listQuestions, unlikeQuestion, updateComment } from '../api/forum';
import { QuestionCard } from '../components/QuestionCard';
import { useSession } from '../lib/session';
import type { QuestionListPage, QuestionRecord } from '../types/api';

const emptyPage: QuestionListPage = {
  page: 1,
  page_size: 20,
  total: 0,
  records: [],
};

export function HomePage() {
  const session = useSession();
  const [page, setPage] = useState(emptyPage);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [keyword, setKeyword] = useState('');
  const [author, setAuthor] = useState('');
  const [sort, setSort] = useState('latest');
  const [submittingQid, setSubmittingQid] = useState<number | null>(null);

  useEffect(() => {
    void loadData();
  }, [sort, session?.token]);

  async function loadData() {
    setLoading(true);
    setMessage('');
    try {
      const result = await listQuestions({
        page: 1,
        pageSize: 20,
        keyword,
        author,
        sort,
        isUpload: 'true',
      });
      setPage(result);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '加载帖子失败');
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
      await loadData();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '点赞操作失败');
    } finally {
      setSubmittingQid(null);
    }
  }

  async function handleCommentSubmit(question: QuestionRecord, text: string) {
    if (!session) {
      setMessage('请先登录后再评论');
      return;
    }

    setSubmittingQid(question.qid);
    setMessage('');
    try {
      const updated = await createComment(question.qid, { text });
      setPage((current) => ({
        ...current,
        records: current.records.map((item) => (item.qid === updated.qid ? updated : item)),
      }));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '发表评论失败');
    } finally {
      setSubmittingQid(null);
    }
  }

  async function handleCommentUpdate(question: QuestionRecord, commentID: number, text: string) {
    if (!session) {
      setMessage('请先登录后再操作评论');
      return;
    }

    setSubmittingQid(question.qid);
    setMessage('');
    try {
      const updated = await updateComment(question.qid, commentID, { text });
      setPage((current) => ({
        ...current,
        records: current.records.map((item) => (item.qid === updated.qid ? updated : item)),
      }));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '更新评论失败');
    } finally {
      setSubmittingQid(null);
    }
  }

  async function handleCommentDelete(question: QuestionRecord, commentID: number) {
    if (!session) {
      setMessage('请先登录后再操作评论');
      return;
    }

    setSubmittingQid(question.qid);
    setMessage('');
    try {
      const updated = await deleteComment(question.qid, commentID);
      setPage((current) => ({
        ...current,
        records: current.records.map((item) => (item.qid === updated.qid ? updated : item)),
      }));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '删除评论失败');
    } finally {
      setSubmittingQid(null);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadData();
  }

  return (
    <>
      <div className="container legacy-home-banner">
        <form className="search-bar legacy-search-form" onSubmit={handleSubmit}>
          <input
            className="search-txt"
            onChange={(event) => setAuthor(event.target.value)}
            placeholder="输入你想查看的用户昵称或手机号..."
            value={author}
          />
          <button className="search-btn legacy-search-button" type="submit">
            <i className="layui-icon layui-icon-search" style={{ fontSize: 30, color: '#fff' }}></i>
          </button>
        </form>
      </div>

      <section className="content whisper-content">
        <div className="cont">
          {message ? <div className="legacy-feedback legacy-home-feedback">{message}</div> : null}
          {loading ? <div className="legacy-feedback">正在加载帖子...</div> : null}

          <div className="whisper-list">
            {!loading && page.records.length === 0 ? <div className="legacy-feedback">当前没有匹配的帖子，换个筛选条件再试。</div> : null}

            {page.records.map((question) => (
              <QuestionCard
                canInteract={Boolean(session)}
                currentUsername={session?.user.username}
                viewerAvatarPath={session?.user.avatar_path}
                detailHref={`/questions/${question.qid}`}
                key={question.qid}
                onCommentDelete={handleCommentDelete}
                onCommentSubmit={handleCommentSubmit}
                onCommentUpdate={handleCommentUpdate}
                onLikeToggle={handleLikeToggle}
                question={question}
                submitting={submittingQid === question.qid}
              />
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
