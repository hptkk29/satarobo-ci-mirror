// lib/payments/pos/phieu-pos-luat.ts — LUẬT của phiếu thu thẻ POS (GĐ1). THUẦN.
//
// Thiết kế: docs/pos-gd1-thiet-ke.md §1.4 (vòng đời), §4.5 (bảng quyết), §6.3 (báo admin), §7.1
// (hiển thị). Phiếu POS KHÔNG phải sổ tiền — tiền chỉ ở BankTransaction → PaymentAllocation →
// Payment. Hàm ở đây chỉ quyết TRẠNG THÁI cái tay cầm của sale, theo SỰ THẬT của giao dịch đọc lại
// trong khoá (`xu-ly-ket-qua.ts` đọc, hàm này quyết — tách ra để test được từng ô của bảng).
//
// BA LUẬT, mỗi luật có ca riêng ở `phieu-pos-luat.test.ts`:
//   · SỰ THẬT VỀ TIỀN THẮNG — giao dịch đã MATCHED vào ĐÚNG phiếu gộp ⇒ DA_THU, kể cả phiếu đã bị
//     thay (HET_HAN/HUY) — `[POS1-QD-16]`;
//   · KẾT QUẢ YẾU KHÔNG ĐÈ — NOT_FOUND/FAILED/PROVIDER_ERROR không đổi phiếu ĐÓNG và không ghi đè
//     kết quả của nó — `[POS1-QD-15]`, `[POS1-RACE-03]`;
//   · LỆCH SỐ ≠ LÝ DO KHÁC — `LECH_SO` ⇒ LECH_TIEN, không gộp vào CAN_XU_LY — `[POS1-QD-05]`.
import type { PosCheckTrigger, PosIntentStatus } from "@prisma/client";
import { gioVN } from "@/lib/format/thoi-gian-vn";
import type { KetQuaTienThe } from "./kieu";
import type { PosCheckResult } from "./provider/kieu";
import { nhomLoiThe, thongDiepHienThi, type KetLuanPos, type MucDoPos } from "./thong-diep-pos";
import { LY_DO_HUY_TOAN_PHAN } from "./phan-loai-pos";
import {
  CAU_CHO_KE_TOAN,
  CAU_DANG_GHI,
  CAU_DA_XU_LY_NGOAI,
  CAU_KET,
  trangThaiHieuLuc,
  type HieuLucSaiMa,
  type TrangThaiSaiMa,
} from "./sai-ma";
import { choPhepHuyPhieuThe, laCauLuuTuChoiSaiMa, type KetQuaChoPhepHuyPhieuThe } from "./huy-phieu-the";
import { cauPhieuTheDaHuy } from "./huy-phieu-the-cau";

/** Trạng thái MỞ — đúng tập của chỉ mục từng phần `PosPaymentIntent_paymentBillId_mo_key`. */
export const TRANG_THAI_MO = ["CHO_QUET", "THAT_BAI"] as const satisfies readonly PosIntentStatus[];

/** Hạn một phiếu POS (đặc tả: mặc định +24h). */
export const HAN_PHIEU_POS_MS = 24 * 60 * 60_000;
/** Nút "Báo admin" mở sau 10 phút kể từ lúc tạo phiếu — CÙNG hằng cho UI và cổng máy chủ. */
export const BAO_ADMIN_SAU_MS = 10 * 60_000;
/**
 * Chống bấm dồn — GĐ2 (docs/pos-gd2-thiet-ke.md §2.2, nâng từ 3 giây của T20): tối đa MỘT lượt gọi
 * provider / phiếu / 5 giây. Đo trên `lastCheckAt` đọc DƯỚI khoá dòng phiếu POS (`giuLuotKiem`,
 * `xu-ly-ket-qua.ts`) — không đọc ở action.
 */
export const CHONG_BAM_DON_MS = 5_000;

/**
 * [TỰ QUYẾT U3] Nguồn nào chịu cửa sổ: sale bấm · poller · agent. IMPORT / QUET_SACH do SỰ KIỆN DỮ
 * LIỆU kích (vừa nhập file / chốt cuối ngày), chạy tối đa một lần mỗi sự kiện ⇒ LUÔN hỏi provider —
 * trả câu cũ cho chúng là làm mất đúng thông tin mới vừa về. `Record` ⇒ thêm nguồn mới là `tsc` đỏ.
 */
const CHIU_CUA_SO: Record<PosCheckTrigger, boolean> = {
  SALE: true,
  POLLER: true,
  AGENT: true,
  IMPORT: false,
  QUET_SACH: false,
};

export function apCuaSoChongDon(t: PosCheckTrigger): boolean {
  return CHIU_CUA_SO[t];
}

/**
 * Lượt này có rơi vào cửa sổ của lượt GỌI provider gần nhất không. `now` sớm hơn `lastCheckAt` (lượt
 * khác chen dưới khoá mang mốc "sau" mình) vẫn tính là trong — nhưng chỉ khi lệch < 5 giây: lệch xa hơn
 * về phía trước là một `now` CŨ (lượt đồng bộ cầm một mốc cho cả lô), không phải bấm dồn; hỏi lại
 * provider là vô hại (đường tiền có khoá riêng). Biên `<`: đúng 5 giây ⇒ được hỏi lại.
 */
export function trongCuaSoChongDon(lastCheckAt: Date | null, now: Date): boolean {
  return lastCheckAt !== null && Math.abs(now.getTime() - lastCheckAt.getTime()) < CHONG_BAM_DON_MS;
}

export function laPhieuMo(s: PosIntentStatus): boolean {
  return (TRANG_THAI_MO as readonly PosIntentStatus[]).includes(s);
}

/**
 * [GĐ2 U12] MỘT mốc hết hạn cho view (`dungPhieuPosView`), tạo phiếu (`taoPhieuPosTrongKhoa`) và poller
 * (`dieuKienPollerHetHan` — `expiresAt: { lte: now }`). Biên `≤`: hết hạn ĐÚNG lúc `expiresAt`. GĐ1 lệch
 * 1 ms ở biên (view `now > expiresAt`, tạo phiếu `expiresAt > now`). Lưới `[POS2-HT-04]`.
 */
export function phieuPosHetHan(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() <= now.getTime();
}

/**
 * [GĐ2 U8] Thời hạn HIỂN THỊ phiếu thẻ bỏ dở trên màn sale: quá mốc này phiếu MỞ rời màn (poller vẫn đối
 * soát tới 24 giờ). HẰNG, không SystemSetting: chỉ đổi cái sale THẤY, không đổi tiền, không đổi tập đối
 * soát; tham số "sửa được" mà không ai cần sửa là cờ chết (bài học `PAYMENT_LEDGER_V2`). Cũng là mốc
 * NHỊP của poller (phiếu trẻ kiểm mỗi phút, phiếu già 10 phút một lần — `lich-kiem.ts`).
 */
export const HAN_HIEN_THI_PHIEU_POS_MS = 30 * 60_000;

/** Trạng thái phiếu bỏ dở có thể rời màn — phiếu ĐÓNG (DA_THU/LECH_TIEN/CAN_XU_LY) không bao giờ. */
const TRANG_THAI_AN_DUOC: readonly PosIntentStatus[] = ["CHO_QUET", "THAT_BAI", "HET_HAN"];
/** Kết quả gần nhất mang câu "ĐỪNG cho quẹt lại" / "đã báo admin" ⇒ không ẩn. */
const KIND_GIU_TREN_MAN = new Set<PosCheckResult["kind"]>(["PROVIDER_ERROR", "PAID", "PAID_AMOUNT_MISMATCH"]);

/**
 * [GĐ2 U9] Phiếu có rời MÀN SALE không: phiếu bỏ dở (CHO_QUET/THAT_BAI/HET_HAN) tạo đã ≥ 30 phút — TRỪ
 * khi phiếu gộp có giao dịch thẻ chờ tay (T21 phải nói ra) hoặc kết quả gần nhất là lỗi kết nối / pha
 * tiền ném (câu "ĐỪNG cho quẹt lại"). Ẩn rồi thì ô dòng đợt về nút "Thẻ POS"; bấm ⇒ `moPhieuPos` trả lại
 * CHÍNH phiếu đó khi còn hạn (không ghi gì). Màn nào liệt kê phiếu POS cho sale phải đi qua đây.
 */
export function anKhoiManSale(
  p: {
    status: PosIntentStatus;
    createdAt: Date;
    lastResultKind: PosCheckResult["kind"] | null;
    coGiaoDichChoTay: boolean;
    /** VIỆC 3 — yêu cầu "nhập sai mã" mới nhất (cùng nguồn với `dungPhieuPosView`). BẮT BUỘC (luật 7): `tsc` liệt kê mọi chỗ gọi. */
    saiMaYeuCau: readonly { trangThai: TrangThaiSaiMa }[];
  },
  now: Date,
): boolean {
  if (!TRANG_THAI_AN_DUOC.includes(p.status)) return false;
  if (now.getTime() - p.createdAt.getTime() < HAN_HIEN_THI_PHIEU_POS_MS) return false;
  if (p.coGiaoDichChoTay) return false;
  // Rà đối kháng Việc 3 [HN3-RV-05]: kế toán TỪ CHỐI một yêu cầu ⇒ phiếu về CHO_QUET, lượt kiểm gần nhất vẫn NOT_FOUND (không thuộc
  // `KIND_GIU_TREN_MAN`) và khâu duyệt luôn xảy ra sau ≥ 30′ ⇒ không có vế này thì lệnh CẤM "ĐỪNG cho khách quẹt lại" rời màn đơn đúng lúc
  // khách có thể đã bị trừ tiền. Chỉ nhìn yêu cầu MỚI NHẤT (`saiMaYeuCau[0]`): một lượt đề nghị kế tiếp là chuyện khác.
  if (p.saiMaYeuCau[0]?.trangThai === "TU_CHOI") return false;
  if (p.lastResultKind !== null && KIND_GIU_TREN_MAN.has(p.lastResultKind)) return false;
  return true;
}

/** Kết quả pha tiền: không đụng tiền (kind không phải PAID*) · pha tiền NÉM · kết quả thân dòng. */
export type TienPos = { loai: "KHONG_DOI_TIEN" } | { loai: "CHUA_XAC_DINH" } | KetQuaTienThe;

/** Giao dịch QUYẾT (đọc lại TRONG khoá đơn + khoá phiếu POS). */
export type BtDocLai = {
  status: "MATCHED" | "UNMATCHED" | "IGNORED";
  /** Có phân bổ, và MỌI phân bổ trỏ vào dòng của CHÍNH phiếu gộp của phiếu POS này. */
  vaoDungPhieu: boolean;
} | null;

export type DauVaoQuyetPos = {
  /** Trạng thái phiếu POS đọc lại TRONG khoá. */
  hienTai: PosIntentStatus;
  /** Kết quả provider ĐÃ qua `docKetQuaPos`. */
  kq: PosCheckResult;
  tien: TienPos;
  bt: BtDocLai;
  /** `tachMaPos(ghi chú THẬT)` ra ĐÚNG MỘT mã và mã đó là mã của phiếu này (D2). */
  coMaDuyNhat: boolean;
  /** Giao dịch đang thuộc một phiếu POS KHÁC — một giao dịch tối đa một phiếu. */
  btCuaPhieuKhac: boolean;
  code5: string;
  taoLuc: Date;
  /** Số máy đã thu (dòng file thắng, rồi tới `kq.amount`) — `null` khi không có. */
  soTienMay: number | null;
  /** Giờ quẹt — `null` khi không có. */
  gioQuet: Date | null;
};

export type QuyetPhieuPos = {
  status: PosIntentStatus;
  /** Ghi `lastResultKind/Message`? `false` ⇒ chỉ `lastCheckAt` (kết quả yếu trên phiếu đóng). */
  ghiKetQua: boolean;
  /** Phiếu NHẬN giao dịch (`bankTransactionId`) — chỉ khi đúng một mã + chưa thuộc phiếu khác. */
  nhanBt: boolean;
  /**
   * Báo admin sau commit. GĐ4: `AGENT` = máy đồng bộ của cơ sở không sẵn sàng (D9) ⇒ chuông agent (khoá cơ sở +
   * ngày, CÙNG khoá với `/status` + cron) — KHÔNG chuông `pos.loi-ket-noi:` (T16).
   */
  baoAdmin: "LOI_KET_NOI" | "CHUA_XAC_DINH" | "AGENT" | null;
  /** `null` ⇒ GIỮ câu cũ (phiếu đóng nhận kết quả yếu). */
  ketLuan: KetLuanPos | null;
};

const PAID_KINDS = new Set(["PAID", "PAID_AMOUNT_MISMATCH"]);

const ngay = (s: string | null | undefined): Date | null => {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

export function quyetPhieuPos(v: DauVaoQuyetPos): QuyetPhieuPos {
  const { hienTai, kq, tien, bt } = v;
  const mo = laPhieuMo(hienTai);
  const daBiThay = hienTai === "HET_HAN" || hienTai === "HUY";
  const giu = (ketLuan: KetLuanPos | null, ghiKetQua: boolean, baoAdmin: QuyetPhieuPos["baoAdmin"] = null): QuyetPhieuPos => ({
    status: hienTai,
    ghiKetQua,
    nhanBt: false,
    baoAdmin,
    ketLuan,
  });

  if (PAID_KINDS.has(kq.kind)) {
    const coTheNhan = v.coMaDuyNhat && !v.btCuaPhieuKhac && bt !== null;
    const canXuLy = (lyDo: string): QuyetPhieuPos =>
      daBiThay
        ? giu({ loai: "CAN_XU_LY", soTienMay: v.soTienMay, lyDo }, true)
        : {
            status: "CAN_XU_LY",
            ghiKetQua: true,
            nhanBt: coTheNhan,
            baoAdmin: null,
            ketLuan: { loai: "CAN_XU_LY", soTienMay: v.soTienMay, lyDo },
          };

    // (a0) D7 — tiền ĐÃ vào đúng phiếu gộp này nhưng dữ liệu nay nói giao dịch đã HỦY/HOÀN sau khi ghi
    //      nhận (rà đối kháng 06/10/2026). KHÔNG tự đảo tiền; cùng hành vi kind CANCELLED_AFTER_PAID:
    //      phiếu mở ⇒ CAN_XU_LY, phiếu đóng giữ trạng thái + câu D7. Bản trước rơi thẳng vào (a) ⇒
    //      "Đã ghi nhận … chờ kế toán xác nhận" (xanh) cho một lần quẹt đã hoàn về thẻ khách.
    if (
      tien.loai === "DA_KHOA" &&
      tien.huySauGhiNhan &&
      bt?.status === "MATCHED" &&
      bt.vaoDungPhieu &&
      !v.btCuaPhieuKhac
    ) {
      const ketLuan: KetLuanPos = { loai: "HUY_SAU_THU", soTien: v.soTienMay ?? kq.amount ?? null };
      if (mo) return { status: "CAN_XU_LY", ghiKetQua: true, nhanBt: false, baoAdmin: null, ketLuan };
      return giu(ketLuan, true);
    }

    // (a) SỰ THẬT: tiền ĐÃ vào đúng phiếu gộp này — thắng mọi trạng thái (kể cả HET_HAN/HUY).
    if (bt?.status === "MATCHED" && bt.vaoDungPhieu) {
      if (v.btCuaPhieuKhac) {
        // Một lần quẹt đã thuộc phiếu POS khác — không nhân đôi DA_THU cho cùng một khoản tiền.
        return giu(
          { loai: "CAN_XU_LY", soTienMay: v.soTienMay, lyDo: "giao dịch này đã được ghi cho một phiếu thẻ khác của đơn" },
          mo,
        );
      }
      return {
        status: "DA_THU",
        ghiKetQua: true,
        nhanBt: v.coMaDuyNhat,
        baoAdmin: null,
        ketLuan: {
          loai: "DA_THU",
          soTien: v.soTienMay ?? kq.amount ?? 0,
          luc: v.gioQuet ?? v.taoLuc,
          daGhiTruoc: tien.loai !== "DA_CHIA",
          giaoDichKhac: kq.giaoDichKhac ?? 0,
        },
      };
    }

    // (b) pha tiền NÉM — không biết tiền đã đi tới đâu: GIỮ, báo admin, cấm mời quẹt lại.
    if (tien.loai === "CHUA_XAC_DINH" || tien.loai === "KHONG_DOI_TIEN") {
      return giu({ loai: "CHUA_XAC_DINH" }, mo, "CHUA_XAC_DINH");
    }

    // (c) tiền đã vào sổ nhưng KHÔNG phải phiếu này (gắn tay chỗ khác).
    if (bt?.status === "MATCHED") {
      return canXuLy("tiền đã được ghi vào khoản khác — hỏi kế toán");
    }

    // (d) thất bại / hủy-hoàn TOÀN PHẦN: tiền đã về thẻ khách ⇒ phiếu mở thành THAT_BAI (quẹt lại).
    //     Dòng FILE nói khác provider (provider báo PAID, file ghi "Thất bại") ⇒ sự thật của file thắng.
    if (tien.loai === "BO_QUA") {
      const daHuy = tien.lyDo === LY_DO_HUY_TOAN_PHAN;
      return mo
        ? {
            status: "THAT_BAI",
            ghiKetQua: true,
            nhanBt: false,
            baoAdmin: null,
            ketLuan: daHuy
              ? { loai: "THAT_BAI", maLoi: null, nhom: "DA_HUY_TREN_MAY" }
              : { loai: "THAT_BAI", maLoi: kq.reasonCode ?? null, nhom: "KHAC" },
          }
        : giu(null, false);
    }

    // (e) hoàn MỘT PHẦN / giao dịch đã bị BỎ QUA — số đã lệch, kế toán điều chỉnh.
    if (tien.loai === "CHAN_HOAN_MOT_PHAN" || bt?.status === "IGNORED") {
      return canXuLy("giao dịch đã bị bỏ qua / hoàn một phần — hỏi kế toán trước khi cho quẹt lại");
    }

    // (f) lệch số — LECH_TIEN, giữ nguyên nghĩa "lệch số".
    if (tien.loai === "CHO_TAY" && tien.lyDo === "LECH_SO") {
      if (daBiThay) return giu({ loai: "LECH_TIEN", soTienMay: v.soTienMay ?? 0, soTienPhieu: tien.conPhaiThu }, true);
      return {
        status: "LECH_TIEN",
        ghiKetQua: true,
        nhanBt: coTheNhan,
        baoAdmin: null,
        ketLuan: { loai: "LECH_TIEN", soTienMay: v.soTienMay ?? 0, soTienPhieu: tien.conPhaiThu },
      };
    }

    // (g) lý do khác (quẹt chéo · máy chưa khai · 2 mã · phiếu đã đóng · kế toán gỡ gắn …).
    if (tien.loai === "CHO_TAY") return canXuLy(tien.ghiChu);

    // (h) giao dịch đang ở hàng chờ mà phiếu đã kết luận LECH_TIEN/CAN_XU_LY ⇒ giữ (chờ kế toán).
    if (hienTai === "LECH_TIEN" || hienTai === "CAN_XU_LY") return giu(null, false);
    // DA_CHIA/DA_KHOA mà giao dịch KHÔNG còn MATCHED vào phiếu (gỡ gắn chen giữa hai pha).
    return canXuLy("giao dịch đang chờ kế toán xử lý");
  }

  switch (kq.kind) {
    case "FAILED": {
      if (!mo) return giu(null, false);
      return {
        status: "THAT_BAI",
        ghiKetQua: true,
        nhanBt: false,
        baoAdmin: null,
        ketLuan: { loai: "THAT_BAI", maLoi: kq.reasonCode ?? null, nhom: nhomLoiThe(kq.reasonCode) },
      };
    }
    case "NOT_FOUND": {
      if (!mo) return giu(null, false);
      // GĐ4 (T6): máy đồng bộ chưa trả lời job trong 8″ — dữ liệu chưa tươi: KHÔNG kết luận, KHÔNG mời quẹt lại.
      if (kq.dongBoChuaXong) return giu({ loai: "DANG_DONG_BO", code5: v.code5 }, true);
      // Rà đối kháng bản gộp (RVG-01): máy đồng bộ có dòng BỊ TỪ CHỐI trong cửa sổ của phiếu — lần quẹt có thể chính
      // là nó (khách đã bị trừ thẻ): KHÔNG kết luận "chưa thấy", KHÔNG mời quẹt lại.
      if (kq.dongBiTuChoi) return giu({ loai: "MAY_KHONG_DOC_DUOC", code5: v.code5 }, true);
      // Chế độ AGENT chỉ THÊM khoá `cheDo` — kết luận chế độ FILE giữ NGUYÊN hình dạng GĐ1 ([POS1-QD-12] xanh nguyên văn).
      const cheDo = kq.cheDoNguon === "AGENT" ? { cheDo: "AGENT" as const } : {};
      // Dữ liệu CÓ dòng mang mã nhưng chưa ngã ngũ ("Đang xử lý" / chữ lạ) — giữ MỞ, cấm quẹt lại.
      if (kq.trangThaiTreo) {
        return giu({ loai: "DANG_CHO_NGAN_HANG", code5: v.code5, maTrangThai: kq.trangThaiTreo, ...cheDo }, true);
      }
      return giu(
        {
          loai: "CHUA_THAY",
          code5: v.code5,
          duLieuLuc: ngay(kq.duLieuCapNhatLuc),
          gdMoiNhatLuc: ngay(kq.gdMoiNhatLuc),
          taoLuc: v.taoLuc,
          baoAdminTuLuc: new Date(v.taoLuc.getTime() + BAO_ADMIN_SAU_MS),
          ...cheDo,
        },
        true,
      );
    }
    case "CANCELLED_AFTER_PAID": {
      // D7: hủy/hoàn SAU khi ghi nhận — KHÔNG đụng tiền, cờ cho kế toán.
      const ketLuan: KetLuanPos = { loai: "HUY_SAU_THU", soTien: kq.amount ?? null };
      if (mo) return { status: "CAN_XU_LY", ghiKetQua: true, nhanBt: false, baoAdmin: null, ketLuan };
      return giu(ketLuan, true);
    }
    default: {
      // GĐ4 (D9, T16): máy đồng bộ của cơ sở không sẵn sàng (`AGENT_<sức khoẻ>`) — KHÔNG đổi trạng thái phiếu,
      // KHÔNG mất mã; phiếu đóng không bị đè câu. Báo admin qua chuông agent (không phải `pos.loi-ket-noi:`).
      const ma = kq.reasonCode ?? "KHONG_RO";
      if (ma.startsWith("AGENT_")) {
        return giu(
          mo ? { loai: "TCB_TAM_MAT_KET_NOI", coSo: kq.coSo ?? "", lyDo: ma === "AGENT_HET_PHIEN" ? "HET_PHIEN" : "KHAC", maLoi: ma } : null,
          mo,
          "AGENT",
        );
      }
      // PROVIDER_ERROR (và mọi kind lạ đã bị schema chặn từ trước).
      return giu(mo ? { loai: "LOI_KET_NOI", maLoi: ma } : null, mo, "LOI_KET_NOI");
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BÁO ADMIN (§6.3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lý do KHÔNG cho "Báo admin" — `null` = cho. Máy chủ hỏi lại đúng ba vế mà nút dựa vào (nút
 * chỉ là lời hứa): phiếu còn mở · lần kiểm gần nhất NOT_FOUND · đã ≥ 10 phút từ lúc tạo.
 */
export function lyDoKhongBaoAdmin(
  p: { status: PosIntentStatus; lastResultKind: PosCheckResult["kind"] | null; createdAt: Date },
  now: Date,
): string | null {
  if (!laPhieuMo(p.status)) return "Phiếu thu thẻ không còn chờ quẹt — không cần báo admin";
  if (p.lastResultKind === null) return "Bấm Kiểm tra thanh toán trước khi báo admin";
  if (p.lastResultKind !== "NOT_FOUND") return "Chỉ báo admin khi lần kiểm gần nhất là 'Chưa thấy giao dịch'";
  if (now.getTime() - p.createdAt.getTime() < BAO_ADMIN_SAU_MS) {
    return "Chờ đủ 10 phút kể từ lúc tạo phiếu rồi mới báo admin";
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// HIỂN THỊ (§7.1) — suy từ sự thật, không lưu
// ─────────────────────────────────────────────────────────────────────────────

export type HienThiPhieuPos =
  | "CHO_QUET"
  | "THAT_BAI"
  | "DA_THU"
  | "LECH_TIEN"
  | "CAN_XU_LY"
  | "HET_HAN"
  | "PHIEU_DA_DONG"
  | "KE_TOAN_DA_GHI"
  | "KE_TOAN_DA_GO"
  | "HUY";

export type PhieuPosView = {
  intentId: string;
  code5: string;
  /** `intent.amount` — số LÚC TẠO, chỉ để đối chiếu. */
  soTienLucTao: number;
  /** Còn phải thu HIỆN TẠI của phiếu gộp — số GÕ VÀO MÁY. `null` khi phiếu gộp không còn mở. */
  soTienPhaiThu: number | null;
  dongDot: { nhan: string; soTien: number }[];
  may: { id: string; nhan: string } | null;
  trangThai: PosIntentStatus;
  hienThi: HienThiPhieuPos;
  thongDiep: string | null;
  kiemLuc: string | null;
  taoLuc: string;
  hetHanLuc: string;
  baoAdminTuLuc: string;
  /** Mọi trạng thái trừ HUY. */
  duocKiemTra: boolean;
  /** Các đợt (PaymentRequest) của phiếu gộp mà phiếu POS này thu — ô dòng đợt biết phiếu là của mình. */
  paymentRequestIds: string[];
  /** Phiếu gộp của phiếu POS này CHÍNH LÀ phiếu gộp đang mở của đơn. */
  cuaPhieuDangMo: boolean;
  /**
   * (T21) Giao dịch thẻ của phiếu này còn ở hàng chờ tay — ĐÚNG điều kiện cổng của
   * `taoPhieuPosTrongKhoa` (LECH_TIEN/CAN_XU_LY + giao dịch UNMATCHED). Màn không vẽ nút tạo mới.
   */
  choKeToan: boolean;
  /** `lastResultKind` — nút "Báo admin" hỏi `lyDoKhongBaoAdmin` với chính trường này. */
  ketQuaGanNhat: PosCheckResult["kind"] | null;
  /** Mức độ để tô câu `thongDiep` (câu lưu không mang mức độ — suy từ trạng thái hiển thị). */
  mucDo: MucDoPos;
  /**
   * VIỆC 3 (09/10/2026) — yêu cầu "tôi nhập sai mã" MỚI NHẤT của phiếu này, hoặc `null`. BẮT BUỘC (luật 7): `tsc` liệt kê mọi chỗ dựng view.
   * `trangThai = TU_CHOI` ⇒ hộp ẨN bốn bước hướng dẫn quẹt và in một dòng RIÊNG `cauTuChoi(lyDoTuChoi)` — đọc từ DÒNG YÊU CẦU, KHÔNG từ
   * `thongDiep`/`lastResultMessage`: phiếu sau từ chối về CHO_QUET (phiếu MỞ), poller/Kiểm tra ghi đè câu lưu trong vài phút (TỰ QUYẾT V70).
   */
  saiMa: { trangThai: TrangThaiSaiMa; hieuLuc: HieuLucSaiMa; lyDoTuChoi: string | null } | null;
  /** VIỆC 5 (rà đối kháng) — xem `PhieuPosDeXem.donDaCoVetBac`. Hộp phiếu in `CAU_DON_DA_CO_VET_BAC` khi `canhBaoDonDaBac`. BẮT BUỘC (luật 7). */
  donDaCoVetBac: boolean;
  /**
   * VIỆC 4 (nút "Huỷ phiếu thẻ", 09/10/2026) — phiếu thẻ này huỷ tay được không, và nếu không thì vì sao. Tính ở MÁY CHỦ
   * bằng `choPhepHuyPhieuThe` (`huy-phieu-the.ts`): component CHỈ vẽ đúng thứ này, không tự so trạng thái (khuôn
   * `nutThuThe` / `kenhCuaDong`). Máy chủ hỏi lại hàm đó dưới khoá khi bấm — màn chỉ là lời hứa, cổng thật ở `huyPhieuThe`.
   */
  huyPhieuThe: KetQuaChoPhepHuyPhieuThe;
};

/** Phần của phiếu POS mà `dungPhieuPosView` đọc — `select` ở `phieu-pos.ts` khớp đúng hình này. */
export type PhieuPosDeXem = {
  id: string;
  code5: string;
  amount: number;
  status: PosIntentStatus;
  createdAt: Date;
  expiresAt: Date;
  lastCheckAt: Date | null;
  lastResultKind: PosCheckResult["kind"] | null;
  lastResultMessage: string | null;
  paymentBillId: string;
  posTerminal: { id: string; maThietBi: string; maQuay: string | null; ten: string | null } | null;
  bankTransaction: { status: string; allocations: { paymentRequestId: string }[] } | null;
  paymentBill: { status: string; lines: { paymentRequestId: string }[] };
  /**
   * (T21 theo MÃ — rà đối kháng 06/10/2026) Còn giao dịch thẻ mang MÃ của phiếu gộp này nằm hàng chờ
   * tay (UNMATCHED), KỂ CẢ khi phiếu POS không nhận nó (ghi chú 2 mã · phiếu cũ đã bị thay trước khi
   * file về). CÙNG hàm cổng máy chủ tính (`maCoGiaoDichChoTay`, `the-dang-mo.ts`). BẮT BUỘC (luật 7).
   */
  coGiaoDichChoTay: boolean;
  /**
   * VIỆC 3 — yêu cầu "nhập sai mã" MỚI NHẤT (tối đa một phần tử; `[]` = chưa từng có). BẮT BUỘC (luật 7). `btDaGoGan` do tầng đọc tính sẵn
   * từ tiền tố gỡ gắn của giao dịch (tiền tố nằm ở tệp server-only, tệp này chạy được ở trình duyệt).
   *
   * GHÉP VIỆC 4: đây cũng là NGUỒN DUY NHẤT của hai sự thật mà nút "Huỷ phiếu thẻ" hỏi về yêu cầu sai mã (`coYeuCauSaiMaDangGiu` ·
   * `cauLuuLaCauTuChoiSaiMa` — VIỆC 6 · a2 thay cờ "mới nhất bị từ chối" bằng cờ "câu lưu là câu từ chối", tính từ CHÍNH phần tử đầu này bằng `laCauLuuTuChoiSaiMa`)
   * — `dungPhieuPosView` SUY chúng từ phần tử đầu của mảng này; KHÔNG còn hai trường riêng ở kiểu này (bản Việc 4 trước ghép có hai cờ nạp bằng thân tạm
   * trả `false`). Thêm lại hai trường là mở một nguồn thứ hai cho cùng câu hỏi.
   */
  saiMaYeuCau: readonly {
    trangThai: TrangThaiSaiMa;
    lyDoTuChoi: string | null;
    dangGhiLuc: Date | null;
    btStatus: "MATCHED" | "UNMATCHED" | "IGNORED";
    btDaGoGan: boolean;
  }[];
  /**
   * VIỆC 4 (rà đối kháng 09/10/2026) — còn DÒNG THẺ mang mã nằm trong DB mà CHƯA thành giao dịch ("Đang xử lý"/chữ lạ · số ≤ 0 ·
   * hoàn một phần): lớp mù của `coGiaoDichChoTay` (chỉ UNMATCHED) và của câu lưu. CÙNG hàm cổng máy chủ đọc
   * (`maCoDongTheChuaKetLuan`, `dong-the-chua-ket-luan.ts`). BẮT BUỘC (luật 7). KHÔNG phải cờ của Việc 3.
   */
  coDongTheChuaKetLuan: boolean;
  /**
   * VIỆC 5 (rà đối kháng 10/10/2026) — ĐƠN của phiếu này từng có giao dịch bị kế toán BÁC (qua bất kỳ phiếu thẻ / phiếu gộp nào của đơn). Cùng nguồn với bộ nhớ chặn
   * tự ghi nhận (`docGiaoDichDaBiBac`). Khác `saiMaYeuCau` (theo PHIẾU THẺ): phiếu thẻ MỚI sau khi phiếu cũ bị bác có `saiMaYeuCau = []` nhưng cờ này vẫn bật.
   * Chỉ để IN cảnh báo (`canhBaoDonDaBac`) — KHÔNG tham gia `choPhepHuyPhieuThe` (cổng huỷ Việc 4 không đổi). BẮT BUỘC (luật 7).
   */
  donDaCoVetBac: boolean;
};

export function dungPhieuPosView(input: {
  intent: PhieuPosDeXem;
  /** `docPhieuGopDangMo(orderId)` — phiếu gộp ĐANG MỞ của đơn (có thể là phiếu khác). */
  phieuMo: { billId: string; tongTien: number; dong: { paymentRequestId: string; ten: string; soTien: number }[] } | null;
  now: Date;
}): PhieuPosView {
  const { intent: p, phieuMo, now } = input;
  const cungPhieu = phieuMo !== null && phieuMo.billId === p.paymentBillId;
  const dongPhieu = new Set(p.paymentBill.lines.map((l) => l.paymentRequestId));
  const btVaoPhieu =
    p.bankTransaction?.status === "MATCHED" &&
    p.bankTransaction.allocations.length > 0 &&
    p.bankTransaction.allocations.every((a) => dongPhieu.has(a.paymentRequestId));

  // MỘT lần đo hạn cho CẢ hai việc: nhãn hiển thị ("HET_HAN") và cổng nút "Huỷ phiếu thẻ" (`daHetHan`, Việc 4) — hai nơi
  // đo hai lần là hai nơi có ngày cãi nhau (màn nói "Tạo phiếu mới" mà nút Huỷ vẫn hiện, hoặc ngược lại).
  const hetHan = phieuPosHetHan(p.expiresAt, now);
  let hienThi: HienThiPhieuPos;
  if (p.status === "HUY") hienThi = "HUY";
  else if (laPhieuMo(p.status)) {
    if (p.paymentBill.status !== "OPEN") hienThi = "PHIEU_DA_DONG";
    else if (hetHan) hienThi = "HET_HAN";
    else hienThi = p.status;
  } else if (p.status === "DA_THU") hienThi = btVaoPhieu ? "DA_THU" : "KE_TOAN_DA_GO";
  else if (p.status === "LECH_TIEN" || p.status === "CAN_XU_LY") hienThi = btVaoPhieu ? "KE_TOAN_DA_GHI" : p.status;
  else hienThi = p.status; // HET_HAN

  // VIỆC 3 — hiệu lực của yêu cầu mới nhất SUY từ sự thật (không lưu): kế toán gắn tay / bỏ qua / gỡ gắn giao dịch đang giữ thì yêu cầu thành
  // "đã xử lý ở nơi khác" và hộp phiếu in câu đúng thay vì câu lưu.
  const yc = p.saiMaYeuCau[0] ?? null;
  const saiMa: PhieuPosView["saiMa"] = yc
    ? {
        trangThai: yc.trangThai,
        hieuLuc: trangThaiHieuLuc({
          trangThai: yc.trangThai,
          btStatus: yc.btStatus,
          btDaGoGan: yc.btDaGoGan,
          dangGhiLuc: yc.dangGhiLuc,
          now,
        }),
        lyDoTuChoi: yc.lyDoTuChoi,
      }
    : null;
  // VIỆC 4: phiếu HUY (huỷ tay) có thể là phiếu MỚI NHẤT của phiếu gộp đang mở ⇒ vẫn lên màn (`chonPhieuPosHienThi`), mà câu lưu của nó là lời của
  // lượt kiểm CŨ ("Chưa thấy giao dịch…") — nói theo TRẠNG THÁI, nhánh này đứng ĐẦU chuỗi. Khối CAN_XU_LY của Việc 3 ngay dưới không chạm HUY.
  let thongDiep =
    p.status === "HUY"
      ? cauPhieuTheDaHuy(p.coGiaoDichChoTay).cau
      : hienThi !== p.status && laHienThiSuyRa(hienThi)
        ? thongDiepHienThi(hienThi).cau
        : p.lastResultMessage;
  if (hienThi === "CAN_XU_LY" && p.status === "CAN_XU_LY" && saiMa) {
    // Phiếu đang GIỮ một giao dịch gõ sai mã: nói theo sự thật của yêu cầu, không theo câu lưu (câu lưu có thể cũ).
    if (saiMa.hieuLuc === "CHO_DUYET") thongDiep = CAU_CHO_KE_TOAN;
    else if (saiMa.hieuLuc === "DANG_GHI") thongDiep = CAU_DANG_GHI;
    else if (saiMa.hieuLuc === "KET") thongDiep = CAU_KET;
    else if (saiMa.hieuLuc === "DA_XU_LY_NGOAI") thongDiep = CAU_DA_XU_LY_NGOAI;
  }

  return {
    intentId: p.id,
    code5: p.code5,
    soTienLucTao: p.amount,
    soTienPhaiThu: cungPhieu ? phieuMo.tongTien : null,
    dongDot: cungPhieu ? phieuMo.dong.map((d) => ({ nhan: d.ten, soTien: d.soTien })) : [],
    may: p.posTerminal ? { id: p.posTerminal.id, nhan: p.posTerminal.maQuay ?? p.posTerminal.ten ?? p.posTerminal.maThietBi } : null,
    trangThai: p.status,
    hienThi,
    // Hiển thị KHÁC trạng thái lưu (kế toán gỡ/gắn · phiếu gộp đóng · quá hạn) ⇒ câu lưu là lời của
    // lượt kiểm CŨ — nói theo sự thật hiện tại (luật 12). Trùng ⇒ giữ câu của lượt kiểm thật.
    // Việc 3 + Việc 4: câu đã quyết ở trên — phiếu HUY nói theo trạng thái, phiếu đang giữ giao dịch gõ sai mã nói theo yêu cầu.
    thongDiep,
    kiemLuc: p.lastCheckAt ? gioVN(p.lastCheckAt) : null,
    taoLuc: gioVN(p.createdAt),
    hetHanLuc: gioVN(p.expiresAt),
    baoAdminTuLuc: gioVN(new Date(p.createdAt.getTime() + BAO_ADMIN_SAU_MS)),
    duocKiemTra: p.status !== "HUY",
    paymentRequestIds: p.paymentBill.lines.map((l) => l.paymentRequestId),
    cuaPhieuDangMo: cungPhieu,
    choKeToan:
      p.coGiaoDichChoTay ||
      ((p.status === "LECH_TIEN" || p.status === "CAN_XU_LY") && p.bankTransaction?.status === "UNMATCHED"),
    ketQuaGanNhat: p.lastResultKind,
    // VIỆC 4 (rà đối kháng): phiếu HUY còn giao dịch chờ kế toán ⇒ cảnh báo, không tông thông tin.
    mucDo: p.status === "HUY" ? cauPhieuTheDaHuy(p.coGiaoDichChoTay).mucDo : mucDoHienThi(hienThi, p.lastResultKind),
    saiMa,
    donDaCoVetBac: p.donDaCoVetBac,
    huyPhieuThe: choPhepHuyPhieuThe({
      status: p.status,
      lastResultKind: p.lastResultKind,
      lastResultMessage: p.lastResultMessage,
      code5: p.code5,
      daNhanGiaoDich: p.bankTransaction !== null,
      coGiaoDichChoTay: p.coGiaoDichChoTay,
      // GHÉP VIỆC 4 × VIỆC 3: hai sự thật về yêu cầu sai mã SUY từ `yc` đã khai ở trên cho `saiMa` (CÙNG một nguồn — không khai lần hai,
      // không có trường thứ hai trên `PhieuPosDeXem`). ⛔ So với `null`, KHÔNG `undefined`: `yc` là `... ?? null`; `tsc` không bắt nhầm
      // (không bật `noUncheckedIndexedAccess`) nhưng `undefined` thì `null.trangThai` nổ ở MỌI đơn chưa từng có yêu cầu sai mã.
      coYeuCauSaiMaDangGiu: yc !== null && yc.trangThai !== "TU_CHOI",
      // VIỆC 6 · a2: thay cho cờ "yêu cầu mới nhất bị từ chối" (cổng riêng đã gỡ). CÙNG hàm nhận ra câu từ chối mà máy chủ gọi (`huyPhieuThe`), cùng nguồn `yc`.
      cauLuuLaCauTuChoiSaiMa: laCauLuuTuChoiSaiMa({ lastResultMessage: p.lastResultMessage, yeuCauMoiNhat: yc }),
      coDongTheChuaKetLuan: p.coDongTheChuaKetLuan,
      phieuGopConMo: p.paymentBill.status === "OPEN",
      // CÙNG phép đo hạn mà `hienThi` dùng (`hetHan` ở đầu hàm = `phieuPosHetHan`, mốc chung với poller) — không chép lại.
      daHetHan: hetHan,
    }),
  };
}

type HienThiSuyRa = "KE_TOAN_DA_GO" | "KE_TOAN_DA_GHI" | "PHIEU_DA_DONG" | "HET_HAN";
function laHienThiSuyRa(h: HienThiPhieuPos): h is HienThiSuyRa {
  return h === "KE_TOAN_DA_GO" || h === "KE_TOAN_DA_GHI" || h === "PHIEU_DA_DONG" || h === "HET_HAN";
}

/**
 * Kết quả mà phiếu CÒN MỞ vẫn mang câu đỏ: lỗi kết nối · pha tiền ném (PAID* mà phiếu chưa đóng).
 *
 * [Rà đối kháng GĐ2, 06/10/2026] Cũng là tập "lượt kiểm CHƯA KẾT LUẬN được" của poller: phiếu quá hạn mà
 * kết quả gần nhất thuộc tập này KHÔNG bị ghi HET_HAN (`hetHanPhieuPos` từ chối dưới khoá) — lỗi kết nối
 * là chưa biết sự thật; PAID* trên phiếu MỞ là pha tiền ném ("tiền có thể đã trừ thẻ", câu "ĐỪNG cho quẹt
 * lại"). Ghi HET_HAN lên đó là kết luận khi chưa biết, và màn in "Tạo phiếu mới" cạnh câu cấm quẹt lại.
 */
export const KIND_CHUA_KET_LUAN = ["PROVIDER_ERROR", "PAID", "PAID_AMOUNT_MISMATCH"] as const satisfies readonly PosCheckResult["kind"][];
const KIND_LOI_KHI_MO = new Set<PosCheckResult["kind"]>(KIND_CHUA_KET_LUAN);

/** Kết quả gần nhất có cho phép poller kết luận HET_HAN không (`null` = chưa kiểm lần nào ⇒ cho). */
export function choPhepHetHan(lastResultKind: PosCheckResult["kind"] | null): boolean {
  return lastResultKind === null || !KIND_LOI_KHI_MO.has(lastResultKind);
}

/**
 * Mức độ tô câu theo trạng thái hiển thị + kết quả gần nhất. Export cho lượt CACHE (`ketQuaCache`): câu
 * trả về là câu ĐÃ LƯU, nên tô theo CÙNG phép của màn — tô theo trạng thái thôi thì câu "ĐỪNG cho khách
 * quẹt lại" (pha tiền ném, phiếu vẫn CHO_QUET) hiện tông thông tin (rà đối kháng 06/10/2026).
 */
export function mucDoHienThi(h: HienThiPhieuPos, kind: PosCheckResult["kind"] | null): MucDoPos {
  switch (h) {
    case "DA_THU":
      // D7 — đã ghi nhận nhưng giao dịch bị hủy/hoàn sau đó ⇒ không tô xanh.
      return kind === "CANCELLED_AFTER_PAID" ? "canh_bao" : "thanh_cong";
    case "KE_TOAN_DA_GHI":
      return "thanh_cong";
    case "LECH_TIEN":
    case "CAN_XU_LY":
    case "KE_TOAN_DA_GO":
      return "canh_bao";
    case "THAT_BAI":
      return "loi";
    case "CHO_QUET":
      return kind !== null && KIND_LOI_KHI_MO.has(kind) ? "loi" : "thong_tin";
    case "HET_HAN":
    case "PHIEU_DA_DONG":
    case "HUY":
      return "thong_tin";
  }
}

/**
 * Phiếu POS nào lên màn đơn (một phiếu): mới nhất của phiếu gộp ĐANG MỞ (kể cả HET_HAN — ô dòng cần
 * biết để mời tạo lại), không có thì phiếu mới nhất KHÔNG phải HUY/HET_HAN (kết quả tiền của phiếu gộp
 * đã đóng vẫn phải thấy được). `ds` xếp `createdAt` GIẢM dần.
 *
 * GĐ2 (U9): phiếu `anKhoiManSale` bị lọc TRƯỚC CẢ HAI bước — lọc ở bước một thôi thì phiếu bị ẩn quay
 * lại qua cửa sau "mới nhất không phải HUY/HET_HAN" (`[POS2-HT-02]`).
 *
 * VIỆC 6 (chốt, rà đối kháng) — BƯỚC BA: không còn gì khác thì lùi về phiếu `HUY` mà phiếu gộp của nó còn **giao dịch thẻ nằm hàng chờ tay** (`coGiaoDichChoTay`).
 * Vì sao: dừng học / đổi khoá HUỶ kèm phiếu thẻ mở cùng lúc đóng phiếu gộp, nên phiếu thẻ HUY nằm trên phiếu gộp ĐÃ ĐÓNG — bước một không với tới (nó chỉ nhìn phiếu gộp đang mở),
 * bước hai loại HUY. Khách quẹt theo mã cũ sau đó thì tiền rơi hàng chờ gắn tay (`PHIEU_KHONG_MO`, đúng như chủ dự án chốt) nhưng sale ở quầy không còn thấy MỘT dòng nào báo
 * "có giao dịch thẻ mang mã này đang chờ kế toán", rồi phát mã mới + mở thẻ mới cho phần còn nợ ⇒ khách bị quẹt lần hai. TỰ GIỚI HẠN: kế toán gắn tay / bỏ qua xong thì
 * `coGiaoDichChoTay` tắt và phiếu biến khỏi màn (không tồn tại "cảnh báo vĩnh viễn"). Không đổi cổng T21 (`moPhieuPos`/`taoPhieuGop` giữ nguyên) — chỉ SỰ THẤY.
 * HET_HAN vẫn bị loại (không phải phiếu tiền); phiếu KHÁC HUY/HET_HAN vẫn đứng TRƯỚC.
 */
export function chonPhieuPosHienThi<
  T extends {
    paymentBillId: string;
    status: PosIntentStatus;
    createdAt: Date;
    lastResultKind: PosCheckResult["kind"] | null;
    coGiaoDichChoTay: boolean;
    saiMaYeuCau: readonly { trangThai: TrangThaiSaiMa }[];
  },
>(ds: readonly T[], billIdDangMo: string | null, now: Date): T | null {
  const hien = ds.filter((p) => !anKhoiManSale(p, now));
  if (billIdDangMo !== null) {
    // VIỆC 4 (rà đối kháng): phiếu HUY chỉ đại diện cho phiếu gộp khi nó là phiếu MỚI NHẤT của phiếu gộp đó. Huỷ → mở lại → quá 30′:
    // phiếu mới bị ẩn nhưng HUY không bao giờ bị ẩn ⇒ nếu để nó đứng thay, màn cầm phiếu đã đóng trong khi phiếu gộp còn thẻ ĐANG CHỜ.
    const moiNhatCuaBill = ds.find((p) => p.paymentBillId === billIdDangMo);
    const cuaPhieuMo = hien.find((p) => p.paymentBillId === billIdDangMo && !(p.status === "HUY" && p !== moiNhatCuaBill));
    if (cuaPhieuMo) return cuaPhieuMo;
  }
  return hien.find((p) => p.status !== "HUY" && p.status !== "HET_HAN") ?? hien.find((p) => p.status === "HUY" && p.coGiaoDichChoTay) ?? null;
}

/** Màn đơn: chọn MỘT phiếu POS trong `ds` (mới nhất trước) rồi dựng view. `null` khi không có gì để hiện. */
export function dungPhieuPosChoDon(input: {
  ds: readonly PhieuPosDeXem[];
  phieuMo: Parameters<typeof dungPhieuPosView>[0]["phieuMo"];
  now: Date;
}): PhieuPosView | null {
  const p = chonPhieuPosHienThi(input.ds, input.phieuMo?.billId ?? null, input.now);
  return p ? dungPhieuPosView({ intent: p, phieuMo: input.phieuMo, now: input.now }) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// THẺ ĐANG MỞ CỦA MỘT PHIẾU GỘP — hai nút QR / Thẻ POS chung một mã (09/10/2026)
// docs/pos-hai-nut-khai-may.md §1.6
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Phiếu gộp này có THẺ đang mở không, và đang mở theo nghĩa nào:
 *   · `DANG_CHO`    — có phiếu thẻ CHO_QUET/THAT_BAI chưa quá `expiresAt`: khách có thể đang quẹt;
 *   · `CHO_KE_TOAN` — thẻ ĐÃ trừ tiền khách nhưng giao dịch còn ở hàng chờ tay (T21);
 *   · `CHUA_KET_LUAN` — phiếu thẻ ĐÃ QUÁ HẠN nhưng lượt kiểm gần nhất chưa kết luận được (lỗi kết nối, hoặc pha tiền
 *     ném: "tiền có thể đã trừ thẻ"). Poller cũng KHÔNG ghi HET_HAN cho phiếu này (`choPhepHetHan`) — cổng huỷ theo
 *     đúng tập đó thì hai nơi không cãi nhau (rà đối kháng 09/10/2026, TỰ QUYẾT V19).
 *
 * MỘT câu trả lời cho ba nơi — cổng máy chủ của "Huỷ phiếu" (`huyPhieuGop`), sự thật
 * `PhieuGopView.theDangMo` mà trang đơn tính (KHÔNG phụ thuộc quyền `payments:pos-check`), và mọi quyết định
 * ẩn/hiện ở màn (panel QR mặc định, nút Huỷ, cảnh báo hai kênh). Ba nơi cãi nhau là UI vẽ nút mà cổng từ chối.
 *
 * ⚠️ KHÔNG áp cửa sổ ẩn 30 phút của `anKhoiManSale` (TỰ QUYẾT V2): cửa sổ đó chỉ là HIỂN THỊ (U8: "không đổi tập
 * đối soát"), mà T14 nói "chưa thấy giao dịch" phần lớn chỉ là file chưa import — khách có thể ĐÃ trả. Cho huỷ
 * mã trong lúc đó là phát mã mới cho một khoản đã trả, tức đòi khách trả lần hai.
 */
export type TheDangMo = "DANG_CHO" | "CHO_KE_TOAN" | "CHUA_KET_LUAN";

/** Phần của một phiếu thẻ mà `kieuTheDangMo` đọc — `select` ở `the-dang-mo.ts` khớp đúng hình này. */
export type PhieuTheDeXetMo = {
  status: PosIntentStatus;
  expiresAt: Date;
  /** Kết quả lượt kiểm gần nhất — BẮT BUỘC (luật 7): thiếu thì "chưa kết luận" biến thành "đã hết hạn" một cách câm. */
  lastResultKind: PosCheckResult["kind"] | null;
  bankTransaction: { status: string } | null;
};

/**
 * @param phieu             các phiếu thẻ của phiếu gộp ĐANG MỞ.
 * @param coGiaoDichChoTay  còn giao dịch thẻ mang MÃ của phiếu gộp nằm hàng chờ tay (`maCoGiaoDichChoTay`) — kể
 *                          cả khi phiếu thẻ không nhận được nó (ghi chú 2 mã, quẹt dưới phiếu cũ đã bị thay).
 *                          Không có nhánh này thì "huỷ + phát mã mới + quẹt lại" lách T21 (T21 tính theo phiếu gộp).
 * @param now               BẮT BUỘC (luật 19): hết hạn theo CÙNG biên `phieuPosHetHan` mà view và poller dùng.
 */
export function kieuTheDangMo(v: {
  phieu: readonly PhieuTheDeXetMo[];
  coGiaoDichChoTay: boolean;
  now: Date;
}): TheDangMo | null {
  const choKeToan =
    v.coGiaoDichChoTay ||
    v.phieu.some((p) => (p.status === "LECH_TIEN" || p.status === "CAN_XU_LY") && p.bankTransaction?.status === "UNMATCHED");
  if (choKeToan) return "CHO_KE_TOAN";
  const mo = v.phieu.filter((p) => laPhieuMo(p.status));
  if (mo.some((p) => !phieuPosHetHan(p.expiresAt, v.now))) return "DANG_CHO";
  // Quá hạn nhưng chưa kết luận được ⇒ vẫn khoá. Cùng tập với poller (`choPhepHetHan`): poller không ghi HET_HAN
  // cho phiếu này, nên nó ở lại trạng thái MỞ — nếu cổng huỷ coi nó là "đã hết" thì sale huỷ mã + phát mã mới cho
  // một khoản khách CÓ THỂ ĐÃ trả (đòi trả lần hai).
  return mo.some((p) => !choPhepHetHan(p.lastResultKind)) ? "CHUA_KET_LUAN" : null;
}

/** Câu máy chủ từ chối "Huỷ phiếu" khi khách có thể đang quẹt — NGUYÊN VĂN chủ dự án chốt 09/10/2026. */
export const LOI_HUY_KHI_CHO_QUET_THE = "Đang chờ quẹt thẻ cho mã này — huỷ phiếu thẻ trước";
/** Thẻ đã trừ tiền, giao dịch chờ kế toán (TỰ QUYẾT V6): không còn là "chờ khách quẹt" nên có câu riêng. */
export const LOI_HUY_KHI_THE_CHO_KE_TOAN =
  "Giao dịch thẻ của mã này còn chờ kế toán xử lý — xử lý xong mới huỷ được phiếu";

/**
 * Thẻ QUÁ HẠN nhưng lượt kiểm gần nhất chưa kết luận (TỰ QUYẾT V19). Nói đúng điều có thật: đường thoát là bấm Kiểm tra
 * trong hộp thẻ (poller thử lại tới 6 ngày sau hạn, rồi dừng). Cố ý KHÔNG hứa nút "Huỷ phiếu thẻ" (Việc 4 đã có nút, nhưng nó chỉ
 * mở khi `choPhepHuyPhieuThe` cho — ca này nó từ chối `LOI_KET_NOI`/`CHUA_NGA_NGU` — nên câu nói đường thoát THẬT là Kiểm tra).
 */
export const LOI_HUY_KHI_CHUA_KET_LUAN =
  "Phiếu thẻ của mã này đã quá hạn nhưng lần kiểm gần nhất chưa kết luận (khách có thể đã bị trừ tiền) — mở phiếu thẻ, bấm Kiểm tra thanh toán; vẫn chưa rõ thì báo kế toán";

const LOI_HUY: Record<TheDangMo, string> = {
  DANG_CHO: LOI_HUY_KHI_CHO_QUET_THE,
  CHO_KE_TOAN: LOI_HUY_KHI_THE_CHO_KE_TOAN,
  CHUA_KET_LUAN: LOI_HUY_KHI_CHUA_KET_LUAN,
};

export function loiHuyPhieuGopKhiCoThe(the: TheDangMo): string {
  return LOI_HUY[the];
}
