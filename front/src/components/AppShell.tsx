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
    const phone = params.get('phone') ?? '';
    const legacySearchType = params.get('searchType');

    if (keyword) {
      setSearchMode('content');
      setSearchKeyword(keyword);
      return;
    }

    if (phone) {
      setSearchMode('phone');
      setSearchKeyword(phone);
      return;
    }

    if (author && legacySearchType === 'phone') {
      setSearchMode('phone');
      setSearchKeyword(author);
      return;
    }

    if (author) {
      setSearchMode('author');
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
    params.delete('phone');
    params.delete('searchType');

    if (keyword) {
      if (searchMode === 'content') {
        params.set('keyword', keyword);
      } else if (searchMode === 'phone') {
        params.set('phone', keyword);
      } else {
        params.set('author', keyword);
      }
    }

    navigate({
      pathname: '/',
      search: params.toString() ? `?${params.toString()}` : '',
    });
  }

  function handleHeaderSearchReset() {
    setSearchMode('content');
    setSearchKeyword('');
    navigate('/');
  }

  const hasSearchValue = searchKeyword.trim().length > 0;

  return (
    <div className="legacy-app-shell">
      <header className={`simple-page-header${showHeaderSearch ? ' has-search' : ' compact'}`}>
        <div className="simple-header-main-row">
          <h1 className="simple-header-brand">
            <Link to="/">
              <img alt="3X" className="legacy-brand-mark" src="/legacy/res/img/logo.png" />
            </Link>
          </h1>

          <nav className="simple-header-links" aria-label="主导航">
            <NavLink className={navClassName} end to="/">
              首页
            </NavLink>
            <NavLink className={navClassName} to="/publish">
              发布/管理
            </NavLink>
            <NavLink className={navClassName} to="/market">
              市场动态
            </NavLink>
            <NavLink className={navClassName} to="/analysis">
              AI 分析
            </NavLink>
            <NavLink className={navClassName} to="/ai-daily">
              AI 日报
            </NavLink>
            <NavLink className={navClassName} to="/ai-chat">
              AI 聊天
            </NavLink>
            <NavLink className={navClassName} to="/profile">
              我的资料
            </NavLink>
            {session?.user.is_admin ? (
              <NavLink className={navClassName} to="/admin/sync">
                后台同步
              </NavLink>
            ) : null}
          </nav>

          <div className="simple-header-auth">
            {session ? (
              <div className="simple-session-bar">
                <Link className="simple-session-link" to="/profile">
                  <img alt={session.user.nickname || session.user.username} className="simple-session-avatar" src={buildAssetUrl(session.user.avatar_path)} />
                  <div className="simple-session-copy">
                    <span className="simple-session-user">{session.user.nickname || session.user.username}</span>
                    <span className="simple-session-name">{session.user.username}</span>
                  </div>
                </Link>
                <button className="simple-session-action simple-session-action-danger" onClick={() => clearSession()} type="button">
                  退出登录
                </button>
              </div>
            ) : (
              <Link className="simple-session-action" to={`/auth?redirect=${encodeURIComponent(`${location.pathname}${location.search}`)}`}>
                登录/注册
              </Link>
            )}
          </div>
        </div>

        {showHeaderSearch ? (
          <div className="simple-header-search-wrap">
            <form className="simple-header-search" onSubmit={handleHeaderSearchSubmit}>
              <select aria-label="搜索类型" className="simple-header-search-mode" onChange={(event) => setSearchMode(event.target.value as GlobalSearchMode)} value={searchMode}>
                <option value="content">按内容</option>
                <option value="author">按作者</option>
                <option value="phone">按手机号</option>
              </select>
              <span className="simple-header-search-divider" aria-hidden="true"></span>
              <input aria-label="搜索内容" id="global-home-search" onChange={(event) => setSearchKeyword(event.target.value)} placeholder={searchPlaceholderMap[searchMode]} ref={searchInputRef} type="search" value={searchKeyword} />
              <span aria-hidden="true" className="simple-header-search-hotkey">/</span>
              {hasSearchValue ? (
                <button className="simple-header-search-reset" onClick={handleHeaderSearchReset} type="button">
                  清空
                </button>
              ) : null}
              <button className="simple-header-search-button" type="submit">
                搜索
              </button>
            </form>
          </div>
        ) : null}
      </header>

      <Outlet />

      <footer className="legacy-site-footer">
        <div className="legacy-site-footer-shell">
          <div className="legacy-site-footer-top">
            <section className="legacy-site-footer-brand">
              <span className="legacy-site-footer-badge">3X Community Console</span>
              <h2>社区提问、市场数据和 AI 分析在这里汇合。</h2>
              <p>帖子互动、行情同步、日报阅读和数据库问答共用同一套账号与数据链路，适合作为持续浏览的内部工作台。</p>
            </section>

            <section className="legacy-site-footer-card">
              <span className="legacy-site-footer-label">常用入口</span>
              <div className="legacy-site-footer-list">
                <div>
                  <LegacyIcon name="survey" size={14} />
                  <Link to="/publish">发布与管理帖子</Link>
                </div>
                <div>
                  <LegacyIcon name="survey" size={14} />
                  <Link to="/market">查看市场动态</Link>
                </div>
                <div>
                  <LegacyIcon name="reply-fill" size={14} />
                  <Link to="/ai-chat">继续 AI 对话</Link>
                </div>
              </div>
            </section>

            <section className="legacy-site-footer-card">
              <span className="legacy-site-footer-label">数据状态</span>
              <div className="legacy-site-footer-list">
                <div>
                  <LegacyIcon name="date" size={14} />
                  <span>市场与日报由后台定时同步</span>
                </div>
                <div>
                  <LegacyIcon name="friends" size={14} />
                  <span>登录后可手动同步和继续会话</span>
                </div>
              </div>
              <p className="legacy-site-footer-note">如果页面暂无数据，请先确认后端同步任务或在登录后手动触发同步。</p>
            </section>

            <section className="legacy-site-footer-card legacy-site-footer-ad-card">
              <span className="legacy-site-footer-label">当前会话</span>
              <div className="legacy-site-footer-list">
                <div>
                  <LegacyIcon name="cellphone" size={14} />
                  <span>{session ? session.user.username : '未登录'}</span>
                </div>
                <div>
                  <LegacyIcon name="home" size={14} />
                  <span>{session ? session.user.nickname || '已登录用户' : '登录后可发布、点赞和同步'}</span>
                </div>
              </div>
            </section>
          </div>

          <div className="legacy-site-footer-bottom">
            <span>3Xbackend · Go API + React Console + LangGraph Agent</span>
            <span>页面数据来自 MySQL 快照表和社区内容表。</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
