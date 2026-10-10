// [HN3-V1..V7] — `dungPhieuPosView` với yêu cầu "tôi nhập sai mã": câu sale THẤY phải theo sự thật của YÊU CẦU, không theo câu lưu.
// THUẦN. Hành vi đọc DB (select + sắp xếp) đo ở `tests/finance/pos-hai-nut-sai-ma.test.ts` ([HN3-DB-05/14/20]).
//
// Vì sao cần: phiếu sau khi gửi kế toán nằm ở CAN_XU_LY với `lastResultMessage` do lượt GỬI ghi; sau đó kế toán duyệt/bác/gắn tay,
// poller ghi đè câu lưu. Màn mà đọc câu lưu thì nói dối (luật 12) — nên view suy từ DÒNG YÊU CẦU.
// Đồng hồ ĐÓNG BĂNG (luật 19).
import { describe, expect, it } from "vitest";
import { dungPhieuPosView, type PhieuPosDeXem } from "./phieu-pos-luat";
import { CAU_CHO_KE_TOAN, CAU_DA_XU_LY_NGOAI, CAU_DANG_GHI, CAU_KET, DANG_GHI_KET_SAU_MS } from "./sai-ma";

const PHUT = 60_000;
const NOW = new Date("2026-10-09T05:00:00Z");
const TAO = new Date(NOW.getTime() - 50 * PHUT);

type Yc = PhieuPosDeXem["saiMaYeuCau"][number];
const CAU_LUU = "CÂU LƯU CŨ — không được hiện";

function raw(p: Partial<PhieuPosDeXem> = {}): PhieuPosDeXem {
  return {
    id: "i1",
    code5: "K7M2N",
    amount: 3_168_000,
    status: "CAN_XU_LY",
    createdAt: TAO,
    expiresAt: new Date(TAO.getTime() + 24 * 60 * PHUT),
    lastCheckAt: new Date(NOW.getTime() - 5 * PHUT),
    lastResultKind: "NOT_FOUND",
    lastResultMessage: CAU_LUU,
    paymentBillId: "b1",
    posTerminal: { id: "m1", maThietBi: "SP_A", maQuay: "QTT45XWQT", ten: null },
    bankTransaction: { status: "UNMATCHED", allocations: [] },
    paymentBill: { status: "OPEN", lines: [{ paymentRequestId: "pr1" }] },
    coGiaoDichChoTay: false,
    saiMaYeuCau: [],
    coDongTheChuaKetLuan: false, // Việc 4 (thêm khi ghép): cờ BẮT BUỘC của `PhieuPosDeXem`
    donDaCoVetBac: false,
    ...p,
  };
}
const yc = (p: Partial<Yc> = {}): Yc => ({
  trangThai: "CHO_DUYET",
  lyDoTuChoi: null,
  dangGhiLuc: null,
  btStatus: "UNMATCHED",
  btDaGoGan: false,
  ...p,
});
const PHIEU_MO = { billId: "b1", tongTien: 3_168_000, dong: [{ paymentRequestId: "pr1", ten: "Bé A", soTien: 3_168_000 }] };
const xem = (p: Partial<PhieuPosDeXem>) => dungPhieuPosView({ intent: raw(p), phieuMo: PHIEU_MO, now: NOW });

describe("[HN3-V1] phiếu CAN_XU_LY đang giữ giao dịch: câu theo HIỆU LỰC của yêu cầu, bỏ câu lưu", () => {
  it("CHỜ DUYỆT ⇒ 'Chờ kế toán xác nhận giao dịch nhập sai mã…' (cụm chủ dự án chốt) + choKeToan", () => {
    const v = xem({ saiMaYeuCau: [yc()] });
    expect(v.thongDiep).toBe(CAU_CHO_KE_TOAN);
    expect(v.thongDiep).toMatch(/^Chờ kế toán xác nhận giao dịch nhập sai mã/);
    expect(v.thongDiep).toMatch(/ĐỪNG cho khách quẹt lại/);
    expect(v.saiMa).toEqual({ trangThai: "CHO_DUYET", hieuLuc: "CHO_DUYET", lyDoTuChoi: null });
    expect(v.hienThi).toBe("CAN_XU_LY");
    expect(v.choKeToan, "giao dịch vẫn nằm hàng chờ tay").toBe(true);
  });

  it("ĐANG GHI (<2′) ⇒ câu đang ghi; KẸT (≥ 2′) ⇒ câu kẹt — mốc đóng băng, biên tại đúng 2′", () => {
    const moi = xem({ saiMaYeuCau: [yc({ trangThai: "DANG_GHI", dangGhiLuc: new Date(NOW.getTime() - (DANG_GHI_KET_SAU_MS - 1)) })] });
    expect(moi.saiMa?.hieuLuc).toBe("DANG_GHI");
    expect(moi.thongDiep).toBe(CAU_DANG_GHI);
    const ket = xem({ saiMaYeuCau: [yc({ trangThai: "DANG_GHI", dangGhiLuc: new Date(NOW.getTime() - DANG_GHI_KET_SAU_MS) })] });
    expect(ket.saiMa?.hieuLuc).toBe("KET");
    expect(ket.thongDiep).toBe(CAU_KET);
    // KẸT mà không có mốc ghi (dữ liệu thiếu) cũng coi là kẹt — không treo mãi ở 'đang ghi'.
    expect(xem({ saiMaYeuCau: [yc({ trangThai: "DANG_GHI", dangGhiLuc: null })] }).saiMa?.hieuLuc).toBe("KET");
  });

  it("KẾ TOÁN XỬ LÝ Ở NƠI KHÁC (giao dịch bị bỏ qua / gỡ gắn / gắn sang phiếu khác) ⇒ câu 'đã xử lý ở nơi khác'; phiếu KHÔNG còn nói 'chờ kế toán'", () => {
    for (const khac of [
      { btStatus: "IGNORED" as const, btDaGoGan: false },
      { btStatus: "UNMATCHED" as const, btDaGoGan: true },
    ]) {
      const v = xem({ saiMaYeuCau: [yc(khac)], bankTransaction: { status: khac.btStatus, allocations: [] } });
      expect(v.saiMa?.hieuLuc, JSON.stringify(khac)).toBe("DA_XU_LY_NGOAI");
      expect(v.thongDiep).toBe(CAU_DA_XU_LY_NGOAI);
      expect(v.thongDiep).not.toMatch(/Chờ kế toán xác nhận/);
    }
    // ĐỐI CHỨNG DƯƠNG: cùng cảnh nhưng giao dịch còn tự do ⇒ vẫn chờ duyệt.
    expect(xem({ saiMaYeuCau: [yc()] }).saiMa?.hieuLuc).toBe("CHO_DUYET");
  });

  it("giao dịch đã MATCHED vào đúng phiếu ⇒ view thành KE_TOAN_DA_GHI (câu của nó), KHÔNG bị câu sai mã đè", () => {
    const v = xem({
      saiMaYeuCau: [yc({ trangThai: "DA_GHI_NHAN", btStatus: "MATCHED" })],
      bankTransaction: { status: "MATCHED", allocations: [{ paymentRequestId: "pr1" }] },
    });
    expect(v.hienThi).toBe("KE_TOAN_DA_GHI");
    expect([CAU_CHO_KE_TOAN, CAU_DANG_GHI, CAU_KET, CAU_DA_XU_LY_NGOAI]).not.toContain(v.thongDiep);
    expect(v.saiMa?.hieuLuc).toBe("DA_GHI_NHAN");
  });
});

describe("[HN3-V2] ĐỐI CHỨNG: câu sai mã CHỈ đè khi phiếu đang ở CAN_XU_LY — không đè câu của trạng thái khác", () => {
  it("không có yêu cầu ⇒ `saiMa` null và câu lưu giữ nguyên", () => {
    const v = xem({ saiMaYeuCau: [] });
    expect(v.saiMa).toBeNull();
    expect(v.thongDiep).toBe(CAU_LUU);
  });

  it("phiếu CHO_QUET mà vẫn còn dòng yêu cầu (ví dụ TỪ CHỐI đã nhả phiếu) ⇒ câu lưu giữ nguyên, KHÔNG câu 'chờ kế toán'", () => {
    const v = xem({
      status: "CHO_QUET",
      saiMaYeuCau: [yc({ trangThai: "TU_CHOI", lyDoTuChoi: "Giao dịch của khách khác" })],
    });
    expect(v.thongDiep).toBe(CAU_LUU);
    expect(v.thongDiep).not.toBe(CAU_CHO_KE_TOAN);
    expect(v.saiMa).toEqual({ trangThai: "TU_CHOI", hieuLuc: "TU_CHOI", lyDoTuChoi: "Giao dịch của khách khác" });
    expect(v.hienThi).toBe("CHO_QUET");
  });

  it("trạng thái LECH_TIEN (kế toán xử lý lệch tiền) không bị câu sai mã đè dù có dòng yêu cầu cũ", () => {
    const v = xem({ status: "LECH_TIEN", saiMaYeuCau: [yc({ trangThai: "CHO_DUYET" })] });
    expect(v.thongDiep).toBe(CAU_LUU);
    expect(v.hienThi).toBe("LECH_TIEN");
  });
});

describe("[HN3-V3] chỉ dùng yêu cầu MỚI NHẤT (phần tử đầu) — cặp cũ bị bác không lấn át yêu cầu hiện hành", () => {
  it("[0] là hiện hành; các phần tử sau (cũ hơn) bị bỏ qua", () => {
    const v = xem({
      saiMaYeuCau: [yc({ trangThai: "CHO_DUYET" }), yc({ trangThai: "TU_CHOI", lyDoTuChoi: "lần trước" })],
    });
    expect(v.saiMa?.trangThai).toBe("CHO_DUYET");
    expect(v.thongDiep).toBe(CAU_CHO_KE_TOAN);
    expect(v.saiMa?.lyDoTuChoi).toBeNull();
  });
});

describe("[HN3-V4] trường mới của view BẮT BUỘC và đủ khoá", () => {
  it("`saiMa` luôn có mặt trong kết quả (null hoặc object) — không `undefined`", () => {
    expect("saiMa" in xem({})).toBe(true);
    expect(xem({}).saiMa).toBeNull();
  });
});
