// @vitest-environment node
/**
 * [LMT-W*] — LƯỚI GHIM mã nguồn của công cụ đo hold lịch sử mua (`lan-mua-treo-doc.ts`, `scripts/hoa-hong/do-lan-mua-treo.ts`) và của việc ĐỔI TÊN mã hold.
 * Hành vi do `tests/hoa-hong/lan-mua-treo.spec.ts` (Postgres thật) chứng minh; ở đây canh phần mà hành vi không tự chứng minh: «chỉ đọc», «một nguồn cho mã / nhãn», «không đọc ngày người nhập khai».
 * Lưới đọc SCRIPT vận hành (`[LMT-W4]`) nằm ở `lan-mua-treo-script.test.ts` — script không lên gương CI nên tệp đó chỉ chạy ở CI private (scripts/ci/test-chi-rieng.txt).
 * Quy tắc viết lưới (CLAUDE.md «Mẫu test: LƯỚI GHIM MÃ NGUỒN»): bỏ chú thích trước khi so, neo vào LỜI GỌI, đếm số lần khớp, không cờ `/s`.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { TRANG_THAI_THUC_THU } from "@/lib/finance/thuc-thu";

import { tacDongTuChiTiet } from "./cutover-hanh-dong";
import { tongHopSoBong, type KhoanSoBong } from "./so-bong";
import { AUDIT_NGUON_DON_GHI_BU, AUDIT_NGUON_DON_NHAP_CU } from "./phan-loai-giao-dich-db";
import { sqlDemDonChuaKiem, sqlDemUngVien, sqlDongChuaThuChuaHuy, sqlDongUngVien, vanBanSql } from "./lan-mua-treo-doc";

const boChuThich = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const doc = (duongDan: string) => boChuThich(readFileSync(resolve(process.cwd(), duongDan), "utf8"));
const dem = (s: string, m: string) => s.split(m).length - 1;

describe("[LMT-W] công cụ đo hold lịch sử mua", () => {
  const doc_ = doc("lib/hoa-hong/lan-mua-treo-doc.ts");

  it("[LMT-W1] bộ đọc CHỈ ĐỌC: không lệnh ghi nào, không SQL thô không-an-toàn; client là tham số BẮT BUỘC (luật 7), không import @/lib/db trần", () => {
    for (const ghi of [".create(", ".createMany(", ".update(", ".updateMany(", ".upsert(", ".delete(", ".deleteMany(", "$executeRaw", "$queryRawUnsafe", "$executeRawUnsafe"]) {
      expect(dem(doc_, ghi), ghi).toBe(0);
    }
    expect(dem(doc_, "@/lib/db")).toBe(0);
    expect(dem(doc_, "client: KhachDocLanMua")).toBe(1);
  });

  it("[LMT-W2] SQL KHÔNG hard-code luật đã có nguồn: trạng thái thực thu lấy từ TRANG_THAI_THUC_THU, nhãn nguồn audit lấy từ hai hằng của bộ phân loại; KHÔNG đọc `paidDate` (luật v3: không ngày người nhập khai)", () => {
    expect(dem(doc_, "TRANG_THAI_THUC_THU")).toBeGreaterThanOrEqual(3); // import + câu 1 + bảng dong
    expect(dem(doc_, "AUDIT_NGUON_DON_GHI_BU")).toBeGreaterThanOrEqual(3);
    expect(dem(doc_, "AUDIT_NGUON_DON_NHAP_CU")).toBeGreaterThanOrEqual(3);
    for (const nhan of [AUDIT_NGUON_DON_GHI_BU, AUDIT_NGUON_DON_NHAP_CU, ...TRANG_THAI_THUC_THU]) expect(doc_.includes(`'${nhan}'`) || doc_.includes(`"${nhan}"`), `literal ${nhan}`).toBe(false);
    expect(/paidDate|paid_date/.test(doc_)).toBe(false);
    // …và văn bản SQL thật sự mang đúng các nhãn đó (nhúng vào khi in).
    const inRa = vanBanSql(sqlDemUngVien("BACKFILL_ORDER_TIME_UNVERIFIED")) + vanBanSql(sqlDongChuaThuChuaHuy()) + vanBanSql(sqlDemDonChuaKiem());
    for (const nhan of [AUDIT_NGUON_DON_GHI_BU, AUDIT_NGUON_DON_NHAP_CU, ...TRANG_THAI_THUC_THU]) expect(inRa, nhan).toContain(`'${nhan}'`);
    expect(inRa).not.toMatch(/\$\d/);
  });

  it("[LMT-W3] cả hai câu ứng viên cùng dựng từ MỘT bảng `dong` (cùng định nghĩa đã-thu / đã-huỷ / giờ máy chủ) — sửa luật ở một nơi", () => {
    expect(dem(doc_, "function cteDong(")).toBe(1);
    expect(dem(doc_, "${cteDong(")).toBe(1); // dùng đúng MỘT lần, trong sqlDongUngVien (hai loại ứng viên chung một khung)
    const a = vanBanSql(sqlDongUngVien("PREVIOUS_PURCHASE_UNRESOLVED"));
    const b = vanBanSql(sqlDongUngVien("BACKFILL_ORDER_TIME_UNVERIFIED"));
    const phanDong = (s: string) => s.slice(0, s.indexOf("SELECT DISTINCT"));
    expect(phanDong(a)).toBe(phanDong(b));
    expect(a).not.toBe(b);
  });

  it("[LMT-W5] ĐỔI TÊN MỘT NGUỒN: mã cũ `LAN_MUA_TRUOC_CHUA_CHOT` không còn ở mã nguồn / test nào (chỉ còn trong tài liệu, ghi là tên cũ)", () => {
    const TEN_CU = ["LAN_MUA_TRUOC", "CHUA_CHOT"].join("_");
    const toiDa = new Set([resolve(process.cwd(), "lib/hoa-hong/lan-mua-treo.test.ts")]);
    const sai: string[] = [];
    const quet = (thuMuc: string) => {
      for (const ten of readdirSync(thuMuc)) {
        if (ten === "node_modules" || ten === ".next" || ten.startsWith(".")) continue;
        const duongDan = join(thuMuc, ten);
        if (statSync(duongDan).isDirectory()) quet(duongDan);
        else if (/\.(ts|tsx|mjs|sql)$/.test(ten) && !toiDa.has(duongDan) && readFileSync(duongDan, "utf8").includes(TEN_CU)) sai.push(duongDan.replace(process.cwd(), "").replaceAll("\\", "/"));
      }
    };
    for (const g of ["lib", "app", "scripts", "tests", "prisma"]) quet(resolve(process.cwd(), g));
    expect(sai, "tên cũ còn sót — đổi sang PREVIOUS_PURCHASE_UNRESOLVED").toEqual([]);
  }, 120_000);
});

describe("[LMT-W6] màn «Chuyển sang hoa hồng mới»: PHÂN LOẠI hold lịch sử mua để hiển thị, KHÔNG đổi cổng", () => {
  const giu = (id: string, maLuat: string | null): KhoanSoBong => ({
    paymentId: id,
    ngayThu: "2026-09-10",
    soTienThu: 10_000_000,
    cu: [],
    cuLaTaiTuc: false,
    loaiMoi: null,
    moi: { loai: "GIU", ma: "MANUAL_REVIEW_REQUIRED", maLuat, mucDo: "HARD" },
  });
  const baoCao = tongHopSoBong({
    khoan: [giu("p1", "PREVIOUS_PURCHASE_UNRESOLVED"), giu("p2", "BACKFILL_ORDER_TIME_UNVERIFIED"), giu("p3", "KHONG_RA_HOC_VIEN")],
    ngoai: { khoanHoan: { soKhoan: 0, soTien: 0 }, khoanChuyenNoiBo: 0, khoanKhongPhaiHocPhi: { soKhoan: 0, soTien: 0 } },
    cuaSo: { tuNgay: "2026-07-01", denNgay: "2026-09-30" },
    asOf: "2026-09-30",
    chinhSach: [],
  });

  it("[LMT-W6a] view-model của trang mang `holdLichSuMua` đúng như báo cáo, và `hold.tong` KHÔNG bị trừ (cổng precheck vẫn đếm đủ 3)", () => {
    const t = tacDongTuChiTiet({ baoCao, diTru: { thieuBangQuyNguon: false, thieuDanhMuc: [], noiDonNhieu: 0, tinhTrang: { conThieuQuyNguon: 0, invalid: 0, manualReview: 0, daDiTru: 0, coBangQuyNguon: true, sanSang: true } } });
    expect(t.holdLichSuMua).toEqual({ lanMuaTruocChuaChot: { soKhoan: 1, soTienThu: 10_000_000 }, thuTuMuaChuaKiem: { soKhoan: 1, soTienThu: 10_000_000 } });
    expect(t.hold).toEqual({ tong: 3, khoanGiu: 3, treoCoHangCho: 0 });
  });

  it("[LMT-W6b] nối dây: cổng đếm vẫn đọc `baoCao.hold.tong` và KHÔNG nhắc `holdLichSuMua`; màn hiển thị CẢ HAI loại từ `t.holdLichSuMua`", () => {
    const cong = doc("lib/hoa-hong/cutover-kiem-tra-db.ts");
    expect(dem(cong, "holdNghiemTrongDuKien: baoCao.hold.tong")).toBe(1);
    expect(dem(cong, "holdLichSuMua")).toBe(0);
    expect(dem(doc("lib/hoa-hong/cutover-kiem-tra.ts"), "holdLichSuMua")).toBe(0);
    const man = doc("app/(admin)/admin/cau-hinh-van-hanh/chuyen-hoa-hong/_components/chuyen-hoa-hong-man.tsx");
    expect(dem(man, "t.holdLichSuMua.lanMuaTruocChuaChot.soKhoan")).toBeGreaterThanOrEqual(2);
    expect(dem(man, "t.holdLichSuMua.thuTuMuaChuaKiem.soKhoan")).toBeGreaterThanOrEqual(2);
    expect(dem(man, 'data-testid="hold-lich-su-mua"')).toBe(1);
  });
});
