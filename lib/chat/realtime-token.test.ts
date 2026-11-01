// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// (server-only được alias sang stub rỗng trong vitest.config.ts)

// DB giả: 1 user in-memory — chỉnh state từng test.
let dbUser: {
  tokenVersion: number;
  isActive: boolean;
  deletedAt: Date | null;
} | null = null;

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(async () => dbUser),
    },
  },
}));

import {
  assertRealtimeUserValid,
  issueSseTicket,
  SSE_TICKET_TOKEN,
  SSE_TICKET_TTL_SECONDS,
} from "./realtime-token";

const USER = { id: "clzztestuser0001abcdefgh", tokenVersion: 3 };

beforeEach(() => {
  dbUser = { tokenVersion: 3, isActive: true, deletedAt: null };
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-28T10:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("issueSseTicket — vé SSE (không ký gì, chỉ giữ cổng phiên)", () => {
  it("vé hợp lệ: token cố định không mang bí mật, hết hạn sau đúng TTL", async () => {
    const { token, expiresAt } = await issueSseTicket(USER);
    expect(token).toBe(SSE_TICKET_TOKEN);
    expect(expiresAt.getTime()).toBe(Date.now() + SSE_TICKET_TTL_SECONDS * 1000);
  });

  it("tokenVersion trong DB lệch với session → từ chối (force-logout)", async () => {
    dbUser = { tokenVersion: 4, isActive: true, deletedAt: null };
    await expect(issueSseTicket(USER)).rejects.toMatchObject({
      name: "RealtimeTokenError",
      code: "TOKEN_VERSION_MISMATCH",
    });
  });

  it("user không tồn tại / đã xoá / bị khoá → từ chối", async () => {
    dbUser = null;
    await expect(issueSseTicket(USER)).rejects.toMatchObject({ code: "USER_NOT_FOUND" });

    dbUser = { tokenVersion: 3, isActive: true, deletedAt: new Date() };
    await expect(issueSseTicket(USER)).rejects.toMatchObject({ code: "USER_NOT_FOUND" });

    dbUser = { tokenVersion: 3, isActive: false, deletedAt: null };
    await expect(issueSseTicket(USER)).rejects.toMatchObject({ code: "USER_NOT_FOUND" });
  });
});

describe("assertRealtimeUserValid — kiểm phiên dùng chung cho route vé + route stream", () => {
  it("phiên còn hiệu lực → không ném", async () => {
    await expect(assertRealtimeUserValid(USER)).resolves.toBeUndefined();
  });

  it("phiên đã bị thu hồi → ném TOKEN_VERSION_MISMATCH", async () => {
    dbUser = { tokenVersion: 9, isActive: true, deletedAt: null };
    await expect(assertRealtimeUserValid(USER)).rejects.toMatchObject({
      code: "TOKEN_VERSION_MISMATCH",
    });
  });
});
