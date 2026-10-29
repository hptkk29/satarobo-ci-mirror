// TRẦN CHI PHÍ THÁNG cho lời gọi ra ngoài — luật thuần. Test viết TRƯỚC hiện thực
// (luật cứng #5).
//
// Chốt 27/08/2026: Zalo 2tr · cước gọi 3tr · chấm điểm AI 1tr = 6tr/tháng, kèm HAI
// cơ chế bắt buộc — dừng cứng khi chạm trần, và cảnh báo ở mốc 80%.
//
// Vì sao ca test ở đây trông "hiển nhiên" mà vẫn phải có: mọi con số của module này
// đọc từ SystemSetting (sửa không cần deploy), nên KHÔNG có hằng số nào trong code để
// đọc mà biết luật. Bất đẳng thức biên (`đã tiêu + chi phí ≤ trần`) là thứ duy nhất
// quyết định tiền có bị tiêu tiếp hay không, và nó bị NHÂN BẢN sang câu lệnh SQL ở
// `cau-lenh.ts` (bản SQL mới là bản THẬT — xem chú thích ở `so-chi.ts`). Hai bản lệch
// nhau là chi tiền âm thầm. Bộ này pin bản thuần; `cau-lenh.test.ts` pin bản SQL.
import { describe, it, expect } from "vitest";
import {
  TRUC_CHI_PHI,
  KHOA_TRAN_THANG,
  NHAN_TRUC,
  MA_CHAN_NGAN_SACH,
  kyThangVn,
  quyetDinhNganSach,
  thongDiepChan,
} from "@/lib/ngan-sach-goi-ra/chinh-sach";

const TRAN_ZALO = 2_000_000;

const quyet = (daTieuVnd: number, chiPhiVnd: number, tranVnd = TRAN_ZALO, moc = 80) =>
  quyetDinhNganSach({ daTieuVnd, chiPhiVnd, tranVnd, mocCanhBaoPhanTram: moc });

describe("trần chi phí · các trục là một danh sách đóng", () => {
  it("đúng hai trục (gọi điện OmiCall đã gỡ 06/10/2026), mỗi trục có khoá cấu hình riêng và nhãn tiếng Việt", () => {
    expect([...TRUC_CHI_PHI]).toEqual(["ZALO", "CHAM_DIEM_AI"]);
    for (const truc of TRUC_CHI_PHI) {
      expect(KHOA_TRAN_THANG[truc], `trục ${truc} thiếu khoá trần`).toMatch(/^outbound\./);
      expect(NHAN_TRUC[truc]?.length, `trục ${truc} thiếu nhãn`).toBeGreaterThan(0);
    }
  });

  it("các khoá trần KHÁC NHAU — trần riêng từng trục, không dùng chung một ô", () => {
    const khoa = TRUC_CHI_PHI.map((t) => KHOA_TRAN_THANG[t]);
    expect(new Set(khoa).size).toBe(khoa.length);
  });
});

describe("trần chi phí · kỳ tháng tính theo lịch VN, không theo giờ máy chạy", () => {
  // Vercel/CI chạy UTC. Lấy `getMonth()` trần thì 7 giờ cuối mỗi tháng bị ghi vào kỳ
  // TRƯỚC ⇒ ngày 1 hàng tháng ngân sách chưa thật sự reset. Đây là cùng loại lỗi đã
  // làm lệch lịch buổi học 06/08/2026 (xem lib/time/vn.ts).
  it("23:59:59 ngày 31/08 giờ VN vẫn là kỳ 2026-08", () => {
    expect(kyThangVn(new Date("2026-08-31T16:59:59.000Z"))).toBe("2026-08");
  });

  it("00:00:00 ngày 01/09 giờ VN đã sang kỳ 2026-09 (dù UTC vẫn là 31/08)", () => {
    expect(kyThangVn(new Date("2026-08-31T17:00:00.000Z"))).toBe("2026-09");
  });

  it("tháng một chữ số có số 0 đứng trước (khoá sắp xếp được)", () => {
    expect(kyThangVn(new Date("2026-01-01T00:00:00.000Z"))).toBe("2026-01");
  });
});

describe("trần chi phí · DỪNG CỨNG khi chạm trần", () => {
  it("còn dư thì cho đi", () => {
    const r = quyet(1_000_000, 400);
    expect(r.choPhep).toBe(true);
    expect(r.sauKhiTieuVnd).toBe(1_000_400);
    expect(r.conLaiVnd).toBe(TRAN_ZALO - 1_000_400);
  });

  it("BIÊN: tiêu vừa ĐÚNG bằng trần thì vẫn cho đi (≤, không phải <)", () => {
    const r = quyet(TRAN_ZALO - 400, 400);
    expect(r.choPhep).toBe(true);
    expect(r.conLaiVnd).toBe(0);
  });

  it("BIÊN: vượt trần đúng 1đ là CHẶN", () => {
    expect(quyet(TRAN_ZALO - 400, 401).choPhep).toBe(false);
  });

  it("đã chạm trần rồi thì lượt sau chặn tiếp, không 'âm thầm tiếp tục'", () => {
    const r = quyet(TRAN_ZALO, 400);
    expect(r.choPhep).toBe(false);
    expect(r.conLaiVnd).toBe(0);
  });

  it("trần = 0 nghĩa là TẮT trục đó, không phải 'không giới hạn'", () => {
    expect(quyet(0, 1, 0).choPhep).toBe(false);
    // Lượt không tốn tiền vẫn đi được — trần chặn TIỀN, không chặn hành vi miễn phí.
    expect(quyet(0, 0, 0).choPhep).toBe(true);
  });

  it("hạ trần giữa kỳ xuống dưới mức đã tiêu: chặn ngay, số còn lại KHÔNG âm", () => {
    const r = quyet(1_900_000, 400, 1_000_000);
    expect(r.choPhep).toBe(false);
    expect(r.conLaiVnd).toBe(0);
    expect(r.phanTramVnd).toBeGreaterThanOrEqual(100);
  });

  it("chi phí âm / không phải số là LỖI LẬP TRÌNH, ném ra chứ không lặng lẽ cộng trừ", () => {
    expect(() => quyet(0, -1)).toThrow(RangeError);
    expect(() => quyet(0, Number.NaN)).toThrow(RangeError);
  });
});

describe("trần chi phí · CẢNH BÁO ở mốc 80%", () => {
  it("mốc cảnh báo = 80% của trần", () => {
    expect(quyet(0, 0).mocCanhBaoVnd).toBe(1_600_000);
  });

  it("lượt VƯỢT QUA mốc mới báo — báo đúng một lần, không phải mỗi lượt sau đó", () => {
    expect(quyet(1_599_999, 1).chamNguongCanhBao).toBe(true);
    // Đã ở trên mốc từ trước ⇒ lượt sau KHÔNG báo lại (chống spam cảnh báo).
    expect(quyet(1_600_000, 400).chamNguongCanhBao).toBe(false);
  });

  it("chưa tới mốc thì không báo", () => {
    expect(quyet(1_000_000, 400).chamNguongCanhBao).toBe(false);
  });

  it("lượt BỊ CHẶN không tính là 'vừa vượt mốc' — nó không tiêu đồng nào", () => {
    expect(quyet(TRAN_ZALO, 400).chamNguongCanhBao).toBe(false);
  });

  it("đổi mốc cảnh báo được (là tham số, không phải hằng số 80 chôn trong code)", () => {
    expect(quyet(0, 0, TRAN_ZALO, 50).mocCanhBaoVnd).toBe(1_000_000);
  });
});

describe("trần chi phí · câu giải thích cho người đọc", () => {
  it("có mã máy đọc riêng, KHÔNG lẫn với lỗi gửi thường", () => {
    expect(MA_CHAN_NGAN_SACH).toBe("OUTBOUND_BUDGET_EXCEEDED");
  });

  it("câu chặn nói rõ: trục nào, kỳ nào, đã tiêu bao nhiêu / trần bao nhiêu", () => {
    const s = thongDiepChan({
      truc: "ZALO",
      kyThang: "2026-08",
      daTieuVnd: 2_000_000,
      tranVnd: 2_000_000,
    });
    expect(s).toContain(NHAN_TRUC.ZALO);
    expect(s).toContain("08/2026");
    expect(s).toContain("2.000.000");
    // Không được hứa hẹn kiểu "thử lại sau vài phút" — hết ngân sách thì phải có
    // người nâng trần, chờ không tự khỏi.
    expect(s).not.toMatch(/thử lại/i);
  });
});
