// @vitest-environment node
/**
 * EL-05 — gia hạn & thu hồi.
 *
 * Cả hai thao tác đụng vào con số mà mọi báo cáo đứng lên: tỉ lệ đúng hạn. Nên
 * case nào ở đây cũng quy về một câu hỏi — thao tác này có làm hỏng phép đo
 * không, và người bị bỏ qua có được nói lý do không.
 */
import { describe, it, expect } from "vitest";
import { tinhGiaHan, chonDeThuHoi, type DongGhiDanh } from "@/lib/elearning/extend-revoke";

const NOW = new Date("2026-08-23T00:00:00.000Z");
const ngay = (s: string) => new Date(`${s}T00:00:00.000Z`);

const dong = (o: Partial<DongGhiDanh> = {}): DongGhiDanh => ({
  id: "en1",
  status: "IN_PROGRESS",
  dueAt: ngay("2026-08-30"),
  ...o,
});

describe("cộng ngày tính từ `max(hạn, bây giờ)`", () => {
  it("hạn còn ở tương lai ⇒ cộng từ hạn cũ", () => {
    const r = tinhGiaHan([dong({ dueAt: ngay("2026-08-30") })], { themNgay: 3 }, NOW);
    expect(r.capNhat[0]?.dueAt.toISOString()).toBe("2026-09-02T00:00:00.000Z");
  });

  it("hạn ĐÃ TRÔI QUA ⇒ cộng từ bây giờ, không từ hạn cũ", () => {
    // Đây là lý do tồn tại của nút "sự cố hệ thống": sự cố thường được xác nhận
    // SAU khi hạn đã trôi. Cộng 2 ngày vào cái hạn đã quá 5 ngày thì hạn mới vẫn
    // nằm trong quá khứ — người học vẫn bị khoá, còn người vận hành tưởng mình
    // đã cứu họ.
    const r = tinhGiaHan([dong({ dueAt: ngay("2026-08-18") })], { themNgay: 2 }, NOW);
    expect(r.capNhat[0]?.dueAt.toISOString()).toBe("2026-08-25T00:00:00.000Z");
    expect(r.capNhat[0]?.dueAt.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("mốc tuyệt đối thì dùng đúng mốc đó", () => {
    const r = tinhGiaHan([dong()], { denNgay: ngay("2026-12-01") }, NOW);
    expect(r.capNhat[0]?.dueAt.toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });
});

describe("những dòng KHÔNG được đụng tới, và phải nói lý do", () => {
  it("đã thu hồi ⇒ bỏ qua", () => {
    const r = tinhGiaHan([dong({ status: "REVOKED" })], { themNgay: 3 }, NOW);
    expect(r.capNhat).toHaveLength(0);
    expect(r.boQua[0]?.lyDo).toBe("DA_THU_HOI");
  });

  it("đã hoàn thành ⇒ bỏ qua, không ghi đè cột đã yên", () => {
    for (const st of ["COMPLETED", "COMPLETED_LATE"] as const) {
      const r = tinhGiaHan([dong({ status: st })], { themNgay: 3 }, NOW);
      expect(r.boQua[0]?.lyDo, st).toBe("DA_HOAN_THANH");
    }
  });

  it("bài KHÔNG có hạn ⇒ bỏ qua, không tự đặt hạn cho nó", () => {
    // Đặt hạn cho bài tự chọn là BIẾN nó thành bài có hạn — một thao tác khác
    // hẳn, và người học sẽ bị tính quá hạn cho mốc chưa ai quyết.
    const r = tinhGiaHan([dong({ dueAt: null })], { themNgay: 3 }, NOW);
    expect(r.capNhat).toHaveLength(0);
    expect(r.boQua[0]?.lyDo).toBe("KHONG_CO_HAN");
  });

  it("hạn mới KHÔNG xa hơn hạn cũ ⇒ từ chối, không siết qua đường nới", () => {
    // Rút ngắn hạn không phải "gia hạn". Cho nó lọt là để một thao tác siết chặt
    // đi qua cái nút mang tên nới lỏng, và người bị siết chỉ biết khi đã trễ.
    const r = tinhGiaHan(
      [dong({ dueAt: ngay("2026-09-30") })],
      { denNgay: ngay("2026-09-01") },
      NOW,
    );
    expect(r.capNhat).toHaveLength(0);
    expect(r.boQua[0]?.lyDo).toBe("HAN_MOI_KHONG_XA_HON");
  });

  it("hạn mới BẰNG hạn cũ cũng bị từ chối", () => {
    const r = tinhGiaHan([dong({ dueAt: ngay("2026-09-01") })], { denNgay: ngay("2026-09-01") }, NOW);
    expect(r.capNhat).toHaveLength(0);
  });
});

describe("gia hạn hàng loạt: lô hỗn hợp vẫn xử đúng từng dòng", () => {
  it("dòng gia hạn được thì gia hạn, dòng khác nêu lý do riêng", () => {
    const r = tinhGiaHan(
      [
        dong({ id: "a", status: "IN_PROGRESS" }),
        dong({ id: "b", status: "COMPLETED" }),
        dong({ id: "c", status: "NOT_STARTED", dueAt: null }),
        dong({ id: "d", status: "OVERDUE", dueAt: ngay("2026-08-01") }),
      ],
      { themNgay: 5 },
      NOW,
    );
    expect(r.capNhat.map((x) => x.id).sort()).toEqual(["a", "d"]);
    expect(r.boQua.map((x) => x.id).sort()).toEqual(["b", "c"]);
  });

  it("người ĐANG QUÁ HẠN chính là người nút này phải cứu", () => {
    const r = tinhGiaHan([dong({ status: "OVERDUE", dueAt: ngay("2026-08-01") })], { themNgay: 2 }, NOW);
    expect(r.capNhat).toHaveLength(1);
  });
});

describe("thu hồi", () => {
  it("người ĐÃ HỌC XONG không bị thu hồi", () => {
    // Thu hồi họ là xoá bằng chứng của một việc đã làm thật — và với khoá bắt
    // buộc, đó là xoá luôn cơ sở để nói người này đã được đào tạo.
    const r = chonDeThuHoi([dong({ id: "a", status: "COMPLETED" })]);
    expect(r.thuHoi).toHaveLength(0);
    expect(r.boQua[0]?.lyDo).toBe("DA_HOAN_THANH");
  });

  it("thu hồi hai lần không nhân đôi tác dụng", () => {
    const r = chonDeThuHoi([dong({ status: "REVOKED" })]);
    expect(r.thuHoi).toHaveLength(0);
  });

  it("đang học dở thì thu hồi được", () => {
    const r = chonDeThuHoi([
      dong({ id: "a", status: "IN_PROGRESS" }),
      dong({ id: "b", status: "NOT_STARTED" }),
      dong({ id: "c", status: "OVERDUE" }),
    ]);
    expect(r.thuHoi.sort()).toEqual(["a", "b", "c"]);
  });
});
