// @vitest-environment node
//
// Ca [HDA-*] — TẢI LÊN HAI BƯỚC: ký URL PUT (bước 1) → trình duyệt PUT thẳng R2 → xác minh (bước 2).
// (docs/ke-toan-hoa-don/PLAN.md §6.) GĐ 4 thêm ghi bảng hoá đơn — lưu nháp / không xuất / gỡ ([HDA-04..]).
//
// Cổng chung của hai bước — mỗi vế một ca, và ca kiêm nhiệm là ca đáng giá nhất: người vừa là kế toán
// CS2 vừa là sale CS1 qua được `checkPermission("payments:confirm")` trần VÀ thấy đơn CS1, nhưng
// KHÔNG được tải tệp hoá đơn lên đơn CS1.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  bat: vi.fn(async () => true),
  auth: vi.fn(),
  checkPermission: vi.fn(async () => true),
  resolveActor: vi.fn(),
  findUnique: vi.fn(),
  rateLimit: vi.fn(async (_args: { key: string; max: number; windowMs: number }) => ({
    success: true,
    remaining: 59,
    resetAt: 0,
  })),
  khoOk: vi.fn(() => true),
  kyPut: vi.fn(async (khoa: string, ct: string, ttl: number) => `https://r2.test/${khoa}?ct=${ct}&ttl=${ttl}`),
  xacMinh: vi.fn(),
  nap: vi.fn(),
  tao: vi.fn(async () => ({ id: "hd-moi" })),
  capNhat: vi.fn(async () => ({ tepCanXoa: [] as string[] })),
  go: vi.fn(async () => ({ tepCanXoa: [] as string[] })),
  xoaTep: vi.fn(async () => undefined),
  hdFind: vi.fn(),
  coTep: vi.fn(async () => true),
  chot: vi.fn(),
  huy: vi.fn(async () => ({ paymentIds: ["p1"], so: "1C26TSR-127" })),
  khongTrung: vi.fn(async () => undefined),
  guiLai: vi.fn(async () => ({ guiId: "g2", lanGui: 2 })),
  giuTep: vi.fn(async (_sha: string, _tru: string | null) => null as unknown),
  xemTruoc: vi.fn(),
  ganTay: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));
vi.mock("@/lib/finance/hoa-don/hang-cho", () => ({ napHangChoHoaDon: h.nap }));
vi.mock("@/lib/finance/hoa-don/ghi-hoa-don", async (goc) => ({
  ...(await goc<typeof import("@/lib/finance/hoa-don/ghi-hoa-don")>()),
  taoHoaDonChoLanThu: h.tao,
  capNhatHoaDonNhap: h.capNhat,
  goHoaDonChuaChot: h.go,
  huyHoaDonDaXacNhan: h.huy,
  ghiKhongTrung: h.khongTrung,
  timHoaDonDangGiuTepPdf: h.giuTep,
}));
vi.mock("@/lib/finance/hoa-don/feature", () => ({ laHoaDonBat: h.bat }));
vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: h.checkPermission }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: h.resolveActor }));
vi.mock("@/lib/db-scope", () => ({
  scopedDb: () => ({ order: { findUnique: h.findUnique }, hoaDonDienTu: { findUnique: h.hdFind } }),
}));
vi.mock("@/lib/finance/hoa-don/chot-hoa-don", async (goc) => ({
  ...(await goc<typeof import("@/lib/finance/hoa-don/chot-hoa-don")>()),
  chotHoaDon: h.chot,
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: h.rateLimit }));
vi.mock("@/lib/finance/hoa-don/gui-email", () => ({ taoLuotGuiLai: h.guiLai }));
// GĐ 8b — lõi gắn ghi danh chạm DB; ở đây đo CỔNG của action. Lỗi có mã nhận ra bằng `name`.
vi.mock("@/lib/finance/hoa-don/gan-ghi-danh", () => ({
  napXemTruocGanGhiDanh: h.xemTruoc,
  ganGhiDanhTuManHoaDon: h.ganTay,
  thongDiepLoiGanGhiDanh: (e: unknown) => (e instanceof Error && e.name === "LoiGanGhiDanh" ? e.message : null),
}));
vi.mock("@/lib/finance/hoa-don/kho-tep", async (goc) => ({
  ...(await goc<typeof import("@/lib/finance/hoa-don/kho-tep")>()),
  khoHoaDonDaCauHinh: h.khoOk,
  kyUrlTaiLenHoaDon: h.kyPut,
  xacMinhTepHoaDon: h.xacMinh,
  xoaTepHoaDon: h.xoaTep,
  coTepTrongKho: h.coTep,
}));

import {
  ganGhiDanhHoaDonAction,
  goHoaDonAction,
  guiLaiEmailHoaDonAction,
  huyHoaDonAction,
  khongTrungHoaDonAction,
  khongXuatHoaDonAction,
  kyTaiLenHoaDonAction,
  luuHoaDonNhapAction,
  xacMinhTepHoaDonAction,
  xacNhanHoaDonAction,
  xemTruocGanGhiDanhAction,
} from "./_actions";
import { LoiChotHoaDon } from "@/lib/finance/hoa-don/chot-hoa-don";
import { khoaThuocDon } from "@/lib/finance/hoa-don/kho-tep";
import { LoiGhiHoaDon } from "@/lib/finance/hoa-don/ghi-hoa-don";
import { LoiGuiLai } from "@/lib/finance/hoa-don/loi-gui-lai";
import { maskEmail } from "@/lib/utils";

const perm = (action: string, centerScope: "ALL" | string[]) => ({
  action,
  scopeType: "GLOBAL",
  orgUnitId: "ou",
  roleCode: "X",
  centerScope,
});
const KE_TOAN_CS1 = { isSuperAdmin: false, grantsAllow: new Set(), permissions: [perm("payments:confirm", ["cs1"])] };
const KIEM = {
  isSuperAdmin: false,
  grantsAllow: new Set(),
  permissions: [perm("payments:confirm", ["cs2"]), perm("payments:record", ["cs1"])],
};
const DON = { id: "don1", centerId: "cs1", orgUnitId: "ou-cs1", center: { code: "CS1" } };

beforeEach(() => {
  vi.clearAllMocks();
  h.bat.mockResolvedValue(true);
  h.auth.mockResolvedValue({ user: { id: "u1", name: "Kế toán" } });
  h.checkPermission.mockResolvedValue(true);
  h.resolveActor.mockResolvedValue(KE_TOAN_CS1);
  h.findUnique.mockResolvedValue({ ...DON });
  h.rateLimit.mockResolvedValue({ success: true, remaining: 59, resetAt: 0 });
  h.khoOk.mockReturnValue(true);
});

describe("[HDA-01] cổng chung — mỗi vế một ca", () => {
  it("cờ TẮT ⇒ từ chối, không hỏi quyền", async () => {
    h.bat.mockResolvedValue(false);
    expect(await kyTaiLenHoaDonAction({ orderId: "don1", loai: "pdf" })).toMatchObject({ ok: false });
    expect(h.checkPermission).not.toHaveBeenCalled();
  });

  it("chưa đăng nhập ⇒ từ chối", async () => {
    h.auth.mockResolvedValue(null);
    expect(await kyTaiLenHoaDonAction({ orderId: "don1", loai: "pdf" })).toMatchObject({ ok: false });
  });

  it("thiếu payments:confirm ⇒ từ chối, không ký", async () => {
    h.checkPermission.mockResolvedValue(false);
    expect(await kyTaiLenHoaDonAction({ orderId: "don1", loai: "pdf" })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/quyền/i),
    });
    expect(h.kyPut).not.toHaveBeenCalled();
  });

  it("đơn ngoài tầm nhìn ⇒ 'Không tìm thấy đơn hàng'", async () => {
    h.findUnique.mockResolvedValue(null);
    expect(await kyTaiLenHoaDonAction({ orderId: "don1", loai: "pdf" })).toMatchObject({
      ok: false,
      error: "Không tìm thấy đơn hàng",
    });
  });

  it("KIÊM NHIỆM: kế toán CS2 + sale CS1 ⇒ KHÔNG ký được cho đơn CS1", async () => {
    h.resolveActor.mockResolvedValue(KIEM);
    expect(await kyTaiLenHoaDonAction({ orderId: "don1", loai: "pdf" })).toMatchObject({
      ok: false,
      error: "Không tìm thấy đơn hàng",
    });
    expect(h.kyPut).not.toHaveBeenCalled();
  });

  it("cơ sở của đơn chưa có mã ⇒ từ chối (khoá tệp cần mã cơ sở)", async () => {
    h.findUnique.mockResolvedValue({ ...DON, center: { code: null } });
    expect(await kyTaiLenHoaDonAction({ orderId: "don1", loai: "pdf" })).toMatchObject({ ok: false });
    expect(h.kyPut).not.toHaveBeenCalled();
  });

  it("kho chưa cấu hình ⇒ từ chối, nói ra (không để PUT chết câm)", async () => {
    h.khoOk.mockReturnValue(false);
    expect(await kyTaiLenHoaDonAction({ orderId: "don1", loai: "pdf" })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/chưa cấu hình/),
    });
  });

  it("vượt giới hạn lượt ⇒ từ chối, khoá giới hạn theo NGƯỜI", async () => {
    h.rateLimit.mockResolvedValue({ success: false, remaining: 0, resetAt: 0 });
    expect(await kyTaiLenHoaDonAction({ orderId: "don1", loai: "pdf" })).toMatchObject({ ok: false });
    expect(h.rateLimit.mock.calls[0]![0]).toMatchObject({ key: expect.stringContaining("u1") });
  });

  it("đầu vào sai (loại lạ) ⇒ từ chối trước mọi truy vấn", async () => {
    expect(await kyTaiLenHoaDonAction({ orderId: "don1", loai: "exe" })).toMatchObject({ ok: false });
    expect(h.findUnique).not.toHaveBeenCalled();
  });
});

describe("[HDA-02] bước 1 — ký URL PUT", () => {
  it("khoá tệp nằm DƯỚI đơn + cơ sở, ký đúng mime PDF, TTL 300 giây", async () => {
    const r = await kyTaiLenHoaDonAction({ orderId: "don1", loai: "pdf" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(khoaThuocDon(r.data.khoa, "CS1", "don1")).toBe(true);
    expect(r.data.khoa).toMatch(/\.pdf$/);
    expect(r.data.contentType).toBe("application/pdf");
    const [khoa, ct, ttl] = h.kyPut.mock.calls[0]!;
    expect(khoa).toBe(r.data.khoa);
    expect(ct).toBe("application/pdf");
    expect(ttl).toBe(300);
  });

  it("hai lần ký cho cùng đơn ⇒ hai khoá KHÁC nhau (không ghi đè tệp đang dùng)", async () => {
    const a = await kyTaiLenHoaDonAction({ orderId: "don1", loai: "pdf" });
    const b = await kyTaiLenHoaDonAction({ orderId: "don1", loai: "pdf" });
    expect(a.ok && b.ok && a.data.khoa !== b.data.khoa).toBe(true);
  });
});

describe("[HDA-03] bước 2 — xác minh tệp", () => {
  const KHOA_DUNG = "hoa-don/CS1/2026/don1/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b.pdf";

  it("khoá của đơn KHÁC ⇒ từ chối, KHÔNG đụng kho", async () => {
    const r = await xacMinhTepHoaDonAction({
      orderId: "don1",
      loai: "pdf",
      khoa: "hoa-don/CS1/2026/don-khac/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b.pdf",
    });
    expect(r).toMatchObject({ ok: false });
    expect(h.xacMinh).not.toHaveBeenCalled();
  });

  it("đuôi khoá khác loại khai (xin xml, khoá .pdf) ⇒ từ chối", async () => {
    expect(await xacMinhTepHoaDonAction({ orderId: "don1", loai: "xml", khoa: KHOA_DUNG })).toMatchObject({ ok: false });
    expect(h.xacMinh).not.toHaveBeenCalled();
  });

  it("tệp đạt ⇒ trả cỡ + sha256", async () => {
    h.xacMinh.mockResolvedValue({ ok: true, co: 1234, sha256: "ab".repeat(32) });
    expect(await xacMinhTepHoaDonAction({ orderId: "don1", loai: "pdf", khoa: KHOA_DUNG })).toEqual({
      ok: true,
      data: { khoa: KHOA_DUNG, co: 1234, sha256: "ab".repeat(32) },
    });
    expect(h.xacMinh).toHaveBeenCalledWith({ khoa: KHOA_DUNG, loai: "pdf" });
  });

  it("tệp sai loại ⇒ chuyển nguyên câu lỗi cho người dùng", async () => {
    h.xacMinh.mockResolvedValue({ ok: false, ma: "SAI_LOAI", thongDiep: "Tệp không phải PDF" });
    expect(await xacMinhTepHoaDonAction({ orderId: "don1", loai: "pdf", khoa: KHOA_DUNG })).toEqual({
      ok: false,
      error: "Tệp không phải PDF",
    });
  });

  it("KIÊM NHIỆM cũng bị chặn ở bước 2", async () => {
    h.resolveActor.mockResolvedValue(KIEM);
    expect(await xacMinhTepHoaDonAction({ orderId: "don1", loai: "pdf", khoa: KHOA_DUNG })).toMatchObject({ ok: false });
    expect(h.xacMinh).not.toHaveBeenCalled();
  });
});

// ─── GĐ 4 — ghi bảng hoá đơn ──────────────────────────────────────────────────────────────────

const KHOA_PDF = "hoa-don/CS1/2026/don1/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b.pdf";
const KHOA_PDF_2 = "hoa-don/CS1/2026/don1/1f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b.pdf";
const KHOA_XML = "hoa-don/CS1/2026/don1/2f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b.xml";

type NgoaiLeGia = { loai: "THEO_SO_DA_THU" | "KHONG_TRUNG"; daChon: boolean; cau: string } | null;
type DongGia = {
  key: string;
  orderId: string;
  ngan: string;
  khoan: { id: string; soTien: number }[];
  khoanIds: string[];
  soTien: number;
  thieu: number;
  tienTha: number;
  nhanDot: string | null;
  emailNhan: string | null;
  hoaDonNhap: { id: string; phienBan: string } | null;
  hanhDong: {
    taiLen: { bat: boolean; lyDo?: string };
    khongXuat: boolean;
    ngoaiLe: NgoaiLeGia;
    xacNhan?: { bat: boolean; lyDo?: string; nhan?: string };
  };
};
const PB = "2026-09-20T01:00:00.000Z";
const EMAIL = "phuhuynh.don1@example.com";
const NHAN = `Xác nhận & gửi tới ${maskEmail(EMAIL)}`;
const dong = (o: Partial<DongGia> = {}): DongGia => ({
  key: "dot:dot1",
  orderId: "don1",
  ngan: "cho",
  khoan: [
    { id: "p1", soTien: 3_000_000 },
    { id: "p2", soTien: 2_000_000 },
  ],
  khoanIds: ["p1", "p2"],
  soTien: 5_000_000,
  thieu: 0,
  tienTha: 0,
  nhanDot: "Đợt 1",
  emailNhan: EMAIL,
  hoaDonNhap: null,
  hanhDong: { taiLen: { bat: true }, khongXuat: true, ngoaiLe: null },
  ...o,
});
const coDong = (...ds: DongGia[]) => h.nap.mockResolvedValue({ dong: ds, thieuCoSo: 0, khoOk: true });
const LUU = {
  orderId: "don1",
  lanThuKey: "dot:dot1",
  pdf: { khoa: KHOA_PDF, ten: "C:\\fakepath\\HD 127.pdf" },
  kyHieu: "1C26TSR",
  soHoaDon: "00000127",
  ngayPhatHanh: "2026-09-12",
  guiEmailKhach: true,
  soTienDaThay: 5_000_000,
  theoSoDaThu: null,
};
const arg0 = (m: { mock: { calls: unknown[][] } }, i = 0) => m.mock.calls[i]![0] as Record<string, unknown>;

describe("[HDA-04] lưu nháp — tập khoản đến từ LOADER, tệp xác minh LẠI", () => {
  beforeEach(() => {
    coDong(dong());
    h.xacMinh.mockResolvedValue({ ok: true, co: 1234, sha256: "ab".repeat(32) });
  });

  it("tạo mới: khoản + số ròng của loader, tệp đã xác minh, số hoá đơn đã chuẩn hoá", async () => {
    expect(await luuHoaDonNhapAction({ ...LUU, khoan: [{ id: "p9", soTien: 1 }] })).toEqual({
      ok: true,
      data: { hoaDonId: "hd-moi" },
    });
    expect(h.nap).toHaveBeenCalledWith(KE_TOAN_CS1, expect.objectContaining({ orderId: "don1" }));
    expect(h.xacMinh).toHaveBeenCalledWith({ khoa: KHOA_PDF, loai: "pdf" });
    expect(arg0(h.tao)).toMatchObject({
      orderId: "don1",
      centerId: "cs1",
      lanThuKey: "dot:dot1",
      khoan: [
        { id: "p1", soTien: 3_000_000 },
        { id: "p2", soTien: 2_000_000 },
      ],
      loai: {
        trangThai: "NHAP",
        so: { kyHieu: "1C26TSR", soHoaDon: "127" },
        pdf: { khoa: KHOA_PDF, ten: "HD 127.pdf", co: 1234, sha256: "ab".repeat(32) },
        xml: null,
      },
    });
  });

  it("thiếu PDF khi tạo mới ⇒ từ chối, không ghi", async () => {
    const { pdf: _bo, ...khongPdf } = LUU;
    expect(await luuHoaDonNhapAction(khongPdf)).toMatchObject({ ok: false, error: expect.stringMatching(/PDF/) });
    expect(h.tao).not.toHaveBeenCalled();
  });

  it("khoá tệp của đơn khác ⇒ từ chối, không đụng kho, không ghi", async () => {
    const r = await luuHoaDonNhapAction({ ...LUU, pdf: { khoa: KHOA_PDF.replace("/don1/", "/don2/"), ten: "a.pdf" } });
    expect(r).toMatchObject({ ok: false, error: "Tệp không thuộc đơn này" });
    expect(h.xacMinh).not.toHaveBeenCalled();
    expect(h.tao).not.toHaveBeenCalled();
  });

  it("tệp không đạt khi xác minh lại ⇒ từ chối, không ghi", async () => {
    h.xacMinh.mockResolvedValue({ ok: false, ma: "SAI_LOAI", thongDiep: "Tệp không phải PDF" });
    expect(await luuHoaDonNhapAction(LUU)).toEqual({ ok: false, error: "Tệp không phải PDF" });
    expect(h.tao).not.toHaveBeenCalled();
  });

  it("khoá lần thu không còn / lần thu đã có hoá đơn ⇒ từ chối", async () => {
    expect(await luuHoaDonNhapAction({ ...LUU, lanThuKey: "dot:khac" })).toMatchObject({ ok: false });
    coDong(dong({ ngan: "nhap", hoaDonNhap: { id: "hd1", phienBan: PB } }));
    expect(await luuHoaDonNhapAction(LUU)).toMatchObject({ ok: false });
    coDong(dong({ ngan: "da-xuat" }));
    expect(await luuHoaDonNhapAction(LUU)).toMatchObject({ ok: false });
    expect(h.tao).not.toHaveBeenCalled();
  });

  it("ô số sai (ký hiệu lệch năm phát hành) ⇒ từ chối trước khi nạp gì", async () => {
    expect(await luuHoaDonNhapAction({ ...LUU, kyHieu: "1C25TSR" })).toMatchObject({ ok: false });
    expect(h.nap).not.toHaveBeenCalled();
  });

  it("KIÊM NHIỆM kế toán CS2 + sale CS1 ⇒ không lưu được cho đơn CS1", async () => {
    h.resolveActor.mockResolvedValue(KIEM);
    expect(await luuHoaDonNhapAction(LUU)).toMatchObject({ ok: false, error: "Không tìm thấy đơn hàng" });
    expect(h.tao).not.toHaveBeenCalled();
  });

  it("[HDA-GOP-01] (Q2) khoá GỘP ⇒ loader dựng lại với ĐÚNG tập đọc từ khoá; khoá thường ⇒ không gộp gì", async () => {
    const KHOA = "gop:dot:dot1+k:p2";
    coDong(dong({ key: KHOA }));
    expect(await luuHoaDonNhapAction({ ...LUU, lanThuKey: KHOA })).toMatchObject({ ok: true });
    expect(h.nap).toHaveBeenCalledWith(KE_TOAN_CS1, expect.objectContaining({ orderId: "don1", gop: ["dot:dot1", "k:p2"] }));
    expect(arg0(h.tao)).toMatchObject({ lanThuKey: KHOA, khoan: [{ id: "p1" }, { id: "p2" }] });

    h.nap.mockClear();
    coDong(dong());
    await luuHoaDonNhapAction(LUU);
    expect(h.nap).toHaveBeenCalledWith(KE_TOAN_CS1, expect.objectContaining({ gop: [] }));
  });

  it("[HDA-GOP-02] (Q2) loader KHÔNG ra dòng gộp (tập có lần thu đơn khác / đã khoá) ⇒ từ chối, không ghi", async () => {
    coDong(dong({ key: "dot:dot1" }), dong({ key: "k:p2" }));
    expect(await luuHoaDonNhapAction({ ...LUU, lanThuKey: "gop:dot:dot1+k:p2" })).toMatchObject({
      ok: false,
      error: "Lần thu vừa thay đổi — tải lại màn",
    });
    expect(h.tao).not.toHaveBeenCalled();
  });

  it("lỗi nghiệp vụ của tầng ghi ⇒ câu cho người dùng; lỗi lạ ⇒ ném", async () => {
    h.tao.mockRejectedValueOnce(new LoiGhiHoaDon("TRUNG_SO"));
    expect(await luuHoaDonNhapAction(LUU)).toMatchObject({ ok: false, error: expect.stringMatching(/Số hoá đơn/) });
    h.tao.mockRejectedValueOnce(new Error("mất kết nối"));
    await expect(luuHoaDonNhapAction(LUU)).rejects.toThrow("mất kết nối");
  });
});

describe("[HDA-05] sửa nháp", () => {
  beforeEach(() => {
    coDong(dong({ ngan: "nhap", hoaDonNhap: { id: "hd1", phienBan: PB } }));
    h.xacMinh.mockResolvedValue({ ok: true, co: 99, sha256: "cd".repeat(32) });
  });

  it("id nháp không khớp dòng ⇒ từ chối", async () => {
    expect(await luuHoaDonNhapAction({ ...LUU, hoaDonId: "hd-khac" })).toMatchObject({ ok: false });
    expect(h.capNhat).not.toHaveBeenCalled();
  });

  it("đổi PDF + gỡ XML ⇒ tệp cũ được dọn SAU khi ghi", async () => {
    h.capNhat.mockResolvedValueOnce({ tepCanXoa: [KHOA_PDF, KHOA_XML] });
    const r = await luuHoaDonNhapAction({ ...LUU, hoaDonId: "hd1", pdf: { khoa: KHOA_PDF_2, ten: "b.pdf" }, xml: null });
    expect(r).toEqual({ ok: true, data: { hoaDonId: "hd1" } });
    expect(arg0(h.capNhat)).toMatchObject({ hoaDonId: "hd1", pdf: { khoa: KHOA_PDF_2 }, xml: null });
    expect(h.xoaTep.mock.calls.map((c) => (c as unknown as [string])[0])).toEqual([KHOA_PDF, KHOA_XML]);
  });

  it("sửa chỉ ô số (không gửi tệp) ⇒ giữ tệp: pdf/xml undefined, không xác minh", async () => {
    const { pdf: _bo, ...khongTep } = LUU;
    expect(await luuHoaDonNhapAction({ ...khongTep, hoaDonId: "hd1" })).toMatchObject({ ok: true });
    const arg = arg0(h.capNhat);
    expect(arg.pdf).toBeUndefined();
    expect(arg.xml).toBeUndefined();
    expect(h.xacMinh).not.toHaveBeenCalled();
  });
});

describe("[HDA-05b] tiền tha làm tròn (Q-mở 4) đi từ DÒNG LOADER xuống lõi ghi — không từ client", () => {
  beforeEach(() => h.xacMinh.mockResolvedValue({ ok: true, co: 1234, sha256: "ab".repeat(32) }));

  it("tạo nháp: loại NHAP mang đúng `tienTha` của dòng; client gửi kèm số khác ⇒ bỏ qua", async () => {
    coDong(dong({ tienTha: 3_000 }));
    expect(await luuHoaDonNhapAction({ ...LUU, tienTha: 999_999 })).toMatchObject({ ok: true });
    expect(arg0(h.tao)).toMatchObject({ loai: { trangThai: "NHAP", tienTha: 3_000 } });
  });

  it("sửa nháp: lõi sửa nhận đúng `tienTha` của dòng dựng lại", async () => {
    coDong(dong({ ngan: "nhap", hoaDonNhap: { id: "hd1", phienBan: PB }, tienTha: 3_000 }));
    expect(await luuHoaDonNhapAction({ ...LUU, hoaDonId: "hd1" })).toMatchObject({ ok: true });
    expect(arg0(h.capNhat)).toMatchObject({ hoaDonId: "hd1", tienTha: 3_000 });
  });
});

describe("[HDA-06] không xuất + gỡ", () => {
  beforeEach(() => coDong(dong()));

  it("lý do có sẵn ⇒ ghi KHONG_XUAT với khoản của loader", async () => {
    expect(
      await khongXuatHoaDonAction({ orderId: "don1", lanThuKey: "dot:dot1", lyDo: "Khách không lấy hoá đơn" }),
    ).toMatchObject({ ok: true });
    expect(arg0(h.tao)).toMatchObject({
      khoan: [{ id: "p1" }, { id: "p2" }],
      loai: { trangThai: "KHONG_XUAT", lyDo: "Khách không lấy hoá đơn" },
    });
  });

  it("'Khác' thiếu ghi chú ⇒ từ chối trước mọi truy vấn; đủ ghi chú ⇒ lý do 'Khác: …'", async () => {
    expect(
      await khongXuatHoaDonAction({ orderId: "don1", lanThuKey: "dot:dot1", lyDo: "Khác", ghiChu: "abc" }),
    ).toMatchObject({ ok: false });
    expect(h.findUnique).not.toHaveBeenCalled();
    expect(
      await khongXuatHoaDonAction({ orderId: "don1", lanThuKey: "dot:dot1", lyDo: "Khác", ghiChu: "Trả lại học phí" }),
    ).toMatchObject({ ok: true });
    expect((arg0(h.tao).loai as { lyDo: string }).lyDo).toBe("Khác: Trả lại học phí");
  });

  it("dòng đã có hoá đơn nháp ⇒ không đánh dấu được", async () => {
    coDong(dong({ ngan: "nhap", hoaDonNhap: { id: "hd1", phienBan: PB } }));
    expect(
      await khongXuatHoaDonAction({ orderId: "don1", lanThuKey: "dot:dot1", lyDo: "Khách không lấy hoá đơn" }),
    ).toMatchObject({ ok: false });
    expect(h.tao).not.toHaveBeenCalled();
  });

  it("gỡ ⇒ gọi lõi với đúng đơn, dọn tệp; KIÊM NHIỆM ⇒ chặn", async () => {
    h.go.mockResolvedValueOnce({ tepCanXoa: [KHOA_PDF] });
    expect(await goHoaDonAction({ orderId: "don1", hoaDonId: "hd1" })).toMatchObject({ ok: true });
    expect(arg0(h.go)).toMatchObject({ orderId: "don1", hoaDonId: "hd1" });
    expect(h.xoaTep).toHaveBeenCalledWith(KHOA_PDF);
    h.resolveActor.mockResolvedValue(KIEM);
    expect(await goHoaDonAction({ orderId: "don1", hoaDonId: "hd1" })).toMatchObject({ ok: false });
    expect(h.go).toHaveBeenCalledTimes(1);
  });
});

// ─── GĐ 5 — xác nhận hoá đơn ──────────────────────────────────────────────────────────────────

describe("[HDA-07] xác nhận hoá đơn — nút phải SÁNG trên dòng dựng lại, tệp phải CÒN trong kho", () => {
  const nhapDong = (o: Partial<DongGia> & { xacNhan?: { bat: boolean; lyDo?: string; nhan?: string } } = {}) => {
    const { xacNhan, ...rest } = o;
    return {
      ...dong({ ngan: "nhap", hoaDonNhap: { id: "hd1", phienBan: PB }, ...rest }),
      hanhDong: { taiLen: { bat: true }, khongXuat: true, ngoaiLe: null, xacNhan: xacNhan ?? { bat: true, nhan: NHAN } },
    } as DongGia;
  };
  const XN = { orderId: "don1", hoaDonId: "hd1", phienBan: PB, nhanDaThay: NHAN };

  beforeEach(() => {
    coDong(nhapDong(), nhapDong({ key: "dot:dot2", hoaDonNhap: { id: "hd2", phienBan: PB } }));
    h.hdFind.mockResolvedValue({ tepPdfKey: KHOA_PDF, orderId: "don1" });
    h.coTep.mockResolvedValue(true);
    h.chot.mockResolvedValue({
      coGuiEmail: true,
      daXacNhan: [{ paymentId: "p1", receiptCode: "RCP-CS1-26-0001" }],
      conCho: [{ paymentId: "p2", lyDo: "Khoản chưa gắn ghi danh" }],
    });
  });

  it("đường vui: chốt với đúng người + hoá đơn; trả số khoản xác nhận, lý do còn chờ, dòng KẾ TIẾP cùng ngăn", async () => {
    const r = await xacNhanHoaDonAction(XN);
    expect(r).toEqual({
      ok: true,
      data: { daXacNhan: 1, conCho: ["Khoản chưa gắn ghi danh"], keKe: "dot:dot2", guiToi: maskEmail(EMAIL) },
    });
    expect(arg0(h.chot)).toMatchObject({ nguoiChot: { id: "u1" }, orderId: "don1", hoaDonId: "hd1" });
    // Actor ĐÃ GIẢI của người bấm đi xuống lõi — bước chốt đo lại phạm vi kế toán trên TỪNG khoản.
    expect(arg0(h.chot).actor).toBe(KE_TOAN_CS1);
    expect(h.coTep).toHaveBeenCalledWith(KHOA_PDF);
  });

  it("[HDA-07k] dòng KẾ TIẾP tính trên tập ĐÃ LỌC (cơ sở + tháng màn đang xem), không trên toàn bộ", async () => {
    await xacNhanHoaDonAction({ ...XN, coSo: "cs1", thang: "2026-08" });
    // Lượt nạp CUỐI là lượt tính kế tiếp (lượt đầu thu hẹp theo đơn để dựng lại dòng).
    expect(h.nap.mock.calls.at(-1)?.[1]).toMatchObject({ boLoc: { coSo: "cs1", thang: "2026-08" } });
  });

  it("[HDA-07k] cơ sở NGOÀI phạm vi kế toán ⇒ bỏ lọc cơ sở (bộ lọc chỉ thu hẹp); thiếu tháng ⇒ tháng hiện tại", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-31T17:30:00Z")); // 00:30 ngày 01/09 giờ VN
    try {
      await xacNhanHoaDonAction({ ...XN, coSo: "cs2" });
    } finally {
      vi.useRealTimers();
    }
    expect(h.nap.mock.calls.at(-1)?.[1]).toMatchObject({ boLoc: { coSo: null, thang: "2026-09" } });
  });

  it("nút TẮT trên dòng dựng lại ⇒ trả đúng lý do, KHÔNG chốt", async () => {
    coDong(nhapDong({ xacNhan: { bat: false, lyDo: "Còn thiếu số hoá đơn", nhan: NHAN } }));
    expect(await xacNhanHoaDonAction(XN)).toEqual({ ok: false, error: "Còn thiếu số hoá đơn" });
    expect(h.chot).not.toHaveBeenCalled();
  });

  it("hoá đơn không còn là nháp của đơn này ⇒ từ chối, KHÔNG chốt", async () => {
    coDong(dong());
    expect(await xacNhanHoaDonAction(XN)).toMatchObject({ ok: false });
    h.hdFind.mockResolvedValue({ tepPdfKey: KHOA_PDF, orderId: "don-khac" });
    coDong(nhapDong());
    expect(await xacNhanHoaDonAction(XN)).toMatchObject({ ok: false });
    expect(h.chot).not.toHaveBeenCalled();
  });

  it("tệp PDF KHÔNG còn trong kho ⇒ từ chối trước transaction", async () => {
    h.coTep.mockResolvedValue(false);
    expect(await xacNhanHoaDonAction(XN)).toMatchObject({ ok: false, error: expect.stringMatching(/Không thấy tệp PDF/) });
    expect(h.chot).not.toHaveBeenCalled();
  });

  it("lỗi nghiệp vụ của lõi chốt ⇒ câu người đọc được; lỗi lạ ⇒ ném", async () => {
    h.chot.mockRejectedValueOnce(new LoiChotHoaDon("TIEN_DA_DOI"));
    expect(await xacNhanHoaDonAction(XN)).toMatchObject({ ok: false, error: expect.stringMatching(/Số tiền/) });
    h.chot.mockRejectedValueOnce(new Error("mất kết nối"));
    await expect(xacNhanHoaDonAction(XN)).rejects.toThrow("mất kết nối");
  });

  it("KIÊM NHIỆM kế toán CS2 + sale CS1 ⇒ không xác nhận được hoá đơn đơn CS1", async () => {
    h.resolveActor.mockResolvedValue(KIEM);
    expect(await xacNhanHoaDonAction(XN)).toMatchObject({ ok: false, error: "Không tìm thấy đơn hàng" });
    expect(h.chot).not.toHaveBeenCalled();
  });
});

describe("[HDA-08] huỷ hoá đơn đã xác nhận (GĐ 8)", () => {
  const XN = { id: "hd1", trangThai: "DA_XAC_NHAN" };
  const dongXN = (o: Record<string, unknown> = {}) => ({
    key: "dot:dot1",
    ngan: "da-xuat",
    orderId: "don1",
    hoaDon: XN,
    khoanIds: ["p1"],
    huy: { bat: true },
    ...o,
  });
  const dongCho = { key: "dot:dot1", ngan: "cho", orderId: "don1", hoaDon: null, khoanIds: ["p1"], huy: { bat: false } };
  const vao = { orderId: "don1", hoaDonId: "hd1", lyDo: "  Tải nhầm tờ của khách khác  " };

  it("cờ TẮT ⇒ từ chối, KHÔNG hỏi quyền", async () => {
    h.bat.mockResolvedValue(false);
    expect(await huyHoaDonAction(vao)).toMatchObject({ ok: false });
    expect(h.checkPermission).not.toHaveBeenCalled();
    expect(h.huy).not.toHaveBeenCalled();
  });

  it("thiếu payments:confirm ⇒ từ chối", async () => {
    h.checkPermission.mockResolvedValue(false);
    expect(await huyHoaDonAction(vao)).toMatchObject({ ok: false, error: expect.stringMatching(/quyền/i) });
    expect(h.huy).not.toHaveBeenCalled();
  });

  it("lý do < 10 ký tự ⇒ từ chối TRƯỚC mọi truy vấn", async () => {
    expect(await huyHoaDonAction({ ...vao, lyDo: "  nhầm  " })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/ít nhất 10 ký tự/),
    });
    expect(h.nap).not.toHaveBeenCalled();
    expect(h.huy).not.toHaveBeenCalled();
  });

  it("KIÊM NHIỆM kế toán CS2 + sale CS1, đơn CS1 ⇒ 'Không tìm thấy đơn hàng'", async () => {
    h.resolveActor.mockResolvedValue(KIEM);
    expect(await huyHoaDonAction(vao)).toEqual({ ok: false, error: "Không tìm thấy đơn hàng" });
    expect(h.huy).not.toHaveBeenCalled();
  });

  it("không còn dòng đã xác nhận mang hoá đơn đó ⇒ 'vừa được người khác huỷ'", async () => {
    h.nap.mockResolvedValue({ dong: [dongCho], thieuCoSo: 0, khoOk: true });
    expect(await huyHoaDonAction(vao)).toMatchObject({ ok: false, error: expect.stringMatching(/vừa được người khác huỷ/) });
    expect(h.huy).not.toHaveBeenCalled();
  });

  it("nút đang tắt trên chính dòng loader dựng lại ⇒ trả đúng lý do, KHÔNG gọi ghi", async () => {
    h.nap.mockResolvedValue({ dong: [dongXN({ huy: { bat: false, lyDo: "Cần quyền payments:confirm tại cơ sở của đơn" } })] });
    expect(await huyHoaDonAction(vao)).toEqual({ ok: false, error: "Cần quyền payments:confirm tại cơ sở của đơn" });
    expect(h.huy).not.toHaveBeenCalled();
  });

  it("lỗi nghiệp vụ của tầng ghi ⇒ câu cho người dùng; lỗi lạ ⇒ ném tiếp", async () => {
    h.nap.mockResolvedValue({ dong: [dongXN()] });
    h.huy.mockRejectedValueOnce(new LoiGhiHoaDon("DA_DOI"));
    expect(await huyHoaDonAction(vao)).toMatchObject({ ok: false, error: expect.stringMatching(/tải lại màn/) });
    h.huy.mockRejectedValueOnce(new Error("DB sập"));
    await expect(huyHoaDonAction(vao)).rejects.toThrow("DB sập");
  });

  it("thành công ⇒ lý do đã TRIM + mốc thời gian thật; trả dòng hàng chờ vừa nhận lại khoản", async () => {
    h.nap.mockResolvedValueOnce({ dong: [dongXN()] }).mockResolvedValueOnce({ dong: [dongCho] });
    expect(await huyHoaDonAction(vao)).toEqual({ ok: true, data: { chon: "dot:dot1", ngan: "cho" } });
    expect(h.huy).toHaveBeenCalledTimes(1);
    const arg = (h.huy.mock.calls[0] as unknown as [{ lyDo: string; now: unknown; hoaDonId: string; orderId: string }])[0];
    expect(arg).toMatchObject({ lyDo: "Tải nhầm tờ của khách khác", hoaDonId: "hd1", orderId: "don1" });
    expect(arg.now).toBeInstanceOf(Date);
  });

  it("khoản đã hoàn hết (không dòng nào nhận lại) ⇒ chon/ngan null", async () => {
    h.nap.mockResolvedValueOnce({ dong: [dongXN()] }).mockResolvedValueOnce({ dong: [] });
    expect(await huyHoaDonAction(vao)).toEqual({ ok: true, data: { chon: null, ngan: null } });
  });
});

describe("[HDA-09..12] GĐ 8 — xuất theo số đã thu · số tiền đã thấy · không trùng · xác nhận ghim phiên bản", () => {
  const THIEU_CAU = "Thiếu 1.000.000đ so với Đợt 1. Chờ phụ huynh chuyển nốt, hoặc tick \"Xuất theo số đã thu\" khi tải hoá đơn lên (lý do ít nhất 10 ký tự).";
  const dongThieu = (o: Partial<DongGia> = {}) =>
    dong({ thieu: 1_000_000, hanhDong: { taiLen: { bat: true }, khongXuat: true, ngoaiLe: { loai: "THEO_SO_DA_THU", daChon: false, cau: THIEU_CAU } }, ...o });
  const THEO_SO = { lyDo: "Phụ huynh không đóng nốt đợt 1" };

  beforeEach(() => {
    h.xacMinh.mockResolvedValue({ ok: true, co: 1234, sha256: "ab".repeat(32) });
  });

  it("[HDA-09a] lần thu THIẾU mà không chọn 'theo số đã thu' ⇒ trả đúng câu lối ra, KHÔNG ghi", async () => {
    coDong(dongThieu());
    expect(await luuHoaDonNhapAction(LUU)).toEqual({ ok: false, error: THIEU_CAU });
    expect(h.tao).not.toHaveBeenCalled();
  });

  it("[HDA-09b] lý do < 10 ký tự ⇒ từ chối TRƯỚC khi dựng dòng", async () => {
    coDong(dongThieu());
    expect(await luuHoaDonNhapAction({ ...LUU, theoSoDaThu: { lyDo: "ngắn" } })).toMatchObject({ ok: false });
    expect(h.nap).not.toHaveBeenCalled();
  });

  it("[HDA-09c] có lý do ⇒ tầng ghi nhận {lyDo, thieu, nhanDot} của LOADER", async () => {
    coDong(dongThieu());
    expect(await luuHoaDonNhapAction({ ...LUU, theoSoDaThu: THEO_SO })).toMatchObject({ ok: true });
    expect(arg0(h.tao)).toMatchObject({ loai: { theoSoDaThu: { lyDo: THEO_SO.lyDo, thieu: 1_000_000, nhanDot: "Đợt 1" } } });
  });

  it("[HDA-09d] lần thu ĐỦ mà vẫn gửi 'theo số đã thu' (tab cũ) ⇒ từ chối; đường SỬA cùng luật", async () => {
    coDong(dong());
    expect(await luuHoaDonNhapAction({ ...LUU, theoSoDaThu: THEO_SO })).toEqual({
      ok: false,
      error: "Lần thu không còn thiếu tiền — tải lại màn rồi lưu lại",
    });
    coDong(dongThieu({ ngan: "nhap", hoaDonNhap: { id: "hd1", phienBan: PB } }));
    expect(await luuHoaDonNhapAction({ ...LUU, hoaDonId: "hd1" })).toEqual({ ok: false, error: THIEU_CAU });
    expect(await luuHoaDonNhapAction({ ...LUU, hoaDonId: "hd1", theoSoDaThu: THEO_SO })).toMatchObject({ ok: true });
    expect(arg0(h.capNhat)).toMatchObject({ theoSoDaThu: { lyDo: THEO_SO.lyDo } });
  });

  it("[HDA-09e] lưu hỏng ⇒ dọn ĐÚNG tệp vừa tải, KHÔNG đụng tệp đang lưu", async () => {
    coDong(dong());
    h.tao.mockRejectedValueOnce(new LoiGhiHoaDon("TRUNG_SO"));
    expect(await luuHoaDonNhapAction(LUU)).toMatchObject({ ok: false, error: expect.stringMatching(/Số hoá đơn/) });
    expect(h.xoaTep.mock.calls.map((c) => (c as unknown as [string])[0])).toEqual([KHOA_PDF]);

    h.xoaTep.mockClear();
    coDong(dong({ ngan: "nhap", hoaDonNhap: { id: "hd1", phienBan: PB } }));
    h.capNhat.mockRejectedValueOnce(new LoiGhiHoaDon("DA_DOI"));
    const { pdf: _bo, ...khongTep } = LUU;
    expect(await luuHoaDonNhapAction({ ...khongTep, hoaDonId: "hd1" })).toMatchObject({ ok: false });
    expect(h.xoaTep).not.toHaveBeenCalled();
  });

  it("[HDA-10] số tiền kế toán đã thấy ≠ số lần thu hiện tại ⇒ từ chối, không ghi; khớp ⇒ ghi", async () => {
    coDong(dong({ soTien: 6_000_000 }));
    expect(await luuHoaDonNhapAction(LUU)).toMatchObject({ ok: false, error: expect.stringMatching(/6\.000\.000đ/) });
    expect(h.tao).not.toHaveBeenCalled();
    coDong(dong());
    expect(await luuHoaDonNhapAction(LUU)).toMatchObject({ ok: true });
  });

  describe("[HDA-11] khongTrungHoaDonAction", () => {
    const nghiDong = (daChon = false) =>
      dong({
        ngan: "nhap",
        hoaDonNhap: { id: "hd1", phienBan: PB },
        hanhDong: { taiLen: { bat: true }, khongXuat: true, ngoaiLe: { loai: "KHONG_TRUNG", daChon, cau: "cùng đơn có khoản chuyển khoản" } },
      });
    const VAO = { orderId: "don1", hoaDonId: "hd1", phienBan: PB, lyDo: "Đối chiếu sao kê: khai tay là tiền mặt đợt 1" };

    it("cờ tắt / thiếu quyền / kiêm nhiệm ⇒ không ghi", async () => {
      coDong(nghiDong());
      h.bat.mockResolvedValue(false);
      expect(await khongTrungHoaDonAction(VAO)).toMatchObject({ ok: false });
      h.bat.mockResolvedValue(true);
      h.checkPermission.mockResolvedValue(false);
      expect(await khongTrungHoaDonAction(VAO)).toMatchObject({ ok: false });
      h.checkPermission.mockResolvedValue(true);
      h.resolveActor.mockResolvedValue(KIEM);
      expect(await khongTrungHoaDonAction(VAO)).toEqual({ ok: false, error: "Không tìm thấy đơn hàng" });
      expect(h.khongTrung).not.toHaveBeenCalled();
    });

    it("lý do ngắn ⇒ từ chối TRƯỚC khi dựng dòng", async () => {
      coDong(nghiDong());
      expect(await khongTrungHoaDonAction({ ...VAO, lyDo: "không" })).toMatchObject({ ok: false, error: expect.stringMatching(/10 ký tự/) });
      expect(h.nap).not.toHaveBeenCalled();
    });

    it("không còn nghi trùng / đã ghi rồi / phiên bản cũ ⇒ từ chối", async () => {
      coDong(dong({ ngan: "nhap", hoaDonNhap: { id: "hd1", phienBan: PB } }));
      expect(await khongTrungHoaDonAction(VAO)).toMatchObject({ ok: false, error: expect.stringMatching(/không còn nghi trùng/) });
      coDong(nghiDong(true));
      expect(await khongTrungHoaDonAction(VAO)).toMatchObject({ ok: false, error: expect.stringMatching(/Đã xác nhận không trùng/) });
      coDong(nghiDong());
      expect(await khongTrungHoaDonAction({ ...VAO, phienBan: "2026-09-20T02:00:00.000Z" })).toMatchObject({
        ok: false,
        error: expect.stringMatching(/vừa được sửa/),
      });
      expect(h.khongTrung).not.toHaveBeenCalled();
    });

    it("đường vui ⇒ nhật ký lấy từ dòng LOADER, phiên bản là Date", async () => {
      coDong(nghiDong());
      expect(await khongTrungHoaDonAction(VAO)).toEqual({ ok: true, data: { hoaDonId: "hd1" } });
      const a = arg0(h.khongTrung) as { phienBan: unknown; nhatKy: unknown; lyDo: string };
      expect(a.phienBan).toEqual(new Date(PB));
      expect(a.nhatKy).toEqual({ lanThuKey: "dot:dot1", khoanIds: ["p1", "p2"], soTien: 5_000_000, bangChung: "cùng đơn có khoản chuyển khoản" });
      expect(a.lyDo).toBe(VAO.lyDo);
    });
  });

  describe("[HDA-12] xacNhanHoaDonAction ghim phiên bản + nhãn đã thấy", () => {
    const nhapDong = () => ({
      ...dong({ ngan: "nhap", hoaDonNhap: { id: "hd1", phienBan: PB } }),
      hanhDong: { taiLen: { bat: true }, khongXuat: true, ngoaiLe: null, xacNhan: { bat: true, nhan: NHAN } },
    });
    const XN = { orderId: "don1", hoaDonId: "hd1", phienBan: PB, nhanDaThay: NHAN };

    beforeEach(() => {
      coDong(nhapDong());
      h.hdFind.mockResolvedValue({ tepPdfKey: KHOA_PDF, orderId: "don1" });
      h.coTep.mockResolvedValue(true);
      h.chot.mockResolvedValue({ coGuiEmail: true, daXacNhan: [], conCho: [] });
    });

    it("phiên bản khác ⇒ 'vừa được sửa', KHÔNG chốt", async () => {
      expect(await xacNhanHoaDonAction({ ...XN, phienBan: "2026-09-20T02:00:00.000Z" })).toMatchObject({
        ok: false,
        error: expect.stringMatching(/vừa được sửa/),
      });
      expect(h.chot).not.toHaveBeenCalled();
    });

    it("nhãn nút đã thấy khác nhãn hiện tại (email đổi) ⇒ từ chối, KHÔNG chốt", async () => {
      expect(await xacNhanHoaDonAction({ ...XN, nhanDaThay: "Xác nhận & gửi tới a*@x.vn" })).toMatchObject({
        ok: false,
        error: expect.stringMatching(/gửi email vừa đổi/),
      });
      expect(h.chot).not.toHaveBeenCalled();
    });

    it("khớp ⇒ chốt với phiên bản Date + email THẬT của loader; HEAD kho chạy TRƯỚC khi dựng dòng", async () => {
      expect(await xacNhanHoaDonAction(XN)).toMatchObject({ ok: true });
      expect(arg0(h.chot)).toMatchObject({ phienBan: new Date(PB), emailDuKien: EMAIL });
      expect(h.coTep.mock.invocationCallOrder[0]!).toBeLessThan(h.nap.mock.invocationCallOrder[0]!);
    });
  });
});

describe("[HDA-13] guiLaiEmailHoaDonAction — gửi lại email hoá đơn đã xác nhận (GĐ 8)", () => {
  const TOI = "phuhuynh.don1@example.com";
  const TOI_DON = "ketoan.cty@example.com";
  const dongXN = (email: Record<string, unknown> = {}, o: Record<string, unknown> = {}) => ({
    key: "dot:dot1",
    ngan: "da-xuat",
    orderId: "don1",
    hoaDon: { id: "hd1", trangThai: "DA_XAC_NHAN" },
    email: { guiLai: { bat: true, nhan: "Gửi lại email" }, toiMacDinh: TOI, toiDon: null, lanGui: 1, trangThai: null, ...email },
    ...o,
  });
  const VAO = { orderId: "don1", hoaDonId: "hd1", nguon: "HOA_DON", toiDaThay: TOI };

  beforeEach(() => {
    h.nap.mockResolvedValue({ dong: [dongXN()], thieuCoSo: 0, khoOk: true });
    h.hdFind.mockResolvedValue({ tepPdfKey: "hoa-don/CS1/2026/don1/u.pdf", orderId: "don1" });
    h.coTep.mockResolvedValue(true);
  });

  it("cờ TẮT ⇒ không dựng dòng; thiếu quyền ⇒ không gửi; kiêm nhiệm ⇒ 'Không tìm thấy đơn hàng'", async () => {
    h.bat.mockResolvedValue(false);
    expect(await guiLaiEmailHoaDonAction(VAO)).toMatchObject({ ok: false });
    expect(h.nap).not.toHaveBeenCalled();
    h.bat.mockResolvedValue(true);
    h.checkPermission.mockResolvedValue(false);
    expect(await guiLaiEmailHoaDonAction(VAO)).toMatchObject({ ok: false, error: expect.stringMatching(/quyền/i) });
    h.checkPermission.mockResolvedValue(true);
    h.resolveActor.mockResolvedValue(KIEM);
    expect(await guiLaiEmailHoaDonAction(VAO)).toEqual({ ok: false, error: "Không tìm thấy đơn hàng" });
    expect(h.guiLai).not.toHaveBeenCalled();
  });

  it("trần lượt bấm theo NGƯỜI (`hoa-don-gui-lai:<userId>`, 20/giờ) — vượt ⇒ từ chối", async () => {
    h.rateLimit.mockResolvedValue({ success: false, remaining: 0, resetAt: 0 });
    expect(await guiLaiEmailHoaDonAction(VAO)).toMatchObject({ ok: false, error: expect.stringMatching(/quá nhiều/) });
    expect(h.rateLimit).toHaveBeenCalledWith({ key: "hoa-don-gui-lai:u1", max: 20, windowMs: 3_600_000 });
    expect(h.guiLai).not.toHaveBeenCalled();
  });

  it("dòng không còn ĐÃ XÁC NHẬN / nút tắt ⇒ đúng câu, không gửi", async () => {
    h.nap.mockResolvedValue({ dong: [dongXN({}, { hoaDon: { id: "hd1", trangThai: "NHAP" }, email: null })] });
    expect(await guiLaiEmailHoaDonAction(VAO)).toMatchObject({ ok: false, error: expect.stringMatching(/tải lại màn/) });
    h.nap.mockResolvedValue({ dong: [dongXN({ guiLai: { bat: false, lyDo: "Lượt gửi trước còn đang chạy — đợi kết quả rồi hãy gửi lại", nhan: "Gửi lại email" } })] });
    expect(await guiLaiEmailHoaDonAction(VAO)).toEqual({ ok: false, error: "Lượt gửi trước còn đang chạy — đợi kết quả rồi hãy gửi lại" });
    expect(h.guiLai).not.toHaveBeenCalled();
  });

  it("địa chỉ đã thấy: nhận bản THẬT và bản CHE; khác cả hai ⇒ từ chối", async () => {
    expect(await guiLaiEmailHoaDonAction({ ...VAO, toiDaThay: "khac@example.com" })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Email nhận vừa đổi/),
    });
    expect(h.guiLai).not.toHaveBeenCalled();
    expect(await guiLaiEmailHoaDonAction({ ...VAO, toiDaThay: maskEmail(TOI) })).toMatchObject({ ok: true });
    expect(await guiLaiEmailHoaDonAction(VAO)).toEqual({ ok: true, data: { toi: maskEmail(TOI), lanGui: 2 } });
    expect(h.guiLai).toHaveBeenLastCalledWith({ nguoiGui: { id: "u1", name: "Kế toán" }, orderId: "don1", hoaDonId: "hd1", toi: TOI, nguon: "HOA_DON" });
  });

  it("gửi tới email HIỆN TẠI của đơn: chỉ khi đơn có địa chỉ khác; lõi nhận địa chỉ THẬT của loader", async () => {
    expect(await guiLaiEmailHoaDonAction({ ...VAO, nguon: "DON_HIEN_TAI", toiDaThay: TOI_DON })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/không khác email của hoá đơn/),
    });
    h.nap.mockResolvedValue({ dong: [dongXN({ toiDon: TOI_DON })] });
    expect(await guiLaiEmailHoaDonAction({ ...VAO, nguon: "DON_HIEN_TAI", toiDaThay: maskEmail(TOI_DON) })).toMatchObject({ ok: true });
    expect(h.guiLai).toHaveBeenLastCalledWith(expect.objectContaining({ toi: TOI_DON, nguon: "DON_HIEN_TAI" }));
  });

  it("tệp PDF không còn trong kho ⇒ không gửi", async () => {
    h.coTep.mockResolvedValue(false);
    expect(await guiLaiEmailHoaDonAction(VAO)).toMatchObject({ ok: false, error: expect.stringMatching(/tệp PDF/) });
    expect(h.guiLai).not.toHaveBeenCalled();
  });

  it("LoiGuiLai ⇒ câu cho người dùng; lỗi lạ ⇒ ném tiếp (không nuốt)", async () => {
    h.guiLai.mockRejectedValueOnce(new LoiGuiLai("DANG_GUI"));
    expect(await guiLaiEmailHoaDonAction(VAO)).toEqual({ ok: false, error: "Lượt gửi trước còn đang chạy — đợi kết quả rồi hãy gửi lại" });
    h.guiLai.mockRejectedValueOnce(new Error("DB sập"));
    await expect(guiLaiEmailHoaDonAction(VAO)).rejects.toThrow("DB sập");
  });
});

describe("[HDA-14/15] GĐ 8 — tệp PDF đã gắn cho hoá đơn khác còn sống", () => {
  const SHA = "cd".repeat(32);
  const GIU = { id: "hdX", orderId: "don2", centerId: "cs1", kyHieu: "1C26TSR", soHoaDon: "127", trangThai: "NHAP", maDon: "ORD-260910-000002" };
  beforeEach(() => {
    h.xacMinh.mockResolvedValue({ ok: true, co: 1234, sha256: SHA });
    h.giuTep.mockResolvedValue(null);
  });

  it("[HDA-14a] trùng trong phạm vi ⇒ nêu số + mã đơn; dọn ĐÚNG khoá vừa tải", async () => {
    h.giuTep.mockResolvedValue(GIU);
    const r = await xacMinhTepHoaDonAction({ orderId: "don1", loai: "pdf", khoa: KHOA_PDF });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/1C26TSR-127 \(nháp\) của đơn ORD-260910-000002/) });
    expect(h.giuTep).toHaveBeenCalledWith(SHA, null);
    expect(h.xoaTep.mock.calls.map((c) => (c as unknown as [string])[0])).toEqual([KHOA_PDF]);
  });

  it("[HDA-14b] trùng NGOÀI phạm vi ⇒ không lộ mã đơn / số hoá đơn; vẫn dọn khoá vừa tải", async () => {
    h.giuTep.mockResolvedValue({ ...GIU, centerId: "cs2" });
    const r = await xacMinhTepHoaDonAction({ orderId: "don1", loai: "pdf", khoa: KHOA_PDF });
    expect(r).toEqual({ ok: false, error: "Tệp PDF này đã gắn cho một hoá đơn ở cơ sở khác — kiểm lại tệp" });
    expect(h.xoaTep).toHaveBeenCalledWith(KHOA_PDF);
  });

  it("[HDA-14c] bản nháp đang sửa được trừ ra; tệp XML không hỏi; không trùng ⇒ qua, không dọn", async () => {
    expect(await xacMinhTepHoaDonAction({ orderId: "don1", loai: "pdf", khoa: KHOA_PDF, hoaDonId: "hd1" })).toMatchObject({ ok: true });
    expect(h.giuTep).toHaveBeenCalledWith(SHA, "hd1");
    h.giuTep.mockClear();
    expect(await xacMinhTepHoaDonAction({ orderId: "don1", loai: "xml", khoa: KHOA_XML })).toMatchObject({ ok: true });
    expect(h.giuTep).not.toHaveBeenCalled();
    expect(h.xoaTep).not.toHaveBeenCalled();
  });

  it("[HDA-15] lõi ném TEP_TRUNG lúc lưu ⇒ câu theo phạm vi; dọn đúng tệp vừa tải", async () => {
    coDong(dong());
    h.tao.mockRejectedValueOnce(new LoiGhiHoaDon("TEP_TRUNG", GIU));
    expect(await luuHoaDonNhapAction(LUU)).toMatchObject({ ok: false, error: expect.stringMatching(/ORD-260910-000002/) });
    expect(h.xoaTep.mock.calls.map((c) => (c as unknown as [string])[0])).toEqual([KHOA_PDF]);
  });
});

describe("[HDA-16/17] GĐ 8b — gắn ghi danh từ màn hoá đơn", () => {
  const DAU = "ab".repeat(32);
  const dongGan = (o: Record<string, unknown> = {}) => ({
    key: "dot:dot1",
    ngan: "cho",
    orderId: "don1",
    khoanIds: ["p1", "p2"],
    hoaDon: null,
    khoanChuaGanGhiDanh: [{ id: "p1", soTien: 3_000_000 }],
    ...o,
  });
  const XT = { key: "dot:dot1", dau: DAU, chan: null, soGan: 1, soTach: 0, dong: [] };
  const VAO = { orderId: "don1", lanThuKey: "dot:dot1" };
  const loiCoMa = (msg: string) => Object.assign(new Error(msg), { name: "LoiGanGhiDanh" });

  beforeEach(() => {
    h.nap.mockResolvedValue({ dong: [dongGan()], thieuCoSo: 0, khoOk: true });
    h.xemTruoc.mockResolvedValue(XT);
    h.ganTay.mockResolvedValue({ gan: 1, tach: 0, boQua: 0 });
  });

  describe("[HDA-16] xemTruocGanGhiDanhAction — chỉ đọc", () => {
    it("cờ TẮT / thiếu quyền / kiêm nhiệm ⇒ không dựng kế hoạch", async () => {
      h.bat.mockResolvedValue(false);
      expect(await xemTruocGanGhiDanhAction(VAO)).toMatchObject({ ok: false });
      h.bat.mockResolvedValue(true);
      h.checkPermission.mockResolvedValue(false);
      expect(await xemTruocGanGhiDanhAction(VAO)).toMatchObject({ ok: false, error: expect.stringMatching(/quyền/i) });
      h.checkPermission.mockResolvedValue(true);
      h.resolveActor.mockResolvedValue(KIEM);
      expect(await xemTruocGanGhiDanhAction(VAO)).toEqual({ ok: false, error: "Không tìm thấy đơn hàng" });
      expect(h.xemTruoc).not.toHaveBeenCalled();
    });

    it("dòng không còn / ngăn đơn đã huỷ ⇒ từ chối; đường vui ⇒ kế hoạch của ĐÚNG lần thu", async () => {
      h.nap.mockResolvedValue({ dong: [] });
      expect(await xemTruocGanGhiDanhAction(VAO)).toEqual({ ok: false, error: "Lần thu vừa thay đổi — tải lại màn" });
      h.nap.mockResolvedValue({ dong: [dongGan({ ngan: "don-huy" })] });
      expect(await xemTruocGanGhiDanhAction(VAO)).toMatchObject({ ok: false, error: expect.stringMatching(/Đơn đã huỷ/) });
      expect(h.xemTruoc).not.toHaveBeenCalled();

      h.nap.mockResolvedValue({ dong: [dongGan()] });
      expect(await xemTruocGanGhiDanhAction(VAO)).toEqual({ ok: true, data: XT });
      expect(h.xemTruoc).toHaveBeenCalledWith({ actor: KE_TOAN_CS1, orderId: "don1", lanThuKey: "dot:dot1", khoanTrongLanThu: ["p1", "p2"] });
      expect(h.ganTay).not.toHaveBeenCalled();
    });
  });

  describe("[HDA-17] ganGhiDanhHoaDonAction", () => {
    it("cờ TẮT / thiếu quyền / kiêm nhiệm / dấu sai dạng ⇒ KHÔNG gọi lõi; đối chứng: kế toán CS1 ⇒ gọi", async () => {
      h.bat.mockResolvedValue(false);
      expect(await ganGhiDanhHoaDonAction({ ...VAO, dauKeHoach: DAU })).toMatchObject({ ok: false });
      h.bat.mockResolvedValue(true);
      h.checkPermission.mockResolvedValue(false);
      expect(await ganGhiDanhHoaDonAction({ ...VAO, dauKeHoach: DAU })).toMatchObject({ ok: false });
      h.checkPermission.mockResolvedValue(true);
      h.resolveActor.mockResolvedValue(KIEM);
      expect(await ganGhiDanhHoaDonAction({ ...VAO, dauKeHoach: DAU })).toEqual({ ok: false, error: "Không tìm thấy đơn hàng" });
      h.resolveActor.mockResolvedValue(KE_TOAN_CS1);
      expect(await ganGhiDanhHoaDonAction({ ...VAO, dauKeHoach: "khong-phai-dau" })).toEqual({ ok: false, error: "Yêu cầu không hợp lệ" });
      expect(h.ganTay).not.toHaveBeenCalled();

      expect(await ganGhiDanhHoaDonAction({ ...VAO, dauKeHoach: DAU })).toMatchObject({ ok: true, data: { gan: 1 } });
      expect(h.ganTay).toHaveBeenCalledWith({
        actor: KE_TOAN_CS1,
        nguoiGhi: { id: "u1", name: "Kế toán" },
        orderId: "don1",
        lanThuKey: "dot:dot1",
        dauKeHoach: DAU,
      });
    });

    it("dòng không còn / đơn đã huỷ ⇒ từ chối; lần thu đã gắn hết ⇒ ok, KHÔNG gọi lõi (bấm lại lần hai)", async () => {
      h.nap.mockResolvedValue({ dong: [] });
      expect(await ganGhiDanhHoaDonAction({ ...VAO, dauKeHoach: DAU })).toMatchObject({ ok: false, error: expect.stringMatching(/vừa thay đổi/) });
      h.nap.mockResolvedValue({ dong: [dongGan({ ngan: "don-huy" })] });
      expect(await ganGhiDanhHoaDonAction({ ...VAO, dauKeHoach: DAU })).toMatchObject({ ok: false, error: expect.stringMatching(/Đơn đã huỷ/) });
      h.nap.mockResolvedValue({ dong: [dongGan({ khoanChuaGanGhiDanh: [] })] });
      expect(await ganGhiDanhHoaDonAction({ ...VAO, dauKeHoach: DAU })).toMatchObject({
        ok: true,
        data: { gan: 0, tach: 0, thongDiep: "Các khoản của lần thu này đã gắn ghi danh" },
      });
      expect(h.ganTay).not.toHaveBeenCalled();
    });

    it("lỗi CÓ MÃ ⇒ câu cho người dùng; lỗi lạ ⇒ ném tiếp (không nuốt)", async () => {
      h.ganTay.mockRejectedValueOnce(loiCoMa("Khoản hoặc ghi danh của đơn vừa thay đổi"));
      expect(await ganGhiDanhHoaDonAction({ ...VAO, dauKeHoach: DAU })).toEqual({ ok: false, error: "Khoản hoặc ghi danh của đơn vừa thay đổi" });
      h.ganTay.mockRejectedValueOnce(new Error("DB sập"));
      await expect(ganGhiDanhHoaDonAction({ ...VAO, dauKeHoach: DAU })).rejects.toThrow("DB sập");
    });

    it("thành công ⇒ làm mới màn hoá đơn · đơn · Thanh toán · công nợ; bước tiếp nói theo trạng thái hoá đơn", async () => {
      const r = await ganGhiDanhHoaDonAction({ ...VAO, dauKeHoach: DAU });
      expect(r).toMatchObject({ ok: true, data: { thongDiep: "Đã gắn ghi danh cho 1 khoản", buocTiep: "Tải hoá đơn lên rồi bấm Xác nhận để cấp phiếu thu" } });
      const duong = h.revalidatePath.mock.calls.map((c) => (c as unknown as [string])[0]);
      for (const x of ["/payments/hoa-don", "/orders/don1", "/payments", "/cong-no"]) expect(duong).toContain(x);

      h.nap.mockResolvedValue({ dong: [dongGan({ hoaDon: { id: "hd1", trangThai: "DA_XAC_NHAN" } })] });
      h.ganTay.mockResolvedValue({ gan: 0, tach: 1, boQua: 0 });
      expect(await ganGhiDanhHoaDonAction({ ...VAO, dauKeHoach: DAU })).toMatchObject({
        ok: true,
        data: { thongDiep: "Đã gắn ghi danh cho 1 khoản (chia 1 khoản theo bé)", buocTiep: "Khoản vẫn chờ xác nhận ở màn Thanh toán" },
      });
    });
  });
});
