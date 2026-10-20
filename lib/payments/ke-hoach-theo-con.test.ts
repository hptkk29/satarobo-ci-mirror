// Ca [KHC-*] — kế hoạch đóng tiền CHIA THEO TỪNG CON.
//
// Ca nghiệp vụ gốc, chủ dự án 16/09/2026: *"PH có 2 con nhưng đợt 1 đóng học phí cho cả 2
// (hoặc cọc học phí) nhưng sang đợt 2 lại chỉ muốn đóng cho 1 bạn còn 1 bạn không cho học
// nữa"*. Fixture dưới đây LÀ chính ca đó, dựng bằng SỐ THẬT của đơn `ORD-260915-000007`
// (bé A Sata3 8.976.000đ · bé B Sata4 9.492.000đ · cọc 2.000.000đ · tổng 18.468.000đ).
//
// Dữ liệu tròn trịa trong test là dữ liệu không kiểm được gì — 3.988.000 và 8.492.000 dưới
// đây là số chia thật, không phải số cho đẹp.
import { describe, it, expect } from "vitest";
import { planAllocation, type AllocTarget } from "@/lib/payments/allocation";
import { chiaTheoPhieuGop } from "./chia-phieu-gop";
import {
  gopDotTheoDon,
  kiemKeHoachTheoCon,
  phieuThuTheoCon,
  type DongKeHoach,
} from "./ke-hoach-theo-con";

const HAN_1 = new Date("2026-09-20T00:00:00.000Z");
const HAN_2 = new Date("2026-10-20T00:00:00.000Z");
const HAN_2B = new Date("2026-10-25T00:00:00.000Z");
const HAN_3 = new Date("2026-11-20T00:00:00.000Z");

/**
 * Hai con, và bé B DỪNG sau đợt 2 — thể hiện bằng việc dòng của bé B chỉ có 2 đợt.
 * Không có ô "miễn", không có số 0: bé B đơn giản là không có đợt 3.
 */
function donHaiCon(): DongKeHoach[] {
  return [
    {
      thuTuDong: 0,
      orderItemId: "oi-be-a",
      tenDong: "Nguyễn Minh An",
      thanhTien: 8_976_000,
      dots: [
        { amount: 1_000_000, daThu: false, dueDate: HAN_1 },
        { amount: 3_988_000, daThu: false, dueDate: HAN_2 },
        { amount: 3_988_000, daThu: false, dueDate: HAN_3 },
      ],
    },
    {
      thuTuDong: 1,
      orderItemId: "oi-be-b",
      tenDong: "Nguyễn Minh Bảo",
      thanhTien: 9_492_000,
      dots: [
        { amount: 1_000_000, daThu: false, dueDate: HAN_1 },
        { amount: 8_492_000, daThu: false, dueDate: HAN_2B },
      ],
    },
  ];
}

const TONG_DON = 18_468_000;

describe("[KHC-01] cổng kiểm — và mọi câu lỗi phải GỌI TÊN đứa trẻ", () => {
  it("ca thật của chủ dự án (đợt 1 cả hai, đợt 3 chỉ một bé) là HỢP LỆ", () => {
    expect(kiemKeHoachTheoCon(donHaiCon(), TONG_DON)).toEqual({
      ok: true,
      coDotChuaThu: true,
    });
  });

  it("Σ đợt của MỘT bé lệch ⇒ lỗi nêu TÊN BÉ và ĐÚNG số lệch", () => {
    const d = donHaiCon();
    d[0]!.dots[2]!.amount = 3_000_000; // thiếu 988.000 của riêng bé A
    const r = kiemKeHoachTheoCon(d, TONG_DON);
    expect(r.ok).toBe(false);
    // Người sửa là sale đứng trước phụ huynh: câu lỗi phải nói SAI Ở BÉ NÀO và LỆCH BAO
    // NHIÊU, không phải "tổng không khớp" rồi để họ tự dò hai cột.
    expect(r.ok === false && r.error).toContain("Nguyễn Minh An");
    expect(r.ok === false && r.error).toContain("988.000");
    expect(r.ok === false && r.error).toContain("thiếu");
    // Và KHÔNG được đổ lỗi cho bé kia.
    expect(r.ok === false && r.error).not.toContain("Nguyễn Minh Bảo");
  });

  it("khai THỪA cũng bắt, và nói đúng chữ 'thừa'", () => {
    const d = donHaiCon();
    d[1]!.dots[1]!.amount = 9_000_000;
    const r = kiemKeHoachTheoCon(d, TONG_DON);
    expect(r.ok === false && r.error).toContain("Nguyễn Minh Bảo");
    expect(r.ok === false && r.error).toContain("thừa");
    expect(r.ok === false && r.error).toContain("508.000");
  });

  it("HAI DÒNG TRÙNG THỨ TỰ bị chặn — đây là lỗi tiền im lặng, không phải lỗi hình thức", () => {
    // Trùng `thuTuDong` ⇒ hai phiếu cùng `sortOrder` ⇒ thứ tự rót rơi về so sánh cuid.
    // Tiền của nhà lấp nửa đợt 1 bé A rồi nhảy sang bé B, không ai đoán được.
    const d = donHaiCon();
    d[1]!.thuTuDong = 0;
    const r = kiemKeHoachTheoCon(d, TONG_DON);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("trùng thứ tự");
  });

  it("đợt chưa thu mà thiếu hạn ⇒ nêu tên bé VÀ số thứ tự đợt", () => {
    const d = donHaiCon();
    d[0]!.dots[1]!.dueDate = null;
    const r = kiemKeHoachTheoCon(d, TONG_DON);
    expect(r.ok === false && r.error).toContain("Nguyễn Minh An");
    expect(r.ok === false && r.error).toContain("đợt 2");
  });

  it("dòng KHÔNG có đợt nào ⇒ từ chối (không im lặng bỏ qua bé đó)", () => {
    const d = donHaiCon();
    d[1]!.dots = [];
    expect(kiemKeHoachTheoCon(d, TONG_DON).ok).toBe(false);
  });

  it("tổng các dòng ≠ tổng đơn ⇒ lỗi chỉ vào phép tính THÀNH TIỀN, không vào kế hoạch", () => {
    // Từng dòng vẫn khớp Σ của nó — chỉ tổng đơn truyền vào là sai.
    const r = kiemKeHoachTheoCon(donHaiCon(), TONG_DON + 1_000);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("không khớp tổng đơn");
  });

  it("dòng không có tên vẫn phải gọi được — không ra câu lỗi cụt", () => {
    const d = donHaiCon();
    d[0]!.tenDong = "";
    d[0]!.dots[0]!.amount = 999;
    const r = kiemKeHoachTheoCon(d, TONG_DON);
    expect(r.ok === false && r.error).toContain("dòng thứ 1");
  });
});

describe("[KHC-02] sinh phiếu — thứ tự rót là DÒNG trước, ĐỢT sau", () => {
  it("mỗi (dòng × đợt) một phiếu; tổng số phiếu = tổng số đợt của các con", () => {
    const p = phieuThuTheoCon(donHaiCon());
    expect(p).toHaveLength(5); // 3 của bé A + 2 của bé B
    expect(p.reduce((s, x) => s + x.amountDue, 0)).toBe(TONG_DON);
  });

  it("HẾT các đợt của bé A rồi mới tới bé B", () => {
    const p = phieuThuTheoCon(donHaiCon());
    expect(p.map((x) => x.orderItemId)).toEqual([
      "oi-be-a",
      "oi-be-a",
      "oi-be-a",
      "oi-be-b",
      "oi-be-b",
    ]);
  });

  it("`installmentNo` đếm TRONG DÒNG, không đếm trong đơn", () => {
    // Đợt đầu của bé B là đợt 1 CỦA BÉ B, không phải đợt 4 của đơn. Đếm theo đơn là mất
    // luôn khả năng nói "bé B còn thiếu đợt 2".
    const p = phieuThuTheoCon(donHaiCon());
    expect(p.filter((x) => x.orderItemId === "oi-be-b").map((x) => x.installmentNo)).toEqual([1, 2]);
  });

  it("`sortOrder` KHÔNG được trùng nhau", () => {
    const p = phieuThuTheoCon(donHaiCon());
    expect(new Set(p.map((x) => x.sortOrder)).size).toBe(p.length);
  });

  it("KHÔNG sinh `matchKey` — khoá đối khớp nằm ở PHIẾU GỘP", () => {
    // Ngân sách nội dung CK là 17 ký tự cho khoá (17 + 1 + 7 = 25 khít). `…D1` đã đúng 17,
    // nên thêm chiều DÒNG vào khoá là cắt tên con còn 5 ký tự. Luồng mới đặt khoá ở
    // `PaymentBill` — "QR theo ĐƠN".
    const p = phieuThuTheoCon(donHaiCon());
    for (const x of p) expect(Object.keys(x)).not.toContain("matchKey");
  });
});

describe("[KHC-03] gộp về `OrderInstallment` — một chiều, và chỉ ở đây", () => {
  it("đợt nào chỉ một bé đóng thì đợt gộp bằng đúng tiền bé đó", () => {
    const g = gopDotTheoDon(donHaiCon());
    expect(g.map((x) => x.amount)).toEqual([
      2_000_000, // đợt 1: cả hai bé
      12_480_000, // đợt 2: 3.988.000 + 8.492.000
      3_988_000, // đợt 3: CHỈ bé A — bé B đã nghỉ
    ]);
  });

  it("Σ sổ gộp === Σ sổ theo con === tổng đơn", () => {
    const d = donHaiCon();
    expect(gopDotTheoDon(d).reduce((s, x) => s + x.amount, 0)).toBe(TONG_DON);
    expect(phieuThuTheoCon(d).reduce((s, x) => s + x.amountDue, 0)).toBe(TONG_DON);
  });

  it("hạn của đợt gộp là hạn SỚM NHẤT — không hoãn nhắc nợ cả nhà vì một bé được gia hạn", () => {
    const g = gopDotTheoDon(donHaiCon());
    expect(g[1]!.dueDate?.toISOString()).toBe(HAN_2.toISOString()); // 20/10 chứ không 25/10
  });

  it("MỘT bé đã thu, bé kia CHƯA ⇒ đợt gộp KHÔNG được coi là đã thu", () => {
    // Đây đúng là trạng thái sổ gộp không biểu diễn được, và cũng đúng là lý do sổ theo
    // con tồn tại. Đánh dấu đã thu ở đây là khai man tiền vào Ledger-A.
    const d = donHaiCon();
    d[0]!.dots[0]!.daThu = true;
    d[0]!.dots[0]!.dueDate = null;
    const g = gopDotTheoDon(d);
    expect(g[0]!.daThu).toBe(false);
    expect(g[0]!.dueDate).not.toBeNull(); // vẫn còn hạn để đòi phần bé B
  });

  it("bé DỪNG có thể là dòng ĐẦU — gộp phải chạy tới dòng có NHIỀU đợt nhất", () => {
    // Ca này thêm SAU khi cấy "gộp chỉ chạy tới số đợt của dòng đầu" KHÔNG làm lưới đỏ:
    // fixture gốc để bé nhiều đợt nhất ở dòng đầu, nên lỗi ấy vô hình. Đời thật thì bé
    // nghỉ có thể là bé nào, kể cả bé sale nhập trước.
    const d = donHaiCon();
    d[0]!.dots = [
      { amount: 1_000_000, daThu: false, dueDate: HAN_1 },
      { amount: 7_976_000, daThu: false, dueDate: HAN_2 },
    ];
    d[1]!.dots = [
      { amount: 1_000_000, daThu: false, dueDate: HAN_1 },
      { amount: 4_246_000, daThu: false, dueDate: HAN_2 },
      { amount: 4_246_000, daThu: false, dueDate: HAN_3 },
    ];
    expect(kiemKeHoachTheoCon(d, TONG_DON).ok).toBe(true);
    const g = gopDotTheoDon(d);
    expect(g).toHaveLength(3);
    expect(g[2]!.amount).toBe(4_246_000); // đợt 3 CHỈ của bé B — dòng thứ hai
  });

  it("đợt gộp đã thu ⇒ hạn về null KỂ CẢ khi các dòng vẫn còn mang hạn", () => {
    // Ca này cũng thêm sau một lượt cấy LỌT: fixture cũ xoá hạn cùng lúc đặt `daThu`, nên
    // phép "đã thu thì bỏ hạn" thành mã chết trước mắt lưới. Người gọi KHÔNG chắc đã xoá
    // hạn — `dotsGhiTuForm` có làm, đường theo con thì chưa chắc — và hạn còn sót trên
    // một đợt đã thu là cron nhắc nợ xếp hàng trên tiền đã nằm trong két.
    const d = donHaiCon();
    for (const x of d) x.dots[0]!.daThu = true; // GIỮ NGUYÊN dueDate
    const g = gopDotTheoDon(d);
    expect(g[0]!.daThu).toBe(true);
    expect(g[0]!.dueDate).toBeNull();
  });

  it("MỌI bé đã thu ⇒ đợt gộp đã thu, và hạn về null", () => {
    const d = donHaiCon();
    for (const x of d) {
      x.dots[0]!.daThu = true;
      x.dots[0]!.dueDate = null;
    }
    const g = gopDotTheoDon(d);
    expect(g[0]!.daThu).toBe(true);
    expect(g[0]!.dueDate).toBeNull();
  });
});

describe("[KHC-04] nối với bộ chia đã có — và GIỚI HẠN THẬT của nó", () => {
  const dich = (): AllocTarget[] =>
    phieuThuTheoCon(donHaiCon()).map((p) => ({
      id: `${p.orderItemId}-d${p.installmentNo}`,
      amountDue: p.amountDue,
      allocated: 0,
      sortOrder: p.sortOrder,
      status: "PENDING",
    }));

  it("tiền KHÔNG gắn phiếu gộp thì lấp HẾT bé A rồi mới sang bé B", () => {
    const r = planAllocation(8_976_000, dich());
    expect(r.lines.map((l) => l.paymentRequestId)).toEqual([
      "oi-be-a-d1",
      "oi-be-a-d2",
      "oi-be-a-d3",
    ]);
  });

  it("thiếu thì lấp DẦN, KHÔNG chia tỷ lệ", () => {
    // Chủ dự án: *"thiếu lấp dần, thừa vào ví gia đình. Không chia theo tỷ lệ."*
    // 1.500.000 lấp trọn đợt 1 (1.000.000) rồi 500.000 vào đợt KẾ TIẾP theo thứ tự —
    // chứ không phải mỗi phiếu một nửa.
    const r = planAllocation(1_500_000, dich());
    expect(r.lines).toEqual([
      { paymentRequestId: "oi-be-a-d1", amount: 1_000_000, roundingWaived: 0 },
      { paymentRequestId: "oi-be-a-d2", amount: 500_000, roundingWaived: 0 },
    ]);
  });

  it("thừa cả đơn ⇒ phần dư ra ví gia đình, không rót bừa", () => {
    const r = planAllocation(TONG_DON + 250_000, dich());
    expect(r.credit).toBe(250_000);
    expect(r.lines.reduce((s, l) => s + l.amount, 0)).toBe(TONG_DON);
  });

  it("⚠️ GIỚI HẠN: cọc 2.000.000 của CẢ NHÀ mà đi tay không thì KHÔNG lấp đợt 1 hai bé", () => {
    // Đây là ca nghiệp vụ gốc của chủ dự án (*"đợt 1 đóng học phí cho cả 2"*), và nó là
    // ca mà thứ tự rót toàn cục KHÔNG giải được — đúng 2.000.000đ cọc của nhà lại lấp
    // đợt 1 bé A (1.000.000) rồi TRÀN sang đợt 2 của chính bé A, để bé B trắng.
    //
    // Không phải lỗi bộ chia: tiền đi tay không thì hệ thống KHÔNG BIẾT nhà muốn gì.
    // 2.000.000 có thể là "cọc cho hai bé" mà cũng có thể là "đóng trước cho bé A".
    // Một thứ tự toàn cục nào cũng đoán sai một nửa số ca.
    //
    // Lời giải là PHIẾU GỘP: sale phát một phiếu "đợt 1 của cả nhà" gồm ĐÚNG hai dòng
    // (bé A đợt 1, bé B đợt 1), và webhook chia theo thứ tự dòng CỦA PHIẾU ĐÓ. Đó chính
    // là *"QR theo ĐƠN"* + *"chia đích danh theo thứ tự dòng"*.
    //
    // Ca này ghim GIỚI HẠN để không ai đọc nhầm `sortOrder` thành một lời hứa nghiệp vụ.
    const r = planAllocation(2_000_000, dich());
    expect(r.lines.map((l) => l.paymentRequestId)).toEqual(["oi-be-a-d1", "oi-be-a-d2"]);
    expect(r.lines.some((l) => l.paymentRequestId.startsWith("oi-be-b"))).toBe(false);
  });

  it("phiếu GỘP 'đợt 1 cả nhà' rót ĐÚNG hai bé — cùng số tiền, khác kết quả", () => {
    // Đã xây (`chia-phieu-gop.ts`) — ghim hẹn đã gỡ. Ca này đứng cạnh ca trên để đọc được
    // cả hai vế: CÙNG 2.000.000đ, cùng đơn, chỉ khác là tiền có gắn phiếu gộp hay không.
    const p = phieuThuTheoCon(donHaiCon());
    const dotMotCuaCaNha = p
      .filter((x) => x.installmentNo === 1)
      .map((x) => ({
        paymentRequestId: `${x.orderItemId}-d1`,
        sortOrder: x.sortOrder,
        amount: x.amountDue,
        amountDue: x.amountDue,
        daRot: 0,
      }));
    const r = chiaTheoPhieuGop(2_000_000, {
      billId: "KT-coc",
      trangThai: "OPEN",
      dong: dotMotCuaCaNha,
    });
    expect(r.chia === true && r.lines).toEqual([
      { paymentRequestId: "oi-be-a-d1", amount: 1_000_000 },
      { paymentRequestId: "oi-be-b-d1", amount: 1_000_000 },
    ]);
  });
});

// ⚠️ Khối `[KHC-05]` (công tắc env `PAYMENT_PER_CHILD_ENABLED`) đã GỠ chiều 16/09/2026: chủ dự
// án chốt công tắc nằm ở DB (`SystemSetting billing.flexV1Enabled` + override theo cơ sở), không
// nằm ở env. Ca kiểm công tắc nay ở `lib/finance/feature.test.ts` — `[FEAT-01..04]`.
