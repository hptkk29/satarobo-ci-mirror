// lib/finance/qua-han.test.ts — DANH SÁCH QUÁ HẠN THEO NHÀ. THUẦN. PHIÊN G2 · US-23.
//
// Số lấy từ TS-45: *"An và Bình cùng quá hạn Đợt 2, Chi PAUSED quá hạn; chạy cron 2 lần
// trong ngày. Kỳ vọng: 1 dòng gia đình gồm An, Bình (không có Chi); đúng 1 thông báo cho
// sale trong ngày."*
import { describe, expect, it } from "vitest";
import { cauNhac, gomTheoNha, soNgayQuaHan, type DotQuaHan } from "./qua-han";

const NAY = new Date("2699-10-20T03:00:00Z");

const dot = (p: Partial<DotQuaHan> & { paymentRequestId: string; orderItemId: string }): DotQuaHan => ({
  orderId: "don-1",
  tenCon: "Bé",
  installmentNo: 2,
  conThieu: 1_000_000,
  dueDate: new Date("2699-10-10T00:00:00Z"),
  ...p,
});

describe("[QHN] đếm ngày quá hạn", () => {
  it("[QHN-01] đếm theo NGÀY LỊCH, KHÔNG theo hiệu mili giây", () => {
    // ⚠️ Hạn 19/10 22:00 giờ VN, bây giờ là 20/10 10:00 giờ VN ⇒ hiệu mili giây chỉ 12 GIỜ,
    // `floor` ra **0 ngày**, và người đọc tưởng đợt chưa trễ. Ca này CỐ Ý chọn một hạn MANG
    // GIỜ: hạn lấy từ ô chọn ngày thì đúng nửa đêm nên hai phép hay trùng nhau — đo bằng hạn
    // nửa đêm là phép cấy TRƠ (đã đo: cấy "hiệu mili giây" ra 0 ca đỏ ở bản đầu).
    expect(soNgayQuaHan(new Date("2699-10-19T15:00:00Z"), NAY)).toBe(1);
    expect(soNgayQuaHan(new Date("2699-10-10T00:00:00Z"), NAY)).toBe(10);
  });

  it("[QHN-01b] ngày VIỆT NAM, không ngày UTC", () => {
    // 2699-10-19T17:30Z = 20/10 00:30 giờ VN — tức hạn của CHÍNH HÔM NAY, chưa trễ ngày nào.
    // Đếm theo ngày UTC thì nó nằm ở 19/10 và ra "trễ 1 ngày". Vercel chạy UTC.
    expect(soNgayQuaHan(new Date("2699-10-19T17:30:00Z"), NAY)).toBe(0);
  });

  it("[QHN-02] chưa tới hạn ⇒ 0, không ra số âm", () => {
    expect(soNgayQuaHan(new Date("2699-11-01T00:00:00Z"), NAY)).toBe(0);
  });
});

describe("[QHN] gom theo nhà", () => {
  it("[QHN-03] TS-45: hai con cùng nhà ⇒ MỘT dòng, và gợi ý phát phiếu gộp", () => {
    const r = gomTheoNha(
      [
        dot({ paymentRequestId: "pr-an", orderItemId: "oi-an", tenCon: "An" }),
        dot({ paymentRequestId: "pr-binh", orderItemId: "oi-binh", tenCon: "Bình" }),
      ],
      NAY,
    );
    expect(r).toHaveLength(1);
    expect(r[0]!.con.map((c) => c.tenCon).sort()).toEqual(["An", "Bình"]);
    expect(r[0]!.tongConThieu).toBe(2_000_000);
    expect(r[0]!.nenGopPhieu, "hai con cùng quá hạn ⇒ nên gộp").toBe(true);
  });

  it("[QHN-04] một con duy nhất ⇒ KHÔNG gợi ý gộp", () => {
    // Gợi ý gộp cho một bé là một lời khuyên vô nghĩa, và một lời khuyên vô nghĩa lặp lại
    // mỗi sáng dạy người ta bỏ qua mọi lời khuyên.
    const r = gomTheoNha([dot({ paymentRequestId: "pr-1", orderItemId: "oi-1" })], NAY);
    expect(r[0]!.nenGopPhieu).toBe(false);
  });

  it("[QHN-05] một con NHIỀU đợt quá hạn ⇒ cộng tiền, lấy ngày TRỄ NHẤT", () => {
    const r = gomTheoNha(
      [
        dot({ paymentRequestId: "pr-1", orderItemId: "oi-1", installmentNo: 1, conThieu: 300_000, dueDate: new Date("2699-09-01T00:00:00Z") }),
        dot({ paymentRequestId: "pr-2", orderItemId: "oi-1", installmentNo: 2, conThieu: 700_000, dueDate: new Date("2699-10-10T00:00:00Z") }),
      ],
      NAY,
    );
    expect(r[0]!.con).toHaveLength(1);
    expect(r[0]!.con[0]).toMatchObject({ conThieu: 1_000_000, soDot: 2, soNgayQua: 49 });
    // Vẫn MỘT con ⇒ không gợi ý gộp, dù có hai đợt.
    expect(r[0]!.nenGopPhieu).toBe(false);
  });

  it("[QHN-06] nhiều nhà ⇒ nhà trễ LÂU NHẤT lên đầu; trong nhà, con trễ lâu nhất lên đầu", () => {
    // Sale đọc từ trên xuống, nên thứ tự danh sách PHẢI là thứ tự cần gọi. Một danh sách
    // xếp theo thứ tự ngẫu nhiên là một danh sách người ta chỉ đọc ba dòng đầu.
    const r = gomTheoNha(
      [
        dot({ paymentRequestId: "a", orderId: "don-A", orderItemId: "a1", tenCon: "A1", dueDate: new Date("2699-10-18T00:00:00Z") }),
        dot({ paymentRequestId: "b", orderId: "don-B", orderItemId: "b1", tenCon: "B1", dueDate: new Date("2699-09-01T00:00:00Z") }),
        dot({ paymentRequestId: "b2", orderId: "don-B", orderItemId: "b2", tenCon: "B2", dueDate: new Date("2699-10-19T00:00:00Z") }),
      ],
      NAY,
    );
    expect(r.map((x) => x.orderId)).toEqual(["don-B", "don-A"]);
    expect(r[0]!.con.map((c) => c.tenCon)).toEqual(["B1", "B2"]);
  });

  it("[QHN-07] danh sách rỗng ⇒ không nhà nào", () => {
    expect(gomTheoNha([], NAY)).toEqual([]);
  });

  it("[QHN-08] bé BẢO LƯU không có trong đầu vào ⇒ không có trong kết quả (AC4)", () => {
    // ⚠️ Ghim RANH GIỚI: phép lọc bảo lưu nằm ở NGƯỜI GỌI (`locDotCuaConDangBaoLuu`, F2),
    // không ở đây. Lọc lần nữa trong hàm này là hai chỗ cùng quyết định một luật, và chỗ thứ
    // hai sẽ lệch. Ca này khẳng định hàm chỉ gom đúng thứ nó nhận.
    const r = gomTheoNha([dot({ paymentRequestId: "pr-an", orderItemId: "oi-an", tenCon: "An" })], NAY);
    expect(r[0]!.con.map((c) => c.tenCon)).toEqual(["An"]);
  });
});

describe("[QHN] câu nhắc gửi sale", () => {
  it("[QHN-09] nói ĐỦ ba thứ sale cần: ai, trễ mấy ngày, thiếu bao nhiêu", () => {
    const [nha] = gomTheoNha(
      [
        dot({ paymentRequestId: "pr-an", orderItemId: "oi-an", tenCon: "An" }),
        dot({ paymentRequestId: "pr-binh", orderItemId: "oi-binh", tenCon: "Bình" }),
      ],
      NAY,
    );
    const cau = cauNhac(nha!);
    expect(cau).toContain("An");
    expect(cau).toContain("Bình");
    expect(cau).toContain("10 ngày");
    expect(cau).toContain("2.000.000đ");
    expect(cau, "hai bé ⇒ gợi ý phiếu gộp").toContain("phiếu gộp");
  });

  it("[QHN-10] một bé ⇒ KHÔNG kèm gợi ý gộp", () => {
    const [nha] = gomTheoNha([dot({ paymentRequestId: "p", orderItemId: "o", tenCon: "An" })], NAY);
    expect(cauNhac(nha!)).not.toContain("phiếu gộp");
  });
});
