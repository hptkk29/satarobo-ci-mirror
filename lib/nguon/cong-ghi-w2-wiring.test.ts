// @vitest-environment node
/**
 * [W2-W*] — LƯỚI GHIM MÃ NGUỒN của đợt «CỔNG QUẢN TRỊ GHI + HẠ TRẦN + NÚT LỆCH CỔNG» (W2, 10/10/2026 — gt3 R3-M2/M3/M5 · gt2 R1-M1/M4 · gt1 R2-M1). Hành vi đã có ca DB
 * (`tests/hoa-hong/nguon-dong-cong-ghi.spec.ts` [W2G-*]); lưới này canh thứ ca DB không thấy: một ĐƯỜNG THỨ HAI qua mặt cổng, thứ tự «khoá → đọc → cổng → ghi», và DÂY NỐI dữ liệu cho nút.
 *
 *   [W2-W1] bốn đường ghi (tạo · sửa · đổi trạng thái · Page) đều lấy khoá advisory chính sách NGAY ĐẦU transaction, trước khoá hàng nguồn và trước phép ghi đầu tiên
 *   [W2-W2] cổng ghi đọc bảng Page→nguồn / nhóm nhân sự mặc định BẰNG `tx` (sau khoá), không qua cache `getSetting`; nhóm đích của Page đọc trong tx sau `FOR SHARE`
 *   [W2-W3] MỘT cổng «đụng tiền»: `canQuyenKichHoat` (tạo · sửa · đổi trạng thái) + `canQuyenKichHoatGanPage` (Page) — mỗi nơi MỘT lời gọi, kết quả được dùng để ném / trả lỗi, và đứng TRƯỚC phép ghi
 *   [W2-W4] hạ trần: `saveGlobalSettingAction` gọi `loiHaTranVoiChinhSachActive` cho khoá trần TRƯỚC `setGlobalSetting`; `kiem-theo-db` KHÔNG nhập nó (nhập là vòng — đo bằng dependency-cruiser)
 *   [W2-W5] dây nối cho NÚT: trang đọc `coQuyenKichHoat`, bảng/trang chi tiết truyền chủ + chính sách riêng + rule chạy xuống `NutDoiTrangThai`; biểu mẫu tạo nhận `boiCanhTao`
 *
 * Quy tắc viết lưới (luật 11/14): neo vào LỜI GỌI, bỏ chú thích trước khi so, đếm số lần khớp, không cờ `/s`.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const boChuThich = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const dem = (s: string, m: string | RegExp) =>
  typeof m === "string" ? s.split(m).length - 1 : (s.match(new RegExp(m.source, m.flags.includes("g") ? m.flags : `${m.flags}g`)) ?? []).length;
const doc = (t: string) => boChuThich(readFileSync(resolve(process.cwd(), t), "utf8").replace(/\r\n/g, "\n"));

const GHI = "lib/nguon/danh-muc-ghi.ts";
const PAGE = "lib/nguon/bang-nguon-theo-page.ts";

/** Thân hàm `export async function <ten>(` tới ngay trước dấu mốc kế (hoặc hết tệp). */
function khoi(src: string, ten: string, den: string | null): string {
  const i = src.indexOf(`export async function ${ten}(`);
  expect(i, `không thấy hàm ${ten}`).toBeGreaterThan(-1);
  return src.slice(i, den === null ? undefined : src.indexOf(den, i + 10));
}

describe("[W2-W1] khoá advisory ở đầu mọi đường ghi", () => {
  it("tạo · sửa · đổi trạng thái: `khoaTapChinhSach(tx)` MỘT lần, ngay sau `$transaction(async (tx)`, TRƯỚC `khoaHangNguon(` và TRƯỚC phép ghi", () => {
    const g = doc(GHI);
    const cac: [string, string, string | null, string][] = [
      ["taoNguon", "export type KetQuaSuaNguon", null, "leadSourceGroup.create("],
      ["suaNguon", "export type KetQuaDoiTrangThai", null, "leadSourceGroup.update("],
      ["doiTrangThaiNguon", "ZZZ_KHONG_CO", null, "leadSourceGroup.update("],
    ];
    for (const [ten, den, , ghi] of cac) {
      const k = khoi(g, ten, den === "ZZZ_KHONG_CO" ? null : den);
      expect(dem(k, "khoaTapChinhSach(tx)"), ten).toBe(1);
      expect(k.indexOf("khoaTapChinhSach(tx)"), `${ten}: khoá advisory phải đứng trong transaction`).toBeGreaterThan(k.indexOf("$transaction("));
      expect(k.indexOf("khoaTapChinhSach(tx)"), `${ten}: advisory TRƯỚC phép ghi`).toBeLessThan(k.indexOf(ghi));
      if (ten !== "taoNguon") expect(k.indexOf("khoaTapChinhSach(tx)"), `${ten}: advisory TRƯỚC khoá hàng`).toBeLessThan(k.indexOf("khoaHangNguon(tx"));
    }
  });

  it("Page: `khoaChinhSach(tx)` MỘT lần, TRƯỚC mọi đọc trong transaction và TRƯỚC `FOR SHARE`, `systemSetting.updateMany(` / `.create(`", () => {
    const k = khoi(doc(PAGE), "luuNguonCuaPage", null);
    expect(dem(k, "khoaChinhSach(tx)")).toBe(1);
    const a = k.indexOf("khoaChinhSach(tx)");
    expect(a).toBeGreaterThan(k.indexOf("$transaction("));
    for (const sau of ["tx.systemSetting.findUnique(", "FOR SHARE", "tx.systemSetting.updateMany(", "tx.systemSetting.create("]) expect(a, sau).toBeLessThan(k.indexOf(sau));
  });
});

describe("[W2-W2] đọc cấu hình / nhóm đích TRONG transaction, sau khoá", () => {
  it("`suaNguon` và `doiTrangThaiNguon` dùng `docBoiCanhTrongTx(tx)` (1 lần mỗi hàm) và KHÔNG gọi bản qua cache; `docBoiCanhTrongTx` đọc `tx.systemSetting`", () => {
    const g = doc(GHI);
    const sua = khoi(g, "suaNguon", "export type KetQuaDoiTrangThai");
    const doi = khoi(g, "doiTrangThaiNguon", null);
    for (const [ten, k] of [["suaNguon", sua], ["doiTrangThaiNguon", doi]] as const) {
      expect(dem(k, "docBoiCanhTrongTx(tx)"), ten).toBe(1);
      expect(dem(k, "docBoiCanhDaDung("), `${ten} đọc cấu hình qua cache (bản cũ)`).toBe(0);
      expect(k.indexOf("docBoiCanhTrongTx(tx)"), `${ten}: đọc SAU khoá hàng`).toBeGreaterThan(k.indexOf("khoaHangNguon(tx"));
    }
    const h = g.slice(g.indexOf("async function docBoiCanhTrongTx("));
    expect(dem(h.slice(0, h.indexOf("\n}\n")), "tx.systemSetting.findMany(")).toBe(1);
    expect(dem(h.slice(0, h.indexOf("\n}\n")), "getSetting(")).toBe(0);
  });

  it("`luuNguonCuaPage`: nhóm cũ/mới khoá `FOR SHARE` rồi đọc LẠI bằng `tx.leadSourceGroup.findMany(`; không còn `db.leadSourceGroup.findUnique(`; cổng `nguonChonDuoc` dùng bản đọc trong tx", () => {
    const k = khoi(doc(PAGE), "luuNguonCuaPage", null);
    expect(dem(k, "FOR SHARE")).toBe(1);
    expect(dem(k, "tx.leadSourceGroup.findMany(")).toBe(1);
    expect(dem(k, "db.leadSourceGroup.")).toBe(0);
    expect(dem(k, /nguonChonDuoc\(nhomMoi, p\.now\)/)).toBe(1);
    expect(k.indexOf("FOR SHARE")).toBeLessThan(k.indexOf("tx.leadSourceGroup.findMany("));
    expect(k.indexOf("tx.leadSourceGroup.findMany(")).toBeLessThan(k.indexOf("nguonChonDuoc(nhomMoi"));
  });
});

describe("[W2-W3] MỘT cổng «đụng tiền»", () => {
  it("tạo · sửa · đổi trạng thái: `canQuyenKichHoat(` đúng MỘT lần mỗi hàm, kết quả ∧ `!p.coQuyenKichHoat` dẫn tới `throw`, và đứng TRƯỚC phép ghi", () => {
    const g = doc(GHI);
    const cac: [string, string | null, string][] = [
      ["taoNguon", "export type KetQuaSuaNguon", "leadSourceGroup.create("],
      ["suaNguon", "export type KetQuaDoiTrangThai", "leadSourceGroup.update("],
      ["doiTrangThaiNguon", null, "leadSourceGroup.update("],
    ];
    for (const [ten, den, ghi] of cac) {
      const k = khoi(g, ten, den);
      expect(dem(k, "canQuyenKichHoat("), ten).toBe(1);
      expect(dem(k, "!p.coQuyenKichHoat"), ten).toBe(1);
      expect(dem(k, /throw new LoiGhiNguon\("quyen", CAU_THIEU_QUYEN_KICH_HOAT\)/), `${ten}: kết quả cổng phải được dùng để ném`).toBe(1);
      expect(k.indexOf("canQuyenKichHoat("), ten).toBeLessThan(k.indexOf(ghi));
      expect(dem(k, /coQuyenKichHoat:\s*boolean/), `${ten}: cờ quyền BẮT BUỘC, không mặc định`).toBe(1);
      expect(dem(k, /coQuyenKichHoat\?:/), ten).toBe(0);
    }
  });

  it("Page: `canQuyenKichHoatGanPage(` MỘT lần, kết quả ∧ `!p.coQuyenKichHoat` ⇒ trả `quyen`, TRƯỚC phép ghi; lý do kiểm bằng `loiLyDoGanPage(`; cả hai tham số BẮT BUỘC", () => {
    const k = khoi(doc(PAGE), "luuNguonCuaPage", null);
    expect(dem(k, "canQuyenKichHoatGanPage(")).toBe(1);
    expect(dem(k, "!p.coQuyenKichHoat")).toBe(1);
    expect(dem(k, /truong:\s*"quyen"/)).toBe(1);
    expect(dem(k, "loiLyDoGanPage(p.lyDo)")).toBe(1);
    expect(k.indexOf("canQuyenKichHoatGanPage("), "cổng quyền TRƯỚC phép ghi").toBeLessThan(k.indexOf("tx.systemSetting.updateMany("));
    expect(k.indexOf("loiLyDoGanPage("), "cổng lý do TRƯỚC phép ghi").toBeLessThan(k.indexOf("tx.systemSetting.updateMany("));
    expect(dem(k, /coQuyenKichHoat:\s*boolean/)).toBe(1);
    expect(dem(k, /lyDo:\s*string\s*\|\s*null/)).toBe(1);
    expect(dem(k, /coQuyenKichHoat\?:|lyDo\?:/)).toBe(0);
  });

  it("tắt hoa hồng: `chanTatHoaHongNguon(` MỘT lần trong `suaNguon`, dùng để ném, TRƯỚC cổng quyền và TRƯỚC phép ghi; nó đọc `coDongThuHutRieng` của `docDinhTienNguon`", () => {
    const k = khoi(doc(GHI), "suaNguon", "export type KetQuaDoiTrangThai");
    expect(dem(k, "chanTatHoaHongNguon(")).toBe(1);
    expect(dem(k, /if\s*\(chanTat\)\s*throw new LoiGhiNguon\(chanTat\.truong,\s*chanTat\.loi\)/)).toBe(1);
    expect(dem(k, "coDongThuHutRieng: dtNguon.coDongThuHutRieng")).toBe(1);
    expect(k.indexOf("chanTatHoaHongNguon(")).toBeLessThan(k.indexOf("canQuyenKichHoat("));
    expect(k.indexOf("chanTatHoaHongNguon(")).toBeLessThan(k.indexOf("leadSourceGroup.update("));
  });

  it("vị từ «dòng thu hút» có MỘT định nghĩa (`laDongThuHut`) và engine · guardrail · dịch vụ dùng nó — không còn so `\"EXCLUDE\"` rời", () => {
    expect(dem(doc("lib/hoa-hong/chon-quy-tac.ts"), /laDongThuHut\(/)).toBe(2); // định nghĩa + khopPhamVi
    expect(dem(doc("lib/hoa-hong/chon-quy-tac.ts"), /kieuTinh\s*[!=]==\s*"EXCLUDE"/)).toBe(1); // chỉ bên trong chính vị từ
    expect(dem(doc("lib/hoa-hong/guardrail-kich-hoat.ts"), /laDongThuHut\(/)).toBe(1);
    expect(dem(doc("lib/hoa-hong/guardrail-kich-hoat.ts"), /kieuTinh\s*[!=]==\s*"EXCLUDE"/)).toBe(0);
    expect(dem(doc("lib/nguon/dinh-tien-nguon.ts"), /laDongThuHut\(/)).toBe(1);
  });
});

describe("[W2-W4] hạ trần", () => {
  it("`saveGlobalSettingAction` gọi `loiHaTranVoiChinhSachActive(` MỘT lần, chỉ với khoá trần, SAU khi biết người lưu là SUPER_ADMIN và TRƯỚC `setGlobalSetting(`", () => {
    const a = doc("app/(admin)/admin/cau-hinh-van-hanh/actions.ts");
    const i = a.indexOf("export async function saveGlobalSettingAction(");
    const k = a.slice(i, a.indexOf("export async function saveCenterSettingAction("));
    expect(dem(k, "loiHaTranVoiChinhSachActive(")).toBe(1);
    expect(dem(k, /input\.key === KHOA_TRAN_HOA_HONG/)).toBe(1);
    expect(dem(k, "actor.isSuperAdmin")).toBe(1);
    expect(k.indexOf("loiHaTranVoiChinhSachActive(")).toBeLessThan(k.indexOf("setGlobalSetting("));
    expect(dem(k, /if\s*\(loiTran\)\s*return\s*\{\s*ok:\s*false/)).toBe(1); // kết quả phép kiểm được DÙNG
  });

  it("`lib/settings/kiem-theo-db.ts` KHÔNG nhập phép kiểm trần (tĩnh hay động) — nhập là vòng `settings/service → kiem-theo-db → chinh-sach-service → settings/service`", () => {
    const k = readFileSync(resolve(process.cwd(), "lib/settings/kiem-theo-db.ts"), "utf8");
    expect(dem(k, "kiem-tran-moi")).toBe(0);
    expect(dem(k, "chinh-sach-service")).toBe(0);
  });

  it("phép kiểm hạ trần chạy CHÍNH guardrail kích hoạt (`dauVaoKichHoat` + `kiemKichHoat`) — không tự đo lưới lần hai; chỉ lấy lỗi `VUOT_TRAN`", () => {
    const s = doc("lib/hoa-hong/chinh-sach-service.ts");
    const i = s.indexOf("export async function kiemTranMoiVoiChinhSachActive(");
    const k = s.slice(i, s.indexOf("export async function kichHoat("));
    expect(dem(k, "dauVaoKichHoat(")).toBe(1);
    expect(dem(k, "kiemKichHoat(")).toBe(1);
    expect(dem(k, /x\.ma === "VUOT_TRAN"/)).toBe(1);
    expect(dem(k, /tranTongTiLe:\s*p\.tranMoi/)).toBe(1);
  });
});

describe("[W2-W5] dây nối dữ liệu cho NÚT trạng thái và biểu mẫu tạo", () => {
  it("bảng danh sách: đọc `coQuyenKichHoat` ở page, truyền xuống `BangNguon`, và `NutDoiTrangThai` nhận chủ · chính sách riêng · rule chạy từ dòng danh mục", () => {
    const p = doc("app/(admin)/admin/nguon-hoa-hong/nguon/page.tsx");
    expect(dem(p, "coQuyenKichHoatChinhSach()")).toBe(2); // chế độ Page mapping + chế độ danh mục
    expect(dem(p, /coQuyenKichHoat=\{coQuyenKichHoat\}/)).toBe(2);
    const b = doc("app/(admin)/admin/nguon-hoa-hong/nguon/_components/bang-nguon.tsx");
    expect(dem(b, /ownerEmployeeId:\s*g\.ownerEmployeeId/)).toBe(1);
    expect(dem(b, /chinhSachRieng:\s*g\.chinhSachRieng/)).toBe(1);
    expect(dem(b, /ruleChuChay:\s*g\.ruleChuChay/)).toBe(1);
    expect(dem(b, /coQuyenKichHoat=\{coQuyenKichHoat\}/)).toBe(1);
    const d = doc("lib/nguon/doc-danh-muc.ts");
    expect(dem(d, "docDinhTienNguon(")).toBe(1);
    expect(dem(d, /ruleChuChay:\s*ruleChuChayChoNguon\(dt,\s*g\.id\)/)).toBe(1);
    // dữ liệu NÚT: chủ + cờ chính sách riêng đọc từ chính dòng nhóm / bảng định tiền — gán cứng null/false là nút nói sai
    expect(dem(d, /ownerEmployeeId:\s*g\.ownerEmployeeId/)).toBe(1);
    expect(dem(d, /chinhSachRieng:\s*dinhTienCuaNguon\(dt,\s*g\.id\)\.chinhSachRieng/)).toBe(1);
  });

  it("trang chi tiết: đọc `coQuyenKichHoat` và `nguonChoNutTrangThai` lấy chủ + hai cờ từ `dinhTien` của `NguonDeSuaView`", () => {
    const p = doc("app/(admin)/admin/nguon-hoa-hong/nguon/[maNguon]/page.tsx");
    expect(dem(p, "coQuyenKichHoatChinhSach()")).toBe(1);
    expect(dem(p, /coQuyenKichHoat=\{coQuyenKichHoat\}/)).toBe(1);
    const l = doc("components/admin/nguon-hoa-hong/chi-tiet-nguon/lien-ket-nguon.ts");
    expect(dem(l, /ownerEmployeeId:\s*ownerEmployee\?\.id\s*\?\?\s*null/)).toBe(1);
    expect(dem(l, /chinhSachRieng:\s*dinhTien\.chinhSachRieng/)).toBe(1);
    expect(dem(l, /ruleChuChay:\s*dinhTien\.ruleChuChay/)).toBe(1);
  });

  it("nút: `thaoTacTrangThai(` nhận `dinhTien` + `coQuyenKichHoat` (BẮT BUỘC); trang tạo truyền `boiCanhTao`, biểu mẫu tạo ném khi thiếu nó", () => {
    const n = doc("components/admin/nguon-hoa-hong/doi-trang-thai-nguon.tsx");
    expect(dem(n, /dinhTien:\s*\{\s*chinhSachRieng:\s*nguon\.chinhSachRieng,\s*ruleChuChay:\s*nguon\.ruleChuChay\s*\}/)).toBe(1);
    expect(dem(n, /\bcoQuyenKichHoat,\s*\n/)).toBeGreaterThan(0);
    const f = doc("lib/nguon/form-nguon.ts");
    const i = f.indexOf("export function thaoTacTrangThai(");
    const k = f.slice(i, f.indexOf("\n}\n", i));
    expect(dem(k, /dinhTien:\s*\{/)).toBe(1);
    expect(dem(k, /coQuyenKichHoat:\s*boolean/)).toBe(1);
    expect(dem(k, "chanNguonHoatDongKhongChu(")).toBe(1);
    expect(dem(k, "canQuyenKichHoat(")).toBe(1);
    const t = doc("app/(admin)/admin/nguon-hoa-hong/nguon/tao/page.tsx");
    expect(dem(t, /boiCanhTao=\{\{\s*ruleChuChay:\s*du\.ruleChuChay,\s*coQuyenKichHoat\s*\}\}/)).toBe(1);
    expect(dem(doc("components/admin/nguon-hoa-hong/nguon-form.tsx"), /chanKhiTao\(/)).toBe(2); // resolver + thanh dưới
  });
});
