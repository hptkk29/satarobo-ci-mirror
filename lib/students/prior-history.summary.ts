// lib/students/prior-history.summary.ts — phần THUẦN của "khách đã từng học ở đâu".
//
// Tách khỏi `prior-history.ts` (file kia có `import "server-only"` nên Vitest nạp là ném)
// để câu chữ hiển thị cho sale được khoá bằng unit test — xem `prior-history.summary.test.ts`.
// Ở đây KHÔNG được đụng DB và KHÔNG được nhận thêm trường PII nào.

export type PriorHistoryRole = "LEAD" | "STUDENT";

export type PriorHistoryRecord = {
  role: PriorHistoryRole;
  /** Tên cơ sở; null = chưa gắn cơ sở (lead mới về, chưa chia). */
  centerName: string | null;
  /** Nhãn tiếng Việt của trạng thái hồ sơ tại thời điểm tra. */
  statusLabel: string;
  /** Mốc gần nhất biết được (ngày ghi danh / ngày tạo lead). */
  at: Date | null;
  /** Hồ sơ học viên đã bị xoá khỏi hệ thống (nghỉ hẳn). */
  removed: boolean;
};

export const LEAD_STATUS_VI: Record<string, string> = {
  NEW: "mới",
  CONTACTED: "đã liên hệ",
  QUALIFIED: "đủ điều kiện",
  TRIAL: "đã học thử",
  ENROLLED: "đã đăng ký",
  LOST: "không thành",
  DUPLICATE: "trùng",
};

export const STUDENT_STATUS_VI: Record<string, string> = {
  ACTIVE: "đang học",
  PAUSED: "bảo lưu",
  GRADUATED: "đã hoàn thành khoá",
  INACTIVE: "đã nghỉ học",
};

function formatVN(d: Date | null): string {
  if (!d) return "";
  return new Date(d).toLocaleDateString("vi-VN", {
    month: "2-digit",
    year: "numeric",
  });
}

/**
 * THUẦN — gộp các bản ghi thành MỘT câu cho sale đọc. Trả `null` khi không có gì đáng nói
 * (không có lịch sử, hoặc chỉ có hồ sơ trong chính cơ sở của người đang tra).
 */
export function summarizePriorHistory(records: PriorHistoryRecord[]): string | null {
  if (records.length === 0) return null;

  // Ưu tiên kể chuyện "đã từng HỌC" trước — đó mới là thông tin sale cần nhất.
  const students = records.filter((r) => r.role === "STUDENT");
  const leads = records.filter((r) => r.role === "LEAD");

  const parts: string[] = [];
  for (const r of students.slice(0, 3)) {
    const at = formatVN(r.at);
    parts.push(
      `đã từng học tại ${r.centerName ?? "cơ sở chưa rõ"}` +
        (at ? ` (từ ${at})` : "") +
        ` — ${r.removed ? "hồ sơ đã đóng" : r.statusLabel}`,
    );
  }
  if (students.length === 0) {
    for (const r of leads.slice(0, 3)) {
      const at = formatVN(r.at);
      parts.push(
        `đã có hồ sơ tư vấn tại ${r.centerName ?? "cơ sở chưa rõ"}` +
          (at ? ` (${at})` : "") +
          ` — ${r.statusLabel}`,
      );
    }
  }
  if (parts.length === 0) return null;

  return `Khách này ${parts.join("; ")}.`;
}

