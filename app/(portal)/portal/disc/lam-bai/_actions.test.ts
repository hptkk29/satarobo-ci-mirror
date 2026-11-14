/**
 * [PLB-ACT-*] Server action lưu bài DISC trong cổng: cổng phiên, kiểm đầu vào, hạn mức, và `userId` CHỈ từ phiên.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const M = vi.hoisted(() => ({
  phien: vi.fn(),
  luu: vi.fn(),
  rate: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("../_lib/phien-disc", () => ({ docPhienDisc: M.phien }));
vi.mock("@/lib/disc/portal-lam-bai-prisma", () => ({ luuBaiPortalThat: M.luu }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: M.rate }));
vi.mock("next/cache", () => ({ revalidatePath: M.revalidate }));

import { luuBaiDiscPortalAction } from "./_actions";

const HOP_LE = {
  studentId: "s1",
  idempotencyKey: "khoa-gia-0123456789abcdef-xyz",
  dongYXuLy: true,
  boSung: {},
  bai: { phuHuynh: { maBoDe: "A", traLoi: { a: 1 } }, hocSinh: { maBoDe: "B", traLoi: { b: 1 } } },
};

beforeEach(() => {
  vi.clearAllMocks();
  M.phien.mockResolvedValue({ ok: true, userId: "u-phien" });
  M.rate.mockResolvedValue({ success: true });
  M.luu.mockResolvedValue({ ok: true, submissionId: "sub-1" });
});

describe("[PLB-ACT] luuBaiDiscPortalAction", () => {
  it("[PLB-ACT-1] chưa đăng nhập / cờ tắt ⇒ KHONG_CO_QUYEN, không chạm đường lưu, không tiêu hạn mức", async () => {
    M.phien.mockResolvedValue({ ok: false, loai: "CHUA_DANG_NHAP" });
    expect(await luuBaiDiscPortalAction(HOP_LE)).toEqual({ ok: false, loi: "KHONG_CO_QUYEN" });
    expect(M.luu).not.toHaveBeenCalled();
    expect(M.rate).not.toHaveBeenCalled();
  });
  it("[PLB-ACT-2] userId đưa vào lưu LÀ của phiên — client có gửi userId/studentId của người khác trong thân cũng không đổi được chủ", async () => {
    await luuBaiDiscPortalAction({ ...HOP_LE, userId: "u-ke-tan-cong", claimedUserId: "u-ke-tan-cong" });
    expect(M.luu).toHaveBeenCalledTimes(1);
    const y = M.luu.mock.calls[0]![0] as Record<string, unknown>;
    expect(y.userId).toBe("u-phien");
    expect(JSON.stringify(y)).not.toMatch(/u-ke-tan-cong/);
    expect(M.revalidate).toHaveBeenCalledWith("/portal/disc");
  });
  it("[PLB-ACT-3] chưa tích đồng ý xử lý hồ sơ (hoặc khoá lưu sai dạng) ⇒ DU_LIEU_KHONG_HOP_LE, không lưu", async () => {
    expect(await luuBaiDiscPortalAction({ ...HOP_LE, dongYXuLy: false })).toEqual({ ok: false, loi: "DU_LIEU_KHONG_HOP_LE" });
    expect(await luuBaiDiscPortalAction({ ...HOP_LE, idempotencyKey: "ngan" })).toEqual({ ok: false, loi: "DU_LIEU_KHONG_HOP_LE" });
    expect(await luuBaiDiscPortalAction(null)).toEqual({ ok: false, loi: "DU_LIEU_KHONG_HOP_LE" });
    expect(M.luu).not.toHaveBeenCalled();
  });
  it("[PLB-ACT-4] quá hạn mức theo tài khoản ⇒ QUA_NHIEU_YEU_CAU", async () => {
    M.rate.mockResolvedValue({ success: false });
    expect(await luuBaiDiscPortalAction(HOP_LE)).toEqual({ ok: false, loi: "QUA_NHIEU_YEU_CAU" });
    expect(M.luu).not.toHaveBeenCalled();
    expect(M.rate.mock.calls[0]![0].key).toBe("disc:portal-luu:user:u-phien");
  });
  it("[PLB-ACT-5] đường lưu ném lỗi ⇒ LUU_THAT_BAI chung, không lộ nội dung lỗi", async () => {
    M.luu.mockRejectedValue(new Error("Bé Giả Hai 2017 prisma lỗi"));
    const r = await luuBaiDiscPortalAction(HOP_LE);
    expect(r).toEqual({ ok: false, loi: "LUU_THAT_BAI" });
    expect(JSON.stringify(r)).not.toMatch(/Bé|prisma/);
  });
});
