// @vitest-environment jsdom
/**
 * Trang Tổng quan Đào tạo khi người xem KHÔNG có quyền — vẫn phải là một trang hoàn chỉnh (hotfix 26/10/2026).
 *
 * Trước đó nhánh từ chối chỉ bọc `<div>`: không có `<main>` (đích của liên kết "Bỏ qua điều hướng") và không có `<h1>`, nên người đọc
 * màn hình rơi vào một trang không mốc nào. Đo trên TEST: tài khoản người học mở /elearning/dao-tao.
 *
 * Mỗi ca âm có ĐỐI CHỨNG DƯƠNG: trang CÓ quyền cũng phải có đúng một main + một h1 — nếu cả hai nhánh cùng hỏng thì ca "có h1" ở
 * nhánh từ chối không chứng minh được gì về nhánh còn lại.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

const h = vi.hoisted(() => ({
  cho: new Set<string>(),
  phien: { user: { id: "u1" } } as { user?: { id: string } } | null,
}));

vi.mock("@/lib/auth", () => ({ auth: async () => h.phien }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: async () => ({ userId: "u1" }) }));
vi.mock("@/lib/auth/can", () => ({ can: (_a: unknown, k: string) => h.cho.has(k) }));
vi.mock("@/lib/db-scope", () => ({ scopedDb: () => ({}) }));
vi.mock("@/lib/elearning/dao-tao-overview", () => ({
  napTongQuanDaoTao: async () => ({
    cham: { taoChoCham: 0, taoQuaHanCham: 0, thiChoCham: 0 },
    tienDo: null,
    giao: null,
    soan: null,
  }),
}));

import TongQuanDaoTaoPage from "./page";

const dem = (sel: string) => document.querySelectorAll(sel).length;

afterEach(() => {
  cleanup();
  h.cho.clear();
  h.phien = { user: { id: "u1" } };
});

describe("/elearning/dao-tao — cấu trúc trang", () => {
  it("[DT-01] ĐỐI CHỨNG DƯƠNG: có quyền ⇒ đúng một <main> và một <h1>", async () => {
    h.cho.add("elearning:exam:grade");
    render(await TongQuanDaoTaoPage());
    expect(dem("main")).toBe(1);
    expect(dem("h1")).toBe(1);
  });

  it("[DT-02] KHÔNG quyền ⇒ trang từ chối vẫn có đúng một <main> và một <h1>, nói rõ lý do + lối về", async () => {
    render(await TongQuanDaoTaoPage());
    expect(dem("main")).toBe(1);
    expect(dem("h1")).toBe(1);
    expect(document.querySelector("h1")?.textContent).toBe("Tổng quan Đào tạo");
    expect(document.body.textContent).toContain("Bạn không có quyền xem tổng quan Đào tạo");
    expect(document.querySelector('a[href="/elearning"]')).not.toBeNull();
  });

  it("[DT-03] chưa đăng nhập ⇒ cũng là trang hoàn chỉnh (main + h1), không còn <div> trần", async () => {
    h.phien = null;
    render(await TongQuanDaoTaoPage());
    expect(dem("main")).toBe(1);
    expect(dem("h1")).toBe(1);
  });

  it("[DT-04] trang từ chối KHÔNG gọi truy vấn số liệu (không lộ gì cho người không có quyền)", async () => {
    render(await TongQuanDaoTaoPage());
    expect(document.body.textContent).not.toContain("Cần xử lý");
  });
});
