// lib/lms/scheduling.ts — R3-03: phát hiện trùng lịch phòng/GV + sức chứa (THUẦN, M1).
export type Slot = {
  id?: string;
  roomId?: string | null;
  teacherId?: string | null;
  startAt: Date;
  endAt: Date;
};

/** 2 khoảng thời gian có giao nhau không (THUẦN). */
export function overlaps(a: { startAt: Date; endAt: Date }, b: { startAt: Date; endAt: Date }): boolean {
  return a.startAt < b.endAt && b.startAt < a.endAt;
}

/** Phát hiện trùng phòng (C3.1) / trùng GV (C3.2) với các slot hiện có. THUẦN. */
export function detectScheduleConflict(
  existing: Slot[],
  candidate: Slot,
): { roomConflict: boolean; teacherConflict: boolean; conflictIds: string[] } {
  const conflictIds: string[] = [];
  let roomConflict = false;
  let teacherConflict = false;
  for (const s of existing) {
    if (s.id && candidate.id && s.id === candidate.id) continue; // bỏ qua chính nó
    if (!overlaps(s, candidate)) continue;
    if (candidate.roomId && s.roomId === candidate.roomId) {
      roomConflict = true;
      if (s.id) conflictIds.push(s.id);
    }
    if (candidate.teacherId && s.teacherId === candidate.teacherId) {
      teacherConflict = true;
      if (s.id) conflictIds.push(s.id);
    }
  }
  return { roomConflict, teacherConflict, conflictIds: [...new Set(conflictIds)] };
}

/** Phòng/GV hiệu lực của một buổi — trước hoặc sau một thao tác. */
export type TaiNguyenBuoi = { roomId: string | null; teacherId: string | null };

/**
 * THUẦN — một thao tác trên buổi được CHẶN vì tài nguyên nào (09/10/2026).
 *
 * Luật: chỉ chặn vì thứ THAO TÁC NÀY làm đổi. Đổi giờ ⇒ kiểm cả phòng lẫn GV (khung mới
 * đè lên lịch người khác). Giờ giữ nguyên ⇒ chỉ kiểm tài nguyên đổi sang giá trị khác.
 * `truoc = null` = buổi MỚI ⇒ kiểm hết.
 *
 * Vì sao: duyệt đơn "Dạy thay" chỉ đổi GV, nhưng bản cũ kiểm luôn phòng hiện tại của buổi
 * ⇒ một trùng phòng CÓ SẴN (hai lớp cùng phòng CS1-201, CN 09:45, 43 tuần trên prod) chặn
 * đơn với câu "Trùng phòng" — thao tác không hề chạm phòng. Trùng có sẵn vẫn được báo,
 * nhưng là CẢNH BÁO (xem `kiemTrungThaoTacBuoi`), không phải cổng.
 */
export function phamViKiemTrung(input: {
  truoc: TaiNguyenBuoi | null;
  sau: TaiNguyenBuoi;
  doiGio: boolean;
}): { chanPhong: boolean; chanGv: boolean } {
  const { truoc, sau, doiGio } = input;
  return {
    chanPhong: !!sau.roomId && (truoc === null || doiGio || sau.roomId !== truoc.roomId),
    chanGv: !!sau.teacherId && (truoc === null || doiGio || sau.teacherId !== truoc.teacherId),
  };
}

/**
 * Giờ kết thúc 1 buổi (THUẦN) = startAt + thời lượng suy từ khung giờ lớp
 * ("HH:mm"). Nếu thiếu/không hợp lệ startTime+endTime → dùng `fallbackMinutes`.
 * Dùng để dựng `Slot.endAt` cho detectScheduleConflict.
 */
export function sessionEndAt(
  startAt: Date,
  startTime?: string | null,
  endTime?: string | null,
  fallbackMinutes = 120,
): Date {
  const toMin = (t?: string | null): number | null => {
    if (!t) return null;
    const [h, m] = t.split(":").map((x) => parseInt(x, 10));
    if (Number.isNaN(h)) return null;
    return (h || 0) * 60 + (m || 0);
  };
  const s = toMin(startTime);
  const e = toMin(endTime);
  const dur = s != null && e != null && e > s ? e - s : fallbackMinutes;
  return new Date(startAt.getTime() + dur * 60 * 1000);
}

/** C3.4 — còn chỗ ghi danh không (chặn cứng khi vượt maxStudents). THUẦN. */
export function hasCapacity(currentCount: number, maxStudents: number | null | undefined): boolean {
  if (maxStudents == null) return true; // không giới hạn
  return currentCount < maxStudents;
}
