/**
 * CỔNG ĐỘNG CƠ DISC (hợp đồng, KHÔNG phải cài đặt).
 *
 * Mã chấm điểm/bộ câu hỏi của repo `hodacphuchtc/DISC` CHƯA được phép đưa vào repo này
 * (không có giấy phép — audit P0 §B1). Mọi nơi dùng động cơ đi qua hợp đồng này, nên khi có văn
 * bản cho phép chỉ cần `datEngine(...)` một lần, không sửa giao diện hay dịch vụ lưu.
 *
 * LUẬT: server PHẢI tự chấm lại từ câu trả lời (`cham`) — không tin điểm client gửi. Chừng nào
 * `layEngine()` còn null thì đường lưu dữ liệu THẬT bị khoá (xem `DISC_ENGINE_READY`).
 */
export type DoiTuongBoDe = "MN" | "TH" | "THCS" | "PH";

export type CauHoiDisc = { readonly id: string; readonly noiDung: string };

/**
 * Một mức trên thang trả lời của bộ đề. `gia` đếm từ 1 và CHÍNH LÀ giá trị server chấp nhận ở `cham()`.
 * Thang do ENGINE quyết định (MN 5 mức tần suất · TH 3 mức · THCS/PH 5 mức đồng ý) — client KHÔNG tự giả định 1–5:
 * bản đầu của giao diện cứng 1–5 nên bộ Tiểu học (3 mức) nhận 4/5 ⇒ server từ chối cả bài (tìm ra khi chạy engine thật).
 */
export type MucThangDisc = { readonly gia: number; readonly nhan: string; readonly mat?: string };

export type BoDeDisc = {
  readonly ma: string;
  readonly phienBan: string;
  readonly doiTuong: DoiTuongBoDe;
  /** Người lớn quan sát và trả lời hộ (bộ MN; trẻ < 8 tuổi / lớp 1–2). */
  readonly nguoiLonTraLoiHo: boolean;
  readonly cauHoi: readonly CauHoiDisc[];
  /** Câu dẫn hiển thị phía trên mỗi câu (nếu bộ đề có). */
  readonly cauDan?: string;
  /** Thang trả lời của bộ đề. Thiếu ⇒ giao diện rơi về thang mặc định 1–5 (đường tương thích cho engine cũ/giả). */
  readonly thang?: readonly MucThangDisc[];
};

/** Điểm bốn nhóm D-I-S-C, 0–100. Câu trả lời từng câu KHÔNG đi vào kết quả lưu. */
export type KetQuaNguoiDisc = {
  readonly diem: { readonly D: number; readonly I: number; readonly S: number; readonly C: number };
  readonly maBoDe: string;
  readonly phienBanBoDe: string;
  readonly tomTat?: string;
  /**
   * MỞ RỘNG ADDITIVE (đợt engine): cờ hợp lệ của bài (HL-2 một cột · HL-3 mâu thuẫn · HL-4 bấm bừa).
   * Chỉ để nơi gọi/tầng báo cáo đọc; đường lưu (`ketQuaNguoiSchema`) bỏ khoá lạ nên KHÔNG lưu chúng.
   */
  readonly canhBao?: readonly ("MOT_COT" | "MAU_THUAN" | "BAM_BUA")[];
  /** Bốn nhóm xếp giảm dần (bằng điểm giữ thứ tự D-I-S-C). Cùng ghi chú: không đi vào kho lưu. */
  readonly xepHang?: readonly ("D" | "I" | "S" | "C")[];
};

/** Câu trả lời thô: id câu → giá trị số. Đây là thứ DUY NHẤT đường lưu thật nhận từ client. */
export type TraLoiTho = Readonly<Record<string, number>>;

/**
 * `TRA_LOI_PHANG` là mã MỞ RỘNG ADDITIVE: hàng rào HL-1 của DISC (chọn mức giữa quá nhiều câu) chặn bài,
 * không có mã nào trong ba mã gốc diễn đạt đúng việc đó.
 */
export type KetQuaCham =
  | { ok: true; ketQua: KetQuaNguoiDisc }
  | { ok: false; lyDo: "THIEU_CAU_TRA_LOI" | "GIA_TRI_KHONG_HOP_LE" | "BO_DE_KHONG_TON_TAI" | "TRA_LOI_PHANG" };

export type DiscEngine = {
  readonly phienBan: string;
  /** Chọn bộ đề đúng theo vai + bậc học + tuổi (không tự đoán khi thiếu). */
  readonly chonBoDe: (d: { vai: "PH" | "HS"; bacHoc?: string; namSinh: number; namNay: number }) => BoDeDisc | null;
  readonly layBoDe: (ma: string) => BoDeDisc | null;
  /** Chấm LẠI trên server từ câu trả lời thô (id câu → giá trị). Thuần, tất định. */
  readonly cham: (ma: string, traLoi: TraLoiTho) => KetQuaCham;
};

/** Bộ đề trả cho client: CHỈ `ma/phienBan/doiTuong/nguoiLonTraLoiHo/cauHoi[{id,noiDung}]`. */
export type BoDeChoKhach = {
  ma: string;
  phienBan: string;
  doiTuong: DoiTuongBoDe;
  nguoiLonTraLoiHo: boolean;
  cauHoi: Array<{ id: string; noiDung: string }>;
  cauDan?: string;
  thang?: Array<{ gia: number; nhan: string; mat?: string }>;
};

/**
 * Chọn bộ đề cho khách (POST /api/disc/bo-de). Chọn bằng CHÍNH `chonBoDe` mà đường lưu dùng để đối chiếu
 * `maBoDe`, với năm do `namNay` tiêm vào ⇒ bộ đề phát ra luôn là bộ đề server sẽ chấp nhận.
 * Serialize bằng pick tường minh: object runtime của engine có thể mang trọng số/khoá chấm, mà kiểu TS
 * không ngăn được việc chúng rò ra JSON.
 */
export function boDeChoKhach(
  engine: DiscEngine,
  d: { vai: "PH" | "HS"; bacHoc?: string; namSinh: number; namNay: number },
): BoDeChoKhach | null {
  const bo = engine.chonBoDe(d);
  if (!bo) return null;
  return {
    ma: bo.ma,
    phienBan: bo.phienBan,
    doiTuong: bo.doiTuong,
    nguoiLonTraLoiHo: bo.nguoiLonTraLoiHo,
    cauHoi: bo.cauHoi.map((c) => ({ id: c.id, noiDung: c.noiDung })),
    ...(bo.cauDan ? { cauDan: bo.cauDan } : {}),
    ...(bo.thang ? { thang: bo.thang.map((m) => ({ gia: m.gia, nhan: m.nhan, ...(m.mat ? { mat: m.mat } : {}) })) } : {}),
  };
}

let hienTai: DiscEngine | null = null;

/** Gọi MỘT lần khi động cơ hợp pháp đã nằm trong repo. */
export function datEngine(e: DiscEngine | null): void {
  hienTai = e;
}

/** null ⇒ chưa có động cơ: giao diện khoá nút bắt đầu, đường lưu dữ liệu thật từ chối. */
export function layEngine(): DiscEngine | null {
  return hienTai;
}
