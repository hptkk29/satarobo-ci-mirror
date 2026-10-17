/**
 * lib/nguon/ket-qua-nhap.ts — KẾT QUẢ NGUỒN của một lượt nhập Excel: SUCCESS · SUCCESS_WITH_REVIEW · ERROR · SKIPPED. THUẦN.
 *
 * Dùng chung cho HAI đường Excel (`import/leads` · `import/leads/registered`) để màn hình không nói hai kiểu.
 *
 * ── Vì sao có (11/10/2026) ───────────────────────────────────────────────────────────────────────────────────
 * Trước đó mỗi lead tạo ra chỉ có hai trạng thái trên màn: «đã ghi» hoặc «lỗi». Lead mà NGUỒN còn chờ người duyệt (mã NV giới thiệu sai · nhãn lạ · thiếu người ·
 * chưa rõ nguồn) vẫn được báo «đã ghi» như thể nguồn đã xong — người nhập tin rằng hoa hồng giới thiệu sẽ tự chạy. Bốn trạng thái:
 *  · `SUCCESS`             lead mới + quy nguồn đã ghi, KHÔNG vào hàng chờ nguồn;
 *  · `SUCCESS_WITH_REVIEW` lead mới được tạo, nhưng nguồn ĐANG CHỜ NGƯỜI DUYỆT (nằm trong hàng chờ nguồn). KHÔNG phải lỗi;
 *  · `ERROR`               nhóm/dòng KHÔNG được ghi;
 *  · `SKIPPED`             SĐT đã có lead ⇒ gộp vào lead cũ, nguồn gốc GIỮ NGUYÊN (first-claim) — không có quy nguồn mới để ghi.
 *
 * «Chờ duyệt» = «sẽ hiện trong hàng chờ nguồn» ⇒ dùng ĐÚNG `lyDoCuaDong` (cùng nghĩa `dieuKienLyDo`), không tự nghĩ ra điều kiện thứ hai. Hệ quả cần biết: dòng đi
 * đường mặc định của file đăng ký (nhãn «Import Excel ĐK» ⇒ nhóm cần NGƯỜI mà file không mang người) cũng ở trạng thái này — đó là sự thật về hàng chờ, không phải báo động giả.
 */
import { lyDoCuaDong } from "./ly-do-hang-cho";
import type { LyDoHangCho } from "./nhan-hien-thi";
import type { KetQuaQuyNguon } from "./tin-hieu";

export type PhanLoaiDongNhap = "SUCCESS" | "SUCCESS_WITH_REVIEW" | "ERROR" | "SKIPPED";

export type DauVaoPhanLoai = {
  /** Nhóm/dòng KHÔNG được ghi (cổng phạm vi · gộp chéo cơ sở · chặn nguồn · lỗi dòng). */
  loi: boolean;
  /** SĐT đã có lead ⇒ gộp, không tạo lead mới và không ghi quy nguồn mới. */
  daCoLead: boolean;
  /** Lý do hàng chờ của quy nguồn SẼ GHI cho lead mới; `null` = KHÔNG ghi quy nguồn nào (quản lý nguồn TẮT · lỗi hệ thống) — khi đó không có gì để «chờ duyệt». */
  lyDoHangCho: readonly LyDoHangCho[] | null;
};

export function phanLoaiDongNhap(d: DauVaoPhanLoai): PhanLoaiDongNhap {
  if (d.loi) return "ERROR";
  if (d.daCoLead) return "SKIPPED";
  return d.lyDoHangCho !== null && d.lyDoHangCho.length > 0 ? "SUCCESS_WITH_REVIEW" : "SUCCESS";
}

/**
 * Lý do hàng chờ của MỘT kết quả quy nguồn SẼ ghi (trước khi ghi). `requiresNote` cố ý `false`: đường Excel không bao giờ chọn nhóm cần giải trình mà để trống giải trình
 * (nhãn dẫn tới `OTHER` luôn kèm giải trình ≥ 10 ký tự) — ca DB `[MNR-D7]` đối chiếu số này với `demHangChoNguon` thật nên lệch là đỏ.
 */
export function lyDoHangChoCuaKetQua(k: Pick<KetQuaQuyNguon, "referrerMissing" | "otherSourceNote" | "canhBao" | "groupCode" | "signals">): LyDoHangCho[] {
  return lyDoCuaDong({
    referrerMissing: k.referrerMissing,
    otherSourceNote: k.otherSourceNote,
    canhBao: [...k.canhBao],
    group: { code: k.groupCode, requiresNote: false },
    signals: k.signals,
  });
}

export type TongKetNhap = Record<PhanLoaiDongNhap, number>;

/** Đếm theo bốn trạng thái. Bốn khoá LUÔN có mặt (0 khi không có) — màn hình không phải kiểm `undefined`. */
export function tongKetNhap(ds: readonly PhanLoaiDongNhap[]): TongKetNhap {
  const t: TongKetNhap = { SUCCESS: 0, SUCCESS_WITH_REVIEW: 0, ERROR: 0, SKIPPED: 0 };
  for (const x of ds) t[x] += 1;
  return t;
}
