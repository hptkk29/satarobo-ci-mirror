// Ca [LTC-*] — ĐO ĐỦ / THIẾU THEO TỪNG CON (PR-1, 23/10/2026; docs/thu-hoc-phi-pham-vi/HOA-DON-MOI-CON.md §3 và §8.2).
//
// Lỗi đã ĐO bằng chạy hàm thật (trước bản vá): `gomLanThu` chọn MỘT đợt đích cho cả giao dịch rồi chép cho mọi con. Phiếu theo con
// của đơn #863/#880 đều mang `installmentNo = 1` nên không có gì phân biệt "đợt của A" với "đợt của B":
//   · B nợ 4tr nhận 2tr  ⇒ báo ĐỦ        (đúng: THIẾU 2tr)
//   · A nợ 2tr nhận 2tr  ⇒ báo THIẾU 1tr (đúng: ĐỦ)
//   · B trả hai lần chuyển khoản ⇒ HAI lần thu (đúng: MỘT, 4tr/4tr)
//
// Luật sửa (lan-thu.ts luật 7): đích tính theo cặp (giao dịch, con) — phiếu CỦA CON nhận phân bổ lớn nhất từ giao dịch đó — chứ KHÔNG
// phải "mọi phiếu của con đã nhận tiền" (lỗi bắc cầu của [LT-02]: ca [LTC-13]).
//
// Ma trận (mỗi ô có ca): một con thiếu/đủ · một con nhiều giao dịch · nhiều con cùng phiếu gộp · thiếu/dư và tự rót #880 (khoản webhook
// lẫn khoản gắn tay cùng MỘT giao dịch) · khoản theo con ở đơn thường (nhiều đợt) · miễn giảm dựng lại phiếu (VOID + phiếu mới) · phiếu đời cũ /
// khoản chưa gắn con (luật cũ) · dựng lại hoá đơn gộp · lặp & thứ tự dữ liệu.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { gomLanThu, lanThuCuaHoaDon, type DotVao, type GiaoDichVao, type KhoanVaoLanThu, type PhanBoVao } from "./lan-thu";

const A = "itemA";
const B = "itemB";

/** Phiếu THEO CON: `orderItemId` ≠ null. Phiếu của đơn #880 luôn `installmentNo = 1`. */
const dotCon = (id: string, con: string, amountDue: number, n = 1, status: DotVao["status"] = "PAID"): DotVao => ({
  id,
  installmentNo: n,
  amountDue,
  status,
  orderItemId: con,
});
/** Phiếu đời cũ (không gắn con). */
const dotCu = (id: string, n: number, amountDue: number, status: DotVao["status"] = "PAID"): DotVao => ({
  id,
  installmentNo: n,
  amountDue,
  status,
  orderItemId: null,
});
const gd = (id: string, amount: number, luc = "2026-10-20T10:00:00Z"): GiaoDichVao => ({
  id,
  provider: "SEPAY",
  providerTxnId: `FT-${id}`,
  transferredAt: new Date(luc),
  amount,
});
const pb = (bt: string, dotId: string, amount: number, roundingWaived = 0): PhanBoVao => ({
  bankTransactionId: bt,
  paymentRequestId: dotId,
  amount,
  roundingWaived,
});
const kWebhook = (id: string, bt: string, rong: number, orderItemId: string | null): KhoanVaoLanThu => ({
  id,
  rong,
  nguon: { loai: "WEBHOOK", provider: "sepay", providerTxnId: `FT-${bt}` },
  paidDate: new Date("2026-10-20T10:05:00Z"),
  orderItemId,
});
const kGanTay = (id: string, bt: string, rong: number, orderItemId: string | null): KhoanVaoLanThu => ({
  id,
  rong,
  nguon: { loai: "GAN_TAY", bankTransactionId: bt },
  paidDate: new Date("2026-10-21T02:00:00Z"),
  orderItemId,
});

type Vao = Parameters<typeof gomLanThu>[0];
const vao = (o: Partial<Vao>): Vao => ({
  khoan: [],
  giaoDich: [],
  phanBo: [],
  dot: [],
  gop: [],
  giaoDichChuaKhop: [],
  donCoKhoanNganHang: true,
  tachTheoCon: true,
  ...o,
});
const theoKhoan = (r: ReturnType<typeof gomLanThu>, khoanId: string) => r.find((x) => x.khoanIds.includes(khoanId))!;

// ─────────────────────────────────────────────────────────────────────────────
describe("[LTC] một con — một giao dịch", () => {
  it("[LTC-01] nợ 4tr nhận 2tr ⇒ THIẾU 2tr (không được báo ĐỦ)", () => {
    const r = gomLanThu(
      vao({
        khoan: [kWebhook("pB", "bt1", 2_000_000, B)],
        giaoDich: [gd("bt1", 2_000_000)],
        phanBo: [pb("bt1", "rB", 2_000_000)],
        dot: [dotCon("rB", B, 4_000_000, 1, "PARTIAL")],
      }),
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ key: "dot:rB", trangThai: "THIEU", phaiThu: 4_000_000, daVaoDot: 2_000_000, thieu: 2_000_000, traTruoc: 0 });
  });

  it("[LTC-02] nợ 2tr nhận 2tr ⇒ ĐỦ (không được báo THIẾU)", () => {
    const r = gomLanThu(
      vao({
        khoan: [kWebhook("pA", "bt1", 2_000_000, A)],
        giaoDich: [gd("bt1", 2_000_000)],
        phanBo: [pb("bt1", "rA", 2_000_000)],
        dot: [dotCon("rA", A, 2_000_000)],
      }),
    );
    expect(r[0]).toMatchObject({ key: "dot:rA", trangThai: "DU", phaiThu: 2_000_000, daVaoDot: 2_000_000, thieu: 0 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("[LTC] nhiều con cùng một giao dịch (phiếu gộp / chia theo con)", () => {
  const nhaHaiCon = (nA: number, nB: number, nhanA: number, nhanB: number) =>
    vao({
      khoan: [kWebhook("pA", "bt1", nhanA, A), kWebhook("pB", "bt1", nhanB, B)],
      giaoDich: [gd("bt1", nhanA + nhanB)],
      phanBo: [pb("bt1", "rA", nhanA), pb("bt1", "rB", nhanB)],
      dot: [dotCon("rA", A, nA, 1, nhanA >= nA ? "PAID" : "PARTIAL"), dotCon("rB", B, nB, 1, nhanB >= nB ? "PAID" : "PARTIAL")],
    });

  it("[LTC-03] CA ĐÃ ĐO 1: A nợ 3tr nhận 3tr, B nợ 4tr nhận 2tr ⇒ A ĐỦ, B THIẾU 2tr", () => {
    const r = gomLanThu(nhaHaiCon(3_000_000, 4_000_000, 3_000_000, 2_000_000));
    expect(r).toHaveLength(2);
    expect(theoKhoan(r, "pA")).toMatchObject({ trangThai: "DU", thieu: 0, traTruoc: 0, soTien: 3_000_000 });
    expect(theoKhoan(r, "pB")).toMatchObject({ trangThai: "THIEU", phaiThu: 4_000_000, daVaoDot: 2_000_000, thieu: 2_000_000, traTruoc: 0 });
  });

  it("[LTC-04] CA ĐÃ ĐO 2: A nợ 2tr nhận 2tr, B nợ 4tr nhận 3tr ⇒ A ĐỦ (không bị kéo theo đợt của B), B THIẾU 1tr", () => {
    const r = gomLanThu(nhaHaiCon(2_000_000, 4_000_000, 2_000_000, 3_000_000));
    expect(theoKhoan(r, "pA")).toMatchObject({ trangThai: "DU", phaiThu: 2_000_000, daVaoDot: 2_000_000, thieu: 0, traTruoc: 0 });
    expect(theoKhoan(r, "pB")).toMatchObject({ trangThai: "THIEU", thieu: 1_000_000, traTruoc: 0 });
  });

  it("[LTC-05] đối chứng: cả hai đủ ⇒ hai lần thu ĐỦ, không `traTruoc` giả", () => {
    const r = gomLanThu(nhaHaiCon(3_000_000, 2_000_000, 3_000_000, 2_000_000));
    expect(r.map((x) => x.trangThai)).toEqual(["DU", "DU"]);
    expect(r.every((x) => x.traTruoc === 0 && x.thieu === 0)).toBe(true);
    expect(r.reduce((s, x) => s + x.soTien, 0)).toBe(5_000_000);
  });

  it("[LTC-06] hai con KHÔNG chia sẻ nhóm: mỗi con một khoá theo ĐÍCH CỦA CHÍNH CON (không đuôi `#con`)", () => {
    const r = gomLanThu(nhaHaiCon(3_000_000, 2_000_000, 3_000_000, 2_000_000));
    expect(r.map((x) => x.key).sort()).toEqual(["dot:rA", "dot:rB"]);
    expect(r.every((x) => x.dotDich.length === 1)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("[LTC] một con nhận tiền qua nhiều giao dịch", () => {
  it("[LTC-07] CA ĐÃ ĐO 4: lần 1 chia A 3tr + B 2tr (đích chung = rA), lần 2 chỉ B 2tr ⇒ B là MỘT lần thu 4tr/4tr ĐỦ", () => {
    const r = gomLanThu(
      vao({
        khoan: [kWebhook("pA", "bt1", 3_000_000, A), kWebhook("pB1", "bt1", 2_000_000, B), kWebhook("pB2", "bt2", 2_000_000, B)],
        giaoDich: [gd("bt1", 5_000_000), gd("bt2", 2_000_000, "2026-10-21T03:00:00Z")],
        phanBo: [pb("bt1", "rA", 3_000_000), pb("bt1", "rB", 2_000_000), pb("bt2", "rB", 2_000_000)],
        dot: [dotCon("rA", A, 3_000_000), dotCon("rB", B, 4_000_000)],
      }),
    );
    expect(r).toHaveLength(2);
    const b = theoKhoan(r, "pB1");
    expect(b.khoanIds).toEqual(["pB1", "pB2"]);
    expect(b).toMatchObject({ key: "dot:rB", soTien: 4_000_000, trangThai: "DU", phaiThu: 4_000_000, daVaoDot: 4_000_000, traTruoc: 0 });
    expect(theoKhoan(r, "pA")).toMatchObject({ key: "dot:rA", trangThai: "DU", soTien: 3_000_000 });
  });

  it("[LTC-08] lần 2 còn thiếu: B nợ 5tr, nhận 2tr + 2tr ⇒ một lần thu THIẾU 1tr", () => {
    const r = gomLanThu(
      vao({
        khoan: [kWebhook("pB1", "bt1", 2_000_000, B), kWebhook("pB2", "bt2", 2_000_000, B)],
        giaoDich: [gd("bt1", 2_000_000), gd("bt2", 2_000_000, "2026-10-21T03:00:00Z")],
        phanBo: [pb("bt1", "rB", 2_000_000), pb("bt2", "rB", 2_000_000)],
        dot: [dotCon("rB", B, 5_000_000, 1, "PARTIAL")],
      }),
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ trangThai: "THIEU", thieu: 1_000_000, daVaoDot: 4_000_000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("[LTC] khoản theo con ở đơn THƯỜNG — một con nhiều đợt (chống bắc cầu [LT-02])", () => {
  const motConHaiDot = (chuyen: number, phanBoDot2: number, dot2Due = 3_000_000) =>
    vao({
      khoan: [kWebhook("pC", "bt3", chuyen, "itemC")],
      giaoDich: [gd("bt3", chuyen)],
      phanBo: [pb("bt3", "c1", chuyen - phanBoDot2), ...(phanBoDot2 > 0 ? [pb("bt3", "c2", phanBoDot2)] : [])],
      dot: [dotCon("c1", "itemC", 3_000_000, 1), dotCon("c2", "itemC", dot2Due, 2, "PARTIAL")],
    });

  it("[LTC-09] CA ĐÃ ĐO 5: đợt 1 = 3tr, đợt 2 = 3tr; chuyển 3.012.000 (đợt 2 nhận 12.000) ⇒ ĐỦ, `traTruoc` = 12.000", () => {
    const r = gomLanThu(motConHaiDot(3_012_000, 12_000));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ key: "dot:c1", trangThai: "DU", phaiThu: 3_000_000, daVaoDot: 3_000_000, thieu: 0, traTruoc: 12_000 });
    expect(r[0]!.dotDich).toEqual([{ id: "c1", installmentNo: 1 }]);
  });

  it("[LTC-10] phần tràn LỚN HƠN nửa đợt 2 vẫn không kéo đợt 2 vào phải thu: đích = đợt nhận LỚN NHẤT (đợt 1)", () => {
    // đợt 1 = 3tr nhận 3tr; đợt 2 = 3tr nhận 1.5tr ⇒ đích vẫn đợt 1, đợt 2 là trả trước
    const r = gomLanThu(motConHaiDot(4_500_000, 1_500_000));
    expect(r[0]).toMatchObject({ key: "dot:c1", trangThai: "DU", phaiThu: 3_000_000, traTruoc: 1_500_000 });
  });

  it("[LTC-11] đợt 2 nhận phần LỚN HƠN đợt 1 ⇒ đích là đợt 2 (cùng luật `dichCua`), đợt 1 là trả trước", () => {
    // đợt 1 nợ 1tr nhận 1tr; đợt 2 nợ 3tr nhận 3tr: chuyển 4tr
    const r = gomLanThu(
      vao({
        khoan: [kWebhook("pC", "bt3", 4_000_000, "itemC")],
        giaoDich: [gd("bt3", 4_000_000)],
        phanBo: [pb("bt3", "c1", 1_000_000), pb("bt3", "c2", 3_000_000)],
        dot: [dotCon("c1", "itemC", 1_000_000, 1), dotCon("c2", "itemC", 3_000_000, 2)],
      }),
    );
    expect(r[0]).toMatchObject({ key: "dot:c2", trangThai: "DU", phaiThu: 3_000_000, daVaoDot: 3_000_000, traTruoc: 1_000_000 });
  });

  it("[LTC-12] hoà phần phân bổ ⇒ đợt số nhỏ hơn (giữ nguyên luật hoà của bản cũ)", () => {
    const r = gomLanThu(
      vao({
        khoan: [kWebhook("pC", "bt3", 2_000_000, "itemC")],
        giaoDich: [gd("bt3", 2_000_000)],
        phanBo: [pb("bt3", "c2", 1_000_000), pb("bt3", "c1", 1_000_000)],
        dot: [dotCon("c1", "itemC", 1_000_000, 1), dotCon("c2", "itemC", 1_000_000, 2)],
      }),
    );
    expect(r[0]!.dotDich).toEqual([{ id: "c1", installmentNo: 1 }]);
  });

  it("[LTC-13] hai con, mỗi con hai đợt, một giao dịch tràn nhỏ ở cả hai ⇒ mỗi con ĐỦ, phần tràn là `traTruoc` CỦA CON ĐÓ (không sang con kia)", () => {
    const r = gomLanThu(
      vao({
        khoan: [kWebhook("pA", "bt1", 3_012_000, A), kWebhook("pB", "bt1", 2_010_000, B)],
        giaoDich: [gd("bt1", 5_022_000)],
        phanBo: [pb("bt1", "a1", 3_000_000), pb("bt1", "a2", 12_000), pb("bt1", "b1", 2_000_000), pb("bt1", "b2", 10_000)],
        dot: [dotCon("a1", A, 3_000_000, 1), dotCon("a2", A, 3_000_000, 2, "PARTIAL"), dotCon("b1", B, 2_000_000, 1), dotCon("b2", B, 2_000_000, 2, "PARTIAL")],
      }),
    );
    expect(theoKhoan(r, "pA")).toMatchObject({ trangThai: "DU", traTruoc: 12_000 });
    expect(theoKhoan(r, "pB")).toMatchObject({ trangThai: "DU", traTruoc: 10_000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("[LTC] tiền thiếu / dư và tự rót nguyên khoản (#880)", () => {
  it("[LTC-14] tự rót: chuyển 5tr cho [A 3tr, B 4tr] ⇒ chỉ A được rót; A ĐỦ, `ngoaiDot` = 0 (2tr dư KHÔNG là khoản nào, không lên hoá đơn)", () => {
    const r = gomLanThu(
      vao({
        khoan: [kWebhook("pA", "bt1", 3_000_000, A)], // B không có Payment (không rót một phần)
        giaoDich: [gd("bt1", 5_000_000)],
        phanBo: [pb("bt1", "rA", 3_000_000)],
        dot: [dotCon("rA", A, 3_000_000), dotCon("rB", B, 4_000_000, 1, "PENDING")],
      }),
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ key: "dot:rA", trangThai: "DU", soTien: 3_000_000, ngoaiDot: 0, traTruoc: 0 });
  });

  it("[LTC-15] sau tự rót, kế toán gắn tay 2tr dư cho B (marker GẮN TAY, CÙNG giao dịch) ⇒ A (webhook) ĐỦ, B (gắn tay) THIẾU 2tr", () => {
    const r = gomLanThu(
      vao({
        khoan: [kWebhook("pA", "bt1", 3_000_000, A), kGanTay("pB", "bt1", 2_000_000, B)],
        giaoDich: [gd("bt1", 5_000_000)],
        phanBo: [pb("bt1", "rA", 3_000_000), pb("bt1", "rB", 2_000_000)],
        dot: [dotCon("rA", A, 3_000_000), dotCon("rB", B, 4_000_000, 1, "PARTIAL")],
      }),
    );
    expect(theoKhoan(r, "pA")).toMatchObject({ trangThai: "DU", thieu: 0 });
    expect(theoKhoan(r, "pB")).toMatchObject({ trangThai: "THIEU", thieu: 2_000_000, phaiThu: 4_000_000, daVaoDot: 2_000_000 });
  });

  it("[LTC-16] dư: chuyển 6tr cho [A 3tr, B 2tr] ⇒ cả hai ĐỦ; 1tr dư (không phân bổ) không làm khoản nào lệch", () => {
    const r = gomLanThu(
      vao({
        khoan: [kWebhook("pA", "bt1", 3_000_000, A), kWebhook("pB", "bt1", 2_000_000, B)],
        giaoDich: [gd("bt1", 6_000_000)],
        phanBo: [pb("bt1", "rA", 3_000_000), pb("bt1", "rB", 2_000_000)],
        dot: [dotCon("rA", A, 3_000_000), dotCon("rB", B, 2_000_000)],
      }),
    );
    expect(r.map((x) => x.trangThai)).toEqual(["DU", "DU"]);
    expect(r.every((x) => x.ngoaiDot === 0)).toBe(true);
  });

  it("[LTC-17] gắn tay theo con: B đóng thêm 2tr ở lần chuyển thứ hai ⇒ B cộng đúng hai giao dịch, THIẾU còn 0", () => {
    const r = gomLanThu(
      vao({
        khoan: [kGanTay("pB1", "bt1", 2_000_000, B), kGanTay("pB2", "bt2", 2_000_000, B)],
        giaoDich: [gd("bt1", 2_000_000), gd("bt2", 2_000_000, "2026-10-22T03:00:00Z")],
        phanBo: [pb("bt1", "rB", 2_000_000), pb("bt2", "rB", 2_000_000)],
        dot: [dotCon("rB", B, 4_000_000, 1)],
      }),
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ trangThai: "DU", soTien: 4_000_000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("[LTC] miễn giảm dựng lại phiếu (VOID + phiếu mới, `installmentNo = max + 1`)", () => {
  it("[LTC-18] phiếu cũ VOID CHƯA có tiền + phiếu mới đợt 2: tiền vào phiếu mới ⇒ đo theo phiếu mới, không DOT_HUY", () => {
    const r = gomLanThu(
      vao({
        khoan: [kWebhook("pA", "bt1", 1_500_000, A)],
        giaoDich: [gd("bt1", 1_500_000)],
        phanBo: [pb("bt1", "rA2", 1_500_000)],
        dot: [dotCon("rA1", A, 2_000_000, 1, "VOID"), dotCon("rA2", A, 1_500_000, 2)],
      }),
    );
    expect(r[0]).toMatchObject({ key: "dot:rA2", trangThai: "DU", phaiThu: 1_500_000 });
  });

  it("[LTC-19] tiền vào phiếu VOID của MỘT con ⇒ chỉ lần thu của con đó là DOT_HUY; con kia vẫn đo bình thường", () => {
    const r = gomLanThu(
      vao({
        khoan: [kWebhook("pA", "bt1", 3_000_000, A), kWebhook("pB", "bt1", 2_000_000, B)],
        giaoDich: [gd("bt1", 5_000_000)],
        phanBo: [pb("bt1", "rA", 3_000_000), pb("bt1", "rB", 2_000_000)],
        dot: [dotCon("rA", A, 3_000_000), dotCon("rB", B, 2_000_000, 1, "VOID")],
      }),
    );
    expect(theoKhoan(r, "pA").trangThai).toBe("DU");
    expect(theoKhoan(r, "pB").trangThai).toBe("DOT_HUY");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("[LTC] đơn legacy / luồng không có khoản theo con GIỮ NGUYÊN luật đo theo đợt", () => {
  it("[LTC-20] phiếu đời cũ (orderItemId NULL) ⇒ đo theo đợt như cũ, khoản đã gắn con vẫn tách theo con (đuôi `#con`)", () => {
    const r = gomLanThu(
      vao({
        khoan: [kWebhook("a1", "bt1", 2_460_000, A), kWebhook("b1", "bt1", 2_460_000, B)],
        giaoDich: [gd("bt1", 4_920_000)],
        phanBo: [pb("bt1", "dot1", 4_920_000)],
        dot: [dotCu("dot1", 1, 5_000_000, "PARTIAL")],
      }),
    );
    expect(r.map((x) => x.key).sort()).toEqual([`dot:dot1#${A}`, `dot:dot1#${B}`]);
    expect(r.map((x) => x.thieu)).toEqual([80_000, 80_000]); // đo ở mức ĐỢT: không có "phải thu của từng con" để so
  });

  it("[LTC-21] khoản CHƯA gắn con trên phiếu theo con ⇒ luật cũ (không đoán con nào): một nhóm, đo theo đích chung", () => {
    const r = gomLanThu(
      vao({
        khoan: [kWebhook("pX", "bt1", 3_000_000, null)],
        giaoDich: [gd("bt1", 3_000_000)],
        phanBo: [pb("bt1", "rA", 3_000_000)],
        dot: [dotCon("rA", A, 3_000_000)],
      }),
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ key: "dot:rA", trangThai: "DU" });
  });

  it("[LTC-22] giao dịch có phân bổ vào CẢ phiếu theo con LẪN phiếu đời cũ ⇒ luật cũ cho giao dịch đó", () => {
    const r = gomLanThu(
      vao({
        khoan: [kWebhook("pA", "bt1", 3_000_000, A), kWebhook("pB", "bt1", 2_000_000, B)],
        giaoDich: [gd("bt1", 5_000_000)],
        phanBo: [pb("bt1", "rA", 3_000_000), pb("bt1", "dotCu", 2_000_000)],
        dot: [dotCon("rA", A, 3_000_000), dotCu("dotCu", 1, 2_000_000)],
      }),
    );
    // luật cũ: đích chung = rA (3tr lớn nhất), tách theo con ⇒ khoá có đuôi `#con`
    expect(r.map((x) => x.key).sort()).toEqual([`dot:rA#${A}`, `dot:rA#${B}`]);
  });

  it("[LTC-23] khoản của con KHÔNG có phiếu nào nhận tiền từ giao dịch ⇒ luật cũ (dữ liệu lệch: không đoán)", () => {
    const r = gomLanThu(
      vao({
        khoan: [kWebhook("pA", "bt1", 3_000_000, A), kWebhook("pB", "bt1", 2_000_000, B)],
        giaoDich: [gd("bt1", 5_000_000)],
        phanBo: [pb("bt1", "rA", 3_000_000)], // không có phân bổ nào vào phiếu của B
        dot: [dotCon("rA", A, 3_000_000), dotCon("rB", B, 2_000_000, 1, "PENDING")],
      }),
    );
    expect(r.map((x) => x.key).sort()).toEqual([`dot:rA#${A}`, `dot:rA#${B}`]);
  });

  it("[LTC-24] giao dịch KHÔNG có phân bổ (tiền mặt / lời khai) không đi chế độ theo con", () => {
    const r = gomLanThu(
      vao({
        khoan: [{ id: "tm", rong: 1_000_000, nguon: { loai: "KHONG" }, paidDate: new Date("2026-10-20T03:00:00Z"), orderItemId: A }],
        dot: [dotCon("rA", A, 1_000_000)],
        donCoKhoanNganHang: false,
      }),
    );
    expect(r[0]).toMatchObject({ key: expect.stringMatching(/^k:/), nguon: "KHONG_GIAO_DICH" });
  });

  it("[LTC-31] nhóm có CẢ giao dịch theo con LẪN giao dịch theo đợt, rồi tách theo con ⇒ giới hạn của giao dịch theo con vẫn thu hẹp về đúng con (phân bổ vào phiếu của con KHÔNG có khoản trong hoá đơn không bị đếm là `traTruoc`)", () => {
    // bt1 (theo con): khoản của A; còn phân bổ 2tr vào phiếu của B mà khoản của B nằm ngoài tập này (đã vào hoá đơn khác).
    // bt2 (theo đợt — B không có phiếu nhận tiền từ nó): khoản của B, đích chung là rA ⇒ cùng nhóm `dot:rA` với khoản của A rồi bị tách theo con.
    const r = gomLanThu(
      vao({
        khoan: [kWebhook("pA", "bt1", 3_000_000, A), kWebhook("pB", "bt2", 1_000_000, B)],
        giaoDich: [gd("bt1", 5_000_000), gd("bt2", 1_000_000, "2026-10-21T03:00:00Z")],
        phanBo: [pb("bt1", "rA", 3_000_000), pb("bt1", "rB", 2_000_000), pb("bt2", "rA", 1_000_000)],
        dot: [dotCon("rA", A, 4_000_000), dotCon("rB", B, 2_000_000)],
      }),
    );
    expect(r.map((x) => x.key).sort()).toEqual([`dot:rA#${A}`, `dot:rA#${B}`]);
    expect(theoKhoan(r, "pA")).toMatchObject({ trangThai: "DU", traTruoc: 0, phaiThu: 3_000_000, daVaoDot: 3_000_000 });
  });
});


// ─────────────────────────────────────────────────────────────────────────────
describe("[LTC] dựng lại hoá đơn đã có (lanThuCuaHoaDon) và gộp tay", () => {
  const nha = () =>
    vao({
      khoan: [kWebhook("pA", "bt1", 3_000_000, A), kWebhook("pB", "bt1", 2_000_000, B)],
      giaoDich: [gd("bt1", 5_000_000)],
      phanBo: [pb("bt1", "rA", 3_000_000), pb("bt1", "rB", 2_000_000)],
      dot: [dotCon("rA", A, 3_000_000), dotCon("rB", B, 4_000_000, 1, "PARTIAL")],
    });
  const goc = () => {
    const { gop: _g, tachTheoCon: _t, ...g } = nha();
    return g;
  };

  it("[LTC-25] hoá đơn của MỘT con ⇒ chỉ phần của con đó, đo theo con (A ĐỦ)", () => {
    const g = goc();
    const r = lanThuCuaHoaDon({ ...g, khoan: g.khoan.filter((k) => k.orderItemId === A) });
    expect(r).toMatchObject({ khoanIds: ["pA"], trangThai: "DU", soTien: 3_000_000 });
  });

  it("[LTC-26] hoá đơn GỘP cả hai con (xuất tay) ⇒ MỘT lần thu, đo gộp: phải thu 3tr + 4tr, đã vào 5tr ⇒ THIẾU 2tr", () => {
    const r = lanThuCuaHoaDon(goc());
    expect(r).toMatchObject({ soTien: 5_000_000, trangThai: "THIEU", phaiThu: 7_000_000, daVaoDot: 5_000_000, thieu: 2_000_000 });
    expect(r!.khoanIds).toEqual(["pA", "pB"]);
  });

  it("[LTC-27] gộp tay hai lần thu con ⇒ MỘT lần thu, đo gộp (cùng số với [LTC-26])", () => {
    const r = gomLanThu({ ...nha(), gop: [["dot:rA", "dot:rB"]] });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ soTien: 5_000_000, trangThai: "THIEU", phaiThu: 7_000_000, daVaoDot: 5_000_000 });
  });

  it("[LTC-28] gộp tay B (hai giao dịch) với A: giới hạn theo con của từng giao dịch được HỢP, không rò phân bổ của con ngoài hoá đơn", () => {
    const r = gomLanThu(
      vao({
        khoan: [kWebhook("pA", "bt1", 3_000_000, A), kWebhook("pB1", "bt1", 2_000_000, B), kWebhook("pB2", "bt2", 2_000_000, B)],
        giaoDich: [gd("bt1", 7_000_000), gd("bt2", 2_000_000, "2026-10-21T03:00:00Z")],
        // bt1 còn rót cho con C (không có khoản trong hoá đơn này): phần đó KHÔNG được tính vào hoá đơn gộp A+B
        phanBo: [pb("bt1", "rA", 3_000_000), pb("bt1", "rB", 2_000_000), pb("bt1", "rC", 2_000_000), pb("bt2", "rB", 2_000_000)],
        dot: [dotCon("rA", A, 3_000_000), dotCon("rB", B, 4_000_000), dotCon("rC", "itemC", 2_000_000)],
        gop: [["dot:rA", "dot:rB"]],
      }),
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ trangThai: "DU", phaiThu: 7_000_000, daVaoDot: 7_000_000, traTruoc: 0, soTien: 7_000_000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("[LTC] lặp và thứ tự dữ liệu (callback lặp / hai nơi nạp đọc cùng dữ liệu theo thứ tự khác nhau)", () => {
  const goc = () =>
    vao({
      khoan: [kWebhook("pA", "bt1", 3_000_000, A), kWebhook("pB1", "bt1", 2_000_000, B), kWebhook("pB2", "bt2", 2_000_000, B)],
      giaoDich: [gd("bt1", 5_000_000), gd("bt2", 2_000_000, "2026-10-21T03:00:00Z")],
      phanBo: [pb("bt1", "rA", 3_000_000), pb("bt1", "rB", 2_000_000), pb("bt2", "rB", 2_000_000)],
      dot: [dotCon("rA", A, 3_000_000), dotCon("rB", B, 4_000_000)],
    });

  it("[LTC-29] kết quả KHÔNG phụ thuộc thứ tự khoản / phân bổ / đợt / giao dịch (màn và bước chốt nạp theo thứ tự khác nhau)", () => {
    const xuoi = gomLanThu(goc());
    const g = goc();
    const dao = gomLanThu({ ...g, khoan: [...g.khoan].reverse(), phanBo: [...g.phanBo].reverse(), dot: [...g.dot].reverse(), giaoDich: [...g.giaoDich].reverse() });
    expect(dao).toEqual(xuoi);
  });

  it("[LTC-30] chạy lại trên cùng dữ liệu cho cùng kết quả (hàm thuần, không giữ trạng thái giữa hai lượt)", () => {
    const v = goc();
    expect(gomLanThu(v)).toEqual(gomLanThu(v));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("[LTC-W] dây nối: hai nơi nạp phải dùng CHÍNH `dotVaoTuPhieu` (luật 12)", () => {
  const doc = (f: string) => readFileSync(resolve(process.cwd(), f), "utf8");
  const bo = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("[LTC-W1] màn hàng chờ và bước chốt dựng `dot` bằng `dotVaoTuPhieu`, không còn bản dựng tay", () => {
    for (const f of ["lib/finance/hoa-don/dong-hang-cho.ts", "lib/finance/hoa-don/chot-hoa-don.ts"]) {
      const s = bo(doc(f));
      expect(s.match(/\.map\(dotVaoTuPhieu\)/g)?.length, f).toBe(1);
      expect(s, f).not.toMatch(/\(\{ id, installmentNo, amountDue, status \}\) => \(\{ id, installmentNo, amountDue, status \}\)/);
    }
  });

  it("[LTC-W2] bước chốt nạp `orderItemId` của phiếu trong `select` (thiếu nó thì mọi con rơi về luật cũ mà không lỗi nào báo)", () => {
    const s = bo(doc("lib/finance/hoa-don/chot-hoa-don.ts"));
    const khoi = s.slice(s.indexOf("tx.paymentRequest.findMany"), s.indexOf("const phanBo = dotDon.flatMap"));
    expect(khoi).toMatch(/orderItemId:\s*true/);
  });
});
