// NGUỒN: repo hodacphuchtc/DISC · đường dẫn gốc modules/core/bo-de/kieu.ts · commit 5630a1c5605e580d688c5e8f52dedf4052aaed5c
// Bản vendoring NGUYÊN logic (chỉ đổi alias import @config/@modules -> @/lib/disc/engine-goc/...). Xem docs/disc-tich-hop/12-engine-tich-hop.md.
/**
 * KIỂU DÙNG CHUNG của khoang DISC — nâng lên `core` theo ADR-004.
 *
 * Vì sao ở đây chứ không ở `modules/test`: `modules/report` phải biết hình dạng bộ đề
 * để chấm điểm, nhưng `.semgrep/ranh-gioi-module.yml` cấm `report` import `test`.
 * Kiểu dùng chung thì nâng lên module nền tảng — đúng lối thoát mà chính rule đó ghi.
 *
 * Thuộc TẦNG LÕI: không React, không DOM.
 */

export const MA_BO_DE = ["MN", "TH", "THCS", "PH", "QS"] as const;
export type MaBoDe = (typeof MA_BO_DE)[number];

export const MA_TRUC = ["D", "I", "S", "C"] as const;
export type MaTruc = (typeof MA_TRUC)[number];

export type CauHoi = {
  readonly ma: string;
  readonly truc: MaTruc;
  /** Câu đảo chiều: đồng ý cao ⇒ điểm THẤP cho trục đó. */
  readonly dao: boolean;
  readonly noiDung: string;
  /**
   * Riêng bộ QS: mã câu tương ứng bên bộ con tự làm.
   * Thiếu cột này thì "vùng lệch" chỉ so được điểm tổng, không so được từng câu.
   */
  readonly soiGuong?: readonly string[];
};

/** Một mức trên thang trả lời. `giaTri` luôn đếm từ 1. */
export type MucTraLoi = {
  readonly giaTri: number;
  readonly nhan: string;
  /** Mặt cười cho bộ Tiểu học. Bộ khác để trống. */
  readonly mat?: string;
};

type LoaiThang = "tan-suat" | "dong-y";

export type BoDe = {
  readonly ma: MaBoDe;
  readonly ten: string;
  readonly aiTraLoi: string;
  readonly veAi: string;
  readonly loaiThang: LoaiThang;
  readonly mucToiDa: number;
  readonly thang: readonly MucTraLoi[];
  readonly cauDan: string;
  /**
   * Số câu hiện trên một màn hình.
   *
   * Từ 11.3 là `number` chứ không còn `1 | 5`: chủ dự án chốt 5 câu/màn cho MỌI bộ đề
   * (ADR-006, lật §5.2). Khoá cứng thành hai giá trị thì lần sau muốn thử 3 hay 4 câu
   * lại phải sửa kiểu — mà con số này vốn là lựa chọn trình bày, không phải luật.
   *
   * 🔴 KHÔNG suy cỡ chữ hay cỡ nút từ trường này — dùng `canNutTo()` ở
   * `config/disc-nguong.ts`. Xem lý do dài ở đó.
   */
  readonly cauMoiMan: number;
  readonly cau: readonly CauHoi[];
};

export type NganHang = Readonly<Record<MaBoDe, BoDe>>;

/* ── Kết quả chấm điểm ───────────────────────────────────────────────────── */

/**
 * Nâng lên `core` cùng lý do với `BoDe` (QĐ5): `modules/core/luu-tru` phải lưu được kết
 * quả, nhưng `.semgrep/ranh-gioi-module.yml` cấm `core` import `report`. Kiểu dùng chung
 * thì nâng lên module nền tảng; `report/cham.ts` xuất lại từ đây.
 */
export type Kieu =
  | { readonly loai: "don"; readonly truc: MaTruc }
  | { readonly loai: "pha"; readonly cap: readonly [MaTruc, MaTruc] }
  | { readonly loai: "deu" };

export type MaCanhBao = "MOT_COT" | "MAU_THUAN" | "BAM_BUA";
export type MaChan = "PHANG" | "THIEU_CAU";

export type KetQua =
  | {
      readonly hopLe: false;
      readonly lyDo: MaChan;
      readonly cauThieu?: readonly string[];
    }
  | {
      readonly hopLe: true;
      /** 0–100, làm tròn 1 chữ số thập phân. */
      readonly diem: Readonly<Record<MaTruc, number>>;
      /** Giảm dần. Bằng điểm thì giữ thứ tự D-I-S-C. */
      readonly xepHang: readonly MaTruc[];
      readonly kieu: Kieu;
      readonly canhBao: readonly MaCanhBao[];
    };
