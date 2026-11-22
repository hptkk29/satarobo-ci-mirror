// @vitest-environment node
/**
 * [NHH-TRX-W*] — LƯỚI GHIM mã nguồn của bộ phân loại giao dịch.
 *
 * Luật cần khoá có dạng "lời gọi này phải có / không được có" — thứ test hành vi không chứng minh:
 * bộ nạp bỏ `WHERE_THUC_THU` thì hàm thuần vẫn xanh trên đầu vào đã dựng sẵn. Quy tắc viết lưới
 * (CLAUDE.md "Mẫu test: LƯỚI GHIM MÃ NGUỒN"): neo vào LỜI GỌI chứ không vào dòng import, đếm số
 * lần khớp, bỏ chú thích trước khi so, không dùng cờ `/s`.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

function doc(duongDan: string): string {
  const src = readFileSync(resolve(process.cwd(), duongDan), "utf8");
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}
const dem = (s: string, m: string) => s.split(m).length - 1;

describe("[NHH-TRX-W] dây nối bộ phân loại giao dịch", () => {
  const nap = doc("lib/hoa-hong/phan-loai-giao-dich-db.ts");
  const thuan = doc("lib/hoa-hong/phan-loai-giao-dich.ts");

  it("[NHH-TRX-W1] bộ nạp đọc thực thu bằng WHERE_THUC_THU (A1) đúng MỘT chỗ — không bộ lọc thứ hai", () => {
    expect(dem(nap, "...WHERE_THUC_THU")).toBe(1);
    expect(dem(nap, "accountantStatus")).toBe(0);
    expect(dem(nap, "CONFIRMED")).toBe(0);
  });

  it("[NHH-TRX-W2] bộ nạp gọi hàm quyết định đúng MỘT lần và dùng bộ thành phần chung", () => {
    expect(dem(nap, "phanLoaiGiaoDich(")).toBe(1);
    expect(dem(nap, "thanhPhanTheoLoaiDong(")).toBe(1);
    expect(dem(nap, "quyThucThuTheoDong(")).toBe(1);
    expect(dem(nap, "quyKhoanTheoDong(")).toBe(1);
    expect(dem(nap, "tinhPhuHuynhHienHuu(")).toBe(1);
  });

  it("[NHH-TRX-W3] bộ nạp CHỈ ĐỌC: không có phép ghi nào", () => {
    for (const ghi of [".create(", ".createMany(", ".update(", ".updateMany(", ".upsert(", ".delete(", ".deleteMany(", "$executeRaw", "$queryRaw"]) {
      expect(dem(nap, ghi), ghi).toBe(0);
    }
  });

  it("[NHH-TRX-W4] hàm thuần không chạm DB / Prisma / đồng hồ", () => {
    expect(dem(thuan, "@/lib/db")).toBe(0);
    expect(dem(thuan, "@prisma/client")).toBe(0);
    expect(dem(thuan, "new Date(")).toBe(0);
    expect(dem(thuan, "Date.now(")).toBe(0);
  });

  it("[NHH-TRX-W5] bộ nạp nhận client qua THAM SỐ (luật 7): không import @/lib/db trần", () => {
    expect(dem(nap, "@/lib/db")).toBe(0);
    expect(dem(nap, "client: KhachDoc")).toBeGreaterThanOrEqual(3);
  });

  it("[NHH-TRX-W6] mốc 'lần mua' (`taoLuc`) của mọi dòng là giờ MÁY CHỦ và đi qua MỘT hàm `gioMuaCuaDong` (tiền lệ + dòng đang xét): `Order.createdAt` chỉ vào làm `coSo` qua `donChuaKiem.get(…) ?? <Order.createdAt>` (đơn ghi bù / nhập cũ lấy giờ audit, vì createdAt của đường nhập cũ là NGÀY TRONG SHEET) — mỗi chỗ đặt `taoLuc` đi kèm cờ `gioTaoChuaKiem` và `themMuon` của CÙNG hàm", () => {
    // LUẬT, không phải cách đặt tên biến: mỗi giá trị gán cho `taoLuc` hoặc lấy từ kết quả của `gioMuaCuaDong` (`mua.taoLuc`, `muaLuc`), hoặc là ngày tạo GHI DANH (`x.createdAt` — ghi danh mồ côi,
    // không phải đơn), hoặc là chính hai nhánh bên trong hàm đó (`p.themLuc` · `p.coSo`), hoặc là chú thích kiểu (`Date`).
    const gan = [...nap.matchAll(/taoLuc:\s*([^,\n}]+)/g)].map((m) => m[1]!.trim());
    expect(gan.length).toBeGreaterThanOrEqual(4);
    for (const v of gan) expect(v, v).toMatch(/^(mua\.taoLuc$|muaLuc$|x\.createdAt$|p\.themLuc$|p\.coSo$|Date(;|$))/);
    // Không còn đường nào đặt Order.createdAt TRẦN làm `taoLuc` (đường nhập giao dịch cũ đặt nó bằng ngày người nhập khai; đường ghi bù mang giờ NHẬP).
    expect(/taoLuc:\s*\w+\.order\.createdAt/.test(nap)).toBe(false);
    // Hai nơi dựng (tiền lệ + dòng đang xét) — cùng MỘT hàm, và `coSo` là giờ của ĐƠN nhận diện đúng một cách.
    expect(dem(nap, "gioMuaCuaDong(")).toBe(3); // định nghĩa + tiền lệ + dòng đang xét
    expect(dem(nap, "coSo: donChuaKiem.get(d.orderId) ?? d.order.createdAt")).toBe(1);
    expect(dem(nap, "coSo: donChuaKiem.get(dong.orderId) ?? dong.order.createdAt")).toBe(1);
    expect(dem(nap, "donChuaKiem.get(")).toBe(2);
    expect(dem(nap, "donChuaKiem: donChuaKiem.has(")).toBe(2);
    // Cờ đi cùng: mọi nơi đặt `gioTaoChuaKiem` / `themMuon` đều lấy từ kết quả của hàm, không tự suy lại.
    expect(dem(nap, "gioTaoChuaKiem: mua.gioTaoChuaKiem")).toBe(1);
    expect(/const gioTaoChuaKiem = mua\.gioTaoChuaKiem/.test(nap)).toBe(true);
    expect(dem(nap, "themMuon: mua.themMuon")).toBe(3); // tiền lệ + hai chỗ của dòng đang xét (nhóm phụ huynh · đầu vào phân loại)
    expect(dem(nap, "taoLuc: d.createdAt")).toBe(0);
    expect(dem(nap, "taoLuc: dong.createdAt")).toBe(0);
    // Luật v5: dòng thêm muộn chỉ nhận diện khi `themLuc` MUỘN HƠN `coSo` — dấu bất thường (≤) không được tin.
    const ham = nap.slice(nap.indexOf("function gioMuaCuaDong("), nap.indexOf("function gioMuaCuaDong(") + 700);
    expect(ham).toMatch(/p\.themLuc !== undefined && p\.themLuc\.getTime\(\) > p\.coSo\.getTime\(\)/);
  });

  it("[NHH-TRX-W7] LUẬT v3: KHÔNG ngày nào do người nhập khai đi vào thứ tự mua — `thoiDiemMua` / `docNgayMuaGhiBuTheoDon` đã gỡ; giờ của đơn chưa kiểm chứng đọc ở đúng MỘT chỗ, từ `AuditLog.createdAt` (máy chủ đặt), KHÔNG từ `Payment.paidDate` / `newValues.paidDate` / `note` / `method`", () => {
    expect(/thoiDiemMua|ngayMuaGhiBu|docNgayMuaGhiBu/.test(nap)).toBe(false);
    expect(/thoiDiemMua/.test(thuan)).toBe(false);
    expect(dem(nap, "docDonGioTaoChuaKiem(")).toBe(3); // định nghĩa + tiền lệ + dòng đang xét
    const than = nap.slice(nap.indexOf("async function docDonGioTaoChuaKiem("), nap.indexOf("async function docMocHuyTheoDon("));
    expect(than.length).toBeGreaterThan(200);
    expect(dem(than, "client.auditLog.findMany(")).toBe(1);
    expect(than).toMatch(/select: \{ entityType: true, entityId: true, createdAt: true \}/);
    // Thân hàm chỉ HỎI audit theo `source` (trong `where`); không đọc giá trị nào bên trong `newValues`, không đọc cột nào của Payment ngoài id/orderId.
    expect(than).not.toMatch(/paidDate|\.newValues|\bnote\b|\bmethod\b|BACKFILL_PAYMENT_MARKER|_min|groupBy/);
    expect(than).toMatch(/payment\.findMany\(\{ where: \{ orderId: \{ in: \[\.\.\.orderIds\] \} \}, select: \{ id: true, orderId: true \} \}\)/);
    expect(dem(nap, "BACKFILL_PAYMENT_MARKER")).toBe(0);
    expect(dem(nap, "KHOAN_DA_GHI_NHAN")).toBe(0);
  });

  it("[NHH-TRX-W8] hai đầu của MỖI dấu hiệu 'giờ tạo chưa kiểm chứng' khớp nhau: bộ nạp hỏi đúng dòng AuditLog mà người ghi viết ra (module/entity/action/source), CÙNG transaction — ghi bù (Payment) và nhập giao dịch cũ (Order)", () => {
    const ghiBu = doc("lib/crm/backfill-order.ts");
    const nhapCu = doc("lib/finance/ghi-giao-dich-cu.ts");
    const nhanBu = nap.match(/export const AUDIT_NGUON_DON_GHI_BU = "([^"]+)"/)?.[1];
    const nhanCu = nap.match(/export const AUDIT_NGUON_DON_NHAP_CU = "([^"]+)"/)?.[1];
    expect(nhanBu).toBeTruthy();
    expect(nhanCu).toBeTruthy();
    expect(nhanBu).not.toBe(nhanCu);
    // đầu ghi
    expect(dem(ghiBu, `source: "${nhanBu}"`)).toBe(1);
    expect(dem(nhapCu, `source: "${nhanCu}"`)).toBe(1);
    for (const nguon of [ghiBu, nhapCu]) {
      expect(dem(nguon, 'module: "finance"')).toBeGreaterThanOrEqual(1);
      expect(dem(nguon, 'action: "CREATE"')).toBeGreaterThanOrEqual(1);
    }
    expect(dem(ghiBu, 'entityType: "Payment"')).toBeGreaterThanOrEqual(1);
    expect(dem(nhapCu, 'entityType: "Order"')).toBeGreaterThanOrEqual(1);
    // đầu đọc: một mệnh đề OR hai nhánh, mỗi nhánh khớp entityType + source tương ứng
    expect(nap).toMatch(/module: "finance",\s*action: "CREATE",/);
    expect(nap).toMatch(/entityType: "Payment", entityId: \{ in: \[\.\.\.donCuaKhoan\.keys\(\)\] \}, newValues: \{ path: \["source"\], equals: AUDIT_NGUON_DON_GHI_BU \}/);
    expect(nap).toMatch(/entityType: "Order", entityId: \{ in: \[\.\.\.orderIds\] \}, newValues: \{ path: \["source"\], equals: AUDIT_NGUON_DON_NHAP_CU \}/);
    // audit ghi bằng chính `tx` của đơn ⇒ cùng commit/rollback với đơn (không có đơn chưa kiểm chứng mà thiếu dấu, hay dấu mà không có đơn)
    for (const nguon of [ghiBu, nhapCu]) {
      const khoiAudit = nguon.slice(nguon.indexOf("await writeAudit({"), nguon.indexOf("await writeAudit({") + 900);
      expect(khoiAudit).toMatch(/\btx,\s*\}\);/);
    }
  });

  it("[NHH-TRX-W9] hàm thuần có `quanHeLanMua` làm chỗ DUY NHẤT xét trước/sau của hai đơn: `phanLoaiGiaoDich` và `tinhPhuHuynhHienHuu` gọi nó, không so `taoLuc` trần giữa hai đơn bằng chỗ khác", () => {
    expect(dem(thuan, "quanHeLanMua(")).toBe(4); // định nghĩa + 2 lần trong phanLoaiGiaoDich + 1 lần trong tinhPhuHuynhHienHuu
    expect(dem(thuan, "datTruoc(")).toBe(2); // định nghĩa + MỘT lời gọi (bên trong quanHeLanMua)
    // Luật v5: «cùng đơn = cùng một quyết định mua» chỉ qua `cungLanMua` (dòng thêm muộn là lần mua riêng) — không so `orderId` trần giữa hai dòng ở chỗ nào khác.
    expect(dem(thuan, "cungLanMua(")).toBe(3); // định nghĩa + lọc tiền lệ ở phanLoaiGiaoDich + tinhPhuHuynhHienHuu
    expect(/\.orderId\s*[!=]==?\s*(d|input)\.dong\.orderId/.test(thuan)).toBe(false);
    expect(dem(thuan, "return a.orderId === b.orderId && !a.themMuon && !b.themMuon;")).toBe(1);
  });

  it("[NHH-TRX-W12] hai đầu của dấu 'dòng thêm muộn' khớp nhau: bộ nạp hỏi đúng dòng AuditLog mà `themConVaoDon` viết ra (module · entity · action · `conMoi.id`), CÙNG transaction với dòng mới; bộ nạp chỉ HỎI audit, không đọc cột người gõ", () => {
    const them = doc("lib/finance/them-con-vao-don.ts");
    const nhan = nap.match(/export const AUDIT_HANH_DONG_THEM_CON_VAO_DON = "([^"]+)"/)?.[1];
    expect(nhan).toBe("THEM_CON_VAO_DON");
    // đầu ghi
    const khoi = them.slice(them.indexOf("await writeAudit({"), them.indexOf("await writeAudit({") + 1800);
    expect(dem(them, "await writeAudit({")).toBe(1);
    expect(khoi).toMatch(/\btx,/);
    expect(khoi).toMatch(/module: "finance",/);
    expect(khoi).toMatch(/entityType: "Order",/);
    expect(khoi).toContain(`action: "${nhan}",`);
    expect(khoi).toMatch(/conMoi: \{ id: dongMoi\.id,/);
    // đầu đọc
    expect(nap).toMatch(/where: \{ module: "finance", entityType: "Order", entityId: \{ in: \[\.\.\.orderIds\] \}, action: AUDIT_HANH_DONG_THEM_CON_VAO_DON \}/);
    expect(nap).toMatch(/const conMoi = \(v as Record<string, unknown>\)\["conMoi"\]/);
    const than = nap.slice(nap.indexOf("async function docDongThemMuon("), nap.indexOf("function gioMuaCuaDong(") );
    expect(than.length).toBeGreaterThan(200);
    expect(than).toMatch(/select: \{ createdAt: true, newValues: true \}/);
    expect(than).not.toMatch(/paidDate|\bnote\b|\bmethod\b|\.reason/);
  });

  it("[NHH-TRX-W13] ĐƯỜNG TẠO DÒNG riêng lẻ (`orderItem.create(` — ngoài `items: { create }` lúc tạo đơn) chỉ có BỐN nơi, và mỗi nơi đã được phân loại: `them-con-vao-don` (có dấu audit ⇒ `themMuon`) · `doi-khoa-db` (dòng mới gắn ghi danh có `transferredFrom` ⇒ PENDING_REGULATION) · nạp UAT và nạp UAT SOURCE FINAL (đặt `createdAt` tường minh). Thêm đường thứ tư = đọc lại luật v5 trước", () => {
    const co: string[] = [];
    for (const tep of [...quetThuMuc(resolve(process.cwd(), "lib")), ...quetThuMuc(resolve(process.cwd(), "app"))]) {
      if (/\.orderItem\.create\(/.test(chuThichBo(readFileSync(tep, "utf8")))) co.push(tep.replace(process.cwd(), "").replaceAll("\\", "/"));
    }
    expect(co.sort()).toEqual(["/lib/finance/doi-khoa-db.ts", "/lib/finance/them-con-vao-don.ts", "/lib/uat/nap-du-lieu-hoa-hong.ts", "/lib/uat/nguon-final-db.ts"]);
  }, 120_000);

  it("[NHH-TRX-W10] LUẬT v4: tiền lệ chỉ được xếp bằng `xepLanMuaTruocAnToan` (hai cách đọc ngày thu) — `phanLoaiGiaoDich` / `tinhPhuHuynhHienHuu` không gọi cách đọc theo ngày khai trực tiếp; ngày khai (`paidDate`) vào đúng MỘT chỗ, giờ máy chủ (`ghiLuc`) đúng một chỗ", () => {
    const cat = (dau: string, cuoi: string) => thuan.slice(thuan.indexOf(dau), thuan.indexOf(cuoi));
    const thanPhanLoai = cat("export function phanLoaiGiaoDich(", "const LY_DO_PENDING");
    const thanPhuHuynh = cat("export function tinhPhuHuynhHienHuu(", "function baoLuuHieuLuc(");
    const thanAnToan = cat("export function xepLanMuaTruocAnToan(", "export function tinhPhuHuynhHienHuu(");
    for (const than of [thanPhanLoai, thanPhuHuynh]) {
      expect(than.length).toBeGreaterThan(200);
      expect(dem(than, "xepLanMuaTruoc("), "gọi cách đọc theo ngày khai trực tiếp").toBe(0);
      expect(dem(than, "xepTheoCachDoc(")).toBe(0);
    }
    expect(dem(thanPhanLoai, "xepLanMuaTruocAnToan(")).toBe(2); // xếp tiền lệ + tập «thứ tự chưa kiểm chứng»
    expect(dem(thanPhuHuynh, "xepLanMuaTruocAnToan(")).toBe(1);
    // Hàm an toàn: cách đọc 1 qua `xepLanMuaTruoc` (ngày khai), cách đọc 2 qua `xepTheoCachDoc(…, ghiLuc)`; lệch ⇒ PHU_THUOC_NGAY_KHAI.
    expect(dem(thanAnToan, "xepLanMuaTruoc(l, taus.tau)")).toBe(1);
    expect(dem(thanAnToan, "xepTheoCachDoc(l, taus.tauMay, (k) => k.ghiLuc)")).toBe(1);
    expect(thanAnToan).toMatch(/theoNgayKhai\.ket !== theoGioMay\.ket\) return \{ ket: "PHU_THUOC_NGAY_KHAI"/);
    // Toàn tệp thuần: `paidDate` được ĐỌC (`k.paidDate`) đúng MỘT lần (cách đọc 1), `ghiLuc` đúng một lần (cách đọc 2); `xepLanMuaTruoc(` = định nghĩa + lời gọi trong hàm an toàn.
    expect(dem(thuan, "k.paidDate")).toBe(1);
    expect(dem(thuan, "k.ghiLuc")).toBe(1);
    expect(dem(thuan, "xepLanMuaTruoc(")).toBe(2);
    expect(dem(thuan, "xepTheoCachDoc(")).toBe(3); // định nghĩa + hai lời gọi (cách đọc 1 trong `xepLanMuaTruoc`, cách đọc 2 trong hàm an toàn)
  });

  it("[NHH-TRX-W11] LUẬT v4: bộ nạp đưa GIỜ MÁY CHỦ vào cả hai đầu — mỗi khoản thu mang `ghiLuc` = `Payment.createdAt`, τ máy chủ tính từ `createdAt` (KHÔNG `paidDate`) và truyền cho cả hàm phân loại lẫn `tinhPhuHuynhHienHuu`", () => {
    expect(nap).toMatch(/select: \{ id: true, orderId: true, orderItemId: true, enrollmentId: true, amount: true, paidDate: true, createdAt: true \}/);
    expect(dem(nap, "ghiLuc: b.createdAt")).toBe(1);
    expect(dem(nap, "tinhTauTheoGioMay(")).toBe(2); // định nghĩa + MỘT lời gọi
    const than = nap.slice(nap.indexOf("function tinhTauTheoGioMay("), nap.indexOf("export async function docLanMuaTheoHocVien("));
    expect(than.length).toBeGreaterThan(100);
    expect(dem(than, "paidDate")).toBe(0);
    expect(dem(than, "createdAt")).toBeGreaterThanOrEqual(2);
    // Luật v5: τ và τ máy chủ cùng tính từ MỘT danh sách khoản (`butToanTinhTau`) — bằng `butToanDon` với dòng thường, hoặc phần ghi từ lúc dòng thêm muộn tồn tại (giờ máy chủ `createdAt`, không `paidDate`).
    expect(/const tauMay = tinhTauTheoGioMay\(butToanTinhTau\)/.test(nap)).toBe(true);
    expect(/const tau = tinhTau\(butToanTinhTau\)/.test(nap)).toBe(true);
    expect(dem(nap, "const butToanTinhTau = mua.themMuon ? butToanDon.filter((b) => b.createdAt.getTime() >= muaLuc.getTime()) : butToanDon;")).toBe(1);
    expect(dem(nap, "tauMay,")).toBe(2); // vào `tinhPhuHuynhHienHuu` + vào đầu vào của `phanLoaiGiaoDich`
  });
});

// ═══ LUẬT v2 (2026-10-16): phân loại KHÔNG phụ thuộc giờ quét ═══════════════════════════════════════════
// Hành vi (kết quả y hệt dù quét kịp hay quét một mẻ) do tests/hoa-hong/phan-loai-tat-dinh.spec.ts [PLD-0*] chứng minh trên Postgres thật.
// Lưới ở đây canh phần hành vi KHÔNG tự chứng minh được: người gọi có lén đưa lại "mốc" vào không.
function quetThuMuc(thuMuc: string, ra: string[] = []): string[] {
  for (const ten of readdirSync(thuMuc)) {
    if (ten === "node_modules" || ten === ".next" || ten.startsWith(".")) continue;
    const duongDan = join(thuMuc, ten);
    if (statSync(duongDan).isDirectory()) quetThuMuc(duongDan, ra);
    else if (/\.(ts|tsx)$/.test(ten) && !/\.(test|spec)\.(ts|tsx)$/.test(ten)) ra.push(duongDan);
  }
  return ra;
}
const chuThichBo = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("[PLD-W] dây nối luật v2 — không có đường nào đưa MỐC THỜI GIAN vào phân loại", () => {
  const nap = doc("lib/hoa-hong/phan-loai-giao-dich-db.ts");
  const thuan = doc("lib/hoa-hong/phan-loai-giao-dich.ts");

  it("[PLD-W1] chữ ký `docDauVaoPhanLoai` / `phanLoaiDongDon` chỉ nhận { orderItemId } — không còn `moc`, và τ do bộ nạp TỰ tính từ dữ kiện của đơn", () => {
    expect(dem(nap, "input: { orderItemId: string }")).toBe(2);
    expect(/\bmoc\b/.test(nap)).toBe(false);
    expect(/\bmoc\b/.test(thuan)).toBe(false);
    expect(dem(nap, "tinhTau(")).toBe(2); // định nghĩa + MỘT lời gọi
    // τ chỉ sinh ra từ `tinhTau(` (dữ kiện của ĐƠN) và được DÙNG ở ≥ 2 nơi (phụ huynh hiện hữu + đầu vào phân loại) — không cần quan tâm viết `tau,` hay `tau: tau`.
    expect(/const tau = tinhTau\(/.test(nap)).toBe(true);
    expect(nap.match(/\btau\b/g)!.length).toBeGreaterThanOrEqual(3);
  });

  it("[PLD-W2] ngoài tệp định nghĩa, lib/ và app/ gọi `phanLoaiDongDon(` đúng BA nơi (chotPhanLoai + dự kiến + công cụ đo hold CHỈ ĐỌC `lan-mua-treo-doc`) và cả ba chỉ truyền { orderItemId } — không nơi nào đưa mốc thời gian vào", () => {
    const goi: { tep: string; dong: string }[] = [];
    for (const tep of [...quetThuMuc(resolve(process.cwd(), "lib")), ...quetThuMuc(resolve(process.cwd(), "app"))]) {
      if (tep.endsWith("phan-loai-giao-dich-db.ts")) continue;
      const code = chuThichBo(readFileSync(tep, "utf8"));
      for (const m of code.matchAll(/phanLoaiDongDon\(([^)]*)\)/g)) {
        goi.push({ tep: tep.replace(process.cwd(), "").replaceAll("\\", "/"), dong: m[1]!.replace(/\s+/g, " ").trim() });
      }
    }
    expect(goi.map((g) => g.tep).sort()).toEqual(["/lib/hoa-hong/doc-so.ts", "/lib/hoa-hong/lan-mua-treo-doc.ts", "/lib/hoa-hong/quet-khoan.ts"]);
    for (const g of goi) expect(g.dong, g.tep).toMatch(/^client, \{ orderItemId(: [\w.]+)? \}$/);
  }, 120_000); // quét cả cây lib/ + app/: máy tải cao (nhiều agent cùng chạy) đã từng mất hơn 5 giây mặc định

  it("[PLD-W3] thân `phanLoaiGiaoDich` chỉ lấy thời gian từ `d.tau`: không `paidDate`, không đồng hồ, không tham số `moc`", () => {
    const dau = thuan.indexOf("export function phanLoaiGiaoDich(");
    const cuoi = thuan.indexOf("const LY_DO_PENDING");
    expect(dau).toBeGreaterThan(0);
    expect(cuoi).toBeGreaterThan(dau);
    const than = thuan.slice(dau, cuoi);
    expect(dem(than, "paidDate")).toBe(0);
    expect(dem(than, "new Date")).toBe(0);
    expect(dem(than, "Date.now")).toBe(0);
    expect(dem(than, "d.tau")).toBeGreaterThanOrEqual(3); // xepLanMuaTruoc · baoLuuHieuLuc · bằng chứng
  });
});
