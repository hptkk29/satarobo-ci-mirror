// lib/finance/mien-giam.test.ts — MIỄN GIẢM NỢ: cổng thuần. PHIÊN G1 · US-22.
//
// Số lấy từ TS-44: *"QLCS miễn 600.000 → chặn (vượt còn nợ 500.000); miễn 500.000 có lý do
// → Bình còn nợ 0."*
import { describe, expect, it } from "vitest";
import {
  CHO_GHI,
  LY_DO_MIEN_BE_DA_DUNG_CAP_DON,
  LY_DO_MIEN_LAN_HAI_LOAI_DOT,
  LY_DO_MIEN_R0_LAN_DOT,
  chuaHapThuKhiMienGiam,
  dotSeHuyKhiMienGiam,
  keHoachMienGiam,
  kiemMienGiam,
  loiMienKhongHapThuDu,
  loiMienR0CoTien,
  loiMienVuotNoDon,
  moTaTruocMienGiamCapDon,
  thongDiepDungLaiCapDon,
  type DongKeHoachDon,
  type PhieuThuDeMien,
} from "./mien-giam";
import { CACH_HAP_THU, keHoachHapThu } from "@/lib/orders/chinh-sach-uu-dai";

const kiem = (p: Partial<Parameters<typeof kiemMienGiam>[0]> = {}) =>
  kiemMienGiam({
    soTien: 500_000,
    conNo: 500_000,
    phaiThu: 12_000_000,
    daDungHoc: false,
    lyDo: "Hoàn cảnh gia đình, QLCS duyệt",
    tenCon: "Bé Bình",
    ...p,
  });

describe("[MGN] cổng miễn giảm", () => {
  it("[MGN-01] TS-44: miễn ĐÚNG phần còn nợ ⇒ qua, phải thu tụt đúng số", () => {
    const r = kiem();
    expect(r).toMatchObject({ ok: true, soTien: 500_000, choGhi: CHO_GHI.GIAM_GIA });
    expect((r as { phaiThuMoi: number }).phaiThuMoi).toBe(11_500_000);
  });

  it("[MGN-02] TS-44: miễn 600.000 khi còn nợ 500.000 ⇒ CHẶN, và nói trần đúng", () => {
    const r = kiem({ soTien: 600_000 });
    expect(r.ok).toBe(false);
    expect((r as { loi: string }).loi).toContain("tối đa 500.000đ");
  });

  it("[MGN-03] THIẾU LÝ DO ⇒ chặn, và cổng ấy đứng TRƯỚC cổng trần", () => {
    // ⚠️ Thứ tự có chủ đích: báo "vượt trần" cho một người quên gõ lý do sẽ khiến họ đi sửa
    // nhầm chỗ. Ca này gửi MỘT đầu vào vi phạm CẢ HAI và đòi câu về LÝ DO.
    const r = kiem({ soTien: 9_999_999, lyDo: "   " });
    expect(r.ok).toBe(false);
    expect((r as { loi: string }).loi).toContain("lý do");
  });

  it("[MGN-04] số tiền ≤ 0 hoặc rác ⇒ chặn TRƯỚC mọi phép so khác", () => {
    for (const v of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(kiem({ soTien: v, lyDo: "" })).toMatchObject({
        ok: false,
        loi: "Số tiền miễn giảm phải lớn hơn 0",
      });
    }
  });

  it("[MGN-05] bé KHÔNG CÒN NỢ ⇒ chặn", () => {
    const r = kiem({ conNo: 0 });
    expect((r as { loi: string }).loi).toContain("không còn nợ đồng nào");
  });

  it("[MGN-06] bé ĐANG ĐÓNG THỪA ⇒ chặn, và nói rõ đây KHÔNG phải cách xử lý khoản thừa", () => {
    // Miễn giảm trên một bé đóng thừa là làm khoản thừa to thêm — người bấm phải hiểu là họ
    // đang cầm nhầm công cụ, chứ không phải "số tiền sai".
    const r = kiem({ conNo: -300_000 });
    expect(r.ok).toBe(false);
    const loi = (r as { loi: string }).loi;
    expect(loi).toContain("ĐÓNG THỪA 300.000");
    expect(loi).toContain("chuyển sang bé khác");
  });

  it("[MGN-07] bé ĐÃ DỪNG HỌC ⇒ ghi vào QUYẾT TOÁN, không ghi vào giảm giá", () => {
    // ⚠️ Vế dễ sai nhất của cụm. `phaiThu` của bé đã dừng đọc `usedValue`, nên miễn giảm ghi
    // vào `discountAmount` sẽ KHÔNG làm con số trên màn nhúc nhích — người vận hành bấm lại,
    // rồi lại, và mỗi lượt để lại một dòng nhật ký nói đã miễn.
    expect(kiem({ daDungHoc: true })).toMatchObject({ ok: true, choGhi: CHO_GHI.QUYET_TOAN });
    expect(kiem({ daDungHoc: false })).toMatchObject({ ok: true, choGhi: CHO_GHI.GIAM_GIA });
  });

  it("[MGN-08] phải thu mới không bao giờ ÂM", () => {
    expect(kiem({ soTien: 500_000, phaiThu: 100_000 })).toMatchObject({ phaiThuMoi: 0 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Q-L (chủ dự án chốt 30/09/2026: "Huỷ mã cũ, phát lại") — `keHoachMienGiam`. Hành vi trên Postgres
// thật: `tests/finance/pos-vong6.test.ts` `[V6-L*]`.
// ─────────────────────────────────────────────────────────────────────────────

const BE_A = "item-a";
const BE_B = "item-b";
const pt = (p: Partial<PhieuThuDeMien> & { id: string }): PhieuThuDeMien => ({
  orderItemId: null,
  installmentNo: 0,
  amountDue: 13_464_000,
  dueDate: null,
  status: "PENDING",
  daRot: 0,
  ...p,
});
const H1 = new Date("2026-10-15T00:00:00+07:00");
const H2 = new Date("2026-11-15T00:00:00+07:00");
const H3 = new Date("2026-12-15T00:00:00+07:00");
/** Đơn thu theo đợt ĐƠN: ba đợt, kế hoạch khớp phiếu. Số không tròn — hình dạng dữ liệu thật. */
const dotDon = (): PhieuThuDeMien[] => [
  pt({ id: "r0", installmentNo: 0, amountDue: 13_464_000, status: "VOID" }),
  pt({ id: "d1", installmentNo: 1, amountDue: 4_488_000, dueDate: H1 }),
  pt({ id: "d2", installmentNo: 2, amountDue: 4_488_000, dueDate: H2 }),
  pt({ id: "d3", installmentNo: 3, amountDue: 4_488_000, dueDate: H3 }),
];
const keHoach3 = (): DongKeHoachDon[] => [
  { soDot: 1, amount: 4_488_000, status: "PENDING" },
  { soDot: 2, amount: 4_488_000, status: "PENDING" },
  { soDot: 3, amount: 4_488_000, status: "PENDING" },
];
const kh = (p: Partial<Parameters<typeof keHoachMienGiam>[0]> = {}) =>
  keHoachMienGiam({
    orderItemId: BE_A,
    phieuThu: [pt({ id: "r0" })],
    keHoachDon: [],
    canGiam: 1_000_000,
    cach: CACH_HAP_THU.DOT_XA_NHAT,
    daDungHoc: false,
    // Rà vòng 6: vế ĐƠN + tổng đơn — BẮT BUỘC. Mặc định của helper = đơn chưa thu đồng nào, R0 = tổng đơn.
    conNoDon: 13_464_000,
    tongDon: 13_464_000,
    ...p,
  });

describe("[MG-L] Q-L — miễn giảm cho bé KHÔNG có đợt theo con", () => {
  it("[MG-L01] đối chứng dương: bé CÓ đợt theo con đang mở ⇒ luật cũ (THEO_CON), đúng phép `keHoachHapThu` trên đợt của bé", () => {
    const dotCon = pt({ id: "a1", orderItemId: BE_A, installmentNo: 1, amountDue: 3_168_000, dueDate: H1 });
    const r = kh({ phieuThu: [dotCon, pt({ id: "b1", orderItemId: BE_B, installmentNo: 1, amountDue: 3_564_000 })] });
    expect(r.cach).toBe("THEO_CON");
    expect(r).toEqual({ cach: "THEO_CON", ke: keHoachHapThu({ dot: [dotCon], canGiam: 1_000_000, cach: CACH_HAP_THU.DOT_XA_NHAT }) });
    expect(dotSeHuyKhiMienGiam(r)).toEqual(["a1"]);
    expect(moTaTruocMienGiamCapDon(r), "luật cũ không nói về phiếu cấp đơn").toBeNull();
    // Luật cũ GIỮ: đợt của bé đã nhận tiền ⇒ phần không trừ được vẫn chỉ CẢNH BÁO (không chặn).
    const coTien = kh({ phieuThu: [{ ...dotCon, status: "PARTIAL", daRot: 500_000 }] });
    expect(coTien.cach).toBe("THEO_CON");
    expect(chuaHapThuKhiMienGiam(coTien)).toBe(1_000_000);
  });

  it("[MG-L02] đơn thu TOÀN ĐƠN (R0 chưa nhận đồng nào) ⇒ CAP_DON toàn đơn — VOID đúng R0 rồi dựng lại", () => {
    const r = kh();
    expect(r).toMatchObject({ cach: "CAP_DON", toanDon: true });
    expect(dotSeHuyKhiMienGiam(r)).toEqual(["r0"]);
    expect(chuaHapThuKhiMienGiam(r), "không còn phần 'QR vẫn đòi số cũ'").toBe(0);
    expect(moTaTruocMienGiamCapDon(r)).toContain("phiếu thu TOÀN ĐƠN");
  });

  it("[MG-L03] R0 ĐÃ nhận tiền ⇒ CHẶN (không VOID phiếu có tiền), câu nói đúng số đã nhận", () => {
    const r = kh({ phieuThu: [pt({ id: "r0", status: "PARTIAL", daRot: 2_000_000 })] });
    expect(r).toEqual({ cach: "CHAN", loi: loiMienR0CoTien(2_000_000) });
    expect(loiMienR0CoTien(2_000_000)).toContain("đã nhận 2.000.000đ");
    expect(dotSeHuyKhiMienGiam(r)).toEqual([]);
  });

  it("[MG-L04] đợt ĐƠN, kế hoạch khớp ⇒ CAP_DON theo CHÍNH SÁCH của cơ sở (xa nhất / gần nhất)", () => {
    const xa = kh({ phieuThu: dotDon(), keHoachDon: keHoach3() });
    expect(xa).toMatchObject({ cach: "CAP_DON", toanDon: false });
    expect(xa.cach === "CAP_DON" ? xa.ke.doi : null).toEqual([{ id: "d3", installmentNo: 3, soCu: 4_488_000, soMoi: 3_488_000 }]);
    const gan = kh({ phieuThu: dotDon(), keHoachDon: keHoach3(), cach: CACH_HAP_THU.DOT_GAN_NHAT });
    expect(dotSeHuyKhiMienGiam(gan)).toEqual(["d1"]);
    expect(moTaTruocMienGiamCapDon(xa)).toContain("Đợt 3 4.488.000đ → 3.488.000đ");
  });

  it("[MG-L05] đợt đơn ĐÃ có tiền không bị chạm; không trừ HẾT vào đợt chưa có tiền ⇒ CHẶN nói trần", () => {
    const phieu = dotDon().map((p) => (p.id === "d1" ? { ...p, status: "PARTIAL", daRot: 1_000_000 } : p));
    // Gần nhất: đợt 1 có tiền ⇒ bỏ qua, trừ vào đợt 2.
    expect(dotSeHuyKhiMienGiam(kh({ phieuThu: phieu, keHoachDon: keHoach3(), cach: CACH_HAP_THU.DOT_GAN_NHAT }))).toEqual(["d2"]);
    // Đợt 2 + 3 chỉ có 8.976.000 chưa có tiền ⇒ miễn 9.000.000 bị CHẶN, nói "tối đa 8.976.000đ".
    const r = kh({ phieuThu: phieu, keHoachDon: keHoach3(), canGiam: 9_000_000 });
    expect(r.cach).toBe("CHAN");
    expect(r.cach === "CHAN" ? r.loi : "").toContain("tối đa 8.976.000đ");
    expect(r.cach === "CHAN" ? r.loi : "").toContain("Đợt 1 đã nhận 1.000.000đ");
    // Đợt mà KẾ HOẠCH (sổ cũ) ghi ĐÃ THU coi như có tiền dù phiếu thu chưa nhận đồng nào.
    const soCu = keHoach3().map((k) => (k.soDot === 3 ? { ...k, status: "PAID" } : k));
    expect(dotSeHuyKhiMienGiam(kh({ phieuThu: dotDon(), keHoachDon: soCu }))).toEqual(["d2"]);
  });

  it("[MG-L06] kế hoạch LỆCH phiếu thu ⇒ CHẶN (materialize sẽ đổi thứ khác ngoài phần miễn)", () => {
    const thieuDong = kh({ phieuThu: dotDon(), keHoachDon: keHoach3().slice(0, 2) });
    expect(thieuDong.cach === "CHAN" ? thieuDong.loi : "").toContain("Đợt 3 có phiếu thu mà không có trong kế hoạch");
    const lechSo = kh({ phieuThu: dotDon(), keHoachDon: keHoach3().map((k) => (k.soDot === 2 ? { ...k, amount: 4_000_000 } : k)) });
    expect(lechSo.cach === "CHAN" ? lechSo.loi : "").toContain("Đợt 2: kế hoạch 4.000.000đ, phiếu thu 4.488.000đ");
    const thuaDong = kh({ phieuThu: dotDon(), keHoachDon: [...keHoach3(), { soDot: 4, amount: 1, status: "PENDING" }] });
    expect(thuaDong.cach === "CHAN" ? thuaDong.loi : "").toContain("Đợt 4 có trong kế hoạch mà không có phiếu thu");
  });

  it("[MG-L07] bé ĐÃ DỪNG trên đơn thu mức ĐƠN ⇒ CHẶN; bé đã dừng có đợt theo con ⇒ luật cũ (đối chứng)", () => {
    expect(kh({ daDungHoc: true })).toEqual({ cach: "CHAN", loi: LY_DO_MIEN_BE_DA_DUNG_CAP_DON });
    const dotCon = pt({ id: "a1", orderItemId: BE_A, installmentNo: 1, amountDue: 3_168_000 });
    expect(kh({ daDungHoc: true, phieuThu: [dotCon] }).cach).toBe("THEO_CON");
  });

  it("[MG-L08] đơn LẪN hai loại đợt (đợt theo con của bé khác còn sống + phiếu cấp đơn mở) ⇒ CHẶN", () => {
    const r = kh({ phieuThu: [pt({ id: "r0" }), pt({ id: "b1", orderItemId: BE_B, installmentNo: 1, amountDue: 3_564_000, status: "PAID", daRot: 3_564_000 })] });
    expect(r).toEqual({ cach: "CHAN", loi: LY_DO_MIEN_LAN_HAI_LOAI_DOT });
  });

  it("[MG-L09] không phiếu nào đòi phần nợ này (bé chưa có đợt, đơn thu theo con) ⇒ KHONG_PHIEU, không nói 'QR vẫn đòi số cũ'", () => {
    const r = kh({ phieuThu: [pt({ id: "b1", orderItemId: BE_B, installmentNo: 1, amountDue: 3_564_000 })] });
    expect(r).toEqual({ cach: "KHONG_PHIEU" });
    expect(dotSeHuyKhiMienGiam(r)).toEqual([]);
    expect(chuaHapThuKhiMienGiam(r)).toBe(0);
  });

  it("[MG-L10] R0 lẫn đợt đơn ⇒ CHẶN (R0 mở cạnh đợt; R0 PAID cạnh đợt đang mở — materialize VOID R0 kể cả khi giữ tiền)", () => {
    const moCaHai = [pt({ id: "r0" }), ...dotDon().slice(1)];
    expect(kh({ phieuThu: moCaHai, keHoachDon: keHoach3() })).toEqual({ cach: "CHAN", loi: LY_DO_MIEN_R0_LAN_DOT });
    const r0Paid = [pt({ id: "r0", status: "PAID", daRot: 13_464_000 }), ...dotDon().slice(1)];
    expect(kh({ phieuThu: r0Paid, keHoachDon: keHoach3() })).toEqual({ cach: "CHAN", loi: LY_DO_MIEN_R0_LAN_DOT });
  });

  it("[MG-L11] câu NÓI SAU: phiếu cấp đơn dựng lại theo số nào — đợt về 0đ nói 'huỷ'", () => {
    const khop = (n: number) => ({ phieuConDoi: n, conNoDon: n });
    expect(thongDiepDungLaiCapDon({ toanDon: true, dot: [{ installmentNo: 0, soMoi: 12_464_000 }] }, khop(12_464_000))).toBe(
      "Phiếu thu toàn đơn dựng lại: 12.464.000đ — mã QR cũ hết hiệu lực, phát mã mới cho số còn nợ.",
    );
    expect(
      thongDiepDungLaiCapDon({ toanDon: false, dot: [{ installmentNo: 2, soMoi: 0 }, { installmentNo: 3, soMoi: 3_488_000 }] }, khop(8_976_000)),
    ).toBe("Đợt của đơn dựng lại: Đợt 2 huỷ (miễn hết) · Đợt 3 → 3.488.000đ — mã QR cũ hết hiệu lực, phát mã mới cho số còn nợ.");
    expect(thongDiepDungLaiCapDon(null, khop(0))).toBeNull();
    // Đơn về 0đ: không mời "phát mã mới" cho một khoản nợ không còn.
    expect(thongDiepDungLaiCapDon({ toanDon: true, dot: [{ installmentNo: 0, soMoi: 0 }] }, khop(0))).toBe(
      "Phiếu thu toàn đơn huỷ (miễn hết) — mã QR cũ hết hiệu lực.",
    );
  });

  it("[MG-L11b] rà vòng 6 — phiếu cấp đơn đòi NHIỀU hơn đơn còn nợ (tiền đã về chưa rót vào phiếu) ⇒ KHÔNG gọi số đó là 'số còn nợ'", () => {
    const s = thongDiepDungLaiCapDon(
      { toanDon: true, dot: [{ installmentNo: 0, soMoi: 12_464_000 }] },
      { phieuConDoi: 12_464_000, conNoDon: 7_464_000 },
    );
    expect(s).not.toContain("phát mã mới cho số còn nợ");
    expect(s).toContain("Phiếu thu toàn đơn dựng lại: 12.464.000đ");
    expect(s).toContain("đơn chỉ còn nợ 7.464.000đ");
  });

  it("[MG-L12] rà vòng 6 — VẾ ĐƠN: phần miễn vượt còn nợ CẢ ĐƠN ⇒ CHẶN, kể cả khi không phiếu cấp đơn nào còn mở", () => {
    // Trước bản vá: R0 ĐÃ THU ĐỦ (PAID) ⇒ không phiếu mở ⇒ KHONG_PHIEU, đơn thừa 1.000.000 mà màn im.
    const r0Paid = kh({ phieuThu: [pt({ id: "r0", status: "PAID", daRot: 13_464_000 })], conNoDon: 0 });
    expect(r0Paid).toEqual({ cach: "CHAN", loi: loiMienVuotNoDon(0) });
    // Mọi đợt đơn đã thu.
    const dotPaid = dotDon().map((p) => (p.id === "r0" ? p : { ...p, status: "PAID", daRot: p.amountDue }));
    const kePaid = keHoach3().map((k) => ({ ...k, status: "PAID" }));
    expect(kh({ phieuThu: dotPaid, keHoachDon: kePaid, conNoDon: 0 }).cach).toBe("CHAN");
    // R0 PENDING chưa rót đồng nào, nhưng sổ A đã có trọn khoản (kế hoạch một đợt "đã thu") ⇒ CHẶN —
    // không dựng lại R0 đòi 12.464.000 trên đơn đã thu đủ.
    expect(kh({ conNoDon: 0 })).toEqual({ cach: "CHAN", loi: loiMienVuotNoDon(0) });
    // Đơn thu theo con, bé chưa có đợt, tiền chưa gắn bé nào đã về ⇒ trần = còn nợ đơn.
    const b1 = pt({ id: "b1", orderItemId: BE_B, installmentNo: 1, amountDue: 3_564_000 });
    expect(kh({ phieuThu: [b1], conNoDon: 464_000 })).toEqual({ cach: "CHAN", loi: loiMienVuotNoDon(464_000) });
    expect(loiMienVuotNoDon(464_000)).toContain("tối đa 464.000đ");
    expect(loiMienVuotNoDon(-1_000_000)).toContain("thừa 1.000.000đ");
    expect(loiMienVuotNoDon(0)).toContain("hoàn tiền");
    // Đối chứng dương: vừa đủ còn nợ đơn ⇒ không chặn.
    expect(kh({ phieuThu: [b1], conNoDon: 1_000_000 }).cach).toBe("KHONG_PHIEU");
    // Luật cũ (bé CÓ đợt theo con) KHÔNG đụng — vế đơn đứng SAU vế 1. Áp cho THEO_CON là quyết định
    // nghiệp vụ còn để ngỏ (docs/pos-the-smartpos.md, vòng 6).
    const dotCon = pt({ id: "a1", orderItemId: BE_A, installmentNo: 1, amountDue: 3_168_000 });
    expect(kh({ phieuThu: [dotCon], conNoDon: 0 }).cach).toBe("THEO_CON");
  });

  it("[MG-L13] rà vòng 6 — R0 LỆCH tổng đơn (sau 'Thêm con'): nói trước + cổng dùng ĐÚNG số máy sẽ ghi (tổng đơn − phần miễn)", () => {
    // R0 6.336.000 (chỉ bé A), tổng đơn 13.464.000 (đã thêm bé B).
    const r = kh({ phieuThu: [pt({ id: "r0", amountDue: 6_336_000 })], tongDon: 13_464_000 });
    expect(r.cach === "CAP_DON" ? r.ke.doi : null).toEqual([{ id: "r0", installmentNo: 0, soCu: 6_336_000, soMoi: 12_464_000 }]);
    expect(moTaTruocMienGiamCapDon(r)).toContain("6.336.000đ → 12.464.000đ");
    expect(moTaTruocMienGiamCapDon(r)).toContain("TĂNG");
    // Miễn 7.000.000 cho bé B: trước bản vá bị CHẶN "phần còn lại rơi vào phiếu … ĐÃ nhận tiền" — lý do bịa.
    const b = kh({ orderItemId: BE_B, phieuThu: [pt({ id: "r0", amountDue: 6_336_000 })], tongDon: 13_464_000, canGiam: 7_000_000 });
    expect(b.cach === "CAP_DON" ? b.ke.doi : null).toEqual([{ id: "r0", installmentNo: 0, soCu: 6_336_000, soMoi: 6_464_000 }]);
    // Khớp tổng đơn (đa số đơn): câu nói số, không nói "tăng".
    const khop = kh();
    expect(moTaTruocMienGiamCapDon(khop)).toContain("13.464.000đ → 12.464.000đ");
    expect(moTaTruocMienGiamCapDon(khop)).not.toContain("TĂNG");
  });

  it("[MG-L14] rà vòng 6 — câu 'tối đa X' KHÔNG nói 'phiếu ĐÃ nhận tiền' khi không phiếu nào nhận đồng nào", () => {
    const ke = keHoachHapThu({
      dot: [{ id: "d1", installmentNo: 1, amountDue: 500_000, dueDate: null, daRot: 0 }],
      canGiam: 1_000_000,
      cach: CACH_HAP_THU.DOT_XA_NHAT,
    });
    const s = loiMienKhongHapThuDu(ke);
    expect(s).toContain("tối đa 500.000đ");
    expect(s).not.toContain("ĐÃ nhận tiền");
  });
});
