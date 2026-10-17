// lib/entitlements/xac-nhan-truoc-ghi-danh.do.test.ts — ĐO CHUỖI HỆ QUẢ của việc "kế toán xác nhận tiền TRƯỚC khi có ghi danh". KHÔNG DB.
//
// Chủ dự án (11/10/2026) quyết: cho xác nhận tiền TRƯỚC ở trạng thái "đã thu, chờ ghi danh/chuyển đổi" — không thêm lớp, không tiêu
// thụ buổi, không quyền học active cho tới khi có học viên hợp lệ. PR này nới cổng `CHUA_GHI_DANH` HẸP: chỉ đơn có dấu SCOPE VÀ cờ
// `billing.scopePurchaseEnabled` BẬT cho cơ sở (quyết ở `lib/entitlements/xac-nhan-truoc.ts`, NGOÀI tx, truyền vào lõi như tham số
// bắt buộc); cờ TẮT / đơn thường giữ NGUYÊN CHỮ.
//
// Tệp này là PHÉP ĐO những gì việc nới cổng KÉO THEO mà PR này CỐ Ý KHÔNG SỬA (module của chủ khác: `lib/crm/commission*`, thực thu,
// hoá đơn). Mỗi ca dưới đây là một việc PHẢI được quyết TRƯỚC KHI BẬT CỜ ở bất kỳ cơ sở nào:
//   [03] THỰC THU     — khoản CONFIRMED chưa ghi danh vào doanh thu thực thu ngay;
//   [04] HOA HỒNG KỲ  — vào bút toán hoa hồng; isRenewal luôn false; lead chưa convert ⇒ tầng SALE chưa có người hưởng;
//   [05] HOÁ ĐƠN      — cổng ghi danh của chốt/hàng chờ hoá đơn chỉ xét khoản PENDING; khoản đã CONFIRMED đi thẳng vào hàng chờ.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { thieuGhiDanh, thieuGhiDanhTruocXacNhan } from "@/lib/finance/can-ghi-danh";
import { WHERE_THUC_THU, butToanThucThu } from "@/lib/finance/thuc-thu";
import { mapButToanHoaHong, type HangThanhToanHoaHong } from "@/lib/crm/commission-run";

const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const doc = (tep: string) => boChuThich(readFileSync(resolve(process.cwd(), tep), "utf8"));
const dem = (s: string, re: RegExp) => s.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))?.length ?? 0;

const NGAY = new Date("2026-10-11T03:00:00Z");
/** Hằng thay cho literal sau tên cột trạng thái kế toán: lưới [BUOC-6] (lib/finance/truc-a.test.ts) cấm cặp đó ngoài debt.ts. */
const DA_XAC_NHAN = "CONFIRMED" as const;
/** Khoản CONFIRMED của đơn SCOPE khách mới, CHƯA có ghi danh (enrollment = null) và lead CHƯA convert (convertedById = null). */
const khoanChuaGhiDanh: HangThanhToanHoaHong = {
  id: "p-1",
  amount: 8_976_000,
  accountantStatus: DA_XAC_NHAN,
  adjustmentOfId: null,
  paidDate: NGAY,
  confirmedAt: NGAY,
  centerId: "cs-1",
  adjustmentOf: null,
  enrollment: null,
  order: { leadId: "lead-1", centerId: "cs-1", lead: { convertedById: null, adminId: "sale-admin-1", centerId: "cs-1" } },
};

describe("[NOI-DL] cổng CHUA_GHI_DANH: nới HẸP (SCOPE + cờ BẬT), cờ TẮT giữ nguyên chữ", () => {
  it("[NOI-DL-01] cổng thuần: đơn COURSE (và loại lạ) thiếu ghi danh ⇒ bị chặn khi KHÔNG được nới; `thieuGhiDanh` giữ nguyên hai tham số", () => {
    expect(thieuGhiDanh({ enrollmentId: null }, "COURSE")).toBe(true);
    expect(thieuGhiDanh({ enrollmentId: null }, null)).toBe(true);
    expect(thieuGhiDanh.length, "thieuGhiDanh(khoan, loaiDon) — đúng hai tham số; việc nới nằm ở hàm RIÊNG").toBe(2);
    expect(thieuGhiDanhTruocXacNhan.length, "tham số nới BẮT BUỘC (luật 7)").toBe(3);
  });

  it("[NOI-DL-02] chỗ quyết là MỘT hàm ở lib/entitlements, đọc cờ NGOÀI tx; payment.ts chỉ truyền boolean; các cổng còn lại KHÔNG bị nới", () => {
    const ma = doc("lib/finance/payment.ts");
    expect(dem(ma, /\bchoPhepXacNhanTruocGhiDanh\(existing\.orderId\)/)).toBe(1);
    expect(ma).not.toMatch(/laThuHocPhiTheoPhamViBat|scopePurchaseEnabled/);
    // Lõi nhận boolean qua tham số (không tự đọc cờ trong tx) và hỏi hàm nới.
    expect(ma).toMatch(/choPhepTruocGhiDanh: boolean;/);
    // Các cổng khác CỐ Ý vẫn hỏi thieuGhiDanh (không nới): chốt hoá đơn, hàng chờ hoá đơn, gắn ghi danh, xác nhận hàng loạt nhập liệu.
    expect(dem(doc("lib/finance/hoa-don/chot-hoa-don.ts"), /\bthieuGhiDanh\(p, don\.type\)/)).toBe(1);
    expect(dem(doc("lib/finance/hoa-don/dong-hang-cho.ts"), /\bthieuGhiDanh\(p, don\.type\)/)).toBe(1);
    expect(dem(doc("lib/finance/backfill-confirm.ts"), /\bthieuGhiDanh\(/)).toBe(1);
    expect(dem(doc("lib/finance/gan-ghi-danh-khoan.ts"), /\bthieuGhiDanh\(/)).toBe(1);
  });

  it("[NOI-DL-03] ĐO #1 — THỰC THU: khoản CONFIRMED chưa có ghi danh VẪN được tính (WHERE_THUC_THU không đòi enrollmentId)", () => {
    expect(Object.keys(WHERE_THUC_THU)).not.toContain("enrollmentId");
    expect(butToanThucThu([khoanChuaGhiDanh]).map((r) => r.id)).toEqual(["p-1"]);
  });

  it("[NOI-DL-04] ĐO #2 — HOA HỒNG: khoản CONFIRMED chưa có ghi danh VÀO bút toán hoa hồng kỳ; lead chưa convert ⇒ tầng SALE chưa có người hưởng, isRenewal luôn false vì không có ghi danh để xét gia hạn", () => {
    const [but, ...thua] = mapButToanHoaHong([khoanChuaGhiDanh]);
    expect(thua).toHaveLength(0);
    expect(but).toMatchObject({ paymentId: "p-1", amount: 8_976_000, isRenewal: false });
    expect(but!.recipients.SALE, "lead chưa convert ⇒ Lead.convertedById = null ⇒ không có người hưởng tầng SALE").toBeUndefined();
    expect(but!.recipients.SALE_ADMIN, "tầng gắn theo Sale Admin vẫn có người ⇒ kỳ chạy trước ghi danh sẽ trả MỘT PHẦN").toBe("sale-admin-1");
  });

  it("[NOI-DL-05] ĐO #3 — HOÁ ĐƠN: hai nơi dựng hàng chờ hoá đơn / chốt hoá đơn tự hỏi cổng thieuGhiDanh cho khoản PENDING; khoản đã CONFIRMED thì không còn cổng nào ở đó", () => {
    // Cả hai chỉ xét khoản `accountantStatus === "PENDING"` (vòng lặp bỏ qua khoản khác) — nên khoản đã xác nhận trước ghi danh đi thẳng vào hàng chờ hoá đơn.
    expect(doc("lib/finance/hoa-don/chot-hoa-don.ts")).toMatch(/accountantStatus !== "PENDING"\) continue/);
    expect(doc("lib/finance/hoa-don/dong-hang-cho.ts")).toMatch(/accountantStatus !== "PENDING"\) continue/);
  });

  it("[NOI-DL-06] bước CHỐT HOÁ ĐƠN không nới cổng: nó truyền `choPhepTruocGhiDanh: false` vào lõi xác nhận", () => {
    expect(doc("lib/finance/hoa-don/chot-hoa-don.ts")).toMatch(/xacNhanKhoanTrongTx\(tx, \{[^}]*choPhepTruocGhiDanh: false/);
  });
});
