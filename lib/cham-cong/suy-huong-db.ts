// lib/cham-cong/suy-huong-db.ts — cầu DB cho `suyHuongLuot`: đọc ô ca + lượt trong ngày + tham số
// bấm trùng, rồi hỏi luật thuần. Hai Server Action chấm công (QR + công tác) cùng gọi MỘT hàm này
// — đừng tự đọc lại ca/lượt ở chỗ gọi.
//
// Không "use server": chỉ action (đã auth + quyền) gọi vào.
//
// ⚠️ NGUỒN ĐỌC phải khớp hai bên đang tính công:
//   · ô ca  — `ShiftAssignment` ACTIVE của ngày, cột `segments` + `soCapQuetKyVong` (bản CHỤP lúc
//     xếp ca), đúng thứ `recompute.ts` đưa vào engine;
//   · lượt  — `result = ACCEPTED` như `acceptedLogsOfDay`, TRỪ lượt `reviewStatus = DISMISSED`
//     (lượt quét gốc đã bị quản lý GHI ĐÈ bằng chỉnh tay — chốt 06/10/2026: giữ để xem/audit
//     nhưng KHÔNG còn tính công). Lượt đã bị thay thế mà vẫn vào đây thì lượt cuối của ngày là
//     một lượt không còn tồn tại trong phép tính, và hướng suy ra lệch theo nó;
//   · `shift.duplicateTapMinutes` — theo CÙNG `orgUnitId` mà `recordTimeLog` dùng
//     (`điểm chấm ?? ô ca`), để "trùng" ở đây và cờ `TRUNG_2_PHUT` ở đó là một câu trả lời.
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings/service";
import { vnDateOnly, vnParts } from "@/lib/time/vn";
import { cacBuoiTuCa, nhanBuoi, suyHuongLuot, type KetQuaSuyHuong } from "./suy-huong";

export type SuyHuongHomNay = KetQuaSuyHuong & {
  /** "buổi chiều" · "ca hôm nay" · null (không ca). */
  nhanBuoi: string | null;
};

const phutVN = (d: Date) => {
  const p = vnParts(d);
  return p.hour * 60 + p.minute;
};

export async function suyHuongHomNay(input: {
  userId: string;
  /** Điểm chấm của lượt QR; `null` = lượt công tác. */
  workLocationId: string | null;
  /** Mốc của lượt — truyền ĐÚNG mốc sẽ đưa vào `recordTimeLog({ now })`. */
  now: Date;
}): Promise<SuyHuongHomNay> {
  const workDate = vnDateOnly(input.now);
  const [assignment, wl, logs] = await Promise.all([
    db.shiftAssignment.findFirst({
      where: { userId: input.userId, workDate, status: "ACTIVE" },
      select: { segments: true, soCapQuetKyVong: true, orgUnitId: true },
    }),
    input.workLocationId
      ? db.workLocation.findUnique({ where: { id: input.workLocationId }, select: { orgUnitId: true } })
      : Promise.resolve(null),
    db.staffTimeLog.findMany({
      where: { userId: input.userId, workDate, result: "ACCEPTED", reviewStatus: { not: "DISMISSED" } },
      orderBy: { loggedAt: "asc" },
      select: { loggedAt: true, direction: true },
    }),
  ]);
  const orgUnitId = wl?.orgUnitId ?? assignment?.orgUnitId ?? null;
  const phutTrung = await getSetting("shift.duplicateTapMinutes", { orgUnitId });

  const segments = Array.isArray(assignment?.segments)
    ? (assignment.segments as { start?: unknown; end?: unknown }[]).filter(
        (s): s is { start: string; end: string } => typeof s?.start === "string" && typeof s?.end === "string",
      )
    : [];
  const cacBuoi = assignment ? cacBuoiTuCa(segments, assignment.soCapQuetKyVong) : [];
  const kq = suyHuongLuot({
    gioQuet: phutVN(input.now),
    cacBuoi,
    luotTruoc: logs.map((l) => ({ gio: phutVN(l.loggedAt), huong: l.direction })),
    phutTrung,
  });
  return { ...kq, nhanBuoi: nhanBuoi(cacBuoi, kq.buoi) };
}

/** "HH:mm" giờ VN — chữ in ra cho người vừa bấm, đúng mốc đã ghi vào `loggedAt`. */
export function gioVNCuaLuot(d: Date): string {
  const p = vnParts(d);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}
