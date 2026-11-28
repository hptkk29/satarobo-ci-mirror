import { z } from "zod";
import { writeAudit } from "@/lib/audit/audit-log";
import { db } from "@/lib/db";
import { gioVN } from "@/lib/format/thoi-gian-vn";
import { kiemMatKhauPhuHuynh } from "@/lib/portal/hv-ma";
import { LoiApiMobile, type NguoiGoi } from "../xac-thuc/dich-vu";

/**
 * V8.45 — YÊU CẦU XOÁ TÀI KHOẢN trên app (W-CONTRACT CRITICAL-1; NĐ 13/2023, App Store 5.1.1(v)). `POST/GET /account/deletion-request` (thiết kế: `docs/mobile/11` mục 6).
 *
 * CHỈ GHI NHẬN — đúng hợp đồng client («Yêu cầu đã được GHI NHẬN — không có nghĩa dữ liệu đã bị xoá»): lớp này KHÔNG xoá, KHÔNG ẩn danh, KHÔNG thu hồi phiên.
 * Việc xoá/ẩn danh thật (giữ chứng từ tài chính + chứng nhận theo nghĩa vụ lưu trữ, `lib/compliance/erasure.ts`) là quy trình của PHÁP CHẾ (tài liệu 12 §1.6, QĐ-M6) —
 * CHƯA có người xử lý trong hệ thống; hàng đợi là các dòng `AccountDeletionRequest` RECEIVED/IN_REVIEW. Thu hồi phiên là việc của BƯỚC XỬ LÝ, không phải của bước gửi
 * (gửi yêu cầu mà bị văng ra ngay thì người dùng không thấy được xác nhận «đã tiếp nhận»).
 *
 *  · Đòi NHẬP LẠI MẬT KHẨU (cửa thử mật khẩu ngoài màn đăng nhập ⇒ dùng chung bộ đếm 5 lần/15 phút theo người dùng của «quên mã học sinh»; sai ⇒ `PASSWORD_INCORRECT` 400).
 *  · Chỉ phụ huynh phiên THƯỜNG (con ở chế độ học sinh không gửi được: route không nằm trong danh sách cho phép của chế độ học sinh).
 *  · MỘT yêu cầu đang mở cho mỗi người dùng: gửi lại khi còn yêu cầu mở ⇒ trả CHÍNH yêu cầu đó (`daCoTruocDo:true`), không đẻ bản thứ hai (khoá cố vấn theo người dùng trong giao dịch).
 *  · Kiểm toán KHÔNG chứa mật khẩu và KHÔNG chứa nội dung `lyDo` (có thể có thông tin cá nhân) — chỉ cờ «có lý do». Lý do nằm ở bảng yêu cầu.
 */
const DANG_MO = ["RECEIVED", "IN_REVIEW"] as const;

export const yeuCauXoaSchema = z.object({
  matKhau: z.string().min(1, "Nhập mật khẩu").max(200),
  lyDo: z.string().trim().max(500, "Lý do tối đa 500 ký tự").optional(),
});
export type YeuCauXoaBody = z.infer<typeof yeuCauXoaSchema>;
export type YeuCauXoaDto = { maYeuCau: string; tiepNhanLuc: string };

/** Mã người đọc được: «XTK-» + 8 ký tự cuối của id (đủ để nhân viên tra; id đầy đủ vẫn là khoá thật). */
export const maHienThiYeuCau = (id: string): string => `XTK-${id.slice(-8).toUpperCase()}`;

/** «14:05 25/11/2026» theo giờ Việt Nam — nhãn do MÁY CHỦ định dạng (client không tự suy múi giờ). */
export function nhanTiepNhan(d: Date): string {
  const v = gioVN(d); // YYYY-MM-DDTHH:MM:SS+07:00
  return `${v.slice(11, 16)} ${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}`;
}

const dto = (r: { id: string; requestedAt: Date }): YeuCauXoaDto => ({ maYeuCau: maHienThiYeuCau(r.id), tiepNhanLuc: nhanTiepNhan(r.requestedAt) });

/** `GET /account/deletion-request` — yêu cầu ĐANG MỞ của chính người dùng, hoặc `null`. */
export async function docYeuCauXoa(nguoi: NguoiGoi): Promise<YeuCauXoaDto | null> {
  const r = await db.accountDeletionRequest.findFirst({ where: { userId: nguoi.userId, status: { in: [...DANG_MO] } }, orderBy: [{ requestedAt: "desc" }, { id: "desc" }], select: { id: true, requestedAt: true } });
  return r ? dto(r) : null;
}

/** `POST /account/deletion-request { matKhau, lyDo? }` — ghi nhận yêu cầu (idempotent khi còn yêu cầu mở). */
export async function guiYeuCauXoa(nguoi: NguoiGoi, body: YeuCauXoaBody, now = new Date()): Promise<YeuCauXoaDto & { daCoTruocDo: boolean }> {
  const mk = await kiemMatKhauPhuHuynh(nguoi.userId, body.matKhau);
  if (mk.ket === "qua-nhieu-lan") throw new LoiApiMobile("RATE_LIMITED", 429, "Nhập sai mật khẩu nhiều lần. Thử lại sau 15 phút.", 900);
  if (mk.ket === "khong-co-mat-khau") throw new LoiApiMobile("VALIDATION", 409, "Tài khoản này chưa có mật khẩu đăng nhập. Vui lòng liên hệ trung tâm để được hỗ trợ.", undefined, "CHUA_CO_MAT_KHAU");
  if (mk.ket === "sai") throw new LoiApiMobile("PASSWORD_INCORRECT", 400, "Mật khẩu chưa đúng.");

  const lyDo = body.lyDo && body.lyDo.length > 0 ? body.lyDo : null;
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"xoa-tai-khoan:" + nguoi.userId}))`;
    const mo = await tx.accountDeletionRequest.findFirst({ where: { userId: nguoi.userId, status: { in: [...DANG_MO] } }, orderBy: [{ requestedAt: "desc" }, { id: "desc" }], select: { id: true, requestedAt: true } });
    if (mo) return { ...dto(mo), daCoTruocDo: true };
    const moi = await tx.accountDeletionRequest.create({ data: { userId: nguoi.userId, lyDo, requestedAt: now }, select: { id: true, requestedAt: true } });
    await writeAudit({
      actor: { id: nguoi.userId, name: nguoi.name },
      module: "mobile-account",
      entityType: "User",
      entityId: nguoi.userId,
      action: "mobile.account_deletion_requested",
      newValues: { maYeuCau: maHienThiYeuCau(moi.id), yeuCauId: moi.id, coLyDo: lyDo !== null },
      tx,
    });
    return { ...dto(moi), daCoTruocDo: false };
  });
}
