// Ca [HN1-01..14] — HAI Ô của một dòng đợt (QR · Thẻ) + "đang xem kênh nào" + cảnh báo + nút Huỷ phiếu.
// THUẦN. Hai nút QR / Thẻ POS chung một mã (09/10/2026) — docs/pos-hai-nut-khai-may.md §1.3-1.6.
//
// Luật 11: ca "KHÔNG thấy X" luôn đạt khi tính năng hỏng hoàn toàn ⇒ mỗi ca vắng mặt có ĐỐI CHỨNG DƯƠNG
// (cùng đầu vào, đổi đúng một yếu tố, ô phải xuất hiện). Riêng [HN1-08] là đối chứng của chủ dự án:
// người KHÔNG có `payments:pos-check` vẫn phải THẤY nút QR.
import { describe, it, expect } from "vitest";
import {
  batTatQr,
  canhBaoHaiKenh,
  CAU_CANH_BAO_HAI_KENH,
  cauKhongHuyDuoc,
  chuyenSangThe,
  docDieuKhienQr,
  kenhCuaDong,
  nutHuyPhieuGop,
  type DauVaoKenhCuaDong,
  type PhieuPosChoNutHuy,
} from "./kenh-thu";
import { LOI_HUY_KHI_CHO_QUET_THE, LOI_HUY_KHI_CHUA_KET_LUAN, LOI_HUY_KHI_THE_CHO_KE_TOAN } from "./pos/phieu-pos-luat";
import type { PhieuPosChoNut } from "./pos/nut-thu-the";
import {
  CAU_CHAN_HUY_PHIEU_GOP_DANG_CHO_CHUA_BIET,
  CAU_CHAN_HUY_PHIEU_GOP_DANG_CHO_CO_NUT,
  CAU_CHAN_HUY_PHIEU_GOP_DANG_CHO_KHONG_QUYEN,
  CAU_TU_CHOI_HUY_PHIEU_THE,
  cauChanHuyPhieuGopVuongPhieuThe,
  ghepCauTuChoiHuy,
} from "./pos/huy-phieu-the-cau";

const D1 = { paymentRequestId: "pr1", nhan: "Đợt 1/2" };

const THE_CHO: PhieuPosChoNut = { paymentRequestIds: ["pr1"], cuaPhieuDangMo: true, hienThi: "CHO_QUET", choKeToan: false };

function vao(p: Partial<DauVaoKenhCuaDong> = {}): DauVaoKenhCuaDong {
  return {
    duocPhatPhieu: true,
    duocThuThePos: true,
    bat: true,
    dongPhieuMo: null,
    paymentRequestId: "pr1",
    rowStatus: "PENDING",
    conThieu: 800_000,
    lyDoChuaDuyet: null,
    soMay: 1,
    phieuPos: null,
    theDangMo: null,
    dangBan: false,
    ...p,
  };
}

const XUAT_MO = { kieu: "XUAT", lyDoKhoa: null, dangBan: false } as const;
const TAO_MO = { kieu: "TAO", dangBan: false } as const;

describe("[HN1-01..07] bảng tổ hợp — hai ô của một dòng", () => {
  it("[HN1-01] chưa có phiếu gộp ⇒ QR: Xuất QR (phát phiếu 1 dòng) · Thẻ: Thẻ POS", () => {
    expect(kenhCuaDong(vao())).toEqual({ qr: XUAT_MO, the: TAO_MO });
  });

  it("[HN1-02] phiếu gộp KHÔNG có thẻ mở, chứa đợt này ⇒ QR: nút mã · Thẻ: Thẻ POS (dùng lại mã)", () => {
    expect(kenhCuaDong(vao({ dongPhieuMo: [D1] }))).toEqual({ qr: { kieu: "MA" }, the: TAO_MO });
  });

  it("[HN1-03] phiếu gộp + thẻ đang chờ ⇒ QR: nút mã · Thẻ: 'Thẻ · đang chờ'", () => {
    expect(kenhCuaDong(vao({ dongPhieuMo: [D1], phieuPos: THE_CHO }))).toEqual({ qr: { kieu: "MA" }, the: { kieu: "DANG_CHO" } });
    // THAT_BAI vẫn là phiếu MỞ.
    expect(kenhCuaDong(vao({ dongPhieuMo: [D1], phieuPos: { ...THE_CHO, hienThi: "THAT_BAI" } })).the).toEqual({ kieu: "DANG_CHO" });
  });

  it("[HN1-04] thẻ chờ kế toán (T21) ⇒ QR vẫn có nút mã · Thẻ: 'chờ kế toán', KHÔNG nút tạo mới", () => {
    const k = kenhCuaDong(vao({ dongPhieuMo: [D1], phieuPos: { ...THE_CHO, hienThi: "LECH_TIEN", choKeToan: true } }));
    expect(k).toEqual({ qr: { kieu: "MA" }, the: { kieu: "CHO_KE_TOAN" } });
  });

  it("[HN1-05] mã đang mở cho đợt KHÁC ⇒ câu 'Mã đang mở cho Đợt X' in ĐÚNG MỘT LẦN, không nút", () => {
    const k = kenhCuaDong(vao({ paymentRequestId: "pr2", dongPhieuMo: [D1] }));
    expect(k.qr).toMatchObject({ kieu: "DOT_KHAC", nhanDotDangGiu: "Đợt 1/2" });
    expect(k.the, "ô Thẻ không nhắc lại câu đã in ở ô QR").toEqual({ kieu: "AN" });
    // Đối chứng: không có quyền ghi phiếu ⇒ ô QR không in gì ⇒ ô Thẻ mới là chỗ nói (vẫn đúng một lần).
    const k2 = kenhCuaDong(vao({ paymentRequestId: "pr2", dongPhieuMo: [D1], duocPhatPhieu: false }));
    expect(k2.qr).toEqual({ kieu: "AN" });
    expect(k2.the).toMatchObject({ kieu: "DOT_KHAC", nhanDotDangGiu: "Đợt 1/2" });
    // Phiếu nhiều dòng: kể ĐỦ.
    expect(kenhCuaDong(vao({ paymentRequestId: "pr9", dongPhieuMo: [D1, { paymentRequestId: "pr2", nhan: "Đợt 2/2" }] })).qr).toMatchObject({
      kieu: "DOT_KHAC",
      nhanDotDangGiu: "Đợt 1/2, Đợt 2/2",
    });
  });

  it("[HN1-06] cờ TẮT ⇒ QR: đường QrSession đời cũ (giữ nguyên) · Thẻ: không gì", () => {
    expect(kenhCuaDong(vao({ bat: false }))).toEqual({ qr: { kieu: "CU" }, the: { kieu: "AN" } });
    // Cờ tắt mà (vì lý do gì đó) đơn có phiếu mở: luồng cũ thắng, không nửa vời.
    expect(kenhCuaDong(vao({ bat: false, dongPhieuMo: [D1] })).qr).toEqual({ kieu: "CU" });
    // Đối chứng: bật cờ lên ⇒ không còn là đường cũ.
    expect(kenhCuaDong(vao({ bat: true })).qr.kieu).not.toBe("CU");
  });

  it("[HN1-07] đơn CHỜ DUYỆT ⇒ QR: Xuất QR bị khoá kèm đúng câu của cổng · Thẻ: nút xám; xem lại mã đã phát vẫn được", () => {
    const k = kenhCuaDong(vao({ lyDoChuaDuyet: "Giảm giá chưa duyệt" }));
    expect(k.qr).toEqual({ kieu: "XUAT", lyDoKhoa: "Giảm giá chưa duyệt", dangBan: false });
    expect(k.the).toEqual({ kieu: "CHO_DUYET", lyDo: "Giảm giá chưa duyệt" });
    // Mã đã phát từ trước vẫn xem lại được: nút mã KHÔNG bị khoá (mã đã ra tay khách, giấu đi không thu hồi gì).
    expect(kenhCuaDong(vao({ lyDoChuaDuyet: "x", dongPhieuMo: [D1] }))).toEqual({
      qr: { kieu: "MA" },
      the: { kieu: "CHO_DUYET", lyDo: "x" },
    });
    // Đối chứng: hết chờ duyệt ⇒ mở.
    expect(kenhCuaDong(vao({ lyDoChuaDuyet: null })).qr).toEqual(XUAT_MO);
  });
});

describe("[HN1-08..10] ai thấy gì", () => {
  const TO_HOP: [string, Partial<DauVaoKenhCuaDong>][] = [
    ["chưa phiếu gộp", {}],
    ["có phiếu gộp", { dongPhieuMo: [D1] }],
    ["có phiếu gộp + thẻ đang chờ", { dongPhieuMo: [D1], phieuPos: THE_CHO }],
    ["cờ tắt", { bat: false }],
  ];

  it("[HN1-08] ĐỐI CHỨNG DƯƠNG: người KHÔNG có `payments:pos-check` vẫn THẤY ô QR y như người có quyền", () => {
    for (const [ten, p] of TO_HOP) {
      const co = kenhCuaDong(vao({ ...p, duocThuThePos: true }));
      const khong = kenhCuaDong(vao({ ...p, duocThuThePos: false }));
      expect(khong.qr, ten).toEqual(co.qr);
      expect(khong.qr.kieu, `${ten}: ô QR phải CÓ (không phải 'AN')`).not.toBe("AN");
      expect(khong.the, `${ten}: không quyền thẻ ⇒ không ô Thẻ`).toEqual({ kieu: "AN" });
    }
    // …và đối chứng của đối chứng: có quyền thẻ ⇒ ô Thẻ có (ít nhất ở ba tổ hợp bật cờ).
    expect(kenhCuaDong(vao({ duocThuThePos: true })).the.kieu).not.toBe("AN");
  });

  it("[HN1-09] không có `payments:record` ⇒ ô QR trống ở MỌI tổ hợp; ô Thẻ vẫn theo `nutThuThe`", () => {
    for (const [ten, p] of TO_HOP) {
      expect(kenhCuaDong(vao({ ...p, duocPhatPhieu: false })).qr, ten).toEqual({ kieu: "AN" });
    }
    expect(kenhCuaDong(vao({ duocPhatPhieu: false })).the).toEqual(TAO_MO);
    // Đối chứng: có quyền ⇒ ô QR có.
    expect(kenhCuaDong(vao({ duocPhatPhieu: true })).qr.kieu).toBe("XUAT");
  });

  it("[HN1-10] đợt đã đủ / đã huỷ ⇒ không ô nào; đợt thu một phần vẫn đủ hai ô", () => {
    for (const rowStatus of ["PAID", "VOID"] as const) {
      expect(kenhCuaDong(vao({ rowStatus, conThieu: 0 })), rowStatus).toEqual({ qr: { kieu: "AN" }, the: { kieu: "AN" } });
    }
    expect(kenhCuaDong(vao({ rowStatus: "PARTIAL", conThieu: 300_000 }))).toEqual({ qr: XUAT_MO, the: TAO_MO });
  });
});

describe("[HN1-11..12] 'đang xem kênh nào' — gắn với mã, mặc định theo thẻ", () => {
  it("[HN1-11] mặc định: có phiếu gộp KHÔNG thẻ mở ⇒ panel QR hiện (như cũ); có thẻ mở ⇒ ẩn; chưa phiếu gộp ⇒ ẩn", () => {
    expect(docDieuKhienQr({ billId: null, theDangMo: null, tuChon: null })).toEqual({ hienQr: false, qrDaMo: false });
    expect(docDieuKhienQr({ billId: "b1", theDangMo: null, tuChon: null })).toEqual({ hienQr: true, qrDaMo: true });
    expect(docDieuKhienQr({ billId: "b1", theDangMo: "DANG_CHO", tuChon: null })).toEqual({ hienQr: false, qrDaMo: false });
    expect(docDieuKhienQr({ billId: "b1", theDangMo: "CHO_KE_TOAN", tuChon: null })).toEqual({ hienQr: false, qrDaMo: false });
  });

  it("[HN1-11b] lựa chọn của người dùng thắng mặc định, nhưng CHỈ cho đúng mã đang xem", () => {
    const bat = { billId: "b1", hien: true, daMo: true };
    expect(docDieuKhienQr({ billId: "b1", theDangMo: "DANG_CHO", tuChon: bat })).toEqual({ hienQr: true, qrDaMo: true });
    const tat = { billId: "b1", hien: false, daMo: true };
    expect(docDieuKhienQr({ billId: "b1", theDangMo: null, tuChon: tat })).toEqual({ hienQr: false, qrDaMo: true });
    // Mã đổi (huỷ + phát lại) ⇒ lựa chọn cũ bị bỏ, về mặc định của mã mới.
    expect(docDieuKhienQr({ billId: "b2", theDangMo: "DANG_CHO", tuChon: bat })).toEqual({ hienQr: false, qrDaMo: false });
    expect(docDieuKhienQr({ billId: "b2", theDangMo: null, tuChon: tat })).toEqual({ hienQr: true, qrDaMo: true });
  });

  it("[HN1-12] chuyển kênh: bật/tắt QR · sang thẻ — luôn nhớ QR đã từng hiện", () => {
    // Đang ẩn ⇒ bấm ⇒ hiện, ghi nhớ đã mở.
    expect(batTatQr({ billId: "b1", hienQr: false, qrDaMo: false })).toEqual({ billId: "b1", hien: true, daMo: true });
    // Đang hiện ⇒ bấm ⇒ ẩn, VẪN nhớ đã mở.
    expect(batTatQr({ billId: "b1", hienQr: true, qrDaMo: true })).toEqual({ billId: "b1", hien: false, daMo: true });
    // Sang thẻ: ẩn QR (một kênh một lúc), giữ nguyên ghi nhớ.
    expect(chuyenSangThe({ billId: "b1", qrDaMo: true })).toEqual({ billId: "b1", hien: false, daMo: true });
    expect(chuyenSangThe({ billId: "b1", qrDaMo: false })).toEqual({ billId: "b1", hien: false, daMo: false });
  });

  it("[HN1-12b] kịch bản: QR hiện sẵn → bấm Thẻ → QR ẩn nhưng 'đã mở' → mở lại QR khi thẻ đang chờ ⇒ cảnh báo", () => {
    // 1) tải trang: phiếu gộp, không thẻ.
    let t = docDieuKhienQr({ billId: "b1", theDangMo: null, tuChon: null });
    expect(t).toEqual({ hienQr: true, qrDaMo: true });
    // 2) bấm Thẻ POS ⇒ QR ẩn, nhớ đã mở.
    const sauThe = chuyenSangThe({ billId: "b1", qrDaMo: t.qrDaMo });
    t = docDieuKhienQr({ billId: "b1", theDangMo: "DANG_CHO", tuChon: sauThe });
    expect(t).toEqual({ hienQr: false, qrDaMo: true });
    // Hộp thẻ biết QR đã từng hiện ⇒ cảnh báo trong hộp.
    expect(canhBaoHaiKenh({ theDangMo: "DANG_CHO", qrDaMo: t.qrDaMo })).toBe(true);
    // 3) bấm QR ⇒ hiện lại.
    const sauQr = batTatQr({ billId: "b1", hienQr: t.hienQr, qrDaMo: t.qrDaMo });
    t = docDieuKhienQr({ billId: "b1", theDangMo: "DANG_CHO", tuChon: sauQr });
    expect(t).toEqual({ hienQr: true, qrDaMo: true });
  });
});

describe("[HN1-13] cảnh báo cả hai kênh", () => {
  it("câu NGUYÊN VĂN chủ dự án chốt", () => {
    expect(CAU_CANH_BAO_HAI_KENH).toBe(
      "Mã này đang mở cho cả chuyển khoản và thẻ — khách chỉ trả MỘT cách. Khoản về sau sẽ vào hàng chờ gắn tay.",
    );
  });

  it("chỉ khi CẢ HAI: thẻ đang mở (đang chờ hoặc chờ kế toán) VÀ QR đã mở — thiếu một vế thì không", () => {
    expect(canhBaoHaiKenh({ theDangMo: "DANG_CHO", qrDaMo: true })).toBe(true);
    expect(canhBaoHaiKenh({ theDangMo: "CHO_KE_TOAN", qrDaMo: true })).toBe(true);
    expect(canhBaoHaiKenh({ theDangMo: "DANG_CHO", qrDaMo: false }), "chỉ dùng thẻ").toBe(false);
    expect(canhBaoHaiKenh({ theDangMo: null, qrDaMo: true }), "chỉ dùng QR").toBe(false);
    expect(canhBaoHaiKenh({ theDangMo: null, qrDaMo: false })).toBe(false);
  });
});

/** Phiếu thẻ ĐANG CHỜ QUẸT lên màn + phán quyết "huỷ tay được không" của hộp (Việc 4). */
const THE_CHO_HUY: PhieuPosChoNutHuy = { ...THE_CHO, huyPhieuThe: { huyDuoc: true, canXacNhanManh: true } };
/** Cùng phiếu đang chờ quẹt nhưng hộp KHÔNG cho huỷ (lần kiểm gần nhất lỗi kết nối). */
const THE_CHO_KHONG_HUY: PhieuPosChoNutHuy = {
  ...THE_CHO,
  huyPhieuThe: { huyDuoc: false, ma: "LOI_KET_NOI", ...CAU_TU_CHOI_HUY_PHIEU_THE.LOI_KET_NOI },
};
/** Ngữ cảnh người xem CÓ `payments:pos-check`, phiếu thẻ không lên màn (rời màn sau 30′ / người xem không nạp được). */
const CO_QUYEN_KHONG_THAY_PHIEU = { duocThuThePos: true, phieuPos: null } as const;

describe("[HN1-14] nút 'Huỷ phiếu' — chỉ vẽ khi máy chủ sẽ cho (luật 12)", () => {
  it("không thẻ mở ⇒ NÚT (đối chứng dương cho các ca CHAN)", () => {
    expect(nutHuyPhieuGop({ duocHuy: true, daNhan: 0, theDangMo: null, ...CO_QUYEN_KHONG_THAY_PHIEU })).toEqual({ kieu: "NUT" });
  });

  it("có thẻ mở ⇒ CHAN kèm câu nói đúng điều đang xảy ra", () => {
    const cho = nutHuyPhieuGop({ duocHuy: true, daNhan: 0, theDangMo: "DANG_CHO", duocThuThePos: true, phieuPos: THE_CHO_HUY });
    expect(cho.kieu).toBe("CHAN");
    if (cho.kieu !== "CHAN") throw new Error("kiểu");
    expect(cho.cau).toBe(cauKhongHuyDuoc("DANG_CHO", { duocThuThePos: true, phieuPos: THE_CHO_HUY }));
    expect(cho.cau).toContain("Đang chờ quẹt thẻ cho mã này");

    const ke = nutHuyPhieuGop({ duocHuy: true, daNhan: 0, theDangMo: "CHO_KE_TOAN", ...CO_QUYEN_KHONG_THAY_PHIEU });
    expect(ke).toEqual({ kieu: "CHAN", cau: LOI_HUY_KHI_THE_CHO_KE_TOAN });
  });

  it("không có quyền, hoặc phiếu đã nhận tiền (chỉ ĐÓNG được) ⇒ không nút Huỷ, không câu chặn", () => {
    expect(nutHuyPhieuGop({ duocHuy: false, daNhan: 0, theDangMo: null, ...CO_QUYEN_KHONG_THAY_PHIEU })).toEqual({ kieu: "AN" });
    expect(nutHuyPhieuGop({ duocHuy: false, daNhan: 0, theDangMo: "DANG_CHO", ...CO_QUYEN_KHONG_THAY_PHIEU })).toEqual({ kieu: "AN" });
    expect(nutHuyPhieuGop({ duocHuy: true, daNhan: 500_000, theDangMo: null, ...CO_QUYEN_KHONG_THAY_PHIEU })).toEqual({ kieu: "AN" });
    expect(nutHuyPhieuGop({ duocHuy: true, daNhan: 500_000, theDangMo: "DANG_CHO", ...CO_QUYEN_KHONG_THAY_PHIEU })).toEqual({ kieu: "AN" });
  });
});

describe("[HN4-K] câu chặn 'Huỷ phiếu' khi thẻ ĐANG CHỜ: chỉ trỏ tới nút THẬT mà người xem sẽ thấy (Việc 4 · luật 12)", () => {
  const chan = (v: { duocThuThePos: boolean; phieuPos: PhieuPosChoNutHuy | null }) => {
    const r = nutHuyPhieuGop({ duocHuy: true, daNhan: 0, theDangMo: "DANG_CHO", ...v });
    if (r.kieu !== "CHAN") throw new Error("phải CHAN");
    return r.cau;
  };

  it("[HN4-K1] người xem CÓ quyền + hộp CHO huỷ ⇒ trỏ đúng nút; câu MÁY CHỦ (nguyên văn chủ dự án) là TIỀN TỐ của nó", () => {
    expect(chan({ duocThuThePos: true, phieuPos: THE_CHO_HUY })).toBe(CAU_CHAN_HUY_PHIEU_GOP_DANG_CHO_CO_NUT);
    expect(CAU_CHAN_HUY_PHIEU_GOP_DANG_CHO_CO_NUT.startsWith(LOI_HUY_KHI_CHO_QUET_THE)).toBe(true);
    expect(CAU_CHAN_HUY_PHIEU_GOP_DANG_CHO_CO_NUT).toContain("Thẻ · đang chờ");
    expect(CAU_CHAN_HUY_PHIEU_GOP_DANG_CHO_CO_NUT).toContain("Huỷ phiếu thẻ");
  });

  it("[HN4-K2] người xem KHÔNG có quyền ⇒ chỉ nói nhờ ai, KHÔNG hứa nút họ không có — kể cả khi phiếu thẻ cho huỷ", () => {
    // Đối chứng dương của K1: cùng phiếu thẻ cho huỷ, đổi đúng MỘT yếu tố (quyền) ⇒ câu đổi.
    const c = chan({ duocThuThePos: false, phieuPos: THE_CHO_HUY });
    expect(c).toBe(CAU_CHAN_HUY_PHIEU_GOP_DANG_CHO_KHONG_QUYEN);
    expect(c).not.toBe(chan({ duocThuThePos: true, phieuPos: THE_CHO_HUY }));
    expect(c).not.toMatch(/bấm/i);
    expect(c).toContain("người có quyền thu thẻ POS");
  });

  it("[HN4-K3] có quyền nhưng phiếu thẻ KHÔNG lên màn (null) ⇒ chỉ tới ô 'Thẻ · đang chờ' — không biết hộp sẽ cho huỷ hay không nên không hứa nút", () => {
    const c = chan({ duocThuThePos: true, phieuPos: null });
    expect(c).toBe(CAU_CHAN_HUY_PHIEU_GOP_DANG_CHO_CHUA_BIET);
    expect(c).toContain("Thẻ · đang chờ");
    expect(c).not.toBe(CAU_CHAN_HUY_PHIEU_GOP_DANG_CHO_CO_NUT);
  });

  it("[HN4-K4] có quyền, hộp KHÔNG cho huỷ ⇒ nói LÝ DO bằng đúng cặp câu hộp in, KHÔNG hứa 'bấm Huỷ phiếu thẻ'", () => {
    const c = chan({ duocThuThePos: true, phieuPos: THE_CHO_KHONG_HUY });
    expect(c).toBe(cauChanHuyPhieuGopVuongPhieuThe(ghepCauTuChoiHuy(CAU_TU_CHOI_HUY_PHIEU_THE.LOI_KET_NOI)));
    expect(c).toContain(CAU_TU_CHOI_HUY_PHIEU_THE.LOI_KET_NOI.lyDo);
    expect(c).not.toContain("bấm “Thẻ · đang chờ”");
    expect(c).not.toContain(CAU_CHAN_HUY_PHIEU_GOP_DANG_CHO_CO_NUT);
  });

  it("[HN4-K5] phán quyết của hộp chỉ dùng khi phiếu trên màn LÀ phiếu đang chờ quẹt — màn đang cầm một phiếu CŨ (hết hạn) không được mượn", () => {
    // `chonPhieuPosHienThi` ẩn phiếu thẻ ≥ 30′ rồi lấy phiếu cũ hơn của CÙNG phiếu gộp (vd HET_HAN): phán quyết của phiếu cũ
    // ("đã hết hạn — không cần huỷ") mô tả SAI phiếu thật đang giữ mã. Phải rơi về "chưa biết", không phải lặp phán quyết đó.
    const cu: PhieuPosChoNutHuy = {
      ...THE_CHO,
      hienThi: "HET_HAN",
      huyPhieuThe: { huyDuoc: false, ma: "DA_HET_HAN", ...CAU_TU_CHOI_HUY_PHIEU_THE.DA_HET_HAN },
    };
    expect(chan({ duocThuThePos: true, phieuPos: cu })).toBe(CAU_CHAN_HUY_PHIEU_GOP_DANG_CHO_CHUA_BIET);
    // Phiếu của phiếu gộp KHÁC (`cuaPhieuDangMo: false`) cũng không được mượn.
    expect(chan({ duocThuThePos: true, phieuPos: { ...THE_CHO_HUY, cuaPhieuDangMo: false } })).toBe(CAU_CHAN_HUY_PHIEU_GOP_DANG_CHO_CHUA_BIET);
    // Đối chứng dương: cùng phiếu, đang chờ quẹt ⇒ mượn được.
    expect(chan({ duocThuThePos: true, phieuPos: THE_CHO_HUY })).toBe(CAU_CHAN_HUY_PHIEU_GOP_DANG_CHO_CO_NUT);
  });

  it("[HN4-K6] bốn câu khác nhau; ba loại thẻ mở có câu riêng; CHO_KE_TOAN / CHUA_KET_LUAN không đổi theo ngữ cảnh (chúng không hứa nút huỷ phiếu thẻ)", () => {
    const bon = [
      chan({ duocThuThePos: true, phieuPos: THE_CHO_HUY }),
      chan({ duocThuThePos: false, phieuPos: THE_CHO_HUY }),
      chan({ duocThuThePos: true, phieuPos: null }),
      chan({ duocThuThePos: true, phieuPos: THE_CHO_KHONG_HUY }),
    ];
    expect(new Set(bon).size).toBe(4);
    for (const nguCanh of [
      { duocThuThePos: true, phieuPos: THE_CHO_HUY },
      { duocThuThePos: false, phieuPos: null },
      { duocThuThePos: true, phieuPos: THE_CHO_KHONG_HUY },
    ]) {
      expect(cauKhongHuyDuoc("CHO_KE_TOAN", nguCanh)).toBe(LOI_HUY_KHI_THE_CHO_KE_TOAN);
      expect(cauKhongHuyDuoc("CHUA_KET_LUAN", nguCanh)).toBe(LOI_HUY_KHI_CHUA_KET_LUAN);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RÀ ĐỐI KHÁNG VIỆC 1 (09/10/2026) — docs/pos-hai-nut-khai-may.md §1.11
// ─────────────────────────────────────────────────────────────────────────────

describe("[HN2-01..03] ô dòng đi theo SỰ THẬT MÁY CHỦ (`theDangMo`), không theo phiếu thẻ đang lên màn", () => {
  it("[HN2-01] phiếu thẻ đã rời màn (không còn `phieuPos`) mà máy chủ nói thẻ đang mở ⇒ ô Thẻ nói đúng, KHÔNG mời 'Thẻ POS'", () => {
    // Phiếu bỏ dở ≥ 30 phút rời màn sale (U9) nhưng cổng huỷ vẫn khoá (V2). Bản cũ: ô dòng ra 'Thẻ POS' (TAO) trong khi
    // nút Huỷ nói 'Đang chờ quẹt thẻ' — màn tự mâu thuẫn.
    expect(kenhCuaDong(vao({ dongPhieuMo: [D1], phieuPos: null, theDangMo: "DANG_CHO" }))).toEqual({
      qr: { kieu: "MA" },
      the: { kieu: "DANG_CHO" },
    });
    expect(kenhCuaDong(vao({ dongPhieuMo: [D1], theDangMo: "CHO_KE_TOAN" })).the).toEqual({ kieu: "CHO_KE_TOAN" });
    expect(kenhCuaDong(vao({ dongPhieuMo: [D1], theDangMo: "CHUA_KET_LUAN" })).the).toEqual({ kieu: "CHUA_KET_LUAN" });
    // Đối chứng dương: cùng đầu vào, máy chủ nói KHÔNG có thẻ ⇒ mời 'Thẻ POS'.
    expect(kenhCuaDong(vao({ dongPhieuMo: [D1], phieuPos: null, theDangMo: null })).the).toEqual(TAO_MO);
  });

  it("[HN2-02] người KHÔNG có `payments:pos-check`: thẻ đang mở ⇒ một NHÃN CHỮ (không nút, không cấp năng lực); không thẻ ⇒ không gì", () => {
    for (const t of ["DANG_CHO", "CHO_KE_TOAN", "CHUA_KET_LUAN"] as const) {
      const k = kenhCuaDong(vao({ duocThuThePos: false, dongPhieuMo: [D1], theDangMo: t }));
      expect(k.the, t).toEqual({ kieu: "CHI_BAO", the: t });
      expect(k.qr, "ô QR vẫn có (đối chứng dương của [HN1-08])").toEqual({ kieu: "MA" });
    }
    // Đối chứng dương: không có thẻ đang mở ⇒ ô Thẻ trống như cũ.
    expect(kenhCuaDong(vao({ duocThuThePos: false, dongPhieuMo: [D1], theDangMo: null })).the).toEqual({ kieu: "AN" });
  });

  it("[HN2-03] chỉ áp cho dòng THUỘC phiếu gộp đang mở, còn thu, cờ bật — còn lại không đổi", () => {
    // Dòng của đợt KHÁC: ô QR đã nói 'Mã đang mở cho…'; ô Thẻ im.
    expect(kenhCuaDong(vao({ paymentRequestId: "pr2", dongPhieuMo: [D1], theDangMo: "DANG_CHO" })).the).toEqual({ kieu: "AN" });
    // Đợt đã đủ: không còn gì để thu bằng thẻ.
    expect(kenhCuaDong(vao({ dongPhieuMo: [D1], theDangMo: "DANG_CHO", rowStatus: "PAID", conThieu: 0 })).the).toEqual({ kieu: "AN" });
    // Cờ tắt: không đụng tới đường mới.
    expect(kenhCuaDong(vao({ bat: false, dongPhieuMo: [D1], theDangMo: "DANG_CHO" })).the).toEqual({ kieu: "AN" });
    // Chưa có phiếu gộp (đầu vào không nhất quán): không bịa ra thẻ đang chờ.
    expect(kenhCuaDong(vao({ dongPhieuMo: null, theDangMo: "DANG_CHO" })).the).toEqual(TAO_MO);
  });
});

describe("[HN2-04] đợt sale ĐÃ THU TAY (còn thiếu 0đ) không mời phát mã mới — đối chứng: còn thiếu thì có", () => {
  it("PENDING + conThieu 0 ⇒ ô QR 'Xuất QR' KHÔNG có; ô Thẻ cũng không ⇒ cả hai trống", () => {
    expect(kenhCuaDong(vao({ rowStatus: "PENDING", conThieu: 0 }))).toEqual({ qr: { kieu: "AN" }, the: { kieu: "AN" } });
    // Đối chứng dương: cùng dòng, còn thiếu tiền ⇒ có nút.
    expect(kenhCuaDong(vao({ rowStatus: "PENDING", conThieu: 1 })).qr).toEqual(XUAT_MO);
    // Thu một phần mà còn thiếu 0 (đợt đủ theo sổ tay) cũng vậy.
    expect(kenhCuaDong(vao({ rowStatus: "PARTIAL", conThieu: 0 })).qr).toEqual({ kieu: "AN" });
  });

  it("…nhưng phiếu gộp ĐÃ MỞ chứa dòng đó vẫn có nút mã (đường duy nhất tới nút Huỷ phiếu khi panel ẩn)", () => {
    expect(kenhCuaDong(vao({ rowStatus: "PENDING", conThieu: 0, dongPhieuMo: [D1] })).qr).toEqual({ kieu: "MA" });
  });
});

describe("[HN2-05] một nút TẠO MÃ đang chạy ⇒ mọi nút tạo mã khoá (mỗi đơn một mã sống — hai lượt song song chắc chắn va nhau)", () => {
  it("dangBan khoá 'Xuất QR' và 'Thẻ POS'; không khoá nút chỉ bật/tắt panel", () => {
    expect(kenhCuaDong(vao({ dangBan: true }))).toEqual({
      qr: { kieu: "XUAT", lyDoKhoa: null, dangBan: true },
      the: { kieu: "TAO", dangBan: true },
    });
    // Đối chứng dương: hết bận ⇒ mở.
    expect(kenhCuaDong(vao({ dangBan: false }))).toEqual({ qr: XUAT_MO, the: TAO_MO });
    // Nút 'QR · MÃ' không gọi máy chủ ⇒ không khoá theo bận.
    expect(kenhCuaDong(vao({ dangBan: true, dongPhieuMo: [D1] })).qr).toEqual({ kieu: "MA" });
  });
});

describe("[HN2-06] đợt khác giữ mã: câu nói đúng điều đang xảy ra — thẻ đang chờ thì KHÔNG bảo 'đóng hoặc huỷ mã đó'", () => {
  it("không thẻ ⇒ câu cũ; có thẻ ⇒ nhãn thêm tình trạng thẻ và câu giải thích chưa huỷ được", () => {
    const khongThe = kenhCuaDong(vao({ paymentRequestId: "pr2", dongPhieuMo: [D1], theDangMo: null })).qr;
    if (khongThe.kieu !== "DOT_KHAC") throw new Error("kiểu");
    expect(khongThe.chu).toBe("Mã đang mở cho Đợt 1/2");
    expect(khongThe.cau).toContain("đóng hoặc huỷ mã đó rồi xuất lại");

    const cho = kenhCuaDong(vao({ paymentRequestId: "pr2", dongPhieuMo: [D1], theDangMo: "DANG_CHO" })).qr;
    if (cho.kieu !== "DOT_KHAC") throw new Error("kiểu");
    expect(cho.chu).toBe("Mã đang mở cho Đợt 1/2 (thẻ đang chờ)");
    expect(cho.cau).toContain("đang chờ quẹt thẻ");
    expect(cho.cau, "câu cũ chỉ vào lối thoát KHÔNG tồn tại trong lúc thẻ đang chờ").not.toContain("đóng hoặc huỷ mã đó rồi xuất lại");

    const ke = kenhCuaDong(vao({ paymentRequestId: "pr2", dongPhieuMo: [D1], theDangMo: "CHO_KE_TOAN" })).qr;
    if (ke.kieu !== "DOT_KHAC") throw new Error("kiểu");
    expect(ke.chu).toBe("Mã đang mở cho Đợt 1/2 (thẻ chờ kế toán)");
    expect(ke.cau).toContain("chờ kế toán");

    const ro = kenhCuaDong(vao({ paymentRequestId: "pr2", dongPhieuMo: [D1], theDangMo: "CHUA_KET_LUAN" })).qr;
    if (ro.kieu !== "DOT_KHAC") throw new Error("kiểu");
    expect(ro.chu).toBe("Mã đang mở cho Đợt 1/2 (thẻ chưa rõ kết quả)");
  });

  it("người không có quyền phát phiếu ⇒ ô Thẻ (có `pos-check`) là chỗ nói, cũng mang câu và nhãn đó", () => {
    const k = kenhCuaDong(vao({ paymentRequestId: "pr2", dongPhieuMo: [D1], theDangMo: "DANG_CHO", duocPhatPhieu: false }));
    expect(k.qr).toEqual({ kieu: "AN" });
    expect(k.the).toMatchObject({ kieu: "DOT_KHAC", chu: "Mã đang mở cho Đợt 1/2 (thẻ đang chờ)" });
  });
});

describe("[HN2-07] câu ở MÀN khi không huỷ được: nói đúng điều có thật (không hứa 'có kết quả thì huỷ được' — THAT_BAI vẫn chặn)", () => {
  it("mỗi loại thẻ mở có câu riêng; không câu nào nói 'có kết quả' như điều kiện huỷ", () => {
    const nguCanh = { duocThuThePos: true, phieuPos: THE_CHO_HUY } as const;
    for (const t of ["DANG_CHO", "CHO_KE_TOAN", "CHUA_KET_LUAN"] as const) {
      expect(cauKhongHuyDuoc(t, nguCanh), t).not.toMatch(/có kết quả hoặc hết hạn/i);
    }
    expect(cauKhongHuyDuoc("CHUA_KET_LUAN", nguCanh)).toContain("chưa kết luận");
    expect(cauKhongHuyDuoc("CHUA_KET_LUAN", nguCanh), "đường thoát có thật: bấm Kiểm tra trong hộp thẻ").toContain("Kiểm tra");
    const ba = (["DANG_CHO", "CHO_KE_TOAN", "CHUA_KET_LUAN"] as const).map((t) => cauKhongHuyDuoc(t, nguCanh));
    expect(new Set(ba).size, "ba câu khác nhau").toBe(3);
  });

  it("[HN2-07b] nút Huỷ phiếu chặn cả thẻ CHƯA KẾT LUẬN (máy chủ cũng chặn)", () => {
    expect(nutHuyPhieuGop({ duocHuy: true, daNhan: 0, theDangMo: "CHUA_KET_LUAN", ...CO_QUYEN_KHONG_THAY_PHIEU })).toEqual({
      kieu: "CHAN",
      cau: cauKhongHuyDuoc("CHUA_KET_LUAN", CO_QUYEN_KHONG_THAY_PHIEU),
    });
  });
});
