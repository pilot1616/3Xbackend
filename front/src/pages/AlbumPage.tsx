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
            <div className="layui-fluid" style={{ padding: 0 }}>
              <div className="layui-row layui-col-space30 space">
                {items.length === 0 && !message ? (
                  <div className="layui-col-xs12">
                    <div className="legacy-feedback">你还没有上传过附件，先去发布一条带图片或视频的帖子。</div>
                  </div>
                ) : null}

                {items.map((item) => (
                  <div className="layui-col-xs12 layui-col-sm4 layui-col-md4" key={`${item.qid}-${item.fileName}`}>
                    <div className="item">
                      <div className="imgBox legacy-album-media-box" style={{ height: 195, overflow: 'hidden' }}>
                        {isImage(item.fileName) ? (
                          <img alt={item.fileName} className="single-img" src={buildAssetUrl(`/public/uploads/${item.fileName}`)} />
                        ) : (
                          <video className="single-img" controls src={buildAssetUrl(`/public/uploads/${item.fileName}`)} />
                        )}
                      </div>
                      <div className="cont-text">
                        <div className="data">{item.time.split(' ')[0] ?? item.time}</div>
                        <p className="briefly">{item.text.length > 17 ? `${item.text.slice(0, 17)}...` : item.text}</p>
                        <Link className="legacy-inline-link" to={`/questions/${item.qid}`}>
                          查看原帖
                        </Link>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
