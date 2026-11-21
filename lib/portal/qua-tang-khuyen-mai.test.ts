// @vitest-environment node
// [QKM] «Quà tặng» + «Khuyến mãi» + «Thu nhập thêm» (12/11/2026): danh mục quà theo cờ, khuyến mãi chỉ hiện thứ an toàn và đang hiệu lực,
// thu nhập thêm che SĐT + chỉ tìm khớp khi gõ đúng đủ số + ẩn sau cờ.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const promotionFindMany = vi.fn();
const orgUnitFindMany = vi.fn();
const referralFindMany = vi.fn();
const partyIds = vi.fn();
vi.mock("@/lib/db", () => ({
  db: {
    promotionPolicy: { findMany: (...a: unknown[]) => promotionFindMany(...a) },
    orgUnit: { findMany: (...a: unknown[]) => orgUnitFindMany(...a) },
    affiliateReferral: { findMany: (...a: unknown[]) => referralFindMany(...a) },
    center: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/affiliate/tai-khoan-truy-cap", () => ({ partyIdsVaoDuoc: (...a: unknown[]) => partyIds(...a) }));

import { DANH_MUC_QUA_TANG, coQuaTangNao, quaTangDangMo } from "./qua-tang";
import { docKhuyenMaiChoPhuHuynh } from "./khuyen-mai-ph";
import { chePhoneThuNhap, docThuNhapThem, khopSoDienThoai, tyLeChot } from "@/lib/nguon/thu-nhap-them";

const doc = (p: string) =>
  readFileSync(resolve(process.cwd(), p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const TAT = { disc: false, sucKhoe: false, tuSach: false };
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

beforeEach(() => {
  promotionFindMany.mockReset();
  orgUnitFindMany.mockReset();
  orgUnitFindMany.mockResolvedValue([]);
  referralFindMany.mockReset();
  partyIds.mockReset();
});
afterEach(() => {
  delete process.env.THU_NHAP_THEM_ENABLED;
});

describe("[QKM] hộp quà", () => {
  it("[QKM-01] mọi cờ tắt ⇒ hộp quà tắt; bật cờ nào thì quà đó hiện, giữ thứ tự danh mục", () => {
    expect(coQuaTangNao(TAT)).toBe(false);
    expect(quaTangDangMo(TAT)).toEqual([]);
    expect(quaTangDangMo({ disc: false, sucKhoe: true, tuSach: true }).map((q) => q.ma)).toEqual(["suc-khoe", "tu-sach"]);
    expect(quaTangDangMo({ disc: true, sucKhoe: true, tuSach: true }).map((q) => q.ma)).toEqual(["disc", "suc-khoe", "tu-sach"]);
    expect(coQuaTangNao({ ...TAT, tuSach: true })).toBe(true);
  });

  it("[QKM-02] mỗi quà trỏ đúng trang đích sẵn có và có đủ chữ", () => {
    expect(DANH_MUC_QUA_TANG.map((q) => q.href)).toEqual(["/portal/disc", "/portal/suc-khoe", "/portal/tu-sach"]);
    for (const q of DANH_MUC_QUA_TANG) expect(q.ten && q.mo && q.nut).toBeTruthy();
  });
});

describe("[QKM] khuyến mãi cho phụ huynh", () => {
  const goc = { benefitText: "Giảm 10%", conditionText: "Đóng cả học phần", orgUnitIds: [] as string[], revokedAt: null as Date | null };

  it("[QKM-03] chỉ chương trình ĐANG hiệu lực; hết hạn / đã thu hồi / sắp áp dụng bị loại", async () => {
    promotionFindMany.mockResolvedValue([
      { id: "a", name: "Đang chạy", ...goc, validFrom: d("2026-11-01"), validUntil: d("2026-12-31") },
      { id: "b", name: "Hết hạn", ...goc, validFrom: d("2026-01-01"), validUntil: d("2026-10-31") },
      { id: "c", name: "Thu hồi", ...goc, validFrom: d("2026-11-01"), validUntil: d("2026-12-31"), revokedAt: new Date("2026-11-05T03:00:00Z") },
      { id: "e", name: "Sắp áp dụng", ...goc, validFrom: d("2026-12-01"), validUntil: d("2026-12-31") },
    ]);
    const kq = await docKhuyenMaiChoPhuHuynh(null, new Date("2026-11-12T03:00:00Z"));
    expect(kq.map((k) => k.id)).toEqual(["a"]);
    expect(kq[0]!.hetHan).toBe("31/12/2026");
  });

  it("[QKM-04] giới hạn theo cơ sở: `orgUnitIds` là ID ⇒ đổi sang MÃ; chương trình của CS2 không hiện cho tài khoản chưa có bé / bé CS1; id lạ bị LOẠI (fail-closed)", async () => {
    promotionFindMany.mockResolvedValue([
      { id: "cs2", name: "Riêng CS2", ...goc, orgUnitIds: ["ou-cs2"], validFrom: d("2026-11-01"), validUntil: d("2026-12-31") },
      { id: "la", name: "Id không còn trên cây", ...goc, orgUnitIds: ["ou-da-xoa"], validFrom: d("2026-11-01"), validUntil: d("2026-12-31") },
      { id: "all", name: "Toàn hệ thống", ...goc, validFrom: d("2026-11-01"), validUntil: d("2026-12-31") },
    ]);
    orgUnitFindMany.mockResolvedValue([{ id: "ou-cs2", code: "CS2" }]);
    const now = new Date("2026-11-12T03:00:00Z");
    expect((await docKhuyenMaiChoPhuHuynh(null, now)).map((k) => k.id)).toEqual(["all"]);
    expect((await docKhuyenMaiChoPhuHuynh("CS1", now)).map((k) => k.id)).toEqual(["all"]);
    expect((await docKhuyenMaiChoPhuHuynh("CS2", now)).map((k) => k.id).sort()).toEqual(["all", "cs2"]);
  });

  it("[QKM-05] select CHỈ lấy cột hiển thị — không mã văn bản, tệp, lý do thu hồi, người tạo; kết quả không có mã voucher", async () => {
    promotionFindMany.mockResolvedValue([]);
    await docKhuyenMaiChoPhuHuynh(null, new Date("2026-11-12T03:00:00Z"));
    const sel = (promotionFindMany.mock.calls[0]![0] as { select: Record<string, unknown> }).select;
    for (const cam of ["documentCode", "fileKey", "fileName", "fileUrl", "revokeReason", "createdById", "updatedById", "vouchers"]) {
      expect(Object.keys(sel), cam).not.toContain(cam);
    }
    expect(doc("lib/portal/khuyen-mai-ph.ts")).not.toMatch(/\bvoucher\b/i);
  });
});

describe("[QKM] thu nhập thêm", () => {
  it("[QKM-06] che SĐT dạng 09xxxx7098 cho mọi cách viết", () => {
    for (const s of ["0999997098", "+84999997098", "84999997098", "0999 997 098"]) expect(chePhoneThuNhap(s), s).toBe("09xxxx7098");
    expect(chePhoneThuNhap("abc")).toBe("xxxxxxxxxx");
    expect(chePhoneThuNhap(null)).toBe("xxxxxxxxxx");
  });

  it("[QKM-07] tìm theo SĐT: gõ ĐÚNG ĐỦ SỐ thì khớp (mọi cách viết); gõ thiếu hoặc số khác thì KHÔNG", () => {
    for (const q of ["0999997098", "84999997098", "+84 999 997 098", "0999.997.098"]) expect(khopSoDienThoai(q, "0999997098"), q).toBe(true);
    for (const q of ["099999", "9997098", "0999997099", "", "abc"]) expect(khopSoDienThoai(q, "0999997098"), q).toBe(false);
  });

  it("[QKM-08] tỉ lệ chốt: làm tròn, null khi chưa có lead", () => {
    expect(tyLeChot(0, 0)).toBeNull();
    expect(tyLeChot(3, 1)).toBe(33);
    expect(tyLeChot(4, 3)).toBe(75);
  });

  it("[QKM-09] cờ TẮT ⇒ null và KHÔNG đọc DB", async () => {
    expect(await docThuNhapThem({ userId: "u1" })).toBeNull();
    expect(partyIds).not.toHaveBeenCalled();
    expect(referralFindMany).not.toHaveBeenCalled();
  });

  it("[QKM-10] cờ BẬT: thống kê + danh sách che SĐT, không lộ id/SĐT thật; tìm đúng số ra kết quả, gõ thiếu không ra", async () => {
    process.env.THU_NHAP_THEM_ENABLED = "true";
    partyIds.mockResolvedValue(["p1"]);
    const mk = (parentName: string, phone: string, status: string, childName: string | null) => ({
      lead: { parentName, childName, phone, status, createdAt: new Date("2026-11-10T03:00:00Z") },
    });
    referralFindMany.mockResolvedValue([mk("Nguyễn Mai", "0999997098", "DA_DANG_KY", "Bin"), mk("Trần Lan", "0905123456", "MOI", null)]);

    const tat = await docThuNhapThem({ userId: "u1" });
    expect(tat).toMatchObject({ tongLead: 2, daChot: 1, tyLeChot: 50 });
    const json = JSON.stringify(tat);
    expect(json).not.toContain("0999997098");
    expect(json).not.toContain("0905123456");
    expect(tat!.khach[0]).toMatchObject({ soDienThoaiChe: "09xxxx7098", nhanTrangThai: "Đã đăng ký", ngayNhan: "10/11/2026" });

    expect((await docThuNhapThem({ userId: "u1", q: "0999997098" }))!.khach.map((k) => k.tenPhuHuynh)).toEqual(["Nguyễn Mai"]);
    expect((await docThuNhapThem({ userId: "u1", q: "099999" }))!.khach).toEqual([]);
    expect((await docThuNhapThem({ userId: "u1", q: "lan" }))!.khach.map((k) => k.tenPhuHuynh)).toEqual(["Trần Lan"]);
    expect((await docThuNhapThem({ userId: "u1", trangThai: "MOI" }))!.khach).toHaveLength(1);
    // Quyền: chỉ đối tác của CHÍNH người đăng nhập.
    expect(partyIds).toHaveBeenCalledWith("u1");
    expect((referralFindMany.mock.calls[0]![0] as { where: { partyId: { in: string[] } } }).where.partyId.in).toEqual(["p1"]);
  });

  it("[QKM-11] không phải đối tác ⇒ thống kê rỗng, không truy vấn lượt giới thiệu", async () => {
    process.env.THU_NHAP_THEM_ENABLED = "true";
    partyIds.mockResolvedValue([]);
    expect(await docThuNhapThem({ userId: "u1" })).toEqual({ tongLead: 0, daChot: 0, tyLeChot: null, khach: [], biCat: false });
    expect(referralFindMany).not.toHaveBeenCalled();
  });
});

describe("[QKM-W] dây nối", () => {
  it("[QKM-W1] route thu-nhap: cờ tắt ⇒ notFound TRƯỚC mọi việc khác; chỉ PARENT; không còn mục menu rời", () => {
    const p = doc("app/(portal)/portal/thu-nhap/page.tsx");
    expect(p.indexOf("if (!isThuNhapThemEnabled()) notFound();")).toBeGreaterThan(-1);
    expect(p.indexOf("if (!isThuNhapThemEnabled()) notFound();")).toBeLessThan(p.indexOf("await auth()"));
    expect(p).toContain('session.user.role !== "PARENT"');
    const shell = doc("components/portal/sr-shell.tsx");
    for (const roi of ['href: "/portal/disc"', 'href: "/portal/suc-khoe"', 'href: "/portal/tu-sach"', 'href: "/portal/thu-nhap"']) expect(shell, roi).not.toContain(roi);
    expect(shell).toContain("coQuaTangNao({ disc: coDisc, sucKhoe: coSucKhoe, tuSach: coTuSach })");
  });

  it("[QKM-W2] trang Quà tặng 404 khi mọi cờ tắt; trang Khuyến mãi chỉ cho PARENT; cả hai gác chế độ học sinh ở layout", () => {
    expect(doc("app/(portal)/portal/qua-tang/page.tsx")).toContain("if (qua.length === 0) notFound();");
    expect(doc("app/(portal)/portal/khuyen-mai/page.tsx")).toContain('session.user.role !== "PARENT"');
    for (const seg of ["qua-tang", "khuyen-mai", "thu-nhap"]) {
      expect(doc(`app/(portal)/portal/${seg}/layout.tsx`), seg).toContain("chanKhiOCheDoHocSinh()");
    }
  });

  it("[QKM-W3] tài khoản chưa có bé vào được qua-tang + khuyen-mai CHỈ khi hộp quà mở (cùng hàm coQuaTangNao)", () => {
    expect(doc("app/(portal)/portal/layout.tsx")).toContain('...(coHopQua ? ["qua-tang", "khuyen-mai"] : [])');
  });
});
