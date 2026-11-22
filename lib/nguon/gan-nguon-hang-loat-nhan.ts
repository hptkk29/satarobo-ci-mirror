/**
 * lib/nguon/gan-nguon-hang-loat-nhan.ts — phần «gán nguồn hàng loạt» mà GIAO DIỆN (client) được import: kiểu, hằng, kiểm lý do. THUẦN, không kéo mã máy chủ.
 *
 * «Gán nguồn hàng loạt» là đường thoát cho HÀNG CHỜ NGUỒN (mọi vấn đề: chưa rõ nguồn · thiếu người giới thiệu · thiếu giải trình · cảnh báo · cần xem tay): người dùng TICK các lead rồi gán một nguồn chung
 * (vd. hàng trăm lead nhập từ file Excel cũ không ai có căn cứ riêng cho từng cái). Không có luật ghi nào ở đây — mỗi lead vẫn đi qua `doiNguonLead` (cổng cơ sở · quyền · lý do ≥ 10 ký tự · TU_CLAIM · audit · khoá lạc quan).
 */
import { LY_DO_TOI_THIEU_NGUON } from "./danh-muc-ghi-dau-vao";
import type { LyDoHangCho } from "./nhan-hien-thi";

/** Số lead MỖI lượt gọi. `doiNguonLead` tải lại danh sách SĐT nhân viên cho từng lead nên chậm — lô nhỏ để một lượt gọi không treo (giao diện lặp theo con trỏ). */
export const CO_LO_GAN_HANG_LOAT = 25;

/** Một nguồn được phép chọn cho lượt hàng loạt: KHÔNG đòi người giới thiệu, KHÔNG đòi giải trình (hai thứ đó là dữ liệu RIÊNG của từng lead, không gán chung được). */
export type NguonChoHangLoat = {
  id: string;
  code: string;
  name: string;
  /** Nguồn này có tính hoa hồng không — giao diện nói thẳng để người chọn biết hậu quả. */
  commissionEnabled: boolean;
};

/**
 * LEAD NÀO được gán. Máy chủ KHÔNG tin danh sách này làm phạm vi — nó chỉ THU HẸP trong hàng chờ của chính người bấm:
 *  · `ids`: các lead người dùng đã TICK. Máy chủ lấy GIAO của danh sách với «hàng chờ nguồn trong tầm nhìn của người bấm» (`whereHangCho(null, coSo)` qua `scopedDb`) — id ngoài hàng chờ, id lead cơ sở khác
 *    hay id bịa đều rơi ra ngoài giao, không bị đổi. Tối đa `TOI_DA_ID_GAN` mỗi lần (giới hạn cả độ dài yêu cầu);
 *  · `loc`: MỌI lead của bộ lọc đang xem («Chọn cả N lead theo bộ lọc») — `lyDo` null = mọi vấn đề.
 */
export type PhamViGan = { kieu: "ids"; ids: string[] } | { kieu: "loc"; lyDo: LyDoHangCho | null };

export const TOI_DA_ID_GAN = 500;

export type KetQuaLoGanHangLoat = {
  /** `chiXem` ⇒ số lead SẼ đổi; ngược lại ⇒ số lead ĐÃ đổi. */
  daDoi: number;
  /** Lead ĐÃ ở đúng nguồn đích (hàng chờ vì lý do khác — thiếu người giới thiệu, cảnh báo…): đổi sang chính nó là nhật ký rỗng nghĩa. */
  boQuaCungNguon: number;
  /** Lead đã có thực thu / sổ hoa hồng: đổi nguồn lúc này là ĐỀ XUẤT duyệt hai cấp, không làm hàng loạt được ⇒ để nguyên trong hàng chờ. */
  boQuaCoTien: number;
  /** Lead có nguồn đang bị KHOÁ (`signals.khoaNguon`). */
  boQuaKhoa: number;
  /** Nguồn của lead vừa bị người khác đổi trong lúc chạy. */
  boQuaVuaDoi: number;
  /** Bị `doiNguonLead` từ chối vì lý do khác (thiếu quyền tại cơ sở của lead…). */
  khongDoiDuoc: number;
  /** Câu từ chối đầu tiên (để người dùng biết vì sao), `null` nếu không có. */
  loiDauTien: string | null;
  /** Số lead đã quét ở lô này (kể cả bỏ qua). */
  daQuet: number;
  /** Con trỏ tiếp theo (`Lead.id` cuối của lô); `null` khi lô rỗng. */
  conTro: string | null;
  hetLead: boolean;
};

export type KetQuaGanHangLoatAction = ({ ok: true } & KetQuaLoGanHangLoat) | { ok: false; error: string; field?: string };

/** Cộng dồn kết quả các lô — dùng cho thanh tiến độ ở giao diện. THUẦN. */
export function congDonLo(a: KetQuaLoGanHangLoat, b: KetQuaLoGanHangLoat): KetQuaLoGanHangLoat {
  return {
    daDoi: a.daDoi + b.daDoi,
    boQuaCungNguon: a.boQuaCungNguon + b.boQuaCungNguon,
    boQuaCoTien: a.boQuaCoTien + b.boQuaCoTien,
    boQuaKhoa: a.boQuaKhoa + b.boQuaKhoa,
    boQuaVuaDoi: a.boQuaVuaDoi + b.boQuaVuaDoi,
    khongDoiDuoc: a.khongDoiDuoc + b.khongDoiDuoc,
    loiDauTien: a.loiDauTien ?? b.loiDauTien,
    daQuet: a.daQuet + b.daQuet,
    conTro: b.conTro ?? a.conTro,
    hetLead: b.hetLead,
  };
}

export const LO_RONG: KetQuaLoGanHangLoat = {
  daDoi: 0,
  boQuaCungNguon: 0,
  boQuaCoTien: 0,
  boQuaKhoa: 0,
  boQuaVuaDoi: 0,
  khongDoiDuoc: 0,
  loiDauTien: null,
  daQuet: 0,
  conTro: null,
  hetLead: false,
};

/** Lý do ≥ 10 ký tự sau trim (cùng ngưỡng với mọi lượt đổi nguồn). `null` = hợp lệ. */
export function kiemLyDoGanHangLoat(lyDo: string | null | undefined): string | null {
  return (lyDo ?? "").trim().length >= LY_DO_TOI_THIEU_NGUON ? null : `Nhập lý do (tối thiểu ${LY_DO_TOI_THIEU_NGUON} ký tự) — nó được ghi vào nhật ký của từng lead.`;
}
