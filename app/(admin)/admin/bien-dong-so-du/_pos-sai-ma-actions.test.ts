// @vitest-environment node
/**
 * Ca [HN3-K1..K8] — cổng của HAI Server Action DUYỆT / TỪ CHỐI yêu cầu "sale nhập sai mã" của KẾ TOÁN (`duyetSaiMaAction` ·
 * `tuChoiSaiMaAction`). THUẦN — mọi module chạm DB đều giả lập; tiền/khoá/cuộc đua đo ở `tests/finance/pos-hai-nut-sai-ma.test.ts`.
 *
 * Thiết kế: docs/pos-hai-nut-khai-may.md §5.3.8. Quyền = `payments:manage` (V58), KHÔNG `payments:record` / `payments:pos-check`:
 * hai quyền sau sale cũng giữ, dùng chúng là để đồng nghiệp sale duyệt yêu cầu của sale.
 * Đầu vào của ca từ chối HỢP LỆ về schema (xem ghi chú ở `orders/_pos-sai-ma-actions.test.ts`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  checkPermission: vi.fn(),
  resolveActor: vi.fn(),
  passesScope: vi.fn(),
  orderFind: vi.fn(),
  duyetSaiMa: vi.fn(),
  tuChoiSaiMa: vi.fn(),
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
vi.mock("@/lib/audit/log", () => ({ getAuditActor: vi.fn(() => ({ actorId: "u-kt", actorName: "Kế toán HO" })) }));
vi.mock("@/lib/payments/pos/sai-ma-ghi", () => ({ duyetSaiMa: h.duyetSaiMa, tuChoiSaiMa: h.tuChoiSaiMa }));

import { duyetSaiMaAction, tuChoiSaiMaAction } from "./_pos-sai-ma-actions";

const DUYET = { orderId: "don1", yeuCauId: "y1" };
const TU_CHOI = { orderId: "don1", yeuCauId: "y1", lyDo: "Giao dịch của khách khác" };

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: "u-kt", name: "Kế toán HO" } });
  h.checkPermission.mockResolvedValue(true);
  h.resolveActor.mockResolvedValue({ userId: "u-kt" });
  h.passesScope.mockReturnValue(true);
  h.orderFind.mockResolvedValue({ id: "don1", centerId: "cs1", orgUnitId: "ou1" });
  h.duyetSaiMa.mockResolvedValue({ ok: true, trangThai: "DA_GHI_NHAN", thongDiep: "Đã ghi nhận giao dịch 3.168.000đ vào đơn ORD-1." });
  h.tuChoiSaiMa.mockResolvedValue({ ok: true, trangThai: "TU_CHOI", thongDiep: "Đã từ chối. Giao dịch vẫn nằm trong hàng chờ để gắn tay." });
});

async function haiAction() {
  return { duyet: await duyetSaiMaAction(DUYET), tuChoi: await tuChoiSaiMaAction(TU_CHOI) };
}

describe("[HN3-K] cổng hai action của kế toán", () => {
  it("[HN3-K1] chưa đăng nhập ⇒ 'Chưa đăng nhập', KHÔNG hỏi quyền, KHÔNG chạm lib", async () => {
    h.auth.mockResolvedValue(null);
    const kq = await haiAction();
    expect(kq.duyet).toEqual({ ok: false, error: "Chưa đăng nhập" });
    expect(kq.tuChoi).toEqual({ ok: false, error: "Chưa đăng nhập" });
    expect(h.checkPermission).not.toHaveBeenCalled();
    expect(h.duyetSaiMa).not.toHaveBeenCalled();
    expect(h.tuChoiSaiMa).not.toHaveBeenCalled();
  });

  it("[HN3-K2] thiếu `payments:manage` ⇒ 'Không có quyền'; KHÔNG ghi tiền, KHÔNG từ chối; hỏi ĐÚNG MỘT quyền", async () => {
    h.checkPermission.mockResolvedValue(false);
    const kq = await haiAction();
    expect(kq.duyet).toEqual({ ok: false, error: "Không có quyền" });
    expect(kq.tuChoi).toEqual({ ok: false, error: "Không có quyền" });
    expect(h.resolveActor).not.toHaveBeenCalled();
    expect(h.duyetSaiMa, "không duyệt khi thiếu quyền").not.toHaveBeenCalled();
    expect(h.tuChoiSaiMa, "không từ chối khi thiếu quyền").not.toHaveBeenCalled();
    expect(new Set(h.checkPermission.mock.calls.map((c) => c[0]))).toEqual(new Set(["payments:manage"]));
  });

  it("[HN3-K3] đơn KHÔNG tồn tại / NGOÀI phạm vi ⇒ CÙNG một câu 'Không tìm thấy đơn hàng'; không chạm lib", async () => {
    h.orderFind.mockResolvedValue(null);
    const khongCo = await haiAction();
    h.orderFind.mockResolvedValue({ id: "don1", centerId: "cs2", orgUnitId: "ou2" });
    h.passesScope.mockReturnValue(false);
    const ngoai = await haiAction();
    for (const kq of [khongCo, ngoai]) {
      expect(kq.duyet).toEqual({ ok: false, error: "Không tìm thấy đơn hàng" });
      expect(kq.tuChoi).toEqual({ ok: false, error: "Không tìm thấy đơn hàng" });
    }
    expect(h.duyetSaiMa).not.toHaveBeenCalled();
    expect(h.tuChoiSaiMa).not.toHaveBeenCalled();
    expect(h.passesScope).toHaveBeenCalledWith("Order", { id: "don1", centerId: "cs2", orgUnitId: "ou2" }, { userId: "u-kt" });
  });

  it("[HN3-K4] TỪ CHỐI cần LÝ DO: thiếu / rỗng / toàn khoảng trắng / dưới 5 ký tự ⇒ lỗi zod TRƯỚC phiên, lib không bị gọi; đủ 5 ký tự thì qua", async () => {
    for (const lyDo of [undefined, "", "     ", "abcd", "  ab  "]) {
      const r = await tuChoiSaiMaAction({ orderId: "don1", yeuCauId: "y1", ...(lyDo === undefined ? {} : { lyDo }) });
      expect(r.ok, JSON.stringify(lyDo)).toBe(false);
    }
    expect(h.auth).not.toHaveBeenCalled();
    expect(h.tuChoiSaiMa).not.toHaveBeenCalled();
    // ĐỐI CHỨNG DƯƠNG: đúng ngưỡng 5 ký tự (sau khi bỏ khoảng trắng hai đầu).
    const ok = await tuChoiSaiMaAction({ orderId: "don1", yeuCauId: "y1", lyDo: "  abcde  " });
    expect(ok.ok).toBe(true);
    expect(h.tuChoiSaiMa.mock.calls[0]![0].lyDo, "lý do đã cắt khoảng trắng").toBe("abcde");
    // Trần 500 ký tự.
    expect((await tuChoiSaiMaAction({ orderId: "don1", yeuCauId: "y1", lyDo: "x".repeat(501) })).ok).toBe(false);
    expect((await tuChoiSaiMaAction({ orderId: "don1", yeuCauId: "y1", lyDo: "x".repeat(500) })).ok).toBe(true);
  });

  it("[HN3-K5] đầu vào duyệt hỏng ⇒ lỗi zod TRƯỚC phiên; không `auth()`, không lib", async () => {
    for (const v of [null, {}, { orderId: "don1" }, { yeuCauId: "y1" }, { orderId: "", yeuCauId: "y1" }]) {
      expect((await duyetSaiMaAction(v)).ok).toBe(false);
    }
    expect(h.auth).not.toHaveBeenCalled();
    expect(h.duyetSaiMa).not.toHaveBeenCalled();
  });

  it("[HN3-K6] ĐỐI CHỨNG DƯƠNG: đủ cổng ⇒ lib gọi ĐÚNG MỘT lần với id ĐƠN đã qua cổng; người quyết = người bấm; `now` là Date", async () => {
    const duyet = await duyetSaiMaAction(DUYET);
    expect(duyet).toEqual({ ok: true, trangThai: "DA_GHI_NHAN", thongDiep: "Đã ghi nhận giao dịch 3.168.000đ vào đơn ORD-1." });
    expect(h.duyetSaiMa).toHaveBeenCalledTimes(1);
    const a1 = h.duyetSaiMa.mock.calls[0]![0];
    expect(a1).toMatchObject({ orderId: "don1", yeuCauId: "y1", actor: { id: "u-kt", name: "Kế toán HO" } });
    expect(a1.now).toBeInstanceOf(Date);
    expect(Object.keys(a1).sort()).toEqual(["actor", "now", "orderId", "yeuCauId"]);

    const choi = await tuChoiSaiMaAction(TU_CHOI);
    expect(choi).toEqual({ ok: true, trangThai: "TU_CHOI", thongDiep: "Đã từ chối. Giao dịch vẫn nằm trong hàng chờ để gắn tay." });
    expect(h.tuChoiSaiMa).toHaveBeenCalledTimes(1);
    expect(h.tuChoiSaiMa.mock.calls[0]![0]).toMatchObject({ orderId: "don1", yeuCauId: "y1", lyDo: "Giao dịch của khách khác" });
    expect(h.checkPermission.mock.calls.map((c) => c[0])).toEqual(["payments:manage", "payments:manage"]);
  });

  it("[HN3-K7] trường thừa (`maXacNhan`, `soTien`, `centerId`, `kieu`) KHÔNG tới được lib", async () => {
    await duyetSaiMaAction({ ...DUYET, maXacNhan: "ABCDE", soTien: 1, centerId: "cs-khac", kieu: "TU_GHI_NHAN" });
    expect(Object.keys(h.duyetSaiMa.mock.calls[0]![0]).sort()).toEqual(["actor", "now", "orderId", "yeuCauId"]);
    await tuChoiSaiMaAction({ ...TU_CHOI, maXacNhan: "ABCDE", soTien: 1 });
    expect(Object.keys(h.tuChoiSaiMa.mock.calls[0]![0]).sort()).toEqual(["actor", "lyDo", "now", "orderId", "yeuCauId"]);
  });

  it("[HN3-K8] lib từ chối ⇒ trả ĐÚNG câu của lib; CẢ HAI trường hợp đều làm mới trang kế toán + trang đơn (trạng thái có thể đã đổi)", async () => {
    h.duyetSaiMa.mockResolvedValue({ ok: false, error: "Yêu cầu đã được xử lý" });
    expect(await duyetSaiMaAction(DUYET)).toEqual({ ok: false, error: "Yêu cầu đã được xử lý" });
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin/bien-dong-so-du");
    expect(h.revalidatePath).toHaveBeenCalledWith("/bien-dong-so-du");
    expect(h.revalidatePath).toHaveBeenCalledWith("/orders/don1");

    h.revalidatePath.mockClear();
    h.tuChoiSaiMa.mockResolvedValue({ ok: false, error: "Yêu cầu đang ghi nhận — thử lại sau ít phút" });
    expect(await tuChoiSaiMaAction(TU_CHOI)).toEqual({ ok: false, error: "Yêu cầu đang ghi nhận — thử lại sau ít phút" });
    expect(h.revalidatePath).toHaveBeenCalledTimes(3);
  });
});
