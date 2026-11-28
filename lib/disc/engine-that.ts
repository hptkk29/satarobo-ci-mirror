/**
 * ĐỘNG CƠ DISC THẬT — adapter nối `engine-goc/**` (mã vendoring từ repo DISC, commit 5630a1c5) vào hợp đồng
 * `DiscEngine` (`./engine.ts`).
 *
 * CHỈ MÁY CHỦ (`server-only`): bộ câu hỏi kèm cột trục/đảo chiều chính là KHOÁ CHẤM. Nó không được vào bundle
 * trình duyệt; client chỉ nhận `boDeChoKhach()` (id + nội dung câu) qua `POST /api/disc/bo-de`.
 *
 * Quyền dùng mã dựa trên CHỈ ĐẠO CỦA BGĐ + tài liệu bàn giao của chủ repo DISC — xem
 * `docs/disc-tich-hop/12-engine-tich-hop.md` mục "XÁC NHẬN QUYỀN DÙNG" (chưa có chữ ký văn bản). Nội dung chuyên
 * môn Gói A/B chưa ký ⇒ `DISC_ENABLED` vẫn TẮT với khách thật.
 *
 * Luật giữ nguyên từ hợp đồng: server CHẤM LẠI từ câu trả lời thô; không có đường nào để điểm do client khai đi vào
 * kết quả (hàm `cham` chỉ nhận id→giá trị rồi tự tính).
 */
import "server-only";

import { PHIEN_BAN_BO_DE } from "@/lib/disc/engine-goc/config/disc-cau-hoi";
import { LOP_MAM_NON } from "@/lib/disc/engine-goc/config/disc-nguong";
import type { BoDe, MaBoDe } from "@/lib/disc/engine-goc/modules/core/bo-de/kieu";
import { laMaBoDe, napBoDe } from "@/lib/disc/engine-goc/modules/core/bo-de/nap";
import { cham as chamGoc } from "@/lib/disc/engine-goc/modules/report/cham";
import {
  TUOI_TU_DANH_GIA_TOI_THIEU,
  boDeChoThanhVien,
  dinhTuyen,
  laBanQuanSat,
} from "@/lib/disc/engine-goc/modules/test/dinh-tuyen";

import type { BoDeDisc, DiscEngine, DoiTuongBoDe, KetQuaCham, TraLoiTho } from "./engine";

/** Commit của repo DISC mà `engine-goc` được chép từ đó. Đổi mã gốc ⇒ đổi hằng này + chạy lại golden. */
export const COMMIT_DISC_GOC = "5630a1c5605e580d688c5e8f52dedf4052aaed5c";

/** Phiên bản động cơ ghi cùng mỗi bài (`engineVersion`): mã gốc + phiên bản ngân hàng câu. ≤ 40 ký tự. */
export const PHIEN_BAN_ENGINE = `sr-disc/${PHIEN_BAN_BO_DE}+${COMMIT_DISC_GOC.slice(0, 7)}`;

/** Bộ đề mà hợp đồng SataRobo phát ra. QS (người lớn quan sát con ≥ 8 tuổi) KHÔNG nằm trong hồ sơ PH+HS. */
const BO_DE_PHAT_RA: readonly DoiTuongBoDe[] = ["MN", "TH", "THCS", "PH"];

function laBoDePhatRa(ma: string): ma is DoiTuongBoDe {
  return (BO_DE_PHAT_RA as readonly string[]).includes(ma);
}

const boNho = new Map<DoiTuongBoDe, BoDeDisc>();

/**
 * Dựng `BoDeDisc` bằng pick TƯỜNG MINH: chỉ `id` + `noiDung` của câu. Cột `truc`/`dao`/`soiGuong` của câu gốc là
 * khoá chấm — không bao giờ được rơi vào object này (kể cả ở runtime, không chỉ ở kiểu TS).
 */
function dungBoDe(ma: DoiTuongBoDe): BoDeDisc {
  const daCo = boNho.get(ma);
  if (daCo) return daCo;
  const goc: BoDe = napBoDe(ma);
  const bo: BoDeDisc = Object.freeze({
    ma,
    phienBan: PHIEN_BAN_BO_DE,
    doiTuong: ma,
    nguoiLonTraLoiHo: laBanQuanSat(ma),
    cauHoi: Object.freeze(goc.cau.map((c) => Object.freeze({ id: c.ma, noiDung: c.noiDung }))),
    // Thang + câu dẫn là phần HIỂN THỊ (nhãn các mức), không phải khoá chấm — cần để client gửi đúng giá trị 1..mucToiDa của bộ đề.
    cauDan: goc.cauDan,
    thang: Object.freeze(goc.thang.map((m) => Object.freeze({ gia: m.giaTri, nhan: m.nhan, ...(m.mat ? { mat: m.mat } : {}) }))),
  });
  boNho.set(ma, bo);
  return bo;
}

/** "MN" → lớp mầm non; "1".."12" → số lớp. Chuỗi khác ⇒ undefined (không đoán). */
function lopCuaBac(bacHoc: string | undefined): string | undefined {
  if (bacHoc === undefined) return undefined;
  if (bacHoc === "MN") return LOP_MAM_NON;
  return /^(?:[1-9]|1[0-2])$/.test(bacHoc) ? bacHoc : undefined;
}

function chonBoDe(d: { vai: "PH" | "HS"; bacHoc?: string; namSinh: number; namNay: number }): BoDeDisc | null {
  if (!Number.isInteger(d.namSinh) || !Number.isInteger(d.namNay)) return null;
  const tuoi = d.namNay - d.namSinh;
  if (tuoi < 0 || tuoi > 120) return null;

  if (d.vai === "PH") {
    const kq = dinhTuyen({ doiTuong: "phu-huynh", mucTieu: "toi" });
    return kq.xong && laBoDePhatRa(kq.boDe) ? dungBoDe(kq.boDe) : null;
  }

  // HS: không tự đoán khi thiếu/lạ bậc học.
  const lop = lopCuaBac(d.bacHoc);
  if (lop === undefined) return null;
  const theoLop = boDeChoThanhVien("con", lop);
  if (!theoLop) return null;
  // ADR-002 của DISC: dưới 8 tuổi KHÔNG tự đánh giá — kể cả khi bậc học đã là lớp 3+ (năm sinh khai lệch lớp).
  // Cùng luật với `nguoiLonQuanSat` của `ho-so.ts`; dùng đúng hằng của engine gốc.
  const ma: MaBoDe = tuoi < TUOI_TU_DANH_GIA_TOI_THIEU && !laBanQuanSat(theoLop.boDe) ? "MN" : theoLop.boDe;
  return laBoDePhatRa(ma) ? dungBoDe(ma) : null;
}

function layBoDe(ma: string): BoDeDisc | null {
  return laMaBoDe(ma) && laBoDePhatRa(ma) ? dungBoDe(ma) : null;
}

/**
 * CHẤM LẠI từ câu trả lời thô. Kiểm đầu vào TRƯỚC khi chạm engine gốc:
 *  - id lạ (không thuộc bộ đề) ⇒ GIA_TRI_KHONG_HOP_LE (engine gốc im lặng bỏ qua — ở biên server thì từ chối);
 *  - giá trị không phải số nguyên 1..mucToiDa ⇒ GIA_TRI_KHONG_HOP_LE (engine gốc nhận cả 2,5 — chặt hơn ở đây);
 *  - thiếu câu ⇒ THIEU_CAU_TRA_LOI;
 *  - hàng rào "trả lời phẳng" (HL-1) ⇒ TRA_LOI_PHANG.
 * Thời gian làm bài KHÔNG tin client ⇒ truyền `null` (HL-4 bị bỏ qua, đúng ngữ nghĩa của engine gốc).
 */
function cham(ma: string, traLoi: TraLoiTho): KetQuaCham {
  if (!laMaBoDe(ma) || !laBoDePhatRa(ma)) return { ok: false, lyDo: "BO_DE_KHONG_TON_TAI" };
  const bo = napBoDe(ma);
  if (typeof traLoi !== "object" || traLoi === null || Array.isArray(traLoi)) {
    return { ok: false, lyDo: "GIA_TRI_KHONG_HOP_LE" };
  }

  const maCau = new Set(bo.cau.map((c) => c.ma));
  const sach: Record<string, number> = {};
  for (const khoa of Object.keys(traLoi)) {
    if (!maCau.has(khoa)) return { ok: false, lyDo: "GIA_TRI_KHONG_HOP_LE" };
    const v: unknown = (traLoi as Record<string, unknown>)[khoa];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > bo.mucToiDa) {
      return { ok: false, lyDo: "GIA_TRI_KHONG_HOP_LE" };
    }
    sach[khoa] = v;
  }
  if (bo.cau.some((c) => !Object.prototype.hasOwnProperty.call(sach, c.ma))) {
    return { ok: false, lyDo: "THIEU_CAU_TRA_LOI" };
  }

  const kq = chamGoc(bo, sach, null);
  if (!kq.hopLe) {
    return { ok: false, lyDo: kq.lyDo === "THIEU_CAU" ? "THIEU_CAU_TRA_LOI" : "TRA_LOI_PHANG" };
  }
  return {
    ok: true,
    ketQua: {
      diem: { D: kq.diem.D, I: kq.diem.I, S: kq.diem.S, C: kq.diem.C },
      maBoDe: ma,
      phienBanBoDe: PHIEN_BAN_BO_DE,
      canhBao: kq.canhBao,
      xepHang: kq.xepHang,
    },
  };
}

export const engineThat: DiscEngine = Object.freeze({
  phienBan: PHIEN_BAN_ENGINE,
  chonBoDe,
  layBoDe,
  cham,
});
