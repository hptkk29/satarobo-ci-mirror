// lib/orders/uu-dai-anh-em.test.ts — NHẬN RA ưu đãi anh chị em. THUẦN, không DB.
//
// ⚠️ Luật bao trùm cả tệp: **không ca nào ở đây được nói về TIỀN.** Chủ dự án chốt
// 21/09/2026: *"KHÔNG tự động tăng nợ bé còn lại… Không đổi số tiền nào."* Ngày nào có ca
// test ở đây khẳng định một con số học phí thì hoặc chính sách đã đổi, hoặc ai đó vừa
// biến một cái nhãn thành một phép trừ.
import { describe, expect, it } from "vitest";
import { LOAI_GIAM } from "./giam-gia-dong";
import { boDau, soiUuDaiAnhEm, type DongDeSoiUuDai } from "./uu-dai-anh-em";

const dong = (p: Partial<DongDeSoiUuDai> & { orderItemId: string }): DongDeSoiUuDai => ({
  ten: "Bé " + p.orderItemId,
  khoanGiam: null,
  lyDoGop: null,
  ...p,
});

describe("soiUuDaiAnhEm — nhận ra bằng NHÃN", () => {
  it("[UDA-01] có khoản `loai = ANH_EM` ⇒ cảnh báo, và ghi rõ là theo NHÃN", () => {
    const r = soiUuDaiAnhEm([
      dong({ orderItemId: "oi-A" }),
      dong({
        orderItemId: "oi-B",
        khoanGiam: [{ loai: LOAI_GIAM.ANH_EM, lyDo: "con thứ hai", giam: 1_800_000 }],
      }),
    ]);
    expect(r.co).toBe(true);
    expect(r.dauVet).toEqual([{ orderItemId: "oi-B", ten: "Bé oi-B", theoNhan: true }]);
    // Câu chữ do chủ dự án chốt — ghim nguyên văn.
    expect(r.canhBao).toBe(
      "Đơn có ưu đãi anh em — bé còn lại vẫn giữ ưu đãi theo chính sách hiện hành. " +
        "Muốn thu hồi, báo QLCS.",
    );
  });

  it("[UDA-02] SOI CẢ ĐƠN — nhãn nằm trên bé KHÁC vẫn phải thấy", () => {
    // Ưu đãi anh em theo bản chất nằm trên bé THỨ HAI. Soi mỗi dòng đang dừng là bỏ sót
    // đúng ca thường gặp nhất — ca này ghim điều đó.
    const r = soiUuDaiAnhEm([
      dong({ orderItemId: "dang-dung" }),
      dong({ orderItemId: "be-kia", khoanGiam: [{ loai: LOAI_GIAM.ANH_EM }] }),
    ]);
    expect(r.co).toBe(true);
    expect(r.dauVet.map((d) => d.orderItemId)).toEqual(["be-kia"]);
  });

  it("[UDA-03] loại KHÁC (học bổng, đóng sớm, đội thi…) ⇒ KHÔNG cảnh báo", () => {
    for (const loai of [LOAI_GIAM.HOC_BONG, LOAI_GIAM.DONG_SOM, LOAI_GIAM.DOI_THI, LOAI_GIAM.GIOI_THIEU]) {
      const r = soiUuDaiAnhEm([dong({ orderItemId: "x", khoanGiam: [{ loai }] })]);
      expect(r.co, `loại ${loai} không được kích cảnh báo anh em`).toBe(false);
      expect(r.canhBao).toBeNull();
    }
  });

  it("[UDA-04] mã LẠ trong `loai` ⇒ bỏ qua, không ném", () => {
    // `discounts` là JSON — hình dạng của nó không có gì bảo đảm. Một mã rác phải rơi về
    // "không có nhãn", không được làm vỡ màn xem trước.
    for (const rac of ["ANH_EM_2", "anh_em", 42, null, undefined, {}]) {
      const r = soiUuDaiAnhEm([dong({ orderItemId: "x", khoanGiam: [{ loai: rac }] })]);
      expect(r.co).toBe(false);
    }
  });
});

describe("soiUuDaiAnhEm — ĐOÁN từ văn xuôi (chỉ để nhắc)", () => {
  it("[UDA-05] `lyDo` nói anh/chị/em ⇒ cảnh báo, nhưng ghi rõ là ĐOÁN", () => {
    for (const lyDo of [
      "em ruột HV Sata2 — ưu đãi theo chính sách anh chị em",
      "Anh Em học cùng",
      "gói anh/chị/em",
      "chị ruột đang học Sata4",
      "con thứ 2 giảm thêm 15%",
      "con thứ hai",
    ]) {
      const r = soiUuDaiAnhEm([dong({ orderItemId: "x", khoanGiam: [{ lyDo }] })]);
      expect(r.co, `phải bắt được: "${lyDo}"`).toBe(true);
      expect(r.dauVet[0]!.theoNhan, "đoán từ chữ thì KHÔNG được khoe là theo nhãn").toBe(false);
    }
  });

  it("[UDA-06] MẪU HẸP: 'con thu' KHÔNG kèm chỉ số thì KHÔNG bắt", () => {
    // Cám dỗ là bắt luôn `con thu` (đã bỏ dấu) cho gọn. Nhưng nó khớp cả "con thu tiền",
    // và một cảnh báo hiện sai chỗ thì người ta học cách bỏ qua MỌI cảnh báo.
    for (const lyDo of [
      "con thu tiền mặt tại quầy",
      "hoàn cho con thu nhập thấp",
      "giảm theo chương trình con thu hút",
    ]) {
      const r = soiUuDaiAnhEm([dong({ orderItemId: "x", khoanGiam: [{ lyDo }] })]);
      expect(r.co, `KHÔNG được bắt: "${lyDo}"`).toBe(false);
    }
  });

  it("[UDA-07] đơn CŨ chỉ còn `discountReason` ghép ⇒ vẫn soi được", () => {
    const r = soiUuDaiAnhEm([
      dong({ orderItemId: "cu", khoanGiam: null, lyDoGop: "Đóng sớm · em ruột HV Sata3" }),
    ]);
    expect(r.co).toBe(true);
    expect(r.dauVet[0]!.theoNhan).toBe(false);
  });

  it("[UDA-08] NHÃN thắng văn xuôi khi một dòng có cả hai", () => {
    const r = soiUuDaiAnhEm([
      dong({
        orderItemId: "x",
        khoanGiam: [{ lyDo: "đóng sớm" }, { loai: LOAI_GIAM.ANH_EM, lyDo: "anh em" }],
      }),
    ]);
    expect(r.dauVet[0]!.theoNhan).toBe(true);
  });

  it("[UDA-09] phép bỏ dấu xử lý được `đ` — bẫy của NFD", () => {
    // ⚠️ Ca này gọi THẲNG `boDau`, không đi qua `soiUuDaiAnhEm`, và đó là chủ đích:
    // KHÔNG mẫu nào trong `MAU_VAN_XUOI` hôm nay chứa `đ`, nên kiểm gián tiếp thì gỡ dòng
    // `.replace(/đ/g, "d")` vẫn cho 0 ca đỏ — đã cấy thử và đo được đúng vậy. Bản đầu của
    // ca này kiểm gián tiếp và vì thế **không canh được gì**.
    //
    // `normalize("NFD")` tách được dấu phụ (`ộ` → `o` + dấu) nhưng KHÔNG tách `đ` — nó là
    // một ký tự riêng trong Unicode. Thiếu phép thay tay thì mọi mẫu chạm `đ` im lặng
    // không khớp, và "im lặng không khớp" là dạng hỏng đắt nhất.
    expect(boDau("Đóng sớm")).toBe("dong som");
    expect(boDau("em ruột")).toBe("em ruot");
    expect(boDau("Con Thứ Hai")).toBe("con thu hai");
    expect(boDau("ưu đãi anh chị em")).toBe("uu dai anh chi em");
  });
});

describe("soiUuDaiAnhEm — trạng thái rỗng", () => {
  it("[UDA-10] đơn không có ưu đãi nào ⇒ KHÔNG cảnh báo, danh sách rỗng", () => {
    const r = soiUuDaiAnhEm([dong({ orderItemId: "a" }), dong({ orderItemId: "b" })]);
    expect(r).toEqual({ co: false, dauVet: [], canhBao: null });
  });

  it("[UDA-11] đơn rỗng ⇒ không ném", () => {
    expect(soiUuDaiAnhEm([])).toEqual({ co: false, dauVet: [], canhBao: null });
  });
});
