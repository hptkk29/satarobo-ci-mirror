import { getParentChildrenOverview } from "@/lib/portal/dashboard";
import { getParentProfile } from "@/lib/portal/parent-profile";

/**
 * `GET /auth/me` — hàm tầng DUY NHẤT được gọi hàm đọc của web (lib/portal) cho "tôi là ai". Dùng lại nghiệp vụ web, KHÔNG viết lại.
 * `parentUserId` chỉ lấy từ phiên đã xác thực — không bao giờ từ thân / tham số của client.
 * Bỏ khỏi phản hồi: `debt`, `pendingHomework` (ngoài P0), `familyCode`, `parent2*`, `address`, `tokenVersion`, `grants`, `centerId`.
 * `className` của nguồn thực chất là MÃ lớp ⇒ trả dưới tên `classCode`.
 */
export type ChildSummaryDto = {
  id: string;
  name: string;
  studentCode: string | null;
  courseName: string | null;
  classCode: string | null;
  centerName: string | null;
  attendanceRate: number;
  courseProgressRate: number;
  attended: number;
  daDienRa: number;
  totalSessions: number;
  needMakeup: number;
  nextSessionLabel: string | null;
};

export type MeDto = {
  name: string;
  email: string;
  phone: string | null;
  quyDinh: { ap: boolean; daDongY: boolean };
  children: ChildSummaryDto[];
};

const THU = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];

/** Nhãn buổi kế tiếp theo giờ Việt Nam, ví dụ "Thứ 7, 21/11 · 08:00". Máy chủ định dạng để app không phụ thuộc múi giờ của máy. */
export function nhanBuoiKeTiep(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  const thuIdx = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(g("weekday"));
  return `${THU[thuIdx] ?? ""}, ${g("day")}/${g("month")} · ${g("hour")}:${g("minute")}`;
}

export async function layMe(parentUserId: string): Promise<MeDto> {
  const [profile, tongQuan] = await Promise.all([getParentProfile(parentUserId, null), getParentChildrenOverview(parentUserId)]);
  const coSo = new Map(profile.children.map((c) => [c.id, c.centerName]));
  return {
    name: profile.name,
    email: profile.email,
    phone: profile.phone,
    quyDinh: { ap: profile.quyDinh.ap, daDongY: profile.quyDinh.daDongY },
    children: tongQuan.map((c) => ({
      id: c.id,
      name: c.name,
      studentCode: c.studentCode,
      courseName: c.courseName,
      classCode: c.className,
      centerName: coSo.get(c.id) ?? null,
      attendanceRate: c.attendanceRate,
      courseProgressRate: c.courseProgressRate,
      attended: c.attended,
      daDienRa: c.daDienRa,
      totalSessions: c.totalSessions,
      needMakeup: c.needMakeup,
      nextSessionLabel: nhanBuoiKeTiep(c.nextSessionDate),
    })),
  };
}
