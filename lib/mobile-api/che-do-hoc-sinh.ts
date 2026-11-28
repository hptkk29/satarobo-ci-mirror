import { z } from "zod";

import { db } from "@/lib/db";
import { CAU_LOI_MA, dongHoKhoa, laMaDeDoan } from "@/lib/portal/hv-ma-thuan";
import { coMaThoat, docNamSinhCacCon, docNhatKy, ghiNhatKy, kiemMaCoDem, kiemMatKhauPhuHuynh, luuMaThoat, trungMaHienTai } from "@/lib/portal/hv-ma";
import { vnParts } from "@/lib/time/vn";

import { layMe } from "./dich-vu/me";
import type { MaHocVienDaKiem } from "./so-huu";
import { LoiApiMobile, type NguoiGoi } from "./xac-thuc/dich-vu";

/**
 * H-S3 — CHẾ ĐỘ HỌC SINH trên app, ÉP Ở MÁY CHỦ. Dùng lại đúng mã thoát + bộ đếm sai/khoá + nhật ký + «quên mã ⇒ xác minh mật khẩu phụ huynh» của cổng web (`lib/portal/hv-ma.ts`) —
 * không có luật mã thứ hai. Khác web (cờ nằm ở cookie): ở đây chế độ nằm trong PHIÊN di động (`MobileSession.hocSinhId`) nên:
 *   · sống qua khởi động lại app và qua làm mới token (cùng một dòng phiên);
 *   · không có cách «xoá cookie» để thoát — chỉ mã thoát đúng / mật khẩu phụ huynh;
 *   · cổng chung `cong.ts` chặn mọi endpoint ngoài danh sách học sinh được xem (`che-do-hoc-sinh-thuan.ts`) — kể cả liên kết sâu, tài chính, chat, hồ sơ ba mẹ, đổi sang anh/chị/em.
 */
export const maThoatSchema = z.object({ ma: z.string().regex(/^\d{4}$/, "Mã gồm đúng 4 chữ số.") });
export const taoMaSchema = z.object({ ma: z.string().regex(/^\d{4}$/, "Mã gồm đúng 4 chữ số."), xacNhan: z.string().regex(/^\d{4}$/, "Mã gồm đúng 4 chữ số.") });
const maBonSo = z.string().regex(/^\d{4}$/, "Mã gồm đúng 4 chữ số.");
/** V8.19 (B-ST2): đổi mã thoát — đúng luật web (`datMaMoiAction` luồng «doi»): nhập mã hiện tại (đếm sai/khoá CHUNG), mã mới khác mã cũ, không dễ đoán. */
export const doiMaSchema = z.strictObject({ maCu: maBonSo, ma: maBonSo, xacNhan: maBonSo });
export const quenMaSchema = z.object({ matKhau: z.string().min(1, "Nhập mật khẩu đăng nhập của ba mẹ.").max(200) });
export const vaoSchema = z.object({ studentId: z.string().min(1).max(64) });

export type TrangThaiCheDoDto = { dangHocSinh: boolean; hocSinhId: string | null; coMaThoat: boolean };

/**
 * KHUNG TỐI THIỂU của học sinh đang khoá — để app vẽ màn học sinh SAU KHỞI ĐỘNG LẠI mà không cần `GET /auth/me` (endpoint đó bị chặn ở chế độ học sinh vì có hồ sơ ba mẹ/anh chị em).
 * CHỈ gồm học viên đang khoá: id · tên · khoá · mã lớp · cơ sở. KHÔNG có hồ sơ ba mẹ, SĐT/email, quy định, anh/chị/em, số liệu chuyên cần/tiến độ.
 */
export type HocSinhKhungDto = { id: string; name: string; courseName: string | null; classCode: string | null; centerName: string | null };
export type TrangThaiCheDoDayDuDto = TrangThaiCheDoDto & { hocSinh: HocSinhKhungDto | null };

/** `GET /student-mode`: trạng thái + (khi đang khoá) khung tối thiểu của đúng học viên đang khoá. Không khoá ⇒ `hocSinh: null`. */
export async function layTrangThai(nguoi: NguoiGoi): Promise<TrangThaiCheDoDayDuDto> {
  const hs = nguoi.hocSinhId;
  const [maThoat, khung] = await Promise.all([coMaThoat(nguoi.userId), hs ? layKhungHocSinh(nguoi.userId, hs) : Promise.resolve(null)]);
  return { dangHocSinh: hs !== null, hocSinhId: hs, coMaThoat: maThoat, hocSinh: khung };
}

async function layKhungHocSinh(parentUserId: string, hocSinhId: string): Promise<HocSinhKhungDto | null> {
  const me = await layMe(parentUserId); // cùng nguồn với GET /auth/me; chỉ giữ đúng một con
  const c = me.children.find((x) => x.id === hocSinhId);
  return c ? { id: c.id, name: c.name, courseName: c.courseName, classCode: c.classCode, centerName: c.centerName } : null;
}

/** Vào chế độ học sinh cho MỘT con (đã qua kiểm sở hữu). Phải có mã thoát trước — nếu không, ba mẹ không bao giờ thoát được. */
export async function vaoCheDo(nguoi: NguoiGoi, hs: MaHocVienDaKiem): Promise<TrangThaiCheDoDto> {
  if (nguoi.hocSinhId !== null) throw new LoiApiMobile("FORBIDDEN", 403, "Đang ở chế độ học sinh."); // phòng thủ lần hai (cổng chung đã chặn)
  if (!(await coMaThoat(nguoi.userId))) throw new LoiApiMobile("VALIDATION", 409, "Ba mẹ cần đặt mã thoát trước khi mở chế độ học sinh.", undefined, "CHUA_CO_MA_THOAT");
  // Ghi có điều kiện trên đúng phiên này (chưa thu hồi): phiên đã bị thu hồi giữa chừng ⇒ không bật.
  const r = await db.mobileSession.updateMany({ where: { id: nguoi.sessionId, thuHoiLuc: null }, data: { hocSinhId: hs, hocSinhTuLuc: new Date() } });
  if (r.count !== 1) throw new LoiApiMobile("UNAUTHENTICATED", 401, "Phiên đăng nhập không còn hợp lệ.");
  await ghiNhatKy(nguoi.userId, hs, "VAO", "Vào chế độ học sinh trên app");
  return { dangHocSinh: true, hocSinhId: hs, coMaThoat: true };
}

async function tatCheDo(nguoi: NguoiGoi, chiTiet?: string) {
  await db.mobileSession.updateMany({ where: { id: nguoi.sessionId }, data: { hocSinhId: null, hocSinhTuLuc: null } });
  await ghiNhatKy(nguoi.userId, nguoi.hocSinhId, "THOAT_DUNG_MA", chiTiet);
}

/** Thoát bằng MÃ: đi qua bộ đếm sai/khoá chung (5 lần ⇒ khoá + báo chuông ba mẹ). Không ở chế độ học sinh ⇒ không có gì để thoát (KHÔNG lộ trạng thái mã, KHÔNG đếm sai). */
export async function thoatBangMa(nguoi: NguoiGoi, ma: string, now: Date = new Date()): Promise<TrangThaiCheDoDto> {
  if (nguoi.hocSinhId === null) return { dangHocSinh: false, hocSinhId: null, coMaThoat: await coMaThoat(nguoi.userId) };
  const ten = (await db.student.findUnique({ where: { id: nguoi.hocSinhId }, select: { name: true } }))?.name ?? null;
  const r = await kiemMaCoDem(nguoi.userId, ma, now, { studentId: nguoi.hocSinhId, tenCon: ten });
  if (r.ket === "chua-co-ma") throw new LoiApiMobile("VALIDATION", 409, "Chưa có mã thoát. Nhờ ba mẹ đăng nhập lại.", undefined, "CHUA_CO_MA_THOAT");
  if (r.ket === "khoa") throw new LoiApiMobile("RATE_LIMITED", 429, `Tạm khoá ${dongHoKhoa(r.giayCon)}`, r.giayCon);
  if (r.ket === "sai") throw new LoiApiMobile("VALIDATION", 400, `Mã chưa đúng. Còn ${r.conLai} lần thử.`);
  await tatCheDo(nguoi);
  return { dangHocSinh: false, hocSinhId: null, coMaThoat: true };
}

/** «Ba mẹ quên mã»: xác minh MẬT KHẨU đăng nhập của phụ huynh (giới hạn riêng theo tài khoản) rồi thoát để đặt mã mới. */
export async function thoatBangMatKhau(nguoi: NguoiGoi, matKhau: string): Promise<TrangThaiCheDoDto> {
  if (nguoi.hocSinhId === null) return { dangHocSinh: false, hocSinhId: null, coMaThoat: await coMaThoat(nguoi.userId) };
  const r = await kiemMatKhauPhuHuynh(nguoi.userId, matKhau);
  if (r.ket === "qua-nhieu-lan") throw new LoiApiMobile("RATE_LIMITED", 429, "Nhập sai mật khẩu nhiều lần. Thử lại sau 15 phút.", 900);
  if (r.ket === "khong-co-mat-khau") throw new LoiApiMobile("VALIDATION", 409, "Tài khoản này chưa có mật khẩu đăng nhập. Gọi 0837.312.860 để được hỗ trợ.", undefined, "CHUA_CO_MAT_KHAU");
  if (r.ket === "sai") throw new LoiApiMobile("VALIDATION", 400, "Mật khẩu chưa đúng. Ba mẹ thử lại nhé.");
  await tatCheDo(nguoi, "Thoát bằng mật khẩu đăng nhập (quên mã)");
  return { dangHocSinh: false, hocSinhId: null, coMaThoat: await coMaThoat(nguoi.userId) };
}

/** Lần đầu: tạo mã thoát (đã có mã ⇒ phải đi qua đổi mã/quên mã — không cho tạo đè). Chỉ ở phiên phụ huynh. Mã dễ đoán (năm sinh của con, dãy số…) bị từ chối như web. */
export async function taoMaThoat(nguoi: NguoiGoi, ma: string, xacNhan: string, now: Date = new Date()): Promise<{ coMaThoat: true }> {
  if (nguoi.hocSinhId !== null) throw new LoiApiMobile("FORBIDDEN", 403, "Đang ở chế độ học sinh.");
  if (ma !== xacNhan) throw new LoiApiMobile("VALIDATION", 400, "Hai lần nhập chưa khớp. Ba mẹ đặt lại nhé.");
  const loi = laMaDeDoan(ma, await docNamSinhCacCon(nguoi.userId), vnParts(now).year);
  if (loi) throw new LoiApiMobile("VALIDATION", 400, CAU_LOI_MA[loi]);
  if (await coMaThoat(nguoi.userId)) throw new LoiApiMobile("VALIDATION", 409, "Ba mẹ đã có mã thoát. Hãy dùng Đổi mã hoặc Quên mã.", undefined, "DA_CO_MA_THOAT");
  await luuMaThoat(nguoi.userId, ma);
  await ghiNhatKy(nguoi.userId, null, "TAO_MA");
  return { coMaThoat: true };
}

/**
 * V8.19 — ĐỔI MÃ THOÁT (phiên phụ huynh). Cùng luật web (`app/(portal)/portal/hoc-sinh/actions.ts`: bước «nhập mã hiện tại» + `datMaMoiAction` luồng `doi`), gộp một lời gọi:
 *   mã hiện tại đi qua `kiemMaCoDem` (MỘT bộ đếm sai/khoá cho mọi nơi đòi mã — không thành cỗ máy đoán mã) → mã mới khớp xác nhận, không dễ đoán, KHÁC mã cũ → lưu + nhật ký `DOI_MA`.
 * Chưa có mã ⇒ 409 (đi qua «Tạo mã»). Ở chế độ học sinh ⇒ 403 (và cổng chung đã chặn đường dẫn này).
 */
export async function doiMaThoat(nguoi: NguoiGoi, input: z.infer<typeof doiMaSchema>, now: Date = new Date()): Promise<{ coMaThoat: true }> {
  if (nguoi.hocSinhId !== null) throw new LoiApiMobile("FORBIDDEN", 403, "Đang ở chế độ học sinh.");
  if (input.ma !== input.xacNhan) throw new LoiApiMobile("VALIDATION", 400, "Hai lần nhập chưa khớp. Ba mẹ đặt lại mã mới nhé.");
  const r = await kiemMaCoDem(nguoi.userId, input.maCu, now, { studentId: null, tenCon: null });
  if (r.ket === "chua-co-ma") throw new LoiApiMobile("VALIDATION", 409, "Ba mẹ chưa tạo mã thoát.", undefined, "CHUA_CO_MA_THOAT");
  if (r.ket === "khoa") throw new LoiApiMobile("RATE_LIMITED", 429, `Tạm khoá ${dongHoKhoa(r.giayCon)}`, r.giayCon);
  if (r.ket === "sai") throw new LoiApiMobile("VALIDATION", 400, `Mã hiện tại chưa đúng. Còn ${r.conLai} lần thử.`);
  const loi = laMaDeDoan(input.ma, await docNamSinhCacCon(nguoi.userId), vnParts(now).year);
  if (loi) throw new LoiApiMobile("VALIDATION", 400, CAU_LOI_MA[loi]);
  if (await trungMaHienTai(nguoi.userId, input.ma)) throw new LoiApiMobile("VALIDATION", 400, CAU_LOI_MA.TRUNG_MA_CU);
  await luuMaThoat(nguoi.userId, input.ma);
  await ghiNhatKy(nguoi.userId, null, "DOI_MA");
  return { coMaThoat: true };
}

export type NhatKyCheDoDto = { muc: Array<{ id: string; loai: string; hocSinhId: string | null; tenCon: string | null; chiTiet: string | null; luc: string }> };
/**
 * V8.19 — NHẬT KÝ chế độ học sinh của CHÍNH phụ huynh (VAO / THOAT / TAO_MA / DOI_MA / nhập sai / khoá…), mới nhất trước, tối đa 30 dòng. Chỉ phiên phụ huynh; chỉ dòng của userId từ phiên.
 * Tên con chỉ lấy của CON CỦA CHÍNH phụ huynh (id lạ trong nhật ký ⇒ `tenCon: null`). Không có mã/mật khẩu/băm trong DTO.
 */
export async function docNhatKyCheDo(nguoi: NguoiGoi): Promise<NhatKyCheDoDto> {
  if (nguoi.hocSinhId !== null) throw new LoiApiMobile("FORBIDDEN", 403, "Đang ở chế độ học sinh.");
  const dong = await docNhatKy(nguoi.userId, 30);
  const ids = [...new Set(dong.map((d) => d.studentId).filter((x): x is string => !!x))];
  const con = ids.length ? await db.student.findMany({ where: { id: { in: ids }, parentUserId: nguoi.userId, deletedAt: null }, select: { id: true, name: true } }) : [];
  const ten = new Map(con.map((c) => [c.id, c.name]));
  return { muc: dong.map((d) => ({ id: d.id, loai: d.loai, hocSinhId: d.studentId && ten.has(d.studentId) ? d.studentId : null, tenCon: d.studentId ? (ten.get(d.studentId) ?? null) : null, chiTiet: d.chiTiet, luc: d.luc.toISOString() })) };
}
