// Ca [NTC-*] — công nợ theo từng con + cổng tạo/huỷ đợt (PHIÊN A).
//
// Sáu nhóm chủ dự án yêu cầu, và CÁCH kiểm từng nhóm:
//   1 · tạo đợt An/Bình, vượt còn nợ → chặn      → [NTC-02] thuần
//   2 · Payment của An không đổi nợ Bình          → [NTC-01] thuần
//   3 · "Lưu kế hoạch" → số dòng Payment không đổi → [NTC-05] LƯỚI GHIM MÃ NGUỒN
//   4 · huỷ đơn → đợt chưa PAID thành VOID         → [NTC-05] LƯỚI GHIM MÃ NGUỒN
//   5 · hai người khác cơ sở → cùng con số         → [NTC-05] LƯỚI GHIM MÃ NGUỒN
//   6 · công tắc tắt/bật                           → [NTC-06] thuần + đã phủ ở `feature.test.ts`
//
// ⚠️ Vì sao 3·4·5 là lưới ghim mã nguồn chứ không phải test hành vi: cả ba là luật về HÌNH
// DẠNG ĐƯỜNG GHI ("không gọi hàm này", "phải gọi hàm kia", "đọc bằng client nào"), và đường đó
// chạm DB. `pnpm test:unit` của repo CẤM chạm DB (chốt 04/09 sau khi `resetDb()` xoá mất 250
// học viên). Một test hành vi cho chúng sẽ phải là test tích hợp — và test tích hợp thì không
// ai viết đủ ca. Theo luật 11: neo chuỗi hẹp, KHÔNG cờ `/s`, ĐẾM số lần khớp, BÓC CHÚ THÍCH.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  kiemHuyDot,
  kiemTaoDot,
  tinhNoTheoCon,
  tranTaoDot,
  type DotCuaDong,
  type DongDon,
  type KhoanDaVe,
} from "./no-theo-con";
import { giaiCongTac } from "./feature";

/**
 * Dựng một `KhoanDaVe` cho test thuần.
 *
 * ⚠️ Mặc định `loaiButToan: "PAYMENT"` + `daDao: false` là AN TOÀN **ở đây và chỉ ở đây**:
 * hai trường ấy KHÔNG tham gia phép cộng nào — chúng chỉ quyết định màn hình có mời bấm
 * "Gắn cho bé…" hay không (xem `KhoanDaVe`). Ca nào kiểm chính hai trường đó thì truyền tay,
 * đừng nhờ mặc định.
 *
 * Trường tham gia PHÉP CỘNG (`amount`, `orderItemId`) vẫn bắt buộc — luật 7 giữ nguyên hiệu
 * lực cho chúng.
 */
const kdv = (k: Omit<KhoanDaVe, "loaiButToan" | "daDao"> & Partial<KhoanDaVe>): KhoanDaVe => ({
  loaiButToan: "PAYMENT",
  daDao: false,
  ...k,
});
import {
  donNhanTienTuDong,
  locDonNhanTien,
  qrConRotDuocTien,
} from "@/lib/payments/don-nhan-tien";

/** Số của chủ dự án: An Sata3 8.640.000 · Bình Sata5 12.000.000. */
const AN = "oi-an";
const BINH = "oi-binh";

const dong = (): DongDon[] => [
  { orderItemId: AN, ten: "Nguyễn Minh An", khoa: "Sata3", tamTinh: 9_600_000, giam: 960_000 },
  { orderItemId: BINH, ten: "Nguyễn Minh Bình", khoa: "Sata5", tamTinh: 12_000_000, giam: 0 },
];

const dot = (
  orderItemId: string,
  installmentNo: number,
  amountDue: number,
  x: Partial<DotCuaDong> = {},
): DotCuaDong => ({
  id: `pr-${orderItemId}-${installmentNo}`,
  orderItemId,
  installmentNo,
  amountDue,
  dueDate: null,
  trangThai: "PENDING",
  daRot: 0,
  ...x,
});

describe("[NTC-01] công nợ tách theo con — tiền của bé này không đụng bé kia", () => {
  it("chưa thu gì ⇒ mỗi con nợ đúng học phí thực của mình", () => {
    const r = tinhNoTheoCon({ dong: dong(), khoanDaXacNhan: [], khoanChoXacNhan: [], khoanDaVe: [], dot: [] });
    expect(r.con.map((c) => c.phaiThu)).toEqual([8_640_000, 12_000_000]);
    expect(r.con.map((c) => c.conNo)).toEqual([8_640_000, 12_000_000]);
    expect(r.tongPhaiThu).toBe(20_640_000);
  });

  it("Payment gắn AN KHÔNG làm đổi còn nợ của BÌNH", () => {
    // Đây là toàn bộ điểm của phiên A. Trước khi có `Payment.orderItemId`, mọi khoản của đơn
    // đều là "tiền của đơn" và không cách nào nói bé nào đã đóng.
    const r = tinhNoTheoCon({
      dong: dong(),
      khoanDaXacNhan: [{ orderItemId: AN, amount: 4_320_000 }],
      khoanChoXacNhan: [],
      khoanDaVe: [kdv({ id: "pay-1", orderItemId: AN, amount: 4_320_000, trangThaiKeToan: "CONFIRMED" })],
      dot: [],
    });
    expect(r.con[0]!.daThu).toBe(4_320_000);
    expect(r.con[0]!.conNo).toBe(4_320_000);
    expect(r.con[1]!.daThu).toBe(0);
    expect(r.con[1]!.conNo).toBe(12_000_000); // KHÔNG đổi
  });

  it("khoản CHƯA XÁC NHẬN ra cột riêng, KHÔNG trừ vào còn nợ", () => {
    // Nói với phụ huynh rằng họ hết nợ rồi sau đó gọi lại đòi tiếp (vì kế toán từ chối khoản
    // đó) là thứ không sửa được bằng một bản vá.
    const r = tinhNoTheoCon({
      dong: dong(),
      khoanDaXacNhan: [],
      khoanChoXacNhan: [{ orderItemId: AN, amount: 4_320_000 }],
      khoanDaVe: [kdv({ id: "pay-2", orderItemId: AN, amount: 4_320_000, trangThaiKeToan: "CONFIRMED" })],
      dot: [],
    });
    expect(r.con[0]!.choXacNhan).toBe(4_320_000);
    expect(r.con[0]!.conNo).toBe(8_640_000); // vẫn nợ đủ
  });

  it("khoản CHƯA GẮN CON ra ô riêng, không cộng vào bé nào", () => {
    // 24 khoản / 178.544.000đ của prod nằm đúng ở đây.
    const r = tinhNoTheoCon({
      dong: dong(),
      khoanDaXacNhan: [{ orderItemId: null, amount: 5_000_000 }],
      khoanChoXacNhan: [],
      khoanDaVe: [kdv({ id: "pay-3", orderItemId: null, amount: 5_000_000, trangThaiKeToan: "CONFIRMED" })],
      dot: [],
    });
    expect(r.chuaGanCon).toBe(5_000_000);
    expect(r.tongDaThu).toBe(0);
    expect(r.con.every((c) => c.daThu === 0)).toBe(true);
  });

  it("đóng THỪA ⇒ còn nợ ÂM, trả số thô chứ không kẹp về 0", () => {
    // Kẹp về 0 là giấu mất chuyện khách đã trả dư — và đó là việc kế toán phải xử.
    const r = tinhNoTheoCon({
      dong: dong(),
      khoanDaXacNhan: [{ orderItemId: AN, amount: 9_000_000 }],
      khoanChoXacNhan: [],
      khoanDaVe: [kdv({ id: "pay-4", orderItemId: AN, amount: 9_000_000, trangThaiKeToan: "CONFIRMED" })],
      dot: [],
    });
    expect(r.con[0]!.conNo).toBe(-360_000);
  });

  it("chỉ đợt PENDING/PARTIAL là 'đang mở'; VOID và PAID không tính", () => {
    const r = tinhNoTheoCon({
      dong: dong(),
      khoanDaXacNhan: [],
      khoanChoXacNhan: [],
      khoanDaVe: [],
      dot: [
        dot(AN, 1, 4_320_000),
        dot(AN, 2, 1_000_000, { trangThai: "VOID" }),
        dot(AN, 3, 2_000_000, { trangThai: "PAID" }),
        dot(AN, 4, 500_000, { trangThai: "PARTIAL", daRot: 100_000 }),
      ],
    });
    expect(r.con[0]!.dotDangMo.map((d) => d.installmentNo)).toEqual([1, 4]);
    expect(r.con[0]!.tongDotDangMo).toBe(4_820_000);
  });

  it("đợt sắp theo HẠN SỚM trước; đợt KHÔNG hạn xuống CUỐI", () => {
    // Đợt thiếu hạn là đợt chưa ai xếp lịch, không phải đợt gấp nhất — để nó lên đầu là đảo
    // ngược thứ tự nhắc nợ.
    const r = tinhNoTheoCon({
      dong: dong(),
      khoanDaXacNhan: [],
      khoanChoXacNhan: [],
      khoanDaVe: [],
      dot: [
        dot(AN, 1, 1_000_000, { dueDate: null }),
        dot(AN, 2, 1_000_000, { dueDate: new Date("2026-12-01T00:00:00Z") }),
        dot(AN, 3, 1_000_000, { dueDate: new Date("2026-10-01T00:00:00Z") }),
      ],
    });
    expect(r.con[0]!.dotDangMo.map((d) => d.installmentNo)).toEqual([3, 2, 1]);
  });
});

describe("[NTC-02] cổng TẠO ĐỢT", () => {
  /**
   * Vế ĐƠN rộng rãi — dùng cho các ca chỉ muốn kiểm vế CON.
   *
   * ⚠️ Cố ý KHÔNG viết thành mặc định của `kiemTaoDot` (luật 7). Ở đây là fixture của test;
   * ở đó là một vế cổng không bao giờ cắn mà không ai biết.
   */
  const donThoai = { conNoDon: 999_000_000, tongDotDangMoDon: 0 };

  it("An 4.320.000 và Bình 6.000.000 — tạo được", () => {
    expect(
      kiemTaoDot({ soTien: 4_320_000, conNo: 8_640_000, tongDotDangMo: 0, tenCon: "An", ...donThoai }),
    ).toEqual({ ok: true, soTien: 4_320_000 });
    expect(
      kiemTaoDot({ soTien: 6_000_000, conNo: 12_000_000, tongDotDangMo: 0, tenCon: "Bình", ...donThoai }),
    ).toEqual({ ok: true, soTien: 6_000_000 });
  });

  it("VƯỢT còn nợ ⇒ chặn, và câu lỗi nói TÊN CON + SỐ TỐI ĐA", () => {
    const r = kiemTaoDot({
      soTien: 8_640_001,
      conNo: 8_640_000,
      tongDotDangMo: 0,
      tenCon: "An",
      ...donThoai,
    });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.loi).toContain("An");
    expect(r.ok === false && r.loi).toContain("8.640.000");
  });

  it("phải trừ Σ ĐỢT ĐANG MỞ — nếu không, hai QR cùng đòi đủ tiền", () => {
    // Đây là lỗi tiền im lặng: không cổng nào khác canh, và nó chỉ lộ ra khi khách đã chuyển
    // gấp đôi. An còn nợ 8.640.000 nhưng đã có một đợt mở 4.320.000 ⇒ tối đa còn 4.320.000.
    expect(
      kiemTaoDot({
        soTien: 4_320_000,
        conNo: 8_640_000,
        tongDotDangMo: 4_320_000,
        tenCon: "An",
        ...donThoai,
      }).ok,
    ).toBe(true);
    const vuot = kiemTaoDot({
      soTien: 4_320_001,
      conNo: 8_640_000,
      tongDotDangMo: 4_320_000,
      tenCon: "An",
      ...donThoai,
    });
    expect(vuot.ok).toBe(false);
    expect(vuot.ok === false && vuot.loi).toContain("4.320.000");
  });

  it("đợt đang mở đã phủ hết nợ ⇒ chặn với lý do RIÊNG, không phải 'vượt'", () => {
    const r = kiemTaoDot({
      soTien: 1,
      conNo: 8_640_000,
      tongDotDangMo: 8_640_000,
      tenCon: "An",
      ...donThoai,
    });
    expect(r.ok === false && r.loi).toContain("đã phủ hết");
  });

  it("số tiền ≤ 0 hoặc rác ⇒ chặn", () => {
    for (const x of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        kiemTaoDot({ soTien: x, conNo: 8_640_000, tongDotDangMo: 0, tenCon: "An", ...donThoai }).ok,
        String(x),
      ).toBe(false);
    }
  });

  it("KHÔNG có trần số đợt — sale tạo bao nhiêu đợt cũng được nếu tổng không vượt", () => {
    // Chủ dự án: *"Không bắt lên lịch cả khoá, không trần số đợt."* Đây là điểm khác hẳn kế
    // hoạch trả góp cũ (trần 12 đợt).
    let daMo = 0;
    for (let i = 0; i < 40; i++) {
      const r = kiemTaoDot({
        soTien: 100_000,
        conNo: 8_640_000,
        tongDotDangMo: daMo,
        tenCon: "An",
        // Vế đơn phải đi theo, kẻo ca này hoá thành ca kiểm vế đơn: 40 × 100.000 = 4.000.000.
        conNoDon: 999_000_000,
        tongDotDangMoDon: daMo,
      });
      expect(r.ok, `đợt thứ ${i + 1}`).toBe(true);
      daMo += 100_000;
    }
  });
});

describe("[NTC-02b] cổng TẠO ĐỢT — vế CẢ ĐƠN (khoản chưa gắn con)", () => {
  // ⚠️ CA NÀY LÀ LÝ DO VẾ THỨ HAI TỒN TẠI. Chủ dự án chốt 17/09/2026:
  //
  //     số tiền ≤ min( còn nợ con − Σ đợt mở của con ,
  //                    còn nợ ĐƠN − Σ đợt mở của cả đơn )
  //
  // Trước bản vá, cổng chỉ hỏi vế CON. `chuaGanCon` được tính từ PHIÊN A nhưng CHỈ để hiển
  // thị — hai màn in nó ra như một việc cần làm và không cổng nào đọc.

  it("đơn 2 con · 6.000.000 đã thu CHƯA GẮN CON ⇒ tạo đợt vượt còn nợ ĐƠN bị CHẶN", () => {
    // Hai bé, mỗi bé học phí 6.000.000 ⇒ đơn phải thu 12.000.000.
    // 6.000.000 đã vào đơn nhưng chưa gắn bé nào.
    //   · vế CON : bé An `conNo` = 6.000.000 (không biết gì về 6 triệu kia)
    //   · vế ĐƠN : 12.000.000 − 6.000.000 = 6.000.000 còn được thu
    // Tạo cho An 6.000.000 thì vế CON cho qua, nên nếu chỉ có vế CON thì sale tạo tiếp cho
    // Bình 6.000.000 nữa — tổng QR 12.000.000 trong khi đơn chỉ còn thiếu 6.000.000.
    const choAn = kiemTaoDot({
      soTien: 6_000_000,
      conNo: 6_000_000,
      tongDotDangMo: 0,
      tenCon: "An",
      conNoDon: 6_000_000,
      tongDotDangMoDon: 0,
    });
    expect(choAn.ok, "đợt đầu vẫn phải tạo được — nó nằm trong phần đơn còn thiếu").toBe(true);

    // Đợt thứ hai cho Bình: vế CON vẫn thoải mái (Bình còn nợ 6.000.000, chưa có đợt nào),
    // nhưng vế ĐƠN đã bị đợt của An chiếm hết.
    const choBinh = kiemTaoDot({
      soTien: 6_000_000,
      conNo: 6_000_000,
      tongDotDangMo: 0,
      tenCon: "Bình",
      conNoDon: 6_000_000,
      tongDotDangMoDon: 6_000_000,
    });
    expect(choBinh.ok).toBe(false);
    expect(choBinh.ok === false && choBinh.loi).toContain("đơn");
  });

  it("câu lỗi vế ĐƠN phải NÓI RA chỗ tiền đang nằm, không chỉ 'tối đa X'", () => {
    // Sale đọc số nợ của bé trên màn rồi gõ đúng số đó. Một câu "tối đa 2.976.000đ" trong khi
    // màn in "còn nợ 8.976.000đ" đọc như hệ thống bị lỗi — rồi người ta bỏ qua cổng.
    const r = kiemTaoDot({
      soTien: 8_976_000,
      conNo: 8_976_000,
      tongDotDangMo: 0,
      tenCon: "An",
      conNoDon: 2_976_000,
      tongDotDangMoDon: 0,
    });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.loi).toContain("2.976.000");
    expect(r.ok === false && r.loi).toContain("chưa gắn cho bé nào");
  });

  it("vế ĐƠN đã bị phủ hết ⇒ lý do RIÊNG, và nó chỉ thẳng sang khoản chưa gắn con", () => {
    const r = kiemTaoDot({
      soTien: 1,
      conNo: 8_976_000,
      tongDotDangMo: 0,
      tenCon: "An",
      conNoDon: 0,
      tongDotDangMoDon: 0,
    });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.loi).toContain("Cả đơn không còn phần được thu thêm");
    expect(r.ok === false && r.loi).toContain("chưa gắn cho bé nào");
  });

  it("đơn ĐÓNG THỪA (còn nợ đơn ÂM) ⇒ chặn mọi đợt mới", () => {
    const r = kiemTaoDot({
      soTien: 100_000,
      conNo: 5_000_000,
      tongDotDangMo: 0,
      tenCon: "An",
      conNoDon: -2_000_000,
      tongDotDangMoDon: 0,
    });
    expect(r.ok).toBe(false);
  });

  it("vế CON vẫn cắn trước khi vế ĐƠN cắn — thứ tự lỗi không đảo", () => {
    // Bé đã có đợt phủ hết nợ riêng, trong khi đơn còn chỗ. Câu lỗi phải là câu của BÉ, vì đó
    // là thứ sale sửa được ngay (bé này không còn gì để tạo đợt).
    const r = kiemTaoDot({
      soTien: 1,
      conNo: 3_000_000,
      tongDotDangMo: 3_000_000,
      tenCon: "An",
      conNoDon: 50_000_000,
      tongDotDangMoDon: 3_000_000,
    });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.loi).toContain("An");
    expect(r.ok === false && r.loi).toContain("đã phủ hết");
  });

  it("đơn KHÔNG có khoản chưa gắn con ⇒ vế ĐƠN không đổi hành vi cũ", () => {
    // Quan trọng: bản vá này không được làm hẹp đường đi của đơn sạch. Một con, học phí
    // 8.640.000, chưa thu gì, chưa có đợt ⇒ tạo trọn số vẫn phải được.
    expect(
      kiemTaoDot({
        soTien: 8_640_000,
        conNo: 8_640_000,
        tongDotDangMo: 0,
        tenCon: "An",
        conNoDon: 8_640_000,
        tongDotDangMoDon: 0,
      }).ok,
    ).toBe(true);
  });
});

describe("[NTC-02c] `tinhNoTheoCon` phải TỰ tính hai vế của đơn", () => {
  // Cổng chỉ đúng nếu nó được cho ăn bằng đường THẬT cho nó ăn (luật 9). Hai trường này do
  // `tinhNoTheoCon` sinh ra, nên chúng phải được kiểm ở đây — không phải ở test của cổng.
  //
  // Dùng dòng gõ tay (không phải `dong()`) vì ca này cần hai bé BẰNG NHAU 6.000.000 để phép
  // tính đọc ra ngay bằng mắt; bộ số 8.640.000/12.000.000 của `dong()` che mất điều đó.
  const haiBe: DongDon[] = [
    { orderItemId: AN, ten: "An", khoa: "Sata3", tamTinh: 6_000_000, giam: 0 },
    { orderItemId: BINH, ten: "Bình", khoa: "Sata5", tamTinh: 6_000_000, giam: 0 },
  ];

  it("`conNoDon` TRỪ khoản chưa gắn con, còn `tongConNo` thì KHÔNG", () => {
    const r = tinhNoTheoCon({
      dong: haiBe,
      khoanDaXacNhan: [{ orderItemId: null, amount: 6_000_000 }],
      khoanChoXacNhan: [],
      khoanDaVe: [kdv({ id: "pay-5", orderItemId: null, amount: 6_000_000, trangThaiKeToan: "CONFIRMED" })],
      dot: [],
    });
    expect(r.tongPhaiThu).toBe(12_000_000);
    expect(r.chuaGanCon).toBe(6_000_000);
    // Hai câu hỏi khác nhau ⇒ hai con số khác nhau. Gộp lại là chỗ bug tiền nằm.
    expect(r.tongConNo, "Σ còn nợ TỪNG CON — cố ý không trừ khoản chưa gắn").toBe(12_000_000);
    expect(r.conNoDon, "còn nợ CẢ ĐƠN — có trừ").toBe(6_000_000);
  });

  it("`tongDotDangMoDon` cộng CẢ đợt `orderItemId` NULL của luồng cũ", () => {
    // Đơn trước 16/09 thì đợt nào cũng NULL. Lấy `Σ con[].tongDotDangMo` làm cổng là bỏ sạch
    // chúng — tức mở toang đúng tập đơn cũ.
    const r = tinhNoTheoCon({
      dong: haiBe,
      khoanDaXacNhan: [],
      khoanChoXacNhan: [],
      khoanDaVe: [],
      dot: [dot(AN, 1, 1_000_000), { ...dot(AN, 2, 2_000_000), orderItemId: null }],
    });
    expect(r.con[0]!.tongDotDangMo, "vế CON chỉ thấy đợt của bé").toBe(1_000_000);
    expect(r.tongDotDangMoDon, "vế ĐƠN thấy cả đợt NULL").toBe(3_000_000);
  });

  it("đợt NULL đã VOID/PAID thì KHÔNG vào `tongDotDangMoDon`", () => {
    // "Đang mở" là PENDING/PARTIAL. Một đợt cũ đã VOID không được chiếm chỗ của đợt mới —
    // nếu nó chiếm, đơn cũ nào từng huỷ đợt sẽ không tạo được đợt nào nữa.
    const r = tinhNoTheoCon({
      dong: haiBe,
      khoanDaXacNhan: [],
      khoanChoXacNhan: [],
      khoanDaVe: [],
      dot: [
        { ...dot(AN, 1, 5_000_000, { trangThai: "VOID" }), orderItemId: null },
        { ...dot(AN, 2, 4_000_000, { trangThai: "PAID" }), orderItemId: null },
        { ...dot(AN, 3, 1_000_000, { trangThai: "PARTIAL" }), orderItemId: null },
      ],
    });
    expect(r.tongDotDangMoDon).toBe(1_000_000);
  });
});

describe("[NTC-03] cổng HUỶ ĐỢT", () => {
  it("đợt chưa có tiền ⇒ huỷ được", () => {
    expect(kiemHuyDot({ trangThai: "PENDING", daRot: 0 }).ok).toBe(true);
  });

  it("đợt ĐÃ CÓ TIỀN ⇒ không huỷ, kể cả 1đ", () => {
    const r = kiemHuyDot({ trangThai: "PENDING", daRot: 1 });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.loi).toContain("không huỷ được");
  });

  it("đo bằng `daRot`, KHÔNG bằng trạng thái — trạng thái có lúc chưa kịp tính lại", () => {
    // Một đợt còn `PENDING` mà đã có tiền rót vào vẫn là đợt có tiền. Tin `trangThai` ở đây là
    // huỷ mất một đợt đang giữ tiền thật.
    expect(kiemHuyDot({ trangThai: "PENDING", daRot: 500_000 }).ok).toBe(false);
    expect(kiemHuyDot({ trangThai: "VOID", daRot: 0 }).ok).toBe(false);
  });
});

describe("[NTC-04] tổng đơn = Σ các con", () => {
  it("cộng đúng, và KHÔNG đọc `Order.totalAmount`", () => {
    const r = tinhNoTheoCon({
      dong: dong(),
      khoanDaXacNhan: [
        { orderItemId: AN, amount: 4_320_000 },
        { orderItemId: BINH, amount: 6_000_000 },
      ],
      khoanChoXacNhan: [],
      khoanDaVe: [kdv({ id: "pay-6", orderItemId: AN, amount: 4_320_000, trangThaiKeToan: "CONFIRMED" }),
        kdv({ id: "pay-7", orderItemId: BINH, amount: 6_000_000, trangThaiKeToan: "CONFIRMED" }),],
      dot: [],
    });
    expect(r.tongDaThu).toBe(10_320_000);
    expect(r.tongConNo).toBe(10_320_000);
    expect(r.tongConNo).toBe(r.con.reduce((s, c) => s + c.conNo, 0));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LƯỚI GHIM MÃ NGUỒN — ba luật về HÌNH DẠNG đường ghi
// ─────────────────────────────────────────────────────────────────────────────

/** Bóc chú thích để lưới soi MÃ, không soi lời kể. `/\r?\n/` + `[^\n]*` — xem `feature.test.ts`. */
function docMa(duong: string): string {
  return readFileSync(resolve(process.cwd(), duong), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((d) => d.replace(/\/\/[^\n]*$/, ""))
    .join("\n");
}

describe("[NTC-05] ba lỗ đã bịt — luật về hình dạng đường ghi", () => {
  it("LỖ 1 · 'Lưu kế hoạch' KHÔNG chạm `Payment` khi công tắc bật", () => {
    // Chủ dự án: *"Lưu/sửa đợt không bao giờ chạm dòng Payment đã có."* Phép xoá mềm sinh ra
    // cho luồng CŨ (nơi kế hoạch tự đẻ dòng Ledger-A rồi phải tự dọn). Luồng MỚI không đẻ dòng
    // nào ⇒ mọi `Payment` đang có đều là TIỀN THẬT.
    const src = docMa("lib/orders/installments.ts");
    // Phải đọc cờ, và đọc theo cơ sở GIỮ ĐƠN (không theo người bấm).
    expect(src.match(/laThuTienLinhHoatBat\(\s*order\.orgUnitId\s*\)/g) ?? []).toHaveLength(1);
    // Và phép xoá mềm phải nằm TRONG nhánh cờ-tắt.
    const khoi = /if \(!batLuongMoi\) \{[\s\S]*?\n {4}\}/.exec(src)?.[0] ?? "";
    expect(khoi).not.toBe("");
    expect(khoi).toContain("tx.payment.updateMany");
    // Đúng MỘT chỗ xoá mềm Payment trong cả tệp — thêm chỗ thứ hai là mở lại lỗ.
    expect(src.match(/tx\.payment\.updateMany/g) ?? []).toHaveLength(1);
  });

  it("LỖ 2 · huỷ đơn PHẢI VOID mọi phiếu chưa PAID", () => {
    const src = docMa("app/(admin)/admin/orders/_actions.ts");
    const khoi = /if \(parsed\.data\.toStatus === "CANCELLED"\) \{[\s\S]*?\n {4}\}/.exec(src)?.[0] ?? "";
    expect(khoi).not.toBe("");
    expect(khoi).toContain("tx.paymentRequest.updateMany");
    // PARTIAL phải nằm trong danh sách: đó là phiếu khách ĐÃ từng quét thành công một lần —
    // phiếu nguy hiểm nhất, không phải phiếu để tha.
    expect(khoi).toMatch(/status:\s*\{\s*in:\s*\["PENDING",\s*"PARTIAL"\]\s*\}/);
    // Và mã QR đang sống phải chết theo, kẻo affordance nói dối.
    expect(khoi).toContain("tx.qrSession.updateMany");
  });

  it("LỖ 3 · vị từ 'đơn nhận tiền tự động' đúng HÀNH VI, cả ba vế là VÀ", () => {
    // ⚠️ Ca này viết lại sau một lượt cấy LỌT. Bản đầu soi VĂN BẢN `payos-ingest.ts` và đếm số
    // lần `TRANG_THAI_DON_KHONG_NHAN_TIEN` xuất hiện. Đổi một dấu `&&` thành `||` trong biểu
    // thức gác — cổng mở toang, mà mọi chuỗi lưới tìm vẫn còn nguyên nên nó VẪN XANH.
    //
    // Soi văn bản ĐẾM được số lần xuất hiện nhưng KHÔNG kiểm được phép nối. Nên luật đã tách
    // thành hàm THUẦN (`lib/payments/don-nhan-tien.ts`) và ca này kiểm HÀNH VI.
    const ok = { trangThaiDon: "PENDING_PAYMENT", donDaXoa: false, trangThaiPhieu: "PENDING" };
    expect(donNhanTienTuDong(ok)).toBe(true);
    for (const st of ["DRAFT", "CANCELLED", "REFUNDED"]) {
      expect(donNhanTienTuDong({ ...ok, trangThaiDon: st }), st).toBe(false);
    }
    expect(donNhanTienTuDong({ ...ok, donDaXoa: true })).toBe(false);
    expect(donNhanTienTuDong({ ...ok, trangThaiPhieu: "VOID" })).toBe(false);
    // Và mỗi vế phải TỰ MÌNH đủ để từ chối — đó là thứ `||` nhầm chỗ phá mất.
    expect(donNhanTienTuDong({ trangThaiDon: "CANCELLED", donDaXoa: false, trangThaiPhieu: "PENDING" })).toBe(false);
    expect(donNhanTienTuDong({ trangThaiDon: "PENDING_PAYMENT", donDaXoa: false, trangThaiPhieu: "VOID" })).toBe(false);
  });

  it("LỖ 3 · bản nhận `null` — không có phép nối nào để lật", () => {
    expect(qrConRotDuocTien(null)).toBe(false);
    expect(qrConRotDuocTien(undefined)).toBe(false);
    expect(
      qrConRotDuocTien({ status: "PENDING", order: { status: "PENDING_PAYMENT", deletedAt: null } }),
    ).toBe(true);
    expect(
      qrConRotDuocTien({ status: "PENDING", order: { status: "CANCELLED", deletedAt: null } }),
    ).toBe(false);
    expect(
      qrConRotDuocTien({ status: "VOID", order: { status: "PENDING_PAYMENT", deletedAt: null } }),
    ).toBe(false);
    expect(
      qrConRotDuocTien({ status: "PENDING", order: { status: "PENDING_PAYMENT", deletedAt: new Date() } }),
    ).toBe(false);
  });

  it("LỖ 3 · mảnh lọc `where` nói ĐÚNG một luật với vị từ thuần", () => {
    // Hai hình dạng của cùng một luật (một cho Prisma, một cho TS thuần) là hai chỗ để lệch.
    // Ca này ghim chúng vào nhau: sửa danh sách ở hằng thì cả hai đổi theo, quên sửa một bên
    // thì đỏ ở đây.
    expect(locDonNhanTien()).toEqual({
      deletedAt: null,
      status: { notIn: ["DRAFT", "CANCELLED", "REFUNDED"] },
    });
    expect(locDonNhanTien()).not.toBe(locDonNhanTien());
    // Danh sách trên đã bị `toEqual` ghim, nên lặp trên chính nó là đủ để nối hai hình dạng:
    // đổi hằng mà quên một bên ⇒ `toEqual` đỏ; giữ danh sách mà đổi vị từ ⇒ vòng này đỏ.
    for (const st of ["DRAFT", "CANCELLED", "REFUNDED"]) {
      expect(donNhanTienTuDong({ trangThaiDon: st, donDaXoa: false, trangThaiPhieu: "PENDING" }), st).toBe(false);
    }
  });

  it("LỖ 3 · CẢ BỐN nhánh tra đơn đều đi qua luật đó", () => {
    // ⚠️ PHIÊN A chỉ vá (a) và (b). Ca này viết lại ở PHIÊN B sau khi đo ra nhánh (c) — nhánh
    // của nội dung CK đời cũ `ORD…D<số>`, tức nhánh dữ liệu THẬT đi qua nhiều nhất — chưa hề
    // được kiểm, và nhánh (d) thì đúng luật nhưng bằng một mảng gõ tay riêng.
    const src = docMa("lib/payments/payos-ingest.ts");
    // (a) matchKey · (c) orderCode · (d) SĐT — cả ba nhét mảnh lọc vào `where` của Prisma.
    expect(src.match(/locDonNhanTien\(\)/g) ?? []).toHaveLength(3);
    // (b) QrSession: `findUnique` khoá theo `providerOrderCode` nên phải lọc SAU khi tra ⇒ vị từ.
    expect(src.match(/qrConRotDuocTien\(/g) ?? []).toHaveLength(1);
    // ⚠️ Và nhánh đó phải là MỘT LỜI GỌI TRẦN, không có `&&` nào ghép vào — xem chú thích
    // `qrConRotDuocTien`: một `&&` đổi thành `||` là cổng mở mà lưới vẫn xanh.
    expect(src).toMatch(/const qrConHieuLuc = qrConRotDuocTien\(phieuCuaQr\);/);
    expect(src).toMatch(/status:\s*\{\s*not:\s*"VOID"\s*\}/);
    // Không còn bản CHÉP TAY nào của danh sách trạng thái trong tệp này.
    expect(src).not.toMatch(/notIn:\s*\[\s*"DRAFT"/);
    // Và nhánh (c) phải là `findFirst`: `findUnique` chỉ nhận đúng khoá, không nhét lọc vào được.
    // ⚠️ Neo vào TRA-THEO-`code`, không phải mọi `findUnique`: tệp còn một câu tra theo `id`
    // CHẠY SAU khi đã resolve xong (`where: { id: target.orderId }`) — đơn đó đã qua cổng rồi,
    // cấm nó là cấm nhầm và sẽ đẩy người sau đi vòng.
    expect(src).toMatch(/where:\s*\{\s*code,\s*\.\.\.locDonNhanTien\(\)\s*\}/);
    expect(src).not.toMatch(/findUnique\(\{\s*where:\s*\{\s*code[,:]/);
  });

  it("LỖ 3 · đường SePay đi CHUNG tầng đối khớp — không có cổng thứ hai", () => {
    // Câu hỏi của chủ dự án: SePay có qua `resolvePaymentTargetDetailed` không.
    // ĐO ĐƯỢC: có, ở CẢ HAI nhánh của route (nhánh "không tra ra đơn" và nhánh CONFIRM) —
    // cả hai đều gọi `ingestPayosWebhook`, mà hàm đó gọi `resolvePaymentTargetDetailed`.
    // Nên bốn ca trên đã phủ luôn SePay, không cần vá riêng.
    const rt = docMa("app/api/public/webhook/sepay/route.ts");
    expect(rt.match(/ingestPayosWebhook\(/g) ?? []).toHaveLength(2);
    const ing = docMa("lib/payments/payos-ingest.ts");
    expect(ing).toMatch(/const resolved = await resolvePaymentTargetDetailed\(data\);/);
    // Còn đơn XOÁ MỀM ở route thì tầng base lo: `Order` ∈ `SOFT_DELETE_MODELS`, và hook
    // `findUnique` của `lib/db.ts` lọc hậu kỳ trả `null`. Đã thử vá thêm ở route rồi HOÀN
    // NGUYÊN — vá một lỗ không tồn tại thì chỗ vá ấy sẽ được ai đó tin là có lý do.
    expect(rt).toMatch(/db\.order\.findUnique\(/);
  });

  it("LUẬT 5 · `noTheoCon` đọc bằng `db` TRẦN — ai mở đơn cũng ra CÙNG con số", () => {
    // Chủ dự án: *"KHÔNG lọc theo scopedDb/cơ sở của người xem."* `Payment` nằm trong
    // `SCOPED_MODELS` và KHÔNG nằm trong `NULL_IS_GLOBAL_MODELS`, nên đọc qua `scopedDb` là
    // con số "đã thu" KHÁC NHAU tuỳ ai mở màn — và không lỗi nào báo.
    // ⚠️ SỬA 17/09/2026 — PHIÊN B tách thân thật ra `docSoTheoCon(doc, orderId)` để đường GHI
    // đọc được BÊN TRONG transaction đang giữ khoá của đơn. `noTheoCon` nay chỉ còn là cửa
    // ĐỌC-HIỂN-THỊ và uỷ quyền với `db` TRẦN. Luật không đổi một chữ; chỗ phải soi thì đổi.
    const src = docMa("lib/finance/debt.ts");
    expect(src).toMatch(
      /export async function noTheoCon\(orderId: string\): Promise<NoTheoConKetQua> \{\s*return docSoTheoCon\(db, orderId\);/,
    );
    const than = /export async function docSoTheoCon\([\s\S]*?\n\}/.exec(src)?.[0] ?? "";
    expect(than).not.toBe("");
    expect(than).not.toMatch(/\bsdb\./);
    expect(than).not.toContain("scopedDb");
    // Và nó phải thật sự đọc ba bảng qua client ĐƯỢC TRUYỀN VÀO — nếu không thì phép khẳng
    // định trên là rỗng.
    for (const bang of [
      "doc.orderItem.findMany",
      "doc.payment.findMany",
      "doc.paymentRequest.findMany",
    ]) {
      expect(than, bang).toContain(bang);
    }
  });

  it("LƯỚI CANH LƯỚI · phép bóc chú thích thật sự bóc", () => {
    // Một phép bóc hỏng bóc được 0 dòng và trông y hệt một phép bóc đang làm việc — đã trả giá
    // hai lần trong ngày 16/09.
    const src = docMa("lib/orders/installments.ts");
    expect(src.split(/\r?\n/).some((d) => d.trimStart().startsWith("//"))).toBe(false);
    expect(src).toContain("export async function recordInstallmentPlan");
  });
});

describe("[NTC-06] CÔNG TẮC — tắt thì luồng cũ y nguyên", () => {
  it("tắt ⇒ khối công nợ theo con KHÔNG dựng (trang không thêm truy vấn nào)", () => {
    const src = docMa("app/(admin)/admin/orders/[id]/page.tsx");
    // Ghim đúng hình dạng "tắt thì không tính": biểu thức điều kiện, không phải tính rồi ẩn.
    //
    // ⚠️ 24/09/2026 — nhận CẢ `await noTheoCon(...)` lẫn `noTheoCon(...)` nằm trong một
    // `Promise.all`. Bản đầu của lưới này ghim đúng chữ `? await noTheoCon(order.id) : null`
    // nên nó ĐỎ khi trang gom các câu tra độc lập lại chạy song song — một thay đổi KHÔNG
    // đụng gì tới luật nó canh. Thứ phải khoá là **biểu thức điều kiện + nhánh else không
    // tra gì**, không phải chỗ đặt chữ `await`. (Cùng lớp với `[NDC-07]` — đọc LÝ LẼ của
    // lưới trước, rồi hỏi lý lẽ ấy có bắt buộc cách viết đó không.)
    expect(src).toMatch(
      /batThuTheoCon\s*\?\s*(?:await\s+)?noTheoCon\(order\.id\)\s*:\s*(?:null|Promise\.resolve\(null\))/,
    );
    // ⚠️ VÀ ĐÂY LÀ LẦN THỨ HAI CÙNG MỘT BÀI HỌC [25/09/2026]. Dòng này từng là
    // `/\{soTheoCon && \(/` — ghim cả dấu `{` mở JSX expression. Khi khối được đưa vào
    // slot `khoiCuoi={…}` của `<OrderDetailClient>` (để cột trái không còn hụt ~200px),
    // nó thành `khoiCuoi={ soTheoCon && ( … ) }` — KHÔNG còn dấu `{` ngay trước, và lưới
    // đỏ trong khi luật nó canh không đổi một chữ.
    //
    // Luật là: khối CHỈ dựng khi `soTheoCon` có thật. Neo vào đúng vế điều kiện ấy, và
    // ĐẾM số lần — hai nơi cùng dựng nó là một lỗi khác (khối in hai lần).
    expect(src.match(/soTheoCon && \(/g) ?? []).toHaveLength(1);
    // Đối chứng: chính component ấy phải nằm sau cái cổng, không dựng vô điều kiện ở đâu.
    expect(src.match(/<CongNoTheoCon/g) ?? []).toHaveLength(1);
  });

  it("hai action đợt-theo-con đều GÁC công tắc", () => {
    const src = docMa("app/(admin)/admin/orders/_actions.ts");
    for (const ten of ["taoDotChoConAction", "huyDotChoConAction"]) {
      // Neo vào `}` ĐỨNG MỘT MÌNH trên dòng (`\n}\n`), không phải `\n}` — dấu `}` đóng khối
      // THAM SỐ (`}) {`) cũng nằm đầu dòng, nên `\n}` cắt thân hàm ngay ở chữ ký và mọi phép
      // khẳng định phía sau thành vô nghĩa. Đã đỏ một lượt vì đúng chuyện này.
      const than =
        new RegExp(`export async function ${ten}\\([\\s\\S]*?\\n\\}\\n`).exec(src)?.[0] ?? "";
      expect(than, ten).not.toBe("");
      expect(than, ten).toContain("laThuTienLinhHoatBat");
    }
  });

  it("phép giải công tắc vẫn đúng cả hai chiều (nhắc lại từ `feature.test.ts`)", () => {
    expect(giaiCongTac({ toanHe: false, coSo: true })).toBe(true);
    expect(giaiCongTac({ toanHe: true, coSo: false })).toBe(false);
  });
});

describe("[NTC-07] đợt CHƯA GẮN CON — đơn cũ không được rơi khỏi kết quả", () => {
  // ⚠️ Nhóm này thêm 17/09. Trước đó `tinhNoTheoCon` lọc đợt theo `x.orderItemId === d.orderItemId`
  // nên đợt NULL không thuộc bé nào và BIẾN MẤT khỏi kết quả — màn gắn dựng danh sách từ `con[]`
  // nên đơn trước 16/09 hiện ra 0 đợt để chia.
  const dotChung = (installmentNo: number, amountDue: number, x: Partial<DotCuaDong> = {}) =>
    ({ ...dot("", installmentNo, amountDue, x), orderItemId: null }) as DotCuaDong;

  it("đợt NULL đang mở ra `dotChuaGanCon`, KHÔNG lẫn vào bé nào", () => {
    const r = tinhNoTheoCon({
      dong: dong(),
      khoanDaXacNhan: [],
      khoanChoXacNhan: [],
      khoanDaVe: [],
      dot: [dot(AN, 1, 3_000_000), dotChung(1, 5_000_000)],
    });
    expect(r.dotChuaGanCon.map((d) => d.amountDue)).toEqual([5_000_000]);
    // Không bé nào nhận đợt chung — nếu lẫn vào, `tongDotDangMo` của bé đó phình lên và cổng
    // tạo đợt sẽ chặn oan.
    expect(r.con.find((c) => c.orderItemId === AN)!.tongDotDangMo).toBe(3_000_000);
    expect(r.con.find((c) => c.orderItemId === BINH)!.tongDotDangMo).toBe(0);
  });

  it("chỉ đợt ĐANG MỞ — VOID/PAID không vào danh sách", () => {
    const r = tinhNoTheoCon({
      dong: dong(),
      khoanDaXacNhan: [],
      khoanChoXacNhan: [],
      khoanDaVe: [],
      dot: [
        dotChung(1, 1_000_000, { trangThai: "PENDING" }),
        dotChung(2, 2_000_000, { trangThai: "PARTIAL" }),
        dotChung(3, 3_000_000, { trangThai: "PAID" }),
        dotChung(4, 4_000_000, { trangThai: "VOID" }),
      ],
    });
    expect(r.dotChuaGanCon.map((d) => d.installmentNo)).toEqual([1, 2]);
  });

  it("xếp theo hạn rồi tới số đợt; đợt KHÔNG hạn xuống cuối", () => {
    const r = tinhNoTheoCon({
      dong: dong(),
      khoanDaXacNhan: [],
      khoanChoXacNhan: [],
      khoanDaVe: [],
      dot: [
        dotChung(3, 1_000_000),
        dotChung(1, 1_000_000, { dueDate: new Date("2026-12-01") }),
        dotChung(2, 1_000_000, { dueDate: new Date("2026-10-01") }),
      ],
    });
    expect(r.dotChuaGanCon.map((d) => d.installmentNo)).toEqual([2, 1, 3]);
  });
});

describe("[NTC-09] `tranTaoDot` — trần của GIAO DIỆN phải bằng thứ cổng chấp nhận", () => {
  // 🔴 SINH RA TỪ MỘT CÂU HỎI CỦA CHỦ DỰ ÁN, 25/09/2026, khi nhìn vào chính màn hình:
  //   *"ở dưới có kế hoạch thanh toán, ở trên có từng đợt rồi, tại sao ở chỗ con vẫn có
  //   nút thêm đợt?"*
  //
  // Đo trên đơn thật (2 con, kế hoạch 4 đợt phủ TRỌN 19.959.999đ): nút `+ Đợt` hiện, form
  // in "tối đa 9.879.992đ", và `kiemTaoDot` từ chối MỌI số tiền — 1 đồng cũng từ chối.
  // Giao diện tự tính `conNo - tongDotDangMo`, tức đúng MỘT trong hai vế của cổng.
  const DON = { conNoDon: 19_959_999, tongDotDangMoDon: 19_959_999, soDotDon: 4 };
  const SATA3 = { conNo: 9_879_992, tongDotDangMo: 0 };

  it("kế hoạch đơn phủ trọn ⇒ KHÔNG tạo được, dù bé còn nợ nguyên", () => {
    const r = tranTaoDot({ ...SATA3, ...DON });
    expect(r.duoc).toBe(false);
    if (r.duoc) throw new Error("không tới");
    expect(r.vi).toBe("KE_HOACH_DON_DA_PHU");
  });

  it("câu giải thích nói ĐÚNG chỗ tiền đang nằm, không nói chung chung", () => {
    const r = tranTaoDot({ ...SATA3, ...DON });
    if (r.duoc) throw new Error("không tới");
    // Phải nhắc tới KẾ HOẠCH CỦA ĐƠN — đó là thứ đang chặn. Nói "đợt của bé đã phủ hết"
    // trong khi bé chưa có đợt nào là nói sai, và người đọc sẽ đi tìm một thứ không có.
    expect(r.loi).toContain("kế hoạch");
    expect(r.loi).toContain("4 đợt");
    expect(r.loi).not.toContain("của bé đã phủ");
  });

  it("TRẦN LUÔN KHỚP với thứ `kiemTaoDot` chấp nhận — bất biến của cả hàm này", () => {
    // Đây là lý do hàm tồn tại. Kiểm bằng cách cho `kiemTaoDot` ăn ĐÚNG con số mà giao
    // diện sẽ in ra, trên nhiều hình dạng đơn khác nhau.
    const ca = [
      { ten: "kế hoạch đơn phủ trọn", con: SATA3, don: DON },
      { ten: "đơn chưa có kế hoạch", con: SATA3, don: { conNoDon: 19_959_999, tongDotDangMoDon: 0, soDotDon: 0 } },
      { ten: "đơn còn một phần", con: SATA3, don: { conNoDon: 19_959_999, tongDotDangMoDon: 17_000_000, soDotDon: 3 } },
      { ten: "bé đã có đợt riêng", con: { conNo: 9_879_992, tongDotDangMo: 5_000_000 }, don: { conNoDon: 19_959_999, tongDotDangMoDon: 5_000_000, soDotDon: 1 } },
      { ten: "bé hết nợ", con: { conNo: 0, tongDotDangMo: 0 }, don: { conNoDon: 19_959_999, tongDotDangMoDon: 0, soDotDon: 0 } },
      { ten: "bé đóng thừa", con: { conNo: -500_000, tongDotDangMo: 0 }, don: { conNoDon: 19_959_999, tongDotDangMoDon: 0, soDotDon: 0 } },
    ];
    for (const { ten, con, don } of ca) {
      const t = tranTaoDot({ ...con, ...don });
      const goi = (soTien: number) =>
        kiemTaoDot({ soTien, conNo: con.conNo, tongDotDangMo: con.tongDotDangMo, tenCon: "Bé", conNoDon: don.conNoDon, tongDotDangMoDon: don.tongDotDangMoDon });

      if (!t.duoc) {
        // Không tạo được ⇒ cổng phải từ chối MỌI số tiền, kể cả 1 đồng.
        expect(goi(1).ok, `${ten}: UI nói không tạo được mà cổng lại cho qua 1đ`).toBe(false);
        continue;
      }
      // Tạo được ⇒ đúng con số UI in ra phải được cổng CHẤP NHẬN…
      expect(goi(t.toiDa).ok, `${ten}: UI in tối đa ${t.toiDa} mà cổng từ chối`).toBe(true);
      // …và hơn một đồng thì phải bị TỪ CHỐI. Thiếu vế này thì một trần đặt quá thấp
      // (ví dụ luôn trả 1) vẫn làm ca trên xanh.
      expect(goi(t.toiDa + 1).ok, `${ten}: trần ${t.toiDa} đặt quá thấp`).toBe(false);
    }
  });
});
