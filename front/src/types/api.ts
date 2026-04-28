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

export interface SessionData {
  token: string;
  user: User;
  expiresAt: string;
}
