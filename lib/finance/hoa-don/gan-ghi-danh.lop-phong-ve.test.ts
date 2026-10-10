// Ca [GHD-L1] — lớp phòng vệ thứ hai của "Gắn ghi danh" từ màn hoá đơn (GĐ 8b, lượt cấy 27/09).
//
// Lượt cấy lại tìm ra một lớp mà KHÔNG ca Postgres nào chạm được: `thucHienKeHoachGan` trả khoản "đổi
// 0 dòng" (`doi`) ⇒ lõi phải NÉM để hoàn cả lượt. Trên DB thật lớp này bị khoá đơn + dấu kế hoạch che
// trước (kế hoạch dựng lại DƯỚI khoá, nên không đường nào kịp đổi khoản giữa lúc dựng và lúc ghi) — hôm
// nay đúng, nhưng có ngày một đường ghi Payment không đi qua khoá đơn, và khi ấy lớp này là thứ duy
// nhất ngăn một lượt gắn NỬA VỜI được commit kèm dòng nhật ký nói "đã gắn". Ở đây đo HÀNH VI của lõi
// với phép ghi giả lập trả `doi`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/auth/actor";
import { dauKeHoachGan, lapKeHoachGanGhiDanh } from "@/lib/finance/ke-hoach-gan-ghi-danh";
import type { DuLieuGanGhiDanh } from "@/lib/finance/payment";

const h = vi.hoisted(() => ({
  nap: vi.fn(),
  thucHien: vi.fn(),
  khoa: vi.fn(async () => undefined),
  audit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/db", () => ({ db: { $transaction: (fn: (tx: unknown) => unknown) => fn({}) } }));
vi.mock("@/lib/audit/audit-log", () => ({ writeAudit: h.audit }));
vi.mock("@/lib/finance/ghi-tien-don", () => ({ khoaDonTrongTx: h.khoa }));
vi.mock("@/lib/finance/payment", () => ({ napGanGhiDanhCuaDon: h.nap, thucHienKeHoachGan: h.thucHien }));

import { ganGhiDanhTuManHoaDon } from "./gan-ghi-danh";

const duLieu: DuLieuGanGhiDanh = {
  orderId: "don1",
  orderCenterId: "cs1",
  khoan: [
    {
      id: "p1",
      amount: 3_000_000,
      paymentType: "PAYMENT",
      accountantStatus: "PENDING",
      rong: 3_000_000,
      orderId: "don1",
      method: "CASH",
      paidDate: new Date("2026-09-20T03:00:00Z"),
      note: null,
      evidenceUrl: null,
      recordedById: "sale1",
      centerId: "cs1",
    },
  ],
  dongDon: [{ studentId: null, courseId: "k4", thanhTien: 3_000_000 }],
  ghiDanh: [{ enrollmentId: "gd1", studentId: "hs1", courseId: "k4", finalPrice: 6_000_000, centerId: "cs1" }],
  coHocVien: true,
  daKhoa: new Map(),
};
const QTTC = { isSuperAdmin: true, grantsAllow: new Set<string>(), permissions: [] } as unknown as Actor;
const DAU = dauKeHoachGan(lapKeHoachGanGhiDanh({ ...duLieu, trongTam: () => true }));
const goi = () =>
  ganGhiDanhTuManHoaDon({ actor: QTTC, nguoiGhi: { id: "kt1", name: "Kế toán" }, orderId: "don1", lanThuKey: "k:p1", dauKeHoach: DAU });

describe("[GHD-L1] có khoản đổi 0 dòng ⇒ hoàn CẢ lượt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.nap.mockResolvedValue(duLieu);
  });

  it("fixture: kế hoạch đúng là MỘT khoản GẮN (không thì ca dưới xanh vì lý do khác)", () => {
    const kh = lapKeHoachGanGhiDanh({ ...duLieu, trongTam: () => true });
    expect(kh.chan).toBeNull();
    expect(kh.dong.map((d) => d.ketQua)).toEqual(["GAN"]);
  });

  it("phép ghi báo `doi` ⇒ NÉM lỗi có mã KE_HOACH_DA_DOI, KHÔNG ghi nhật ký 'đã gắn'", async () => {
    h.thucHien.mockResolvedValue({ linked: 0, splitCreated: 0, doi: ["p1"] });
    await expect(goi()).rejects.toMatchObject({ name: "LoiGanGhiDanh", ma: "KE_HOACH_DA_DOI" });
    expect(h.thucHien).toHaveBeenCalledTimes(1);
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("đối chứng: phép ghi trọn ⇒ trả số gắn + đúng MỘT dòng nhật ký trên đơn", async () => {
    h.thucHien.mockResolvedValue({ linked: 1, splitCreated: 0, doi: [] });
    await expect(goi()).resolves.toEqual({ gan: 1, tach: 0, boQua: 0 });
    expect(h.khoa).toHaveBeenCalledWith({}, "don1");
    expect(h.audit).toHaveBeenCalledTimes(1);
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "GAN_GHI_DANH_KHOAN", entityId: "don1" }));
  });
});
