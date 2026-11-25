// Ca [POS4-RVG-QD] · [POS4-RVG-TD] · [POS4-RVG-04] · [POS4-RVG-05] — RÀ ĐỐI KHÁNG BẢN GỘP GĐ3 × GĐ4 + hợp đồng 1.1
// (07/10/2026). THUẦN. Ca DB cùng đợt: `tests/finance/pos-gd4.test.ts` khối `[POS4-RVG]`.
//
// Mỗi ca mô tả hành vi ĐÚNG; chú thích ghi mã TRƯỚC bản vá ra gì. Đồng hồ ĐÓNG BĂNG (luật 19).
import { describe, it, expect } from "vitest";
import { quyetPhieuPos, type DauVaoQuyetPos } from "../phieu-pos-luat";
import { thongDiepPos } from "../thong-diep-pos";
import { mocCuaSoDen } from "./job";
import { heartbeatSchema, isoCoOffset } from "./schema";
import { thanhToanCuaHuyKhongDoc, type UngVienGoc } from "./goc-void";

function vao(o: Partial<DauVaoQuyetPos> & Pick<DauVaoQuyetPos, "kq">): DauVaoQuyetPos {
  return {
    hienTai: "CHO_QUET",
    tien: { loai: "KHONG_DOI_TIEN" },
    bt: null,
    coMaDuyNhat: false,
    btCuaPhieuKhac: false,
    code5: "K7M2N",
    taoLuc: new Date("2026-10-07T03:00:00Z"),
    soTienMay: null,
    gioQuet: null,
    ...o,
  };
}

// Mã TRƯỚC: không có cờ — provider trả NOT_FOUND / FAILED trần ⇒ "Chưa thấy giao dịch…" / "Giao dịch thất bại — cho
// quẹt lại." trong khi lần quẹt của sale nằm trong dòng agent BỊ TỪ CHỐI (khách đã bị trừ thẻ).
describe("[POS4-RVG-QD] quyetPhieuPos — NOT_FOUND + dongBiTuChoi ⇒ KHÔNG kết luận, câu cấm quẹt lại", () => {
  it("phiếu MỞ ⇒ GIỮ trạng thái, ghi câu MAY_KHONG_DOC_DUOC, không báo admin", () => {
    expect(quyetPhieuPos(vao({ kq: { kind: "NOT_FOUND", dongBiTuChoi: true, cheDoNguon: "AGENT" } }))).toEqual({
      status: "CHO_QUET",
      ghiKetQua: true,
      nhanBt: false,
      baoAdmin: null,
      ketLuan: { loai: "MAY_KHONG_DOC_DUOC", code5: "K7M2N" },
    });
    expect(quyetPhieuPos(vao({ hienTai: "THAT_BAI", kq: { kind: "NOT_FOUND", dongBiTuChoi: true } })).status).toBe("THAT_BAI");
  });
  it("phiếu ĐÓNG ⇒ không đè câu (ketLuan null)", () => {
    expect(quyetPhieuPos(vao({ hienTai: "DA_THU", kq: { kind: "NOT_FOUND", dongBiTuChoi: true } }))).toMatchObject({
      status: "DA_THU",
      ghiKetQua: false,
      ketLuan: null,
    });
  });
  it("job chưa xong THẮNG (DANG_DONG_BO) — dữ liệu chưa tươi là chuyện trước; đối chứng: không cờ ⇒ CHUA_THAY như cũ", () => {
    expect(quyetPhieuPos(vao({ kq: { kind: "NOT_FOUND", dongBoChuaXong: true, dongBiTuChoi: true } })).ketLuan).toEqual({
      loai: "DANG_DONG_BO",
      code5: "K7M2N",
    });
    expect(quyetPhieuPos(vao({ kq: { kind: "NOT_FOUND", cheDoNguon: "AGENT" } })).ketLuan).toMatchObject({ loai: "CHUA_THAY" });
  });
});

describe("[POS4-RVG-TD] thongDiepPos — câu NGUYÊN VĂN, cấm quẹt lại, không nói 'chưa thấy'", () => {
  it("MAY_KHONG_DOC_DUOC", () => {
    expect(thongDiepPos({ loai: "MAY_KHONG_DOC_DUOC", code5: "K7M2N" })).toEqual({
      cau:
        "Chưa xác nhận được giao dịch mang mã K7M2N: máy đồng bộ Techcombank có giao dịch thẻ trong khoảng giờ của phiếu " +
        "nhưng không đọc được dữ liệu — báo kế toán kiểm (Sức khoẻ POS Agent › Đối chiếu). " +
        "Biên lai máy đã báo THÀNH CÔNG thì ĐỪNG cho quẹt lại.",
      mucDo: "canh_bao",
    });
  });
});

// Mã TRƯỚC: `Date.parse` của V8 CUỘN ngày không có thật ("2026-02-30" ⇒ 02/03) và nhận "24:00" ⇒ `mocCuaSoDen` coi
// một mốc vô lý là "đọc được" (chú thích của chính hàm hứa: không đọc được ⇒ null ⇒ không DONE job nào), và
// `isoCoOffset` ("mốc có thật") nhận nó. GĐ3 V3 đã gặp đúng bẫy này (`laThoiDiemCoMui` so lại từng thành phần).
describe("[POS4-RVG-04] mốc giờ của agent: ngày / giờ KHÔNG có thật ⇒ không đọc được (không cuộn)", () => {
  it("mocCuaSoDen: 30/02, 31/04, 24:00 ⇒ null; mốc thật ⇒ mốc tuyệt đối +07:00 (đối chứng)", () => {
    expect(mocCuaSoDen("2026-02-30 10:00:00")).toBeNull();
    expect(mocCuaSoDen("2026-04-31 10:00:00")).toBeNull();
    expect(mocCuaSoDen("2026-10-07 24:00:00")).toBeNull();
    expect(mocCuaSoDen("2026-10-07 10:41:00")?.toISOString()).toBe("2026-10-07T03:41:00.000Z");
    expect(mocCuaSoDen("2026-02-28 23:59:59")?.toISOString()).toBe("2026-02-28T16:59:59.000Z");
  });
  it("isoCoOffset: 30/02, 24:00, offset +25:00 ⇒ từ chối; mốc thật (offset / Z) ⇒ nhận", () => {
    for (const s of ["2026-02-30T20:00:00+07:00", "2026-10-07T24:00:00+07:00", "2026-10-07T20:00:00+25:00"]) {
      expect(isoCoOffset.safeParse(s).success, s).toBe(false);
    }
    for (const s of ["2026-10-07T20:00:00+07:00", "2026-10-07T13:00:00Z", "2026-10-07T13:00:00.123Z"]) {
      expect(isoCoOffset.safeParse(s).success, s).toBe(true);
    }
    // Đi qua schema THẬT của heartbeat (route dùng nó).
    const hb = { extensionVersion: "0.1.0", sessionState: "READY", lastSyncedAt: null };
    expect(heartbeatSchema.safeParse({ ...hb, sessionExpiresAt: "2026-02-30T20:00:00+07:00" }).success).toBe(false);
    expect(heartbeatSchema.safeParse({ ...hb, sessionExpiresAt: "2026-10-08T08:15:00+07:00" }).success).toBe(true);
  });
});

// Ghép một dòng hủy/hoàn BỊ TỪ CHỐI với (các) dòng THANH TOÁN nó có thể hủy — phép ghép để BẢO VỆ (không tự ghi tiền /
// cảnh báo kế toán), nên RỘNG hơn `ganGocVoid` (vốn đòi ĐÚNG MỘT ứng viên để NỐI gốc): mọi ứng viên đều được bảo vệ.
describe("[POS4-RVG-05] thanhToanCuaHuyKhongDoc — ứng viên cùng RRN (+ quầy nếu biết), giờ ≤ giờ dòng hủy (nếu biết)", () => {
  const t = (s: string) => new Date(`2026-10-07T${s}+07:00`);
  const uv = (maGiaoDich: string, o: Partial<UngVienGoc> = {}): UngVienGoc => ({
    maGiaoDich,
    maGiaoDichThe: "628012345678",
    maQuay: "QTT45XWQT",
    thoiGian: t("10:31:35"),
    laThanhToan: true,
    ...o,
  });
  const huy = { maGiaoDichThe: "628012345678", maQuay: "qtt45xwqt ", thoiGian: t("10:33:00") };

  it("cùng RRN + quầy (so trim + IN HOA), giờ ≤ ⇒ ứng viên; HAI ứng viên ⇒ cả hai (không đòi duy nhất)", () => {
    expect(thanhToanCuaHuyKhongDoc({ huy, ungVien: [uv("P1")] })).toEqual(["P1"]);
    expect(thanhToanCuaHuyKhongDoc({ huy, ungVien: [uv("P1"), uv("P2", { thoiGian: t("10:32:00") })] }).sort()).toEqual(["P1", "P2"]);
  });
  it("khác RRN / khác quầy / thanh toán SAU dòng hủy / không phải thanh toán ⇒ không", () => {
    expect(thanhToanCuaHuyKhongDoc({ huy, ungVien: [uv("P1", { maGiaoDichThe: "628099999999" })] })).toEqual([]);
    expect(thanhToanCuaHuyKhongDoc({ huy, ungVien: [uv("P1", { maQuay: "QTTFBKATK" })] })).toEqual([]);
    expect(thanhToanCuaHuyKhongDoc({ huy, ungVien: [uv("P1", { thoiGian: t("10:34:00") })] })).toEqual([]);
    expect(thanhToanCuaHuyKhongDoc({ huy, ungVien: [uv("V0", { laThanhToan: false })] })).toEqual([]);
  });
  it("dòng hủy KHÔNG đọc được giờ ⇒ mọi giờ; KHÔNG có quầy ⇒ chỉ so RRN; KHÔNG có RRN ⇒ không ghép được", () => {
    expect(thanhToanCuaHuyKhongDoc({ huy: { ...huy, thoiGian: null }, ungVien: [uv("P1", { thoiGian: t("10:59:00") })] })).toEqual(["P1"]);
    expect(thanhToanCuaHuyKhongDoc({ huy: { ...huy, maQuay: null }, ungVien: [uv("P1", { maQuay: "QTTFBKATK" })] })).toEqual(["P1"]);
    expect(thanhToanCuaHuyKhongDoc({ huy: { ...huy, maGiaoDichThe: "  " }, ungVien: [uv("P1")] })).toEqual([]);
  });
});
