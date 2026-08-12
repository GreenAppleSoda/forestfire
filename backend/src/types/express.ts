/**
 * 인증 연동 시 optionalAuth 가 채울 사용자 정보.
 * 게스트 챗봇 단계에서는 항상 undefined.
 */
export type AuthUser = {
  id: number;
  name: string;
  nickname?: string | null;
  email?: string;
  role?: string;
  /** 구독/등급 연동 후 사용. 없으면 게스트와 동일 취급 */
  grade?: number;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export {};
