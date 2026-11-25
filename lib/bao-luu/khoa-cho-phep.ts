// lib/bao-luu/khoa-cho-phep.ts — KHOÁ NÀO ĐƯỢC BẢO LƯU: công tắc `Course.allowPause` do Đào tạo tự đặt [chốt 12/10/2026].
//
// Anh Toại (Đào tạo) trả lời: hiện KHÔNG bảo lưu Sata 1, Sata 2, Combo, Sata 8 — và danh sách này phải TỰ ĐẶT ĐƯỢC trong hệ thống
// (không sửa mã, không chờ migration) để sau này đổi cho khoá khác. Cột đã có từ Phiên 1 (BR-02, mặc định BẬT hết); trước đợt này chỉ
// thiếu CHỖ BẬT/TẮT. Mọi nơi đọc cột (nút "Bảo lưu" ở hồ sơ HV, form lập, duyệt, tạm dừng cả lớp, nhập hồ sơ cũ) đọc SỐNG nên đổi là có hiệu lực ngay.
//
// ⚠️ Danh sách khoá tắt là DỮ LIỆU, không phải hằng trong mã — đừng thêm `slug in (...)` ở đâu cả (lưới [BLK-W*] canh).
import type { scopedDb } from "@/lib/db-scope";
import { writeAudit } from "@/lib/audit/audit-log";

type Sdb = ReturnType<typeof scopedDb>;

export type TacDongTatBaoLuu = {
  /** Hồ sơ đang CHỜ DUYỆT của khoá — tắt xong sẽ bị từ chối ở bước duyệt ("Khoá học này không còn áp dụng bảo lưu"). */
  hoSoChoDuyet: number;
  /** Hồ sơ đang bảo lưu (ACTIVE) — KHÔNG bị ảnh hưởng, vẫn chạy hết vòng đời. */
  hoSoDangBaoLuu: number;
};

/** Đếm hồ sơ của khoá để nói thật với người bấm TẮT. `scopedDb` ⇒ chỉ đếm trong tầm nhìn của người xem (Đào tạo/HO thấy hết). */
export async function demTacDongTatBaoLuu(sdb: Sdb, courseId: string): Promise<TacDongTatBaoLuu> {
  const [hoSoChoDuyet, hoSoDangBaoLuu] = await Promise.all([
    sdb.studentReserve.count({ where: { status: "PENDING", enrollment: { courseId } } }),
    sdb.studentReserve.count({ where: { status: { in: ["ACTIVE", "RESUME_PENDING", "OVERDUE", "NOTICE_SENT"] }, enrollment: { courseId } } }),
  ]);
  return { hoSoChoDuyet, hoSoDangBaoLuu };
}

export type KetQuaDatChoPhep = { ok: true; doi: boolean; tacDong: TacDongTatBaoLuu } | { ok: false; error: string };

/**
 * Đặt `Course.allowPause`. Không đổi gì (đã đúng giá trị) ⇒ không ghi, không audit. Quyền do NƠI GỌI kiểm (`courses:edit`).
 * Ghi audit kèm giá trị cũ/mới VÀ số hồ sơ bị ảnh hưởng tại lúc bấm (để sau này truy "ai tắt, lúc đó kẹt bao nhiêu hồ sơ").
 */
export async function datChoPhepBaoLuuCuaKhoa(p: {
  sdb: Sdb;
  courseId: string;
  choPhep: boolean;
  nguoi: { id: string; name: string };
}): Promise<KetQuaDatChoPhep> {
  const khoa = await p.sdb.course.findUnique({ where: { id: p.courseId }, select: { id: true, name: true, allowPause: true } });
  if (!khoa) return { ok: false, error: "Không tìm thấy khoá học" };
  const tacDong = await demTacDongTatBaoLuu(p.sdb, p.courseId);
  if (khoa.allowPause === p.choPhep) return { ok: true, doi: false, tacDong };

  await p.sdb.course.update({ where: { id: p.courseId }, data: { allowPause: p.choPhep } });
  await writeAudit({
    actor: p.nguoi,
    module: "lms", // cùng module với cấu hình học bù của khoá (`luuCauHinhHocBuAction`) — lọc nhật ký theo khoá thấy cả hai
    entityType: "Course",
    entityId: p.courseId,
    action: "UPDATE",
    changedFields: ["allowPause"],
    oldValues: { allowPause: khoa.allowPause, khoa: khoa.name },
    newValues: { allowPause: p.choPhep, hoSoChoDuyet: tacDong.hoSoChoDuyet, hoSoDangBaoLuu: tacDong.hoSoDangBaoLuu },
  });
  return { ok: true, doi: true, tacDong };
}
