import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { buildAssetUrl } from '../api/client';
import { listMyQuestions } from '../api/forum';
import { useSession } from '../lib/session';

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

  useEffect(() => {
    if (!session) {
      return;
    }
    void loadAlbum();
  }, [session]);

  async function loadAlbum() {
    try {
      const page = await listMyQuestions({ sort: 'latest' });
      const nextItems = page.records.flatMap((question) =>
        question.files.map((fileName) => ({
          qid: question.qid,
          fileName,
          text: question.text,
          time: question.time,
        })),
      );
      setItems(nextItems);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '加载相册失败');
    }
  }

  if (!session) {
    return (
      <section className="page-section narrow">
        <div className="legacy-empty-card">
          <h2>请先登录</h2>
          <p>这里对应旧版 `album.html`，以后会展示当前用户发帖时上传过的全部附件。</p>
          <Link className="legacy-action-button" to="/auth">
            去登录
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="album-content w1000 page-section">
      <div className="legacy-toolbar-card">
        <div>
          <h2>我的附件相册</h2>
          <p>这里对应旧版 `album.html`，当前直接从“我的帖子”接口中抽取附件展示。</p>
        </div>
      </div>

      {message ? <div className="legacy-feedback">{message}</div> : null}

      {items.length === 0 && !message ? <div className="legacy-feedback">你还没有上传过附件，先去发布一条带图片或视频的帖子。</div> : null}

      <div className="legacy-album-grid">
        {items.map((item) => (
          <article className="legacy-album-item" key={`${item.qid}-${item.fileName}`}>
            {isImage(item.fileName) ? (
              <img alt={item.fileName} src={buildAssetUrl(`/public/uploads/${item.fileName}`)} />
            ) : (
              <video controls src={buildAssetUrl(`/public/uploads/${item.fileName}`)} />
            )}
            <div>
              <strong>QID {item.qid}</strong>
              <p>{item.time}</p>
              <p>{item.text}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
