// [P5-RW*] — lưới ghim dây nối P5d (màn tháng QLCS + giáo viên).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const doc = (f: string) =>
  readFileSync(resolve(process.cwd(), f), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
const dem = (s: string, x: string) => s.split(x).length - 1;

const QL = doc("app/(admin)/admin/cham-cong/phan-cong/thang/page.tsx");
const GV = doc("app/(teacher)/teacher/phan-cong/thang/page.tsx");
const DB = doc("lib/parttime/bao-cao-thang-db.ts");

describe("[P5-RW] dây nối báo cáo tháng", () => {
  it("[P5-RW1] hai màn KHÔNG tự đếm: không đọc DB trực tiếp, số đến từ `docBaoCaoThang` / `docBaoCaoCuaToi` → `tongHopThang`", () => {
    for (const [ten, t] of [["QL", QL], ["GV", GV]] as const) {
      expect(t, ten).not.toMatch(/from "@\/lib\/db"|prisma\.|scopedDb\(/);
      expect(t, ten).not.toMatch(/tongHopThang\(/);
    }
    expect(dem(QL, "docBaoCaoThang({ centerId: coSo, thang, now })")).toBe(1);
    expect(dem(DB, "tongHop: tongHopThang(")).toBe(2);
  });

  it("[P5-RW2] giáo viên: userId lấy từ PHIÊN; trang không nhận người từ tham số", () => {
    expect(GV).toContain("docBaoCaoCuaToi({ userId: session.user.id, thang, now })");
    expect(GV).not.toMatch(/searchParams: Promise<\{[^}]*nguoi/);
  });

  it("[P5-RW3] TỔNG = CHI TIẾT ở giao diện: chi tiết lọc theo đúng danh sách `r.ds[chiSo]` của ô vừa bấm", () => {
    expect(QL).toContain("const khoa = new Set(r.ds[chiSo]);");
    expect(dem(GV, "r.ds[chiSo].includes(")).toBe(3);
    expect(QL).toContain("const n = soCua(r, k);");
  });

  it("[P5-RW4] không giấu khoản trừ: màn GV in MỌI khoản (đề xuất · đã xác nhận · không áp · huỷ), không lọc theo trạng thái", () => {
    expect(GV).toContain("{x.dieuChinh.map((a) => (");
    expect(GV).not.toMatch(/dieuChinh\.filter\(\(a\) => a\.status/);
    expect(GV).toMatch(/PROPOSED: "đề xuất — chờ quản lý", CONFIRMED: "đã xác nhận", REJECTED: "không áp", CANCELLED: "đã huỷ"/);
  });

  it("[P5-RW5] nút hàng loạt CHỈ gửi dòng sạch; nút quyết khoản trừ chỉ vẽ khi có quyền duyệt (luật 12 — không vẽ lời hứa suông)", () => {
    expect(QL).toContain('const sach = chuaQuyet.filter((x) => x.dong.ungVien.lop === "TU_DONG");');
    expect(QL).toMatch(/loai: "hangLoat",\s*muc: sach\.map\(/);
    expect(QL).toContain("{bat && coApprove ? (");
    expect(QL).toContain('checkPermission("hr_attendance:approve", { centerId: coSo })');
  });

  it("[P5-RW7] ca trực chờ nhận hiện CẢ ở 'Công việc của tôi' (doc 07 §4), đọc của CHÍNH mình (userId từ phiên)", () => {
    expect(doc("app/(teacher)/teacher/phan-cong/page.tsx")).toContain("docTrucChoNhan({ userId: session.user.id, now })");
  });

  it("[P5-RW6] lối vào: Control Tower và 'Công việc của tôi' có liên kết literal tới màn tháng", () => {
    expect(doc("app/(admin)/admin/cham-cong/phan-cong/page.tsx")).toContain('const THANG = { href: "/cham-cong/phan-cong/thang" } as const;');
    expect(doc("app/(teacher)/teacher/phan-cong/page.tsx")).toContain('href="/teacher/phan-cong/thang"');
  });
});
