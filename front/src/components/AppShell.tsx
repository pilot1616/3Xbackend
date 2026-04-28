import { Link, NavLink, Outlet } from 'react-router-dom';

import { clearSession, useSession } from '../lib/session';

function navClassName({ isActive }: { isActive: boolean }) {
  return isActive ? 'active' : undefined;
}

export function AppShell() {
  const session = useSession();

  return (
    <div className="legacy-app-shell">
      <div className="header w1000">
        <div className="menu-btn">
          <div className="menu"></div>
        </div>
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
            <button className="layui-btn layui-btn-danger layui-btn-radius" onClick={() => clearSession()} type="button">
              退出登录
            </button>
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
                  Hidden Hills property with mountain and city view boast <br /> none bedrooms including a master suite with private <br /> terrace and an entertainment.wing which includes a 20- <br /> seat theater.
                </div>
                <div className="fclwbtWordTwo iconfont">
                  <i className="layui-icon layui-icon-home" style={{ fontSize: 12 }}></i> 15 Cliff St,New York NY 10038,USA
                </div>
                <div className="fclwbtWordThree iconfont">
                  <i className="layui-icon layui-icon-cellphone" style={{ fontSize: 12 }}></i> +1 212-602-9641
                </div>
                <div className="fclwbtWordFourth iconfont">
                  <i className="layui-icon layui-icon-email" style={{ fontSize: 12 }}></i> info@example.com
                </div>
              </div>
              <div className="fclWordBoxThree">
                <i className="layui-icon layui-icon-friends" style={{ fontSize: 20 }}></i>
                <i className="layui-icon layui-icon-login-weibo" style={{ fontSize: 20 }}></i>
                <i className="layui-icon layui-icon-survey" style={{ fontSize: 20 }}></i>
                <i className="layui-icon layui-icon-login-wechat" style={{ fontSize: 20 }}></i>
                <i className="layui-icon layui-icon-login-qq" style={{ fontSize: 20 }}></i>
              </div>
              <img alt="ad" src="/legacy/res/img/ad.jpg" style={{ float: 'right', width: 200 }} />
              <div className="fbWord">@2019,Digiqole-News Magazine html Template.All rights reserved.</div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
