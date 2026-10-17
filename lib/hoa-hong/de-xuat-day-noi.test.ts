// @vitest-environment node
/**
 * [DXD-W*] · [DRF-W*] — LƯỚI GHIM DÂY NỐI của hướng B+C (đọc MÃ NGUỒN; hành vi đã có ca Postgres ở `tests/hoa-hong/*`). Test hành vi của từng đường không bắt được việc "quên gọi" / "gọi thêm một chỗ":
 *   [DXD-W1] dòng `SOURCE_CORRECTION` / `DISPUTE_ADJUSTMENT` chỉ ghi ở service duyệt (không ở handler đổi nguồn, không ở script)
 *   [DXD-W2] quản trị điều chỉnh không chứa số tiền cứng (ngưỡng là cấu hình)
 *   [DXD-W3] handler đổi nguồn không import đường ghi sổ
 *   [DXD-W4] khoá quyền duyệt: MỘT bảng (`KHOA_DUYET_DE_XUAT`) cho action, hàm tính nút và service — không ai gõ tay chuỗi khoá
 *   [DXD-W5] chế độ `DOI_NGUON_CO_QUYEN` chỉ có MỘT nơi gọi (service duyệt)
 *   [DXD-W6] script backfill đổi nguồn không ghi sổ — ở `doi-nguon-script.test.ts` (đọc script vận hành, không lên gương CI nên nằm ở `scripts/ci/test-chi-rieng.txt`); [DXD-W7] ở `doi-nguon-xu-ly-xong.test.ts`
 *   [DXD-W8] quyết quản trị (một/hai người) luôn qua MỘT cửa đọc số nền: tích luỹ + cận gốc + tổng yêu cầu logic (`docNenQuanTri`) — không đường lập đề xuất nào tự tính cận; mỗi đường khai ĐÚNG khoá yêu cầu
 *   [DXD-W12] sự kiện đổi nguồn chạm nhiều ô: `apDungDoiNguonSauThu` dự báo tổng của CẢ sự kiện TRƯỚC vòng lập và truyền vào từng lượt (cái lập đầu tiên cũng thấy tổng)
 *   [DXD-W9] hai cổng của "giải hàng chờ": hàng chờ của đề xuất đang mở (cả "Áp dụng" lẫn "Giữ nguyên") và đề xuất đã kết thúc mà không ghi (STALE/REJECTED) — đứng TRƯỚC phép ghi
 *   [DRF-W1] bất biến carry-forward: ba đường so ô (quét · xem trước · "Áp dụng") đều đi qua `kyVongSauLichSu`
 *
 * Neo hẹp, bỏ chú thích TRƯỚC khi đếm (chú thích giải thích bản vá thường chứa đúng chuỗi đang cấm), đếm SỐ LẦN khớp, không cờ `s`. ĐÃ CẤY LẠI từng luật (xem commit): gỡ/đổi một dòng ⇒ ĐÚNG ca đỏ.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const doc = (p: string): string => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
/** Bỏ chú thích khối + chú thích dòng (không đụng chuỗi chứa `//` sau dấu `:`/ngoặc kép — các neo bên dưới không dùng URL). */
const boChuThich = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
const dem = (s: string, mau: RegExp): number => (s.match(new RegExp(mau.source, mau.flags.includes("g") ? mau.flags : `${mau.flags}g`)) ?? []).length;

const QUET = boChuThich(doc("lib/hoa-hong/quet-khoan.ts"));
const DUYET = boChuThich(doc("lib/hoa-hong/duyet-de-xuat.ts"));
const KHIEU_NAI = boChuThich(doc("lib/hoa-hong/khieu-nai.ts"));
const HANDLER = boChuThich(doc("lib/hoa-hong/_handlers/doi-nguon-sau-thu.ts"));
const DOI_NGUON = boChuThich(doc("lib/hoa-hong/doi-nguon-sau-thu.ts"));
const GIAI = boChuThich(doc("lib/hoa-hong/giai-hang-cho.ts"));
const ACTIONS = boChuThich(doc("app/(admin)/admin/nguon-hoa-hong/khieu-nai/_actions.ts"));
const DOC_DE_XUAT = boChuThich(doc("lib/hoa-hong/de-xuat-doc.ts"));
const QUAN_TRI = boChuThich(doc("lib/hoa-hong/quan-tri-dieu-chinh.ts"));
const SHEET = boChuThich(doc("components/admin/nguon-hoa-hong/de-xuat-sheet.tsx"));
const DE_XUAT = boChuThich(doc("lib/hoa-hong/de-xuat-dieu-chinh.ts"));
const AP_DUNG = GIAI.slice(GIAI.indexOf("async function apDungInputDrift"), GIAI.indexOf("async function daoKhoanBiRut"));

describe("[DXD-W1] sổ chỉ đổi ở service duyệt", () => {
  it("`loai: \"SOURCE_CORRECTION\"` được truyền cho `ghiChenhLech` đúng MỘT lần, TRONG nhánh duyệt (sau cổng gói giống nhau); handler & script không có đường ghi", () => {
    expect(dem(QUET, /loai: "SOURCE_CORRECTION",/)).toBe(1);
    const viTri = QUET.indexOf('loai: "SOURCE_CORRECTION",');
    const truoc = QUET.slice(Math.max(0, viTri - 1500), viTri);
    expect(truoc).toMatch(/if \(che\.cheDo === "DOI_NGUON_CO_QUYEN"\) \{/);
    expect(truoc).toMatch(/goiGiongNhau\(che\.duyet\.goi, deXuat\)/);
    for (const [ten, ma] of [["handler", HANDLER], ["doi-nguon-sau-thu", DOI_NGUON]] as const) {
      expect(ma, ten).not.toMatch(/ghiChenhLech|ghiDong|chayTrongKhoa/);
    }
  });

  it("dòng `DISPUTE_ADJUSTMENT` của khiếu nại: `dungDongDieuChinhKhieuNai(` gọi đúng HAI lần (một người / cấp hai), cả hai SAU cổng 'cần cấp hai'", () => {
    expect(dem(KHIEU_NAI, /dungDongDieuChinhKhieuNai\(\{/)).toBe(2);
    const dau = KHIEU_NAI.indexOf("dungDongDieuChinhKhieuNai({");
    const choCapHai = KHIEU_NAI.indexOf('loai: "CHO_CAP_HAI"');
    expect(choCapHai).toBeGreaterThan(-1);
    expect(dau).toBeGreaterThan(choCapHai); // cổng "cần hai người" (return CHO_CAP_HAI) đứng TRƯỚC phép ghi đầu tiên của đường một người
    const capHai = KHIEU_NAI.indexOf("export async function duyetCapHaiKhieuNai");
    expect(KHIEU_NAI.lastIndexOf("dungDongDieuChinhKhieuNai({")).toBeGreaterThan(capHai);
  });
});

describe("[DXD-W2] không số tiền cứng trong quản trị điều chỉnh", () => {
  it("không literal số ≥ 1000 (ngưỡng là THAM SỐ đọc từ cấu hình; mặc định khai ở registry)", () => {
    expect(QUAN_TRI.match(/\b\d{1,3}(?:[_.]\d{3})+\b|\b\d{4,}\b/g) ?? []).toEqual([]);
  });
});

describe("[DXD-W3] handler đổi nguồn không import đường ghi sổ", () => {
  it("không import `quet-khoan`'s ghi / `ghi-so`; chỉ gọi `apDungDoiNguonSauThu` (lập đề xuất)", () => {
    expect(HANDLER).not.toMatch(/from "\.\.\/ghi-so"|from "\.\.\/quet-khoan"/);
    expect(dem(HANDLER, /apDungDoiNguonSauThu\(/)).toBe(1);
    expect(DOI_NGUON).toMatch(/cheDo: "DE_XUAT_DOI_NGUON"/);
  });
});

describe("[DXD-W4] khoá quyền duyệt dùng chung giữa nút và action (luật 12)", () => {
  it("action · hàm tính 'việc của bạn' · service duyệt đều tra `KHOA_DUYET_DE_XUAT[…]`; không ai gõ tay khoá; Sheet không tự hỏi quyền", () => {
    expect(ACTIONS).toMatch(/KHOA_DUYET_DE_XUAT\[nguonGoc\]/);
    expect(DOC_DE_XUAT).toMatch(/KHOA_DUYET_DE_XUAT\[d\.nguonGoc\]/);
    expect(DUYET).toMatch(/KHOA_DUYET_DE_XUAT\[req\.origin\]/);
    for (const [ten, ma] of [["actions", ACTIONS], ["de-xuat-doc", DOC_DE_XUAT], ["duyet-de-xuat", DUYET], ["sheet", SHEET]] as const) {
      expect(ma, ten).not.toMatch(/"commission_(periods:manage|disputes:review)"/);
    }
    expect(SHEET).not.toMatch(/\bcan\(|checkPermission|assertPermission/);
  });
});

describe("[DXD-W5] chế độ ghi sổ đổi nguồn chỉ có MỘT nơi gọi", () => {
  it("`quetKhoan(…, { cheDo: \"DOI_NGUON_CO_QUYEN\" })` chỉ ở service duyệt (xem trước dùng `soVoiO` THUẦN — không ghi)", () => {
    expect(dem(DUYET, /quetKhoan\(client, bc, req\.paymentId, \{\s*cheDo: "DOI_NGUON_CO_QUYEN"/)).toBe(1);
    for (const [ten, ma] of [["handler", HANDLER], ["doi-nguon-sau-thu", DOI_NGUON], ["giai-hang-cho", GIAI], ["khieu-nai", KHIEU_NAI]] as const) {
      expect(ma, ten).not.toMatch(/quetKhoan\([^)]*cheDo: "DOI_NGUON_CO_QUYEN"/);
    }
  });
});

describe("[DRF-W1] carry-forward ở cả ba đường so ô", () => {
  it("quét · xem trước · 'Áp dụng' đều gọi `kyVongSauLichSu(`, và `soVoiO` nhận kỳ vọng ĐÃ qua nó (không `kyVongCua(kq)` trần)", () => {
    expect(dem(QUET, /kyVongSauLichSu\(kyVongCua\(kq\)/)).toBe(1);
    expect(QUET).toMatch(/soVoiO\(\{ o, kyVong: ls\.kyVong,/);
    expect(dem(DOI_NGUON, /kyVongSauLichSu\(/)).toBe(1);
    expect(DOI_NGUON).toMatch(/soVoiO\(\{ o, kyVong: ls\.kyVong,/);
    expect(dem(GIAI, /kyVongSauLichSu\(/)).toBe(1);
    expect(GIAI).not.toMatch(/tinhChenhTheoNguoi\(kyVongCua\(kq\), o\.rong\)/);
  });
});

describe("[DXD-W8] quyết quản trị qua MỘT cửa đọc số nền (tích luỹ + cận hoa hồng gốc)", () => {
  it("hai đường lập đề xuất gọi `quyetDinhQuanTriTrongTx` với `calcSlotId` của ô, SAU khoá ô; không đường nào tự tính cận / tích luỹ", () => {
    expect(dem(KHIEU_NAI, /quyetDinhQuanTriTrongTx\(tx, \{ goi, calcSlotId: mau\.calcSlotId,/)).toBe(1);
    expect(dem(QUET, /quyetDinhQuanTriTrongTx\(tx, \{ goi, calcSlotId: slotId,/)).toBe(1);
    // khoá yêu cầu: sai khoá (vd. gom theo `leadId` / `paymentId`) là đổi PHẠM VI gom — chủ dự án chốt đúng ba điều: cùng khiếu nại · cùng sự kiện đổi nguồn · không gom cả đời học viên
    expect(dem(KHIEU_NAI, /yeuCau: \{ khoa: \{ origin: "DISPUTE", disputeId: d\.id \}, duBaoTong: 0 \}/)).toBe(1);
    expect(dem(QUET, /yeuCau: \{ khoa: \{ origin: "SOURCE_CHANGE", refEventId: che\.refEventId \}, duBaoTong: che\.duBaoTongYeuCau \}/)).toBe(1);
    // đọc SAU khoá ô: hai khiếu nại đồng thời trên một ô xếp hàng qua khoá ấy nên cái sau thấy cái trước
    const iKn = KHIEU_NAI.indexOf("quyetDinhQuanTriTrongTx(tx");
    expect(KHIEU_NAI.lastIndexOf("h.khoaO([mau.calcSlotId])", iKn)).toBeGreaterThan(-1);
    const iQuet = QUET.indexOf("quyetDinhQuanTriTrongTx(tx");
    expect(QUET.lastIndexOf("h.khoaO([slotId])", iQuet)).toBeGreaterThan(-1);
    for (const [ten, ma] of [["khieu-nai", KHIEU_NAI], ["quet-khoan", QUET]] as const) {
      expect(ma, ten).not.toMatch(/\bcanTren\b|canTrenCuaO|canGocCuaO/);
    }
  });

  it("`docNenQuanTri(` chỉ được gọi MỘT lần, bên trong `quyetDinhQuanTriTrongTx`; không tệp nào khác của lib/hoa-hong đọc số nền", () => {
    expect(dem(DE_XUAT, /docNenQuanTri\(tx, i\.calcSlotId, i\.yeuCau\.khoa\)/)).toBe(1);
    // tổng yêu cầu = MAX(dự báo, anh em đã có + gói này): bỏ một vế là hở một trong hai tình huống (lượt lập đầu · chạy lại sau khi một số ô đã duyệt)
    expect(dem(DE_XUAT, /Math\.max\(i\.yeuCau\.duBaoTong, nen\.tichLuyAnhEm \+ absGoi\)/)).toBe(1);
    expect(dem(DE_XUAT, /docNenQuanTri\(/)).toBe(2); // định nghĩa + đúng một lời gọi
    const khac = readdirSync(resolve(process.cwd(), "lib/hoa-hong"))
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "de-xuat-dieu-chinh.ts")
      .filter((f) => /docNenQuanTri\(/.test(boChuThich(doc(`lib/hoa-hong/${f}`))));
    expect(khac).toEqual([]);
  });
});

describe("[DXD-W12] dự báo tổng của CẢ sự kiện trước vòng lập đề xuất", () => {
  it("`apDungDoiNguonSauThu` tính `duBaoTongYeuCau` từ `xemTruocDoiNguonSauThu` ĐÚNG MỘT lần, TRƯỚC vòng `for`, và truyền nó vào mỗi lời gọi `quetKhoan(DE_XUAT_DOI_NGUON)`", () => {
    expect(dem(DOI_NGUON, /tongDuBaoCuaSuKien\(await xemTruocDoiNguonSauThu\(client, bc, i\.leadId\)\)/)).toBe(1);
    expect(DOI_NGUON.indexOf("tongDuBaoCuaSuKien(await xemTruocDoiNguonSauThu(")).toBeLessThan(DOI_NGUON.indexOf("for (const id of ids)"));
    expect(dem(DOI_NGUON, /cheDo: "DE_XUAT_DOI_NGUON", refEventId: i\.refEventId, requestedById: i\.requestedById, duBaoTongYeuCau \}\)/)).toBe(1); // tham số truyền NGUYÊN BIẾN, không phải literal
    expect(dem(DOI_NGUON, /quetKhoan\(/)).toBe(1);
  });
});

describe("[DXD-W9] giải hàng chờ không là đường vòng qua quy trình duyệt đề xuất", () => {
  it("cổng `proposalId` đứng ở `giaiHangCho` TRƯỚC cả hai nhánh quyết định (Áp dụng lẫn Giữ nguyên), không chỉ trong `apDungInputDrift`", () => {
    const giai = GIAI.slice(GIAI.indexOf("export async function giaiHangCho"), GIAI.indexOf("type Hold ="));
    expect(dem(giai, /proposalIdCuaHangCho\(hold\.detail\)/)).toBe(1);
    expect(dem(giai, /throw new HoaHongError\(\s*"HANG_CHO_CUA_DE_XUAT"/)).toBe(1);
    expect(giai.indexOf("proposalIdCuaHangCho(hold.detail)")).toBeLessThan(giai.indexOf('if (i.quyetDinh === "GIU_NGUYEN") return giuNguyen('));
    expect(giai.indexOf("proposalIdCuaHangCho(hold.detail)")).toBeLessThan(giai.indexOf("return hold.code === \"INPUT_DRIFT\""));
  });

  it("`apDungInputDrift` hỏi `deXuatDoiNguonKetThucKhongGhi(tx, …)` MỘT lần, bằng giao dịch đang giữ khoá, SAU khi tính chênh lệch và TRƯỚC phép ghi đầu tiên; đề xuất STALE lẫn REJECTED", () => {
    expect(dem(AP_DUNG, /deXuatDoiNguonKetThucKhongGhi\(tx, slot\.id\)/)).toBe(1);
    const cong = AP_DUNG.indexOf("deXuatDoiNguonKetThucKhongGhi(tx, slot.id)");
    expect(cong).toBeGreaterThan(AP_DUNG.indexOf("const chenh = tinhChenhTheoNguoi("));
    expect(cong).toBeLessThan(AP_DUNG.indexOf("h.khoaKyDeGhi("));
    expect(cong).toBeLessThan(AP_DUNG.indexOf("ghiChenhLech("));
    expect(dem(GIAI, /status: \{ in: \["STALE", "REJECTED"\] \}/)).toBe(1);
    expect(AP_DUNG).toMatch(/tachChenhDoiNguon\(chenh, vaiAcq\)\.deXuat\.length > 0/);
    expect(AP_DUNG).toMatch(/"HANG_CHO_SAU_DE_XUAT_KHONG_GHI"/);
  });

  it("[DXD-W10] cổng 'đổi nguồn chưa qua duyệt' (rà vòng 2, RVX-C): hỏi sự kiện của lead bằng giao dịch đang giữ khoá, SAU khi tính chênh và TRƯỚC phép ghi đầu tiên, chỉ khi chênh còn phần do nguồn; không phụ thuộc việc hàng chờ có nhãn", () => {
    expect(dem(AP_DUNG, /suKienDoiNguonChuaXongCuaO\(tx, /)).toBe(1);
    const cong = AP_DUNG.indexOf("suKienDoiNguonChuaXongCuaO(tx, ");
    expect(cong).toBeGreaterThan(AP_DUNG.indexOf("const chenh = tinhChenhTheoNguoi("));
    expect(cong).toBeLessThan(AP_DUNG.indexOf("h.khoaKyDeGhi("));
    expect(cong).toBeLessThan(AP_DUNG.indexOf("ghiChenhLech("));
    expect(dem(AP_DUNG, /tachChenhDoiNguon\(/)).toBe(1); // MỘT lần phân loại phần do nguồn cho cả hai cổng
    // cổng nằm TRONG nhánh "còn phần do nguồn": ngay sau điều kiện `deXuat.length > 0`, không nằm ngoài
    expect(AP_DUNG.indexOf("tachChenhDoiNguon(")).toBeLessThan(cong);
    expect(AP_DUNG).toMatch(/"HANG_CHO_DOI_NGUON_CHUA_QUA_DUYET"/);
    // người gọi truyền lead của KHOẢN (đọc từ DB), không lấy từ chi tiết hàng chờ (hàng chờ thường không mang dấu vết nào)
    expect(AP_DUNG).toMatch(/leadId: p\.order\.leadId/);
    expect(AP_DUNG).not.toMatch(/hold\.detail/);
  });

  it("[DXD-W11] hai đầu của sự kiện đổi nguồn khớp nhau: tên sự kiện giải hàng chờ tra == tên `doiNguonLead` phát, và payload mang `leadId` (đường lọc `path: [\"leadId\"]`)", () => {
    const phat = boChuThich(doc("lib/nguon/doi-nguon-lead.ts"));
    const tra = GIAI.match(/const SU_KIEN_DOI_NGUON_SAU_THU = "([^"]+)"/)?.[1];
    expect(tra).toBeTruthy();
    expect(dem(phat, new RegExp(String.raw`publishEvent\(\s*"` + (tra ?? "?").replace(/\./g, String.raw`\.`) + `"`))).toBe(1);
    expect(phat).toMatch(/leadId: p\.leadId,/);
    expect(GIAI).toMatch(/payloadJson: \{ path: \["leadId"\], equals: i\.leadId \}/);
    // sự kiện FAILED được giải bằng đề xuất của đường khác (`audit:<id>`) nên câu tra đề xuất lấy TẤT CẢ đề xuất đổi nguồn của ô, kèm `createdAt` cho phép so mốc (không lọc theo id sự kiện)
    expect(dem(GIAI, /where: \{ calcSlotId: i\.calcSlotId, origin: "SOURCE_CHANGE" \},\s*select: \{ refEventId: true, status: true, createdAt: true \}/)).toBe(1);
    expect(GIAI).toMatch(/select: \{ id: true, status: true, createdAt: true \}/);
  });
});
