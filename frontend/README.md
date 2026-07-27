# 산불맵 Frontend (Next.js)

UI만 담당합니다. API·예측은 Express / Flask가 처리합니다.

```bash
npm install
npm run dev
```

- `/api/*` 는 `next.config.ts` rewrite → Express (`EXPRESS_URL`, 기본 `http://localhost:4000`)
- 서버 전용 키는 `ml-service/.env` / `backend/.env` 에 둡니다.

루트 `README.md`의 3-프로세스 실행 방법을 참고하세요.
