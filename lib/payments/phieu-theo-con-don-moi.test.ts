// lib/payments/phieu-theo-con-don-moi.test.ts — [PTC-*] luật THUẦN của "mỗi con một khoản phải thu" + LƯỚI GHIM DÂY NỐI.
//
// Phần đầu khẳng định HÀNH VI của các hàm thuần. Phần sau ghim những chỗ test hành vi không với tới (action chạm DB, UI): neo vào LỜI GỌI + số lần khớp,
// không neo vào cách đặt chữ (bài học `[NDC-07]`). Hành vi đầu-cuối trên Postgres thật: `tests/finance/don-pham-vi-db.test.ts` `[PTD-01..06]`.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gomTienTheoCon, nenTachPhieuTheoCon, phieuMotLanTheoCon } from "./phieu-theo-con-don-moi";

const du = { kieu: "SCOPE", soDong: 2, phiShip: 0, flexBat: true } as const;

describe("[PTC] nenTachPhieuTheoCon / phieuMotLanTheoCon / gomTienTheoCon", () => {
  it("[PTC-01] chỉ tách khi ĐỦ bốn điều kiện: SCOPE · thu linh hoạt bật · từ 2 dòng · không phí ship", () => {
    expect(nenTachPhieuTheoCon(du)).toBe(true);
    expect(nenTachPhieuTheoCon({ ...du, kieu: "LEGACY" })).toBe(false);
    expect(nenTachPhieuTheoCon({ ...du, flexBat: false })).toBe(false);
    expect(nenTachPhieuTheoCon({ ...du, soDong: 1 })).toBe(false);
    expect(nenTachPhieuTheoCon({ ...du, phiShip: 30_000 })).toBe(false);
    expect(nenTachPhieuTheoCon({ ...du, soDong: 3 })).toBe(true);
  });

  it("[PTC-02] mỗi dòng một phiếu đợt 1, đúng thành tiền, sortOrder tăng theo thứ tự dòng; dòng 0đ không có phiếu nhưng vẫn chiếm vị trí", () => {
    const p = phieuMotLanTheoCon(
      [
        { orderItemId: "a", thanhTien: 5_016_000 },
        { orderItemId: "x", thanhTien: 0 },
        { orderItemId: "b", thanhTien: 8_640_000 },
      ],
      13_656_000,
    );
    expect(p.map((f) => [f.orderItemId, f.installmentNo, f.amountDue])).toEqual([["a", 1, 5_016_000], ["b", 1, 8_640_000]]);
    expect(p[0]!.sortOrder).toBeLessThan(p[1]!.sortOrder);
    // dòng 0đ chiếm vị trí 1 ⇒ con b ở vị trí 2: thêm/bớt dòng 0đ không đảo thứ tự rót của các con còn lại
    const khac = phieuMotLanTheoCon([{ orderItemId: "a", thanhTien: 5_016_000 }, { orderItemId: "b", thanhTien: 8_640_000 }], 13_656_000);
    expect(khac[1]!.sortOrder).toBeLessThan(p[1]!.sortOrder);
  });

  it("[PTC-03] CỔNG TIỀN: Σ phiếu ≠ tổng đơn ⇒ NÉM (giao dịch tạo đơn rollback), thành tiền âm/NaN ⇒ NÉM", () => {
    const hai = [{ orderItemId: "a", thanhTien: 5_000_000 }, { orderItemId: "b", thanhTien: 8_000_000 }];
    expect(() => phieuMotLanTheoCon(hai, 13_000_001)).toThrow(/không khớp tổng đơn/);
    expect(() => phieuMotLanTheoCon(hai, 12_999_999)).toThrow(/không khớp tổng đơn/);
    expect(() => phieuMotLanTheoCon([{ orderItemId: "a", thanhTien: -1 }], -1)).toThrow(/không hợp lệ/);
    expect(() => phieuMotLanTheoCon([{ orderItemId: "a", thanhTien: Number.NaN }], 0)).toThrow(/không hợp lệ/);
    expect(phieuMotLanTheoCon(hai, 13_000_000)).toHaveLength(2);
  });

  it("[PTC-04] gomTienTheoCon: gộp theo con; MỘT dòng rơi vào phiếu không thuộc con nào (đơn kiểu cũ) ⇒ null để người gọi giữ đường cũ; không dòng ⇒ null", () => {
    const con = new Map<string, string | null>([["p1", "a"], ["p2", "b"], ["p3", "a"], ["pc", null]]);
    expect(gomTienTheoCon([{ paymentRequestId: "p1", amount: 100 }, { paymentRequestId: "p2", amount: 50 }, { paymentRequestId: "p3", amount: 7 }], con)).toEqual(
      new Map([["a", 107], ["b", 50]]),
    );
    expect(gomTienTheoCon([{ paymentRequestId: "p1", amount: 100 }, { paymentRequestId: "pc", amount: 5 }], con)).toBeNull();
    expect(gomTienTheoCon([{ paymentRequestId: "khong-co", amount: 5 }], con)).toBeNull();
    expect(gomTienTheoCon([], con)).toBeNull();
  });
});

const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
/** Bỏ dòng chú thích trước khi đếm (luật 11): khối giải thích bản vá chứa đúng chuỗi đang canh. */
const boChuThich = (s: string) => s.split("\n").filter((d) => !["//", "/*", "*"].some((dau) => d.trim().startsWith(dau))).join("\n");
const dem = (s: string, ct: string) => s.split(ct).length - 1;

describe("[PTC-W] lưới ghim dây nối", () => {
  const ACTIONS = boChuThich(doc("app/(admin)/admin/orders/_actions.ts"));
  const INGEST = boChuThich(doc("lib/payments/payos-ingest.ts"));
  const GHI_TIEN = boChuThich(doc("lib/finance/ghi-tien-don.ts"));
  const MIEN_GIAM = boChuThich(doc("lib/finance/mien-giam-db.ts"));
  const LIB = boChuThich(doc("lib/payments/phieu-theo-con-don-moi.ts"));
  const UI = boChuThich(doc("app/(admin)/admin/orders/_components/cong-no-theo-con.tsx"));

  it("[PTC-W1] tạo đơn: quyết định ngoài giao dịch bằng pv.kieu; nhánh tách thay HẲN ensureFullOrderRequest; _actions không tự ghi PaymentRequest", () => {
    expect(dem(ACTIONS, "coNenTachPhieuTheoCon({ kieu: pv.kieu,")).toBe(1);
    expect(dem(ACTIONS, "if (tachTheoCon) {")).toBe(1);
    const nhanh = ACTIONS.slice(ACTIONS.indexOf("if (tachTheoCon) {"));
    expect(nhanh.indexOf("taoPhieuTheoConChoDonMoi(tx,")).toBeGreaterThan(-1);
    expect(nhanh.indexOf("taoPhieuTheoConChoDonMoi(tx,")).toBeLessThan(nhanh.indexOf("} else {"));
    expect(nhanh.slice(nhanh.indexOf("} else {"), nhanh.indexOf("} else {") + 120)).toContain("ensureFullOrderRequest(tx,");
    expect(ACTIONS).not.toContain("paymentRequest.create(");
    // thành tiền lấy từ số máy chủ tính (tien.dong), KHÔNG từ client
    expect(ACTIONS).toContain("thanhTien: d.thanhTien");
  });

  it("[PTC-W2] bốn điều kiện nằm ở MỘT hàm; cờ đọc bằng laThuTienLinhHoatBat và so === true (một giá trị truthy lạ không thành 'bật')", () => {
    expect(LIB).toContain('return p.kieu === "SCOPE" && p.flexBat && p.soDong >= 2 && p.phiShip === 0;');
    expect(LIB).toContain("(await laThuTienLinhHoatBat(p.orgUnitId)) === true");
  });

  it("[PTC-W3] webhook/gắn tay: nhánh theo con dùng gomTienTheoCon trên CHÍNH các dòng phân bổ, đứng TRƯỚC đường cũ; giữ MỘT paidDate", () => {
    const tu = INGEST.indexOf("export async function allocateToOrder");
    const khoi = INGEST.slice(tu);
    expect(dem(khoi, "gomTienTheoCon(plan.lines,")).toBe(1);
    expect(dem(khoi, "ghiPaymentTheoCon(tx,")).toBe(1);
    expect(khoi.indexOf("gomTienTheoCon(plan.lines,")).toBeLessThan(khoi.indexOf("chonGhiDanhChoKhoan("));
    expect(khoi).toContain("if (!daGhiSoCu && congTheoCon) {");
    expect(khoi).toContain("} else if (!daGhiSoCu) {");
    expect(dem(khoi, "paidDate:")).toBe(1);
  });

  it("[PTC-W4] huỷ khoản của một con: cổng SCOPE đứng TRƯỚC phép ghi đầu tiên (luật rollback) và trước kiemHuyDot", () => {
    const tu = GHI_TIEN.indexOf("export async function huyDotChoCon");
    const khoi = GHI_TIEN.slice(tu);
    const cong = khoi.indexOf("if (laDonPhamVi(dongDon)) return { ok: false as const, error: LY_DO_DON_PHAM_VI_KHONG_HUY_KHOAN };");
    expect(cong).toBeGreaterThan(-1);
    expect(cong).toBeLessThan(khoi.indexOf("kiemHuyDot("));
    expect(cong).toBeLessThan(khoi.indexOf("tx.paymentRequest.update("));
  });

  it("[PTC-W5] miễn giảm dựng lại phiếu GIỮ vị trí rót của phiếu cũ (không về sortOrder = 0 và chen đầu hàng rót)", () => {
    expect(dem(MIEN_GIAM, "sortOrder: true,")).toBe(1);
    expect(dem(MIEN_GIAM, "sortOrder: phieuTho.find((x) => x.id === d.id)?.sortOrder ?? 0,")).toBe(1);
  });

  it("[PTC-W6] màn công nợ: đơn phạm vi không vẽ nút huỷ khoản; có nút chọn hết khoản chưa đóng để in MỘT QR", () => {
    expect(UI).toContain("{duocSua && d.daRot === 0 && !donPhamVi && (");
    expect(UI).toContain("choPhepChon && donPhamVi && chon.length === 0");
    expect(UI).toContain("datChon(so.con.flatMap((c) => c.dotDangMo.map((d) => d.id)))");
  });
});
