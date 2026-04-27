import { request } from './client';
import type { AuthResult, MessageResult, ProfileUpdateResult, SecurityQuestionResult, User } from '../types/api';

export function login(payload: { username: string; password: string }) {
  return request<AuthResult>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function register(payload: {
  username: string;
  password: string;
  nickname: string;
  sign: string;
  security_question: string;
  security_answer: string;
}) {
  return request<AuthResult>('/api/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getSecurityQuestion(username: string) {
  return request<SecurityQuestionResult>(`/api/v1/auth/security-question?username=${encodeURIComponent(username)}`);
}

export function resetPassword(payload: { username: string; password: string; security_answer: string }) {
  return request<MessageResult>('/api/v1/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getMe() {
  const result = await request<{ user: User }>('/api/v1/users/me');
  return result.user;
}

export function updateMe(payload: { nickname: string; age: number; hobby: string; sign: string }) {
  return request<ProfileUpdateResult>('/api/v1/users/me', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function uploadAvatar(file: File) {
  const formData = new FormData();
  formData.append('image', file);
  return request<{ saved: boolean; path: string }>('/api/v1/users/me/avatar', {
    method: 'POST',
    body: formData,
  });
}
