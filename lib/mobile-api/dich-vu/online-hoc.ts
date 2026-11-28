import { db } from "@/lib/db";
import { batDauLamBai, docKetQuaCacLuot, nopBai } from "@/lib/elearning-online/danh-gia-db";
import { docKhoaOnlineCuaHocVien, docMucLucKhoaCuaHocVien, ghiTienDoBai, type KhoaCuaHocVien } from "@/lib/elearning-online/hoc-tap";
import { ghiTienDoRequest, nopBaiRequest } from "@/lib/elearning-online/hoc-vien-dto";
import { httpTheoMaLoi } from "@/lib/elearning-online/hoc-vien-dto";
import { docChungNhanCuaHocVien } from "@/lib/elearning-online/chung-nhan";
import { hienThiMaChungNhan } from "@/lib/elearning-online/ma-chung-nhan";
import { banDuocLucNay, docChiTietCongKhai, docKhoaCongKhai, locCongKhaiSchema } from "@/lib/elearning-online/danh-muc-cong-khai";
import { quyetDinhCap, type QuyenHienCo } from "@/lib/elearning-online/quyen-hoc";
import type { KyHan } from "@/lib/elearning-online/thoi-han";
import { docNoiDungBaiChoHocVien } from "@/lib/elearning-online/noi-dung-hoc-vien";
import { capVePhatHocVien, dtoVePhat } from "@/lib/elearning-online/video-phat";
import type { SnapshotDe } from "@/lib/elearning-online/cham-diem";
import { docLuotConLai } from "@/lib/elearning-online/gian-doan-db";
import { docTrangThaiLuot, luuNhap, TAN_SUAT_NHAP, type CauHinhTanSuat } from "@/lib/elearning-online/luot-nhap-db";
import { kiemDapAnNhap } from "@/lib/elearning-online/nhap-dap-an";
import { isElearningOnlineEnabled } from "@/lib/flags";
import { z } from "zod";

import type { KetQuaTraCuuKhoa } from "./mua-khoa";
import type { KetQuaCauDto, LuuNhapDto, LuuNhapInput, NhapLuotDto, TrangThaiLuot, TrangThaiLuotDto } from "../online-thi/hop-dong";
import type { MaHocVienDaKiem } from "../so-huu";
import { LoiApiMobile, type NguoiGoi } from "../xac-thuc/dich-vu";

/**
 * V8.9 — ONLINE P0 phía học viên/phụ huynh: lớp HTTP MỎNG trên hàm LÕI của E-learning (`lib/elearning-online/*`). KHÔNG có engine quyền học thứ hai, KHÔNG chép luật:
 * mọi quyết định (sở hữu, quyền, hạn, thu hồi, bài ẩn, thứ tự mở, không xem lại) do `kiemTraTruyCapChoPhuHuynh` / `docMucLuc…` / `docNoiDungBai…` của E quyết; file này chỉ
 *   · đọc `parentUserId` từ PHIÊN (không từ client) và truyền `studentId` ĐÃ qua `kiemHocVienCuaPhuHuynh` của app (sở hữu kiểm HAI lần: app + lõi E);
 *   · dịch mã lỗi của E → HTTP bằng bảng DUY NHẤT của E (`HTTP_THEO_MA_LOI`); mã lạ ⇒ 500 (không đoán);
 *   · cờ `ELEARNING_ONLINE_ENABLED` tắt ⇒ 404 (như chưa có API).
 * Thu hồi ⇒ khoá BIẾN khỏi danh sách (E). Hết hạn ⇒ khoá vẫn hiện (trangThaiQuyen HET_HAN, để gia hạn) và CHỈ XEM được lịch sử (D23): mục lục trả `hetHan:true` (không bài nào mở), kết quả các lượt vẫn đọc được;
 * mở bài, vé video, ghi tiến độ, bắt đầu/nộp bài vẫn 403 HET_HAN. Bài đã hoàn thành mà khoá cấm xem lại ⇒ mở bài/làm bài 403 DA_HOAN_THANH_KHONG_XEM_LAI; riêng kết quả các lượt vẫn đọc được ở mức CHỈ ĐIỂM (#1300, lõi E quyết).
 * Mọi phản hồi `Cache-Control: no-store` (quyền đổi theo thời gian). Không trả khoá media / đề / đáp án / `assessmentId` (DTO của E đã loại).
 */
const khongThay = () => new LoiApiMobile("NOT_FOUND", 404, "Không tìm thấy dữ liệu.");

/** Bảng HTTP của lõi E cho tệp ngoài (chỉ `online-hoc.ts` được import lõi Online — `[MIEN-A-01]`). Mã lạ ⇒ 500. */
export function httpMaLoiLoiOnline(ma: string): number {
  return httpTheoMaLoi(ma);
}

export function batNeuTatOnline(): void {
  if (!isElearningOnlineEnabled()) throw khongThay();
}

/**
 * Dịch kết quả `{ok:false, ma}` của lõi E thành lỗi HTTP (trạng thái theo bảng của E). `SAI_PHU_HUYNH` ⇒ cùng 404 «không tìm thấy».
 * V8.45: `KHONG_CO_QUYEN_HOC` (đua thu hồi — chưa có trong bảng của E) ⇒ 403; `VUOT_TAN_SUAT` ⇒ 429 + `Retry-After = retryAfterSec`; `HET_GIO` mang `chiTiet.daChot`.
 */
export function loiTuMa(ma: string, extra: { retryAfterSec?: number; daChot?: boolean } = {}): LoiApiMobile {
  if (ma === "SAI_PHU_HUYNH") return khongThay();
  const status = ma === "KHONG_CO_QUYEN_HOC" ? 403 : httpTheoMaLoi(ma);
  if (status === 500) return new LoiApiMobile("SERVER", 500, "Lỗi tích hợp Online (mã chưa được ánh xạ).");
  const e = new LoiApiMobile(ma as never, status, THONG_BAO[ma] ?? "Không mở được nội dung này.", ma === "VUOT_TAN_SUAT" ? Math.max(1, extra.retryAfterSec ?? 1) : undefined);
  if (extra.daChot !== undefined) e.chiTiet = { daChot: extra.daChot };
  return e;
}

/** Lỗi lược đồ yêu cầu lưu nháp (422 `YEU_CAU_KHONG_HOP_LE`, cùng mã với lõi E). */
const loiYeuCau = (thongBao: string): LoiApiMobile => new LoiApiMobile("YEU_CAU_KHONG_HOP_LE" as never, 422, thongBao);

const THONG_BAO: Record<string, string> = {
  LOAI_BAI_KHONG_GHI_TRUC_TIEP: "Bài này không ghi tiến độ trực tiếp.",
  THIEU_DU_LIEU: "Thiếu dữ liệu tiến độ.",
  BAI_KHONG_PHAI_DANH_GIA: "Bài này không phải bài kiểm tra.",
  CHUA_GAN_DE: "Bài chưa được gắn đề.",
  DE_KHONG_HOAT_DONG: "Đề chưa mở cho học viên.",
  DE_RONG: "Đề chưa có câu hỏi.",
  HET_GIO: "Đã hết giờ làm bài.",
  LUOT_DA_CHOT: "Lượt làm bài đã được chốt — không lưu thêm được.",
  LUOT_BI_GIAN_DOAN: "Lượt làm bài bị gián đoạn do quyền học bị thu hồi. Bài làm đã lưu được giữ lại.",
  CAU_KHONG_THUOC_LUOT: "Câu hỏi không thuộc lượt làm bài này.",
  DAP_AN_KHONG_HOP_LE: "Đáp án không đúng định dạng của câu hỏi.",
  YEU_CAU_KHONG_HOP_LE: "Yêu cầu lưu nháp không hợp lệ.",
  VUOT_TAN_SUAT: "Gửi nháp quá nhanh. Vui lòng thử lại sau ít giây.",
  KHONG_CO_QUYEN_HOC: "Học viên không còn quyền học khoá này.",
  LUOT_KHONG_TON_TAI: "Không tìm thấy lượt làm bài.",
  KHONG_CO_QUYEN: "Học viên chưa có quyền học khoá này.",
  DA_THU_HOI: "Quyền học khoá này đã bị thu hồi. Vui lòng liên hệ trung tâm.",
  HET_HAN: "Quyền học khoá này đã hết hạn. Có thể gia hạn để học tiếp.",
  KHOA_CHUA_PHAT_HANH: "Khoá học chưa sẵn sàng.",
  BAI_KHONG_TON_TAI: "Không tìm thấy bài học.",
  BAI_DA_AN: "Không tìm thấy bài học.",
  BAI_CHUA_MO: "Bài học này chưa mở. Hãy hoàn thành bài trước.",
  DA_HOAN_THANH_KHONG_XEM_LAI: "Bài học này đã hoàn thành và không xem lại.",
  CAI_DAT_KHONG_HOP_LE: "Khoá học đang được cấu hình lại. Vui lòng thử lại sau.",
  BAI_KHONG_PHAI_VIDEO: "Bài này không phải video.",
  CHUA_CO_VIDEO: "Bài này chưa có video.",
  KHOA_VIDEO_KHONG_HOP_LE: "Video chưa sẵn sàng.",
  KHO_VIDEO_CHUA_CAU_HINH: "Video chưa sẵn sàng. Vui lòng thử lại sau.",
};

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export type KhoaOnlineDto = {
  courseId: string;
  ma: string;
  ten: string;
  slug: string;
  anhBiaKhoa: string | null;
  trangThaiQuyen: "CON_HAN" | "HET_HAN";
  hetHanLuc: string | null;
  conLaiNgay: number | null;
  tienDo: KhoaCuaHocVien["tienDo"];
  choPhepGiaHan: boolean;
  /** Số phiên bản nội dung ĐANG CHẠY của khoá (để app khoá cache theo phiên bản); null khi khoá chưa có bản phát hành. */
  soBan: number | null;
  /** Ngày học viên vào khoá lần mới nhất (`OnlEntitlement.startsAt`: cấp đầu hoặc MỞ LẠI sau hết hạn/thu hồi; gia hạn khi còn hạn không đổi). */
  batDauLuc: string | null;
};

function dto(k: KhoaCuaHocVien, pl?: { soBan: number | null; batDauLuc: Date | null }): KhoaOnlineDto {
  return {
    courseId: k.courseId,
    ma: k.code,
    ten: k.name,
    slug: k.slug,
    anhBiaKhoa: k.coverImageKey, // KHOÁ lưu trữ, không phải URL: ký/hiển thị do hạ tầng ảnh (chưa có kho công khai) — app chưa dùng
    trangThaiQuyen: k.trangThai === "HET_HAN" ? "HET_HAN" : "CON_HAN",
    hetHanLuc: iso(k.hetHan),
    conLaiNgay: k.conLaiNgay,
    tienDo: k.tienDo,
    choPhepGiaHan: k.choPhepGiaHan,
    soBan: pl?.soBan ?? null,
    batDauLuc: iso(pl?.batDauLuc ?? null),
  };
}

/** Bổ sung CHỈ ĐỌC cho danh sách: số bản đang chạy + ngày vào khoá. Hai truy vấn gộp cho cả danh sách; không đoán luật nào (không phải engine quyền học). */
async function phuLucKhoa(hs: MaHocVienDaKiem, ds: KhoaCuaHocVien[]): Promise<Map<string, { soBan: number | null; batDauLuc: Date | null }>> {
  const kq = new Map<string, { soBan: number | null; batDauLuc: Date | null }>();
  if (ds.length === 0) return kq;
  const ids = ds.map((k) => k.courseId);
  const [khoa, quyen] = await Promise.all([
    db.onlCourse.findMany({ where: { id: { in: ids } }, select: { id: true, publishedVersionId: true } }),
    db.onlEntitlement.findMany({ where: { studentId: hs, courseId: { in: ids } }, select: { courseId: true, startsAt: true } }),
  ]);
  const vIds = khoa.map((k) => k.publishedVersionId).filter((x): x is string => !!x);
  const ban = new Map((await db.onlCourseVersion.findMany({ where: { id: { in: vIds } }, select: { id: true, number: true } })).map((v) => [v.id, v.number]));
  const bd = new Map(quyen.map((q) => [q.courseId, q.startsAt]));
  for (const k of khoa) kq.set(k.id, { soBan: k.publishedVersionId ? (ban.get(k.publishedVersionId) ?? null) : null, batDauLuc: bd.get(k.id) ?? null });
  return kq;
}

async function docKhoa(hs: MaHocVienDaKiem, nguoi: NguoiGoi, now: Date): Promise<KhoaCuaHocVien[]> {
  const ds = await docKhoaOnlineCuaHocVien(db as never, { parentUserId: nguoi.userId, studentId: hs, now });
  if (ds === null) throw khongThay(); // lõi E: sai phụ huynh ⇒ null
  return ds;
}

/** (2) Danh sách khoá Online của con (thu hồi ⇒ biến; hết hạn ⇒ vẫn hiện, trangThaiQuyen HET_HAN). */
export async function danhSachKhoaOnline(hs: MaHocVienDaKiem, nguoi: NguoiGoi, now = new Date()): Promise<{ muc: KhoaOnlineDto[]; capNhatLuc: string }> {
  batNeuTatOnline();
  const ds = await docKhoa(hs, nguoi, now);
  const pl = await phuLucKhoa(hs, ds);
  return { muc: ds.map((k) => dto(k, pl.get(k.courseId))), capNhatLuc: now.toISOString() };
}

/** (3) Chi tiết MỘT khoá của con: không có quyền / thu hồi ⇒ 404 (cùng nghĩa «không có trong danh sách»). */
export async function chiTietKhoaOnline(hs: MaHocVienDaKiem, nguoi: NguoiGoi, courseId: string, now = new Date()): Promise<KhoaOnlineDto> {
  batNeuTatOnline();
  if (!courseId || courseId.length > 100) throw khongThay();
  const k = (await docKhoa(hs, nguoi, now)).find((x) => x.courseId === courseId);
  if (!k) throw khongThay();
  return dto(k, (await phuLucKhoa(hs, [k])).get(k.courseId));
}

export type MucLucDto = { soBan: number | null; hetHan: boolean; tienDo: unknown; bai: Array<{ lessonId: string; tieuDe: string; loai: string; chuong: string; batBuoc: boolean; thoiLuongGiay: number | null; trangThai: string; phanTram: number; mo: boolean; lyDoChuaMo: unknown }> };

/**
 * (4) Mục lục: tiến độ từng bài + bài nào mở được. KHÔNG có nội dung bài. Thu hồi/không quyền ⇒ lỗi theo bảng của E.
 * D23: quyền HẾT HẠN ⇒ KHÔNG còn là lỗi — trả mục lục chỉ-đọc với `hetHan:true`, mọi bài `mo:false`, `lyDoChuaMo:"HET_HAN"`. App dựa vào `hetHan` để mời gia hạn (không còn 403 để suy).
 */
export async function mucLucKhoaOnline(hs: MaHocVienDaKiem, nguoi: NguoiGoi, courseId: string, now = new Date()): Promise<MucLucDto> {
  batNeuTatOnline();
  if (!courseId || courseId.length > 100) throw khongThay();
  const r = await docMucLucKhoaCuaHocVien(db as never, { parentUserId: nguoi.userId, studentId: hs, courseId, now });
  if (!r.ok) throw loiTuMa(r.ma);
  const soBan = (await phuLucKhoa(hs, [{ courseId } as KhoaCuaHocVien])).get(courseId)?.soBan ?? null;
  return {
    soBan,
    hetHan: r.hetHan,
    tienDo: r.tienDo,
    bai: r.bai.map((b) => ({
      lessonId: b.stableId,
      tieuDe: b.title,
      loai: b.kind,
      chuong: b.chapterTitle,
      batBuoc: b.required,
      thoiLuongGiay: b.durationSec,
      trangThai: b.trangThai,
      phanTram: b.percent,
      mo: b.mo.mo,
      lyDoChuaMo: b.mo.mo ? null : b.mo.lyDo,
    })),
  };
}

export type BaiOnlineDto = { soBan: number; bai: Record<string, unknown> };

/** (5) Mở MỘT bài: qua CỔNG DUY NHẤT của E (sở hữu + quyền + hạn + thu hồi + bài ẩn + thứ tự mở + không xem lại). READ ⇒ thân bài; VIDEO ⇒ `coVideo` (không khoá media); QUIZ/… ⇒ `coDe` (không đề). */
export async function moBaiOnline(hs: MaHocVienDaKiem, nguoi: NguoiGoi, courseId: string, lessonId: string, now = new Date()): Promise<BaiOnlineDto> {
  batNeuTatOnline();
  if (!courseId || courseId.length > 100 || !lessonId || lessonId.length > 100) throw khongThay();
  const r = await docNoiDungBaiChoHocVien(db as never, { parentUserId: nguoi.userId, studentId: hs, courseId, lessonStableId: lessonId, now });
  if (!r.ok) throw loiTuMa(r.ma);
  return { soBan: r.soBan, bai: r.bai as unknown as Record<string, unknown> };
}

export type QuyenOnlineDto = { muc: Array<{ courseId: string; trangThaiQuyen: "CON_HAN" | "HET_HAN"; hetHanLuc: string | null; conLaiNgay: number | null; choPhepGiaHan: boolean }>; capNhatLuc: string };

/** (6) LÀM MỚI quyền học: trạng thái hiện hành từng khoá (nhẹ, không tiến độ) để app cập nhật sau khi mua/gia hạn/thu hồi. Thu hồi ⇒ khoá biến khỏi danh sách. */
export async function lamMoiQuyenOnline(hs: MaHocVienDaKiem, nguoi: NguoiGoi, now = new Date()): Promise<QuyenOnlineDto> {
  batNeuTatOnline();
  const ds = await docKhoa(hs, nguoi, now);
  return { muc: ds.map((k) => ({ courseId: k.courseId, trangThaiQuyen: k.trangThai === "HET_HAN" ? ("HET_HAN" as const) : ("CON_HAN" as const), hetHanLuc: iso(k.hetHan), conLaiNgay: k.conLaiNgay, choPhepGiaHan: k.choPhepGiaHan })), capNhatLuc: now.toISOString() };
}

export type KhuOnlineDto = { trangThai: "CHUA_MO" | "CO_QUYEN" | "HET_HAN" | "CHUA_CO_QUYEN"; soKhoaConHan: number; soKhoaHetHan: number };

/** (1) Phần `online` của `learning/areas`: cờ tắt ⇒ CHUA_MO (như cũ). Bật ⇒ suy từ chính danh sách khoá của lõi E. */
export async function khuOnlineChoHocVien(hs: MaHocVienDaKiem, nguoi: NguoiGoi, now = new Date()): Promise<KhuOnlineDto> {
  if (!isElearningOnlineEnabled()) return { trangThai: "CHUA_MO", soKhoaConHan: 0, soKhoaHetHan: 0 };
  const ds = await docKhoa(hs, nguoi, now);
  const con = ds.filter((k) => k.trangThai !== "HET_HAN").length;
  const het = ds.length - con;
  return { trangThai: con > 0 ? "CO_QUYEN" : het > 0 ? "HET_HAN" : "CHUA_CO_QUYEN", soKhoaConHan: con, soKhoaHetHan: het };
}

// ───────────────────────── V8.12 — GHI TIẾN ĐỘ + LÀM BÀI (hàm lõi của E, qua cổng quyền của E) ─────────────────────────
/** Thân yêu cầu: lược đồ strict của E trừ các khoá do MÁY CHỦ quyết (`studentId/courseId/lessonStableId` lấy từ ĐƯỜNG DẪN đã kiểm; `parentUserId` từ PHIÊN). Trường lạ ⇒ 400. */
export const tienDoBodySchema = ghiTienDoRequest.omit({ studentId: true, courseId: true, lessonStableId: true });
export type TienDoBody = z.infer<typeof tienDoBodySchema>;
export const batDauBodySchema = z.object({}).strict();
export const nopBodySchema = nopBaiRequest.omit({ studentId: true, courseId: true, lessonStableId: true, attemptId: true }).extend({ traLoi: z.record(z.string().max(100), z.unknown()).refine((o) => Object.keys(o).length <= 300, "Quá nhiều câu trả lời.") });
export type NopBody = z.infer<typeof nopBodySchema>;

const khoaId = (x: string): boolean => !!x && x.length <= 100;

/**
 * V8.44 (Owner V8.46) — THAO TÁC GHI HỌC TẬP ONLINE (tiến độ · bắt đầu/nộp bài · lưu nháp) CHỈ do HỌC VIÊN làm, tức phiên ở CHẾ ĐỘ HỌC SINH của CHÍNH em đó.
 * Phụ huynh dùng phiên thường chỉ XEM tiến độ/kết quả/bài học; KHÔNG được nộp bài, đánh dấu hoàn thành hay tiêu thụ lượt thi thay học viên (đã xảy ra trên UAT: ba mẹ bấm «Bắt đầu làm bài» tốn 1/3 lượt).
 * Ép Ở MÁY CHỦ (không dựa việc app ẩn nút). `hocSinhId` lấy từ PHIÊN (cột `MobileSession`), không từ client. Phiên Student Mode của em KHÁC ⇒ cũng bị chặn (ở cổng chế độ học sinh trước đó, và ở đây).
 * Không mở rộng quyền ghi cho phụ huynh. Gọi ĐẦU TIÊN, trước mọi truy vấn/phép ghi.
 */
export function yeuCauHocSinhTuGhi(hs: MaHocVienDaKiem, nguoi: NguoiGoi): void {
  if (nguoi.hocSinhId !== null && nguoi.hocSinhId === (hs as string)) return;
  throw Object.assign(new LoiApiMobile("FORBIDDEN", 403, "Chỉ học viên (ở chế độ học sinh) mới làm bài hoặc ghi tiến độ. Ba mẹ xem được tiến độ và kết quả."), { chiTiet: { yeuCau: "CHE_DO_HOC_SINH" } });
}

/** `POST …/lessons/:lid/progress` — VIDEO: `percent` (chỉ tăng, ngưỡng do máy chủ); READ: `daDoc:true`. Cổng quyền của E chạy TRƯỚC khi ghi (thu hồi/hết hạn ⇒ 403). Idempotent về bản chất: % chỉ tăng, COMPLETED không hạ. */
export async function ghiTienDoOnline(hs: MaHocVienDaKiem, nguoi: NguoiGoi, courseId: string, lessonId: string, body: TienDoBody, now = new Date()) {
  batNeuTatOnline();
  yeuCauHocSinhTuGhi(hs, nguoi);
  if (!khoaId(courseId) || !khoaId(lessonId)) throw khongThay();
  const r = await ghiTienDoBai(db as never, { parentUserId: nguoi.userId, studentId: hs, courseId, lessonStableId: lessonId, ...(body.percent !== undefined ? { percent: body.percent } : {}), ...(body.daDoc !== undefined ? { daDoc: body.daDoc } : {}), now });
  if (!r.ok) throw loiTuMa(r.ma);
  return { trangThai: r.trangThai, phanTram: r.percent, vuaHoanThanhBai: r.vuaHoanThanhBai, tienDo: r.tienDo, vuaHoanThanhKhoa: r.vuaHoanThanhKhoa };
}

/** `POST …/lessons/:lid/attempts` — bắt đầu (hoặc TIẾP TỤC lượt đang làm) một bài kiểm tra/bài tập/thi cuối. Đề KHÔNG có đáp án. Hai thiết bị cùng bấm ⇒ một lượt (E khoá dòng quyền). */
export async function batDauLamBaiOnline(hs: MaHocVienDaKiem, nguoi: NguoiGoi, courseId: string, lessonId: string, now = new Date()) {
  batNeuTatOnline();
  yeuCauHocSinhTuGhi(hs, nguoi);
  if (!khoaId(courseId) || !khoaId(lessonId)) throw khongThay();
  const r = await batDauLamBai(db as never, { parentUserId: nguoi.userId, studentId: hs, courseId, lessonStableId: lessonId, now });
  if (!r.ok) throw loiTuMa(r.ma);
  const l = r.luot;
  // D2 (Owner 21/11/2026): thi lại KHÔNG giới hạn ⇒ `soLuotToiDa` luôn null (trước đây đọc `OnlAssessment.maxAttempts` — cột còn đó nhưng lõi E không còn chặn theo nó).
  const soLuotToiDa = null;
  return { luotId: l.attemptId, soLuot: l.soLuot, soLuotToiDa, gioMayChu: now.toISOString(), batDauLuc: l.batDauLuc.toISOString(), hetGioLuc: l.hetGioLuc ? l.hetGioLuc.toISOString() : null, daTiepTuc: l.daTiepTuc, de: l.de as unknown as Record<string, unknown> };
}

/** `POST …/lessons/:lid/attempts/:attemptId/submit` { traLoi } — nộp bài (idempotent theo `attemptId`: nộp lại ⇒ kết quả cũ, `daNopTruocDo:true`). Chấm + tiến độ + chứng nhận cùng MỘT giao dịch của E. Dung sai 60 giây sau hạn. `chungNhan` = mã ĐÃ LƯU (khoá), `chungNhanMaHienThi` = chuỗi in cho người đọc (C10). */
export async function nopBaiOnline(hs: MaHocVienDaKiem, nguoi: NguoiGoi, courseId: string, lessonId: string, attemptId: string, body: NopBody, now = new Date()) {
  batNeuTatOnline();
  yeuCauHocSinhTuGhi(hs, nguoi);
  if (!khoaId(courseId) || !khoaId(lessonId) || !khoaId(attemptId)) throw khongThay();
  const r = await nopBai(db as never, { parentUserId: nguoi.userId, studentId: hs, courseId, lessonStableId: lessonId, attemptId, traLoi: body.traLoi, now });
  if (!r.ok) throw loiTuMa(r.ma);
  return { daNopTruocDo: r.daNopTruocDo, trangThai: r.trangThai, ketQua: r.ketQua as unknown as Record<string, unknown>, vuaCapChungNhan: r.vuaCapChungNhan, chungNhan: r.chungNhan, chungNhanMaHienThi: r.chungNhan === null ? null : hienThiMaChungNhan(r.chungNhan) };
}

/** `GET …/lessons/:lid/results` — các lượt đã làm + kết quả theo CÀI ĐẶT xem kết quả của khoá (đáp án chỉ hiện khi đã hết lượt/đã đạt, do E quyết). */
export async function ketQuaCacLuotOnline(hs: MaHocVienDaKiem, nguoi: NguoiGoi, courseId: string, lessonId: string, now = new Date()) {
  batNeuTatOnline();
  if (!khoaId(courseId) || !khoaId(lessonId)) throw khongThay();
  const r = await docKetQuaCacLuot(db as never, { parentUserId: nguoi.userId, studentId: hs, courseId, lessonStableId: lessonId, now });
  if (!r.ok) throw loiTuMa(r.ma);
  // V8.45: bổ sung CHỈ ĐỌC — id lượt, lý do chốt, gián đoạn/bồi hoàn, số lượt đã dùng. `ketQua` vẫn do lõi E quyết (INTERRUPTED/EXPIRED ⇒ null: KHÔNG phải điểm 0, KHÔNG lộ đáp án).
  const lt = await db.onlAttempt.findMany({
    where: { studentId: hs, lessonStableId: lessonId, entitlement: { courseId } },
    select: { id: true, number: true, assessmentId: true, entitlementId: true, finalizeReason: true, interruption: { select: { status: true, compensation: { select: { status: true, usedAttemptId: true } } } } },
  });
  const theoSo = new Map(lt.map((x) => [x.number, x]));
  const goc = lt[0];
  const luotConLai = goc ? await docLuotConLai(db as never, { entitlementId: goc.entitlementId, assessmentId: goc.assessmentId }) : { daDung: 0, luotThayTheDangCho: 0, toiDa: null, conLai: null };
  return {
    muc: r.luot.map((l) => {
      const x = theoSo.get(l.soLuot);
      return {
        luotId: x?.id ?? null,
        soLuot: l.soLuot,
        trangThai: l.trangThai,
        nopLuc: l.nopLuc ? l.nopLuc.toISOString() : null,
        ketQua: l.ketQua as unknown as Record<string, unknown> | null,
        tuDongNop: x?.finalizeReason === "DEADLINE_AUTO",
        lyDoChot: x?.finalizeReason ?? null,
        gianDoan: x?.interruption ? { trangThai: x.interruption.status, luotThayThe: x.interruption.compensation ? { trangThai: x.interruption.compensation.status, luotThayTheId: x.interruption.compensation.usedAttemptId } : null } : null,
      };
    }),
    luotConLai,
  };
}

// ───────────────────────── V8.45 — ONLINE EXAM P0: NHÁP THEO CÂU · TRẠNG THÁI LƯỢT (hàm lõi của E) ─────────────────────────

/** Cấu hình tần suất lõi E (đo bằng DB, không phải chính sách Owner). Chỉnh bằng env; mặc định = `TAN_SUAT_NHAP` của E. */
export function cauHinhTanSuatLoi(): CauHinhTanSuat {
  const so = (ten: string, md: number) => {
    const n = Number(process.env[ten]);
    return Number.isInteger(n) && n > 0 ? n : md;
  };
  return {
    toiDaYeuCauMoiPhut: so("ONLINE_NHAP_E_YEU_CAU_MOI_PHUT", TAN_SUAT_NHAP.toiDaYeuCauMoiPhut),
    cuaSoGiay: so("ONLINE_NHAP_E_CUA_SO_GIAY", TAN_SUAT_NHAP.cuaSoGiay),
    toiDaCauMoiYeuCau: so("ONLINE_NHAP_E_TOI_DA_CAU", TAN_SUAT_NHAP.toiDaCauMoiYeuCau),
  };
}

type ThamSoLuot = { parentUserId: string; studentId: string; courseId: string; lessonStableId: string; attemptId: string; now: Date };

const laTrangThaiLuot = (t: string): t is TrangThaiLuot => t === "IN_PROGRESS" || t === "SUBMITTED" || t === "GRADED" || t === "EXPIRED" || t === "INTERRUPTED";

/**
 * Lưu nháp THEO CÂU. Lõi E (`luuNhap`) kiểm TẤT CẢ câu trước khi ghi và từ chối CẢ yêu cầu nếu một câu sai kiểu (422). Mobile cần «câu sai không làm mất câu đúng»:
 * adapter TIỀN-KIỂM từng câu bằng CHÍNH validator của E (`kiemDapAnNhap`) trên bản chụp đề của lượt, gửi CHỈ phần hợp lệ cho `luuNhap` (cùng `requestId`, MỘT lời gọi — E đếm tần suất theo lời gọi),
 * rồi ghép kết quả theo `questionId`. Lõi E KHÔNG bị sửa; phép kiểm quyết định ghi vẫn là của E (adapter chỉ LỌC — E kiểm lại phần gửi đi).
 * Thứ tự ưu tiên: lỗi TOÀN YÊU CẦU của E (HET_GIO · LUOT_DA_CHOT · LUOT_BI_GIAN_DOAN · cổng quyền · VUOT_TAN_SUAT) thắng kết quả từng câu. Câu không có kết quả từ E ⇒ `KHONG_XAC_DINH` (fail-closed, không bao giờ `SAVED`).
 * 0 câu hợp lệ ⇒ không ghi gì nhưng VẪN qua cổng quyền/trạng thái của E (`docTrangThaiLuot`) để lượt đã chốt/bị thu hồi/của người khác không nhận 200.
 */
export async function luuNhapTheoCauLoi(p: ThamSoLuot, yeuCau: LuuNhapInput, cauHinh: CauHinhTanSuat): Promise<LuuNhapDto> {
  if (yeuCau.items.length > cauHinh.toiDaCauMoiYeuCau) throw loiYeuCau(`Tối đa ${cauHinh.toiDaCauMoiYeuCau} câu mỗi yêu cầu`);
  if (new Set(yeuCau.items.map((i) => i.questionId)).size !== yeuCau.items.length) throw loiYeuCau("Một yêu cầu không được ghi hai lần cùng một câu");

  const luot = await db.onlAttempt.findFirst({ where: { id: p.attemptId, studentId: p.studentId, lessonStableId: p.lessonStableId, entitlement: { courseId: p.courseId } }, select: { snapshotJson: true } });
  const tuChoi = new Map<string, KetQuaCauDto>();
  const hopLe: LuuNhapInput["items"] = [];
  if (luot) {
    const theoId = new Map((luot.snapshotJson as unknown as SnapshotDe).cau.map((c) => [c.id, c]));
    for (const it of yeuCau.items) {
      const c = theoId.get(it.questionId);
      if (!c) {
        tuChoi.set(it.questionId, { questionId: it.questionId, ketQua: "CAU_KHONG_THUOC_LUOT", ma: "CAU_KHONG_THUOC_LUOT", thongBao: THONG_BAO.CAU_KHONG_THUOC_LUOT! });
        continue;
      }
      const k = kiemDapAnNhap(c, it.answer);
      if (!k.ok) tuChoi.set(it.questionId, { questionId: it.questionId, ketQua: "SAI_KIEU", ma: "DAP_AN_KHONG_HOP_LE", thongBao: k.thongBao });
      else hopLe.push(it);
    }
  } else hopLe.push(...yeuCau.items); // không thấy lượt ⇒ để lõi E trả đúng mã (LUOT_KHONG_TON_TAI / cổng quyền)

  const dau = { parentUserId: p.parentUserId, studentId: p.studentId, courseId: p.courseId, lessonStableId: p.lessonStableId, attemptId: p.attemptId, now: p.now };
  let phu: { daGuiLai: boolean; trangThai: TrangThaiLuot; serverNow: string; hetGioLuc: string | null; giayConLai: number | null; draftRevision: number };
  const tuLoi = new Map<string, KetQuaCauDto>();
  if (hopLe.length > 0) {
    const r = await luuNhap(db as never, { ...dau, yeuCau: { requestId: yeuCau.requestId, ...(yeuCau.deviceId ? { deviceId: yeuCau.deviceId } : {}), items: hopLe } }, cauHinh);
    if (!r.ok) throw loiTuMa(r.ma, { retryAfterSec: r.retryAfterSec, daChot: r.daChot });
    for (const i of r.items) tuLoi.set(i.questionId, i as KetQuaCauDto);
    phu = { daGuiLai: r.replayed, trangThai: laTrangThaiLuot(r.trangThai) ? r.trangThai : "IN_PROGRESS", serverNow: r.serverNow, hetGioLuc: r.hetGioLuc, giayConLai: r.giayConLai, draftRevision: r.draftRevision };
  } else {
    const r = await docTrangThaiLuot(db as never, dau);
    if (!r.ok) throw loiTuMa(r.ma, { retryAfterSec: r.retryAfterSec, daChot: r.daChot });
    const l = r.luot;
    if (l.trangThai === "INTERRUPTED") throw loiTuMa("LUOT_BI_GIAN_DOAN");
    if (l.trangThai !== "IN_PROGRESS") throw loiTuMa("LUOT_DA_CHOT");
    if (l.giayConLai === 0) throw loiTuMa("HET_GIO", { daChot: false });
    phu = { daGuiLai: false, trangThai: "IN_PROGRESS", serverNow: l.serverNow, hetGioLuc: l.hetGioLuc, giayConLai: l.giayConLai, draftRevision: l.draftRevision };
  }

  const items: KetQuaCauDto[] = yeuCau.items.map(
    (it) => tuChoi.get(it.questionId) ?? tuLoi.get(it.questionId) ?? { questionId: it.questionId, ketQua: "KHONG_XAC_DINH" as const, thongBao: "requestId này đã được dùng cho một yêu cầu khác — hãy gửi lại với requestId MỚI." },
  );
  const soCauDaLuu = items.filter((i) => i.ketQua === "SAVED").length;
  const soCauTuChoi = items.filter((i) => i.ketQua === "SAI_KIEU" || i.ketQua === "CAU_KHONG_THUOC_LUOT" || i.ketQua === "KHONG_XAC_DINH").length;
  return { ...phu, items, soCauDaLuu, soCauTuChoi };
}

/**
 * Đọc lượt (+ CHỐT LƯỜI: quá `dueAt + 60 s` thì lõi E chấm từ nháp ngay khi đọc — GET này có thể GHI). `day-du` ⇒ thêm `nhap[]` (chỉ cái máy chủ đã ACK) + `de` (chỉ khi còn IN_PROGRESS, không đáp án đúng).
 * Phần bồi hoàn/lượt thay thế/lượt đã dùng đọc từ bảng của E (chỉ-đọc).
 */
export async function docLuotOnline(p: ThamSoLuot, kieu: "day-du" | "trang-thai"): Promise<NhapLuotDto | TrangThaiLuotDto> {
  const r = await docTrangThaiLuot(db as never, p);
  if (!r.ok) throw loiTuMa(r.ma, { retryAfterSec: r.retryAfterSec, daChot: r.daChot });
  const l = r.luot;
  const a = await db.onlAttempt.findUnique({
    where: { id: p.attemptId },
    select: { assessmentId: true, entitlementId: true, interruption: { select: { compensation: { select: { status: true, usedAttemptId: true } } } } },
  });
  const conLai = a ? await docLuotConLai(db as never, { entitlementId: a.entitlementId, assessmentId: a.assessmentId }) : { daDung: 0, luotThayTheDangCho: 0 };
  const trangThai: TrangThaiLuot = laTrangThaiLuot(l.trangThai) ? l.trangThai : "IN_PROGRESS";
  const cc = a?.interruption?.compensation ?? null;
  const goc: TrangThaiLuotDto = {
    luotId: l.attemptId,
    soLuot: l.soLuot,
    trangThai,
    serverNow: l.serverNow,
    hetGioLuc: l.hetGioLuc,
    giayConLai: l.giayConLai,
    draftRevision: l.draftRevision,
    coKetQua: trangThai === "GRADED" || trangThai === "SUBMITTED",
    tuDongNop: l.lyDoChot === "DEADLINE_AUTO",
    lyDoChot: l.lyDoChot,
    gianDoan: l.gianDoan,
    luotThayThe: cc ? { trangThai: cc.status, luotThayTheId: cc.usedAttemptId } : null,
    luotConLai: { daDung: conLai.daDung, luotThayTheDangCho: conLai.luotThayTheDangCho, toiDa: null, conLai: null },
  };
  if (kieu === "trang-thai") return goc;
  return { ...goc, nhap: l.nhap, de: l.de as unknown as Record<string, unknown> | null };
}

export type ChungNhanDto = { ma: string; maHienThi: string; trangThai: "ISSUED" | "REVOKED"; tenKhoa: string; maKhoa: string; soBan: number; diemCuoi: number | null; capLuc: string };

/** `GET /students/:id/online/certificates` — chứng nhận Online của CON (giữ cả chứng nhận của khoá đã thu hồi quyền — E). `ma` là mã ĐÃ LƯU = khoá tra cứu công khai (tên người được che ở trang tra cứu); `maHienThi` là chuỗi in cho người đọc, khớp giấy (C10: `SR-ON-…`; mã cấp trước C10 giữ nguyên). */
export async function chungNhanOnline(hs: MaHocVienDaKiem, nguoi: NguoiGoi): Promise<{ muc: ChungNhanDto[] }> {
  batNeuTatOnline();
  const r = await docChungNhanCuaHocVien(db as never, { parentUserId: nguoi.userId, studentId: hs });
  if (r === null) throw khongThay();
  return { muc: r.map((c) => ({ ma: c.code, maHienThi: c.maHienThi, trangThai: c.status as "ISSUED" | "REVOKED", tenKhoa: c.courseName, maKhoa: c.courseCode, soBan: c.versionNumber, diemCuoi: c.finalScore === null || c.finalScore === undefined ? null : Number(c.finalScore), capLuc: c.issuedAt.toISOString() })) };
}

// ───────────── ONLINE P2 (V8.15): danh mục khoá công khai + cổng tra cứu khoá cho `checkout/validate` ─────────────

/** GET /online/catalog — danh mục khoá ĐANG BÁN (hàm của E; không trả khoá media/nội dung). Cờ tắt ⇒ 404. Chỉ phụ huynh đã đăng nhập (route chặn chế độ học sinh). */
export async function danhMucKhoaOnline(query: Record<string, string | undefined>) {
  batNeuTatOnline();
  const loc = locCongKhaiSchema.safeParse(Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined)));
  if (!loc.success) throw new LoiApiMobile("VALIDATION", 400, "Bộ lọc không hợp lệ.");
  const r = await docKhoaCongKhai(db as never, loc.data, new Date());
  return { muc: r.khoa, tong: r.tong };
}

/** GET /online/catalog/:slug — chi tiết công khai (mục lục + bài học thử đánh dấu `hocThu`; KHÔNG nội dung bài). */
export async function chiTietDanhMucOnline(slug: string) {
  batNeuTatOnline();
  const k = await docChiTietCongKhai(db as never, slug, new Date());
  if (!k) throw khongThay();
  return k;
}

/**
 * Cổng `TraCuuKhoaBan` THẬT cho `POST /parent/checkout/validate` (thay cổng mặc định «chưa có danh mục»): khoá phải ĐÃ phát hành + đang bán lúc này;
 * trọn đời đang có ⇒ `DA_CO_QUYEN_VINH_VIEN`. Cờ Online tắt ⇒ `KHONG_CO_DANH_MUC` (giữ hành vi cũ). `khoaId` = id khoá Online.
 */
export async function traCuuKhoaOnline(khoaId: string, hocVien: { id: string; ngaySinh: Date | null }): Promise<KetQuaTraCuuKhoa> {
  if (!isElearningOnlineEnabled()) return { trangThai: "KHONG_CO_DANH_MUC" };
  const now = new Date();
  const k = await db.onlCourse.findFirst({ where: { id: khoaId, deletedAt: null, publishedVersionId: { not: null } }, select: { saleStatus: true, saleOpensAt: true, validityMonths: true, renewalEnabled: true } });
  if (!k || !banDuocLucNay(k.saleStatus, k.saleOpensAt, now)) return { trangThai: "KHONG_BAN" };
  const q = await db.onlEntitlement.findUnique({ where: { studentId_courseId: { studentId: hocVien.id, courseId: khoaId } }, select: { status: true, expiresAt: true, anchorDay: true } });
  const hienCo: QuyenHienCo | null = q ? { trangThai: q.status, hetHan: q.expiresAt, anchorDay: q.anchorDay } : null;
  const ky: KyHan = k.validityMonths === null ? { loai: "TRON_DOI" } : { loai: "THANG", soThang: k.validityMonths };
  const qd = quyetDinhCap({ now, loai: "MUA", quyen: hienCo, ky, choPhepGiaHan: k.renewalEnabled });
  if (!qd.ok && qd.ma === "DA_TRON_DOI") return { trangThai: "DA_CO_QUYEN_VINH_VIEN" };
  return { trangThai: "BAN_DUOC" };
}

/**
 * V8.44 — `POST …/lessons/:lid/video-ticket`: cấp VÉ PHÁT video của MỘT bài VIDEO. Qua CỔNG ĐẦY ĐỦ của E (sở hữu + quyền + hạn + thu hồi + bài ẩn + thứ tự mở + không xem lại).
 * KHÔNG trả khoá media / tên bucket / URL R2: chỉ `duongPhat` (đường phát công khai của máy chủ, mang vé hạn ngắn) — xem `lib/elearning-online/video-phat.ts`.
 * Mã lỗi: bảng của E + `KHOA_VIDEO_KHONG_HOP_LE` (409) + `KHO_VIDEO_CHUA_CAU_HINH` (503). Quyền thu hồi/hết hạn ⇒ không có vé MỚI (vé đã cấp bị cắt ở lượt phát kế tiếp).
 */
export async function capVePhatVideoOnline(hs: MaHocVienDaKiem, nguoi: NguoiGoi, courseId: string, lessonId: string, now = new Date()) {
  batNeuTatOnline();
  if (!khoaId(courseId) || !khoaId(lessonId)) throw khongThay();
  const r = await capVePhatHocVien(db as never, { parentUserId: nguoi.userId, studentId: hs, courseId, lessonStableId: lessonId, now });
  if (!r.ok) {
    if (r.ma === "KHOA_VIDEO_KHONG_HOP_LE") throw new LoiApiMobile(r.ma as never, 409, THONG_BAO[r.ma]!);
    if (r.ma === "KHO_VIDEO_CHUA_CAU_HINH") throw new LoiApiMobile(r.ma as never, 503, THONG_BAO[r.ma]!);
    throw loiTuMa(r.ma);
  }
  return dtoVePhat(r);
}
