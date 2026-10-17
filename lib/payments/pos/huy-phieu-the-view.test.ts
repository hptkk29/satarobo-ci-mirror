// lib/payments/pos/huy-phieu-the-view.test.ts — `PhieuPosView.huyPhieuThe` + LƯỚI DÂY NỐI của hợp đồng Việc 4.
//
// Hai nửa:
//   · `[HN4-12]` — `dungPhieuPosView` (nơi DUY NHẤT màn lấy kết quả "huỷ được không") ánh xạ hàng thô sang
//     `choPhepHuyPhieuThe` đúng; và nút KHÔNG BAO GIỜ nằm trên một phiếu mà màn đang vẽ là HET_HAN / PHIEU_DA_DONG / HUY /
//     DA_THU … (màn không vẽ nút mà máy chủ chắc chắn từ chối — luật 12).
//   · `[HN4-W*]` — lưới ghim MÃ NGUỒN cho những thứ test hành vi không chạm tới: chữ ký action (hợp đồng với giao diện) và
//     cổng quyền là dòng đầu thân action, mọi nơi gọi `choPhepHuyPhieuThe` truyền ĐỦ bảy sự thật (không hằng) và đo hạn/phiếu
//     gộp bằng CHÍNH hàm dùng chung, hai sự thật Việc 3 SUY từ `saiMaYeuCau` trong view (sau ghép — trước ghép đi qua `ganYeuCauSaiMa`):
//     VIỆC 6 · a2 — "đang giữ" (`coYeuCauSaiMaDangGiu`) và "câu lưu là câu từ chối" (`cauLuuLaCauTuChoiSaiMa`, thay cho cờ "bị từ chối" đã gỡ).
//     Neo BIỂU THỨC (không neo chỗ đặt chữ), bỏ chú thích trước khi đếm (chú thích giải thích bản vá hay chứa đúng chuỗi
//     lưới đang tìm), đếm SỐ LẦN khớp (luật 11 của repo).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { PosIntentStatus } from "@prisma/client";
import { chonPhieuPosHienThi, dungPhieuPosView, type PhieuPosDeXem } from "./phieu-pos-luat";
import { choPhepHuyPhieuThe } from "./huy-phieu-the";
import { CAU_PHIEU_THE_DA_HUY, CAU_PHIEU_THE_DA_HUY_CHO_KE_TOAN, CAU_TU_CHOI_HUY_PHIEU_THE, cauPhieuTheDaHuy } from "./huy-phieu-the-cau";
import { cauTuChoi } from "./sai-ma";
import { thongDiepPos } from "./thong-diep-pos";

const PHUT = 60_000;
const NOW = new Date("2026-10-09T03:00:00.000Z");
const TAO = new Date(NOW.getTime() - 5 * PHUT);

function raw(p: Partial<PhieuPosDeXem> = {}): PhieuPosDeXem {
  return {
    id: "i1",
    code5: "H6WR4",
    amount: 800_000,
    status: "CHO_QUET",
    createdAt: TAO,
    expiresAt: new Date(TAO.getTime() + 24 * 60 * PHUT),
    lastCheckAt: null,
    lastResultKind: null,
    lastResultMessage: null,
    paymentBillId: "b1",
    posTerminal: null,
    bankTransaction: null,
    paymentBill: { status: "OPEN", lines: [{ paymentRequestId: "pr1" }] },
    coGiaoDichChoTay: false,
    // GHÉP VIỆC 4 × VIỆC 3: hai cờ yêu cầu sai mã KHÔNG còn là trường của `PhieuPosDeXem` — view suy chúng từ `saiMaYeuCau` (Việc 3).
    saiMaYeuCau: [],
    coDongTheChuaKetLuan: false,
    donDaCoVetBac: false,
    ...p,
  };
}
/** Một yêu cầu "nhập sai mã" như `ganChoTay` nạp vào `saiMaYeuCau` (tối đa một phần tử — yêu cầu MỚI NHẤT). */
const yeuCau = (trangThai: PhieuPosDeXem["saiMaYeuCau"][number]["trangThai"]): PhieuPosDeXem["saiMaYeuCau"] => [
  { trangThai, lyDoTuChoi: trangThai === "TU_CHOI" ? "Giao dịch của khách khác" : null, dangGhiLuc: null, btStatus: "UNMATCHED", btDaGoGan: false },
];
const PHIEU_MO = { billId: "b1", tongTien: 800_000, dong: [{ paymentRequestId: "pr1", ten: "Đợt 1", soTien: 800_000 }] };
const view = (p: Partial<PhieuPosDeXem> = {}, now = NOW) => dungPhieuPosView({ intent: raw(p), phieuMo: PHIEU_MO, now });

describe("[HN4-12] dungPhieuPosView.huyPhieuThe — ánh xạ hàng thô ⇒ hàm luật", () => {
  it("phiếu mở, chưa kiểm ⇒ cho huỷ, xác nhận mạnh", () => {
    expect(view().huyPhieuThe).toEqual({ huyDuoc: true, canXacNhanManh: true });
  });

  it("mỗi nguồn sự thật đi đúng vào đúng khoá của hàm luật (đối chứng dương: tắt nguồn thì cho huỷ)", () => {
    const BANG: [string, Partial<PhieuPosDeXem>, keyof typeof CAU_TU_CHOI_HUY_PHIEU_THE][] = [
      ["đã nhận giao dịch (bankTransaction ≠ null)", { bankTransaction: { status: "UNMATCHED", allocations: [] } }, "DA_NHAN_GIAO_DICH"],
      ["giao dịch chờ tay", { coGiaoDichChoTay: true }, "CO_GIAO_DICH_CHO_TAY"],
      ["yêu cầu sai mã còn sống — CHO_DUYET (Việc 3)", { saiMaYeuCau: yeuCau("CHO_DUYET") }, "CO_YEU_CAU_SAI_MA"],
      ["yêu cầu sai mã còn sống — DANG_GHI (Việc 3)", { saiMaYeuCau: yeuCau("DANG_GHI") }, "CO_YEU_CAU_SAI_MA"],
      ["yêu cầu sai mã còn sống — DA_GHI_NHAN (Việc 3: `≠ TU_CHOI` là SỐNG)", { saiMaYeuCau: yeuCau("DA_GHI_NHAN") }, "CO_YEU_CAU_SAI_MA"],
      // VIỆC 6 · a2: hàng "yêu cầu sai mã mới nhất bị từ chối → SAI_MA_BI_TU_CHOI" ĐÃ GỠ — kế toán từ chối không còn tự nó chặn huỷ (ca `[HN6-A2-V1]` dưới).
      ["dòng thẻ mang mã chưa thành giao dịch (Việc 4, rà đối kháng)", { coDongTheChuaKetLuan: true }, "DONG_THE_CHUA_NGA_NGU"],
      ["phiếu gộp đã đóng", { paymentBill: { status: "CLOSED", lines: [{ paymentRequestId: "pr1" }] } }, "PHIEU_GOP_DA_DONG"],
      ["lỗi kết nối ở lượt kiểm gần nhất", { lastResultKind: "PROVIDER_ERROR", lastResultMessage: "x" }, "LOI_KET_NOI"],
    ];
    for (const [ten, p, ma] of BANG) {
      const r = view(p).huyPhieuThe;
      expect(r.huyDuoc, ten).toBe(false);
      if (!r.huyDuoc) expect(r.ma, ten).toBe(ma);
    }
    expect(view().huyPhieuThe.huyDuoc, "đối chứng: không nguồn nào bật").toBe(true);
  });

  it("hết hạn đo bằng CHÍNH `phieuPosHetHan`: đúng biên `expiresAt = now` ⇒ hết hạn; lệch +1 ms ⇒ còn hạn", () => {
    const dung = view({ expiresAt: NOW });
    expect(dung.hienThi).toBe("HET_HAN");
    expect(dung.huyPhieuThe).toMatchObject({ huyDuoc: false, ma: "QUA_HAN_CHO_DONG" });
    const con = view({ expiresAt: new Date(NOW.getTime() + 1) });
    expect(con.hienThi).toBe("CHO_QUET");
    expect(con.huyPhieuThe.huyDuoc).toBe(true);
  });

  it("phiếu HUY mang câu lưu CŨ ('Chưa thấy giao dịch…') ⇒ view nói theo TRẠNG THÁI — huỷ tay vẫn có thể là phiếu MỚI NHẤT của phiếu gộp đang mở nên vẫn lên màn", () => {
    const cuLuu = "Chưa thấy giao dịch mang mã H6WR4. Kiểm tra biên lai đã báo thành công và mã trong ghi chú.";
    const huy = view({ status: "HUY", lastResultKind: "NOT_FOUND", lastResultMessage: cuLuu });
    expect(huy.hienThi).toBe("HUY");
    expect(huy.thongDiep).toBe(CAU_PHIEU_THE_DA_HUY);
    expect(huy.thongDiep).not.toContain("Chưa thấy");
    expect(huy.mucDo).toBe("thong_tin");
    expect(huy.duocKiemTra).toBe(false);
    expect(huy.huyPhieuThe).toMatchObject({ huyDuoc: false, ma: "DA_HUY" });
    // Đối chứng dương: phiếu MỞ có cùng câu lưu vẫn in câu lưu (chỉ HUY được thay).
    expect(view({ lastResultKind: "NOT_FOUND", lastResultMessage: cuLuu }).thongDiep).toBe(cuLuu);
  });

  it("trạng thái lưu ánh xạ thẳng; `huyDuoc` ⇒ màn đang vẽ phiếu ĐANG CHỜ QUẸT (không bao giờ trên HET_HAN / PHIEU_DA_DONG / HUY / đã thu)", () => {
    const STATUS: PosIntentStatus[] = ["CHO_QUET", "THAT_BAI", "DA_THU", "LECH_TIEN", "CAN_XU_LY", "HET_HAN", "HUY"];
    let choHuy = 0;
    for (const status of STATUS)
      for (const hetHan of [false, true])
        for (const billMo of [true, false])
          for (const kind of [null, "FAILED", "NOT_FOUND", "PROVIDER_ERROR", "PAID"] as const) {
            const v = view({
              status,
              lastResultKind: kind,
              expiresAt: hetHan ? NOW : new Date(NOW.getTime() + 60 * PHUT),
              paymentBill: { status: billMo ? "OPEN" : "CLOSED", lines: [{ paymentRequestId: "pr1" }] },
            });
            const ten = JSON.stringify({ status, hetHan, billMo, kind });
            if (v.huyPhieuThe.huyDuoc) {
              choHuy += 1;
              expect(["CHO_QUET", "THAT_BAI"], ten).toContain(v.hienThi);
              expect(v.trangThai, ten).toBe(status);
            }
            // Khẳng định ngược: hiển thị là một trạng thái ĐÃ ĐÓNG/DẪN XUẤT thì nút không được hứa.
            if (["HET_HAN", "PHIEU_DA_DONG", "HUY", "DA_THU", "KE_TOAN_DA_GHI", "KE_TOAN_DA_GO", "LECH_TIEN", "CAN_XU_LY"].includes(v.hienThi)) {
              expect(v.huyPhieuThe.huyDuoc, ten).toBe(false);
            }
          }
    expect(choHuy, "phải có ô cho huỷ thật, kẻo 'luôn từ chối' cũng xanh").toBeGreaterThan(0);
  });

  it("kết quả của view CHÍNH LÀ kết quả của hàm luật với cùng đầu vào (không bản thứ hai của luật)", () => {
    const x = raw({ status: "THAT_BAI", lastResultKind: "FAILED", lastResultMessage: "Giao dịch thất bại — cho quẹt lại." });
    expect(dungPhieuPosView({ intent: x, phieuMo: PHIEU_MO, now: NOW }).huyPhieuThe).toEqual(
      choPhepHuyPhieuThe({
        status: "THAT_BAI",
        lastResultKind: "FAILED",
        lastResultMessage: "Giao dịch thất bại — cho quẹt lại.",
        code5: "H6WR4",
        daNhanGiaoDich: false,
        coGiaoDichChoTay: false,
        coYeuCauSaiMaDangGiu: false,
        cauLuuLaCauTuChoiSaiMa: false,
        coDongTheChuaKetLuan: false,
        phieuGopConMo: true,
        daHetHan: false,
      }),
    );
  });

  describe("[HN6-A2-V1] SAU TỪ CHỐI (VIỆC 6 · a2) — view cho huỷ theo cổng thường; câu lưu được nhận bằng yêu cầu MỚI NHẤT, không bằng cách đọc tiền tố câu", () => {
    const LY_DO = "Giao dịch của khách khác"; // = `lyDoTuChoi` mà `yeuCau("TU_CHOI")` ở trên dựng
    const CAU_TU_CHOI = cauTuChoi(LY_DO);
    const CAU_TRAN = thongDiepPos({ loai: "CHUA_THAY", code5: "H6WR4", duLieuLuc: null, gdMoiNhatLuc: null, taoLuc: TAO, baoAdminTuLuc: TAO }).cau;
    const CAU_TREO = thongDiepPos({ loai: "DANG_CHO_NGAN_HANG", code5: "H6WR4", maTrangThai: "DANG_XU_LY" }).cau;
    const sauTuChoi = (lastResultMessage: string | null, saiMaYeuCau: PhieuPosDeXem["saiMaYeuCau"] = yeuCau("TU_CHOI")) =>
      view({ lastResultKind: "NOT_FOUND", lastResultMessage, saiMaYeuCau }).huyPhieuThe;

    it("[HN6-A2-V1a] NGAY sau từ chối (câu lưu = `cauTuChoi(lyDo)`) và vài phút sau (poller ghi 'Chưa thấy' trần) ⇒ CÙNG MỘT phán quyết: cho huỷ, xác nhận mạnh — view nhận ra qua `saiMaYeuCau[0]`", () => {
      expect(sauTuChoi(CAU_TU_CHOI)).toEqual({ huyDuoc: true, canXacNhanManh: true });
      expect(sauTuChoi(CAU_TRAN)).toEqual({ huyDuoc: true, canXacNhanManh: true });
    });
    it("[HN6-A2-V1b] ĐỐI CHỨNG ÂM: không có yêu cầu bị từ chối đứng sau câu ⇒ CHUA_NGA_NGU — câu từ chối một mình KHÔNG mở khoá", () => {
      expect(sauTuChoi(CAU_TU_CHOI, [])).toMatchObject({ huyDuoc: false, ma: "CHUA_NGA_NGU" });
      // …và câu của một lần từ chối với lý do KHÁC lý do của yêu cầu mới nhất
      expect(sauTuChoi(cauTuChoi("Lý do của lần từ chối cũ"))).toMatchObject({ huyDuoc: false, ma: "CHUA_NGA_NGU" });
    });
    it("[HN6-A2-V1c] lượt kiểm sau từ chối ghi câu 'ĐỪNG quẹt lại' (dòng treo) ⇒ CHUA_NGA_NGU dù yêu cầu mới nhất từng bị từ chối", () => {
      expect(sauTuChoi(CAU_TREO)).toMatchObject({ huyDuoc: false, ma: "CHUA_NGA_NGU" });
    });
    it("[HN6-A2-V1d] yêu cầu SỐNG mới hơn (gửi lại sau khi bị bác) ⇒ CO_YEU_CAU_SAI_MA, kể cả khi câu lưu còn là câu từ chối của lần trước", () => {
      expect(sauTuChoi(CAU_TU_CHOI, yeuCau("CHO_DUYET"))).toMatchObject({ huyDuoc: false, ma: "CO_YEU_CAU_SAI_MA" });
    });
    it("[HN6-A2-V1e] yêu cầu bị từ chối KHÔNG tự nó đổi phán quyết: cùng một hàng thô, có / không có yêu cầu TU_CHOI (câu lưu không phải câu từ chối) ⇒ cùng kết quả", () => {
      for (const lastResultMessage of [null, CAU_TRAN, CAU_TREO]) {
        for (const lastResultKind of [null, "FAILED", "NOT_FOUND", "PAID", "PROVIDER_ERROR"] as const) {
          const co = view({ lastResultKind, lastResultMessage, saiMaYeuCau: yeuCau("TU_CHOI") }).huyPhieuThe;
          const khong = view({ lastResultKind, lastResultMessage, saiMaYeuCau: [] }).huyPhieuThe;
          expect(co, `${String(lastResultKind)} · ${String(lastResultMessage).slice(0, 20)}`).toEqual(khong);
        }
      }
    });
  });
});

describe("[HN4-13] phiếu HUY × giao dịch thẻ đang chờ kế toán — câu KHÔNG được mời 'thu thẻ lại' khi máy chủ chắc chắn từ chối", () => {
  // Sale huỷ (hợp lệ lúc đó) rồi khách đã quẹt LỆCH SỐ ⇒ giao dịch UNMATCHED. Phiếu thẻ HUY vẫn là phiếu mới nhất của phiếu gộp
  // đang mở nên vẫn lên màn, và ô dòng nói "Thẻ: chờ kế toán". Hộp từng in "Thu thẻ lại thì mở phiếu thẻ mới" — việc mà
  // `taoPhieuPosTrongKhoa` từ chối (`LOI_GIAO_DICH_CHO_TAY`) — và không một chữ về khoản tiền đang chờ.
  const CU_LUU = "Chưa thấy giao dịch mang mã H6WR4. Kiểm tra biên lai đã báo thành công và mã trong ghi chú.";
  it("HUY + coGiaoDichChoTay ⇒ câu CẢNH BÁO (ĐỪNG quẹt lại), mức canh_bao, KHÔNG câu 'thu thẻ lại'", () => {
    const v = view({ status: "HUY", coGiaoDichChoTay: true, lastResultKind: "NOT_FOUND", lastResultMessage: CU_LUU });
    expect(v.hienThi).toBe("HUY");
    expect(v.choKeToan).toBe(true);
    expect(v.thongDiep).toBe(CAU_PHIEU_THE_DA_HUY_CHO_KE_TOAN);
    expect(v.thongDiep).toContain("ĐỪNG cho khách quẹt lại");
    expect(v.thongDiep).not.toMatch(/Thu thẻ lại/);
    expect(v.mucDo).toBe("canh_bao");
  });
  it("ĐỐI CHỨNG DƯƠNG: HUY KHÔNG có giao dịch chờ ⇒ vẫn là câu 'thu thẻ lại', mức thông tin", () => {
    const v = view({ status: "HUY", coGiaoDichChoTay: false, lastResultKind: "NOT_FOUND", lastResultMessage: CU_LUU });
    expect(v.thongDiep).toBe(CAU_PHIEU_THE_DA_HUY);
    expect(v.thongDiep).toMatch(/Thu thẻ lại/);
    expect(v.mucDo).toBe("thong_tin");
  });
  it("hàm chọn câu là MỘT nguồn: cùng đầu ra với view", () => {
    expect(cauPhieuTheDaHuy(true)).toEqual({ cau: CAU_PHIEU_THE_DA_HUY_CHO_KE_TOAN, mucDo: "canh_bao" });
    expect(cauPhieuTheDaHuy(false)).toEqual({ cau: CAU_PHIEU_THE_DA_HUY, mucDo: "thong_tin" });
  });
});

describe("[HN4-14] chonPhieuPosHienThi — phiếu HUY chỉ đại diện cho phiếu gộp khi nó là phiếu MỚI NHẤT của phiếu gộp đó", () => {
  // Huỷ → mở lại (phiếu MỚI dùng lại mã) → quá 30′ chưa có kết quả: phiếu mới bị ẩn, nhưng phiếu HUY cũ KHÔNG BAO GIỜ bị ẩn ⇒
  // màn từng cầm phiếu HUY cũ trong khi máy chủ nói phiếu gộp còn thẻ ĐANG CHỜ: ô dòng mở hộp của phiếu HUY (không Kiểm tra,
  // không Huỷ phiếu thẻ) ⇒ khoá tới 24 giờ quay lại ngay sau một lần huỷ.
  const p = (id: string, status: PosIntentStatus, tuoiPhut: number, paymentBillId = "b1", lastResultKind: PhieuPosDeXem["lastResultKind"] = null) => ({
    id,
    paymentBillId,
    status,
    createdAt: new Date(NOW.getTime() - tuoiPhut * PHUT),
    lastResultKind,
    coGiaoDichChoTay: false,
    saiMaYeuCau: [], // Việc 3: `chonPhieuPosHienThi` / `anKhoiManSale` nay đòi trường này (BẮT BUỘC, luật 7)
  });

  it("phiếu mới nhất bị ẩn (≥ 30′) mà phiếu cũ hơn là HUY ⇒ KHÔNG lấy phiếu HUY cũ thay thế (null)", () => {
    expect(chonPhieuPosHienThi([p("i2", "CHO_QUET", 35), p("i1", "HUY", 60)], "b1", NOW)).toBeNull();
  });
  it("ĐỐI CHỨNG DƯƠNG: phiếu mới còn trẻ ⇒ lên màn, không phải phiếu HUY cũ", () => {
    expect(chonPhieuPosHienThi([p("i2", "CHO_QUET", 5), p("i1", "HUY", 60)], "b1", NOW)?.id).toBe("i2");
  });
  it("ĐỐI CHỨNG DƯƠNG: phiếu HUY là phiếu MỚI NHẤT ⇒ vẫn lên màn (hộp nói 'đã huỷ')", () => {
    expect(chonPhieuPosHienThi([p("i1", "HUY", 60)], "b1", NOW)?.id).toBe("i1");
    expect(chonPhieuPosHienThi([p("i2", "HUY", 40), p("i1", "HUY", 90)], "b1", NOW)?.id).toBe("i2");
  });
  it("ĐỐI CHỨNG DƯƠNG: phiếu cũ hơn KHÔNG phải HUY (đã đóng có tiền) vẫn lên màn khi phiếu mới nhất bị ẩn — luật cũ [POS2-HT-02] giữ nguyên", () => {
    expect(chonPhieuPosHienThi([p("i2", "CHO_QUET", 35), p("i1", "LECH_TIEN", 120, "b1", "PAID")], "b1", NOW)?.id).toBe("i1");
  });
  it("phiếu HUY của phiếu gộp KHÁC không chen vào bước 2 (đã loại HUY từ trước) — null", () => {
    expect(chonPhieuPosHienThi([p("i2", "CHO_QUET", 35), p("i1", "HUY", 60, "b2")], "b1", NOW)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LƯỚI MÃ NGUỒN
// ─────────────────────────────────────────────────────────────────────────────
const GOC = process.cwd();
const doc = (p: string) => readFileSync(resolve(GOC, p), "utf8");
/**
 * Bỏ chú thích khối + chú thích dòng — chú thích giải thích bản vá chứa đúng chuỗi lưới đang tìm. Chỉ bỏ khối `/* … *\/`
 * MỞ Ở ĐẦU DÒNG (JSDoc luôn thế): một chuỗi chứa `/*` giữa dòng (đường dẫn glob) mà bị nhận là mở chú thích sẽ nuốt cả đoạn mã.
 */
const boChuThich = (s: string) => s.replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, "").replace(/^[ \t]*\/\/.*$/gm, "");

/** Mọi tệp mã nguồn (không test) dưới lib/ và app/ — để biết AI gọi `choPhepHuyPhieuThe`. */
function tepMaNguon(): string[] {
  const kq: string[] = [];
  const di = (dir: string) => {
    for (const ten of readdirSync(dir)) {
      if (ten === "node_modules" || ten.startsWith(".")) continue;
      const p = join(dir, ten);
      if (statSync(p).isDirectory()) di(p);
      else if (/\.(ts|tsx)$/.test(ten) && !/\.(test|spec)\./.test(ten)) kq.push(p);
    }
  };
  di(resolve(GOC, "lib"));
  di(resolve(GOC, "app"));
  return kq;
}

describe("[HN4-W] dây nối của hợp đồng Việc 4", () => {
  it("[HN4-W1] chữ ký `huyPhieuTheAction` là HỢP ĐỒNG với giao diện — typed input, kết quả dẹt `KetQuaHuyPhieuThe`", () => {
    // Neo ĐẦU DÒNG (mã thật luôn bắt đầu `export …` ở cột 0; chú thích thì bắt đầu bằng ` *` / `//`) — không cần bỏ chú thích.
    const ma = doc("app/(admin)/admin/orders/_actions.ts");
    const khop = ma.match(/^export async function huyPhieuTheAction\(\s*input:\s*HuyPhieuTheInput\s*\):\s*Promise<KetQuaHuyPhieuThe>/gm) ?? [];
    expect(khop.length, "đúng MỘT khai báo, đúng chữ ký").toBe(1);
    expect(boChuThich(ma), "đầu vào qua zod").toMatch(/huyPhieuTheSchema\.safeParse\(input\)/);
  });

  it("[HN4-W2] MỌI nơi gọi `choPhepHuyPhieuThe(` truyền ĐỦ bảy sự thật theo tên, KHÔNG hằng, đo hạn bằng `phieuPosHetHan(` và phiếu gộp bằng `status === \"OPEN\"` (một nguồn mốc hết hạn)", () => {
    const SAU_SU_THAT = [
      "daNhanGiaoDich",
      "coGiaoDichChoTay",
      "coYeuCauSaiMaDangGiu",
      "cauLuuLaCauTuChoiSaiMa", // VIỆC 6 · a2 — thay cho `yeuCauSaiMaMoiNhatBiTuChoi`
      "coDongTheChuaKetLuan",
      "phieuGopConMo",
      "daHetHan",
    ] as const;
    const noiGoi: string[] = [];
    for (const f of tepMaNguon()) {
      if (/huy-phieu-the\.ts$/.test(f)) continue; // chính tệp định nghĩa
      // Lọc thô TRƯỚC khi bỏ chú thích: 500+ tệp mà chỉ vài tệp có lời gọi — chạy regex bỏ-chú-thích trên tất cả là phần đắt nhất
      // (lượt đầu bị timeout 60s khi máy bận). Tệp chỉ NHẮC tên trong chú thích thì vẫn qua bước lọc rồi bị `boChuThich` loại.
      const tho = readFileSync(f, "utf8");
      if (!tho.includes("choPhepHuyPhieuThe(")) continue;
      const m = boChuThich(tho);
      let i = m.indexOf("choPhepHuyPhieuThe(");
      while (i !== -1) {
        // Khối đối số: từ `({` tới `})` đầu tiên khớp mức (đối số là MỘT object literal).
        const dau = m.indexOf("{", i);
        let cuoi = dau;
        let mucLong = 0;
        for (; cuoi < m.length; cuoi += 1) {
          if (m[cuoi] === "{") mucLong += 1;
          else if (m[cuoi] === "}") {
            mucLong -= 1;
            if (mucLong === 0) break;
          }
        }
        const doi = m.slice(dau, cuoi + 1);
        noiGoi.push(f);
        // Hạn: gọi thẳng `phieuPosHetHan(` HOẶC một biến cục bộ mà chính tệp đó gán bằng `phieuPosHetHan(` (view đo MỘT lần
        // cho cả nhãn "HET_HAN" lẫn cổng nút). KHÔNG chấp nhận hằng `true`/`false` hay phép so sánh tự viết.
        const hanTrucTiep = /\bdaHetHan\s*:\s*phieuPosHetHan\(/.test(doi);
        // Viết tắt (`{ …, daHetHan }`) thì biến cùng tên.
        const bien = doi.match(/\bdaHetHan\s*:\s*([A-Za-z_$][\w$]*)\s*[,}\n]/)?.[1] ?? (/\bdaHetHan\s*[,}]/.test(doi) ? "daHetHan" : undefined);
        const hanQuaBien = bien !== undefined && new RegExp(`\\b${bien}\\s*=\\s*phieuPosHetHan\\(`).test(m);
        expect(hanTrucTiep || hanQuaBien, `${f}: hạn phải đo bằng phieuPosHetHan`).toBe(true);
        // Phiếu gộp còn mở: `<bt>.status === "OPEN"` ngay trong khối, hoặc ở phép gán biến cùng tên.
        const moQuaBt = /\bphieuGopConMo\s*:[^,]*\.status\s*===\s*"OPEN"/.test(doi) || /\bphieuGopConMo\s*=\s*[^;]*\.status\s*===\s*"OPEN"/.test(m);
        expect(moQuaBt, `${f}: phiếu gộp còn mở phải đo bằng status === "OPEN"`).toBe(true);
        // Sáu sự thật người gọi phải ĐỌC chứ không được bịa: có tên (dạng `khoa: bt` hoặc viết tắt) và KHÔNG phải hằng `true`/`false`.
        // Hằng giả làm test hành vi của hàm xanh trong khi màn/máy chủ nói dối (luật 12) — và `tsc` không bắt vì kiểu vẫn là boolean.
        for (const khoa of SAU_SU_THAT) {
          expect(new RegExp(`\\b${khoa}\\s*(:|,|\\})`).test(doi), `${f}: thiếu ${khoa}`).toBe(true);
          expect(new RegExp(`\\b${khoa}\\s*:\\s*(true|false)\\b`).test(doi), `${f}: ${khoa} là HẰNG — phải đọc từ sự thật`).toBe(false);
        }
        i = m.indexOf("choPhepHuyPhieuThe(", i + 1);
      }
    }
    // Hôm nay chỉ có `dungPhieuPosView`; Agent S thêm `huy-phieu-the-db.ts` — lưới này tự phủ nơi gọi mới.
    expect(noiGoi, "dungPhieuPosView phải là một nơi gọi").toContain(resolve(GOC, "lib/payments/pos/phieu-pos-luat.ts"));
  }, 60_000);

  it("[HN4-W3] (viết lại khi GHÉP với Việc 3; VIỆC 6 · a2 đổi cờ thứ hai) hai sự thật yêu cầu sai mã SUY từ MỘT `yc`; cả hai đường đọc view nạp `coDongTheChuaKetLuan` sau `ganChoTay`", () => {
    // Trước ghép lưới này ghim `ganYeuCauSaiMa` + `ganTrangThaiPhu` — hai hàm đã XOÁ: Việc 3 đã nạp `saiMaYeuCau` (yêu cầu MỚI NHẤT) vào
    // `PhieuPosDeXem`, nên chúng là phép SUY trong `dungPhieuPosView`, không phải trường nạp riêng. Lưới giữ các điều `tsc` KHÔNG bắt được:
    //   (1) so với `null`, không `undefined` — `yc` là `… ?? null`, repo không bật `noUncheckedIndexedAccess` nên `tsc` xanh trên cả hai cách
    //       viết, mà `undefined` thì `null.trangThai` nổ ở MỌI đơn chưa từng có yêu cầu sai mã (đo ở bản ghép thử: 34 ca đỏ);
    //   (2) MỘT nguồn `yc`: không khai lần hai (lưới `[HN3-RV-05·W]` đếm đúng một khai báo);
    //   (3) VIỆC 6: sự thật thứ hai KHÔNG phải một phép so `TU_CHOI` trần nữa mà là lời gọi MỘT hàm dùng chung `laCauLuuTuChoiSaiMa` (máy chủ gọi CHÍNH nó — `[HN6-A2-W1]`):
    //       đối số `lastResultMessage` lấy từ HÀNG thô `p`, đối số `yeuCauMoiNhat` là `yc` (không hằng, không `[]`, không phần tử khác).
    const luat = boChuThich(doc("lib/payments/pos/phieu-pos-luat.ts"));
    // Rà ghép 10/10/2026: neo "cờ đọc từ `yc` và so với `TU_CHOI`", KHÔNG neo cách viết (`yc !== null && …` ≡ `(yc?.trangThai ?? …) !== …` — ca hành vi `[HN4-12]` `[HN4-13]` đo giá
    // trị trên mọi lịch sử yêu cầu). Phần `tsc` + hành vi KHÔNG bắt được là `undefined` (dưới) và việc các sự thật cùng đọc MỘT `yc`.
    const bieuThuc = (ten: string) => luat.match(new RegExp(`\\b${ten}:\\s*([^,\\n]+),`))?.[1] ?? "";
    const dangGiu = bieuThuc("coYeuCauSaiMaDangGiu");
    expect(dangGiu, "cờ 'đang giữ' đọc từ `yc`").toMatch(/\byc\b/);
    expect(dangGiu, "cờ 'đang giữ' so với TU_CHOI").toMatch(/"TU_CHOI"/);
    expect((luat.match(/\bcoYeuCauSaiMaDangGiu:/g) ?? []).length, "cờ 'đang giữ' gán đúng một chỗ").toBe(1);
    // Sự thật thứ hai: đúng MỘT lời gọi, gán đúng MỘT chỗ, và cờ cũ ĐÃ GỠ hẳn khỏi mã luật (không để mã chết).
    expect((luat.match(/\bcauLuuLaCauTuChoiSaiMa:/g) ?? []).length, "cờ 'câu lưu là câu từ chối' gán đúng một chỗ").toBe(1);
    expect((luat.match(/\blaCauLuuTuChoiSaiMa\(/g) ?? []).length, "đúng MỘT lời gọi hàm nhận ra câu").toBe(1);
    const goi = luat.match(/\blaCauLuuTuChoiSaiMa\(\{([^}]*)\}\)/)?.[1] ?? "";
    expect(goi, "câu lưu lấy từ hàng thô `p`").toMatch(/\blastResultMessage:\s*p\.lastResultMessage\b/);
    expect(goi, "yêu cầu MỚI NHẤT là `yc` (cùng nguồn với `saiMa` và cờ 'đang giữ')").toMatch(/\byeuCauMoiNhat:\s*yc\b/);
    expect(luat, "cờ cũ 'yêu cầu mới nhất bị từ chối' đã gỡ").not.toMatch(/\byeuCauSaiMaMoiNhatBiTuChoi\b/);
    expect((luat.match(/\bconst yc\s*=/g) ?? []).length, "đúng MỘT khai báo yc").toBe(1);
    expect(luat, "không so với undefined").not.toMatch(/\byc\s*!==?\s*undefined/);

    // Hai đường đọc view (`docPhieuPosView`, `docPhieuPosTho`) — hai đường duy nhất đẻ `PhieuPosDeXem` — mỗi đường đi `ganChoTay` RỒI
    // `ganDongTheChuaKetLuan`. Không còn hàm nạp hai cờ yêu cầu sai mã. (Thiếu bước nào thì `tsc` cũng đỏ vì cờ là BẮT BUỘC; lưới này
    // chặn thêm việc quay lại một hàm nạp riêng.)
    const ma = boChuThich(doc("lib/payments/pos/phieu-pos.ts"));
    expect(ma, "hàm nạp hai cờ đã bị xoá khi ghép").not.toMatch(/\bganYeuCauSaiMa\b|\bganTrangThaiPhu\b/);
    // Rà ghép 10/10/2026: hai đường đọc view đi qua MỘT hàm `ganCoPhiaMan` — nó gọi `ganChoTay` VÀ `ganDongTheChuaKetLuan` trong MỘT `Promise.all` (hai câu tra độc lập, chạy song
    // song; trước đây nối đuôi nhau). Neo BIỂU THỨC + SỐ LẦN, không neo chỗ đặt `await` / thứ tự hai lời gọi (chi tiết thi hành, không phải luật).
    expect((ma.match(/\bganCoPhiaMan\(/g) ?? []).length, "`ganCoPhiaMan` gọi đúng 2 lần (một phiếu · danh sách của đơn)").toBe(2);
    expect((ma.match(/\bganChoTay\(/g) ?? []).length, "`ganChoTay` chỉ gọi trong `ganCoPhiaMan`").toBe(1);
    expect((ma.match(/\bganDongTheChuaKetLuan\(/g) ?? []).length, "`ganDongTheChuaKetLuan` chỉ gọi trong `ganCoPhiaMan`").toBe(1);
    const than = ma.slice(ma.search(/async function ganCoPhiaMan\b/));
    const thanGon = than.slice(0, than.search(/\n\}\n/));
    expect(thanGon, "hai lời gọi nằm trong cùng một Promise.all").toMatch(/Promise\.all\(\[[^\]]*\bganChoTay\(/);
    expect(thanGon, "…cùng một Promise.all").toMatch(/Promise\.all\(\[[^\]]*\bganDongTheChuaKetLuan\(/);
    // Đường cuối của MỌI action thu thẻ (`docPhieuPosView`) KHÔNG gộp `docPhieuGopDangMo` vào cùng `Promise.all`: ca đua `[HN3-DB-03]` chạy năm luồng = cỡ pool mặc định, thêm một
    // kết nối song song mỗi luồng là cạn pool ⇒ giao dịch quá 5 giây (đo 10/10/2026: bản gộp ba câu tra đỏ, tách ra xanh; ca hành vi nằm ở tests/finance, cần Postgres).
    expect(ma, "không gộp ba câu tra song song ở đường action").not.toMatch(/Promise\.all\(\[[\s\S]{0,160}?\bganCoPhiaMan\([\s\S]{0,160}?\bdocPhieuGopDangMo\(/);
    // Hai cờ đo CÙNG cửa sổ: vòng gom theo phiếu gộp sống ở MỘT chỗ (`cuaSoTheoPhieuGop`), không chép lại ở hai nơi.
    expect((ma.match(/\bcuaSoTheoPhieuGop\(/g) ?? []).length, "`ganChoTay` dùng hàm gom chung").toBe(1);
    expect((boChuThich(doc("lib/payments/pos/dong-the-chua-ket-luan-gan.ts")).match(/\bcuaSoTheoPhieuGop\(/g) ?? []).length, "`ganDongTheChuaKetLuan` dùng hàm gom chung").toBe(1);
    expect(ma, "vòng gom cũ không còn chép ở phieu-pos.ts").not.toMatch(/new Map<string, \{ code5: string; billTao: Date; tao: Date\[\] \}>/);
  });

  it("[HN4-W6] cổng máy chủ hỏi `maCoGiaoDichChoTay` VÀ `maCoDongTheChuaKetLuan` với CÙNG mốc (mocTim) — hai nguồn tiền-đang-bay không được lệch cửa sổ", () => {
    const ma = boChuThich(doc("lib/payments/pos/huy-phieu-the-db.ts"));
    expect((ma.match(/\bmaCoGiaoDichChoTay\(tx,\s*mocTim\)/g) ?? []).length, "chờ tay: một lần, theo mocTim").toBe(1);
    expect((ma.match(/\bmaCoDongTheChuaKetLuan\(tx,\s*mocTim\)/g) ?? []).length, "dòng chưa ngã ngũ: một lần, theo mocTim").toBe(1);
    expect((ma.match(/\bmocChoTay\(/g) ?? []).length, "mốc tính ĐÚNG một lần").toBe(1);
  });

  it("[HN4-W5] `huyPhieuTheAction`: cổng quyền + phạm vi `congXemPhieuPos(` đứng ĐẦU thân (sau zod), đúng một lần, trước mọi phép đọc/ghi khác", () => {
    // Thân action còn là tạm (Agent S thay) — cổng này ĐÃ Ở ĐÓ và phải ở lại: một action ghi không gác gì là cửa để ngỏ, và lưới
    // này canh đúng chỗ S dễ sửa nhầm (viết lại thân mà quên dòng đầu). Neo THỨ TỰ, không neo cách viết.
    const ma = boChuThich(doc("app/(admin)/admin/orders/_actions.ts"));
    const dau = ma.indexOf("export async function huyPhieuTheAction(");
    expect(dau, "có khai báo").toBeGreaterThan(-1);
    const sau = ma.slice(dau);
    const than = sau.slice(0, sau.search(/\r?\n\}\r?\n/) + 3);
    expect((than.match(/\bcongXemPhieuPos\(/g) ?? []).length, "đúng một lần").toBe(1);
    const iCong = than.indexOf("congXemPhieuPos(");
    expect(iCong, "sau zod").toBeGreaterThan(than.indexOf("huyPhieuTheSchema.safeParse("));
    for (const truocCong of ["huyPhieuThe(", ".posPaymentIntent.", "$transaction", "revalidatePath(", "db."]) {
      const i = than.indexOf(truocCong);
      if (i !== -1) expect(i, `${truocCong} không được đứng trước cổng quyền`).toBeGreaterThan(iCong);
    }
  });

  it("[HN4-W4] ĐỐI CHỨNG của lưới: bộ quét thật sự THẤY nơi gọi (nếu tệp quét rỗng thì W2 xanh vô nghĩa)", () => {
    const tep = tepMaNguon();
    expect(tep.length).toBeGreaterThan(500);
    expect(tep.some((f) => /huy-phieu-the\.ts$/.test(f))).toBe(true);
  }, 60_000);
});
