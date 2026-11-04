// lib/orders/pham-vi/cong-hoan-tien.test.ts — CỔNG "DỪNG HỌC / ĐỀ XUẤT HOÀN" TRÊN ĐƠN THEO PHẠM VI HỌC (SCOPE). THUẦN + lưới ghim dây nối. Không DB, không đồng hồ thật.
//
// Hành vi trên Postgres thật nằm ở `tests/finance/don-pham-vi-hoan-tien-db.test.ts`. Tệp này khoá hai thứ test DB KHÔNG khoá được:
//   · câu chữ + hàm quyết định (một nguồn cho máy chủ lẫn giao diện);
//   · DÂY NỐI: gỡ lời gọi cổng khỏi một đường thì không ca hành vi nào đỏ trừ khi có đúng đơn SCOPE chạy qua đường đó — lưới này đỏ ngay.
// Lưới đếm trên mã ĐÃ BỎ CHÚ THÍCH (luật 11: chú thích giải thích bản vá chứa đúng chuỗi đang đếm).
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CHINH_SACH_PL02 } from "@/lib/pricing/tinh-gia-theo-moc";
import { cuaSoHieuLucPL02 } from "@/lib/pricing/hieu-luc-chinh-sach";
import { dungDongChoDeXuat, laViecConLam } from "@/lib/finance/cho-de-xuat-hoan-tien";
import { keHoachDon, type BoiCanhDon, type DongVao } from "./ke-hoach-don";
import { metadataChoDong } from "./doc-dong";
import {
  LY_DO_DON_PHAM_VI_KHONG_DUNG_HOC,
  LY_DO_DON_PHAM_VI_KHONG_HOAN_TIEN,
  lyDoChanDungHoc,
} from "./cong-hoan-tien";

const BOI_CANH: BoiCanhDon = {
  phamViBat: true,
  nguonGia48: "Course.price",
  chinhSach: CHINH_SACH_PL02,
  hieuLuc: cuaSoHieuLucPL02(),
  cheDoMocNgay: "ORDER_CREATED",
  thuTuMacDinh: "LOWER_VALUE_FIRST",
  taoDon: new Date("2026-10-11T03:00:00Z"),
  coKeHoachDot: false,
};
const DONG_VAO: DongVao = {
  loai: "COURSE_ENROLLMENT",
  tenDong: "Sata 3",
  soLuong: 1,
  donGiaKhach: 2_640_000,
  soKhoanGiam: 0,
  laLopNhom: true,
  tongSoBuoiKhoa: 48,
  soBuoiMua: 12,
  gia48: 10_560_000,
  conKhoa: "con-a",
};
/** Dấu SCOPE THẬT do planner sinh ra — không gõ tay. */
function metadataScope(): Record<string, unknown> {
  const kq = keHoachDon([DONG_VAO], BOI_CANH);
  const md = metadataChoDong(kq, 0, { courseId: "khoa-sata3", soBuoi: 12 }, "khoa-sata3");
  if (kq.kieu !== "SCOPE" || !md) throw new Error("fixture: dòng không SCOPE");
  return md;
}

describe("[HT-01..04] câu chữ + hàm quyết định (THUẦN)", () => {
  it("[HT-01] đơn SCOPE ⇒ trả đúng câu dừng học; đơn thường / rỗng / thiếu ⇒ null (đối chứng dương nằm ở chính ca này)", () => {
    expect(lyDoChanDungHoc([{ metadata: metadataScope() }])).toBe(LY_DO_DON_PHAM_VI_KHONG_DUNG_HOC);
    // đơn thường — kể cả có `soBuoi`/`courseId` giống hệt, chỉ thiếu khối `phamVi`
    expect(lyDoChanDungHoc([{ metadata: { courseId: "khoa-sata3", soBuoi: 12 } }])).toBeNull();
    expect(lyDoChanDungHoc([{ metadata: null }])).toBeNull();
    expect(lyDoChanDungHoc([])).toBeNull();
    expect(lyDoChanDungHoc(undefined)).toBeNull();
    expect(lyDoChanDungHoc(null)).toBeNull();
  });

  it("[HT-02] đơn có MỘT dòng SCOPE trong nhiều dòng là đủ (dấu nằm trên mọi dòng của đơn, `some`)", () => {
    expect(lyDoChanDungHoc([{ metadata: null }, { metadata: metadataScope() }])).toBe(LY_DO_DON_PHAM_VI_KHONG_DUNG_HOC);
  });

  it("[HT-03] hai câu: tiếng Việt rõ, nói 'kế toán xử lý tay', KHÁC nhau đúng ở động từ, và không lặp nhau", () => {
    for (const c of [LY_DO_DON_PHAM_VI_KHONG_DUNG_HOC, LY_DO_DON_PHAM_VI_KHONG_HOAN_TIEN]) {
      expect(c.startsWith("Đơn mua theo số buổi:")).toBe(true);
      expect(c).toContain("kế toán xử lý tay");
      expect(c).toContain("SỐ BUỔI ĐÃ MUA");
    }
    expect(LY_DO_DON_PHAM_VI_KHONG_DUNG_HOC).toContain("dừng học chưa hỗ trợ");
    expect(LY_DO_DON_PHAM_VI_KHONG_HOAN_TIEN).toContain("hoàn tiền chưa hỗ trợ");
    expect(LY_DO_DON_PHAM_VI_KHONG_DUNG_HOC).not.toBe(LY_DO_DON_PHAM_VI_KHONG_HOAN_TIEN);
  });

  it("[HT-04] màn 'Chờ đề xuất hoàn': ghi danh SCOPE ⇒ KHÔNG số, KHÔNG cho tạo, nói đúng lý do, VẪN là việc còn làm; ghi danh thường ⇒ y như cũ", () => {
    const moc = new Date("2026-10-05T03:00:00Z");
    const ghiDanh = { id: "gd", classId: "lop", finalPrice: 5_472_000, tuition: null, studentName: "Bé A", className: "Sata 4" };
    // Lớp 48 buổi, 6 buổi đã chốt COMPLETED — nếu công thức cũ chạy thì ra một con số > 0 (đây là con số SAI cho đơn SCOPE).
    const buoi = Array.from({ length: 48 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 7, 3 + i * 7, 12, 30, 0)),
      status: i < 6 ? "COMPLETED" : "SCHEDULED",
    }));
    const thuong = dungDongChoDeXuat({ ghiDanh, buoi, daThu: 5_472_000, moc, donPhamVi: false });
    expect(thuong.donPhamVi).toBe(false);
    expect(thuong.choDeXuat).toBe(true);
    expect(thuong.deXuatDuKien).toBeGreaterThan(0);

    const scope = dungDongChoDeXuat({ ghiDanh, buoi, daThu: 5_472_000, moc, donPhamVi: true });
    expect(scope.donPhamVi).toBe(true);
    expect(scope.choDeXuat).toBe(false);
    expect(scope.deXuatDuKien).toBe(0);
    expect(scope.lyDo).toBe(LY_DO_DON_PHAM_VI_KHONG_HOAN_TIEN);
    expect(laViecConLam(scope), "tiền đang treo — dòng phải CÒN trong danh sách").toBe(true);
    // các trường còn lại giống hệt ghi danh thường (chỉ khác ba trường quyết định)
    const { donPhamVi: _a, choDeXuat: _b, deXuatDuKien: _c, lyDo: _d, ...conLaiScope } = scope;
    const { donPhamVi: _e, choDeXuat: _f, deXuatDuKien: _g, lyDo: _h, ...conLaiThuong } = thuong;
    expect(conLaiScope).toEqual(conLaiThuong);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// LƯỚI GHIM DÂY NỐI
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
function boChuThich(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}
const dem = (s: string, re: RegExp) => (s.match(re) ?? []).length;
/** Từ `moc` tới `den` (hoặc hết tệp). Cả hai phải THẤY — `indexOf` = -1 làm phép so ĐÚNG trên mã đã hỏng. */
function doan(src: string, moc: string, den?: string): string {
  const a = src.indexOf(moc);
  if (a < 0) throw new Error(`không thấy mốc: ${moc}`);
  if (!den) return src.slice(a);
  const b = src.indexOf(den, a + moc.length);
  if (b < 0) throw new Error(`không thấy mốc cuối: ${den}`);
  return src.slice(a, b);
}
const viTri = (s: string, chuoi: string) => {
  const i = s.indexOf(chuoi);
  if (i < 0) throw new Error(`không thấy: ${chuoi}`);
  return i;
};
const SELECT_ITEMS_METADATA = /items:\s*\{\s*select:\s*\{\s*metadata:\s*true\s*\}\s*\}/g;

describe("[HT-W1..W8] lưới ghim dây nối — mỗi đường tiền ra có cổng, cổng đứng TRƯỚC phép ghi, giao diện dùng CÙNG hàm", () => {
  it("[HT-W1] dung-hoc-con.ts: cổng ở CẢ xem trước lẫn lượt ghi, cả hai đọc `items.metadata`, và lượt ghi TỪ CHỐI (return) trước phép ghi đầu tiên", () => {
    const src = boChuThich(doc("lib/finance/dung-hoc-con.ts"));
    expect(dem(src, /lyDoChanDungHoc\(dong\.order\?\.items\)/g), "một lời gọi mỗi đường (xem trước + lượt ghi)").toBe(2);
    expect(dem(src, SELECT_ITEMS_METADATA), "thiếu `metadata` trong select thì cổng đọc undefined ⇒ luôn false ⇒ chết").toBe(2);

    const xem = doan(src, "export async function xemTruocDungHoc(", "export async function docPhieuGopChoXemTruoc(");
    expect(viTri(xem, "lyDoChanDungHoc(")).toBeLessThan(viTri(xem, "soiUuDaiAnhEm("));

    const ghi = doan(src, "export async function dungHocTrongTx(");
    const cong = viTri(ghi, "lyDoChanDungHoc(");
    expect(cong, "trước cổng 2 (đã dừng) để lý do nói đúng nguyên nhân").toBeLessThan(viTri(ghi, 'dong.status === "STOPPED"'));
    expect(cong, "trước phép ghi đầu tiên").toBeLessThan(viTri(ghi, "huyDotKhiDungHoc(tx"));
    expect(ghi.slice(cong, cong + 160)).toMatch(/return \{ ok: false as const, error: lyDoDonPhamVi \}/);
  });

  it("[HT-W2] refund.ts createRefundRequest: lưới cuối ĐÚNG MỘT LẦN, sau kiểm tiền, TRƯỚC đếm buổi và TRƯỚC bước tạo; trả null + AuditLog, KHÔNG ném", () => {
    const src = boChuThich(doc("lib/finance/refund.ts"));
    const than = doan(src, "export async function createRefundRequest(", "export async function taoYeuCauHoanTuDungHoc(");
    expect(dem(than, /ghiDanhThuocDonPhamVi\(/g)).toBe(1);
    const cong = viTri(than, "ghiDanhThuocDonPhamVi(");
    expect(cong).toBeGreaterThan(viTri(than, "if (paidConfirmed <= 0) return null;"));
    expect(cong).toBeLessThan(viTri(than, "client.classSession.count("));
    expect(cong).toBeLessThan(viTri(than, "client.refundRequest.create("));
    const nhanh = than.slice(cong, viTri(than, "client.classSession.count("));
    expect(nhanh).toContain("REFUND_REQUEST_BLOCKED");
    expect(nhanh).toContain("return null;");
    expect(nhanh, "ném là cuộn ngược cả 'Nghỉ học hẳn' / 'Huỷ lớp'").not.toMatch(/\bthrow\b/);
    expect(dem(nhanh, /LY_DO_DON_PHAM_VI_KHONG_HOAN_TIEN/g)).toBeGreaterThanOrEqual(2);
  });

  it("[HT-W3] withdraw.ts nghiHocHan: hỏi MỘT lần cho cả lô, TRƯỚC `createRefundRequest(`; nhánh SCOPE bỏ qua + nói ra + `continue` (không ném)", () => {
    const src = boChuThich(doc("lib/students/withdraw.ts"));
    const than = doan(src, "export async function nghiHocHan(");
    expect(dem(than, /ghiDanhThuocDonPhamVi\(/g)).toBe(1);
    const hoi = viTri(than, "ghiDanhThuocDonPhamVi(");
    const tao = viTri(than, "createRefundRequest(");
    expect(hoi).toBeLessThan(tao);
    const nhanh = doan(than, "const scope = donPhamVi.get(enr.id);", "createRefundRequest(");
    expect(nhanh).toContain("boQuaHoanTien.push(");
    expect(nhanh).toContain("REFUND_REQUEST_SKIPPED");
    expect(nhanh).toContain("continue;");
    expect(nhanh).not.toMatch(/\bthrow\b/);
    // hỏi ở NGOÀI vòng lặp — một lần cho cả lô, không N+1
    expect(hoi).toBeLessThan(viTri(than, "for (const enr of removed)"));
  });

  it("[HT-W4] hoan-tien/_actions.ts taoDeXuatHoanTienAction: nói đúng lý do SCOPE TRƯỚC `createRefundRequest(` (không để `null` bị dịch thành 'sổ buổi chưa chốt')", () => {
    const src = boChuThich(doc("app/(admin)/admin/hoan-tien/_actions.ts"));
    const than = doan(src, "export async function taoDeXuatHoanTienAction(", "const chiSchema");
    expect(dem(than, /lyDoGhiDanhDonPhamVi\(enrollmentId\)/g)).toBe(1);
    expect(viTri(than, "lyDoGhiDanhDonPhamVi(")).toBeLessThan(viTri(than, "createRefundRequest("));
    // gọi mà KHÔNG dùng kết quả để dừng thì cổng chết: phải có nhánh `return` đúng câu đó
    expect(than).toMatch(/if \(lyDoDonPhamVi\) return \{ ok: false, error: lyDoDonPhamVi/);
    expect(than).not.toMatch(/scopedDb[^;]*ghiDanhThuocDonPhamVi/);
  });

  it("[HT-W5] cho-de-xuat-hoan-tien.ts: một lần cho cả danh sách, đọc KHÔNG-scope (`db`), truyền vào từng dòng; `computeRefund` chỉ chạy khi KHÔNG phải đơn SCOPE", () => {
    const src = boChuThich(doc("lib/finance/cho-de-xuat-hoan-tien.ts"));
    expect(dem(src, /ghiDanhThuocDonPhamVi\(db,/g)).toBe(1);
    expect(dem(src, /donPhamVi:\s*donPhamViMap\.has\(e\.id\)/g)).toBe(1);
    expect(src).toMatch(/const proposedAmount = donPhamVi\s*\?\s*0\s*:\s*computeRefund\(/);
    expect(dem(src, /computeRefund\(/g), "không thêm bản chép thứ hai của phép tính").toBe(1);
  });

  it("[HT-W6] giao diện 'Dừng học': mục menu dựng từ CÙNG cờ `donPhamVi` (= `laDonPhamVi(order.items)` ở trang), hiện KÈM lý do, và hộp thoại tự đóng", () => {
    const ui = boChuThich(doc("app/(admin)/admin/orders/_components/cong-no-theo-con.tsx"));
    // MỘT điều kiện vẽ `{choDung && (` (lưới [QDH-*] của quyen-doi-soat đếm đúng 1) và bên trong rẽ bằng `donPhamVi ?`.
    expect(dem(ui, /\{choDung && \(\s*donPhamVi \? \(/g)).toBe(1);
    expect(dem(ui, /LY_DO_DON_PHAM_VI_KHONG_DUNG_HOC/g), "import + MỘT chỗ in").toBe(2);
    expect(ui).toMatch(/&&\s*!donPhamVi,\s*\);/);
    // mục bị khoá KHÔNG được có onClick mở hộp thoại
    const khoa = doan(ui, "donPhamVi ? (", ") : (");
    expect(khoa).toContain("disabled");
    expect(khoa).not.toContain("datDangMoDung");
    // trang đơn truyền cờ bằng ĐÚNG hàm của cổng máy chủ
    const trang = boChuThich(doc("app/(admin)/admin/orders/[id]/page.tsx"));
    expect(dem(trang, /donPhamVi=\{laDonPhamVi\(order\.items\)\}/g)).toBe(1);
  });

  it("[HT-W7] giao diện 'Chờ đề xuất hoàn': dòng SCOPE KHÔNG có nút tạo (nhánh `d.donPhamVi` đứng TRƯỚC nhánh `d.choDeXuat`) và không cộng vào ước tính", () => {
    const ui = boChuThich(doc("app/(admin)/admin/hoan-tien/_components/cho-de-xuat.tsx"));
    const nhanh = viTri(ui, "{d.donPhamVi ? (");
    expect(nhanh).toBeLessThan(viTri(ui, ") : d.choDeXuat ? ("));
    expect(ui).toMatch(/d\.donPhamVi \? 0 : d\.deXuatDuKien/);
    expect(ui).toContain("Kế toán xử lý tay");
  });

  it("[HT-W8] câu chữ nằm ở MỘT nơi: không tệp nguồn nào khác chép tay 'Đơn mua theo số buổi'", () => {
    const co: string[] = [];
    const di = (d: string) => {
      for (const e of readdirSync(resolve(process.cwd(), d), { withFileTypes: true })) {
        const p = `${d}/${e.name}`;
        if (e.isDirectory()) {
          if (e.name === "node_modules" || e.name === ".next") continue;
          di(p);
        } else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name) && doc(p).includes("Đơn mua theo số buổi")) co.push(p);
      }
    };
    for (const g of ["app", "lib", "components"]) di(g);
    expect(co).toEqual(["lib/orders/pham-vi/cong-hoan-tien.ts"]);
    // Quét cả cây mã: ~vài giây khi máy rảnh, quá trần 5 giây mặc định khi cả bộ chạy song song ⇒ trần riêng.
  }, 60_000);
});
