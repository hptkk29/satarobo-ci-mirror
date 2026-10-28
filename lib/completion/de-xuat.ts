// lib/completion/de-xuat.ts — cảnh báo trước khi đề xuất hoàn thành khoá.
//
// Vì sao (QA site GV vòng 1, BUG-028): nút "Đề xuất hoàn thành" bấm một lần là gửi
// thẳng lên trung tâm, không xác nhận, không cảnh báo. Trên UAT đề xuất được cho một em
// chuyên cần 0/7 buổi, và cho cả lớp mới đi 7/11 buổi.
//
// CẢNH BÁO, KHÔNG PHẢI CHẶN — cố ý. Có ca hợp lệ thật: em chuyển từ cơ sở khác sang
// giữa khoá, hoặc lớp rút ngắn theo thoả thuận. Chặn cứng là đẩy giáo viên đi tìm đường
// vòng. Việc của hàm này là bắt người bấm nhìn thấy con số trước khi gửi.
//
// PURE — không DB, không "use server".

export type CanhBaoDeXuat =
  | "CHUA_DI_BUOI_NAO"
  | "CHUYEN_CAN_THAP"
  | "KHOA_CHUA_KET_THUC";

/** Dưới ngưỡng này thì hỏi lại. Không phải quy chế — chỉ là mốc để cảnh báo. */
export const NGUONG_CHUYEN_CAN = 0.6;

export function canhBaoDeXuat(args: {
  /** Số buổi em đã đi học. */
  attended: number;
  /** Số buổi ĐÃ DẠY của lớp — mẫu số để đo em có theo kịp không. */
  heldSessions: number;
  /** Tổng số buổi của khoá — để biết khoá đã chạy hết chưa. */
  totalSessions: number;
}): CanhBaoDeXuat[] {
  const out: CanhBaoDeXuat[] = [];

  // Chia cho 0: lớp chưa dạy buổi nào thì không kết luận gì về chuyên cần được.
  if (args.heldSessions > 0) {
    if (args.attended === 0) {
      out.push("CHUA_DI_BUOI_NAO");
    } else if (args.attended / args.heldSessions < NGUONG_CHUYEN_CAN) {
      out.push("CHUYEN_CAN_THAP");
    }
  }

  if (args.totalSessions > 0 && args.heldSessions < args.totalSessions) {
    out.push("KHOA_CHUA_KET_THUC");
  }
  return out;
}

export const CANH_BAO_LABEL: Record<CanhBaoDeXuat, string> = {
  CHUA_DI_BUOI_NAO: "Học viên chưa đi buổi nào.",
  CHUYEN_CAN_THAP: "Chuyên cần dưới 60% số buổi đã dạy.",
  KHOA_CHUA_KET_THUC: "Khoá học chưa dạy hết số buổi.",
};

/** Câu hỏi xác nhận — gộp cảnh báo thành một chuỗi cho hộp thoại. */
export function loiXacNhanDeXuat(
  studentName: string,
  canhBao: CanhBaoDeXuat[],
): string {
  const dau = `Gửi đề xuất hoàn thành khoá cho ${studentName}?`;
  if (canhBao.length === 0) {
    return `${dau}\n\nTrung tâm sẽ duyệt trước khi cấp chứng nhận.`;
  }
  return `${dau}\n\n${canhBao
    .map((c) => `• ${CANH_BAO_LABEL[c]}`)
    .join("\n")}\n\nVẫn gửi?`;
}
