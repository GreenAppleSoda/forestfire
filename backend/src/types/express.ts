/**
 * 인증 연동 시 optionalAuth 가 채울 사용자 정보.
 * 비회원/회원은 세션 유무로만 구분한다.
 */
export type AuthUser = {
  id: number;
  email: string;
  name: string;
  nickname: string;
  role: string;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export {};
