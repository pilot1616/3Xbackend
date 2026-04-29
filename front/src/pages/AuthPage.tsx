import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { getSecurityQuestion, login, register, resetPassword } from '../api/auth';
import { LegacyIcon } from '../components/LegacyIcon';
import { saveSession, useSession } from '../lib/session';

type Mode = 'login' | 'register' | 'reset';

const securityQuestionOptions = [
  { value: 'year', label: '你印象最深刻的一年是？' },
  { value: 'person', label: '你印象最深刻的人是？' },
  { value: 'book', label: '你印象最深刻的书是？' },
];

const phonePattern = /^1\d{10}$/;
const passwordPattern = /^(?=.*[A-Za-z])(?=.*\d).{6,}$/;

function normalizeRedirectPath(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) {
    return '/';
  }
  return value;
}

export function AuthPage() {
  const session = useSession();
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [securityQuestion, setSecurityQuestion] = useState('year');
  const [securityQuestionLabel, setSecurityQuestionLabel] = useState('');
  const [securityAnswer, setSecurityAnswer] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const navigate = useNavigate();
  const redirectPath = useMemo(() => normalizeRedirectPath(searchParams.get('redirect')), [searchParams]);

  useEffect(() => {
    const raw = localStorage.getItem('front-auth-remember');
    if (!raw) {
      return;
    }
    try {
      const remembered = JSON.parse(raw) as { username?: string; password?: string };
      setUsername(remembered.username ?? '');
      setRememberMe(Boolean(remembered.username));
      if (remembered.username) {
        localStorage.setItem('front-auth-remember', JSON.stringify({ username: remembered.username }));
      } else {
        localStorage.removeItem('front-auth-remember');
      }
    } catch {
      localStorage.removeItem('front-auth-remember');
    }
  }, []);

  useEffect(() => {
    if (!session) {
      return;
    }
    navigate(redirectPath);
  }, [navigate, redirectPath, session]);

  function resetFields(nextMode: Mode) {
    setMode(nextMode);
    setMessage(nextMode === 'register' ? '请使用手机号码注册，并且密码必须由字母和数字组成，且长度大于等于6位' : nextMode === 'reset' ? '请输入要更改密码的账号' : '');
    setPassword('');
    setConfirmPassword('');
    setSecurityQuestion('year');
    setSecurityQuestionLabel('');
    setSecurityAnswer('');
    setShowPassword(false);
    setShowConfirmPassword(false);
  }

  function validateForm() {
    if (!phonePattern.test(username.trim())) {
      return '请输入 11 位手机号';
    }
    if (!passwordPattern.test(password)) {
      return '密码必须至少 6 位，并同时包含字母和数字';
    }
    if (mode !== 'login' && password !== confirmPassword) {
      return '两次输入的密码不一致';
    }
    if (mode === 'register' && !securityAnswer.trim()) {
      return '密保答案不能为空';
    }
    if (mode === 'reset' && !securityQuestionLabel) {
      return '请先查询密保问题';
    }
    if (mode === 'reset' && !securityAnswer.trim()) {
      return '请输入密保答案';
    }
    return '';
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');

    const validationMessage = validateForm();
    if (validationMessage) {
      setMessage(validationMessage);
      return;
    }

    setLoading(true);

    try {
      if (mode === 'login') {
        const result = await login({ username: username.trim(), password });
        saveSession(result);
        if (rememberMe) {
          localStorage.setItem('front-auth-remember', JSON.stringify({ username: username.trim() }));
        } else {
          localStorage.removeItem('front-auth-remember');
        }
        navigate(redirectPath);
        return;
      }

      if (mode === 'register') {
        const result = await register({
          username: username.trim(),
          password,
          nickname: username.trim(),
          sign: '',
          security_question: securityQuestion,
          security_answer: securityAnswer.trim(),
        });
        saveSession(result);
        navigate(redirectPath);
        return;
      }

      const result = await resetPassword({ username: username.trim(), password, security_answer: securityAnswer.trim() });
      resetFields('login');
      setMessage(result.message);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '操作失败');
    } finally {
      setLoading(false);
    }
  }

  async function handleFetchQuestion() {
    setMessage('');
    if (!phonePattern.test(username.trim())) {
      setMessage('请先输入正确的 11 位手机号');
      return;
    }
    try {
      const result = await getSecurityQuestion(username.trim());
      const option = securityQuestionOptions.find((item) => item.value === result.security_question);
      setSecurityQuestion(result.security_question);
      setSecurityQuestionLabel(option?.label ?? result.security_question);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '获取密保问题失败');
    }
  }

  const title = mode === 'login' ? '登录' : mode === 'register' ? '注册' : '找回密码';
  const submitLabel = loading ? '处理中...' : mode === 'login' ? '登录' : mode === 'register' ? '注册' : '修改密码';

  return (
    <div className="auth-legacy-page">
      <div className="auth-page-overlay"></div>
      <div className="auth-page-center">
        <div className="auth-card-glass">
          <h2 className="auth-title-legacy">{title}</h2>

          <form className="auth-form-legacy" onSubmit={handleSubmit}>
            <input className="username" onChange={(event) => setUsername(event.target.value)} placeholder={mode === 'login' ? '请输入手机号' : '请输入注册手机号'} type="text" value={username} />

            <div className="auth-input-row">
              <input
                className="password"
                onChange={(event) => setPassword(event.target.value)}
                placeholder="请输入密码"
                type={showPassword ? 'text' : 'password'}
                value={password}
              />
              <button className="auth-toggle-visibility" onClick={() => setShowPassword((current) => !current)} type="button">
                <LegacyIcon name={showPassword ? 'eye-invisible' : 'eye'} size={18} />
              </button>
            </div>

            {mode !== 'login' ? (
              <div className="auth-input-row confirm-password">
                <input
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="请再次输入密码"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                />
                <button className="auth-toggle-visibility" onClick={() => setShowConfirmPassword((current) => !current)} type="button">
                  <LegacyIcon name={showConfirmPassword ? 'eye-invisible' : 'eye'} size={18} />
                </button>
              </div>
            ) : null}

            {mode === 'register' ? (
              <div className="layui-form layui-row layui-col-space16 auth-security-box">
                <div className="layui-col-md12">
                  <select id="securityQuestion" onChange={(event) => setSecurityQuestion(event.target.value)} value={securityQuestion}>
                    <option value="">请选择密保问题</option>
                    {securityQuestionOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : null}

            {mode === 'reset' ? (
              <button className="changeBtn auth-fetch-button" disabled={loading} onClick={handleFetchQuestion} type="button">
                查询密保问题
              </button>
            ) : null}

            {mode === 'reset' && securityQuestionLabel ? <div className="auth-question-box">{securityQuestionLabel}</div> : null}

            {mode !== 'login' ? <input className="security" onChange={(event) => setSecurityAnswer(event.target.value)} placeholder="请输入密保答案" type="text" value={securityAnswer} /> : null}

            {message ? <div className="error-message auth-error-legacy">{message}</div> : null}

            <button className="auth-submit-btn" disabled={loading} type="submit">
              {submitLabel}
            </button>

            <div className="footer auth-footer-legacy">
              <div className="Remember">
                <input checked={rememberMe} id="rememberMe" onChange={(event) => setRememberMe(event.target.checked)} type="checkbox" />
                <label htmlFor="rememberMe">记住我</label>
              </div>

              <button id="forget" onClick={() => resetFields('reset')} type="button">
                忘记密码
              </button>
              <button id="Password" onClick={() => resetFields(mode === 'register' ? 'login' : 'register')} type="button">
                {mode === 'register' ? '去登录' : '去注册'}
              </button>
              <button className="gotoIndex" onClick={() => navigate('/')} type="button">
                返回首页
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
