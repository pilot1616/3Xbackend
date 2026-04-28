import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { createComment, deleteComment, getQuestion, likeQuestion, listQuestions, unlikeQuestion, updateComment } from '../api/forum';
import { QuestionCard } from '../components/QuestionCard';
import { useSession } from '../lib/session';
import type { QuestionRecord } from '../types/api';

export function QuestionDetailPage() {
  const { qid } = useParams<{ qid: string }>();
  const session = useSession();
  const [question, setQuestion] = useState<QuestionRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [relatedQuestions, setRelatedQuestions] = useState<QuestionRecord[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);

  useEffect(() => {
    void loadQuestion();
  }, [qid, session?.token]);

  useEffect(() => {
    if (!question?.user) {
      setRelatedQuestions([]);
      return;
    }
    void loadRelatedQuestions(question.user, question.qid);
  }, [question?.user, question?.qid, session?.token]);

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

  async function loadRelatedQuestions(author: string, currentQid: number) {
    setRelatedLoading(true);
    try {
      const result = await listQuestions({
        author,
        sort: 'latest',
        isUpload: 'true',
        page: 1,
        pageSize: 6,
      });
      setRelatedQuestions(result.records.filter((item) => item.qid !== currentQid).slice(0, 5));
    } catch {
      setRelatedQuestions([]);
    } finally {
      setRelatedLoading(false);
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

  return (
    <section className="content whisper-content page-section">
      <div className="legacy-toolbar-card">
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
        <div className="legacy-grid two-column question-detail-layout">
          <div className="whisper-list">
            <QuestionCard
              canInteract={Boolean(session)}
              currentUsername={session?.user.username}
              viewerAvatarPath={session?.user.avatar_path}
              onCommentDelete={handleCommentDelete}
              onCommentSubmit={handleCommentSubmit}
              onCommentUpdate={handleCommentUpdate}
              onLikeToggle={handleLikeToggle}
              question={question}
              submitting={submitting}
            />
          </div>

          <aside className="legacy-card-list">
            <section className="legacy-panel">
              <h2>作者更多帖子</h2>
              {relatedLoading ? <div className="legacy-empty-inline">正在加载更多内容...</div> : null}
              {!relatedLoading && relatedQuestions.length === 0 ? <div className="legacy-empty-inline">当前没有更多可展示的帖子。</div> : null}
              {relatedQuestions.map((item) => (
                <article className="legacy-mini-card" key={item.qid}>
                  <strong>{item.nickName}</strong>
                  <p>{item.text}</p>
                  <span>{item.time}</span>
                  <Link className="legacy-action-button secondary small" to={`/questions/${item.qid}`}>
                    查看这条
                  </Link>
                </article>
              ))}
            </section>
          </aside>
        </div>
      ) : null}
    </section>
  );
}
