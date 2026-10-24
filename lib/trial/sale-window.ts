// lib/trial/sale-window.ts — phạm vi ngày của bảng trải nghiệm trên site Sale.
//
// Vì sao có file này (rà luồng Trial vs BA, 03/09/2026):
//
// `/sale/trial` trước đây đóng cứng cửa sổ **hôm nay → +21 ngày**, không có bộ lọc
// nào. Mà giáo viên chỉ chấm phiếu **sau** khi buổi diễn ra ⇒ sang hôm sau buổi rơi
// khỏi bảng, mang theo luôn nút "Xem / Xuất PDF". Cộng với việc hệ thống không đẩy
// tin nào cho Sale lúc phiếu được chấm, kết quả thực tế là **phiếu chấm xong không
// ai biết đường đi lấy**. Đây là nửa còn lại của cùng một lỗ (nửa kia:
// `lib/_handlers/trial-eval-notif.ts`).
//
// THUẦN (không DB, không `server-only`) để test bằng vitest và để trang chỉ còn việc
// đọc `searchParams` rồi truyền xuống.
import { vnDateOnly } from "@/lib/time/vn";

/** Ba phạm vi in trên thanh chip. Giá trị đi thẳng vào URL nên giữ dạng kebab. */
export type PhamViTrial = "sap-toi" | "da-qua" | "tat-ca";

export const PHAM_VI_MAC_DINH: PhamViTrial = "sap-toi";

/** Số ngày mỗi phạm vi nhìn về sau / nhìn tới. Chặn trên để không quét cả bảng. */
const NGAY_TOI = 21;
const NGAY_LUI = 30;
const NGAY_LUI_TAT_CA = 90;

export const PHAM_VI: ReadonlyArray<{
  value: PhamViTrial;
  nhan: string;
  moTa: string;
}> = [
  {
    value: "sap-toi",
    nhan: "Sắp tới",
    moTa: `Buổi trải nghiệm từ hôm nay tới ${NGAY_TOI} ngày tới.`,
  },
  {
    value: "da-qua",
    nhan: "Đã diễn ra",
    moTa: `Buổi trong ${NGAY_LUI} ngày qua — nơi có phiếu đánh giá của giáo viên.`,
  },
  {
    value: "tat-ca",
    nhan: "Tất cả",
    moTa: `Từ ${NGAY_LUI_TAT_CA} ngày trước tới ${NGAY_TOI} ngày tới.`,
  },
];

export function laPhamVi(v: unknown): v is PhamViTrial {
  return PHAM_VI.some((p) => p.value === v);
}

/** Đọc `searchParams.pham_vi`; giá trị lạ / thiếu → mặc định (không ném lỗi). */
export function docPhamVi(v: unknown): PhamViTrial {
  return laPhamVi(v) ? v : PHAM_VI_MAC_DINH;
}

export function moTaPhamVi(p: PhamViTrial): string {
  return PHAM_VI.find((x) => x.value === p)?.moTa ?? "";
}

/**
 * Cửa sổ **nửa mở** `[tu, den)` để lọc `TrialClassSession.date`.
 *
 * `date` là `@db.Date` ⇒ nửa đêm **UTC** của ngày VN. Vì vậy mốc phải dựng bằng
 * `vnDateOnly`, KHÔNG phải `setUTCHours(0,0,0,0)` như bản cũ: từ 00:00 tới 07:00 giờ
 * VN thì ngày UTC còn là hôm qua, nên bảng "Sắp tới" mở lúc sáng sớm sẽ kéo thêm
 * buổi của hôm trước — đúng loại lệch một ngày mà `lib/time/vn.ts` sinh ra để chặn.
 *
 * "Đã diễn ra" và "Tất cả" đều lấy **hết ngày hôm nay** (chặn trên = ngày mai): buổi
 * dạy sáng nay, chấm phiếu chiều nay, phải thấy được ngay trong hôm nay.
 */
export function cuaSoTrial(
  phamVi: PhamViTrial,
  now: Date = new Date(),
): { tu: Date; den: Date } {
  const homNay = vnDateOnly(now);
  // Cộng ngày TRÊN CHÍNH mốc nửa đêm UTC, không mượn `vnAddDays`: hàm đó nhận/trả
  // thời điểm theo đồng hồ VN, đưa mốc `@db.Date` vào là phải đi vòng hai lần đổi
  // múi giờ mới về chỗ cũ — đúng nhưng không ai đọc ra, và sửa nhầm một lần là lệch
  // một ngày. Ở đây mọi mốc đều là nửa đêm UTC nên cộng ngày là phép cộng thuần.
  const congNgay = (n: number) =>
    new Date(homNay.getTime() + n * 24 * 60 * 60 * 1000);
  switch (phamVi) {
    case "da-qua":
      return { tu: congNgay(-NGAY_LUI), den: congNgay(1) };
    case "tat-ca":
      return { tu: congNgay(-NGAY_LUI_TAT_CA), den: congNgay(NGAY_TOI) };
    default:
      return { tu: homNay, den: congNgay(NGAY_TOI) };
  }
}
