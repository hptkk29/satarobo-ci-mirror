// lib/entitlements/hoc-vuot.ts — HỌC VƯỢT (catch-up): phép tính THUẦN, chưa có bảng/giao diện.
//
// Học vượt = dạy bù các bài ĐÃ QUA cho học viên vào lớp giữa chừng. Một BUỔI học vượt gồm nhiều BÀI
// (tối đa `baiMoiBuoi`, mặc định 3 — S4). Hàm này chỉ trả lời "bao nhiêu buổi", không xếp lịch.
//
// Mô hình dữ liệu của học vượt (MakeupNeed.kind / MakeupCaseLesson) thuộc chương trình học bù và
// CHƯA có ở đây — xem BA Phần 4(a) §3. Đừng thêm bảng ở file này.

/** Số buổi học vượt cần để dạy `soBai` bài, mỗi buổi tối đa `baiMoiBuoi` bài. */
export function soBuoiHocVuot(soBai: number, baiMoiBuoi = 3): number {
  if (!Number.isInteger(soBai) || soBai < 0) throw new RangeError("soBai phải là số nguyên không âm");
  if (!Number.isInteger(baiMoiBuoi) || baiMoiBuoi < 1) throw new RangeError("baiMoiBuoi phải là số nguyên từ 1");
  return Math.ceil(soBai / baiMoiBuoi);
}

/** Chia danh sách bài thành các buổi, giữ nguyên thứ tự bài. */
export function chiaBaiThanhBuoi(bai: readonly number[], baiMoiBuoi = 3): number[][] {
  if (!Number.isInteger(baiMoiBuoi) || baiMoiBuoi < 1) throw new RangeError("baiMoiBuoi phải là số nguyên từ 1");
  const ra: number[][] = [];
  for (let i = 0; i < bai.length; i += baiMoiBuoi) ra.push(bai.slice(i, i + baiMoiBuoi));
  return ra;
}
