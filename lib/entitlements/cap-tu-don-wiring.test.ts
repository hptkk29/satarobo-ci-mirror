// lib/entitlements/cap-tu-don-wiring.test.ts — LƯỚI GHIM DÂY NỐI của "tiền xác nhận → cấp quyền học" + hành vi handler. KHÔNG DB.
//
// Hành vi cấp quyền đo trên Postgres ở `tests/finance/quyen-hoc-cap-tu-don.test.ts` (+ `quyen-hoc-noi-duong-tien.test.ts`). Lưới này canh những thứ test hành vi
// KHÔNG chắc bắt được vì nằm ở THỨ TỰ câu lệnh hoặc ở chỗ ĐƯỜNG GỌI (gỡ lời gọi thì không ca hành vi nào đỏ).
//
// Luật 11: neo biểu thức/lời GỌI (không neo chỗ đặt `await`), đếm SỐ LẦN, và chạy trên mã ĐÃ BỎ CHÚ THÍCH (chú thích giải
// thích bản vá chứa đúng chuỗi đang tìm).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockXet = vi.hoisted(() => vi.fn());
vi.mock("./cap-tu-don", () => ({ xetCapQuyenHocChoDon: mockXet }));

import { clearHandlers, getHandlers } from "@/lib/events/registry";
import { orderIdTuPayload, registerCapQuyenHocHandlers, xuLySuKienTienVe } from "./su-kien";

const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const doc = (tep: string) => boChuThich(readFileSync(resolve(process.cwd(), tep), "utf8"));
const dem = (s: string, re: RegExp) => s.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))?.length ?? 0;

const CAP = doc("lib/entitlements/cap-tu-don.ts");
const SK = doc("lib/entitlements/su-kien.ts");
const HICH = doc("lib/entitlements/hich.ts");
const REG = doc("lib/events/register.ts");
/** Phần mã BÊN TRONG callback của `db.$transaction(`. */
const TRONG_TX = CAP.slice(CAP.indexOf("db.$transaction("));

describe("[QHC-W] cap-tu-don.ts — thứ tự cổng và khoá", () => {
  it("[QHC-W1] dấu SCOPE → OrgUnit → cờ → transaction: đúng thứ tự, cờ hỏi đúng MỘT lần, một transaction", () => {
    const iDau = CAP.indexOf("laDonPhamVi(");
    const iOu = CAP.indexOf("orgUnitIdForCenter(");
    const iCo = CAP.indexOf("laThuHocPhiTheoPhamViBat(");
    const iTx = CAP.indexOf("db.$transaction(");
    expect([iDau, iOu, iCo, iTx].every((i) => i > -1)).toBe(true);
    expect(iDau < iOu && iOu < iCo && iCo < iTx).toBe(true);
    expect(dem(CAP, /\blaThuHocPhiTheoPhamViBat\(/)).toBe(1);
    expect(dem(CAP, /\$transaction\(/)).toBe(1);
    // Cờ hỏi bằng OrgUnit, không bằng Center.id (CenterSetting khoá theo OrgUnit.id — hỏi sai thì cờ riêng cơ sở không có tác dụng).
    expect(CAP).toMatch(/laThuHocPhiTheoPhamViBat\(orgUnitId\)/);
  });

  it("[QHC-W2] trong transaction: KHÔNG dùng kết nối gốc `db.`, KHÔNG hỏi cờ / OrgUnit (kết nối thứ hai ⇒ treo bể kết nối)", () => {
    const sauMo = TRONG_TX.slice("db.$transaction(".length);
    expect(sauMo).not.toMatch(/\bdb\./);
    expect(sauMo).not.toMatch(/laThuHocPhiTheoPhamViBat\(|orgUnitIdForCenter\(|getSetting\(/);
  });

  it("[QHC-W3] khoá ĐƠN lấy ĐÚNG MỘT lần, TRƯỚC mọi lần đọc dòng đơn/sổ tiền và TRƯỚC lời cấp", () => {
    expect(dem(TRONG_TX, /\bkhoaDonTrongTx\(tx,/)).toBe(1);
    const iKhoa = TRONG_TX.indexOf("khoaDonTrongTx(tx,");
    for (const sau of [
      "tx.orderItem.findMany(",
      "tx.payment.findMany(",
      "docNganHangThat(tx,",
      "tx.studyEntitlement.findMany(",
      "tx.studyEntitlementXuLy.findMany(",
      "timHocVienChoDong(tx,",
      "daTieuThuBuoi(tx,",
      "capQuyenHocTrongTx(",
    ]) {
      const i = TRONG_TX.indexOf(sau);
      expect({ sau, thay: i > -1 }).toEqual({ sau, thay: true });
      expect({ sau, saukhoa: iKhoa < i }).toEqual({ sau, saukhoa: true });
    }
  });

  it("[QHC-W4] lời cấp: đúng MỘT chỗ, sau vị từ dongDuTien; không truyền hoa hồng / người chốt đơn (thuộc phiên khác)", () => {
    expect(dem(CAP, /\bcapQuyenHocTrongTx\(/)).toBe(1);
    expect(dem(CAP, /\bdongDuTien\(/)).toBe(1);
    expect(CAP.indexOf("dongDuTien(")).toBeLessThan(CAP.indexOf("capQuyenHocTrongTx("));
    expect(CAP).not.toMatch(/closedBySaleId|firstPurchaseSaleId|commission/i);
  });

  it("[QHC-W10] marker ngân hàng được CHỨNG THỰC bằng giao dịch thật, đọc bằng `tx` dưới khoá (không `db.`), một lần, chỉ giao dịch MATCHED, chỉ phân bổ vào CHÍNH đơn này", () => {
    expect(dem(CAP, /\bdocNganHangThat\(tx,/)).toBe(1);
    const i = CAP.indexOf("async function docNganHangThat(");
    expect(i).toBeGreaterThan(-1);
    const than = CAP.slice(i, CAP.indexOf("export async function xetCapQuyenHocChoDon("));
    expect(than).not.toMatch(/\bdb\./);
    expect(dem(than, /\btx\.bankTransaction\.findMany\(/)).toBe(1);
    expect(than).toMatch(/status:\s*"MATCHED"/);
    expect(than).toMatch(/paymentRequest:\s*\{\s*orderId\s*\}/);
    // Hàm thuần nhận bản đồ này là THAM SỐ BẮT BUỘC (luật 7): chỗ gọi nào quên là lỗi biên dịch, không phải tiền ngân hàng bị loại/được tin lặng lẽ.
    expect(CAP).toMatch(/nganHangThat:\s*await docNganHangThat\(tx, orderId, khoan\)/);
  });

  it("[QHC-W5] dung sai 0: vị từ đủ tiền được gọi với `dungSai: 0` (thiếu MỘT đồng là chưa đủ)", () => {
    expect(dem(CAP, /\bdungSai:\s*0\b/)).toBe(1);
  });

  it("[QHC-W6] không tạo sổ tiêu thụ và không phát sự kiện/ghi nhật ký riêng: thanh toán không tiêu thụ buổi nào", () => {
    expect(CAP).not.toMatch(/studyEntitlementUsage|publishEvent\(|writeAudit\(|ghiNhanBai/);
  });
});

describe("[QHC-W] dây nối đường gọi", () => {
  it("[QHC-W7] CHỈ hich.ts (vỏ không ném) gọi xetCapQuyenHocChoDon, đúng một lời gọi; su-kien.ts đi qua vỏ đó", () => {
    let ra: string;
    try {
      ra = execFileSync("git", ["grep", "--untracked", "-l", "-E", "xetCapQuyenHocChoDon\\(", "--", "lib", "app", "components", "scripts"], {
        encoding: "utf8",
      });
    } catch {
      ra = "";
    }
    const tep = ra
      .split("\n")
      .filter(Boolean)
      .map((t) => t.replace(/\\/g, "/"))
      .filter((t) => !/\.test\.tsx?$/.test(t))
      .sort();
    expect(tep).toEqual(["lib/entitlements/cap-tu-don.ts", "lib/entitlements/hich.ts"]);
    expect(dem(HICH, /\bxetCapQuyenHocChoDon\(/)).toBe(1);
    expect(dem(SK, /\bxetCapQuyenHocChoDon\(/)).toBe(0);
    expect(dem(SK, /\bhichCapQuyenHocChoDon\(/)).toBe(1);
  });

  it("[QHC-W8] su-kien.ts nghe ĐÚNG năm sự kiện (2 tiền vào + 3 chiều ngược), mỗi cái một lần, tên LITERAL; register.ts gọi registerCapQuyenHocHandlers đúng một lần", () => {
    for (const ten of ["phieu-gop.da-chia", "payment.confirmed", "payment.rejected", "payment.refunded", "order.voided"]) {
      expect(dem(SK, new RegExp(`\\bon\\("${ten.replace(/\./g, "\\.")}"`)), ten).toBe(1);
    }
    expect(dem(SK, /\bon\(/)).toBe(5);
    expect(dem(REG, /\bregisterCapQuyenHocHandlers\(\)/)).toBe(1);
    // Không SỬA handler của người khác: sau-da-chia.ts / phieu-gop.ts không biết gì về quyền học.
    for (const tep of ["lib/payments/sau-da-chia.ts", "lib/finance/phieu-gop.ts", "lib/_handlers/r7-notifications.ts"]) {
      expect(doc(tep), tep).not.toMatch(/xetCapQuyenHocChoDon|@\/lib\/entitlements/);
    }
  });

  it("[QHC-W9] lõi tiền (payment.ts, ghi-tien-don.ts, phieu-gop.ts, sau-da-chia.ts) KHÔNG tự hích quyền học: cú hích nằm ở tầng action / sau commit, không trong tx đang giữ khoá đơn", () => {
    for (const tep of ["lib/finance/payment.ts", "lib/finance/ghi-tien-don.ts", "lib/finance/phieu-gop.ts", "lib/payments/sau-da-chia.ts"]) {
      expect(doc(tep), tep).not.toMatch(/xetCapQuyenHocChoDon|hichCapQuyenHoc/);
    }
    // Ngoại lệ DUY NHẤT: payment.ts import hàm QUYẾT cổng xác nhận-trước-ghi-danh (đọc cờ NGOÀI tx, truyền boolean vào lõi); không import gì khác của nền.
    for (const tep of ["lib/finance/ghi-tien-don.ts", "lib/finance/phieu-gop.ts", "lib/payments/sau-da-chia.ts"]) {
      expect(doc(tep), tep).not.toMatch(/@\/lib\/entitlements/);
    }
    const imp = doc("lib/finance/payment.ts").match(/@\/lib\/entitlements\/[a-z-]+/g) ?? [];
    expect(imp).toEqual(["@/lib/entitlements/xac-nhan-truoc"]);
  });
});

describe("[QHC-H] handler sự kiện tiền về — KHÔNG BAO GIỜ ném", () => {
  const NOW = new Date("2026-10-11T03:00:00Z");

  beforeEach(() => {
    mockXet.mockReset();
    clearHandlers();
    registerCapQuyenHocHandlers();
  });

  it("[QHC-H1] xét lỗi (DB sập, khoá quá hạn…) ⇒ handler vẫn trả bình thường — dispatcher không thử lại sự kiện", async () => {
    mockXet.mockRejectedValue(new Error("connection reset"));
    for (const type of ["phieu-gop.da-chia", "payment.confirmed"]) {
      const hs = getHandlers(type);
      expect({ type, soHandler: hs.length }).toEqual({ type, soHandler: 1 });
      await expect(hs[0]!({ id: "e1", type, payload: { orderId: "don-1" } })).resolves.toBeUndefined();
    }
    expect(mockXet).toHaveBeenCalledTimes(2);
  });

  it("[QHC-H2] đúng nguồn cho đúng sự kiện", async () => {
    mockXet.mockResolvedValue({ daCap: [] });
    await getHandlers("phieu-gop.da-chia")[0]!({ id: "e1", type: "phieu-gop.da-chia", payload: { orderId: "don-1" } });
    await getHandlers("payment.confirmed")[0]!({ id: "e2", type: "payment.confirmed", payload: { orderId: "don-2", paymentId: "p-1" } });
    expect(mockXet.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      ["don-1", "PHIEU_GOP"],
      ["don-2", "KE_TOAN_XAC_NHAN"],
    ]);
  });

  it("[QHC-H3] payload lạ (thiếu / sai kiểu orderId) ⇒ bỏ qua, không gọi xét, không ném", async () => {
    for (const payload of [{}, { orderId: 5 }, { orderId: "" }, null, "x", []]) {
      await expect(xuLySuKienTienVe(payload, "PHIEU_GOP", NOW)).resolves.toBeUndefined();
    }
    expect(mockXet).not.toHaveBeenCalled();
    expect(orderIdTuPayload({ orderId: "don-9", amount: 1 })).toBe("don-9");
  });

  it("[QHC-H5] CHIỀU NGƯỢC: payment.rejected / payment.refunded / order.voided đều có handler, đúng nguồn, KHÔNG BAO GIỜ ném kể cả khi xét lỗi", async () => {
    mockXet.mockRejectedValue(new Error("connection reset"));
    for (const [type, nguon] of [
      ["payment.rejected", "TIEN_BI_TU_CHOI"],
      ["payment.refunded", "TIEN_BI_HOAN"],
      ["order.voided", "DON_BI_LOAI"],
    ] as const) {
      const hs = getHandlers(type);
      expect({ type, soHandler: hs.length }).toEqual({ type, soHandler: 1 });
      await expect(hs[0]!({ id: "e1", type, payload: { orderId: "don-1" } })).resolves.toBeUndefined();
      // 4 đối số: (đơn, nguồn, đồng hồ, chế độ). Đường tiền hích LUÔN là "CAP"; "CHI_GHI_NHAN" chỉ dành cho cron đối soát (hang-doi-wiring.test.ts [HD-W*]).
      expect(mockXet).toHaveBeenLastCalledWith("don-1", nguon, expect.any(Date), "CAP");
    }
  });

  it("[QHC-H4] truyền đồng hồ vào hàm xét (không để hàm xét tự đọc đồng hồ thật)", async () => {
    mockXet.mockResolvedValue({ daCap: [] });
    await xuLySuKienTienVe({ orderId: "don-1" }, "KE_TOAN_XAC_NHAN", NOW);
    expect(mockXet).toHaveBeenCalledWith("don-1", "KE_TOAN_XAC_NHAN", NOW, "CAP");
  });
});
