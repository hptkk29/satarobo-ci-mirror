// lib/hoc-bu/cua-so-diem-danh.ts — CỬA SỔ THỜI GIAN điểm danh buổi dạy bù (T02, 07/10/2026). THUẦN.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO (HB-03 — HIGH): `diemDanhBu` không đọc ngày giờ của case, nên một lượt bấm TRƯỚC giờ dạy:
//   · tiêu lượt bù của học viên (và cho dòng COMPLETED) cho một buổi chưa diễn ra;
//   · chốt case → sinh công dạy cho giáo viên trước khi họ dạy.
// Tiền và lượt đều đi theo cú bấm đó, nên cổng nằm ở MÁY CHỦ (luật cứng: giao diện chỉ phản chiếu).
//
// QUYẾT ĐỊNH 07/10/2026 (mục 6 của bản duyệt):
//   · MỞ    15 phút trước giờ bắt đầu của case (giờ VN). Không ai điểm danh được trước đó — kể cả quản lý,
//           kể cả khi GHI ĐÈ: ghi đè chỉ để chữa muộn, không để điểm danh sớm.
//   · GIÁO VIÊN   đến hết 23:59 CHÍNH NGÀY của case.
//   · QUẢN LÝ / giáo vụ   trong 3 ngày kể từ ngày case (hết ngày D+3).
//   · QUÁ 3 NGÀY  phải GHI ĐÈ: quyền riêng + lý do bắt buộc + audit (người gọi lo quyền và audit;
//                 file này chỉ nói "cho qua nếu đã ghi đè").
//   · Kỳ công đã chốt ⇒ không sửa trực tiếp: chờ T12 (công dạy chưa nằm trong bản chốt kỳ nên chưa có gì để tra).
// ─────────────────────────────────────────────────────────────────────────────
import { vnDateAt } from "@/lib/time/vn";

export const MO_SOM_PHUT = 15;
/** Số ngày SAU ngày case mà quản lý còn điểm danh được không cần ghi đè. */
export const QUAN_LY_SO_NGAY = 3;

export type VaiDiemDanhBu = "GIAO_VIEN" | "QUAN_LY";
export type MaCuaSo = "CHUA_MO" | "QUA_HAN_GV" | "QUA_HAN_QUAN_LY";
export type KetQuaCuaSo = { ok: true; dungGhiDe: boolean } | { ok: false; ma: MaCuaSo; thongBao: string };

const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/**
 * @param ngay      `MakeupCase.date` — cột `@db.Date`: nửa đêm UTC của NGÀY VN (không phải một thời điểm).
 * @param startTime `MakeupCase.startTime` "HH:mm" giờ VN.
 * @param ghiDe     Người gọi ĐÃ kiểm quyền ghi đè + có lý do. Chỉ cứu ca QUÁ HẠN quản lý.
 */
export function cuaSoDiemDanhBu(p: {
  now: Date;
  ngay: Date;
  startTime: string;
  vai: VaiDiemDanhBu;
  ghiDe: boolean;
}): KetQuaCuaSo {
  const [y, m, d] = p.ngay.toISOString().slice(0, 10).split("-").map(Number);
  const [sh, sm] = p.startTime.split(":").map(Number);
  const gioMo = vnDateAt(y!, m! - 1, d!, sh!, sm!).getTime() - MO_SOM_PHUT * 60_000;
  const hetNgayGv = vnDateAt(y!, m! - 1, d! + 1).getTime();
  const hetHanQuanLy = vnDateAt(y!, m! - 1, d! + QUAN_LY_SO_NGAY + 1).getTime();
  const t = p.now.getTime();

  if (t < gioMo) {
    const phutMo = (sh! * 60 + sm! - MO_SOM_PHUT + 24 * 60) % (24 * 60);
    return {
      ok: false,
      ma: "CHUA_MO",
      thongBao: `Chưa tới giờ điểm danh — mở lúc ${hhmm(phutMo)}${sh! * 60 + sm! < MO_SOM_PHUT ? " hôm trước" : ""} (${MO_SOM_PHUT} phút trước giờ dạy ${p.startTime}).`,
    };
  }
  if (p.vai === "GIAO_VIEN") {
    if (t >= hetNgayGv) {
      return {
        ok: false,
        ma: "QUA_HAN_GV",
        thongBao: "Đã quá hạn điểm danh (hết 23:59 ngày dạy bù) — nhờ quản lý cơ sở điểm danh giúp.",
      };
    }
    return { ok: true, dungGhiDe: false };
  }
  if (t >= hetHanQuanLy) {
    if (p.ghiDe) return { ok: true, dungGhiDe: true };
    return {
      ok: false,
      ma: "QUA_HAN_QUAN_LY",
      thongBao: `Đã quá ${QUAN_LY_SO_NGAY} ngày kể từ ngày dạy bù — cần quyền ghi đè kèm lý do.`,
    };
  }
  return { ok: true, dungGhiDe: false };
}
