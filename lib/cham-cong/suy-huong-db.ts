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
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings/service";
import { vnDateOnly, vnParts } from "@/lib/time/vn";
import { laNgayParttime } from "@/lib/parttime/che-do-huong";
import { cacBuoiTuCa, nhanBuoi, suyHuongLuot, type KetQuaSuyHuong } from "./suy-huong";

export type SuyHuongHomNay = KetQuaSuyHuong & {
  /** "buổi chiều" · "ca hôm nay" · null (không ca). */
  nhanBuoi: string | null;
  /**
   * `CA` = luật cũ theo buổi của ô ca. `PARTTIME` = ngày có phân công dạy / trực (SR.QD.238, công tắc bật): hướng theo HIỆN
   * DIỆN — có VÀO đang mở ⇒ RA, còn lại ⇒ VÀO (`lib/parttime/che-do-huong.ts`). Ô ca lịch rảnh S/C/T không còn lái hướng.
   */
  cheDo: "CA" | "PARTTIME";
};

/** Cổng ngày Parttime — lỗi bất kỳ ⇒ luật ca cũ (KHÔNG BAO GIỜ chặn chấm công vì bộ suy ngữ cảnh hỏng). */
async function cheDoAnToan(userId: string, workDate: Date): Promise<boolean> {
  try {
    return await laNgayParttime({ userId, workDate });
  } catch (e) {
    console.error("[suyHuongHomNay] cổng ngày Parttime lỗi — dùng luật ca cũ", e);
    return false;
  }
}

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
  /** H2 — giao dịch đang giữ khoá chấm công (`ghiLuotTuanTu`): đọc lượt trong ngày SAU khi đã giữ khoá. Không truyền = `db` (dự đoán). */
  client?: Prisma.TransactionClient;
}): Promise<SuyHuongHomNay> {
  const workDate = vnDateOnly(input.now);
  const c = input.client ?? db;
  const [assignment, wl, logs, parttime] = await Promise.all([
    c.shiftAssignment.findFirst({
      where: { userId: input.userId, workDate, status: "ACTIVE" },
      select: { segments: true, soCapQuetKyVong: true, orgUnitId: true },
    }),
    input.workLocationId
      ? c.workLocation.findUnique({ where: { id: input.workLocationId }, select: { orgUnitId: true } })
      : Promise.resolve(null),
    c.staffTimeLog.findMany({
      where: { userId: input.userId, workDate, result: "ACCEPTED", reviewStatus: { not: "DISMISSED" } },
      orderBy: { loggedAt: "asc" },
      select: { loggedAt: true, direction: true },
    }),
    cheDoAnToan(input.userId, workDate),
  ]);
  const orgUnitId = wl?.orgUnitId ?? assignment?.orgUnitId ?? null;
  const phutTrung = await getSetting("shift.duplicateTapMinutes", { orgUnitId });

  const segments = Array.isArray(assignment?.segments)
    ? (assignment.segments as { start?: unknown; end?: unknown }[]).filter(
        (s): s is { start: string; end: string } => typeof s?.start === "string" && typeof s?.end === "string",
      )
    : [];
  // Ngày Parttime ⇒ KHÔNG đưa buổi của ô ca vào luật: không buổi ⇒ luật (d) xen kẽ theo lượt trước = theo hiện diện (luật bấm
  // trùng (a) vẫn đứng trước). `[CHH-*]` (tests/cham-cong/parttime-ngu-canh.spec.ts).
  const cacBuoi = assignment && !parttime ? cacBuoiTuCa(segments, assignment.soCapQuetKyVong) : [];
  const kq = suyHuongLuot({
    gioQuet: phutVN(input.now),
    cacBuoi,
    luotTruoc: logs.map((l) => ({ gio: phutVN(l.loggedAt), huong: l.direction })),
    phutTrung,
  });
  return { ...kq, nhanBuoi: nhanBuoi(cacBuoi, kq.buoi), cheDo: parttime ? "PARTTIME" : "CA" };
}

/** "HH:mm" giờ VN — chữ in ra cho người vừa bấm, đúng mốc đã ghi vào `loggedAt`. */
export function gioVNCuaLuot(d: Date): string {
  const p = vnParts(d);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}
