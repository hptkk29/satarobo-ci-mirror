"use server";

/**
 * Lưu bài DISC làm TRONG cổng học viên. `userId` luôn lấy từ PHIÊN (`docPhienDisc`); quyền với `studentId` do `docNguonHoSoPortal`
 * kiểm trong DB (`Student.parentUserId = userId`). Client chỉ gửi: con nào, câu trả lời thô, năm sinh còn thiếu, và việc đã tích đồng ý.
 * Điểm do SERVER chấm (cùng `luuKetQuaDisc`) — không nhận điểm từ client.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";
import { DO_DAI_TOI_DA_KHOA_IDEM, DO_DAI_TOI_THIEU_KHOA_IDEM, MAU_KHOA_IDEM } from "@/lib/disc/chinh-sach";
import { luuBaiPortalThat } from "@/lib/disc/portal-lam-bai-prisma";
import type { KetQuaLuuPortal } from "@/lib/disc/portal-lam-bai";
import { docPhienDisc } from "../_lib/phien-disc";

const GIOI_HAN = { max: 10, windowMs: 60 * 60_000 };

const namSinh = z.number().int().min(1900).max(2100).optional();
const inputSchema = z.object({
  studentId: z.string().min(1).max(64),
  idempotencyKey: z.string().min(DO_DAI_TOI_THIEU_KHOA_IDEM).max(DO_DAI_TOI_DA_KHOA_IDEM).regex(MAU_KHOA_IDEM),
  /** Người dùng PHẢI tích đồng ý xử lý hồ sơ (dữ liệu của trẻ) ở bước xác nhận. */
  dongYXuLy: z.literal(true),
  boSung: z.object({ namSinhPhuHuynh: namSinh, namSinhHocSinh: namSinh }).default({}),
  bai: z.unknown(),
});

export async function luuBaiDiscPortalAction(input: unknown): Promise<KetQuaLuuPortal> {
  const phien = await docPhienDisc();
  if (!phien.ok) return { ok: false, loi: "KHONG_CO_QUYEN" };

  const p = inputSchema.safeParse(input);
  if (!p.success) return { ok: false, loi: "DU_LIEU_KHONG_HOP_LE" };

  const gh = await rateLimit({ key: `disc:portal-luu:user:${phien.userId}`, ...GIOI_HAN });
  if (!gh.success) return { ok: false, loi: "QUA_NHIEU_YEU_CAU" };

  try {
    const r = await luuBaiPortalThat({
      userId: phien.userId,
      studentId: p.data.studentId,
      idempotencyKey: p.data.idempotencyKey,
      boSung: p.data.boSung,
      bai: p.data.bai,
    });
    if (r.ok) revalidatePath("/portal/disc");
    return r;
  } catch {
    // Không đính lỗi gốc: có thể mang mảnh dữ liệu cá nhân của trẻ.
    return { ok: false, loi: "LUU_THAT_BAI" };
  }
}
