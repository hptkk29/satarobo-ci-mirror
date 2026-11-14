// @vitest-environment node
// lib/orders/pham-vi/giam-them-wiring.test.ts — LƯỚI GHIM DÂY NỐI cho khoản giảm thêm trên dòng SCOPE [20/10/2026] + hành vi thuần của `tienThucDongPhamVi`.
//
// Phần HÀNH VI đã có ca riêng (action: `cong-tao-don.test.ts` [GT-*]; Postgres: `tests/finance/don-pham-vi-db.test.ts` [GT-DB-*]; form: `order-create-form-pham-vi.test.tsx`
// [GT-*]; trần theo cơ sở: `tests/nen/tran-giam-pham-vi-co-so.spec.ts`). Lưới này canh điều hành vi KHÔNG chứng minh được: lời gọi có truyền `orgUnitId` không, cổng
// đứng TRƯỚC phép ghi không, các nơi đọc dấu SCOPE có cùng đọc "tiền thực" không. Theo luật 11: bóc chú thích TRƯỚC khi đếm, neo vào BIỂU THỨC (không neo vào chỗ đặt `await`),
// đếm SỐ LẦN khớp, không cờ `/s`.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SETTINGS } from "@/lib/settings/registry";
import { tienThucDongPhamVi } from "./doc-dong";

const doc = (rel: string) =>
  readFileSync(resolve(process.cwd(), rel), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const dem = (s: string, re: RegExp) => (s.match(re) ?? []).length;

const ACTION = "app/(admin)/admin/orders/_actions.ts";
const XEM_TRUOC = "app/(admin)/admin/orders/_pham-vi-actions.ts";
const FORM = "app/(admin)/admin/orders/_components/order-create-form.tsx";
const KHOA = "billing.scopeMaxDiscountPercent";

describe("[GTW-01] tham số trần: khai đúng khuôn đã chốt", () => {
  const d = SETTINGS[KHOA] as unknown as {
    default: number;
    centerOverridable: boolean;
    qlcsSuaDuoc?: boolean;
    schema: { safeParse: (x: unknown) => { success: boolean } };
  };
  it("mặc định 25, cài riêng theo cơ sở được, Quản lý cơ sở tự chỉnh được (chủ dự án chốt 20/10/2026)", () => {
    expect(d).toBeTruthy();
    expect(d.default).toBe(25);
    expect(d.centerOverridable).toBe(true);
    expect(d.qlcsSuaDuoc).toBe(true);
  });
  it("biên theo khuôn orders.maxDiscountPercent: số nguyên 1–100 (KHÔNG tự chọn trần tối đa mới); orders.maxDiscountPercent GIỮ NGUYÊN (50, không cài riêng)", () => {
    for (const ok of [1, 25, 100]) expect(d.schema.safeParse(ok).success, String(ok)).toBe(true);
    for (const sai of [0, 101, 25.5, -1, "25", null]) expect(d.schema.safeParse(sai).success, String(sai)).toBe(false);
    const goc = SETTINGS["orders.maxDiscountPercent"] as unknown as { default: number; centerOverridable: boolean; schema: { safeParse: (x: unknown) => { success: boolean } } };
    expect(goc.default).toBe(50);
    expect(goc.centerOverridable).toBe(false);
    for (const x of [0, 1, 100, 101]) expect(d.schema.safeParse(x).success).toBe(goc.schema.safeParse(x).success); // CÙNG biên
  });
});

describe("[GTW-02] createOrderManualAction: trần đọc kèm orgUnitId, cổng đứng TRƯỚC mọi phép ghi", () => {
  const src = doc(ACTION);
  const than = src.slice(src.indexOf("export async function createOrderManualAction("));

  it("đọc trần đúng MỘT lần, với { orgUnitId: orgUnitIdDon } — bỏ trống thì chỉ đọc mức toàn cục", () => {
    expect(dem(than, /getSetting\("billing\.scopeMaxDiscountPercent", \{ orgUnitId: orgUnitIdDon \}\)/g)).toBe(1);
    expect(dem(than, /getSetting\("billing\.scopeMaxDiscountPercent"\)/g)).toBe(0);
  });
  it("chỉ đọc khi đơn là SCOPE (đơn thường không đọc thêm gì): nằm trong `if (dongGiamThem)`", () => {
    expect(dem(than, /const dongGiamThem: DongGiamThem\[\] \| null =\s*pv\.kieu === "SCOPE"/g)).toBe(1);
    const iIf = than.indexOf("if (dongGiamThem) {");
    const iDoc = than.indexOf('getSetting("billing.scopeMaxDiscountPercent"');
    expect(iIf).toBeGreaterThan(-1);
    expect(iDoc).toBeGreaterThan(iIf);
  });
  it("cổng từ chối vượt trần dùng `dongVuotTranPhamVi` + `loiVuotTranPhamVi` (CÙNG hàm với form), đứng TRƯỚC `xetDuyetDon(` và TRƯỚC `$transaction(`/`order.create(`", () => {
    expect(dem(than, /dongVuotTranPhamVi\(dongGiamThem, tranGiamPhamVi\)/g)).toBe(1);
    expect(dem(than, /loiVuotTranPhamVi\(/g)).toBe(1);
    const iCong = than.indexOf("dongVuotTranPhamVi(dongGiamThem, tranGiamPhamVi)");
    const iDuyet = than.indexOf("xetDuyetDon({");
    const iTx = than.indexOf("$transaction(");
    const iTao = than.indexOf("tx.order.create(");
    expect(iCong).toBeGreaterThan(-1);
    expect(iDuyet).toBeGreaterThan(iCong);
    expect(iTx).toBeGreaterThan(iCong);
    if (iTao >= 0) expect(iTao).toBeGreaterThan(iCong);
    // Từ đầu hàm tới cổng không có phép GHI nào (chỉ đọc).
    expect(than.slice(0, iCong)).not.toMatch(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/);
  });
  it("đếm khoản giảm đi qua `uuDaiDongKhoaHoc` và chuyển DANH SÁCH LÝ DO sang xetDuyetDon (một nguồn cho cột DB, câu chữ, form)", () => {
    expect(dem(than, /uuDaiDongKhoaHoc\(d\.giam\)/g)).toBe(1);
    expect(dem(than, /lyDoKhoa: uuDaiDongKhoaHoc\(d\.giam\)\.lyDo/g)).toBe(1);
  });
  it("[GTW-02c] luật áp cho MỌI dòng KHOÁ HỌC (không chỉ SCOPE): rẽ nhánh bằng `laDongKhoaHoc(<loại dòng>)`, KHÔNG bằng `dongGiamThem` (chỉ có ở đơn SCOPE)", () => {
    expect(dem(than, /laDongKhoaHoc\(data\.items\[i\]\?\.type\)/g)).toBe(1);
    // Dòng không phải khoá học giữ luật cũ: đếm khoản, so ngưỡng, lyDoKhoa rỗng.
    expect(dem(than, /soUuDai: d\.giam\.length, lyDoKhoa: \[\]/g)).toBe(1);
    // Cổng duyệt khoản giảm KHÔNG được nằm trong nhánh SCOPE.
    const iXet = than.indexOf("xetDuyetDon({");
    const iNhanhScope = than.indexOf("if (dongGiamThem) {");
    expect(iXet).toBeGreaterThan(-1);
    expect(iNhanhScope).toBeGreaterThan(-1);
    expect(iXet).toBeGreaterThan(iNhanhScope);
    expect(dem(than.slice(iXet, iXet + 1500), /dongGiamThem/g)).toBe(0);
  });
  it("[GTW-02d] MỘT VĂN BẢN — MỘT MÃ: TỪ CHỐI bằng `khoanTrungVanBan(...)` tra theo `maTheoId` (DB), đứng SAU cổng điều kiện mã và TRƯỚC `$transaction(`", () => {
    expect(dem(than, /khoanTrungVanBan\(it\.discounts \?\? \[\], maTheoId\)/g)).toBe(1);
    expect(dem(than, /loiTrungVanBan\(/g)).toBe(1);
    const iTrung = than.indexOf("khoanTrungVanBan(");
    const iDieuKien = than.indexOf("lyDoKhongDung(m,");
    const iTx = than.indexOf("$transaction(");
    expect(iDieuKien).toBeGreaterThan(-1);
    expect(iTrung).toBeGreaterThan(iDieuKien);
    expect(iTx).toBeGreaterThan(iTrung);
  });
  it("[GTW-02b] 'từ chương trình có sẵn' là kết luận của MÁY CHỦ: danh sách đưa vào đếm là `khaiDong` (đã qua tra DB), KHÔNG phải `data.items[].discounts` thô của client", () => {
    // `khaiDong[i].giam` chỉ mang `voucherId` khi `docMaTheoId` tìm thấy mã (mã không có ⇒ đơn bị từ chối trước đó). Đếm từ `data.items` là để
    // client tự bật cờ "chương trình" cho một khoản gõ tay và lách cổng duyệt.
    expect(than).not.toMatch(/uuDaiDongKhoaHoc\(\s*(?:data\.items|it\.discounts)/);
    expect(dem(than, /if \(m\) return khaiGiamTuMa\(m\);/g)).toBe(1);
    expect(dem(than, /voucherId: null,/g)).toBeGreaterThanOrEqual(1);
  });
});

describe("[GTW-03] xem trước: ba khoá cài-riêng được đọc kèm orgUnitId; trần từng khoản thì không", () => {
  const src = doc(XEM_TRUOC);
  it("đúng ba lời gọi { orgUnitId } và một lời gọi không tuỳ chọn", () => {
    for (const k of ["billing.scopeMaxDiscountPercent", "orders.maxInstallments", "orders.maxDiscountItems"]) {
      expect(dem(src, new RegExp(`getSetting\\("${k.replace(/\./g, "\\.")}", \\{ orgUnitId \\}\\)`, "g")), k).toBe(1);
    }
    expect(dem(src, /getSetting\("orders\.maxDiscountPercent"\)/g)).toBe(1);
  });
  it("chỉ đọc khi kết quả là SCOPE và có orgUnitId", () => {
    expect(dem(src, /kq\.kieu === "SCOPE" && orgUnitId/g)).toBe(1);
  });
});

describe("[GTW-04] form: ngưỡng lấy từ MÁY CHỦ, không gõ cứng; một nguồn tính", () => {
  const form = doc(FORM);
  it("trần/ngưỡng đọc từ kết quả xem trước (`ketQuaXemTruoc.nguong`), không có số trần gõ cứng", () => {
    expect(dem(form, /ketQuaXemTruoc\.nguong/g)).toBeGreaterThanOrEqual(2);
    expect(form).not.toMatch(/tranGiamPhamVi\s*[:=]\s*\d/);
    expect(form).not.toMatch(/tranUuDaiMoiDong\s*[:=]\s*\d/);
  });
  it("dùng đúng các hàm chung với máy chủ — không có bản tính thứ hai", () => {
    expect(dem(form, /dongVuotTranPhamVi\(/g)).toBe(1);
    // HAI chỗ gọi mỗi hàm: (1) khối đơn (`duyetPhamVi`, toàn đơn) và (2) báo inline dưới khối giảm giá của từng dòng (`canDuyetKhoanThem`) — cả hai đi qua CHÍNH hàm máy chủ.
    // [26/10/2026] ĐỔI: câu "chờ duyệt" nay áp cho MỌI dòng khoá học (không chỉ khi máy chủ trả xem trước SCOPE) nên `xetDuyetDon` chỉ còn ở khối đơn
    // (`lyDoChoDuyetKhoa`); báo inline từng dòng (`lyDoDuyetKhoanThem`) dùng thẳng `uuDaiDongKhoaHoc` + `cauLyDoDuyetKhoa` — cùng hàm, không cần ngưỡng.
    expect(dem(form, /uuDaiDongKhoaHoc\(/g)).toBe(2);
    expect(dem(form, /xetDuyetDon\(/g)).toBe(1);
    expect(dem(form, /cauLyDoDuyetKhoa\(/g)).toBe(1);
    // Một văn bản — một mã: cùng `khoanTrungVanBan` / `vanBanDaDungKhac` với máy chủ.
    expect(dem(form, /khoanTrungVanBan\(/g)).toBe(1);
    expect(dem(form, /vanBanDaDungKhac\(/g)).toBe(2);
    expect(dem(form, /xetTranDong\(/g)).toBe(1);
    expect(dem(form, /loiVuotTranPhamVi\(/g)).toBe(2); // khối đỏ trên màn + toast lúc bấm Lưu
  });
});

describe("[GTW-05] mọi nơi đọc dấu SCOPE lấy 'tiền thực' (giá chính sách − khoản thêm), không so thẳng với thanhTien", () => {
  it("cap-tu-don: không còn phép so `unitPrice × quantity − discountAmount === pv.thanhTien`; dùng tienThucDongPhamVi cho cả cổng dấu lẫn số phải thu", () => {
    const s = doc("lib/entitlements/cap-tu-don.ts");
    expect(s).not.toMatch(/d\.unitPrice \* d\.quantity - d\.discountAmount === pv\.thanhTien/);
    expect(dem(s, /tienThucDongPhamVi\(pv, d\)/g)).toBe(1);
    expect(dem(s, /danhGiaTien\(d\.id, phaiThuDong\)/g)).toBe(2);
    expect(dem(s, /danhGiaTien\(d\.id, pv\.thanhTien\)/g)).toBe(0);
    expect(dem(s, /ketQuaGiaTuDau\(pv, tienThuc\.giamThem\)/g)).toBe(1);
  });
  it("đối soát lệch: select đủ bốn cột tiền của dòng và so quyền học với tiền thực", () => {
    const s = doc("lib/entitlements/hang-doi/doi-soat.ts");
    for (const c of ["unitPrice", "quantity", "totalPrice", "discountAmount"]) expect(s, c).toMatch(new RegExp(`\\b${c}: true`));
    expect(dem(s, /thanhTien: tienThucDongPhamVi\(pv, d\)\?\.thanhTienThuc \?\? pv\.thanhTien/g)).toBe(1);
  });
  it("giá ghi danh khi chuyển đổi: dòng SCOPE dùng tiền thực, dòng thường giữ totalPrice", () => {
    const s = doc("lib/finance/dong-don-cua-lead.ts");
    expect(dem(s, /totalPrice: tienThuc \? tienThuc\.thanhTienThuc : it\.totalPrice/g)).toBe(1);
    expect(s).toMatch(/select: \{ totalPrice: true, discountAmount: true, unitPrice: true, quantity: true, metadata: true \}/);
  });
});

describe("[GTW-06] tienThucDongPhamVi — tiền thực = giá chính sách − khoản thêm ĐÃ GHI VÀO DẤU lúc tạo đơn", () => {
  const pv = (giamThem: number) => ({ thanhTien: 8_976_000, giamThem });
  const dong = (o: Partial<Parameters<typeof tienThucDongPhamVi>[1]> = {}) => ({
    unitPrice: 8_976_000,
    quantity: 1,
    totalPrice: 8_976_000,
    discountAmount: 0,
    ...o,
  });
  it("không khoản thêm ⇒ tiền thực = giá chính sách; có khoản thêm khớp dấu ⇒ trừ đúng khoản đó", () => {
    expect(tienThucDongPhamVi(pv(0), dong())).toEqual({ giamThem: 0, thanhTienThuc: 8_976_000 });
    expect(tienThucDongPhamVi(pv(100_000), dong({ discountAmount: 100_000 }))).toEqual({ giamThem: 100_000, thanhTienThuc: 8_876_000 });
  });
  it("GIỮ GUARD CŨ [CD2-MG-01]: discountAmount ĐỔI sau khi tạo đơn (miễn giảm, sửa tay) lệch dấu ⇒ null ⇒ dauKhongKhop, dù khoản ấy nhỏ hơn trần", () => {
    expect(tienThucDongPhamVi(pv(0), dong({ discountAmount: 500_000 }))).toBeNull(); // dấu không khoản thêm, nhưng dòng bị hạ giá về sau
    expect(tienThucDongPhamVi(pv(100_000), dong({ discountAmount: 150_000 }))).toBeNull(); // khoản thêm 100k, rồi miễn giảm thêm 50k
    expect(tienThucDongPhamVi(pv(100_000), dong({ discountAmount: 0 }))).toBeNull(); // khoản thêm bị gỡ khỏi dòng mà dấu vẫn ghi
  });
  it("dấu không khớp tiền thật của dòng ⇒ null (KHÔNG tin): giá nền lệch, totalPrice lệch, khoản âm/lớn hơn giá, không nguyên", () => {
    expect(tienThucDongPhamVi(pv(0), dong({ unitPrice: 8_000_000 }))).toBeNull();
    expect(tienThucDongPhamVi(pv(0), dong({ quantity: 2 }))).toBeNull();
    expect(tienThucDongPhamVi(pv(0), dong({ totalPrice: 9_000_000 }))).toBeNull();
    expect(tienThucDongPhamVi(pv(0), dong({ discountAmount: -1 }))).toBeNull();
    expect(tienThucDongPhamVi(pv(8_976_001), dong({ discountAmount: 8_976_001 }))).toBeNull();
    expect(tienThucDongPhamVi(pv(0), dong({ discountAmount: 0.5 }))).toBeNull();
    expect(tienThucDongPhamVi(pv(0), dong({ discountAmount: Number.NaN }))).toBeNull();
  });
  it("biên: khoản thêm bằng đúng giá chính sách (đã ghi vào dấu) ⇒ tiền thực 0 (hợp lệ về số học)", () => {
    expect(tienThucDongPhamVi(pv(8_976_000), dong({ discountAmount: 8_976_000 }))).toEqual({ giamThem: 8_976_000, thanhTienThuc: 0 });
  });
});

describe("[GTW-07] dấu SCOPE ghi `giamThem` (và chỉ khi > 0)", () => {
  it("action truyền khoản thêm đã server tính vào metadataChoDong; dấu không khoản thêm giữ nguyên từng byte", () => {
    const s = doc("app/(admin)/admin/orders/_actions.ts");
    expect(dem(s, /tien\.dong\[i\]!\.giam,\s*\),/g)).toBe(1);
  });
});
