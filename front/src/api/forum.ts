import { request } from './client';
import type {
  CommentListPage,
  DeleteQuestionResult,
  FileDeleteResult,
  FileUploadResult,
  LikeListPage,
  LikeResult,
  MyCommentListPage,
  MyLikeListPage,
  MySummaryResult,
  QuestionListPage,
  QuestionRecord,
  ToggleUploadResult,
} from '../types/api';

export interface QuestionQuery {
  page?: number;
  pageSize?: number;
  author?: string;
  keyword?: string;
  sort?: string;
  isUpload?: string;
}

function toQueryString(query: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== '') {
      params.set(key, String(value));
    }
  });
  const result = params.toString();
  return result ? `?${result}` : '';
}

export function listQuestions(query: QuestionQuery = {}) {
  return request<QuestionListPage>(
    `/api/v1/questions${toQueryString({
      page: query.page,
      page_size: query.pageSize,
      author: query.author,
      keyword: query.keyword,
      sort: query.sort,
      is_upload: query.isUpload,
    })}`,
  );
}

export function getQuestion(qid: number) {
  return request<QuestionRecord>(`/api/v1/questions/${qid}`);
}

export function listQuestionComments(qid: number, page = 1, pageSize = 20) {
  return request<CommentListPage>(`/api/v1/questions/${qid}/comments${toQueryString({ page, page_size: pageSize })}`);
}

export function listQuestionLikes(qid: number, page = 1, pageSize = 20) {
  return request<LikeListPage>(`/api/v1/questions/${qid}/likes${toQueryString({ page, page_size: pageSize })}`);
}

export function createQuestion(payload: { text: string; nickName?: string; files?: string[]; imgName?: string[] }) {
  return request<QuestionRecord>('/api/v1/questions', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateQuestion(
  qid: number,
  payload: { text?: string; nickName?: string; isUpload?: boolean; files?: string[]; imgName?: string[] },
) {
  return request<QuestionRecord>(`/api/v1/questions/${qid}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function deleteQuestion(qid: number) {
  return request<DeleteQuestionResult>(`/api/v1/questions/${qid}`, {
    method: 'DELETE',
  });
}

export function toggleQuestionUpload(qid: number) {
  return request<ToggleUploadResult>(`/api/v1/questions/${qid}/toggle-upload`, {
    method: 'POST',
  });
}

export function createComment(qid: number, payload: { text: string }) {
  return request<QuestionRecord>(`/api/v1/questions/${qid}/comments`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateComment(qid: number, commentID: number, payload: { text: string }) {
  return request<QuestionRecord>(`/api/v1/questions/${qid}/comments/${commentID}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function deleteComment(qid: number, commentID: number) {
  return request<QuestionRecord>(`/api/v1/questions/${qid}/comments/${commentID}`, {
    method: 'DELETE',
  });
}

export function likeQuestion(qid: number) {
  return request<LikeResult>(`/api/v1/questions/${qid}/like`, {
    method: 'POST',
  });
}

export function unlikeQuestion(qid: number) {
  return request<LikeResult>(`/api/v1/questions/${qid}/like`, {
    method: 'DELETE',
  });
}

export function listMyQuestions(query: Omit<QuestionQuery, 'author'> = {}) {
  return request<QuestionListPage>(
    `/api/v1/users/me/questions${toQueryString({
      page: query.page,
      page_size: query.pageSize,
      keyword: query.keyword,
      sort: query.sort,
      is_upload: query.isUpload,
    })}`,
  );
}

export function listMyComments(page = 1, pageSize = 20, keyword = '') {
  return request<MyCommentListPage>(`/api/v1/users/me/comments${toQueryString({ page, page_size: pageSize, keyword })}`);
}

export function listMyLikes(page = 1, pageSize = 20, keyword = '') {
  return request<MyLikeListPage>(`/api/v1/users/me/likes${toQueryString({ page, page_size: pageSize, keyword })}`);
}

export function getMySummary() {
  return request<MySummaryResult>('/api/v1/users/me/summary');
}

export function uploadQuestionFiles(qid: number, files: File[]) {
  const formData = new FormData();
  files.forEach((file) => formData.append('files', file));
  return request<FileUploadResult>(`/api/v1/questions/${qid}/files`, {
    method: 'POST',
    body: formData,
  });
}

export function deleteQuestionFile(qid: number, fileName: string) {
  return request<FileDeleteResult>(`/api/v1/questions/${qid}/files/${encodeURIComponent(fileName)}`, {
    method: 'DELETE',
  });
}
