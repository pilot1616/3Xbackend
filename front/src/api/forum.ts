import { request, uploadRequest } from './client';
import type {
  AgentPromptRequest,
  AgentPromptResponse,
  AgentChatRequest,
  AgentChatResponse,
  AgentConversationListResponse,
  AgentMessageListResponse,
  AIDailyResponse,
  AIDailySyncResult,
  AITrendAnalysisResponse,
  AnalysisWindow,
  CommentListPage,
  DeleteQuestionResult,
  FileDeleteResult,
  FileUploadResult,
  FullHistorySyncResult,
  LikeListPage,
  LikeResult,
  MyCommentListPage,
  MyLikeListPage,
  MySummaryResult,
  OverviewAnalysisResponse,
  PreciousMetalMarketResponse,
  PreciousMetalSyncResult,
  QuestionListPage,
  QuestionRecord,
  TechMarketResponse,
  TechMarketSyncResult,
  ToggleUploadResult,
  MarketTrendAnalysisResponse,
} from '../types/api';

export interface QuestionQuery {
  page?: number;
  pageSize?: number;
  author?: string;
  phone?: string;
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
      phone: query.phone,
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

export function getPreciousMetalMarket(historyLimit = 24) {
  return request<PreciousMetalMarketResponse>(`/api/v1/market/precious-metals${toQueryString({ history_limit: historyLimit })}`);
}

export function syncPreciousMetalMarket(rounds = 1, intervalMs = 800) {
  return request<PreciousMetalSyncResult>(`/api/v1/admin/sync/precious-metals${toQueryString({ rounds, interval_ms: intervalMs })}`, {
    method: 'POST',
  });
}

export function getTechMarket(historyLimit = 24) {
  return request<TechMarketResponse>(`/api/v1/market/ai-tech${toQueryString({ history_limit: historyLimit })}`);
}

export function syncTechMarket(rounds = 1, intervalMs = 800) {
  return request<TechMarketSyncResult>(`/api/v1/admin/sync/ai-tech${toQueryString({ rounds, interval_ms: intervalMs })}`, {
    method: 'POST',
  });
}

export function getAIDailies(limit = 20, keyword = '', offset = 0) {
  return request<AIDailyResponse>(`/api/v1/ai-dailies${toQueryString({ limit, keyword, offset })}`);
}

export function syncAIDailies(rounds = 1, intervalMs = 800) {
  return request<AIDailySyncResult>(`/api/v1/admin/sync/ai-dailies${toQueryString({ rounds, interval_ms: intervalMs })}`, {
    method: 'POST',
  });
}

export function syncFullHistory(aiDailyMaxEntries = 10000) {
  return request<FullHistorySyncResult>(`/api/v1/admin/sync/full-history${toQueryString({ ai_daily_max_entries: aiDailyMaxEntries })}`, {
    method: 'POST',
  });
}

export function getAITrend(window?: AnalysisWindow) {
  return request<AITrendAnalysisResponse>(`/api/v1/analysis/ai-trend${toQueryString({ window })}`);
}

export function getMarketTrend(window?: AnalysisWindow) {
  return request<MarketTrendAnalysisResponse>(`/api/v1/analysis/market-trend${toQueryString({ window })}`);
}

export function getOverview(window?: AnalysisWindow) {
  return request<OverviewAnalysisResponse>(`/api/v1/analysis/overview${toQueryString({ window })}`);
}

export function askAgentAnalysis(payload: AgentPromptRequest) {
  return request<AgentPromptResponse>('/api/v1/agent/prompt', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function listAgentConversations() {
  return request<AgentConversationListResponse>('/api/v1/agent/conversations');
}

export function listAgentMessages(conversationID: string) {
  return request<AgentMessageListResponse>(`/api/v1/agent/conversations/${encodeURIComponent(conversationID)}/messages`);
}

export function sendAgentChat(payload: AgentChatRequest) {
  return request<AgentChatResponse>('/api/v1/agent/chat', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function uploadQuestionFiles(qid: number, files: File[], onProgress?: (percent: number) => void) {
  const formData = new FormData();
  files.forEach((file) => formData.append('files', file));
  return uploadRequest<FileUploadResult>(`/api/v1/questions/${qid}/files`, formData, onProgress);
}

export function deleteQuestionFile(qid: number, fileName: string) {
  return request<FileDeleteResult>(`/api/v1/questions/${qid}/files/${encodeURIComponent(fileName)}`, {
    method: 'DELETE',
  });
}

export interface AgentLogRun {
  run_id: string;
  conversation_id: string;
  status: string;
  prompt: string;
  generated_sql: string | null;
  query_summary: string | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
  latency_ms: number | null;
}

export interface AgentLogRunDetail extends AgentLogRun {
  sources_json: string | null;
  user_message_id: string;
  assistant_message_id: string | null;
  llm_calls: Array<{
    log_id: string;
    stage: string;
    model: string;
    request_json: unknown;
    response_json: unknown;
    error: string | null;
    latency_ms: number | null;
    created_at: string;
  }>;
}

export interface AgentLogStats {
  stage: string;
  calls: number;
  errors: number;
  avg_seconds: number | null;
  max_seconds: number | null;
}

export function listAgentLogRuns(params: { limit?: number; status?: string; search?: string } = {}) {
  const query = new URLSearchParams();
  if (params.limit) query.set('limit', String(params.limit));
  if (params.status) query.set('status', params.status);
  if (params.search) query.set('search', params.search);
  const qs = query.toString();
  return request<{ records: AgentLogRun[] }>(`/api/v1/admin/agent-logs${qs ? `?${qs}` : ''}`);
}

export function getAgentLogRunDetail(runID: string) {
  return request<AgentLogRunDetail>(`/api/v1/admin/agent-logs/${encodeURIComponent(runID)}`);
}

export function getAgentLogStats(sinceHours = 168) {
  return request<{ records: AgentLogStats[] }>(`/api/v1/admin/agent-logs?view=stats&since_hours=${sinceHours}`);
}
