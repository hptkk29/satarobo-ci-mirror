// lib/finance/chuyen-tien-con.test.ts — LUẬT CHUYỂN TIỀN GIỮA HAI CON. THUẦN, không DB.
import { describe, expect, it } from "vitest";
import { goiYSoTienChuyen, kiemChuyenTien, type ConDeChuyen } from "./chuyen-tien-con";

const be = (p: Partial<ConDeChuyen> & { orderItemId: string; ten: string }): ConDeChuyen => ({
  daThu: 0,
  conNo: 0,
  ...p,
});

/** Bé A đã thu 5tr và vẫn còn nợ 3tr; bé B chưa đóng gì, nợ đủ 8tr. */
const CON = [
  be({ orderItemId: "oi-A", ten: "Bé A", daThu: 5_000_000, conNo: 3_000_000 }),
  be({ orderItemId: "oi-B", ten: "Bé B", daThu: 0, conNo: 8_000_000 }),
];

const chuyen = (soTien: number, tu = "oi-A", den = "oi-B", con = CON) =>
  kiemChuyenTien({ tuOrderItemId: tu, denOrderItemId: den, soTien, con });

describe("[CTC] trần của bé CHO = phần kế toán ĐÃ XÁC NHẬN", () => {
  it("[CTC-01] chuyển được dù bé CHO vẫn còn nợ — đây là ca dùng chính", () => {
    // ⚠️ Ca quan trọng nhất của cụm. Cám dỗ là chỉ cho chuyển phần ĐÓNG THỪA, nhưng ca
    // thật lại là: phụ huynh đóng một khoản, sale gắn nhầm cho bé A, và CẢ HAI bé đều còn
    // nợ. Chặn theo "dư" là chặn đúng ca cần làm nhất.
    const r = chuyen(5_000_000);
    expect(r).toMatchObject({ ok: true, soTien: 5_000_000, tenCho: "Bé A", tenNhan: "Bé B" });
  });

  it("[CTC-02] vượt phần đã xác nhận ⇒ CHẶN, và nói rõ 'đã xác nhận'", () => {
    const r = chuyen(5_000_001);
    expect(r).toMatchObject({ ok: false });
    expect((r as { loi: string }).loi).toContain("tối đa 5.000.000đ");
    expect((r as { loi: string }).loi).toContain("ĐÃ XÁC NHẬN");
  });

  it("[CTC-03] bé CHO chưa có khoản nào xác nhận ⇒ CHẶN bằng câu nói đúng nguyên nhân", () => {
    const r = chuyen(1_000, "oi-B", "oi-A");
    expect((r as { loi: string }).loi).toContain("Bé B chưa có khoản nào kế toán đã xác nhận");
  });
});

describe("[CTC] trần của bé NHẬN = còn nợ", () => {
  it("[CTC-04] không đẩy bé nhận thành ĐÓNG THỪA", () => {
    const con = [
      be({ orderItemId: "oi-A", ten: "Bé A", daThu: 9_000_000, conNo: -1_000_000 }),
      be({ orderItemId: "oi-B", ten: "Bé B", daThu: 0, conNo: 2_000_000 }),
    ];
    expect(chuyen(2_000_000, "oi-A", "oi-B", con)).toMatchObject({ ok: true });
    const r = chuyen(2_000_001, "oi-A", "oi-B", con);
    expect((r as { loi: string }).loi).toContain("Bé B chỉ nhận thêm được tối đa 2.000.000đ");
  });

  it("[CTC-05] bé nhận HẾT nợ (hoặc đang đóng thừa) ⇒ CHẶN, nêu hệ quả", () => {
    for (const conNo of [0, -500_000]) {
      const con = [
        be({ orderItemId: "oi-A", ten: "Bé A", daThu: 5_000_000, conNo: 3_000_000 }),
        be({ orderItemId: "oi-B", ten: "Bé B", daThu: 9_000_000, conNo }),
      ];
      const r = chuyen(1_000, "oi-A", "oi-B", con);
      expect((r as { loi: string }).loi).toContain("không còn nợ đồng nào");
      // Câu lỗi nói HỆ QUẢ chứ không chỉ "không được": khoản thừa lại phải đi phân tiếp.
      expect((r as { loi: string }).loi).toContain("phân tiếp");
    }
  });
});

describe("[CTC] hình dạng đầu vào", () => {
  it("[CTC-06] số tiền ≤ 0 hoặc không phải số ⇒ CHẶN TRƯỚC mọi phép so trần", () => {
    for (const v of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(chuyen(v)).toMatchObject({ ok: false, loi: "Số tiền chuyển phải lớn hơn 0" });
    }
  });

  it("[CTC-07] tự chuyển cho chính mình ⇒ CHẶN, và câu lỗi nói ĐÚNG nguyên nhân", () => {
    // ⚠️ Thứ tự cổng có chủ đích: nếu cổng "khác bé" đứng SAU cổng trần thì người vận hành
    // nhận câu "vượt trần" trong khi thứ sai thật sự là họ chọn nhầm chính bé đó — và họ
    // sẽ đi sửa nhầm chỗ.
    expect(chuyen(1_000, "oi-A", "oi-A")).toMatchObject({ ok: false, loi: "Bé nhận phải khác bé cho" });
  });

  it("[CTC-08] bé không thuộc đơn ⇒ CHẶN, KHÔNG tiết lộ bé đó có tồn tại ở đâu không", () => {
    for (const [tu, den] of [["oi-LA", "oi-B"], ["oi-A", "oi-LA"]] as const) {
      const r = chuyen(1_000, tu, den);
      expect((r as { loi: string }).loi).toBe("Chỉ chuyển được giữa hai bé của CÙNG một đơn");
    }
  });
});

describe("[CTC] gợi ý số tiền cho ô nhập", () => {
  it("[CTC-09] lấy NHỎ HƠN giữa hai trần, không âm", () => {
    expect(goiYSoTienChuyen(CON[0]!, CON[1]!)).toBe(5_000_000);
    expect(
      goiYSoTienChuyen(
        be({ orderItemId: "a", ten: "A", daThu: 9_000_000 }),
        be({ orderItemId: "b", ten: "B", conNo: 2_000_000 }),
      ),
    ).toBe(2_000_000);
    // Bé nhận đang đóng thừa ⇒ gợi ý 0, và cổng sẽ từ chối — hai chỗ nói cùng một chuyện.
    expect(
      goiYSoTienChuyen(
        be({ orderItemId: "a", ten: "A", daThu: 9_000_000 }),
        be({ orderItemId: "b", ten: "B", conNo: -1 }),
      ),
    ).toBe(0);
  });
});
