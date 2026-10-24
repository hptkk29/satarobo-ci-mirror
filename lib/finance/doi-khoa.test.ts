// lib/finance/doi-khoa.test.ts — ĐỔI KHOÁ: phép chia tiền + cổng nghiệp vụ. THUẦN.
//
// Số lấy từ TS-41 và AC2 của US-20 (`docs/thanh-toan-linh-hoat/`):
//   TS-41 — *"Bình học 20 buổi, đổi sang khoá giả định 600.000 (tổng) … ghi danh cũ STOPPED,
//            dư 1.000.000; ghi danh mới nhận 600.000 (còn nợ 0); ví +400.000"*
//   AC2   — *"dư 1.000.000 từ khoá 250.000/buổi sang khoá 200.000/buổi hiện 'tương đương 5
//            buổi' CHỈ ĐỂ THAM KHẢO"*
import { describe, expect, it } from "vitest";
import { keHoachDoiKhoa, kiemDoiKhoa } from "./doi-khoa";

const ke = (daThuCu: number, giaTriDaDung: number, hocPhiThuc: number, soBuoiCamKet: number | null = null) =>
  keHoachDoiKhoa({ daThuCu, giaTriDaDung, moi: { hocPhiThuc, soBuoiCamKet } });

describe("[DKH] chia tiền khi đổi khoá", () => {
  it("[DKH-01] TS-41: dư 1.000.000, khoá mới 600.000 ⇒ chuyển 600.000, ví 400.000, còn nợ 0", () => {
    const r = ke(3_000_000, 2_000_000, 600_000);
    expect(r.du).toBe(1_000_000);
    expect(r.chuyenSangMoi).toBe(600_000);
    // BA gọi là "ví"; trong repo này phần vượt đi đường HOÀN TIỀN — lý do đầy đủ ở
    // chú thích `phanVuot` trong `doi-khoa.ts`. Con số thì đúng như TS-41.
    expect(r.phanVuot).toBe(400_000);
    expect(r.conThieuMoi, "khoá mới hết nợ").toBe(0);
    expect(r.conNoCu).toBe(0);
  });

  it("[DKH-02] khoá mới ĐẮT hơn ⇒ chuyển hết dư, phần còn thiếu thành đợt (AC3)", () => {
    const r = ke(3_000_000, 2_000_000, 5_000_000);
    expect(r.chuyenSangMoi).toBe(1_000_000);
    expect(r.phanVuot, "không có gì vượt").toBe(0);
    expect(r.conThieuMoi).toBe(4_000_000);
  });

  it("[DKH-03] dư ĐÚNG BẰNG học phí mới ⇒ không vào ví, không còn thiếu", () => {
    const r = ke(3_000_000, 2_000_000, 1_000_000);
    expect(r.chuyenSangMoi).toBe(1_000_000);
    expect(r.phanVuot).toBe(0);
    expect(r.conThieuMoi).toBe(0);
  });

  it("[DKH-04] bé còn NỢ phần đã học ⇒ không chuyển gì, và nợ KHÔNG bị nuốt", () => {
    // ⚠️ Ca dễ sai nhất: `du` ÂM. Kẹp nó về 0 rồi quên là nợ cũ biến mất khỏi sổ — bé đổi
    // khoá xong hoá ra đã trả đủ phần đã học mà thật ra chưa.
    const r = ke(500_000, 2_000_000, 3_000_000);
    expect(r.du).toBe(-1_500_000);
    expect(r.conNoCu).toBe(1_500_000);
    expect(r.chuyenSangMoi).toBe(0);
    expect(r.phanVuot).toBe(0);
    expect(r.conThieuMoi, "khoá mới còn nợ TRỌN học phí").toBe(3_000_000);
  });

  it("[DKH-05] chưa đóng đồng nào và chưa học buổi nào ⇒ không có gì để chuyển", () => {
    const r = ke(0, 0, 4_000_000);
    expect(r.du).toBe(0);
    expect(r.chuyenSangMoi).toBe(0);
    expect(r.conThieuMoi).toBe(4_000_000);
  });

  it("[DKH-06] khoá mới MIỄN PHÍ ⇒ toàn bộ dư vào ví", () => {
    const r = ke(3_000_000, 2_000_000, 0);
    expect(r.chuyenSangMoi).toBe(0);
    expect(r.phanVuot).toBe(1_000_000);
    expect(r.conThieuMoi).toBe(0);
  });

  it("[DKH-07] ba con số luôn CỘNG LẠI ĐÚNG — không đồng nào bốc hơi", () => {
    // Bất biến của cả phép chia: `chuyenSangMoi + phanVuot === max(0, du)`, và
    // `chuyenSangMoi + conThieuMoi === hocPhiMoi`. Đây là thứ giữ cho tiền không tự sinh /
    // tự mất, nên đo trên nhiều bộ số chứ không chỉ một.
    for (const [daThu, daDung, hocPhiMoi] of [
      [3_000_000, 2_000_000, 600_000],
      [3_000_000, 2_000_000, 5_000_000],
      [500_000, 2_000_000, 3_000_000],
      [12_345_678, 1_111_111, 2_222_222],
      [0, 0, 0],
    ] as const) {
      const r = ke(daThu, daDung, hocPhiMoi);
      expect(r.chuyenSangMoi + r.phanVuot, `${daThu}/${daDung}/${hocPhiMoi}`).toBe(
        Math.max(0, r.du),
      );
      expect(r.chuyenSangMoi + r.conThieuMoi, `${daThu}/${daDung}/${hocPhiMoi}`).toBe(hocPhiMoi);
    }
  });
});

describe("[DKH] 'tương đương mấy buổi' — CHỈ để tham khảo", () => {
  it("[DKH-08] AC2: dư 1.000.000, khoá mới 200.000/buổi ⇒ tương đương 5 buổi", () => {
    // Khoá mới: 20 buổi × 200.000 = 4.000.000.
    const r = ke(3_000_000, 2_000_000, 4_000_000, 20);
    expect(r.tuongDuongBuoi).toBe(5);
  });

  it("[DKH-09] con số ấy KHÔNG tham gia phép tính nào", () => {
    // ⚠️ Ghim điều quan trọng nhất về `tuongDuongBuoi`: nó chỉ để ĐỌC. Hai bộ chỉ khác nhau
    // ở `soBuoiCamKet` phải cho ra CÙNG các con số tiền. Nếu ai đó lỡ quy dư ra buổi rồi
    // quy ngược lại, ca này đỏ.
    const coBuoi = ke(3_000_000, 2_000_000, 4_000_000, 20);
    const khongBuoi = ke(3_000_000, 2_000_000, 4_000_000, null);
    expect(khongBuoi.tuongDuongBuoi).toBeNull();
    const tien = (x: typeof coBuoi) => [x.du, x.conNoCu, x.chuyenSangMoi, x.phanVuot, x.conThieuMoi];
    expect(tien(coBuoi)).toEqual(tien(khongBuoi));
  });

  it("[DKH-10] làm tròn XUỐNG — không hứa thừa nửa buổi cho phụ huynh", () => {
    // Khoá mới 10 buổi × 210.000 = 2.100.000; dư 1.000.000 ⇒ 4,76 buổi ⇒ nói 4, không nói 5.
    expect(ke(3_000_000, 2_000_000, 2_100_000, 10).tuongDuongBuoi).toBe(4);
  });

  it("[DKH-11] khoá mới học phí 0 hoặc chưa khai buổi ⇒ NULL, không in số 0", () => {
    // In "tương đương 0 buổi" khi phép quy đổi không tồn tại là bịa một con số.
    expect(ke(3_000_000, 2_000_000, 0, 20).tuongDuongBuoi).toBeNull();
    expect(ke(3_000_000, 2_000_000, 4_000_000, 0).tuongDuongBuoi).toBeNull();
  });
});

describe("[DKH] cổng nghiệp vụ", () => {
  const cong = (p: Partial<Parameters<typeof kiemDoiKhoa>[0]> = {}) =>
    kiemDoiKhoa({
      dongCuDaDung: false,
      trungLopHienTai: false,
      coGhiDanhCu: true,
      hocPhiMoi: 4_000_000,
      lyDo: "Bé lên Sata 4",
      ...p,
    });

  it("[DKH-12] ca hợp lệ ⇒ không có câu chặn nào", () => {
    expect(cong()).toBeNull();
  });

  it("[DKH-13] dòng đã DỪNG HỌC ⇒ chặn", () => {
    expect(cong({ dongCuDaDung: true })).toContain("đã dừng học");
  });

  it("[DKH-14] CHƯA XẾP LỚP ⇒ chặn, và nói đúng nguyên nhân", () => {
    // ⚠️ Không phải câu nệ hình thức: dòng mới sẽ không có ghi danh ⇒ khoản tiền chuyển
    // sang nó KHÔNG BAO GIỜ xuất được phiếu thu (`confirmPayment` từ chối khoản chưa gắn
    // ghi danh). Chặn ở đây là chặn một khoản tiền chết.
    expect(cong({ coGhiDanhCu: false })).toContain("chưa được xếp lớp");
  });

  it("[DKH-15] lớp đích TRÙNG lớp đang học ⇒ chặn", () => {
    expect(cong({ trungLopHienTai: true })).toContain("trùng lớp");
  });

  it("[DKH-16] THIẾU LÝ DO ⇒ chặn", () => {
    expect(cong({ lyDo: "   " })).toContain("lý do");
  });

  it("[DKH-17] thứ tự cổng: 'đã dừng học' nói TRƯỚC 'chưa xếp lớp'", () => {
    // Một dòng đã dừng học thì ghi danh của nó cũng đã kết thúc, nên cả hai điều kiện cùng
    // đúng. Câu nói ra phải là nguyên nhân GẦN nhất với việc người dùng vừa làm.
    expect(cong({ dongCuDaDung: true, coGhiDanhCu: false })).toContain("đã dừng học");
  });
});
