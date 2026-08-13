/**
 * 인증 연동 시 optionalAuth 가 채울 사용자 정보.
 * users.subscription_tier: BASIC | PLUS | PREMIUM
 */
export type AuthUser = {
  id: number;
  email: string;
  name: string;
  nickname: string;
  role: string;
  subscriptionTier: string;
  /** PREMIUM=1, PLUS=2, BASIC=3 */
  grade: number;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export {};
