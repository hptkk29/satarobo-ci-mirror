// Ca [CPG-*] — quyết định có chia tiền về hay không.
//
// LUẬT: ĐƯỢC ĂN CẢ HOẶC KHÔNG ĂN GÌ (chủ dự án chốt 16/09/2026 chiều). Danh sách ca dưới đây là
// đúng danh sách chủ dự án ra: *"đúng số → chia; thừa 1đ → không chia + CAN_XU_LY; thiếu 1đ →
// không chia + CAN_XU_LY; quét lại phiếu PAID → CAN_XU_LY; bắn trùng bankTxnId → không làm gì."*
//
// Số dùng ở đây là số thật của đơn `ORD-260915-000007` (bé A 8.976.000đ · bé B 9.492.000đ ·
// cọc 2.000.000đ chia đôi 1.000.000 mỗi bé).
import { describe, it, expect } from "vitest";
import {
  chiaTheoPhieuGop,
  conPhaiThuCuaPhieu,
  type DongPhieuGop,
  type PhieuGopDeChia,
} from "./chia-phieu-gop";
import { thuTuRot } from "./thu-tu-rot";

const COC = 2_000_000;

function dongCocCaNha(): DongPhieuGop[] {
  return [
    {
      paymentRequestId: "pr-a-d1",
      sortOrder: thuTuRot({ thuTuDong: 0, installmentNo: 1 }),
      amount: 1_000_000,
      amountDue: 1_000_000,
      daRot: 0,
    },
    {
      paymentRequestId: "pr-b-d1",
      sortOrder: thuTuRot({ thuTuDong: 1, installmentNo: 1 }),
      amount: 1_000_000,
      amountDue: 1_000_000,
      daRot: 0,
    },
  ];
}

/** Phiếu gộp "đợt 1 của cả nhà": đúng hai dòng, mỗi bé một. */
const phieuCocCaNha = (
  trangThai: PhieuGopDeChia["trangThai"] = "OPEN",
  dong = dongCocCaNha(),
): PhieuGopDeChia => ({ billId: "KT-01", trangThai, dong });

describe("[CPG-01] ĐÚNG SỐ ⇒ chia đích danh, phiếu thu đủ", () => {
  it("2.000.000đ vào phiếu 2.000.000đ ⇒ mỗi bé 1.000.000đ", () => {
    // Ca nghiệp vụ gốc: *"đợt 1 đóng học phí cho cả 2 (hoặc cọc học phí)"*. Thứ giải được ca
    // này không phải một thuật toán khôn hơn, mà là việc Ý ĐỊNH ĐƯỢC KHAI BÁO trên phiếu gộp —
    // xem ca `[KHC-04]` bên `ke-hoach-theo-con.test.ts` cho vế ngược lại (tiền đi tay không).
    const r = chiaTheoPhieuGop(COC, phieuCocCaNha());
    expect(r.chia).toBe(true);
    expect(r.chia === true && r.lines).toEqual([
      { paymentRequestId: "pr-a-d1", amount: 1_000_000 },
      { paymentRequestId: "pr-b-d1", amount: 1_000_000 },
    ]);
    expect(r.chia === true && r.tongRot).toBe(COC);
  });

  it("số in lên QR = số CÒN phải thu, tính ở đúng một chỗ", () => {
    expect(conPhaiThuCuaPhieu(dongCocCaNha())).toBe(COC);
  });

  it("Σ dòng chia LUÔN bằng số tiền về — không đồng nào rơi ra ngoài", () => {
    const r = chiaTheoPhieuGop(COC, phieuCocCaNha());
    expect(r.chia === true && r.lines.reduce((s, l) => s + l.amount, 0)).toBe(COC);
  });
});

describe("[CPG-02] LỆCH SỐ ⇒ KHÔNG chia gì, dù chỉ 1đ", () => {
  it("THỪA 1đ ⇒ không chia, mã LECH_SO", () => {
    const r = chiaTheoPhieuGop(COC + 1, phieuCocCaNha());
    expect(r.chia).toBe(false);
    expect(r.chia === false && r.ma).toBe("LECH_SO");
    expect(r.chia === false && r.conPhaiThu).toBe(COC);
    expect(r.chia === false && r.moTa).toContain("thừa 1đ");
  });

  it("THIẾU 1đ ⇒ không chia, mã LECH_SO", () => {
    // Đánh đổi có chủ đích, và nó khắc nghiệt: khách chuyển thiếu 1đ thì KHÔNG đợt nào được ghi
    // nhận, kế toán hoàn cả khoản. Chủ dự án đã ra cách đo: sau 1 tháng chạy thật, nếu có ca
    // lệch số thì báo lại. ĐỪNG tự nới trước khi có số đó.
    const r = chiaTheoPhieuGop(COC - 1, phieuCocCaNha());
    expect(r.chia === false && r.ma).toBe("LECH_SO");
    expect(r.chia === false && r.moTa).toContain("thiếu 1đ");
  });

  it("KHÔNG có nhánh 'thiếu lấp dần' và KHÔNG có nhánh 'thừa vào ví'", () => {
    // Hai nhánh này là thiết kế ban đầu (BA 4.3) và đã bị BỎ. Chúng là cái đuôi phải dọn: ví có
    // tiền ⇒ màn chia ví ⇒ quyền ⇒ bất biến ⇒ báo cáo. Ca này ghim rằng chúng KHÔNG quay lại.
    for (const so of [1, 500_000, 1_999_999, 2_000_001, 5_000_000]) {
      const r = chiaTheoPhieuGop(so, phieuCocCaNha());
      expect(r.chia, `${so}đ`).toBe(false);
    }
  });

  it("0đ và số RÁC rơi vào nhánh an toàn (không chia), KHÔNG ném", () => {
    // Hàm chạy trong đường xử webhook: một ngoại lệ ở đây làm cả lượt nhận tiền thất bại, và
    // tiền đã vào tài khoản mà hệ thống không lưu được gì là ca tệ nhất trong mọi ca.
    for (const so of [0, -5_000, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(chiaTheoPhieuGop(so, phieuCocCaNha()).chia, String(so)).toBe(false);
    }
  });
});

describe("[CPG-03] PHIẾU KHÔNG CÒN MỞ ⇒ không chia, và lý do phải ĐÚNG", () => {
  it("quét lại phiếu ĐÃ PAID ⇒ PHIEU_KHONG_MO, không phải LECH_SO", () => {
    // Phụ huynh lưu ảnh QR rồi chuyển lần hai (pre-mortem T9). Phiếu PAID có "còn phải thu" = 0
    // nên nếu kiểm SỐ trước TRẠNG THÁI thì lý do báo ra sẽ là "lệch số" — và kế toán sẽ đi tìm
    // một khoản lệch không tồn tại thay vì thấy ngay "khách chuyển trùng".
    const daRotDu = dongCocCaNha().map((d) => ({ ...d, daRot: d.amountDue }));
    const r = chiaTheoPhieuGop(COC, phieuCocCaNha("PAID", daRotDu));
    expect(r.chia === false && r.ma).toBe("PHIEU_KHONG_MO");
    expect(r.chia === false && r.moTa).toContain("ĐÃ THU ĐỦ");
  });

  it("phiếu ĐÃ HUỶ ⇒ PHIEU_KHONG_MO, dù số tiền khớp", () => {
    const r = chiaTheoPhieuGop(COC, phieuCocCaNha("VOID"));
    expect(r.chia === false && r.ma).toBe("PHIEU_KHONG_MO");
    expect(r.chia === false && r.moTa).toContain("ĐÃ HUỶ");
  });

  it("không tra ra phiếu nào ⇒ KHONG_KHOP_PHIEU, `conPhaiThu` là null", () => {
    const r = chiaTheoPhieuGop(3_000_000, null);
    expect(r.chia === false && r.ma).toBe("KHONG_KHOP_PHIEU");
    expect(r.chia === false && r.conPhaiThu).toBeNull();
  });

  it("`CLOSED` KHÔNG được dùng ở luồng mới — nhưng vẫn phải không chia", () => {
    // Trạng thái này sinh ra cho ý tưởng "đóng phiếu khi đã nhận một phần", và luật mới không
    // có tình trạng đó nữa. Không đường ghi nào được đặt nó; nếu vì lý do gì nó xuất hiện thì
    // hành vi an toàn là KHÔNG chia.
    expect(chiaTheoPhieuGop(COC, phieuCocCaNha("CLOSED")).chia).toBe(false);
  });
});

describe("[CPG-04] `conPhaiThu` là CÒN, không phải TỔNG", () => {
  it("dòng đã được lấp từ đường khác ⇒ QR in số nhỏ hơn, và tiền khớp số nhỏ đó", () => {
    // Ca thật: bé B nghỉ, dư 1.000.000 bù sang đợt của bé A. Phiếu gộp phát sau đó phải in số
    // đã trừ phần bù — nếu in số gốc thì khách chuyển đúng số gốc và hệ thống từ chối chia.
    const dong = dongCocCaNha();
    dong[0]!.daRot = 400_000;
    expect(conPhaiThuCuaPhieu(dong)).toBe(1_600_000);

    const r = chiaTheoPhieuGop(1_600_000, phieuCocCaNha("OPEN", dong));
    expect(r.chia === true && r.lines).toEqual([
      { paymentRequestId: "pr-a-d1", amount: 600_000 },
      { paymentRequestId: "pr-b-d1", amount: 1_000_000 },
    ]);
  });

  it("dòng đã đủ tiền ⇒ KHÔNG ghi dòng phân bổ 0đ", () => {
    const dong = dongCocCaNha();
    dong[0]!.daRot = dong[0]!.amountDue;
    const r = chiaTheoPhieuGop(1_000_000, phieuCocCaNha("OPEN", dong));
    expect(r.chia === true && r.lines).toEqual([
      { paymentRequestId: "pr-b-d1", amount: 1_000_000 },
    ]);
  });

  it("MỌI dòng đã đủ ⇒ `conPhaiThu` = 0, và tiền về bất kỳ đều KHÔNG chia", () => {
    const dong = dongCocCaNha().map((d) => ({ ...d, daRot: d.amountDue }));
    expect(conPhaiThuCuaPhieu(dong)).toBe(0);
    expect(chiaTheoPhieuGop(COC, phieuCocCaNha("OPEN", dong)).chia).toBe(false);
  });

  it("KHÔNG rót quá phần đã hứa trên tờ QR, dù phiếu thu còn nợ nhiều hơn", () => {
    // Dòng cọc của bé A chỉ hứa 1.000.000, trong khi phiếu thu đó có thể là phiếu "cả khoá" còn
    // thiếu 8.976.000. Rót vượt là ghi một con số khách chưa từng đồng ý.
    const dong = dongCocCaNha();
    dong[0]!.amountDue = 8_976_000;
    expect(conPhaiThuCuaPhieu(dong)).toBe(COC);
    const r = chiaTheoPhieuGop(COC, phieuCocCaNha("OPEN", dong));
    expect(r.chia === true && r.lines[0]).toEqual({ paymentRequestId: "pr-a-d1", amount: 1_000_000 });
  });
});

describe("[CPG-05] thứ tự dòng là của PHIẾU, và phải TẤT ĐỊNH", () => {
  it("dòng truyền vào lộn xộn vẫn rót theo `sortOrder`", () => {
    const r = chiaTheoPhieuGop(COC, phieuCocCaNha("OPEN", dongCocCaNha().reverse()));
    expect(r.chia === true && r.lines[0]!.paymentRequestId).toBe("pr-a-d1");
  });

  it("hai dòng TRÙNG `sortOrder` (dữ liệu hỏng) vẫn cho kết quả GIỐNG NHAU mọi lượt", () => {
    // Ngẫu nhiên ở đây nghĩa là cùng một khoản tiền chia khác nhau giữa hai lần chạy lại —
    // không đối soát được, và không ai giải thích nổi cho kế toán.
    const hong = (): DongPhieuGop[] => [
      { paymentRequestId: "pr-z", sortOrder: 7, amount: 500_000, amountDue: 500_000, daRot: 0 },
      { paymentRequestId: "pr-a", sortOrder: 7, amount: 500_000, amountDue: 500_000, daRot: 0 },
    ];
    const l1 = chiaTheoPhieuGop(1_000_000, { billId: "b", trangThai: "OPEN", dong: hong() });
    const l2 = chiaTheoPhieuGop(1_000_000, { billId: "b", trangThai: "OPEN", dong: hong().reverse() });
    expect(l1.chia === true && l1.lines).toEqual(l2.chia === true && l2.lines);
    expect(l1.chia === true && l1.lines[0]!.paymentRequestId).toBe("pr-a");
  });

  it("KHÔNG sửa mảng người gọi truyền vào", () => {
    // Đường webhook dùng lại mảng này để ghi `PaymentAllocation`; sắp tại chỗ là đổi thứ tự
    // dưới chân người gọi.
    const dong = dongCocCaNha().reverse();
    const truoc = dong.map((x) => x.paymentRequestId);
    chiaTheoPhieuGop(COC, phieuCocCaNha("OPEN", dong));
    expect(dong.map((x) => x.paymentRequestId)).toEqual(truoc);
  });
});

describe("[CPG-06] chống TRÙNG giao dịch KHÔNG nằm ở hàm này", () => {
  it("hàm thuần không biết `bankTxnId` — và đó là chủ ý", () => {
    // *"bắn trùng bankTxnId → không làm gì"* là một câu TRA DB (`@@unique([provider,
    // providerTxnId])` trên `BankTransaction`), không phải một phép tính. Nhét nó vào đây là
    // buộc hàm thuần nhận một tham số nó không kiểm được, tức mời người gọi truyền bừa.
    //
    // Ca này ghim ranh giới: gọi hàm HAI LẦN với cùng đầu vào cho cùng kết quả (thuần), và việc
    // "lần thứ hai thì bỏ qua" là trách nhiệm của tầng gọi.
    const a = chiaTheoPhieuGop(COC, phieuCocCaNha());
    const b = chiaTheoPhieuGop(COC, phieuCocCaNha());
    expect(a).toEqual(b);
  });
});

describe("[CPG-07] ba con — không có gì đặc biệt, và đó là điểm mạnh", () => {
  const baCon = (): DongPhieuGop[] =>
    [0, 1, 2].map((i) => ({
      paymentRequestId: `pr-${i}`,
      sortOrder: thuTuRot({ thuTuDong: i, installmentNo: 1 }),
      amount: 1_500_000,
      amountDue: 1_500_000,
      daRot: 0,
    }));

  it("đúng 4.500.000 ⇒ ba dòng đủ", () => {
    const r = chiaTheoPhieuGop(4_500_000, { billId: "b3", trangThai: "OPEN", dong: baCon() });
    expect(r.chia === true && r.lines.map((l) => l.amount)).toEqual([1_500_000, 1_500_000, 1_500_000]);
  });

  it("thiếu ⇒ KHÔNG bé nào được ghi nhận (không còn 'lấp dần')", () => {
    const r = chiaTheoPhieuGop(3_200_000, { billId: "b3", trangThai: "OPEN", dong: baCon() });
    expect(r.chia).toBe(false);
    expect(r.chia === false && r.conPhaiThu).toBe(4_500_000);
  });
});
