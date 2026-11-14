// [COC-*] — LÕI THUẦN của «tiền cọc không phải doanh thu cho tới khi trả đủ» (`doanh-thu-coc.ts`). Không DB.
import { describe, expect, it } from "vitest";
import { dieuKienDoanhThu, phanLoaiDonCoc, type DonCoc } from "./doanh-thu-coc";

const D = (s: string) => new Date(`${s}T03:00:00.000Z`);
const nk = (orderId: string, soTien: number | null, ngay = "2026-10-10") => ({ orderId, soTien, createdAt: D(ngay) });
const phieu = (orderId: string, installmentNo: number, amountDue: number, status = "PENDING") => ({ orderId, installmentNo, amountDue, status });
const don = (id: string, status: string, paidAt: Date | null = null, deletedAt: Date | null = null) => ({ id, status, paidAt, deletedAt });

describe("[COC-00] phanLoaiDonCoc — cờ cọc = nhật ký THU_TRUOC_TAO + phiếu đợt 1 còn sống khớp số cọc", () => {
  it("[COC-00a] ca chuẩn: bấm Thu trước 3tr, phiếu đợt 1 = 3tr ⇒ đơn cọc, chưa trả đủ", () => {
    const r = phanLoaiDonCoc({ nhatKy: [nk("o1", 3_000_000)], phieu: [phieu("o1", 1, 3_000_000), phieu("o1", 2, 7_752_000)], don: [don("o1", "PENDING_PAYMENT")] });
    expect(r.get("o1")).toEqual({ orderId: "o1", daTraDu: false, ngayTraDu: null });
  });

  it("[COC-00b] đơn đã CONFIRMED có paidAt ⇒ trả đủ, ngày = paidAt (ngày doanh thu của đơn cọc)", () => {
    const paidAt = D("2026-11-20");
    const r = phanLoaiDonCoc({ nhatKy: [nk("o1", 3_000_000)], phieu: [phieu("o1", 1, 3_000_000, "PAID")], don: [don("o1", "CONFIRMED", paidAt)] });
    expect(r.get("o1")).toEqual({ orderId: "o1", daTraDu: true, ngayTraDu: paidAt });
  });

  it.each([
    ["[COC-00c] KHÔNG nhật ký ⇒ không phải cọc (kế hoạch ĐỢT CŨ vẫn là doanh thu theo khoản — BGĐ 02/11)", { nhatKy: [], phieu: [phieu("o1", 1, 3_000_000), phieu("o1", 2, 7_000_000)], don: [don("o1", "PENDING_PAYMENT")] }],
    ["[COC-00d] nhật ký nhưng phiếu đợt 1 đã VOID (huỷ phiếu / từ chối kế hoạch) ⇒ không phải cọc", { nhatKy: [nk("o1", 3_000_000)], phieu: [phieu("o1", 1, 3_000_000, "VOID")], don: [don("o1", "PENDING_PAYMENT")] }],
    ["[COC-00e] nhật ký nói 3tr nhưng phiếu đợt 1 là 2tr ⇒ hai nguồn lệch ⇒ không phải cọc (không giữ tiền oan)", { nhatKy: [nk("o1", 3_000_000)], phieu: [phieu("o1", 1, 2_000_000)], don: [don("o1", "PENDING_PAYMENT")] }],
    ["[COC-00f] nhật ký thiếu / hỏng soTien ⇒ không phải cọc", { nhatKy: [nk("o1", null)], phieu: [phieu("o1", 1, 3_000_000)], don: [don("o1", "PENDING_PAYMENT")] }],
    ["[COC-00g] đơn đã xoá ⇒ bỏ", { nhatKy: [nk("o1", 3_000_000)], phieu: [phieu("o1", 1, 3_000_000)], don: [don("o1", "PENDING_PAYMENT", null, D("2026-10-11"))] }],
    ["[COC-00h] chỉ có phiếu đợt 2 khớp số, đợt 1 không ⇒ không phải cọc", { nhatKy: [nk("o1", 7_752_000)], phieu: [phieu("o1", 1, 3_000_000), phieu("o1", 2, 7_752_000)], don: [don("o1", "PENDING_PAYMENT")] }],
  ])("%s", (_ten, v) => {
    expect(phanLoaiDonCoc(v).has("o1")).toBe(false);
  });

  it("[COC-00i] bấm Thu trước LẠI (số cũ không còn nghĩa): lấy lần MỚI NHẤT", () => {
    const r = phanLoaiDonCoc({ nhatKy: [nk("o1", 3_000_000, "2026-10-10"), nk("o1", 4_000_000, "2026-10-15")], phieu: [phieu("o1", 1, 4_000_000)], don: [don("o1", "PENDING_PAYMENT")] });
    expect(r.has("o1")).toBe(true);
  });

  it("[COC-00j] đơn CONFIRMED nhưng paidAt rỗng, hoặc paidAt có mà đơn bị huỷ / hoàn ⇒ KHÔNG coi là trả đủ (giữ tiền, đếm thiếu)", () => {
    const a = phanLoaiDonCoc({ nhatKy: [nk("o1", 3_000_000)], phieu: [phieu("o1", 1, 3_000_000)], don: [don("o1", "CONFIRMED", null)] });
    const b = phanLoaiDonCoc({ nhatKy: [nk("o1", 3_000_000)], phieu: [phieu("o1", 1, 3_000_000)], don: [don("o1", "CANCELLED", D("2026-11-20"))] });
    expect(a.get("o1")?.daTraDu).toBe(false);
    expect(b.get("o1")?.daTraDu).toBe(false);
  });
});

describe("[COC-01] dieuKienDoanhThu — dựng điều kiện truy vấn", () => {
  const coc = new Map<string, DonCoc>([
    ["giu", { orderId: "giu", daTraDu: false, ngayTraDu: null }],
    ["du-t11", { orderId: "du-t11", daTraDu: true, ngayTraDu: D("2026-11-20") }],
    ["du-t10", { orderId: "du-t10", daTraDu: true, ngayTraDu: D("2026-10-20") }],
  ]);

  it("[COC-01a] có cửa sổ: nhánh tiền thường LOẠI MỌI đơn cọc; nhánh cọc chỉ lấy đơn trả đủ trong cửa sổ", () => {
    const { where, ngayTraDuTheoDon } = dieuKienDoanhThu(coc, { tu: D("2026-11-01"), den: D("2026-11-30") });
    const [, khoang] = (where as { AND: [unknown, { OR: [{ orderId: { notIn: string[] } }, { orderId: { in: string[] } }] }] }).AND;
    expect(khoang.OR[0].orderId.notIn.sort()).toEqual(["du-t10", "du-t11", "giu"]);
    expect(khoang.OR[1]).toEqual({ orderId: { in: ["du-t11"] } }); // du-t10 trả đủ tháng 10 ⇒ không vào báo cáo tháng 11
    expect([...ngayTraDuTheoDon.keys()].sort()).toEqual(["du-t10", "du-t11"]);
  });

  it("[COC-01b] không cửa sổ (ROAS): chỉ loại đơn CỌC chưa trả đủ", () => {
    const { where } = dieuKienDoanhThu(coc, null);
    expect(JSON.stringify(where)).toContain(JSON.stringify({ notIn: ["giu"] }).slice(1, -1));
  });

  it("[COC-01c] không có đơn cọc nào ⇒ hành vi cũ (notIn rỗng)", () => {
    const { where, ngayTraDuTheoDon } = dieuKienDoanhThu(new Map(), { tu: D("2026-11-01"), den: D("2026-11-30") });
    expect(ngayTraDuTheoDon.size).toBe(0);
    expect(JSON.stringify(where)).toContain('"notIn":[]');
  });
});
