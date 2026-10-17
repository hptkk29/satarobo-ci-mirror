// lib/parttime/che-do-huong.ts — CỔNG "ngày Parttime" cho việc suy VÀO / RA của nút Chấm công (SR.QD.238).
//
// VÌ SAO: luật suy hướng cũ (`suyHuongLuot`) dùng các BUỔI của ô ca hôm nay. Giáo viên Parttime thường có ô ca lịch rảnh
// (S/C/T) KHÔNG trùng giờ dạy — đo prod 15/09–13/10/2026: 86 buổi lớp, 75 buổi GV có ô ca hôm đó, 7 buổi ô ca HẾT trước giờ
// phải có mặt, 3 buổi ô ca BẮT ĐẦU sau giờ phải có mặt. Với ô ca C 13:45–17:30, GV tới 17:47 dạy lớp 18:00 bị ghi **RA**
// (`RA_QUEN_VAO`) — sai đúng lượt quan trọng nhất của ngày.
//
// LUẬT: ngày Parttime (công tắc `shift.phanCongNhanLopBat` BẬT · ngày thuộc SR.QD.238 · người đó có ÍT NHẤT MỘT phân công
// dạy / trợ giảng hoặc MỘT dòng trực vận hành CÒN SỐNG hôm nay) ⇒ hướng theo HIỆN DIỆN: có lượt VÀO đang mở ⇒ RA, còn lại ⇒ VÀO
// (giữ luật bấm trùng). Ngày khác ⇒ luật ca cũ, KHÔNG đổi một dòng nào.
//
// MỘT hàm, gọi từ MỘT chỗ (`suyHuongHomNay`) ⇒ dự đoán trên trang, lượt ghi thật (`recordCheckin`) và lượt công tác
// (`cong-tac-action`) luôn cùng một câu trả lời. KHÔNG xét vai RBAC (`User.role`): người có phân công thật mới là ngày Parttime.
//
// Công tắc TẮT ⇒ trả `false` NGAY, không câu tra nào thêm (hành vi cũ nguyên vẹn, kể cả số câu tra).
// Lỗi bất kỳ ⇒ nơi gọi rơi về luật ca cũ (không bao giờ chặn chấm công).
import { db } from "@/lib/db";
import { chinhSachTaiNgay } from "./chinh-sach";
import { docChinhSach, phanCongBat } from "./phan-cong-db";

const SONG = ["PROPOSED", "WAITING_ACCEPTANCE", "ACCEPTED", "ACTIVE", "COMPLETED"] as const;

/** `workDate` = ngày VN (nửa đêm UTC, như `vnDateOnly`). */
export async function laNgayParttime(p: { userId: string; workDate: Date }): Promise<boolean> {
  if (!(await phanCongBat())) return false;
  const ymd = p.workDate.toISOString().slice(0, 10);
  const [chinhSach, day, truc] = await Promise.all([
    docChinhSach(),
    db.sessionStaffAssignment.count({ where: { userId: p.userId, ngay: p.workDate, status: { in: [...SONG] }, role: { in: ["MAIN_TEACHER", "TEACHING_ASSISTANT"] } } }),
    db.operationsDutyAssignment.count({ where: { userId: p.userId, workDate: p.workDate, status: { in: [...SONG] } } }),
  ]);
  const cs = chinhSachTaiNgay(chinhSach, ymd);
  return !!cs && cs.thamSo.loai === "SR_QD_238" && day + truc > 0;
}
