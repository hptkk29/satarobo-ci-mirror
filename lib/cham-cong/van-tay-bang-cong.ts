// lib/cham-cong/van-tay-bang-cong.ts — VÂN TAY bảng công (P2.2). Tách khỏi `xac-nhan-cong-thuan.ts` vì
// dùng `node:crypto`: file thuần kia được màn nhân sự (client) nhập, nhét crypto vào là vỡ bundle trình duyệt.
// Danh sách cột + luật "dòng rỗng không tính" ở `xac-nhan-cong-thuan.ts`.
import { createHash } from "node:crypto";
import { coNghia, r4, ymd, type DongCong } from "./xac-nhan-cong-thuan";

function chuanHoa(d: DongCong): string {
  return [
    ymd(d.workDate),
    d.templateCode ?? "",
    d.dayType,
    d.expectedMinutes,
    d.workedMinutes,
    d.lateMinutes,
    d.earlyLeaveMinutes,
    d.lateApprovedMinutes,
    d.earlyLeaveApprovedMinutes,
    d.otPayableMinutes,
    d.holidayWorkMinutes,
    d.restDayWorkMinutes,
    r4(d.dayCreditEarned),
    r4(d.hourCredit),
    r4(d.leaveUnits),
    r4(d.holidayPaidUnits),
    d.overrideUnits === null ? "" : r4(d.overrideUnits),
    d.absenceStatus ?? "",
  ].join("|");
}

/** Vân tay của bảng công (thứ tự dòng vào không quan trọng; dòng rỗng không tính — `laDongRong`). */
export function vanTayBangCong(rows: readonly DongCong[]): string {
  const dong = coNghia(rows).map(chuanHoa);
  return createHash("sha256").update(`v1\n${dong.join("\n")}`).digest("hex");
}
