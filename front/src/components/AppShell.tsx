import { Link, NavLink, Outlet } from 'react-router-dom';

import { API_BASE_URL } from '../api/client';
import { clearSession, useSession } from '../lib/session';

function navClassName({ isActive }: { isActive: boolean }) {
  return isActive ? 'active' : undefined;
}

export function AppShell() {
  const session = useSession();

  return (
    <div className="legacy-app-shell">
      <div className="header w1000">
        <h1 className="logo">
          <Link to="/">
            <span>MYBLOG</span>
            <img alt="3X" src="/legacy/res/img/logo.png" style={{ width: 80 }} />
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
        <div className="login-text">
          {session ? (
            <div className="legacy-session-bar">
              <span className="legacy-session-user">{session.user.nickname || session.user.username}</span>
              <button className="layui-btn layui-btn-danger layui-btn-radius" onClick={() => clearSession()} type="button">
                退出登录
              </button>
            </div>
          ) : (
            <Link className="layui-btn layui-btn-radius" to="/auth">
              登录/注册
            </Link>
          )}
        </div>
      </div>

      <Outlet />

      <footer>
        <div className="footerCenter">
          <div className="w1000">
            <div className="footerCenterLeft">
              <div className="fclWordBoxOne">
                <div className="fclAbout">About Us</div>
                <div className="fclLineOne"></div>
              </div>
              <div className="fclWordBoxTwo">
                <div className="fclwbtWordOne">
                  TypeScript 重写版前端正在替换原来的 jQuery 示例页面。当前阶段先复用旧 UI，逐步把数据流切换到正式 Go API。
                </div>
                <div className="fclwbtWordTwo iconfont">后端地址: {API_BASE_URL}</div>
                <div className="fclwbtWordThree iconfont">前端目录: /front</div>
                <div className="fclwbtWordFourth iconfont">当前策略: 旧视觉 + 新接口</div>
              </div>
              <img alt="ad" src="/legacy/res/img/ad.jpg" style={{ float: 'right', width: 200 }} />
              <div className="fbWord">@2026 3X Forum Front Rewrite</div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
