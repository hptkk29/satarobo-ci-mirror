// lib/payments/pos/thong-diep-pos.ts — BẢNG ÁNH XẠ kết luận ⇒ câu cho sale đứng quầy (GĐ1 POS). THUẦN.
//
// Thiết kế: docs/pos-gd1-thiet-ke.md §4.6. Mỗi câu là một LỜI HỨA (luật 12): câu sai nghĩa là sale
// mời khách quẹt thẻ lần hai cho khoản ĐÃ thu, hoặc bảo khách về trong khi tiền chưa vào. Ba câu
// mang LỆNH CẤM — đừng làm mềm chúng:
//   · LECH_TIEN     "Đừng quẹt bù phần chênh" (T14) — quẹt bù là hai giao dịch lệch thay vì một;
//   · CHUA_THAY     "ĐỪNG cho quẹt lại" khi dữ liệu chưa có giao dịch nào sau lúc tạo phiếu (T14) —
//                   GĐ1 đọc file import (trễ), NOT_FOUND gần như luôn là "chưa có dữ liệu";
//   · CHUA_XAC_DINH "ĐỪNG cho khách quẹt lại" — pha tiền ném, tiền có thể ĐÃ trừ thẻ.
// Ca `[POS1-TD-*]` so NGUYÊN VĂN.
import type { PosIntentStatus } from "@prisma/client";
import { gioVN } from "@/lib/format/thoi-gian-vn";

export type MucDoPos = "thanh_cong" | "canh_bao" | "loi" | "thong_tin";

/**
 * GĐ2 (docs/pos-gd2-thiet-ke.md §2.2, U2) — lượt bị cửa sổ chống bấm dồn chặn mà phiếu CHƯA có câu nào
 * (lượt đầu còn đang chờ provider). Không bịa kết quả, không mời quẹt lại. Ca `[POS2-CD-08]`.
 */
export const CAU_DANG_KIEM = "Đang có một lượt kiểm tra khác cho phiếu này — xem lại sau vài giây.";

/**
 * Nhóm lý do thất bại — quyết câu "việc tiếp theo" cho sale.
 * `THAT_BAI_RO`: file ghi đúng chữ "Thất bại" (mã `THAT_BAI`) — thất bại THẬT, mời quẹt lại.
 * `KHAC`: mã LẠ — đặc tả chỉ nói "Giao dịch thất bại (mã …)", KHÔNG mời quẹt lại (Q-I fail-closed;
 * rà đối kháng 06/10/2026: bản trước mời quẹt lại cho cả "Đang xử lý").
 */
export type NhomLoiThe = "KHACH_HUY" | "THE_TU_CHOI" | "DA_HUY_TREN_MAY" | "THAT_BAI_RO" | "KHAC";

/** Kết luận của một lượt kiểm — đủ dữ liệu để dựng câu, không gì của khách. */
export type KetLuanPos =
  | { loai: "DA_THU"; soTien: number; luc: Date; daGhiTruoc: boolean; giaoDichKhac: number }
  | { loai: "LECH_TIEN"; soTienMay: number; soTienPhieu: number | null }
  | { loai: "CAN_XU_LY"; soTienMay: number | null; lyDo: string }
  | { loai: "THAT_BAI"; maLoi: string | null; nhom: NhomLoiThe }
  | {
      loai: "CHUA_THAY";
      code5: string;
      duLieuLuc: Date | null;
      gdMoiNhatLuc: Date | null;
      taoLuc: Date;
      baoAdminTuLuc: Date;
      /** GĐ4 (T27): dữ liệu do MÁY ĐỒNG BỘ đưa vào ⇒ câu nói "máy đồng bộ", giờ có giây. Vắng ⇒ FILE (GĐ1). */
      cheDo?: "FILE" | "AGENT";
    }
  | { loai: "HUY_SAU_THU"; soTien: number | null }
  /** Dòng mang mã đang ở trạng thái chưa ngã ngũ ("Đang xử lý" / chữ lạ) — phiếu giữ MỞ. */
  | { loai: "DANG_CHO_NGAN_HANG"; code5: string; maTrangThai: string; cheDo?: "FILE" | "AGENT" }
  | { loai: "LOI_KET_NOI"; maLoi: string }
  | { loai: "CHUA_XAC_DINH" }
  /**
   * GĐ4 (D9, T16): máy đồng bộ của cơ sở hết phiên portal / mất kết nối / chưa sẵn sàng — KHÔNG đổi trạng thái
   * phiếu, KHÔNG mất mã, đã báo admin.
   */
  | { loai: "TCB_TAM_MAT_KET_NOI"; coSo: string; lyDo: "HET_PHIEN" | "KHAC"; maLoi: string }
  /** GĐ4 (T6): máy đồng bộ chưa trả lời job trong 8 giây — dữ liệu chưa tươi, KHÔNG mời quẹt lại. */
  | { loai: "DANG_DONG_BO"; code5: string }
  /**
   * Rà đối kháng bản gộp (RVG-01): máy đồng bộ có dòng BỊ TỪ CHỐI trong cửa sổ của phiếu (lệch hợp đồng / dữ liệu portal
   * lạ) — lần quẹt có thể chính là dòng đó: KHÔNG nói "chưa thấy", KHÔNG mời quẹt lại.
   */
  | { loai: "MAY_KHONG_DOC_DUOC"; code5: string };

/** Bảng mã thẻ để SẴN (T19) — file GĐ1 chỉ có chữ "Thất bại"; chốt khi có API. Không bịa mã. */
const MA_KHACH_HUY = new Set(["USER_CANCELLED", "CANCELLED"]);
const MA_THE_TU_CHOI = new Set(["05", "51", "54", "57", "61", "DECLINED"]);
/** File ghi "Thất bại" ⇒ `maTrangThaiPos` = `THAT_BAI` — thất bại thật. */
const MA_THAT_BAI_RO = new Set(["THAT_BAI"]);

/** Giải nghĩa cho vài mã lỗi kỹ thuật — in kèm mã, không thay mã. */
const GIAI_NGHIA_MA_LOI: Readonly<Record<string, string>> = {
  CHUA_CAP_API: "chưa được cấp API",
};

export function nhomLoiThe(maLoi: string | null | undefined): Exclude<NhomLoiThe, "DA_HUY_TREN_MAY"> {
  const ma = (maLoi ?? "").trim().toUpperCase();
  if (MA_KHACH_HUY.has(ma)) return "KHACH_HUY";
  if (MA_THE_TU_CHOI.has(ma)) return "THE_TU_CHOI";
  if (MA_THAT_BAI_RO.has(ma)) return "THAT_BAI_RO";
  return "KHAC";
}

const tien = (n: number) => `${new Intl.NumberFormat("vi-VN").format(Math.round(n))}đ`;

/** "hh:mm" giờ VN (`giay` ⇒ "hh:mm:ss"); khác NGÀY (giờ VN) với mốc ⇒ "hh:mm ngày dd/mm". */
function gio(d: Date, moc?: Date, giay = false): string {
  const v = gioVN(d);
  const hhmm = v.slice(11, giay ? 19 : 16);
  if (!moc || gioVN(moc).slice(0, 10) === v.slice(0, 10)) return hhmm;
  return `${hhmm} ngày ${v.slice(8, 10)}/${v.slice(5, 7)}`;
}

/** GĐ4 — câu cấm quẹt lại dùng chung của D9 / đồng bộ chưa xong. */
const CAU_BIEN_LAI_DUNG_QUET = "Biên lai máy đã báo THÀNH CÔNG thì ĐỪNG cho quẹt lại";

/** Câu THẤT BẠI theo nhóm — phiếu vẫn MỞ, câu nói rõ việc tiếp theo. */
function cauThatBai(nhom: NhomLoiThe, maLoi: string | null): string {
  const ma = maLoi ? ` (mã ${maLoi})` : "";
  switch (nhom) {
    case "KHACH_HUY":
      return "Khách huỷ trên máy — cho quẹt lại.";
    case "THE_TU_CHOI":
      return `Thẻ bị từ chối${ma} — đổi thẻ khác.`;
    case "DA_HUY_TREN_MAY":
      return "Giao dịch đã bị huỷ toàn bộ trên máy — có thể cho quẹt lại.";
    case "THAT_BAI_RO":
      return `Giao dịch thất bại${ma} — cho quẹt lại.`;
    case "KHAC":
      return `Giao dịch thất bại${ma}.`;
  }
}

const CAU_DUNG_QUET_LAI =
  "Dữ liệu chưa có giao dịch nào sau lúc tạo phiếu — KHÔNG có nghĩa khách chưa trả. " +
  "Biên lai máy đã báo THÀNH CÔNG thì ĐỪNG cho quẹt lại.";

export function thongDiepPos(k: KetLuanPos): { cau: string; mucDo: MucDoPos } {
  switch (k.loai) {
    case "DA_THU": {
      const dau = k.daGhiTruoc
        ? `Đã ghi nhận lúc ${gio(k.luc)} — chờ kế toán xác nhận.`
        : `Đã thu ${tien(k.soTien)} lúc ${gio(k.luc)} — đã ghi nhận, chờ kế toán xác nhận.`;
      if (k.giaoDichKhac > 0) {
        return {
          cau: `${dau} Có thêm ${k.giaoDichKhac} giao dịch thẻ thành công mang mã này — kế toán sẽ kiểm/hoàn.`,
          mucDo: "canh_bao",
        };
      }
      return { cau: dau, mucDo: "thanh_cong" };
    }
    case "LECH_TIEN":
      return {
        cau:
          (k.soTienPhieu === null
            ? `Máy đã thu ${tien(k.soTienMay)}, khác số phải thu của phiếu — đã chuyển kế toán xử lý.`
            : `Máy đã thu ${tien(k.soTienMay)}, phiếu cần ${tien(k.soTienPhieu)} — đã chuyển kế toán xử lý.`) +
          " Đừng quẹt bù phần chênh.",
        mucDo: "canh_bao",
      };
    case "CAN_XU_LY":
      return {
        cau:
          k.soTienMay === null
            ? `Giao dịch thẻ không tự ghi nhận được: ${k.lyDo} — đã chuyển kế toán xử lý.`
            : `Máy đã thu ${tien(k.soTienMay)} nhưng không tự ghi nhận được: ${k.lyDo} — đã chuyển kế toán xử lý.`,
        mucDo: "canh_bao",
      };
    case "THAT_BAI":
      return { cau: cauThatBai(k.nhom, k.maLoi), mucDo: "loi" };
    case "CHUA_THAY": {
      const dau =
        `Chưa thấy giao dịch mang mã ${k.code5}. ` +
        "Kiểm tra biên lai đã báo thành công và mã trong ghi chú.";
      // GĐ4 (T27): chế độ AGENT — dữ liệu do máy đồng bộ đưa vào mỗi phút, câu nói đúng nguồn + giờ có GIÂY.
      const may = k.cheDo === "AGENT";
      const duLieu = k.duLieuLuc
        ? ` Dữ liệu Techcombank${may ? " (máy đồng bộ)" : ""} cập nhật lần cuối ${gio(k.duLieuLuc, k.taoLuc, may)}` +
          (k.gdMoiNhatLuc ? ` (giao dịch mới nhất ${gio(k.gdMoiNhatLuc, k.taoLuc)})` : "") +
          "."
        : may
          ? " Máy đồng bộ Techcombank chưa gửi dữ liệu lần nào."
          : " Chưa có dữ liệu Techcombank nào được nhập.";
      const chuaCoSauTao = k.gdMoiNhatLuc === null || k.gdMoiNhatLuc.getTime() < k.taoLuc.getTime();
      return { cau: dau + duLieu + (chuaCoSauTao ? ` ${CAU_DUNG_QUET_LAI}` : ""), mucDo: "thong_tin" };
    }
    case "HUY_SAU_THU":
      return {
        cau: "Giao dịch thẻ đã bị huỷ/hoàn sau khi ghi nhận — kế toán đang xử lý (hệ thống không tự đảo).",
        mucDo: "canh_bao",
      };
    case "DANG_CHO_NGAN_HANG":
      return {
        cau:
          `Có giao dịch mang mã ${k.code5} nhưng ngân hàng chưa xác nhận (trạng thái ${k.maTrangThai}) — ` +
          (k.cheDo === "AGENT"
            ? "ĐỪNG cho quẹt lại. Bấm Kiểm tra lại sau ít phút."
            : "ĐỪNG cho quẹt lại. Bấm Kiểm tra lại sau khi kế toán nhập dữ liệu mới."),
        mucDo: "thong_tin",
      };
    case "TCB_TAM_MAT_KET_NOI":
      // D9 — tiền tố GIỮ NGUYÊN câu đặc tả "Tạm mất kết nối Techcombank CSx"; đuôi theo lý do (luật 12: mất kết
      // nối không phải lúc nào cũng là hết phiên) + câu cấm quẹt lại (T16).
      return {
        cau:
          k.lyDo === "HET_PHIEN"
            ? `Tạm mất kết nối Techcombank ${k.coSo}, đã báo admin đăng nhập lại. ${CAU_BIEN_LAI_DUNG_QUET} — bấm Kiểm tra lại sau.`
            : `Tạm mất kết nối Techcombank ${k.coSo} (máy đồng bộ không phản hồi), đã báo admin. ${CAU_BIEN_LAI_DUNG_QUET} — bấm Kiểm tra lại sau.`,
        mucDo: "loi",
      };
    case "DANG_DONG_BO":
      return {
        cau: `Máy đồng bộ Techcombank chưa trả lời kịp — bấm Kiểm tra lại sau vài giây. ${CAU_BIEN_LAI_DUNG_QUET}.`,
        mucDo: "thong_tin",
      };
    case "MAY_KHONG_DOC_DUOC":
      // Không hứa "đã báo admin" (luật 12): chỉ FIELD_TOO_LONG mới rung chuông; câu giao việc cho sale.
      return {
        cau:
          `Chưa xác nhận được giao dịch mang mã ${k.code5}: máy đồng bộ Techcombank có giao dịch thẻ trong khoảng giờ của ` +
          "phiếu nhưng không đọc được dữ liệu — báo kế toán kiểm (Sức khoẻ POS Agent › Đối chiếu). " +
          `${CAU_BIEN_LAI_DUNG_QUET}.`,
        mucDo: "canh_bao",
      };
    case "LOI_KET_NOI": {
      const giai = GIAI_NGHIA_MA_LOI[k.maLoi];
      return {
        cau: `Lỗi kết nối hệ thống thanh toán (mã ${k.maLoi}${giai ? ` — ${giai}` : ""}) — đã báo admin.`,
        mucDo: "loi",
      };
    }
    case "CHUA_XAC_DINH":
      return {
        cau: "Chưa xác định được kết quả — ĐỪNG cho khách quẹt lại. Bấm Kiểm tra lại sau ít phút; đã báo admin.",
        mucDo: "loi",
      };
  }
}

/**
 * Câu theo TRẠNG THÁI — dùng khi phiếu ĐÓNG nhận một kết quả yếu (NOT_FOUND / FAILED / lỗi) mà
 * không có câu cũ để trả: không bao giờ được nói "cho quẹt lại" với một phiếu đã thu.
 */
export function thongDiepTrangThai(s: PosIntentStatus): { cau: string; mucDo: MucDoPos } {
  switch (s) {
    case "CHO_QUET":
      return { cau: "Chờ khách quẹt thẻ — quẹt xong bấm Kiểm tra thanh toán.", mucDo: "thong_tin" };
    case "THAT_BAI":
      return { cau: "Lần quẹt gần nhất thất bại — phiếu vẫn mở, cho quẹt lại.", mucDo: "loi" };
    case "DA_THU":
      return { cau: "Đã ghi nhận — chờ kế toán xác nhận.", mucDo: "thanh_cong" };
    case "LECH_TIEN":
      return { cau: "Máy đã thu khác số phiếu — đã chuyển kế toán xử lý. Đừng quẹt bù phần chênh.", mucDo: "canh_bao" };
    case "CAN_XU_LY":
      return { cau: "Giao dịch thẻ không tự ghi nhận được — đã chuyển kế toán xử lý.", mucDo: "canh_bao" };
    case "HET_HAN":
      return { cau: "Phiếu thu thẻ đã hết hạn — tạo phiếu mới nếu cần thu.", mucDo: "thong_tin" };
    case "HUY":
      return { cau: "Phiếu thu thẻ đã huỷ (phiếu gộp đã đổi).", mucDo: "thong_tin" };
  }
}

/**
 * Câu theo trạng thái HIỂN THỊ khi nó KHÁC trạng thái lưu (rà đối kháng 06/10/2026, luật 12): câu lưu
 * (`lastResultMessage`) là lời của lượt kiểm CŨ — kế toán gỡ gắn, phiếu gộp đóng, phiếu quá hạn,
 * kế toán gắn tay đều đổi sự thật mà không ai kiểm lại. In câu cũ là nói "đã ghi nhận" cho một khoản
 * sổ đã gỡ, hoặc "cho quẹt lại" cho một mã đã đóng.
 */
export function thongDiepHienThi(
  h: "KE_TOAN_DA_GO" | "KE_TOAN_DA_GHI" | "PHIEU_DA_DONG" | "HET_HAN",
): { cau: string; mucDo: MucDoPos } {
  switch (h) {
    case "KE_TOAN_DA_GO":
      return { cau: "Kế toán đã gỡ khoản thẻ này khỏi đơn — hỏi kế toán trước khi thu lại.", mucDo: "canh_bao" };
    case "KE_TOAN_DA_GHI":
      return { cau: "Kế toán đã ghi nhận khoản thẻ này vào đơn (gắn tay).", mucDo: "thanh_cong" };
    case "PHIEU_DA_DONG":
      return {
        cau: "Phiếu gộp của mã này đã đóng — không thu thẻ theo mã này nữa. Khách đã quẹt thì bấm Kiểm tra thanh toán.",
        mucDo: "thong_tin",
      };
    case "HET_HAN":
      return thongDiepTrangThai("HET_HAN");
  }
}
