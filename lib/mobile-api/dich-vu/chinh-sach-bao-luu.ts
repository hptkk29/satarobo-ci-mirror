import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings/service";

import type { MaHocVienDaKiem } from "../so-huu";

/**
 * D01-BL (chủ dự án chốt 19/11/2026): «Sử dụng chính sách bảo lưu ĐANG TỒN TẠI trong hệ thống». Mobile KHÔNG gõ cứng số tháng — hàm này đọc đúng các tham số của web:
 *   · `pause.enabled` theo CƠ SỞ (`orgUnitId` của học viên — KHÔNG phải `centerId`, bài học của `lib/bao-luu/feature.ts`);
 *   · `enrollment.suspendMaxMonths` (trần toàn hệ), `pause.extendTimes`, `pause.extendMaxMonths`, `pause.maxPerEnrollment`, `pause.backdateMaxSessions`, `pause.minDays`, `pause.medicalProofDays`, `pause.maxOverdueDebtDays`;
 *   · `Course.allowPause` THEO KHOÁ mà con đang học (Đào tạo tự đặt — `lib/bao-luu/khoa-cho-phep.ts`).
 *
 * ⚠️ Trang yêu cầu bảo lưu của phụ huynh trên WEB chỉ TẠO BẢN GHI `ParentRequest(RESERVE)`; trần/điều kiện kiểm khi NHÂN SỰ lập/duyệt hồ sơ. Vì vậy endpoint này chỉ để HIỂN THỊ giới hạn
 * và CẢNH BÁO — nó KHÔNG chặn việc gửi yêu cầu (một bộ luật duy nhất, ở phía nhân sự). `canhBao` là câu chữ sinh từ dữ liệu, không phải luật thứ hai.
 *
 * Giá trị đang hiệu lực trên PROD hôm nay KHÔNG xác định được từ mã (xem `docs/MOBILE-DECISION-REGISTER.md` §5): endpoint trả nguyên văn cấu hình mà `getSetting` giải ra.
 */
export type ChinhSachBaoLuuDto = {
  /** `pause.enabled` của cơ sở. Tắt ⇒ nhân sự CHƯA lập/duyệt được hồ sơ ở cơ sở này (phụ huynh vẫn gửi được yêu cầu như web). */
  coSoDangBat: boolean;
  toiDaThang: number;
  giaHan: { soLanToiDa: number; moiLanToiDaThang: number };
  soLanBaoLuuToiDaMoiGhiDanh: number;
  lungNgayToiDaBuoi: number;
  /** 0 = không quy định. */
  nganNhatNgay: number;
  omDauPhaiCoMinhChungTrenNgay: number;
  congNoQuaHanChanDuyetNgay: number;
  khoaDangHoc: Array<{ khoaId: string; tenKhoa: string; choPhepBaoLuu: boolean }>;
  /** Câu chữ cảnh báo SINH TỪ DỮ LIỆU ở trên (rỗng = không có gì phải cảnh báo). Không chặn gửi yêu cầu. */
  canhBao: string[];
};

export async function layChinhSachBaoLuu(hs: MaHocVienDaKiem): Promise<ChinhSachBaoLuuDto> {
  const sv = await db.student.findUniqueOrThrow({
    where: { id: hs },
    select: {
      orgUnitId: true,
      enrollments: {
        where: { deletedAt: null, status: { in: ["CONFIRMED", "STUDYING", "ACTIVE"] } },
        select: { course: { select: { id: true, name: true, allowPause: true } } },
      },
    },
  });
  const o = { orgUnitId: sv.orgUnitId ?? null };
  const [enabled, toiDaThang, extendTimes, extendMaxMonths, maxPerEnrollment, backdate, minDays, medicalDays, debtDays] = await Promise.all([
    getSetting("pause.enabled", o),
    getSetting("enrollment.suspendMaxMonths", o),
    getSetting("pause.extendTimes", o),
    getSetting("pause.extendMaxMonths", o),
    getSetting("pause.maxPerEnrollment", o),
    getSetting("pause.backdateMaxSessions", o),
    getSetting("pause.minDays", o),
    getSetting("pause.medicalProofDays", o),
    getSetting("pause.maxOverdueDebtDays", o),
  ]);

  const seen = new Set<string>();
  const khoaDangHoc = sv.enrollments
    .map((e) => e.course)
    .filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)))
    .map((c) => ({ khoaId: c.id, tenKhoa: c.name, choPhepBaoLuu: c.allowPause }));

  const canhBao: string[] = [];
  if (!enabled) canhBao.push("Cơ sở của con chưa bật bảo lưu. Ba mẹ vẫn gửi được yêu cầu — trung tâm sẽ liên hệ lại.");
  for (const k of khoaDangHoc) if (!k.choPhepBaoLuu) canhBao.push(`Khoá «${k.tenKhoa}» hiện không áp dụng bảo lưu. Ba mẹ vẫn gửi được yêu cầu — trung tâm sẽ phản hồi.`);

  return {
    coSoDangBat: enabled,
    toiDaThang,
    giaHan: { soLanToiDa: extendTimes, moiLanToiDaThang: extendMaxMonths },
    soLanBaoLuuToiDaMoiGhiDanh: maxPerEnrollment,
    lungNgayToiDaBuoi: backdate,
    nganNhatNgay: minDays,
    omDauPhaiCoMinhChungTrenNgay: medicalDays,
    congNoQuaHanChanDuyetNgay: debtDays,
    khoaDangHoc,
    canhBao,
  };
}
