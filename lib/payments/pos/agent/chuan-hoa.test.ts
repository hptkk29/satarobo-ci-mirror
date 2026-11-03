// Ca [POS4-CH-01..04] · [POS4-TRON-01] — CHUẨN HOÁ một dòng giao dịch agent về ĐÚNG khuôn dòng của import file
// (GĐ4 POS — T7, T8, T9, T10, T11, T12, T14). THUẦN.
//
// Thiết kế: docs/pos-gd4-thiet-ke.md §5.2–5.5. Hợp đồng: docs/pos-agent-api.md §6.1 + §7.2. Đầu ra đi qua CHÍNH
// `dongPosSchema` (lưới che số thẻ của file) và được phân loại bởi CHÍNH `phanLoaiDongPos` — một bộ chuẩn hoá,
// một luật cho hai nguồn.
import { describe, it, expect } from "vitest";
import type { DongPos } from "../kieu";
import { phanLoaiDongPos, laTrangThaiThanhCong, maTrangThaiPos } from "../phan-loai-pos";
import { chuanHoaDongAgent, tronVoiDongDaCo, type KetQuaChuanHoa } from "./chuan-hoa";
import { phanGiaiMay, type MayPos } from "./may";
import { ganGocVoid } from "./goc-void";
import { bamDong, bamDienGiai } from "./bam";
import type { DongAgentTho } from "./schema";
import { sinhMa } from "@/lib/payments/ma-phieu";

const MERCHANT = "NCCPH6KE";
/** Mã THẬT (qua checksum US-10 — D2): `tachMaPos` bỏ token không hợp lệ (K7M2N của vector chỉ là minh hoạ). */
const MA = sinhMa(1234);
const MAY: MayPos = {
  maThietBi: "SP_V9E1013322",
  maQuay: "QTT45XWQT",
  maNhaCungCap: "NCCPH6KE",
  maCuaHang: "CH9TSGU9",
  active: true,
  centerId: "cs1",
};

const DONG: DongAgentTho = {
  transaction_id: "TXN20261007000123",
  transaction_type: "PAYMENT",
  transaction_detail_status: "SUCCESS",
  transaction_master_status: "SUCCESS",
  order_description: `Học phí bé An ${MA}`,
  authorization_id: "123456",
  card_transaction_id: "628012345678",
  order_amount: 6_732_000,
  transaction_master_amount: 6_732_000,
  transaction_detail_amount: 6_732_000,
  fee: null,
  currency: "VND",
  transaction_time: "2026/10/07 10:18:42",
  merchant_code: "NCCPH6KE",
  store_code: "CH9TSGU9",
  terminal_code: "QTT45XWQT",
  payment_method: "CARD",
  service_type: "OMSMARTPOS",
  sender_card_number: "411111******1111",
  sender_card_type: "VISA",
  accounting_reference_id: null,
  settlement_id: null,
};

const ch = (r: Partial<DongAgentTho>, may: readonly MayPos[] = [MAY]): KetQuaChuanHoa =>
  chuanHoaDongAgent({ ...DONG, ...r }, { merchantCode: MERCHANT, danhSachMay: may });

function nhan(r: Partial<DongAgentTho>, may?: readonly MayPos[]) {
  const k = ch(r, may);
  if (k.loai !== "NHAN") throw new Error(`mong NHAN, ra TU_CHOI ${k.code}`);
  return k;
}
function tuChoi(r: Partial<DongAgentTho>, may?: readonly MayPos[]) {
  const k = ch(r, may);
  if (k.loai !== "TU_CHOI") throw new Error("mong TU_CHOI, ra NHAN");
  return k;
}

const CTX_THU = { thietBiDaGan: true, biHuyTrongLo: false, biHoanMotPhan: false } as const;

describe("[POS4-CH-01] chuanHoaDongAgent — bảng ánh xạ §6.1", () => {
  it("PAYMENT/SUCCESS ⇒ 'Thanh toán'/'Thành công', ĐÚNG khuôn dòng file; phân loại THU đúng mã phiếu", () => {
    const { dong, may } = nhan({});
    expect(dong.d).toEqual<DongPos>({
      maGiaoDich: "TXN20261007000123",
      loaiGiaoDich: "Thanh toán",
      hinhThuc: "Thẻ",
      trangThai: "Thành công",
      soTien: 6_732_000,
      thoiGian: "2026-10-07T10:18:42+07:00",
      dienGiai: `Học phí bé An ${MA}`,
      maChuanChi: "123456",
      maGiaoDichThe: "628012345678",
      maGiaoDichGoc: null,
      trangThaiHoanHuy: null,
      maDonHang: null,
      maQuay: "QTT45XWQT",
      maThietBi: "SP_V9E1013322",
      soTheMasked: "411111******1111",
      loaiThe: "VISA",
      maHachToan: null,
      phiGiaoDich: null,
    });
    expect(may?.centerId).toBe("cs1");
    expect(dong.maKetToan).toBeNull();
    expect(dong.maLyDoThatBai).toBeNull();
    const p = phanLoaiDongPos(dong.d, CTX_THU);
    expect(p).toEqual({ loai: "THU", ma: MA });
  });

  it("VOID số DƯƠNG ⇒ loại 'Hủy' + số ÂM (khuôn file); REFUND ⇒ 'Hoàn' âm; loại lạ giữ mã", () => {
    const v = nhan({ transaction_type: "VOID" });
    expect(v.dong.d.loaiGiaoDich).toBe("Hủy");
    expect(v.dong.d.soTien).toBe(-6_732_000);
    expect(phanLoaiDongPos(v.dong.d, CTX_THU).loai).toBe("HUY");
    const vAm = nhan({ transaction_type: "VOID", order_amount: -6_732_000, transaction_master_amount: -6_732_000, transaction_detail_amount: -6_732_000 });
    expect(vAm.dong.d.soTien).toBe(-6_732_000);
    const r = nhan({ transaction_type: "REFUND" });
    expect(r.dong.d.loaiGiaoDich).toBe("Hoàn");
    expect(r.dong.d.soTien).toBe(-6_732_000);
    const la = nhan({ transaction_type: "ADJUSTMENT" });
    expect(la.dong.d.loaiGiaoDich).toBe("ADJUSTMENT");
    expect(la.dong.d.soTien).toBe(-6_732_000);
    // PAYMENT giữ DẤU (≤ 0 ⇒ lõi luật 4 CAN_XU_LY, không tự thu).
    const pAm = nhan({ order_amount: -1, transaction_master_amount: null, transaction_detail_amount: null });
    expect(pAm.dong.d.soTien).toBe(-1);
    expect(phanLoaiDongPos(pAm.dong.d, CTX_THU)).toMatchObject({ loai: "CAN_XU_LY", taoGiaoDich: false });
  });

  it("T7 trạng thái: mọi giá trị SUCCESS ⇒ Thành công; mọi giá trị FAIL/FAILED ⇒ Thất bại; lẫn lộn / lạ ⇒ GIỮ MÃ (treo)", () => {
    expect(nhan({ transaction_master_status: null }).dong.d.trangThai).toBe("Thành công");
    expect(nhan({ transaction_detail_status: "FAIL", transaction_master_status: "FAILED" }).dong.d.trangThai).toBe("Thất bại");
    expect(nhan({ transaction_detail_status: "fail", transaction_master_status: null }).dong.d.trangThai).toBe("Thất bại");
    const lan = nhan({ transaction_detail_status: "SUCCESS", transaction_master_status: "FAIL" }).dong.d.trangThai;
    expect(laTrangThaiThanhCong(lan)).toBe(false);
    expect(maTrangThaiPos(lan)).not.toBe("THAT_BAI");
    const treo = nhan({ transaction_detail_status: "PENDING", transaction_master_status: null }).dong.d.trangThai;
    expect(treo).toBe("PENDING");
    expect(maTrangThaiPos(treo)).toBe("PENDING");
    expect(tuChoi({ transaction_detail_status: null, transaction_master_status: "  " }).code).toBe("STATUS_MISSING");
  });

  it("T8 số tiền: ba trường có mặt phải BẰNG NHAU; chuỗi '6732000.0' nhận; số lẻ / lệch / thiếu ⇒ từ chối", () => {
    expect(nhan({ order_amount: "6732000.0", transaction_master_amount: "6732000", transaction_detail_amount: null }).dong.d.soTien).toBe(6_732_000);
    expect(tuChoi({ transaction_detail_amount: 6_732_001 }).code).toBe("AMOUNT_MISMATCH");
    expect(tuChoi({ order_amount: 6_732_000.5, transaction_master_amount: null, transaction_detail_amount: null }).code).toBe("AMOUNT_NOT_INTEGER");
    expect(tuChoi({ order_amount: "6732000,5", transaction_master_amount: null, transaction_detail_amount: null }).code).toBe("AMOUNT_NOT_INTEGER");
    expect(tuChoi({ order_amount: null, transaction_master_amount: null, transaction_detail_amount: null }).code).toBe("AMOUNT_MISSING");
    // VOID mang số âm ở một trường, dương ở trường khác ⇒ cùng trị tuyệt đối ⇒ nhận.
    expect(nhan({ transaction_type: "VOID", order_amount: 6_732_000, transaction_master_amount: -6_732_000 }).dong.d.soTien).toBe(-6_732_000);
  });

  it("tiền tệ: VND / 704 / vắng ⇒ nhận; USD ⇒ CURRENCY_UNSUPPORTED", () => {
    expect(nhan({ currency: "704" }).loai).toBe("NHAN");
    expect(nhan({ currency: null }).loai).toBe("NHAN");
    expect(nhan({ currency: "vnd" }).loai).toBe("NHAN");
    expect(tuChoi({ currency: "USD" }).code).toBe("CURRENCY_UNSUPPORTED");
  });

  it("merchant khác ⇒ MERCHANT_MISMATCH, KHÔNG lưu dấu (T29); khác hoa/thường + khoảng trắng sau chuẩn hoá thì KHỚP", () => {
    const k = tuChoi({ merchant_code: "NCCQYY4D" });
    expect(k.code).toBe("MERCHANT_MISMATCH");
    expect(k.luuDau).toBe(false);
    expect(tuChoi({ merchant_code: null }).code).toBe("MERCHANT_MISMATCH");
    expect(nhan({ merchant_code: " nccph6ke " }).loai).toBe("NHAN");
  });

  it("mã giao dịch sai định dạng ⇒ BAD_TRANSACTION_ID, KHÔNG lưu dấu", () => {
    for (const ma of ["TXN-1", "ABC", null, "x".repeat(65)]) {
      const k = tuChoi({ transaction_id: ma });
      expect(k.code, String(ma)).toBe("BAD_TRANSACTION_ID");
      expect(k.luuDau).toBe(false);
    }
  });

  it("giờ: '2026/10/07 10:18:42' ⇒ ISO +07:00; dạng gạch / ISO có offset nhận; ngày không có thật ⇒ BAD_TIME (lưu dấu)", () => {
    expect(nhan({ transaction_time: "2026-10-07 10:18:42" }).dong.d.thoiGian).toBe("2026-10-07T10:18:42+07:00");
    expect(nhan({ transaction_time: "2026-10-07T03:18:42Z" }).dong.d.thoiGian).toBe("2026-10-07T10:18:42+07:00");
    for (const t of ["2026/02/30 10:00:00", "2026/10/07 24:00:00", "07/10/2026 10:18:42", "", null]) {
      const k = tuChoi({ transaction_time: t });
      expect(k.code, String(t)).toBe("BAD_TIME");
      expect(k.luuDau).toBe(true);
    }
  });

  it("thiếu loại ⇒ TYPE_MISSING (lưu dấu)", () => {
    const k = tuChoi({ transaction_type: " " });
    expect(k.code).toBe("TYPE_MISSING");
    expect(k.luuDau).toBe(true);
    expect(k.maGiaoDich).toBe("TXN20261007000123");
  });

  it("số thẻ 16 chữ số (portal lỡ không che) ⇒ bị CHE ở lưới cuối (dongPosSchema)", () => {
    expect(nhan({ sender_card_number: "4111111111111111" }).dong.d.soTheMasked).toBe("411111******1111");
  });

  it("T14: transaction_operation_msg dạng MÃ ⇒ maLyDoThatBai; chữ tự do ⇒ BỎ; settlement_id ⇒ maKetToan", () => {
    const a = nhan({ transaction_detail_status: "FAIL", transaction_master_status: null, transaction_operation_msg: "USER_CANCELLED" });
    expect(a.dong.maLyDoThatBai).toBe("USER_CANCELLED");
    expect(nhan({ transaction_operation_msg: "Khách hủy giao dịch" }).dong.maLyDoThatBai).toBeNull();
    expect(nhan({ transaction_operation_msg: "AB" }).dong.maLyDoThatBai).toBeNull();
    expect(nhan({ settlement_id: "STL20261007", accounting_reference_id: "HT001", fee: "12000" }).dong).toMatchObject({
      maKetToan: "STL20261007",
      d: { maHachToan: "HT001", phiGiaoDich: 12_000 },
    });
  });

  it("hình thức: CARD ⇒ Thẻ, QR ⇒ QR, lạ giữ mã, vắng ⇒ chuỗi rỗng", () => {
    expect(nhan({ payment_method: "QR" }).dong.d.hinhThuc).toBe("QR");
    expect(nhan({ payment_method: "APPLEPAY" }).dong.d.hinhThuc).toBe("APPLEPAY");
    expect(nhan({ payment_method: null }).dong.d.hinhThuc).toBe("");
  });

  it("T10: máy KHÔNG suy được ⇒ maThietBi null ⇒ lõi luật 5 'Thiết bị chưa gán cơ sở' (vẫn nhận dòng)", () => {
    const k = nhan({ terminal_code: "QTTKHAC00" });
    expect(k.dong.d.maThietBi).toBeNull();
    expect(k.dong.d.maQuay).toBe("QTTKHAC00");
    expect(phanLoaiDongPos(k.dong.d, { ...CTX_THU, thietBiDaGan: false })).toMatchObject({ lyDo: "Thiết bị chưa gán cơ sở" });
  });
});

describe("[POS4-CH-02] phanGiaiMay — (merchant, quầy[, cửa hàng]) ⇒ ĐÚNG MỘT máy đang bật", () => {
  const goi = (may: readonly MayPos[], o: { terminal?: string | null; store?: string | null; merchant?: string } = {}) =>
    phanGiaiMay({
      merchantCode: o.merchant ?? MERCHANT,
      terminalCode: o.terminal === undefined ? "QTT45XWQT" : o.terminal,
      storeCode: o.store === undefined ? "CH9TSGU9" : o.store,
      danhSachMay: may,
    });

  it("khớp ⇒ máy; so sau trim + IN HOA", () => {
    expect(goi([MAY])?.maThietBi).toBe("SP_V9E1013322");
    expect(goi([MAY], { terminal: " qtt45xwqt " })?.maThietBi).toBe("SP_V9E1013322");
  });
  it("máy tắt ⇒ null", () => expect(goi([{ ...MAY, active: false }])).toBeNull());
  it("maCuaHang đã khai mà KHÁC store_code ⇒ null; chưa khai ⇒ không đối chiếu", () => {
    expect(goi([MAY], { store: "CHKHAC" })).toBeNull();
    expect(goi([MAY], { store: null })).toBeNull();
    expect(goi([{ ...MAY, maCuaHang: null }], { store: "CHKHAC" })?.maThietBi).toBe("SP_V9E1013322");
  });
  it("hai máy cùng (merchant, quầy) ⇒ null (không đoán)", () => {
    expect(goi([MAY, { ...MAY, maThietBi: "SP_KHAC" }])).toBeNull();
  });
  it("merchant của máy khác / máy chưa khai merchant / quầy trống ⇒ null", () => {
    expect(goi([{ ...MAY, maNhaCungCap: "NCCQYY4D" }])).toBeNull();
    expect(goi([{ ...MAY, maNhaCungCap: null }])).toBeNull();
    expect(goi([MAY], { terminal: null })).toBeNull();
  });
});

describe("[POS4-CH-03] ganGocVoid — VOID thiếu mã gốc ⇒ PAYMENT DUY NHẤT cùng RRN + cùng quầy, giờ ≤ VOID (T9)", () => {
  const VOID = { maGiaoDichThe: "628012345678", maQuay: "QTT45XWQT", thoiGian: new Date("2026-10-07T03:30:00Z") };
  const uv = (ma: string, o: Partial<{ maGiaoDichThe: string | null; maQuay: string | null; thoiGian: Date; laThanhToan: boolean }> = {}) => ({
    maGiaoDich: ma,
    maGiaoDichThe: "628012345678",
    maQuay: "QTT45XWQT",
    thoiGian: new Date("2026-10-07T03:18:42Z"),
    laThanhToan: true,
    ...o,
  });

  it("một ứng viên ⇒ mã của nó; trùng mã (lô ∪ đã lưu) vẫn là một", () => {
    expect(ganGocVoid({ void: VOID, ungVien: [uv("TXNA0000001")] })).toBe("TXNA0000001");
    expect(ganGocVoid({ void: VOID, ungVien: [uv("TXNA0000001"), uv("TXNA0000001")] })).toBe("TXNA0000001");
  });
  it("0 hoặc ≥ 2 ứng viên ⇒ null (không đoán)", () => {
    expect(ganGocVoid({ void: VOID, ungVien: [] })).toBeNull();
    expect(ganGocVoid({ void: VOID, ungVien: [uv("TXNA0000001"), uv("TXNA0000002")] })).toBeNull();
  });
  it("ứng viên giờ SAU VOID ⇒ loại; đúng giờ VOID ⇒ nhận", () => {
    expect(ganGocVoid({ void: VOID, ungVien: [uv("TXNA0000001", { thoiGian: new Date("2026-10-07T03:30:01Z") })] })).toBeNull();
    expect(ganGocVoid({ void: VOID, ungVien: [uv("TXNA0000001", { thoiGian: VOID.thoiGian })] })).toBe("TXNA0000001");
  });
  it("khác quầy / khác RRN / không phải thanh toán / VOID thiếu RRN ⇒ loại", () => {
    expect(ganGocVoid({ void: VOID, ungVien: [uv("TXNA0000001", { maQuay: "QTTFBKATK" })] })).toBeNull();
    expect(ganGocVoid({ void: VOID, ungVien: [uv("TXNA0000001", { maGiaoDichThe: "999" })] })).toBeNull();
    expect(ganGocVoid({ void: VOID, ungVien: [uv("TXNA0000001", { laThanhToan: false })] })).toBeNull();
    expect(ganGocVoid({ void: { ...VOID, maGiaoDichThe: null }, ungVien: [uv("TXNA0000001")] })).toBeNull();
  });
  it("hai ứng viên nhưng một ở quầy khác ⇒ còn MỘT ⇒ nhận", () => {
    expect(ganGocVoid({ void: VOID, ungVien: [uv("TXNA0000001"), uv("TXNA0000002", { maQuay: "QTTFBKATK" })] })).toBe("TXNA0000001");
  });
});

describe("[POS4-CH-04] bamDong — băm dòng ĐÃ chuẩn hoá (T11)", () => {
  const goc = nhan({}).dong;

  it("64 hex; KHÔNG phụ thuộc thứ tự khoá", () => {
    const a = bamDong(goc);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    const daoKhoa = Object.fromEntries(Object.entries(goc.d).reverse()) as DongPos;
    expect(bamDong({ maLyDoThatBai: goc.maLyDoThatBai, d: daoKhoa, maKetToan: goc.maKetToan })).toBe(a);
  });

  it("ĐỔI khi maThietBi / maGiaoDichGoc / maHachToan / phiGiaoDich / maKetToan / maLyDoThatBai đổi", () => {
    const a = bamDong(goc);
    expect(bamDong({ ...goc, d: { ...goc.d, maThietBi: null } })).not.toBe(a);
    expect(bamDong({ ...goc, d: { ...goc.d, maGiaoDichGoc: "TXN0000000001" } })).not.toBe(a);
    expect(bamDong({ ...goc, d: { ...goc.d, maHachToan: "HT1" } })).not.toBe(a);
    expect(bamDong({ ...goc, d: { ...goc.d, phiGiaoDich: 1 } })).not.toBe(a);
    expect(bamDong({ ...goc, maKetToan: "STL1" })).not.toBe(a);
    expect(bamDong({ ...goc, maLyDoThatBai: "USER_CANCELLED" })).not.toBe(a);
  });

  it("bamDienGiai: NFC + gộp khoảng trắng + trim — không lưu chữ, hai cách gõ cùng nghĩa cùng băm", () => {
    expect(bamDienGiai("Học phí  bé An K7M2N ")).toBe(bamDienGiai("Học phí bé An K7M2N"));
    expect(bamDienGiai("Học phí bé An K7M2N".normalize("NFD"))).toBe(bamDienGiai("Học phí bé An K7M2N"));
    expect(bamDienGiai("K7M2N")).not.toBe(bamDienGiai("K7M2X"));
  });
});

describe("[POS4-TRON-01] trộn null — null của agent KHÔNG xoá giá trị đã có (T12)", () => {
  const d = nhan({}).dong.d;
  const DA_CO = {
    maChuanChi: "999999",
    maGiaoDichThe: "111",
    maGiaoDichGoc: "TXNGOC000001",
    trangThaiHoanHuy: "Hủy toàn phần",
    maDonHang: "DH1",
    maQuay: "QTTCU",
    maThietBi: "SP_CU",
    soTheMasked: "400000******0000",
    loaiThe: "MASTER",
    maHachToan: "HT_FILE",
    phiGiaoDich: 9_000,
    dienGiai: "ghi chú file K7M2N",
    hinhThuc: "Thẻ",
  };

  it("agent null ⇒ giữ giá trị file (cột gốc + Hoàn/Hủy); Mã hạch toán / Phí để LÕI che; agent có giá trị ⇒ agent thắng", () => {
    const t = tronVoiDongDaCo({ ...d, maHachToan: null, trangThaiHoanHuy: null, maGiaoDichGoc: null, phiGiaoDich: null }, DA_CO);
    // Gộp GĐ3 (G9): KHÔNG trộn mã hạch toán + phí — null đi thẳng vào lõi, lõi bỏ khoá (`cotKetToanCapNhat`) ⇒ giá
    // trị đang có được giữ MÀ KHÔNG ghi lại ảnh chụp đầu lô (ghi lại là đè lượt song song — `[POS4-G3-06]`). Mã
    // TRƯỚC: `maHachToan: d.maHachToan ?? daCo.maHachToan` (ca này từng khẳng định "HT_FILE" / 9.000).
    expect(t.maHachToan).toBeNull();
    expect(t.phiGiaoDich).toBeNull();
    expect(t.trangThaiHoanHuy).toBe("Hủy toàn phần");
    expect(t.maGiaoDichGoc).toBe("TXNGOC000001");
    // Có giá trị ⇒ agent thắng.
    expect(t.maChuanChi).toBe("123456");
    expect(t.maThietBi).toBe("SP_V9E1013322");
    const t2 = tronVoiDongDaCo({ ...d, maHachToan: "HT_AGENT" }, DA_CO);
    expect(t2.maHachToan).toBe("HT_AGENT");
  });

  it("ghi chú / hình thức RỖNG của agent = vắng ⇒ giữ của file (không xoá mã phiếu đang có)", () => {
    const t = tronVoiDongDaCo({ ...d, dienGiai: "", hinhThuc: "" }, DA_CO);
    expect(t.dienGiai).toBe("ghi chú file K7M2N");
    expect(t.hinhThuc).toBe("Thẻ");
  });

  it("chưa có dòng ⇒ giữ nguyên dòng agent", () => {
    expect(tronVoiDongDaCo(d, null)).toEqual(d);
  });
});

// [Rà đối kháng GĐ4 — RV-02] Ảnh chụp dòng BỊ TỪ CHỐI đi vào cột `PosTxnSource.soTien` INT4. Mã TRƯỚC: số tiền
// bằng nhau ≥ 2^31 được giữ nguyên ⇒ ghi dấu nguồn ném ConversionError ⇒ cả lô 500 sau khi đã ghi tiền dòng khác.
describe("[POS4-RV-02b] ảnh từ chối KHÔNG mang số tiền ngoài INT4", () => {
  it("USD 3.000.000.000 (ba trường bằng nhau) ⇒ CURRENCY_UNSUPPORTED, anh.soTien = null; 2.147.483.647 ⇒ giữ (biên)", () => {
    const ba = 3_000_000_000;
    const k = ch({ currency: "USD", order_amount: ba, transaction_master_amount: ba, transaction_detail_amount: ba });
    expect(k).toMatchObject({ loai: "TU_CHOI", code: "CURRENCY_UNSUPPORTED" });
    expect(k.loai === "TU_CHOI" ? k.anh?.soTien : "x").toBeNull();
    const bien = 2_147_483_647;
    const k2 = ch({ currency: "USD", order_amount: bien, transaction_master_amount: bien, transaction_detail_amount: bien });
    expect(k2.loai === "TU_CHOI" ? k2.anh?.soTien : "x").toBe(bien);
    const am = ch({ transaction_type: "VOID", currency: "USD", order_amount: -ba, transaction_master_amount: -ba, transaction_detail_amount: -ba });
    expect(am.loai === "TU_CHOI" ? am.anh?.soTien : "x").toBeNull();
  });
});
