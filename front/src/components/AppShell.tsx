import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';

import { buildAssetUrl } from '../api/client';
import { LegacyIcon } from './LegacyIcon';
import { clearSession, useSession } from '../lib/session';

type GlobalSearchMode = 'content' | 'author' | 'phone';

const searchPlaceholderMap: Record<GlobalSearchMode, string> = {
  content: '搜索帖子内容',
  author: '搜索作者昵称',
  phone: '搜索手机号',
};

function navClassName({ isActive }: { isActive: boolean }) {
  return isActive ? 'active' : undefined;
}

export function AppShell() {
  const session = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const showHeaderSearch = location.pathname === '/';
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchMode, setSearchMode] = useState<GlobalSearchMode>('content');
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (location.pathname !== '/') {
      return;
    }
    const params = new URLSearchParams(location.search);
    const keyword = params.get('keyword') ?? '';
    const author = params.get('author') ?? '';
    const type = params.get('searchType');

    if (keyword) {
      setSearchMode('content');
      setSearchKeyword(keyword);
      return;
    }

    if (author) {
      setSearchMode(type === 'phone' ? 'phone' : 'author');
      setSearchKeyword(author);
      return;
    }

    setSearchMode('content');
    setSearchKeyword('');
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!showHeaderSearch) {
      return;
    }

    function handleShortcut(event: KeyboardEvent) {
      if (event.key !== '/') {
        return;
      }

      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      event.preventDefault();
      searchInputRef.current?.focus();
    }

    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [showHeaderSearch]);

  function handleHeaderSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const keyword = searchKeyword.trim();
    const params = location.pathname === '/' ? new URLSearchParams(location.search) : new URLSearchParams();

    params.delete('keyword');
    params.delete('author');
    params.delete('searchType');

    if (keyword) {
      if (searchMode === 'content') {
        params.set('keyword', keyword);
      } else {
        params.set('author', keyword);
        params.set('searchType', searchMode);
      }
    }

    navigate({
      pathname: '/',
      search: params.toString() ? `?${params.toString()}` : '',
    });
  }

  return (
    <div className="legacy-app-shell">
      <div className={`header w1000${showHeaderSearch ? ' legacy-header-with-search' : ' legacy-header-compact'}`}>
        <h1 className="logo">
          <Link to="/">
            <img alt="3X" className="legacy-brand-mark" src="/legacy/res/img/logo.png" />
          </Link>
        </h1>
        <div className="nav">
          <NavLink className={navClassName} to="/">
            首页
          </NavLink>
          <NavLink className={navClassName} to="/publish">
            发布问题
          </NavLink>
          <NavLink className={navClassName} to="/album">
            相册
          </NavLink>
          <NavLink className={navClassName} to="/profile">
            我的资料
          </NavLink>
        </div>
        {showHeaderSearch ? (
          <div className="legacy-header-tools">
            <form className="legacy-header-search" onSubmit={handleHeaderSearchSubmit}>
              <select aria-label="搜索类型" className="legacy-header-search-mode" onChange={(event) => setSearchMode(event.target.value as GlobalSearchMode)} value={searchMode}>
                <option value="content">按内容</option>
                <option value="author">按作者</option>
                <option value="phone">按手机号</option>
              </select>
              <span className="legacy-header-search-divider" aria-hidden="true"></span>
              <input aria-label="搜索内容" onChange={(event) => setSearchKeyword(event.target.value)} placeholder={searchPlaceholderMap[searchMode]} ref={searchInputRef} type="search" value={searchKeyword} />
              <span aria-hidden="true" className="legacy-header-search-hotkey">/</span>
              <button className="legacy-search-button" type="submit">
                <LegacyIcon name="search" size={18} />
              </button>
            </form>
          </div>
        ) : null}
        <div className="login-text">
          {session ? (
            <div className="legacy-session-bar">
              <Link className="legacy-session-link" to="/profile">
                <img alt={session.user.nickname || session.user.username} className="legacy-session-avatar" src={buildAssetUrl(session.user.avatar_path)} />
                <div className="legacy-session-copy">
                  <span className="legacy-session-user">{session.user.nickname || session.user.username}</span>
                  <span className="legacy-login-name">{session.user.username}</span>
                </div>
              </Link>
              <button className="legacy-session-action legacy-session-action-danger" onClick={() => clearSession()} type="button">
                退出登录
              </button>
            </div>
          ) : (
            <Link className="legacy-session-action" to="/auth">
              登录/注册
            </Link>
          )}
        </div>
      </div>

      <Outlet />

      <footer className="legacy-site-footer">
        <div className="legacy-site-footer-shell">
          <div className="legacy-site-footer-top">
            <section className="legacy-site-footer-brand">
              <span className="legacy-site-footer-badge">3X Community Console</span>
              <h2>把提问、相册和个人轨迹收纳进一块可持续浏览的数字工作台。</h2>
              <p>现在的前端已经改写为 TypeScript 单页应用，页面通过空间层次、玻璃质感和冷色光影统一到同一套 3D Elements 视觉系统。</p>
            </section>

            <section className="legacy-site-footer-card">
              <span className="legacy-site-footer-label">联系信息</span>
              <div className="legacy-site-footer-list">
                <div>
                  <LegacyIcon name="home" size={14} />
                  <span>15 Cliff St, New York NY 10038, USA</span>
                </div>
                <div>
                  <LegacyIcon name="cellphone" size={14} />
                  <span>+1 212-602-9641</span>
                </div>
                <div>
                  <LegacyIcon name="email" size={14} />
                  <span>info@example.com</span>
                </div>
              </div>
            </section>

            <section className="legacy-site-footer-card">
              <span className="legacy-site-footer-label">社区触点</span>
              <div className="legacy-site-footer-social">
                <span><LegacyIcon name="friends" size={18} /></span>
                <span><LegacyIcon name="weibo" size={18} /></span>
                <span><LegacyIcon name="survey" size={18} /></span>
                <span><LegacyIcon name="wechat" size={18} /></span>
                <span><LegacyIcon name="qq" size={18} /></span>
              </div>
              <p className="legacy-site-footer-note">保留原示例站的社交触点信息，同时统一到新的深色控制台语义里。</p>
            </section>

            <section className="legacy-site-footer-card legacy-site-footer-ad-card">
              <span className="legacy-site-footer-label">展示位</span>
              <img alt="ad" className="legacy-site-footer-ad" src="/legacy/res/img/ad.jpg" />
            </section>
          </div>

          <div className="legacy-site-footer-bottom">
            <span>@2019 Digiqole-News Magazine html Template. All rights reserved.</span>
            <span>Rebuilt for 3X with Go backend and TypeScript frontend.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
