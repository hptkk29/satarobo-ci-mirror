import "server-only";
/**
 * Nối `luuBaiTrongPortal` với DB thật. Truy vấn đi `db` trần có chủ đích (như `nhan-prisma.ts`): bảng DISC không theo cơ sở,
 * và quyền ở đây là QUYỀN SỞ HỮU — `Student.parentUserId = userId` từ PHIÊN, không phải scope cơ sở.
 */
import { db } from "@/lib/db";
import { canonicalPhone } from "@/lib/phone";
import { ensureDiscEngine } from "./engine-dang-ky";
import { luuKetQuaDisc, type LuuDeps } from "./luu";
import { layKhoaDisc, phoneKeyTuSdtChuan } from "./phone-key";
import { luuBaiTrongPortal, type KetQuaLuuPortal, type LuuPortalDeps, type NguonHoSoPortal, type YeuCauLuuPortal } from "./portal-lam-bai";
import { discStore, nhanStore } from "./store-prisma";
import { thachDoStore } from "./nhan-prisma";

/** Năm theo giờ Việt Nam của một mốc thời gian lưu dạng instant. */
const namVN = (d: Date) => new Date(d.getTime() + 7 * 3_600_000).getUTCFullYear();

export async function docNguonHoSoPortal(userId: string, studentId: string): Promise<NguonHoSoPortal | null> {
  const [hs, user] = await Promise.all([
    db.student.findFirst({
      where: { id: studentId, parentUserId: userId, deletedAt: null },
      select: { name: true, dateOfBirth: true, currentGrade: true, parentDob: true },
    }),
    db.user.findUnique({ where: { id: userId }, select: { name: true, phone: true } }),
  ]);
  if (!hs || !user) return null;
  return {
    soDienThoai: user.phone ? canonicalPhone(user.phone) : null,
    tenPhuHuynh: user.name,
    tenHocSinh: hs.name,
    namSinhPhuHuynh: hs.parentDob ? hs.parentDob.getUTCFullYear() : null,
    namSinhHocSinh: hs.dateOfBirth ? namVN(hs.dateOfBirth) : null,
    lopDaLuu: hs.currentGrade ?? null,
  };
}

function depsThat(userId: string): LuuPortalDeps {
  ensureDiscEngine();
  const luuDeps: LuuDeps = {
    store: discStore,
    // Khách đã có tài khoản ⇒ KHÔNG tạo lead mới từ bài này.
    crm: async () => ({ leadId: null }),
    // Không có email ở luồng này ⇒ luu.ts không gọi; trả KHONG_CAN cho đủ hợp đồng.
    guiEmail: async () => ({ ok: false, loi: "KHONG_CAN" }),
    // Trần theo CẶP (SĐT, nguồn) tính theo tài khoản, không theo IP (người dùng đã xác thực).
    nguonIp: `portal:${userId}`,
  };
  const khoaPhone = (sdt: string) => {
    const chuan = canonicalPhone(sdt);
    if (!chuan) throw new Error("SĐT không hợp lệ");
    return phoneKeyTuSdtChuan(chuan, layKhoaDisc());
  };
  return {
    docNguon: docNguonHoSoPortal,
    luu: (raw) => luuKetQuaDisc(raw, luuDeps),
    ganChoChu: ({ submissionId, soDienThoai, userId: u, now }) => thachDoStore.gan({ submissionId, phoneKey: khoaPhone(soDienThoai), userId: u, now }),
    huyBai: async ({ submissionId, soDienThoai, now }) => {
      await nhanStore.tuChoi([submissionId], khoaPhone(soDienThoai), now);
    },
  };
}

export function luuBaiPortalThat(y: YeuCauLuuPortal): Promise<KetQuaLuuPortal> {
  return luuBaiTrongPortal(y, depsThat(y.userId));
}
