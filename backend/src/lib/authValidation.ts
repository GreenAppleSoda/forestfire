/**
 * 회원가입 아이디·비밀번호 규칙.
 * 프론트엔드 `frontend/src/lib/authValidation.ts` 와 동일하게 유지한다.
 */

const LOGIN_ID_RE = /^[a-z][a-z0-9]{3,19}$/;
const SPECIAL_RE = /[!@#$%^&*()_\-+=[\]{};:'",.<>/?`~\\|]/;
const MIN_PASSWORD_CLASSES = 2;

export function validateLoginId(loginId: string): string | null {
  if (/\s/.test(loginId)) return "아이디에는 공백을 넣을 수 없습니다.";
  const value = loginId.trim();
  if (!value) return "아이디를 입력해 주세요.";
  if (value.length < 4 || value.length > 20) {
    return "아이디는 4~20자로 입력해 주세요.";
  }
  if (!/^[a-z]/.test(value)) return "아이디는 영문 소문자로 시작해야 합니다.";
  if (!LOGIN_ID_RE.test(value)) {
    return "아이디는 영문 소문자와 숫자만 사용할 수 있습니다.";
  }
  return null;
}

export function passwordClassCount(password: string): number {
  let n = 0;
  if (/[A-Z]/.test(password)) n += 1;
  if (/[a-z]/.test(password)) n += 1;
  if (/[0-9]/.test(password)) n += 1;
  if (SPECIAL_RE.test(password)) n += 1;
  return n;
}

export function validatePassword(password: string): string | null {
  if (!password) return "비밀번호를 입력해 주세요.";
  if (password.length < 8 || password.length > 20) {
    return "비밀번호는 8~20자로 입력해 주세요.";
  }
  if (passwordClassCount(password) < MIN_PASSWORD_CLASSES) {
    return "비밀번호는 영문 대문자, 소문자, 숫자, 특수문자 중 2가지 이상을 조합해 주세요.";
  }
  return null;
}

export function validatePasswordConfirm(password: string, confirm: string): string | null {
  if (!confirm) return "비밀번호 확인을 입력해 주세요.";
  if (password !== confirm) return "비밀번호가 일치하지 않습니다.";
  return null;
}
