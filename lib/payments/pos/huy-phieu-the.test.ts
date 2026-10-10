// lib/payments/pos/huy-phieu-the.test.ts — BẢNG TỔ HỢP của "Huỷ phiếu thẻ" (Việc 4 · 09/10/2026). THUẦN.
//
// Thiết kế: docs/pos-hai-nut-khai-may.md §6. `choPhepHuyPhieuThe` là phần DUY NHẤT máy chủ (S) và giao diện (U) dùng chung,
// nên bảng ở đây là hợp đồng của cả hai: máy chủ ném `lyDo — viecNenLam` đúng thứ màn in, và màn không vẽ nút mà máy
// chủ chắc chắn từ chối (luật 12).
//
// Năm nhóm ca:
//   · BẢNG theo từng ô (`[HN4-01..07]`) — mỗi ô một ca, kèm ĐỐI CHỨNG DƯƠNG (luật 11): ca "từ chối" nào cũng có ca
//     "cùng đầu vào, trừ đúng dấu hiệu đó, thì cho huỷ" — nếu không, một hàm luôn từ chối vẫn xanh.
//   · SAU TỪ CHỐI CỦA VIỆC 3 (`[HN4-04b]`, VIỆC 6 · a2 viết lại) — kế toán từ chối thì phiếu thẻ HUỶ ĐƯỢC theo cổng thường (đã bỏ cổng riêng
//     `SAI_MA_BI_TU_CHOI`) và nút KHÔNG được nhấp nháy: ngay sau từ chối câu lưu là `cauTuChoi(lyDo)` (câu CHỈ ĐỂ HIỆN NGAY), vài phút sau poller
//     ghi đè bằng "Chưa thấy…" — hai thời điểm PHẢI cho CÙNG một phán quyết. Cờ `cauLuuLaCauTuChoiSaiMa` (do `laCauLuuTuChoiSaiMa` tính từ yêu cầu
//     MỚI NHẤT) là nguồn DUY NHẤT nhận ra câu từ chối; hàm luật KHÔNG tự đọc câu để nhận ra nó (`[HN4-09]` có ô riêng).
//   · NỐI VỚI ĐƯỜNG THẬT (`[HN4-08]`) — "chưa thấy" trần và các NOT_FOUND "ĐỪNG quẹt lại" KHÔNG phân biệt được bằng
//     `lastResultKind` (đo: cả bốn cùng ghi NOT_FOUND, provider không đặt `reasonCode`); chỉ câu lưu mang sự khác biệt.
//     Cho hàm ăn đúng thứ `quyetPhieuPos` + `thongDiepPos` THẬT sinh ra (luật 9) — đổi câu ở một bên là đỏ ở đây.
//   · TỔ HỢP ĐẦY ĐỦ (`[HN4-09]`) — 7 trạng thái × 7 kết quả × 4 loại câu lưu × 7 cờ = 25.088 đầu vào (VIỆC 6: thêm loại câu "câu từ chối sai mã"),
//     so với MỘT bảng ưu tiên độc lập (oracle, trả cả MÃ từ chối). Hàm đổi hành vi ở BẤT KỲ ô nào là đỏ, kể cả ô không ai viết ca riêng.
//   · CÂU (`[HN4-10]`) — nguyên văn, đủ mã, đủ cặp, không tự mâu thuẫn với câu lưu.
import { describe, expect, it } from "vitest";
import type { PosCheckKind, PosIntentStatus } from "@prisma/client";
import { LY_DO_HUY_TOAN_PHAN } from "./phan-loai-pos";
import { quyetPhieuPos, TRANG_THAI_MO } from "./phieu-pos-luat";
import type { PosCheckResult } from "./provider/kieu";
import { cauTuChoi } from "./sai-ma";
import { dauCauChuaThay, thongDiepPos, thongDiepTrangThai } from "./thong-diep-pos";
import {
  choPhepHuyPhieuThe,
  laCauChuaThayTran,
  laCauLuuTuChoiSaiMa,
  type DauVaoChoPhepHuyPhieuThe,
  type KetQuaChoPhepHuyPhieuThe,
} from "./huy-phieu-the";
import {
  CAU_TU_CHOI_HUY_PHIEU_THE,
  ghepCauTuChoiHuy,
  MA_TU_CHOI_HUY_PHIEU_THE,
  type MaTuChoiHuyPhieuThe,
} from "./huy-phieu-the-cau";

const CODE = "WT9GX";
const TAO = new Date("2026-10-09T02:00:00.000Z");

/** Đầu vào mốc: phiếu thẻ vừa tạo, chưa kiểm lần nào ⇒ CHO HUỶ (xác nhận mạnh). Mọi ca đổi MỘT thứ so với mốc này. */
function v(p: Partial<DauVaoChoPhepHuyPhieuThe> = {}): DauVaoChoPhepHuyPhieuThe {
  return {
    status: "CHO_QUET",
    lastResultKind: null,
    lastResultMessage: null,
    code5: CODE,
    daNhanGiaoDich: false,
    coGiaoDichChoTay: false,
    coYeuCauSaiMaDangGiu: false,
    // VIỆC 6 · a2: thay cho `yeuCauSaiMaMoiNhatBiTuChoi` (cổng riêng "vì từng bị từ chối" đã BỎ) — câu lưu CHÍNH LÀ câu `tuChoiSaiMa` ghi sau từ chối.
    cauLuuLaCauTuChoiSaiMa: false,
    // VIỆC 4 (rà đối kháng): dòng thẻ mang mã nằm trong DB mà CHƯA thành giao dịch (treo / hoàn một phần) — xem dong-the-chua-ket-luan.ts.
    coDongTheChuaKetLuan: false,
    phieuGopConMo: true,
    daHetHan: false,
    ...p,
  };
}

const TU_CHOI = (ma: MaTuChoiHuyPhieuThe): KetQuaChoPhepHuyPhieuThe => ({
  huyDuoc: false,
  ma,
  ...CAU_TU_CHOI_HUY_PHIEU_THE[ma],
});
/** Mọi ca CHO huỷ đều đòi xác nhận mạnh (TỰ QUYẾT V4.3) — xem `[HN4-07]`. */
const CHO_HUY: KetQuaChoPhepHuyPhieuThe = { huyDuoc: true, canXacNhanManh: true };

// ─────────────────────────────────────────────────────────────────────────────
// Lấy "câu lưu" từ ĐƯỜNG THẬT: kết quả provider → `quyetPhieuPos` → `thongDiepPos` — đúng các dòng
// xu-ly-ket-qua.ts:271-279 dựng `lastResultKind` / `lastResultMessage` khi ghi.
// ─────────────────────────────────────────────────────────────────────────────
function luuSauLuotKiem(
  kq: PosCheckResult,
  hienTai: "CHO_QUET" | "THAT_BAI",
  tien: Parameters<typeof quyetPhieuPos>[0]["tien"] = { loai: "KHONG_DOI_TIEN" },
): { status: PosIntentStatus; lastResultKind: PosCheckKind | null; lastResultMessage: string | null } {
  const quyet = quyetPhieuPos({
    hienTai,
    kq,
    tien,
    bt: null,
    coMaDuyNhat: false,
    btCuaPhieuKhac: false,
    code5: CODE,
    taoLuc: TAO,
    soTienMay: null,
    gioQuet: null,
  });
  const td = quyet.ketLuan ? thongDiepPos(quyet.ketLuan) : null;
  const cau = td?.cau ?? thongDiepTrangThai(quyet.status).cau;
  const kind: PosCheckKind = quyet.ketLuan?.loai === "HUY_SAU_THU" ? "CANCELLED_AFTER_PAID" : kq.kind;
  return {
    status: quyet.status,
    lastResultKind: quyet.ghiKetQua ? kind : null,
    lastResultMessage: quyet.ghiKetQua ? cau : null,
  };
}

describe("[HN4-01] mốc: phiếu thẻ mở, chưa có dấu hiệu tiền nào ⇒ cho huỷ", () => {
  it("chưa kiểm lần nào ⇒ cho huỷ, CẦN xác nhận mạnh (khách có thể đã quẹt rồi mà chưa ai bấm Kiểm tra)", () => {
    expect(choPhepHuyPhieuThe(v())).toEqual(CHO_HUY);
  });
  it("THAT_BAI + FAILED ⇒ cho huỷ, VẪN xác nhận mạnh (TỰ QUYẾT V4.3: sau 'cho quẹt lại' một lần quẹt thành công có thể đang bay)", () => {
    expect(
      choPhepHuyPhieuThe(v({ status: "THAT_BAI", lastResultKind: "FAILED", lastResultMessage: "Giao dịch thất bại (mã THAT_BAI) — cho quẹt lại." })),
    ).toEqual(CHO_HUY);
  });
});

describe("[HN4-02] trạng thái ĐÃ ĐÓNG ⇒ không huỷ (mỗi trạng thái một mã)", () => {
  const BANG: [PosIntentStatus, MaTuChoiHuyPhieuThe][] = [
    ["DA_THU", "DA_THU"],
    ["LECH_TIEN", "LECH_TIEN"],
    ["CAN_XU_LY", "CAN_XU_LY"],
    ["HUY", "DA_HUY"],
    ["HET_HAN", "DA_HET_HAN"],
  ];
  it.each(BANG)("status %s ⇒ từ chối %s", (status, ma) => {
    expect(choPhepHuyPhieuThe(v({ status }))).toEqual(TU_CHOI(ma));
  });
  it("đóng thắng mọi thứ khác: DA_THU kèm tất cả cờ vẫn ra DA_THU (không bị mã khác che)", () => {
    expect(
      choPhepHuyPhieuThe(
        v({
          status: "DA_THU",
          daNhanGiaoDich: true,
          coGiaoDichChoTay: true,
          coYeuCauSaiMaDangGiu: true,
          cauLuuLaCauTuChoiSaiMa: true,
          coDongTheChuaKetLuan: true,
          lastResultKind: "PAID",
          phieuGopConMo: false,
          daHetHan: true,
        }),
      ),
    ).toEqual(TU_CHOI("DA_THU"));
  });
  it("đối chứng dương: hai trạng thái MỞ cùng đầu vào mốc thì cho huỷ", () => {
    for (const status of TRANG_THAI_MO) expect(choPhepHuyPhieuThe(v({ status })).huyDuoc, status).toBe(true);
  });
});

describe("[HN4-03] kết quả lượt kiểm gần nhất × phiếu MỞ", () => {
  const CHUA_THAY_TRAN = luuSauLuotKiem({ kind: "NOT_FOUND", duLieuCapNhatLuc: "2026-10-09T08:50:00+07:00", gdMoiNhatLuc: "2026-10-09T08:40:00+07:00" }, "CHO_QUET");

  it("điều kiện tiên quyết của bảng: 'chưa thấy' trần ĐÚNG là NOT_FOUND và giữ phiếu MỞ", () => {
    expect(CHUA_THAY_TRAN.status).toBe("CHO_QUET");
    expect(CHUA_THAY_TRAN.lastResultKind).toBe("NOT_FOUND");
  });

  it.each(["CHO_QUET", "THAT_BAI"] as const)("[%s] NOT_FOUND 'chưa thấy' trần ⇒ cho huỷ, xác nhận MẠNH", (status) => {
    expect(
      choPhepHuyPhieuThe(v({ status, lastResultKind: "NOT_FOUND", lastResultMessage: CHUA_THAY_TRAN.lastResultMessage })),
    ).toEqual(CHO_HUY);
  });
  it.each(["CHO_QUET", "THAT_BAI"] as const)("[%s] FAILED ⇒ cho huỷ, xác nhận MẠNH", (status) => {
    expect(choPhepHuyPhieuThe(v({ status, lastResultKind: "FAILED", lastResultMessage: "bất kỳ" }))).toEqual(CHO_HUY);
  });
  it("PAID / PAID_AMOUNT_MISMATCH: phiếu CHO_QUET ⇒ KET_QUA_PAID_CHUA_GHI (pha tiền ném); phiếu THAT_BAI ⇒ KET_QUA_PAID_SAU_THAT_BAI (hai nguồn không phân biệt được bằng cột)", () => {
    for (const kind of ["PAID", "PAID_AMOUNT_MISMATCH"] as const) {
      expect(choPhepHuyPhieuThe(v({ status: "CHO_QUET", lastResultKind: kind, lastResultMessage: "bất kỳ" })), `CHO_QUET ${kind}`).toEqual(
        TU_CHOI("KET_QUA_PAID_CHUA_GHI"),
      );
      expect(choPhepHuyPhieuThe(v({ status: "THAT_BAI", lastResultKind: kind, lastResultMessage: "bất kỳ" })), `THAT_BAI ${kind}`).toEqual(
        TU_CHOI("KET_QUA_PAID_SAU_THAT_BAI"),
      );
    }
  });
  it.each([
    ["CANCELLED_AFTER_PAID", "HUY_SAU_THU"],
    ["PROVIDER_ERROR", "LOI_KET_NOI"],
  ] as const)("[CHO_QUET · THAT_BAI] %s ⇒ từ chối %s", (kind, ma) => {
    expect(choPhepHuyPhieuThe(v({ lastResultKind: kind, lastResultMessage: "bất kỳ" }))).toEqual(TU_CHOI(ma));
    expect(choPhepHuyPhieuThe(v({ status: "THAT_BAI", lastResultKind: kind, lastResultMessage: "bất kỳ" })), "THAT_BAI").toEqual(TU_CHOI(ma));
  });
  it("NOT_FOUND mà KHÔNG phải 'chưa thấy' trần ⇒ CHUA_NGA_NGU (câu lưu trống · lạ · của mã khác)", () => {
    const cauCuaMaKhac = thongDiepPos({
      loai: "CHUA_THAY",
      code5: "ZZZZZ",
      duLieuLuc: null,
      gdMoiNhatLuc: null,
      taoLuc: TAO,
      baoAdminTuLuc: TAO,
    }).cau;
    for (const lastResultMessage of [null, "", "Chờ khách quẹt thẻ — quẹt xong bấm Kiểm tra thanh toán.", cauCuaMaKhac]) {
      expect(choPhepHuyPhieuThe(v({ lastResultKind: "NOT_FOUND", lastResultMessage })), String(lastResultMessage)).toEqual(
        TU_CHOI("CHUA_NGA_NGU"),
      );
    }
  });
  it("kind LẠ (một giá trị mới thêm vào enum mà không ai nhớ vào bảng này) ⇒ từ chối LOI_KET_NOI — fail-closed, không fail-open", () => {
    for (const status of TRANG_THAI_MO) {
      expect(choPhepHuyPhieuThe(v({ status, lastResultKind: "KIND_MOI_CHUA_BIET" as unknown as PosCheckKind })), status).toEqual(
        TU_CHOI("LOI_KET_NOI"),
      );
    }
  });
});

describe("[HN4-04] dấu hiệu TIỀN ĐANG BAY ⇒ không huỷ, kể cả khi kết quả gần nhất trông vô hại", () => {
  const VO_HAI = { status: "THAT_BAI", lastResultKind: "FAILED", lastResultMessage: "Giao dịch thất bại — cho quẹt lại." } as const;
  const BANG: [string, Partial<DauVaoChoPhepHuyPhieuThe>, Partial<DauVaoChoPhepHuyPhieuThe>, MaTuChoiHuyPhieuThe][] = [
    ["daNhanGiaoDich", { daNhanGiaoDich: true }, { daNhanGiaoDich: false }, "DA_NHAN_GIAO_DICH"],
    ["coGiaoDichChoTay", { coGiaoDichChoTay: true }, { coGiaoDichChoTay: false }, "CO_GIAO_DICH_CHO_TAY"],
    ["coYeuCauSaiMaDangGiu", { coYeuCauSaiMaDangGiu: true }, { coYeuCauSaiMaDangGiu: false }, "CO_YEU_CAU_SAI_MA"],
    // VIỆC 6 · a2: hàng `yeuCauSaiMaMoiNhatBiTuChoi → SAI_MA_BI_TU_CHOI` ĐÃ GỠ (kế toán từ chối không còn là dấu hiệu tiền đang bay riêng — xem `[HN4-04b]`).
    ["coDongTheChuaKetLuan", { coDongTheChuaKetLuan: true }, { coDongTheChuaKetLuan: false }, "DONG_THE_CHUA_NGA_NGU"],
  ];
  it.each(BANG)("%s = true ⇒ từ chối", (_ten, bat, _tat, ma) => {
    expect(choPhepHuyPhieuThe(v({ ...VO_HAI, ...bat })), "trên THAT_BAI+FAILED").toEqual(TU_CHOI(ma));
    expect(choPhepHuyPhieuThe(v({ ...bat })), "trên mốc").toEqual(TU_CHOI(ma));
  });
  it.each(BANG)("đối chứng dương: %s = false thì cùng đầu vào CHO huỷ", (_ten, _bat, tat) => {
    expect(choPhepHuyPhieuThe(v({ ...VO_HAI, ...tat })).huyDuoc).toBe(true);
    expect(choPhepHuyPhieuThe(v({ ...tat })).huyDuoc).toBe(true);
  });
});

describe("[HN4-04b] SAU TỪ CHỐI của Việc 3 (VIỆC 6 · a2 viết lại): huỷ ĐƯỢC theo cổng thường, và nút không nhấp nháy khi sự thật không đổi", () => {
  // Việc 3 (`sai-ma-ghi.ts`, từ chối): phiếu về CHO_QUET, `bankTransactionId = NULL`, `lastResultKind` vẫn NOT_FOUND,
  // `lastResultMessage = cauTuChoi(lyDo)` — câu CHỈ ĐỂ HIỆN NGAY. Vài phút sau poller / nút Kiểm tra ghi đè nó bằng "Chưa
  // thấy giao dịch…" (V70 của Việc 3).
  // VIỆC 6 (chủ dự án chốt 10/10/2026): sau từ chối sale HUỶ ĐƯỢC phiếu thẻ — cổng riêng `SAI_MA_BI_TU_CHOI` (V4.2) đã BỎ; thứ chặn "bác X → huỷ → mở phiếu mới → gửi lại X"
  // nay là bộ nhớ khoá theo ĐƠN (Việc 5). Nhưng chỉ bỏ cờ thì NÚT NHẤP NHÁY: ngay sau từ chối câu lưu là `cauTuChoi(lyDo)` — không phải "Chưa thấy" trần —
  // nên ③ sẽ nói `CHUA_NGA_NGU` (sai nghĩa: chẳng có giao dịch nào "đang xử lý"), rồi vài phút sau poller ghi "Chưa thấy" trần và nút TỰ HIỆN mà không dữ kiện nào đổi (luật 12).
  // Nên ③ phải nhận ra câu từ chối — bằng MỘT cờ do `laCauLuuTuChoiSaiMa` tính từ yêu cầu MỚI NHẤT (so ĐÚNG CHUỖI `cauTuChoi(lyDoTuChoi)`), KHÔNG bằng cách đọc tiền tố câu.
  // Câu từ chối dùng CHÍNH hàm của Việc 3 (luật 9: cho cổng ăn bằng thứ đường thật sinh ra) — đổi chữ ở Việc 3 không làm ca này nói về một câu không còn tồn tại.
  const LY_DO = "Giao dịch của khách khác";
  const CAU_TU_CHOI_CUA_VIEC_3 = cauTuChoi(LY_DO);
  const CHUA_THAY_TRAN = luuSauLuotKiem({ kind: "NOT_FOUND" }, "CHO_QUET").lastResultMessage;
  const CAU_TREO = thongDiepPos({ loai: "DANG_CHO_NGAN_HANG", code5: CODE, maTrangThai: "DANG_XU_LY" }).cau;

  it("ngay sau từ chối (câu lưu = câu từ chối, cờ BẬT) ⇒ CHO HUỶ, xác nhận mạnh — KHÔNG phải CHUA_NGA_NGU", () => {
    expect(choPhepHuyPhieuThe(v({ lastResultKind: "NOT_FOUND", lastResultMessage: CAU_TU_CHOI_CUA_VIEC_3, cauLuuLaCauTuChoiSaiMa: true }))).toEqual(CHO_HUY);
  });
  it("vài phút sau (poller đã ghi đè câu thành 'Chưa thấy…' trần, cờ TẮT) ⇒ VẪN cho huỷ — CÙNG phán quyết, không nhấp nháy", () => {
    expect(CHUA_THAY_TRAN).not.toBeNull();
    const ngay = choPhepHuyPhieuThe(v({ lastResultKind: "NOT_FOUND", lastResultMessage: CAU_TU_CHOI_CUA_VIEC_3, cauLuuLaCauTuChoiSaiMa: true }));
    const sau = choPhepHuyPhieuThe(v({ lastResultKind: "NOT_FOUND", lastResultMessage: CHUA_THAY_TRAN, cauLuuLaCauTuChoiSaiMa: false }));
    expect(sau).toEqual(CHO_HUY);
    expect(sau, "hai thời điểm cùng một phán quyết").toEqual(ngay);
  });
  it("ĐỐI CHỨNG ÂM: cùng câu từ chối mà cờ TẮT (không có yêu cầu bị từ chối đứng sau nó) ⇒ CHUA_NGA_NGU — hàm thuần KHÔNG tự đọc câu để nhận ra", () => {
    expect(choPhepHuyPhieuThe(v({ lastResultKind: "NOT_FOUND", lastResultMessage: CAU_TU_CHOI_CUA_VIEC_3, cauLuuLaCauTuChoiSaiMa: false }))).toEqual(TU_CHOI("CHUA_NGA_NGU"));
  });
  it("lượt kiểm SAU từ chối ghi câu 'ĐỪNG quẹt lại' (dòng treo) ⇒ cờ TẮT ⇒ CHUA_NGA_NGU, dù yêu cầu mới nhất từng bị từ chối — thông tin mới hơn thắng, không fail-open", () => {
    expect(choPhepHuyPhieuThe(v({ lastResultKind: "NOT_FOUND", lastResultMessage: CAU_TREO, cauLuuLaCauTuChoiSaiMa: false }))).toEqual(TU_CHOI("CHUA_NGA_NGU"));
  });
  it("cờ chỉ có nghĩa ở NOT_FOUND: kết quả khác (PAID · CANCELLED_AFTER_PAID · PROVIDER_ERROR) + cờ BẬT ⇒ vẫn từ chối đúng mã của chúng", () => {
    const BANG: [PosCheckKind, MaTuChoiHuyPhieuThe][] = [
      ["PAID", "KET_QUA_PAID_CHUA_GHI"],
      ["PAID_AMOUNT_MISMATCH", "KET_QUA_PAID_CHUA_GHI"],
      ["CANCELLED_AFTER_PAID", "HUY_SAU_THU"],
      ["PROVIDER_ERROR", "LOI_KET_NOI"],
    ];
    for (const [kind, ma] of BANG) {
      expect(choPhepHuyPhieuThe(v({ lastResultKind: kind, lastResultMessage: CAU_TU_CHOI_CUA_VIEC_3, cauLuuLaCauTuChoiSaiMa: true })), kind).toEqual(TU_CHOI(ma));
    }
  });
  it("cờ KHÔNG mở khoá cổng nào khác: sau từ chối mà còn giao dịch chờ tay · dòng chưa ngã ngũ · yêu cầu SỐNG · đã nhận giao dịch · phiếu gộp đóng · quá hạn ⇒ vẫn từ chối đúng mã", () => {
    const sauTuChoi = { lastResultKind: "NOT_FOUND", lastResultMessage: CAU_TU_CHOI_CUA_VIEC_3, cauLuuLaCauTuChoiSaiMa: true } as const;
    const BANG: [Partial<DauVaoChoPhepHuyPhieuThe>, MaTuChoiHuyPhieuThe][] = [
      [{ daNhanGiaoDich: true }, "DA_NHAN_GIAO_DICH"],
      [{ coGiaoDichChoTay: true }, "CO_GIAO_DICH_CHO_TAY"],
      [{ coYeuCauSaiMaDangGiu: true }, "CO_YEU_CAU_SAI_MA"],
      [{ coDongTheChuaKetLuan: true }, "DONG_THE_CHUA_NGA_NGU"],
      [{ phieuGopConMo: false }, "PHIEU_GOP_DA_DONG"],
      [{ daHetHan: true }, "QUA_HAN_CHO_DONG"],
    ];
    for (const [them, ma] of BANG) expect(choPhepHuyPhieuThe(v({ ...sauTuChoi, ...them })), ma).toEqual(TU_CHOI(ma));
    expect(choPhepHuyPhieuThe(v({ ...sauTuChoi })).huyDuoc, "đối chứng dương: không cờ nào khác ⇒ huỷ được").toBe(true);
  });
  it("`SAI_MA_BI_TU_CHOI` không còn tồn tại: không trong bảng mã, không trong bảng câu (mã chết là mời người sau gắn lại cổng cũ)", () => {
    expect([...MA_TU_CHOI_HUY_PHIEU_THE] as string[]).not.toContain("SAI_MA_BI_TU_CHOI");
    expect(Object.keys(CAU_TU_CHOI_HUY_PHIEU_THE)).not.toContain("SAI_MA_BI_TU_CHOI");
  });
});

describe("[HN6-A2-H] `laCauLuuTuChoiSaiMa` — MỘT hàm nhận ra câu lưu sau từ chối (view và máy chủ cùng gọi nó)", () => {
  const LY_DO = "Giao dịch của khách khác";
  const CAU = cauTuChoi(LY_DO);
  const TU_CHOI_MOI_NHAT = { trangThai: "TU_CHOI", lyDoTuChoi: LY_DO } as const;

  it("[HN6-A2-H1] câu lưu ĐÚNG CHUỖI `cauTuChoi(lyDo)` của yêu cầu MỚI NHẤT đã bị từ chối ⇒ true", () => {
    expect(laCauLuuTuChoiSaiMa({ lastResultMessage: CAU, yeuCauMoiNhat: TU_CHOI_MOI_NHAT })).toBe(true);
  });
  it("[HN6-A2-H2] lý do trống (dữ liệu cũ, `lyDoTuChoi = null`) vẫn nhận ra: hai phía cùng gọi `cauTuChoi(null)`", () => {
    expect(laCauLuuTuChoiSaiMa({ lastResultMessage: cauTuChoi(null), yeuCauMoiNhat: { trangThai: "TU_CHOI", lyDoTuChoi: null } })).toBe(true);
  });
  it("[HN6-A2-H3] ĐỐI CHỨNG ÂM từng vế — mỗi vế thiếu là false", () => {
    // (a) lượt kiểm sau đã ghi đè câu lưu
    expect(laCauLuuTuChoiSaiMa({ lastResultMessage: "Chưa thấy giao dịch mang mã WT9GX.", yeuCauMoiNhat: TU_CHOI_MOI_NHAT }), "câu lưu đã bị ghi đè").toBe(false);
    expect(laCauLuuTuChoiSaiMa({ lastResultMessage: null, yeuCauMoiNhat: TU_CHOI_MOI_NHAT }), "chưa có câu lưu").toBe(false);
    // (b) không có yêu cầu bị từ chối đứng sau câu
    expect(laCauLuuTuChoiSaiMa({ lastResultMessage: CAU, yeuCauMoiNhat: null }), "không có yêu cầu nào").toBe(false);
    for (const trangThai of ["CHO_DUYET", "DANG_GHI", "DA_GHI_NHAN"] as const) {
      expect(laCauLuuTuChoiSaiMa({ lastResultMessage: CAU, yeuCauMoiNhat: { trangThai, lyDoTuChoi: LY_DO } }), `yêu cầu mới nhất ${trangThai}`).toBe(false);
    }
    // (c) câu của một lần từ chối KHÁC (lý do khác) — chỉ yêu cầu MỚI NHẤT được tính
    expect(laCauLuuTuChoiSaiMa({ lastResultMessage: cauTuChoi("Lý do của lần từ chối cũ"), yeuCauMoiNhat: TU_CHOI_MOI_NHAT }), "câu của lý do khác").toBe(false);
  });
  it("[HN6-A2-H4] so ĐÚNG CHUỖI, không so tiền tố: thêm / bớt một ký tự là false (không fail-open khi ai đó nối thêm chữ vào câu)", () => {
    expect(laCauLuuTuChoiSaiMa({ lastResultMessage: `${CAU} `, yeuCauMoiNhat: TU_CHOI_MOI_NHAT })).toBe(false);
    expect(laCauLuuTuChoiSaiMa({ lastResultMessage: CAU.slice(0, -1), yeuCauMoiNhat: TU_CHOI_MOI_NHAT })).toBe(false);
    expect(laCauLuuTuChoiSaiMa({ lastResultMessage: CAU.slice(0, 40), yeuCauMoiNhat: TU_CHOI_MOI_NHAT })).toBe(false);
  });
});

describe("[HN4-05] phiếu không còn gì để huỷ (cấu trúc): mã đã đóng · quá hạn", () => {
  it("phiếu gộp không còn mở ⇒ PHIEU_GOP_DA_DONG; đối chứng dương: còn mở thì cho huỷ", () => {
    expect(choPhepHuyPhieuThe(v({ phieuGopConMo: false }))).toEqual(TU_CHOI("PHIEU_GOP_DA_DONG"));
    expect(choPhepHuyPhieuThe(v({ phieuGopConMo: true })).huyDuoc).toBe(true);
  });
  it("quá hạn (status còn mở nhưng `expiresAt ≤ now`) ⇒ QUA_HAN_CHO_DONG; đối chứng dương: còn hạn thì cho huỷ", () => {
    expect(choPhepHuyPhieuThe(v({ daHetHan: true }))).toEqual(TU_CHOI("QUA_HAN_CHO_DONG"));
    expect(choPhepHuyPhieuThe(v({ daHetHan: false })).huyDuoc).toBe(true);
  });
  it("cấu trúc KHÔNG che rủi ro tiền: quá hạn mà lượt gần nhất lỗi kết nối ⇒ vẫn nói LOI_KET_NOI", () => {
    expect(choPhepHuyPhieuThe(v({ daHetHan: true, lastResultKind: "PROVIDER_ERROR" }))).toEqual(TU_CHOI("LOI_KET_NOI"));
    expect(choPhepHuyPhieuThe(v({ phieuGopConMo: false, lastResultKind: "PAID" }))).toEqual(TU_CHOI("KET_QUA_PAID_CHUA_GHI"));
  });
  it("tiền ĐÃ vào mã (nhập file/agent rót đúng số ⇒ phiếu gộp PAID) mà phiếu thẻ chưa kịp cập nhật ⇒ PHIEU_GOP_DA_DONG, câu dặn bấm Kiểm tra", () => {
    // `thuTheoPhieuGopTrongKhoa` đặt phiếu gộp PAID TRONG CÙNG transaction đã khoá đơn (`phieu-gop.ts:1051-1057`), không
    // đụng phiếu thẻ — nên cổng "phiếu gộp còn mở" đọc dưới khoá đơn là tấm chắn duy nhất cho ca "tiền đã vào, chưa ai Kiểm tra".
    const r = choPhepHuyPhieuThe(v({ phieuGopConMo: false, lastResultKind: "NOT_FOUND", lastResultMessage: luuSauLuotKiem({ kind: "NOT_FOUND" }, "CHO_QUET").lastResultMessage }));
    expect(r).toEqual(TU_CHOI("PHIEU_GOP_DA_DONG"));
    if (!r.huyDuoc) expect(r.viecNenLam).toContain("Kiểm tra thanh toán");
  });
});

describe("[HN4-06] thứ tự ưu tiên của lý do (rủi ro tiền nói trước)", () => {
  it("đã nhận giao dịch > giao dịch chờ tay > yêu cầu sai mã đang giữ > dòng thẻ chưa ngã ngũ > kết quả máy > cấu trúc (VIỆC 6: không còn nấc 'sai mã bị từ chối')", () => {
    const tatCa = v({
      daNhanGiaoDich: true,
      coGiaoDichChoTay: true,
      coYeuCauSaiMaDangGiu: true,
      cauLuuLaCauTuChoiSaiMa: true,
      coDongTheChuaKetLuan: true,
      lastResultKind: "PAID",
      phieuGopConMo: false,
      daHetHan: true,
    });
    const bo = (...khoa: (keyof DauVaoChoPhepHuyPhieuThe)[]): DauVaoChoPhepHuyPhieuThe => {
      const x = { ...tatCa } as Record<string, unknown>;
      for (const k of khoa) x[k] = k === "lastResultKind" ? null : k === "phieuGopConMo" ? true : false;
      return x as DauVaoChoPhepHuyPhieuThe;
    };
    expect(choPhepHuyPhieuThe(tatCa)).toEqual(TU_CHOI("DA_NHAN_GIAO_DICH"));
    expect(choPhepHuyPhieuThe(bo("daNhanGiaoDich"))).toEqual(TU_CHOI("CO_GIAO_DICH_CHO_TAY"));
    expect(choPhepHuyPhieuThe(bo("daNhanGiaoDich", "coGiaoDichChoTay"))).toEqual(TU_CHOI("CO_YEU_CAU_SAI_MA"));
    expect(choPhepHuyPhieuThe(bo("daNhanGiaoDich", "coGiaoDichChoTay", "coYeuCauSaiMaDangGiu"))).toEqual(TU_CHOI("DONG_THE_CHUA_NGA_NGU"));
    expect(choPhepHuyPhieuThe(bo("daNhanGiaoDich", "coGiaoDichChoTay", "coYeuCauSaiMaDangGiu", "coDongTheChuaKetLuan"))).toEqual(
      TU_CHOI("KET_QUA_PAID_CHUA_GHI"),
    );
    expect(
      choPhepHuyPhieuThe(bo("daNhanGiaoDich", "coGiaoDichChoTay", "coYeuCauSaiMaDangGiu", "coDongTheChuaKetLuan", "lastResultKind")),
    ).toEqual(TU_CHOI("PHIEU_GOP_DA_DONG"));
    expect(
      choPhepHuyPhieuThe(
        bo("daNhanGiaoDich", "coGiaoDichChoTay", "coYeuCauSaiMaDangGiu", "coDongTheChuaKetLuan", "lastResultKind", "phieuGopConMo"),
      ),
    ).toEqual(TU_CHOI("QUA_HAN_CHO_DONG"));
  });
});

describe("[HN4-07] xác nhận MẠNH cho MỌI ca cho huỷ (TỰ QUYẾT V4.3)", () => {
  // Không có ca nào CHỨNG MINH được "khách chưa quẹt thành công": lần quẹt gần nhất thất bại không loại trừ một lần quẹt
  // thứ hai đang bay (đúng thứ màn đang mời: "cho quẹt lại"); "chưa thấy" và "chưa kiểm" thì càng không. Nên mọi ca cho huỷ
  // đòi tick. Trường `canXacNhanManh` giữ trong hợp đồng — hôm nay luôn true; một ca chứng minh được (nếu sau này có) là
  // một dòng đổi ở hàm + một dòng ở bảng này, không đổi hình dạng kết quả.
  it("mọi đầu vào cho huỷ đều mang canXacNhanManh = true", () => {
    const chuaThay = luuSauLuotKiem({ kind: "NOT_FOUND" }, "CHO_QUET");
    const CA: Partial<DauVaoChoPhepHuyPhieuThe>[] = [
      { lastResultKind: null },
      { lastResultKind: "FAILED", status: "THAT_BAI" },
      { lastResultKind: "FAILED", status: "CHO_QUET" },
      { lastResultKind: "NOT_FOUND", lastResultMessage: chuaThay.lastResultMessage },
      { lastResultKind: "NOT_FOUND", lastResultMessage: chuaThay.lastResultMessage, status: "THAT_BAI" },
    ];
    for (const ca of CA) expect(choPhepHuyPhieuThe(v(ca)), JSON.stringify(ca)).toEqual(CHO_HUY);
  });
  it("hàm KHÔNG bao giờ trả `canXacNhanManh` kèm một từ chối", () => {
    const r = choPhepHuyPhieuThe(v({ status: "DA_THU" }));
    expect(r.huyDuoc).toBe(false);
    expect("canXacNhanManh" in r).toBe(false);
  });
});

describe("[HN4-08] NỐI VỚI ĐƯỜNG THẬT: câu lưu do `quyetPhieuPos` + `thongDiepPos` sinh ra", () => {
  const MOC = { duLieuCapNhatLuc: "2026-10-09T08:50:00+07:00", gdMoiNhatLuc: "2026-10-09T08:40:00+07:00" } as const;
  const dau = (x: ReturnType<typeof luuSauLuotKiem>, status: "CHO_QUET" | "THAT_BAI" = "CHO_QUET") =>
    v({ status, lastResultKind: x.lastResultKind, lastResultMessage: x.lastResultMessage });

  it("'chưa thấy' trần — mọi biến thể câu (chế độ FILE/AGENT, có/không mốc dữ liệu, cảnh báo dữ liệu cũ) ⇒ cho huỷ", () => {
    const BIEN_THE: PosCheckResult[] = [
      { kind: "NOT_FOUND" },
      { kind: "NOT_FOUND", ...MOC },
      { kind: "NOT_FOUND", ...MOC, cheDoNguon: "AGENT" },
      { kind: "NOT_FOUND", cheDoNguon: "AGENT" },
      { kind: "NOT_FOUND", duLieuCapNhatLuc: "2026-10-09T08:50:00+07:00", gdMoiNhatLuc: "2026-10-09T10:50:00+07:00" },
    ];
    for (const kq of BIEN_THE) {
      const luu = luuSauLuotKiem(kq, "CHO_QUET");
      expect(luu.lastResultKind).toBe("NOT_FOUND");
      expect(choPhepHuyPhieuThe(dau(luu)), JSON.stringify(kq)).toEqual(CHO_HUY);
    }
  });

  it("NOT_FOUND 'ĐỪNG quẹt lại' — dòng treo · máy không đọc được · đồng bộ chưa xong ⇒ CHUA_NGA_NGU (cùng kind NOT_FOUND!)", () => {
    const BIEN_THE: [string, PosCheckResult][] = [
      ["dòng mang mã chưa ngã ngũ (FILE)", { kind: "NOT_FOUND", trangThaiTreo: "DANG_XU_LY", ...MOC }],
      ["dòng mang mã chưa ngã ngũ (AGENT)", { kind: "NOT_FOUND", trangThaiTreo: "DANG_XU_LY", cheDoNguon: "AGENT", ...MOC }],
      ["máy đồng bộ có dòng bị từ chối", { kind: "NOT_FOUND", dongBiTuChoi: true, cheDoNguon: "AGENT", ...MOC }],
      ["máy đồng bộ chưa trả lời kịp", { kind: "NOT_FOUND", dongBoChuaXong: true, cheDoNguon: "AGENT", ...MOC }],
    ];
    for (const [ten, kq] of BIEN_THE) {
      const luu = luuSauLuotKiem(kq, "CHO_QUET");
      // Bằng chứng của quyết định TỰ QUYẾT V4.2: kind lưu KHÔNG đủ để phân biệt với 'chưa thấy' trần.
      expect(luu.lastResultKind, ten).toBe("NOT_FOUND");
      expect(luu.status, ten).toBe("CHO_QUET");
      expect(choPhepHuyPhieuThe(dau(luu)), ten).toEqual(TU_CHOI("CHUA_NGA_NGU"));
    }
  });

  it("pha tiền NÉM (PAID mà chưa ghi được) giữ phiếu MỞ và lưu kind PAID ⇒ KET_QUA_PAID_CHUA_GHI (CHO_QUET) / KET_QUA_PAID_SAU_THAT_BAI (THAT_BAI)", () => {
    const luu = luuSauLuotKiem({ kind: "PAID", providerTxnId: "TXN12345678", amount: 500_000 }, "CHO_QUET", { loai: "CHUA_XAC_DINH" });
    expect(luu.status).toBe("CHO_QUET");
    expect(luu.lastResultKind).toBe("PAID");
    expect(choPhepHuyPhieuThe(dau(luu))).toEqual(TU_CHOI("KET_QUA_PAID_CHUA_GHI"));
    const luu2 = luuSauLuotKiem({ kind: "PAID_AMOUNT_MISMATCH", providerTxnId: "TXN12345678", amount: 400_000 }, "THAT_BAI", { loai: "CHUA_XAC_DINH" });
    expect(luu2.status).toBe("THAT_BAI");
    expect(luu2.lastResultKind).toBe("PAID_AMOUNT_MISMATCH");
    expect(choPhepHuyPhieuThe(dau(luu2, "THAT_BAI"))).toEqual(TU_CHOI("KET_QUA_PAID_SAU_THAT_BAI"));
  });

  it("'đã huỷ toàn bộ trên máy' (BO_QUA) lưu THAT_BAI + kind PAID ⇒ vẫn từ chối (fail-closed) và câu từ chối KHÔNG cãi câu lưu 'có thể cho quẹt lại'", () => {
    // Đường thật: provider báo PAID, file nói giao dịch đã huỷ/hoàn toàn phần ⇒ `BO_QUA` ⇒ THAT_BAI, kind PAID giữ nguyên.
    // Cùng cặp (THAT_BAI, PAID) với "pha tiền ném sau một lần thất bại" — chỉ câu lưu khác nhau. Không phân tích câu (mong
    // manh): từ chối, nhưng bằng câu TRUNG TÍNH — không nói "ĐỪNG quẹt lại" (cãi màn) cũng không nói "cho quẹt lại".
    const luu = luuSauLuotKiem({ kind: "PAID", providerTxnId: "TXN12345678", amount: 500_000 }, "CHO_QUET", {
      loai: "BO_QUA",
      btId: null,
      lyDo: LY_DO_HUY_TOAN_PHAN,
    });
    expect(luu.status).toBe("THAT_BAI");
    expect(luu.lastResultKind).toBe("PAID");
    expect(luu.lastResultMessage).toMatch(/cho quẹt lại/);
    const r = choPhepHuyPhieuThe(dau(luu, "THAT_BAI"));
    expect(r).toEqual(TU_CHOI("KET_QUA_PAID_SAU_THAT_BAI"));
    if (r.huyDuoc) throw new Error("phải từ chối");
    expect(`${r.lyDo} ${r.viecNenLam}`, "không nói 'quẹt lại' theo chiều nào").not.toMatch(/quẹt lại/);
  });

  it("lỗi kết nối trên phiếu MỞ được lưu (đè kết quả trước) ⇒ LOI_KET_NOI; lỗi do máy đồng bộ không sẵn sàng (AGENT_*) cũng vậy", () => {
    for (const reasonCode of ["TCB_FILE_DB", "AGENT_HET_PHIEN", "KET_QUA_HONG"]) {
      const luu = luuSauLuotKiem({ kind: "PROVIDER_ERROR", reasonCode }, "CHO_QUET");
      expect(luu.lastResultKind, reasonCode).toBe("PROVIDER_ERROR");
      expect(choPhepHuyPhieuThe(dau(luu)), reasonCode).toEqual(TU_CHOI("LOI_KET_NOI"));
    }
  });

  it("FAILED ⇒ phiếu THAT_BAI, mọi nhóm lý do thất bại đều cho huỷ (xác nhận mạnh)", () => {
    for (const reasonCode of ["THAT_BAI", "USER_CANCELLED", "05", "MA_LA"]) {
      const luu = luuSauLuotKiem({ kind: "FAILED", reasonCode }, "CHO_QUET");
      expect(luu.status, reasonCode).toBe("THAT_BAI");
      expect(choPhepHuyPhieuThe(dau(luu, "THAT_BAI")), reasonCode).toEqual(CHO_HUY);
    }
  });

  it("nhận ra câu bằng CHÍNH hàm dựng câu (`dauCauChuaThay`): đổi chữ ở một bên là đỏ ở bên kia", () => {
    const cau = thongDiepPos({ loai: "CHUA_THAY", code5: CODE, duLieuLuc: null, gdMoiNhatLuc: null, taoLuc: TAO, baoAdminTuLuc: TAO }).cau;
    expect(cau.startsWith(dauCauChuaThay(CODE))).toBe(true);
    expect(laCauChuaThayTran(cau, CODE)).toBe(true);
    expect(laCauChuaThayTran(cau, "ZZZZZ")).toBe(false);
    expect(laCauChuaThayTran(null, CODE)).toBe(false);
    expect(laCauChuaThayTran("", CODE)).toBe(false);
    // Mã chỉ là TIỀN TỐ của mã dài hơn / có ký tự dính liền ⇒ không nhận nhầm.
    expect(laCauChuaThayTran(cau, `${CODE}X`)).toBe(false);
  });
});

describe("[HN4-09] TỔ HỢP ĐẦY ĐỦ so với oracle độc lập", () => {
  const TAT_CA_STATUS: PosIntentStatus[] = ["CHO_QUET", "THAT_BAI", "DA_THU", "LECH_TIEN", "CAN_XU_LY", "HET_HAN", "HUY"];
  const TAT_CA_KIND: (PosCheckKind | null)[] = [null, "PAID", "PAID_AMOUNT_MISMATCH", "FAILED", "NOT_FOUND", "CANCELLED_AFTER_PAID", "PROVIDER_ERROR"];
  const CAU_TRAN = thongDiepPos({ loai: "CHUA_THAY", code5: CODE, duLieuLuc: null, gdMoiNhatLuc: null, taoLuc: TAO, baoAdminTuLuc: TAO }).cau;
  const CAU_TREO = thongDiepPos({ loai: "DANG_CHO_NGAN_HANG", code5: CODE, maTrangThai: "DANG_XU_LY" }).cau;
  // VIỆC 6: loại câu thứ TƯ — chính câu `tuChoiSaiMa` ghi. Hàm thuần KHÔNG được tự nhận ra nó (chỉ cờ `cauLuuLaCauTuChoiSaiMa` được): ô "câu từ chối" × cờ TẮT phải ra CHUA_NGA_NGU.
  const CAU_SAU_TU_CHOI = cauTuChoi("Giao dịch của khách khác");
  const LOAI_CAU: [string, string | null][] = [
    ["trống", null],
    ["chưa thấy trần", CAU_TRAN],
    ["NOT_FOUND treo", CAU_TREO],
    ["câu từ chối sai mã", CAU_SAU_TU_CHOI],
  ];
  const SO_CO = 7;

  function datCo(
    co: number,
  ): Pick<
    DauVaoChoPhepHuyPhieuThe,
    "daNhanGiaoDich" | "coGiaoDichChoTay" | "coYeuCauSaiMaDangGiu" | "cauLuuLaCauTuChoiSaiMa" | "coDongTheChuaKetLuan" | "phieuGopConMo" | "daHetHan"
  > {
    return {
      daNhanGiaoDich: (co & 1) !== 0,
      coGiaoDichChoTay: (co & 2) !== 0,
      coYeuCauSaiMaDangGiu: (co & 4) !== 0,
      cauLuuLaCauTuChoiSaiMa: (co & 8) !== 0,
      phieuGopConMo: (co & 16) === 0,
      daHetHan: (co & 32) !== 0,
      coDongTheChuaKetLuan: (co & 64) !== 0,
    };
  }

  /**
   * Luật viết lại độc lập, theo đặc tả — KHÔNG dùng lại mã của hàm đang thử. Một BẢNG ƯU TIÊN (điều kiện → mã), dòng đầu
   * khớp thắng; không khớp dòng nào ⇒ cho huỷ.
   */
  function oracle(x: DauVaoChoPhepHuyPhieuThe, caiLa: string): MaTuChoiHuyPhieuThe | null {
    const mo = x.status === "CHO_QUET" || x.status === "THAT_BAI";
    const paid = x.lastResultKind === "PAID" || x.lastResultKind === "PAID_AMOUNT_MISMATCH";
    const bang: [boolean, MaTuChoiHuyPhieuThe][] = [
      [x.status === "DA_THU", "DA_THU"],
      [x.status === "LECH_TIEN", "LECH_TIEN"],
      [x.status === "CAN_XU_LY", "CAN_XU_LY"],
      [x.status === "HUY", "DA_HUY"],
      [x.status === "HET_HAN", "DA_HET_HAN"],
      [mo && x.daNhanGiaoDich, "DA_NHAN_GIAO_DICH"],
      [mo && x.coGiaoDichChoTay, "CO_GIAO_DICH_CHO_TAY"],
      [mo && x.coYeuCauSaiMaDangGiu, "CO_YEU_CAU_SAI_MA"],
      [mo && x.coDongTheChuaKetLuan, "DONG_THE_CHUA_NGA_NGU"],
      [mo && paid && x.status === "CHO_QUET", "KET_QUA_PAID_CHUA_GHI"],
      [mo && paid && x.status === "THAT_BAI", "KET_QUA_PAID_SAU_THAT_BAI"],
      [mo && x.lastResultKind === "CANCELLED_AFTER_PAID", "HUY_SAU_THU"],
      [mo && x.lastResultKind === "PROVIDER_ERROR", "LOI_KET_NOI"],
      // VIỆC 6: NOT_FOUND mà câu lưu KHÔNG phải "chưa thấy trần" vẫn là CHUA_NGA_NGU — TRỪ KHI cờ nói câu lưu chính là câu `tuChoiSaiMa` ghi (ô này chỉ dựa vào CỜ, không đọc câu).
      [mo && x.lastResultKind === "NOT_FOUND" && caiLa !== "chưa thấy trần" && !x.cauLuuLaCauTuChoiSaiMa, "CHUA_NGA_NGU"],
      [mo && !x.phieuGopConMo, "PHIEU_GOP_DA_DONG"],
      [mo && x.daHetHan, "QUA_HAN_CHO_DONG"],
    ];
    return bang.find(([dieuKien]) => dieuKien)?.[1] ?? null;
  }

  it("25.088 đầu vào: không ném, khớp oracle CẢ MÃ, từ chối nào cũng có cặp câu, cho huỷ thì không mang mã và luôn xác nhận mạnh", () => {
    let dem = 0;
    let choHuy = 0;
    for (const status of TAT_CA_STATUS)
      for (const lastResultKind of TAT_CA_KIND)
        for (const [caiLa, lastResultMessage] of LOAI_CAU)
          for (let co = 0; co < 1 << SO_CO; co += 1) {
            const x = v({ status, lastResultKind, lastResultMessage, ...datCo(co) });
            const r = choPhepHuyPhieuThe(x);
            const ten = JSON.stringify({ ...x, caiLa });
            const mong = oracle(x, caiLa);
            dem += 1;
            expect(r.huyDuoc, ten).toBe(mong === null);
            if (r.huyDuoc) {
              choHuy += 1;
              expect(r.canXacNhanManh, ten).toBe(true);
              expect(Object.keys(r).sort(), ten).toEqual(["canXacNhanManh", "huyDuoc"]);
            } else {
              expect(r.ma, ten).toBe(mong);
              expect(r.lyDo.length, ten).toBeGreaterThan(10);
              expect(r.viecNenLam.length, ten).toBeGreaterThan(10);
              expect({ lyDo: r.lyDo, viecNenLam: r.viecNenLam }, ten).toEqual(CAU_TU_CHOI_HUY_PHIEU_THE[r.ma]);
            }
          }
    expect(dem).toBe(7 * 7 * LOAI_CAU.length * (1 << SO_CO));
    // Không có đối chứng thì "luôn từ chối" cũng khớp một nửa oracle: bắt buộc có ô cho huỷ THẬT.
    expect(choHuy).toBeGreaterThan(0);
    // Trần 30 giây: 25.088 đầu vào chạy ~1,2 giây lúc máy rảnh nhưng đo được 5,5 giây (vượt trần mặc định 5 giây) lúc máy bận — một ca timeout làm đỏ lưới sai chỗ (luật 18; VIỆC 6 · a2 thêm loại câu thứ tư ⇒ +33% đầu vào).
  }, 30_000);

  it("VIỆC 6: ô 'câu từ chối sai mã' — cờ BẬT thì cho huỷ (khi không dấu hiệu nào khác), cờ TẮT thì CHUA_NGA_NGU: cờ là nguồn DUY NHẤT nhận ra câu, hàm không đọc câu", () => {
    const sach = { status: "CHO_QUET", lastResultKind: "NOT_FOUND", lastResultMessage: CAU_SAU_TU_CHOI } as const;
    expect(choPhepHuyPhieuThe(v({ ...sach, cauLuuLaCauTuChoiSaiMa: true }))).toEqual(CHO_HUY);
    expect(choPhepHuyPhieuThe(v({ ...sach, cauLuuLaCauTuChoiSaiMa: false }))).toEqual(TU_CHOI("CHUA_NGA_NGU"));
  });

  it("mỗi MÃ từ chối đều ĐẾN ĐƯỢC từ ít nhất một đầu vào (không có mã chết trong bảng câu)", () => {
    const thay = new Set<string>();
    for (const status of TAT_CA_STATUS)
      for (const lastResultKind of TAT_CA_KIND)
        for (const [, lastResultMessage] of LOAI_CAU)
          for (let co = 0; co < 1 << SO_CO; co += 1) {
            const r = choPhepHuyPhieuThe(v({ status, lastResultKind, lastResultMessage, ...datCo(co) }));
            if (!r.huyDuoc) thay.add(r.ma);
          }
    expect([...thay].sort()).toEqual([...MA_TU_CHOI_HUY_PHIEU_THE].sort());
  });
});

describe("[HN4-10] CÂU — nguyên văn, đủ cặp, ghép đúng lối của repo", () => {
  it("mọi mã từ chối có cặp (lý do · việc nên làm); lý do không kết thúc bằng dấu chấm, việc nên làm có", () => {
    for (const ma of MA_TU_CHOI_HUY_PHIEU_THE) {
      const c = CAU_TU_CHOI_HUY_PHIEU_THE[ma];
      expect(c.lyDo.trim(), ma).toBe(c.lyDo);
      expect(c.lyDo.endsWith("."), ma).toBe(false);
      expect(c.viecNenLam.endsWith("."), ma).toBe(true);
    }
    expect(Object.keys(CAU_TU_CHOI_HUY_PHIEU_THE).sort()).toEqual([...MA_TU_CHOI_HUY_PHIEU_THE].sort());
  });
  it("`ghepCauTuChoiHuy` ghép 'lý do — việc nên làm' (một câu cho máy chủ và màn)", () => {
    expect(ghepCauTuChoiHuy({ lyDo: "A", viecNenLam: "B." })).toBe("A — B.");
    const r = choPhepHuyPhieuThe(v({ status: "DA_THU" }));
    if (r.huyDuoc) throw new Error("DA_THU không được huỷ");
    expect(ghepCauTuChoiHuy(r)).toBe(`${CAU_TU_CHOI_HUY_PHIEU_THE.DA_THU.lyDo} — ${CAU_TU_CHOI_HUY_PHIEU_THE.DA_THU.viecNenLam}`);
  });
  it("các câu 'ĐỪNG cho khách quẹt lại' của máy chủ (rủi ro tiền) KHÔNG bị làm mềm", () => {
    for (const ma of ["KET_QUA_PAID_CHUA_GHI", "CHUA_NGA_NGU", "DONG_THE_CHUA_NGA_NGU"] as const) {
      expect(CAU_TU_CHOI_HUY_PHIEU_THE[ma].viecNenLam, ma).toContain("ĐỪNG cho khách quẹt lại");
    }
  });
  it("câu của ca MƠ HỒ (THAT_BAI + PAID) KHÔNG khẳng định 'ĐỪNG quẹt lại' lẫn 'cho quẹt lại' — nó đứng cạnh một câu lưu có thể nói ngược", () => {
    const c = CAU_TU_CHOI_HUY_PHIEU_THE.KET_QUA_PAID_SAU_THAT_BAI;
    expect(`${c.lyDo} ${c.viecNenLam}`).not.toMatch(/quẹt lại/);
  });
  it("[HN6-A2-C1] câu CO_YEU_CAU_SAI_MA nói ĐỦ HAI kết cục của yêu cầu và KHÔNG hứa 'phiếu thẻ không còn huỷ tay được' (lời hứa sai từ V4.2: sau từ chối sale HUỶ ĐƯỢC — chủ dự án chốt 10/10/2026)", () => {
    const c = CAU_TU_CHOI_HUY_PHIEU_THE.CO_YEU_CAU_SAI_MA;
    const cau = `${c.lyDo} — ${c.viecNenLam}`;
    expect(cau, "không còn lời hứa cũ").not.toMatch(/không (còn )?huỷ tay|không huỷ được nữa/i);
    expect(c.viecNenLam, "kết cục DUYỆT").toMatch(/Duyệt/);
    expect(c.viecNenLam, "kết cục TỪ CHỐI nói về việc huỷ phiếu thẻ").toMatch(/từ chối thì huỷ được phiếu thẻ/);
    expect(c.viecNenLam, "vẫn là lệnh cấm quẹt lại trong lúc chờ").toContain("đừng cho khách quẹt lại");
  });
});
