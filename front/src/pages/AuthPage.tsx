import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { getSecurityQuestion, login, register, resetPassword } from '../api/auth';
import { saveSession } from '../lib/session';

type Mode = 'login' | 'register' | 'reset';

const securityQuestionOptions = [
  { value: 'year', label: '你印象最深刻的一年是？' },
  { value: 'person', label: '你印象最深刻的人是？' },
  { value: 'book', label: '你印象最深刻的书是？' },
];

const phonePattern = /^1\d{10}$/;
const passwordPattern = /^(?=.*[A-Za-z])(?=.*\d).{6,}$/;

export function AuthPage() {
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [sign, setSign] = useState('');
  const [securityQuestion, setSecurityQuestion] = useState('year');
  const [securityQuestionLabel, setSecurityQuestionLabel] = useState('');
  const [securityAnswer, setSecurityAnswer] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

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

    if (mode === 'register' && !nickname.trim()) {
      return '昵称不能为空';
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
        navigate('/');
        return;
      }

      if (mode === 'register') {
        const result = await register({
          username: username.trim(),
          password,
          nickname: nickname.trim(),
          sign: sign.trim(),
          security_question: securityQuestion,
          security_answer: securityAnswer.trim(),
        });
        saveSession(result);
        navigate('/');
        return;
      }

      const result = await resetPassword({ username: username.trim(), password, security_answer: securityAnswer.trim() });
      setMessage(result.message);
      setMode('login');
      setSecurityQuestionLabel('');
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

  return (
    <div className="auth-legacy-page">
      <div className="shell auth-shell-legacy">
        <h2 className="title auth-title-legacy">{mode === 'login' ? 'Login' : mode === 'register' ? 'Register' : 'Change'}</h2>

        <form className="auth-form-legacy" onSubmit={handleSubmit}>
          <input onChange={(event) => setUsername(event.target.value)} placeholder="手机号" type="text" value={username} />
          <input onChange={(event) => setPassword(event.target.value)} placeholder="密码" type="password" value={password} />

          {mode !== 'login' ? (
            <input onChange={(event) => setConfirmPassword(event.target.value)} placeholder="确认密码" type="password" value={confirmPassword} />
          ) : null}

          {mode === 'register' ? <input onChange={(event) => setNickname(event.target.value)} placeholder="昵称" type="text" value={nickname} /> : null}
          {mode === 'register' ? <input onChange={(event) => setSign(event.target.value)} placeholder="签名" type="text" value={sign} /> : null}

          {mode === 'register' ? (
            <select className="auth-select-legacy" onChange={(event) => setSecurityQuestion(event.target.value)} value={securityQuestion}>
              {securityQuestionOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : null}

          {mode === 'reset' ? (
            <button className="auth-secondary-button" onClick={handleFetchQuestion} type="button">
              查询密保问题
            </button>
          ) : null}

          {mode === 'reset' && securityQuestionLabel ? <div className="auth-question-box">密保问题：{securityQuestionLabel}</div> : null}

          {mode !== 'login' ? (
            <input onChange={(event) => setSecurityAnswer(event.target.value)} placeholder="密保答案" type="text" value={securityAnswer} />
          ) : null}

          {message ? <div className="error-message auth-error-legacy">{message}</div> : null}

          <input
            className="loginBtn"
            disabled={loading}
            type="submit"
            value={loading ? '处理中...' : mode === 'login' ? '登录' : mode === 'register' ? '注册' : '重置密码'}
          />
        </form>

        <div className="footer auth-footer-legacy">
          <button id="Password" onClick={() => setMode(mode === 'register' ? 'login' : 'register')} type="button">
            {mode === 'register' ? '去登录' : '去注册'}
          </button>
          <button id="forget" onClick={() => setMode('reset')} type="button">
            忘记密码
          </button>
          <button id="forget" onClick={() => navigate('/')} type="button">
            返回首页
          </button>
        </div>
      </div>
    </div>
  );
}
