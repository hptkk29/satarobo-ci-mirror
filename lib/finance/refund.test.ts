// W3-1 / LMS-9 — computeRefund (THUẦN). Pure: Σ confirmed − buổi đã học × đơn giá, clamp ≥0.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect } from "vitest";
import { computeRefund } from "@/lib/finance/refund";

describe("[W3-1] computeRefund", () => {
  it("đơn giá = round(finalPrice / sessionsTotal)", () => {
    expect(
      computeRefund({
        paidConfirmed: 0,
        finalPrice: 9_000_000,
        sessionsTotal: 24,
        sessionsLearned: 0,
      }).unitPrice,
    ).toBe(375_000);
    // làm tròn
    expect(
      computeRefund({
        paidConfirmed: 0,
        finalPrice: 1_000_000,
        sessionsTotal: 3,
        sessionsLearned: 0,
      }).unitPrice,
    ).toBe(333_333);
  });

  it("chưa học buổi nào → hoàn ≈ đã đóng", () => {
    const r = computeRefund({
      paidConfirmed: 9_000_000,
      finalPrice: 9_000_000,
      sessionsTotal: 24,
      sessionsLearned: 0,
    });
    expect(r.proposedAmount).toBe(9_000_000);
  });

  it("học giữa khoá → hoàn = đã đóng − buổi học × đơn giá", () => {
    // 9tr / 24 buổi = 375k. Đã đóng 9tr, học 8 buổi → 9tr − 8×375k = 6tr.
    const r = computeRefund({
      paidConfirmed: 9_000_000,
      finalPrice: 9_000_000,
      sessionsTotal: 24,
      sessionsLearned: 8,
    });
    expect(r.unitPrice).toBe(375_000);
    expect(r.proposedAmount).toBe(6_000_000);
  });

  it("học hết → hoàn 0", () => {
    const r = computeRefund({
      paidConfirmed: 9_000_000,
      finalPrice: 9_000_000,
      sessionsTotal: 24,
      sessionsLearned: 24,
    });
    expect(r.proposedAmount).toBe(0);
  });

  it("clamp ≥ 0 (học quá số buổi / đóng thiếu)", () => {
    const r = computeRefund({
      paidConfirmed: 1_000_000,
      finalPrice: 9_000_000,
      sessionsTotal: 24,
      sessionsLearned: 24,
    });
    expect(r.proposedAmount).toBe(0);
  });

  it("sessionsTotal = 0 → đơn giá 0, hoàn = đã đóng", () => {
    const r = computeRefund({
      paidConfirmed: 2_000_000,
      finalPrice: 9_000_000,
      sessionsTotal: 0,
      sessionsLearned: 0,
    });
    expect(r.unitPrice).toBe(0);
    expect(r.proposedAmount).toBe(2_000_000);
  });
});

// ── Lưới sổ buổi chưa chốt (14/09/2026) ──────────────────────────────────────
//
// THAY CHO cầu dao `REFUND_REQUEST_DISABLED` (sống 08/09 → 14/09). Cầu dao tắt HẲN tính
// năng vì MỘT ca cụ thể: `sessionsLearned` đếm `status = COMPLETED`, mà `status` không
// phản ánh thực tế đã dạy ⇒ lớp đã dạy gần hết vẫn đọc ra 0 buổi ⇒ đề xuất hoàn 100%.
//
// Nay ca đó bị chặn TẠI GỐC bởi `canhBaoSoBuoi`, nên tính năng mở lại được. Bộ ca dưới
// khoá đúng ba thứ bộ ca cầu dao từng khoá: lưới nằm ở CỬA DUY NHẤT, nó trả `null` chứ
// không ném, và mỗi lần chặn đều để lại dấu.
const doc = (f: string) => readFileSync(join(__dirname, f), "utf8");

describe("lưới sổ buổi chưa chốt", () => {
  it("chặn ở createRefundRequest — cửa DUY NHẤT, không rải ở từng caller", () => {
    const src = doc("refund.ts");
    const iLuoi = src.indexOf("canhBaoSoBuoi(");
    const iGhi = src.indexOf("refundRequest.create");
    // ⚠️ PHẢI khẳng định TÌM THẤY trước khi so vị trí. `indexOf` trả -1 khi không thấy,
    // và -1 < mọi vị trí ⇒ xoá sạch lời gọi lưới thì phép so vẫn ĐÚNG. Bước cấy lỗi của
    // LƯỚI GHIM MÃ NGUỒN bắt đúng lỗ này: đổi tên hàm đi mà ca vẫn xanh.
    expect(iLuoi, "không thấy lời gọi canhBaoSoBuoi(").toBeGreaterThanOrEqual(0);
    expect(iGhi, "không thấy refundRequest.create").toBeGreaterThanOrEqual(0);
    // Lưới đứng SAU khi đã đếm buổi (nó cần chính con số đó) nhưng TRƯỚC khi tạo bản ghi.
    expect(iLuoi).toBeLessThan(iGhi);
  });

  it("trả null chứ KHÔNG ném — hàm chạy trong transaction gỡ học viên", () => {
    // Ném ở đây là cuộn ngược cả việc gỡ: "không đề xuất được tiền" biến thành "không gỡ
    // được học viên". Giữ nguyên quyết định của bản cầu dao.
    const src = doc("refund.ts");
    const than = src.slice(
      src.indexOf("if (!canhBao.choDeXuat)"),
      src.indexOf("const finalPrice"),
    );
    expect(than).toContain("return null");
    expect(than).not.toContain("throw");
  });

  it("mỗi lần chặn đều để lại dấu trong nhật ký", () => {
    const src = doc("refund.ts");
    const than = src.slice(
      src.indexOf("if (!canhBao.choDeXuat)"),
      src.indexOf("const finalPrice"),
    );
    expect(than).toContain("writeAudit");
    expect(than).toContain("tuChoiDeXuatHoanTien");
  });

  it("cầu dao ĐÃ GỠ — không còn nhánh nào tắt hẳn tính năng", () => {
    // Thay cho ca "cầu dao ĐANG BẬT" của bản trước. Ca này tồn tại để lần sau ai định
    // dựng lại một cầu dao tắt-hẳn thì phải sửa test và đọc lý do ở đây trước.
    //
    // ⚠️ Nhắm vào MÃ CHẠY (`if (...)` + đường import), KHÔNG phải tên hằng: khối chú
    // thích trong `refund.ts` CỐ Ý nhắc tên cũ để người đọc sau tra được lịch sử. Bản
    // đầu của ca này bắt luôn chú thích và báo đỏ giả — đúng họ với luật 11 (test grep
    // mã nguồn là loại mong manh nhất; neo chuỗi HẸP nhất có thể).
    const src = doc("refund.ts");
    expect(src).not.toContain("if (REFUND_REQUEST_DISABLED)");
    expect(src).not.toContain('from "@/lib/finance/cau-dao-hoan-tien"');
  });
});

// Vì sao phải chặn — giữ con số biết nói ngay cạnh lưới.
describe("computeRefund — lý do dựng lưới", () => {
  it("sessionsLearned = 0 vì status chưa đóng ⇒ đề xuất hoàn TOÀN BỘ học phí", () => {
    // Lớp 20 buổi, đã dạy gần hết, phụ huynh đóng đủ 10.000.000.
    // Prod 07/09: 2 COMPLETED / 287 SCHEDULED ⇒ sessionsLearned đọc ra 0.
    const { proposedAmount } = computeRefund({
      paidConfirmed: 10_000_000,
      finalPrice: 10_000_000,
      sessionsTotal: 20,
      sessionsLearned: 0,
    });
    expect(proposedAmount).toBe(10_000_000); // 100% — đây chính là quả bom
  });

  it("cùng lớp đó, nếu status đúng (đã dạy 18/20) thì chỉ hoàn 1.000.000", () => {
    const { proposedAmount } = computeRefund({
      paidConfirmed: 10_000_000,
      finalPrice: 10_000_000,
      sessionsTotal: 20,
      sessionsLearned: 18,
    });
    expect(proposedAmount).toBe(1_000_000);
  });
});
