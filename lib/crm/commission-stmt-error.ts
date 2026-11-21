// lib/crm/commission-stmt-error.ts — LỖI của bảng kê hoa hồng CŨ (`CommissionStatement`). Tách khỏi `commission-statement.ts` để cổng cutover
// (`commission-cutover-gate.ts`) và `trial-teacher-commission.ts` ném CÙNG MỘT lớp lỗi mà các action cũ (`app/(admin)/admin/crm/commission/actions.ts`)
// đang bắt (`e instanceof CommissionStmtError`) — nếu không, người bấm nút nhận "Lỗi duyệt" chung chung thay vì lý do thật.
export class CommissionStmtError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "CommissionStmtError";
    this.code = code;
  }
}
