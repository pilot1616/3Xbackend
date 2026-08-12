export interface User {
  id: number;
  username: string;
  nickname: string;
  age: number;
  hobby: string;
  sign: string;
  avatar_path: string;
  created_at: string;
}

export interface AuthResult {
  token: string;
  expires_at: string;
  user: User;
}

export interface MessageResult {
  message: string;
}

export interface SecurityQuestionResult {
  username: string;
  security_question: string;
}

export interface ProfileUpdateResult {
  message: string;
  user: User;
}

export interface CommentRecord {
  id: number;
  user: string;
  nickName: string;
  time: string;
  text: string;
  avatarPath?: string;
}

export interface QuestionRecord {
  qid: number;
  isUpload: boolean;
  user: string;
  nickName: string;
  time: string;
  text: string;
  files: string[];
  imgName: string[];
  likesNum: number;
  commentsNum: number;
  comments: CommentRecord[];
  likedByMe: boolean;
  ownedByMe: boolean;
  avatarPath?: string;
}

export interface QuestionListPage {
  page: number;
  page_size: number;
  total: number;
  records: QuestionRecord[];
}

export interface CommentListPage {
  page: number;
  page_size: number;
  total: number;
  records: CommentRecord[];
}

export interface LikeRecord {
  id: number;
  user: string;
  nickName: string;
  time: string;
}

export interface LikeListPage {
  page: number;
  page_size: number;
  total: number;
  records: LikeRecord[];
}

export interface LikeResult {
  liked: boolean;
  likesNum: number;
}

export interface FileUploadResult {
  saved: boolean;
  files?: string[];
  imgName?: string[];
  path?: string;
}

export interface FileDeleteResult {
  deleted: boolean;
  file?: string;
}

export interface ToggleUploadResult {
  uploadFlag: boolean;
}

export interface DeleteQuestionResult {
  deleted: boolean;
}

export interface MyCommentRecord {
  id: number;
  qid: number;
  time: string;
  text: string;
  questionText?: string;
}

export interface MyCommentListPage {
  page: number;
  page_size: number;
  total: number;
  records: MyCommentRecord[];
}

export interface MyLikeRecord {
  id: number;
  qid: number;
  likedAt: string;
  questionUser?: string;
  questionNickName?: string;
  questionText?: string;
  isUpload: boolean;
  likesNum: number;
  commentsNum: number;
}

export interface MyLikeListPage {
  page: number;
  page_size: number;
  total: number;
  records: MyLikeRecord[];
}

export interface MySummaryResult {
  questionsCount: number;
  commentsCount: number;
  likesCount: number;
}

export interface PreciousMetalPoint {
  price: string;
  fetchedAt: string;
}

export interface PreciousMetalMarketRecord {
  symbol: string;
  name: string;
  sourceUrl: string;
  price: string;
  change: string;
  changePercent: string;
  prevClose: string;
  open: string;
  bid: string;
  ask: string;
  dayRange: string;
  week52Range: string;
  volume: string;
  avgVolume: string;
  lastUpdateText: string;
  contractMonth: string;
  settlementDate: string;
  tickSize: string;
  contractSize: string;
  tickValue: string;
  baseUnit: string;
  fetchedAt: string;
  history: PreciousMetalPoint[];
}

export interface PreciousMetalMarketResponse {
  updatedAt: string;
  records: PreciousMetalMarketRecord[];
}

export interface PreciousMetalSyncResult {
  message: string;
  targetCount: number;
  successCount: number;
  failedSymbols: string[];
  failedDetails: string[];
  fetchedAt: string;
  partial: boolean;
}

export interface TechMarketPoint {
  price: string;
  fetchedAt: string;
}

export interface TechMarketRecord {
  category: string;
  symbol: string;
  name: string;
  sourceUrl: string;
  price: string;
  change: string;
  changePercent: string;
  prevClose: string;
  open: string;
  bid: string;
  ask: string;
  dayRange: string;
  week52Range: string;
  volume: string;
  avgVolume: string;
  marketCap: string;
  peRatio: string;
  beta: string;
  eps: string;
  dividend: string;
  yield: string;
  lastUpdateText: string;
  fetchedAt: string;
  history: TechMarketPoint[];
}

export interface TechMarketResponse {
  updatedAt: string;
  records: TechMarketRecord[];
}

export interface TechMarketSyncResult {
  message: string;
  targetCount: number;
  successCount: number;
  failedSymbols: string[];
  failedDetails: string[];
  fetchedAt: string;
  partial: boolean;
}

export interface AIDailySection {
  heading: string;
  items: string[];
}

export interface AIDailyLink {
  title: string;
  url: string;
}

export interface AIDailyRecord {
  title: string;
  slug: string;
  sourceUrl: string;
  publishedDate: string;
  summary: string;
  readTime: string;
  content: string;
  sections: AIDailySection[];
  links: AIDailyLink[];
  fetchedAt: string;
}

export interface AIDailyResponse {
  updatedAt: string;
  offset: number;
  limit: number;
  total: number;
  hasMore: boolean;
  records: AIDailyRecord[];
}

export interface AIDailySyncResult {
  message: string;
  targetCount: number;
  successCount: number;
  failedSymbols: string[];
  failedDetails: string[];
  fetchedAt: string;
  partial: boolean;
}

export type AnalysisWindow = '1d' | '7d' | '30d';

export type AnalysisConfidence = 'low' | 'medium' | 'high';

export interface AnalysisDataStatus {
  sufficient: boolean;
  partial: boolean;
  windowStart: string;
  windowEnd: string;
  note: string;
}

export interface AITrendDataStatus extends AnalysisDataStatus {
  sampleCount: number;
}

export interface MarketTrendDataStatus extends AnalysisDataStatus {
  techCoveredSymbolCount: number;
  metalCoveredSymbolCount: number;
  coveredSymbols: string[];
  expectedSymbols: string[];
}

export interface OverviewDataStatus extends AnalysisDataStatus {
  aiSampleCount: number;
  techCoveredSymbolCount: number;
  metalCoveredSymbolCount: number;
  coveredSymbols: string[];
  expectedSymbols: string[];
}

export interface ThemeCount {
  theme: string;
  count: number;
  share: number;
}

export interface EmergingTheme {
  theme: string;
  count: number;
  reason: string;
}

export interface AIEvidenceItem {
  title: string;
  publishedDate: string;
  themes: string[];
}

export interface MarketMomentum {
  averageChangePercent: number;
  advancers: number;
  decliners: number;
}

export interface MarketMover {
  symbol: string;
  changePercent: number;
}

export interface MarketEvidenceItem {
  symbol: string;
  startPrice: string;
  endPrice: string;
  changePercent: number;
}

export interface OverviewEvidenceItem {
  type: string;
  theme: string;
  symbols: string[];
  note: string;
}

export interface OverviewAITrendSummary {
  summary: string;
  dominantThemes: string[];
  confidence: AnalysisConfidence;
}

export interface OverviewMarketTrendSummary {
  summary: string;
  marketRegime: 'risk-on' | 'risk-off' | 'mixed';
  confidence: AnalysisConfidence;
}

export interface AITrendAnalysisResponse {
  window: AnalysisWindow;
  generatedAt: string;
  dataStatus: AITrendDataStatus;
  summary: string;
  dominantThemes: ThemeCount[];
  emergingThemes: EmergingTheme[];
  headlineSignals: string[];
  risks: string[];
  confidence: AnalysisConfidence;
  evidence: AIEvidenceItem[];
}

export interface MarketTrendAnalysisResponse {
  window: AnalysisWindow;
  generatedAt: string;
  dataStatus: MarketTrendDataStatus;
  summary: string;
  marketRegime: 'risk-on' | 'risk-off' | 'mixed';
  techMomentum: MarketMomentum;
  safeHavenMomentum: MarketMomentum;
  leaders: MarketMover[];
  laggards: MarketMover[];
  risks: string[];
  confidence: AnalysisConfidence;
  evidence: MarketEvidenceItem[];
}

export interface OverviewAnalysisResponse {
  window: AnalysisWindow;
  generatedAt: string;
  dataStatus: OverviewDataStatus;
  summary: string;
  alignment: 'aligned' | 'diverging' | 'mixed';
  linkageTags: string[];
  keyAgreements: string[];
  keyTensions: string[];
  aiTrend: OverviewAITrendSummary;
  marketTrend: OverviewMarketTrendSummary;
  evidence?: OverviewEvidenceItem[];
  risks: string[];
  confidence: AnalysisConfidence;
}

export interface SessionData {
  token: string;
  user: User;
  expiresAt: string;
}

export interface AgentPromptRequest {
  prompt: string;
  context?: Record<string, unknown>;
  db_scope?: string | null;
}

export interface AgentSourceSample {
  table?: string;
  sql?: string;
  columns: string[];
  rows: Array<Record<string, unknown>>;
}

export interface AgentPromptResponse {
  answer: string;
  query_summary: string;
  sources: AgentSourceSample[];
  error: string;
}

export interface AgentConversation {
  conversation_id: string;
  source: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface AgentConversationListResponse {
  records: AgentConversation[];
}

export type AgentChatRole = 'user' | 'assistant';

export interface AgentChatMessage {
  message_id: string;
  role: AgentChatRole;
  content: string;
  created_at: string;
  run_id?: string;
  query_summary?: string;
}

export interface AgentMessageListResponse {
  records: AgentChatMessage[];
}

export interface AgentChatRequest {
  conversation_id?: string;
  message: string;
  context?: Record<string, unknown>;
}

export interface AgentChatResponse {
  conversation_id: string;
  message_id: string;
  reply: string;
  query_summary: string;
  sources: AgentSourceSample[];
  run_id: string;
  error: string;
}
