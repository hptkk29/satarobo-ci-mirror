// lib/finance/lop-chua-chot-buoi.test.ts — LƯỚI CHẶN ĐỀ XUẤT HOÀN 100% DO SỔ BUỔI CHƯA CHỐT.
//
// Chủ dự án 14/09/2026: "chức năng hoàn tiền: Σ đã thu − số buổi đã học × đơn giá từng buổi".
//
// Công thức đó ĐÃ ĐÚNG SẴN trong `computeRefund`. Thứ đang chặn tính năng là cầu dao
// `REFUND_REQUEST_DISABLED`, và lý do tắt nằm ở `cau-dao-hoan-tien.ts`:
//
//   `sessionsLearned` đếm `ClassSession.status = COMPLETED`. Trên prod, `status` KHÔNG
//   phản ánh thực tế đã dạy — đo 07/09/2026 được 2 buổi COMPLETED / 287 SCHEDULED, trong
//   đó 209 buổi ĐÃ QUA NGÀY mà chưa ai chốt. Với một lớp đã dạy gần hết khoá,
//   `sessionsLearned` vẫn đọc ra 0 ⇒ hệ thống đề xuất hoàn **100% học phí**.
//
// Đo lại 14/09/2026 trên `satarobo_local`: 461 COMPLETED / 148 SCHEDULED, trong đó **82
// buổi đã qua ngày mà chưa chốt**. Vẫn còn nguyên hình dạng nguy hiểm.
//
// ─────────────────────────────────────────────────────────────────────────────
// ĐÂY LÀ ĐIỀU KIỆN GỠ SỐ 2 của cầu dao, viết nguyên văn trong file đó:
//
//   "`createRefundRequest` TỪ CHỐI đề xuất khi lớp có buổi đã qua ngày mà
//    `sessionsLearned = 0` — ném lỗi rõ ràng, KHÔNG lặng lẽ đề xuất 100%."
//
// ⚠️ TỪ CHỐI, KHÔNG TỰ ĐOÁN. Cám dỗ là "đếm buổi đã qua ngày thay cho COMPLETED" — nhưng
// buổi qua ngày chưa chắc đã dạy (giáo viên nghỉ, lớp hoãn), và đoán hộ ở đây là chi tiền
// hoàn theo một con số không ai xác nhận. Việc đúng là dừng lại và bắt người chốt sổ buổi.
import { describe, it, expect } from "vitest";
import { soBuoiChuaChot, canhBaoSoBuoi, MUC_TIN_SO_BUOI } from "./lop-chua-chot-buoi";

const ngay = (lech: number) => new Date(Date.UTC(2026, 8, 14) + lech * 86_400_000);
const MOC = ngay(0);

describe("[LCB-01] đếm buổi ĐÃ QUA NGÀY mà chưa chốt", () => {
  it("buổi quá khứ còn SCHEDULED thì tính", () => {
    const b = [
      { date: ngay(-3), status: "SCHEDULED" },
      { date: ngay(-1), status: "SCHEDULED" },
    ];
    expect(soBuoiChuaChot(b, MOC)).toBe(2);
  });

  it("buổi TƯƠNG LAI không tính — chưa tới thì chưa ai chốt được", () => {
    expect(soBuoiChuaChot([{ date: ngay(3), status: "SCHEDULED" }], MOC)).toBe(0);
  });

  it("buổi HUỶ không tính — nó cố ý không bao giờ COMPLETED", () => {
    expect(soBuoiChuaChot([{ date: ngay(-3), status: "CANCELLED" }], MOC)).toBe(0);
  });

  it("buổi đã COMPLETED không tính", () => {
    expect(soBuoiChuaChot([{ date: ngay(-3), status: "COMPLETED" }], MOC)).toBe(0);
  });

  it("buổi ĐÚNG hôm nay chưa tính là quá hạn — lớp có thể đang học", () => {
    expect(soBuoiChuaChot([{ date: MOC, status: "SCHEDULED" }], MOC)).toBe(0);
  });

  it("danh sách rỗng → 0, không ném", () => {
    expect(soBuoiChuaChot([], MOC)).toBe(0);
  });
});

describe("[LCB-02] mức tin của sổ buổi — quyết định có cho đề xuất hoàn hay không", () => {
  it("KHÔNG buổi nào quá hạn chưa chốt → TIN_DUOC", () => {
    const r = canhBaoSoBuoi({
      soBuoiChuaChot: 0,
      sessionsLearned: 5,
      sessionsTotal: 12,
    });
    expect(r.muc).toBe(MUC_TIN_SO_BUOI.TIN_DUOC);
    expect(r.choDeXuat).toBe(true);
  });

  it("⚠️ CA NGUY HIỂM: có buổi quá hạn chưa chốt VÀ đã học = 0 → CẤM đề xuất", () => {
    // Đây chính là ca làm hệ thống đề xuất hoàn 100% học phí cho một lớp đã dạy gần hết.
    const r = canhBaoSoBuoi({
      soBuoiChuaChot: 10,
      sessionsLearned: 0,
      sessionsTotal: 12,
    });
    expect(r.muc).toBe(MUC_TIN_SO_BUOI.KHONG_TIN_DUOC);
    expect(r.choDeXuat).toBe(false);
    expect(r.lyDo).toContain("chưa chốt");
  });

  it("có buổi quá hạn nhưng đã học > 0 → CHO đề xuất, kèm cảnh báo", () => {
    // Sổ có thể thiếu vài buổi, nhưng KHÔNG rơi vào ca "đọc ra 0 trong khi lớp đã dạy".
    // Chặn cả ca này là chặn mọi lớp đang chạy — tính năng thành vô dụng.
    const r = canhBaoSoBuoi({
      soBuoiChuaChot: 3,
      sessionsLearned: 8,
      sessionsTotal: 12,
    });
    expect(r.muc).toBe(MUC_TIN_SO_BUOI.THIEU_MOT_SO_BUOI);
    expect(r.choDeXuat).toBe(true);
    expect(r.lyDo).toContain("3");
  });

  it("lớp CHƯA có buổi nào quá hạn và chưa học buổi nào → TIN_DUOC", () => {
    // Lớp vừa khai giảng, học viên rút ngay: hoàn gần như toàn bộ là ĐÚNG, không phải bug.
    const r = canhBaoSoBuoi({
      soBuoiChuaChot: 0,
      sessionsLearned: 0,
      sessionsTotal: 12,
    });
    expect(r.muc).toBe(MUC_TIN_SO_BUOI.TIN_DUOC);
    expect(r.choDeXuat).toBe(true);
  });

  it("lý do luôn là câu người thường đọc được, không phải mã", () => {
    for (const x of [
      { soBuoiChuaChot: 0, sessionsLearned: 0, sessionsTotal: 12 },
      { soBuoiChuaChot: 5, sessionsLearned: 0, sessionsTotal: 12 },
      { soBuoiChuaChot: 5, sessionsLearned: 3, sessionsTotal: 12 },
    ]) {
      expect(canhBaoSoBuoi(x).lyDo.length).toBeGreaterThan(10);
    }
  });
});

describe("[LCB-03] KHÔNG đọc đồng hồ thật", () => {
  it("mốc thời gian là THAM SỐ — cùng đầu vào, hai lượt ra cùng kết quả", () => {
    // Luật 19 (docs/luat-doc-so-va-ket-luan.md): hàm rơi về `new Date()` là ca hẹn giờ nổ,
    // và ở đây nó còn tệ hơn — kết quả quyết định có chi tiền hoàn hay không.
    const b = [{ date: ngay(-1), status: "SCHEDULED" }];
    expect(soBuoiChuaChot(b, MOC)).toBe(soBuoiChuaChot(b, MOC));
    // Dời mốc về TRƯỚC buổi đó ⇒ buổi thành tương lai ⇒ không còn tính.
    expect(soBuoiChuaChot(b, ngay(-5))).toBe(0);
  });
});
