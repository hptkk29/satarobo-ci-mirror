// lib/students/noi-lead-cong-ghi.ts — ĐẦU RA CHO OWNER KÝ của lệnh «nối học viên ↔ lead» (`scripts/noi-hoc-vien-voi-lead.ts`), cổng ghi Wave 1 (`lib/security/cong-ghi-wave1.ts`, tài liệu 15).
// THUẦN: không DB, không đồng hồ. Cùng một hàm dựng dòng cho chạy thử (xuất tệp để ký) và cho lệnh ghi (tự dựng lại trước phép ghi đầu tiên) — hai bên không thể lệch định dạng.
import type { ChuoiBangChung } from "./noi-lead-cu";

/** Phần của một dòng kế hoạch nối mà chữ ký phủ: HV nào → lead/bé nào, theo chuỗi bằng chứng nào. Không tên/SĐT/email. Đổi định dạng = đổi digest của mọi artifact đã ký. */
export type DongNoiHocVien = { studentId: string; leadId: string; leadChildId: string | null; chain: ChuoiBangChung };

export function dongDauRaNoiHocVien(keHoach: readonly DongNoiHocVien[]): string[] {
  return keHoach.map((k) => ["noi-hoc-vien/v1", k.studentId, k.leadId, k.leadChildId ?? "", k.chain].join("|"));
}
