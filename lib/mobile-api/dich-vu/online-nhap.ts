import { rateLimit } from "@/lib/rate-limit";

import { batNeuTatOnline, cauHinhTanSuatLoi, docLuotOnline, luuNhapTheoCauLoi, yeuCauHocSinhTuGhi } from "./online-hoc";
import type { LuuNhapDto, LuuNhapInput, NhapLuotDto, TrangThaiLuotDto } from "../online-thi/hop-dong";
import type { MaHocVienDaKiem } from "../so-huu";
import { LoiApiMobile, type NguoiGoi } from "../xac-thuc/dich-vu";

/**
 * ADAPTER REST cho nháp THEO CÂU / tiếp tục / trạng thái lượt thi ONLINE (V8.45, nối lõi E thật — xem `online-thi/hop-dong.ts`).
 * KHÔNG chứa luật của lõi: revision/CONFLICT, idempotency theo `requestId`, đồng hồ máy chủ, tự chốt, gián đoạn, tần suất 90/phút đều ở lõi E (`luot-nhap-db.ts`); file này làm phần của adapter:
 *   cờ ONLINE (404) → [ghi] chỉ học viên ở chế độ học sinh của CHÍNH em (`yeuCauHocSinhTuGhi`, 403 CHE_DO_HOC_SINH) → giới hạn tần suất của adapter (429 + Retry-After) → lõi.
 * Thứ tự cổng ở route: cờ MOBILE → cỡ thân → token → chế độ học sinh → sở hữu học viên (`kiemHocVienCuaPhuHuynh`, lượt của học viên khác ⇒ lõi trả 404) → thân/lược đồ → handler.
 *
 * ⚠️ HAI TẦNG TẦN SUẤT: (1) adapter chạy TRƯỚC lõi — mặc định 1 lần/2 giây/lượt + 60 lần/phút/phụ huynh (đề xuất A, KHÔNG phải chính sách Owner), tính cả lần GỬI LẠI cùng `requestId`;
 * (2) lõi E 90 yêu cầu/60 s/lượt (chỉ tính yêu cầu GHI MỚI, replay miễn). Gặp 429 ⇒ chờ `Retry-After` rồi gửi lại ĐÚNG `requestId`. Chỉnh tầng (1) bằng env:
 * ONLINE_NHAP_LUU_BURST_MAX / _BURST_CUA_SO_MS (theo lượt) · ONLINE_NHAP_LUU_MAX / ONLINE_NHAP_LUU_CUA_SO_MS (theo phụ huynh) · ONLINE_NHAP_DOC_MAX / ONLINE_NHAP_DOC_CUA_SO_MS (đọc, theo lượt).
 */
export const GIOI_HAN_NHAP_MAC_DINH = {
  luuMoiLuot: { max: 1, windowMs: 2_000 },
  luuMoiPhuHuynh: { max: 60, windowMs: 60_000 },
  doc: { max: 120, windowMs: 60_000 },
} as const;

function soTuEnv(ten: string, macDinh: number): number {
  const n = Number(process.env[ten]);
  return Number.isInteger(n) && n > 0 ? n : macDinh;
}
export function gioiHanNhap(loai: "luuMoiLuot" | "luuMoiPhuHuynh" | "doc"): { max: number; windowMs: number } {
  const [max, cuaSo] = loai === "luuMoiLuot" ? ["ONLINE_NHAP_LUU_BURST_MAX", "ONLINE_NHAP_LUU_BURST_CUA_SO_MS"] : loai === "luuMoiPhuHuynh" ? ["ONLINE_NHAP_LUU_MAX", "ONLINE_NHAP_LUU_CUA_SO_MS"] : ["ONLINE_NHAP_DOC_MAX", "ONLINE_NHAP_DOC_CUA_SO_MS"];
  return { max: soTuEnv(max!, GIOI_HAN_NHAP_MAC_DINH[loai].max), windowMs: soTuEnv(cuaSo!, GIOI_HAN_NHAP_MAC_DINH[loai].windowMs) };
}

async function giuTanSuat(khoa: string, g: { max: number; windowMs: number }): Promise<void> {
  const rl = await rateLimit({ key: khoa, max: g.max, windowMs: g.windowMs });
  if (!rl.success) throw new LoiApiMobile("RATE_LIMITED", 429, "Bạn thao tác quá nhanh. Vui lòng thử lại sau ít giây.", Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000)));
}

const tham = (hs: MaHocVienDaKiem, nguoi: NguoiGoi, courseId: string, lessonId: string, attemptId: string, now: Date) => ({ parentUserId: nguoi.userId, studentId: hs as string, courseId, lessonStableId: lessonId, attemptId, now });
const idHopLe = (...x: string[]) => x.every((v) => !!v && v.length <= 100);
const khongThay = () => new LoiApiMobile("NOT_FOUND", 404, "Không tìm thấy dữ liệu.");

/** `PUT …/attempts/:attemptId/draft` — lưu CÁC CÂU ĐỔI. CHỈ học viên ở chế độ học sinh của chính em. 200 kể cả khi có câu CONFLICT/AHEAD/SAI_KIEU (xem `items[i].ketQua`). */
export async function luuNhapOnline(hs: MaHocVienDaKiem, nguoi: NguoiGoi, courseId: string, lessonId: string, attemptId: string, input: LuuNhapInput): Promise<LuuNhapDto> {
  batNeuTatOnline();
  yeuCauHocSinhTuGhi(hs, nguoi); // ba mẹ (phiên thường) không ghi nháp thay con
  if (!idHopLe(courseId, lessonId, attemptId)) throw khongThay();
  await giuTanSuat(`onl-nhap:luu-lan:${nguoi.userId}:${attemptId}`, gioiHanNhap("luuMoiLuot"));
  await giuTanSuat(`onl-nhap:luu:${nguoi.userId}`, gioiHanNhap("luuMoiPhuHuynh"));
  return luuNhapTheoCauLoi(tham(hs, nguoi, courseId, lessonId, attemptId, new Date()), input, cauHinhTanSuatLoi());
}

/** `GET …/attempts/:attemptId/draft` — TIẾP TỤC sau mất mạng/đóng app: trạng thái + nháp đã ACK + đề (chỉ khi đang làm). Phụ huynh phiên thường chỉ ĐỌC. Có thể kích hoạt chốt lười (hết giờ). */
export async function docNhapOnline(hs: MaHocVienDaKiem, nguoi: NguoiGoi, courseId: string, lessonId: string, attemptId: string): Promise<NhapLuotDto> {
  batNeuTatOnline();
  if (!idHopLe(courseId, lessonId, attemptId)) throw khongThay();
  await giuTanSuat(`onl-nhap:doc:${nguoi.userId}:${attemptId}`, gioiHanNhap("doc"));
  return (await docLuotOnline(tham(hs, nguoi, courseId, lessonId, attemptId, new Date()), "day-du")) as NhapLuotDto;
}

/** `GET …/attempts/:attemptId/status` — trạng thái nhẹ (không đề/đáp án): gián đoạn, lượt thay thế, lượt đã dùng, `tuDongNop`. */
export async function trangThaiLuotOnline(hs: MaHocVienDaKiem, nguoi: NguoiGoi, courseId: string, lessonId: string, attemptId: string): Promise<TrangThaiLuotDto> {
  batNeuTatOnline();
  if (!idHopLe(courseId, lessonId, attemptId)) throw khongThay();
  await giuTanSuat(`onl-nhap:doc:${nguoi.userId}:${attemptId}`, gioiHanNhap("doc"));
  return docLuotOnline(tham(hs, nguoi, courseId, lessonId, attemptId, new Date()), "trang-thai");
}
