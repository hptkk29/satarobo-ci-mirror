import "server-only";
import { db } from "@/lib/db";
import { GHI_DANH_CO_LICH_SU } from "@/lib/portal/trang-thai-ghi-danh";
import { hasMediaConsent } from "@/lib/lms/media-consent";
import { resolveMediaUrl } from "@/lib/storage/signed-url";
import { napBuoiCuaLop } from "@/lib/portal/buoi-hoc";

// Portal v2 — ảnh lớp theo buổi của con đang chọn. Cùng luật với bản v1 (C6.2):
// ảnh APPROVED và (được GẮN THẺ con HOẶC đánh dấu "Ảnh chung cả lớp").
// Gate theo StudentConsent CLASS_MEDIA (privacy C3/C6). URL đi qua
// resolveMediaUrl → signed URL khi bật MEDIA_SIGNED_URL (OFF → fileUrl trần).
//
// 06/09 — số buổi và tên bài lấy từ `lib/portal/buoi-hoc.ts` (hạng theo ngày), không
// còn `Lesson.order`. Trước đó: lớp chưa ghim giáo trình thì huy hiệu buổi in dấu "•"
// (components/portal/hinh-anh-page.tsx), và sau một lần huỷ-buổi-xếp-bù thì hai nhóm
// ảnh khác nhau cùng đề "Buổi 5" rồi nằm cạnh nhau vì được xếp theo chính con số đó.

// 06/09 — ảnh lớp là màn LỊCH SỬ: con học xong khoá rồi phụ huynh vẫn phải xem lại
// được ảnh những buổi đã học. Danh sách cũ thiếu cả "PAUSED" lẫn "COMPLETED" nên 32/131
// học viên có tài khoản phụ huynh mở trang Hình ảnh ra là trống.
const ACTIVE = GHI_DANH_CO_LICH_SU;

export type PhotoItem = { id: string; caption: string | null; url: string };
export type PhotoGroup = {
  sessionId: string;
  /** Buổi thứ mấy của lớp — khớp site giáo viên/admin; null với ảnh không gắn buổi. */
  order: number | null;
  /** Nhãn đầy đủ `Buổi 5 - HP2 - Họa Sĩ Robot`. */
  title: string;
  dateISO: string;
  /** `dd/MM/yyyy` theo lịch VN, tính sẵn ở server. */
  nhanNgay: string;
  photos: PhotoItem[];
};
export type StudentPhotos = { consentGranted: boolean; className: string | null; total: number; groups: PhotoGroup[] };

export async function getStudentPhotos(studentId: string): Promise<StudentPhotos> {
  const consentGranted = await hasMediaConsent(studentId);
  if (!consentGranted) return { consentGranted: false, className: null, total: 0, groups: [] };

  const enr = await db.enrollment.findMany({
    where: { studentId, status: { in: [...ACTIVE] }, deletedAt: null },
    select: { classId: true, class: { select: { classCode: true } } },
  });
  const classIds = enr.map((e) => e.classId);
  const className = enr[0]?.class?.classCode ?? null;
  if (classIds.length === 0) return { consentGranted: true, className, total: 0, groups: [] };

  const media = await db.classSessionMedia.findMany({
    where: {
      classId: { in: classIds },
      status: "APPROVED",
      OR: [
        { tags: { some: { studentId } } }, // ảnh gắn thẻ con
        { isClassWide: true }, // ảnh chung cả lớp
      ],
    },
    // 06/09 — lấy ảnh MỚI NHẤT khi vượt trần. `asc` + `take: 200` cắt mất đúng phần
    // phụ huynh quan tâm: lớp qua 200 ảnh thì ảnh của những buổi gần đây biến mất, chỉ
    // còn ảnh đầu khoá. Bản v1 vốn lấy mới-nhất-trước.
    orderBy: [{ takenAt: "desc" }, { createdAt: "desc" }],
    select: { id: true, caption: true, fileUrl: true, classSessionId: true, takenAt: true },
    take: 200,
  });

  // Signed URL khi bật MEDIA_SIGNED_URL — cùng helper với bản v1.
  const urls = await Promise.all(media.map((m) => resolveMediaUrl(m.fileUrl)));

  // TOÀN BỘ buổi của lớp — điều kiện để `buildSessionNumberMap` đánh đúng số buổi.
  const buoiCua = new Map((await napBuoiCuaLop(classIds, new Date())).map((b) => [b.id, b]));

  const byS = new Map<string, PhotoGroup>();
  media.forEach((m, i) => {
    const key = m.classSessionId ?? "khac";
    if (!byS.has(key)) {
      const b = m.classSessionId ? buoiCua.get(m.classSessionId) : undefined;
      byS.set(key, {
        sessionId: key,
        // 08/09 — số LỘ TRÌNH, không phải hạng-theo-ngày: `title` bên dưới là
        // `nhanDayDu` ("Buổi 43 - …"), in huy hiệu "2" cạnh nó là tự mâu thuẫn.
        order: b?.soBuoiLoTrinh ?? (b && b.soBuoi > 0 ? b.soBuoi : null),
        title: b?.nhanDayDu || "Buổi học",
        dateISO: b?.ngayISO ?? m.takenAt?.toISOString() ?? "",
        nhanNgay: b?.nhanNgay ?? "",
        photos: [],
      });
    }
    byS.get(key)!.photos.push({ id: m.id, caption: m.caption, url: urls[i] ?? m.fileUrl });
  });
  // Xếp theo NGÀY buổi (mới nhất trước), không theo con số: ảnh không gắn buổi có
  // `order = null` và trước đây bị đẩy lên đầu vì `null ?? 0`.
  const groups = [...byS.values()].sort(
    (a, b) => (Date.parse(b.dateISO) || 0) - (Date.parse(a.dateISO) || 0),
  );
  return { consentGranted: true, className, total: media.length, groups };
}
