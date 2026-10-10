// @vitest-environment node
/**
 * S-2a → S-2b — NÚT "Gửi" Ở HỘP THƯ MESSENGER.
 *
 * ── Lịch sử của lỗi này (giữ lại vì nó giải thích mọi câu khẳng định bên dưới) ──
 * Bản đầu: `replyAction` ghi một dòng `MessengerMessage` hướng OUT vào DB rồi trả
 * `{ ok: true }`, giao diện bắn toast "Đã gửi" — trong khi repo KHÔNG có lời gọi nào
 * ra Meta Send API. Khách không nhận được gì, người trực tin là đã trả lời.
 * ⚠️ Thiệt hại KHÔNG dừng ở cái toast: `recordOutgoingMessage` set
 * `MessengerConversation.respondedAt`, mà `lib/crm/sla.ts:71` đọc đúng cột đó
 * (`if (!respondedAt && over(firstMessageAt, …)) push("SLA-0")`). Mỗi lần bấm "Gửi"
 * là tắt cảnh báo chậm phản hồi của một khách chưa hề được trả lời.
 * S-2a (25/08) vá tạm bằng cách CHẶN CỨNG cả đường gửi và nói thật ở giao diện.
 * S-2b (27/08) nối Send API thật ⇒ chốt chặn đó gỡ, thay bằng các câu khẳng định
 * hành vi dưới đây.
 *
 * ⚠️ Test này GỌI THẬT `replyAction` và soi lời gọi phát ra. Bản cũ có một case so
 * chuỗi mã nguồn (`readFileSync` + regex `/messages`) — đã bỏ theo quy ước 21
 * (`docs/elearning/quy-uoc-nen.md:295`): so chuỗi chứng minh CÓ VIẾT, không chứng
 * minh CÓ CHẠY.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  checkPermission: vi.fn(),
  resolveActor: vi.fn(),
  convFindUnique: vi.fn(),
  guiTraLoiMessenger: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: h.checkPermission }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: h.resolveActor }));
vi.mock("@/lib/db-scope", () => ({
  scopedDb: vi.fn(() => ({ messengerConversation: { findUnique: h.convFindUnique } })),
}));
vi.mock("@/lib/crm/messenger-send", () => ({ guiTraLoiMessenger: h.guiTraLoiMessenger }));
vi.mock("next/cache", () => ({
  // 16/09/2026 — bản `main` của `actions.ts` dùng `unstable_cache`; mock thiếu nó là
  // cả tệp test chết ngay lúc nạp, không phải một ca đỏ.
  unstable_cache: <T,>(fn: T) => fn, revalidatePath: h.revalidatePath }));

import { replyAction } from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: "u-sale" } });
  h.checkPermission.mockResolvedValue(true);
  h.resolveActor.mockResolvedValue({ userId: "u-sale", isHoLevel: false });
  h.convFindUnique.mockResolvedValue({ id: "conv-1", respondedAt: null });
  h.guiTraLoiMessenger.mockResolvedValue({
    ok: true,
    daGuiThat: true,
    messageId: "msg-out",
    providerMessageId: "mid.abc",
  });
});

describe("[S-2b] replyAction — cổng quyền giữ nguyên", () => {
  it("chưa đăng nhập ⇒ 'Chưa đăng nhập', không đụng đường gửi", async () => {
    h.auth.mockResolvedValue(null);
    const res = await replyAction("conv-1", "x");
    expect(res).toEqual({ ok: false, error: "Chưa đăng nhập" });
    expect(h.guiTraLoiMessenger).not.toHaveBeenCalled();
  });

  it("thiếu `leads:edit` ⇒ 'Không có quyền', không đụng đường gửi", async () => {
    h.checkPermission.mockResolvedValue(false);
    const res = await replyAction("conv-1", "x");
    expect(res).toEqual({ ok: false, error: "Không có quyền" });
    expect(h.guiTraLoiMessenger).not.toHaveBeenCalled();
  });

  it("quyền kiểm qua `can()` (checkPermission), không so vai/centerId tại chỗ", async () => {
    await replyAction("conv-1", "x");
    expect(h.checkPermission).toHaveBeenCalledWith("leads:edit");
  });

  it("hội thoại ngoài phạm vi cơ sở (scopedDb trả null) ⇒ chặn, KHÔNG gửi ra ngoài", async () => {
    h.convFindUnique.mockResolvedValue(null);
    const res = await replyAction("conv-1", "x");
    expect(res.ok).toBe(false);
    expect(h.guiTraLoiMessenger).not.toHaveBeenCalled();
  });

  it("nội dung trống ⇒ chặn trước khi tốn một lời gọi ra Meta", async () => {
    const res = await replyAction("conv-1", "   ");
    expect(res.ok).toBe(false);
    expect(h.guiTraLoiMessenger).not.toHaveBeenCalled();
  });
});

describe("[S-2b] replyAction — nối thật vào đường gửi", () => {
  it("gọi `guiTraLoiMessenger` với đúng hội thoại, nội dung đã cắt lề, và NGƯỜI bấm gửi", async () => {
    await replyAction("conv-1", "  Dạ em chào chị  ");
    expect(h.guiTraLoiMessenger).toHaveBeenCalledTimes(1);
    expect(h.guiTraLoiMessenger).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv-1",
        text: "Dạ em chào chị",
        sentByUserId: "u-sale",
      }),
    );
  });

  it("gửi thật thành công ⇒ ok + daGuiThat = true", async () => {
    const res = await replyAction("conv-1", "x");
    expect(res).toMatchObject({ ok: true, daGuiThat: true });
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin/crm/messenger");
  });

  it("MÔ PHỎNG ⇒ ok nhưng daGuiThat = FALSE + kèm câu cảnh báo (không bao giờ báo suông)", async () => {
    h.guiTraLoiMessenger.mockResolvedValue({
      ok: true,
      daGuiThat: false,
      messageId: "msg-out",
      canhBao: "Chế độ mô phỏng — khách KHÔNG nhận được tin này.",
    });
    const res = await replyAction("conv-1", "x");
    expect(res).toMatchObject({ ok: true, daGuiThat: false });
    if (!res.ok || res.daGuiThat) throw new Error("phải là nhánh mô phỏng");
    expect(res.canhBao).toMatch(/KHÔNG/);
  });

  it("ngoài cửa sổ 24h ⇒ ok:false với câu người đọc hiểu, KHÔNG phải mã máy hay lỗi 500", async () => {
    h.guiTraLoiMessenger.mockResolvedValue({
      ok: false,
      ma: "NGOAI_CUA_SO_24H",
      loi: "Facebook chỉ cho trả lời trong 24 giờ kể từ tin nhắn cuối của khách. Hãy gọi điện hoặc nhắn Zalo cho khách.",
    });
    const res = await replyAction("conv-1", "x");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/24 giờ/);
    expect(res.error).not.toMatch(/NGOAI_CUA_SO_24H/);
  });

  it("đường gửi NÉM ⇒ action trả lỗi có chữ, không để ngoại lệ vọt ra thành 500 câm", async () => {
    h.guiTraLoiMessenger.mockRejectedValue(new Error("boom"));
    const res = await replyAction("conv-1", "x");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.length).toBeGreaterThan(10);
  });
});
