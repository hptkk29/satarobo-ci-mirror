// lib/payroll/roster-guard.ts — CỔNG: sĩ số nào được phép vào công thức lương.
//
// THUẦN — không `@/lib/db`, không `next/*`, không `server-only`. Test được mà không cần Postgres.
//
// ── Luật (chốt chủ dự án 07/09/2026) ────────────────────────────────────────────────────
//   Cột sĩ số dùng để TÍNH TIỀN chỉ được đọc dòng có `rosterSource = SNAPSHOT` thật.
//   Số backfill suy đoán KHÔNG được vào công thức lương, dù `rosterSource` có ghi rõ tầng.
//
// ── Vì sao ép bằng MÃ chứ không bằng quy ước ────────────────────────────────────────────
// Buổi cũ đã trả lương xong rồi, không ai tính lại; backfill chỉ phục vụ báo cáo và đối chiếu.
// Để số suy đoán nằm chung cột với số thật, phân biệt bằng một enum, thì sáu tháng nữa sẽ có người
// viết truy vấn quên lọc — đúng kiểu lỗi cả tuần này đang dọn:
//   · bút toán `Payment` mang `ADJUSTED` tồn tại nhưng KHÔNG chỗ nào cộng ⇒ "điều chỉnh" không đổi
//     một đồng nào;
//   · `Holiday` toàn hệ thống tàng hình với người cấp cơ sở vì một dòng thiếu trong danh sách.
// Cả hai đều là "dữ liệu có thật, không ai đọc đúng". Một enum không tự bảo vệ mình được.
//
// ── Vì sao TỪ CHỐI chứ không BỎ QUA ─────────────────────────────────────────────────────
// Bỏ qua dòng thiếu snapshot là lặng lẽ tính người đó thiếu tiền — và không ai biết, vì bảng vẫn
// ra một con số trông hợp lệ. Ném lỗi thì đường tính dừng lại và có người phải xử lý. Với tiền
// lương, dừng lại ồn ào luôn rẻ hơn chạy tiếp im lặng.

/** Đúng hình dạng ba cột snapshot trên `ClassSession`, rút gọn còn phần cổng này cần. */
export type SiSoBuoi = {
  /** Để câu lỗi chỉ đúng buổi nào — không có id thì người đọc lỗi không biết đi sửa ở đâu. */
  sessionId: string;
  rosterSize: number | null;
  /** `null` = chưa chạy backfill; các giá trị khác xem enum `ClassRosterSource`. */
  rosterSource: string | null;
};

export type LyDoLoai =
  /** Chưa có số nào: buổi chưa hoàn tất, hoặc chưa chạy backfill. */
  | "CHUA_CO_SI_SO"
  /** Có số nhưng là số SUY ĐOÁN khi backfill (FROM_ATTENDANCE / FROM_ENROLLMENT / UNKNOWN). */
  | "SI_SO_SUY_DOAN";

export type DongBiLoai = { sessionId: string; lyDo: LyDoLoai; rosterSource: string | null };

const NHAN: Record<LyDoLoai, string> = {
  CHUA_CO_SI_SO: "chưa có sĩ số",
  SI_SO_SUY_DOAN: "sĩ số là số suy đoán khi backfill, không phải số đo lúc dạy",
};

/**
 * Lỗi riêng để chỗ gọi bắt được và hiện danh sách buổi cần xử lý, thay vì nuốt chung với lỗi khác.
 */
export class SiSoKhongDungDeTinhTien extends Error {
  readonly dong: DongBiLoai[];

  constructor(dong: DongBiLoai[]) {
    const dau = dong
      .slice(0, 5)
      .map((d) => `${d.sessionId} (${NHAN[d.lyDo]})`)
      .join(", ");
    const con = dong.length > 5 ? `, và ${dong.length - 5} buổi nữa` : "";
    super(
      `Không tính được lương: ${dong.length} buổi không có sĩ số đo lúc dạy — ${dau}${con}. ` +
        "Chỉ buổi có sĩ số chốt tại thời điểm hoàn tất buổi mới được đưa vào công thức lương.",
    );
    this.name = "SiSoKhongDungDeTinhTien";
    this.dong = dong;
  }
}

/** Dòng có dùng được để tính tiền không — thuần, không ném, để màn "Cần xử lý" đếm được. */
export function loaiVi(buoi: SiSoBuoi): LyDoLoai | null {
  if (buoi.rosterSource !== "SNAPSHOT") {
    // Thứ tự hai nhánh có chủ đích: dòng backfill LUÔN có `rosterSource`, kể cả khi `rosterSize`
    // là null (tầng UNKNOWN). Báo "suy đoán" đúng hơn báo "chưa có số" — người đọc biết là đã xét
    // rồi chứ không phải quên chạy backfill.
    return buoi.rosterSource == null ? "CHUA_CO_SI_SO" : "SI_SO_SUY_DOAN";
  }
  // `SNAPSHOT` mà thiếu số là dữ liệu tự mâu thuẫn — không tin, và không đoán hộ.
  if (buoi.rosterSize == null || buoi.rosterSize < 0) return "CHUA_CO_SI_SO";
  return null;
}

/** Lọc ra mọi dòng KHÔNG dùng được. Gọi trước khi tính, để báo một lượt thay vì chết ở dòng đầu. */
export function locDongKhongDung(buoi: readonly SiSoBuoi[]): DongBiLoai[] {
  const ra: DongBiLoai[] = [];
  for (const b of buoi) {
    const lyDo = loaiVi(b);
    if (lyDo) ra.push({ sessionId: b.sessionId, lyDo, rosterSource: b.rosterSource });
  }
  return ra;
}

/**
 * Sĩ số dùng được để tính tiền, hoặc NÉM.
 *
 * Đây là hàm DUY NHẤT mà tầng quy đổi tiền được phép dùng để lấy sĩ số. Đọc thẳng
 * `ClassSession.rosterSize` ở đường tính tiền là đi vòng qua cổng này.
 */
export function siSoDeTinhTien(buoi: SiSoBuoi): number {
  const lyDo = loaiVi(buoi);
  if (lyDo) throw new SiSoKhongDungDeTinhTien([{ sessionId: buoi.sessionId, lyDo, rosterSource: buoi.rosterSource }]);
  return buoi.rosterSize as number;
}

/**
 * Chặn cả lô trước khi tính. Ném MỘT lỗi liệt kê mọi buổi hỏng — người xử lý cần thấy hết danh
 * sách trong một lần, không phải sửa một buổi rồi chạy lại để lộ buổi tiếp theo.
 */
export function chanLoTruocKhiTinh(buoi: readonly SiSoBuoi[]): void {
  const hong = locDongKhongDung(buoi);
  if (hong.length > 0) throw new SiSoKhongDungDeTinhTien(hong);
}
