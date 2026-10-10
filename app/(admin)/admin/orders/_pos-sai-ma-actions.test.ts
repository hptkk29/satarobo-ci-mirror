// @vitest-environment node
/**
 * Ca [HN3-A1..A8] — cổng của HAI Server Action "Tôi nhập sai mã trên máy" của SALE (`timUngVienSaiMaAction` · `guiSaiMaAction`).
 * THUẦN — mọi module chạm DB đều giả lập; hành vi tiền/khoá/UNIQUE đo ở `tests/finance/pos-hai-nut-sai-ma.test.ts`.
 *
 * Thiết kế: docs/pos-hai-nut-khai-may.md §5.3.8. Ba cổng, thiếu cổng nào cũng là lỗ:
 *   1. phiên đăng nhập;  2. quyền `payments:pos-check` (đối chứng dương: có quyền ⇒ chạy tới lib ĐÚNG MỘT lần);
 *   3. đơn nằm trong phạm vi người bấm (`scopedDb` + `passesScope`) — câu chữ KHÔNG phân biệt "không có" với "không thuộc cơ sở bạn".
 * Zod chạy TRƯỚC cổng: đầu vào hỏng không đụng tới phiên. Đầu vào của ca từ chối HỢP LỆ về schema — để nếu cổng bị gỡ thì action chạy
 * TIẾP tới lib (ca đỏ vì lib bị gọi) chứ không dừng nhờ lỗi schema rồi che mất lỗ hổng.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  checkPermission: vi.fn(),
  resolveActor: vi.fn(),
  passesScope: vi.fn(),
  orderFind: vi.fn(),
  timUngVienSaiMa: vi.fn(),
  guiSaiMa: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));
vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: h.checkPermission }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: h.resolveActor }));
vi.mock("@/lib/db-scope", () => ({
  passesScope: h.passesScope,
  scopedDb: vi.fn(() => ({ order: { findUnique: h.orderFind } })),
}));
vi.mock("@/lib/audit/log", () => ({ getAuditActor: vi.fn(() => ({ actorId: "u-sale", actorName: "Sale CS1" })) }));
vi.mock("@/lib/payments/pos/sai-ma-doc", () => ({ timUngVienSaiMa: h.timUngVienSaiMa }));
vi.mock("@/lib/payments/pos/sai-ma-ghi", () => ({ guiSaiMa: h.guiSaiMa }));

import { guiSaiMaAction, timUngVienSaiMaAction } from "./_pos-sai-ma-actions";

const TIM = { orderId: "don1", intentId: "pos1" };
const GUI = { orderId: "don1", intentId: "pos1", bankTransactionId: "bt1" };

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: "u-sale", name: "Sale CS1" } });
  h.checkPermission.mockResolvedValue(true);
  h.resolveActor.mockResolvedValue({ userId: "u-sale" });
  h.passesScope.mockReturnValue(true);
  h.orderFind.mockResolvedValue({ id: "don1", centerId: "cs1", orgUnitId: "ou1" });
  h.timUngVienSaiMa.mockResolvedValue({ ok: true, ungVien: [], conNua: false, soTien: 1, may: "M", tuLuc: "2026-10-09T10:00:00+07:00", cau: "x" });
  h.guiSaiMa.mockResolvedValue({
    ok: true,
    daCo: false,
    yeuCauId: "y1",
    kieu: "TU_GHI_NHAN",
    trangThai: "DA_GHI_NHAN",
    lyDo: [],
    thongDiep: "Đã ghi nhận giao dịch 3.168.000đ vào đơn ORD-1.",
  });
});

async function haiAction() {
  return { tim: await timUngVienSaiMaAction(TIM), gui: await guiSaiMaAction(GUI) };
}

describe("[HN3-A] cổng hai action của sale", () => {
  it("[HN3-A1] chưa đăng nhập ⇒ 'Chưa đăng nhập', KHÔNG hỏi quyền, KHÔNG chạm lib", async () => {
    h.auth.mockResolvedValue(null);
    const kq = await haiAction();
    expect(kq.tim).toEqual({ ok: false, error: "Chưa đăng nhập" });
    expect(kq.gui).toEqual({ ok: false, error: "Chưa đăng nhập" });
    expect(h.checkPermission).not.toHaveBeenCalled();
    expect(h.timUngVienSaiMa).not.toHaveBeenCalled();
    expect(h.guiSaiMa).not.toHaveBeenCalled();
    // ĐỐI CHỨNG DƯƠNG: có phiên ⇒ chạy tới lib (xem [HN3-A5]).
  });

  it("[HN3-A2] thiếu `payments:pos-check` ⇒ 'Không có quyền', KHÔNG chạm actor / DB / lib; hỏi ĐÚNG quyền (không mượn quyền khác)", async () => {
    h.checkPermission.mockResolvedValue(false);
    const kq = await haiAction();
    expect(kq.tim).toEqual({ ok: false, error: "Không có quyền" });
    expect(kq.gui).toEqual({ ok: false, error: "Không có quyền" });
    expect(h.resolveActor).not.toHaveBeenCalled();
    expect(h.orderFind).not.toHaveBeenCalled();
    expect(h.timUngVienSaiMa).not.toHaveBeenCalled();
    expect(h.guiSaiMa, "không gửi khi thiếu quyền").not.toHaveBeenCalled();
    expect(new Set(h.checkPermission.mock.calls.map((c) => c[0]))).toEqual(new Set(["payments:pos-check"]));
  });

  it("[HN3-A3] đơn KHÔNG tồn tại và đơn NGOÀI phạm vi ⇒ CÙNG một câu 'Không tìm thấy đơn hàng'; không chạm lib", async () => {
    h.orderFind.mockResolvedValue(null);
    const khongCo = await haiAction();
    h.orderFind.mockResolvedValue({ id: "don1", centerId: "cs2", orgUnitId: "ou2" });
    h.passesScope.mockReturnValue(false);
    const ngoai = await haiAction();
    for (const kq of [khongCo, ngoai]) {
      expect(kq.tim).toEqual({ ok: false, error: "Không tìm thấy đơn hàng" });
      expect(kq.gui).toEqual({ ok: false, error: "Không tìm thấy đơn hàng" });
    }
    expect(h.timUngVienSaiMa).not.toHaveBeenCalled();
    expect(h.guiSaiMa).not.toHaveBeenCalled();
    // Phạm vi hỏi bằng `passesScope("Order", <đơn>, <actor>)` — không tự so cơ sở tại chỗ.
    expect(h.passesScope).toHaveBeenCalledWith("Order", { id: "don1", centerId: "cs2", orgUnitId: "ou2" }, { userId: "u-sale" });
  });

  it("[HN3-A4] đầu vào hỏng (thiếu trường / rỗng / quá dài) ⇒ lỗi từ zod, TRƯỚC phiên: không `auth()`, không lib", async () => {
    const hong: unknown[] = [null, {}, { orderId: "don1" }, { orderId: "", intentId: "p" }, { orderId: "d", intentId: "x".repeat(65) }];
    for (const v of hong) {
      expect((await timUngVienSaiMaAction(v)).ok).toBe(false);
      expect((await guiSaiMaAction(v)).ok).toBe(false);
    }
    // `gui` còn đòi bankTransactionId.
    const thieuGiaoDich = await guiSaiMaAction({ orderId: "don1", intentId: "pos1" });
    expect(thieuGiaoDich.ok).toBe(false);
    expect(h.auth).not.toHaveBeenCalled();
    expect(h.timUngVienSaiMa).not.toHaveBeenCalled();
    expect(h.guiSaiMa).not.toHaveBeenCalled();
  });

  it("[HN3-A5] ĐỐI CHỨNG DƯƠNG: đủ cổng ⇒ lib được gọi ĐÚNG MỘT lần với id của ĐƠN đã qua cổng, người bấm và `now` là Date", async () => {
    const tim = await timUngVienSaiMaAction(TIM);
    expect(tim.ok).toBe(true);
    expect(h.timUngVienSaiMa).toHaveBeenCalledTimes(1);
    expect(h.timUngVienSaiMa.mock.calls[0]![0]).toMatchObject({ orderId: "don1", intentId: "pos1" });
    expect(h.timUngVienSaiMa.mock.calls[0]![0].now).toBeInstanceOf(Date);

    const gui = await guiSaiMaAction(GUI);
    expect(gui).toEqual({
      ok: true,
      kieu: "TU_GHI_NHAN",
      trangThai: "DA_GHI_NHAN",
      thongDiep: "Đã ghi nhận giao dịch 3.168.000đ vào đơn ORD-1.",
    });
    expect(h.guiSaiMa).toHaveBeenCalledTimes(1);
    const arg = h.guiSaiMa.mock.calls[0]![0];
    expect(arg).toMatchObject({ orderId: "don1", intentId: "pos1", bankTransactionId: "bt1", actor: { id: "u-sale", name: "Sale CS1" } });
    expect(arg.now).toBeInstanceOf(Date);
    // Cổng đúng quyền ở CẢ hai lượt.
    expect(h.checkPermission.mock.calls.map((c) => c[0])).toEqual(["payments:pos-check", "payments:pos-check"]);
  });

  it("[HN3-A6] id đơn đưa vào lib là id TRONG BẢN GHI đã qua cổng phạm vi, không phải chuỗi thô của client", async () => {
    // Bản ghi đơn mang id CHUẨN HOÁ khác chuỗi client gửi (có khoảng trắng) — zod `trim()` làm sạch, cổng trả bản ghi thật.
    h.orderFind.mockResolvedValue({ id: "don1-chuan", centerId: "cs1", orgUnitId: "ou1" });
    await guiSaiMaAction({ orderId: "  don1  ", intentId: "pos1", bankTransactionId: "bt1" });
    expect(h.orderFind).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "don1" } }));
    expect(h.guiSaiMa.mock.calls[0]![0].orderId, "id của bản ghi, không phải chuỗi client").toBe("don1-chuan");
  });

  it("[HN3-A7] trường thừa client nhét vào (`maXacNhan`, `kieu`, `soTien`, `centerId`) KHÔNG tới được lib", async () => {
    await guiSaiMaAction({ ...GUI, maXacNhan: "ABCDE", kieu: "TU_GHI_NHAN", soTien: 1, centerId: "cs-khac" });
    const arg = h.guiSaiMa.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(arg).sort()).toEqual(["actor", "bankTransactionId", "intentId", "now", "orderId"]);
    await timUngVienSaiMaAction({ ...TIM, maXacNhan: "ABCDE", soTien: 1 });
    const arg2 = h.timUngVienSaiMa.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(arg2).sort()).toEqual(["intentId", "now", "orderId", "sdb"]);
  });

  it("[HN3-A8] lib từ chối ⇒ action trả ĐÚNG câu của lib VÀ làm mới trang đơn (từ chối có thể đến SAU khi đã giữ giao dịch — [HN3-RV-07]); lib thành công ⇒ làm mới trang đơn", async () => {
    h.guiSaiMa.mockResolvedValue({ ok: false, error: "Giao dịch này đang được giữ cho phiếu khác — tải lại danh sách" });
    const loi = await guiSaiMaAction(GUI);
    expect(loi).toEqual({ ok: false, error: "Giao dịch này đang được giữ cho phiếu khác — tải lại danh sách" });
    expect(h.revalidatePath, "bản đầu KHÔNG làm mới khi từ chối — hộp phiếu còn mời quẹt lại sau pha tiền ném").toHaveBeenCalledWith("/orders/don1");
    h.revalidatePath.mockClear();

    h.guiSaiMa.mockResolvedValue({ ok: true, daCo: false, yeuCauId: "y2", kieu: "CHO_KE_TOAN", trangThai: "CHO_DUYET", lyDo: ["NHIEU_UNG_VIEN"], thongDiep: "Đã gửi kế toán xác nhận. ĐỪNG cho khách quẹt lại." });
    const ok = await guiSaiMaAction(GUI);
    expect(ok).toEqual({ ok: true, kieu: "CHO_KE_TOAN", trangThai: "CHO_DUYET", thongDiep: "Đã gửi kế toán xác nhận. ĐỪNG cho khách quẹt lại." });
    expect(h.revalidatePath).toHaveBeenCalledWith("/orders/don1");
  });
});
