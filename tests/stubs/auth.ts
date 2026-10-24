// Stub cho `@/lib/auth` (next-auth) — CHỈ dùng trong bundle Playwright (tsconfig.playwright.json).
// Mục đích: cắt chuỗi import next-auth → `next/server` (fail resolution dưới pnpm + Next 16)
// khi spec import server action có `import { auth } from "@/lib/auth"`. Spec R7 test ở
// tầng service/scopedDb và tự dựng actor (resolveActorUncached) — KHÔNG dựa vào auth() thật.
import type { Session } from "next-auth";

/** Trả null mặc định (chưa đăng nhập). Test cần session thì gọi service trực tiếp. */
export async function auth(): Promise<Session | null> {
  return null;
}

export const handlers = { GET: async () => new Response(null), POST: async () => new Response(null) };
export async function signIn(): Promise<never> {
  throw new Error("signIn() không khả dụng trong test (stub).");
}
export async function signOut(): Promise<never> {
  throw new Error("signOut() không khả dụng trong test (stub).");
}
