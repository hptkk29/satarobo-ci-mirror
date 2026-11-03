// lib/parttime/nhan-xet-han.ts — P5c · HẠN NHẬN XÉT BUỔI của giáo viên đứng chính (BLĐ chốt D-N3). THUẦN, không đồng hồ.
//
// "GV đứng chính phải hoàn thành nhận xét buổi chậm nhất 10:00 sáng NGÀY HÔM SAU (giờ Việt Nam)."
// Nguồn nhận xét (kiểm kê 14/10/2026): `StudentSessionFeedback` — MỘT dòng mỗi học viên × buổi (học bù ghi vào BUỔI GỐC của
// từng bé). "Hoàn thành" dùng đúng định nghĩa có sẵn của repo (`summarizeSessionFeedback`): MỌI học viên có mặt
// (PRESENT/LATE) đều có dòng nhận xét. Không có cột "nộp lúc" ⇒ mốc hoàn thành = createdAt MUỘN NHẤT trong các dòng bắt buộc
// (createdAt không đổi khi sửa nội dung; xoá rồi viết lại ⇒ mốc dời theo — đúng: giữa hai lần đó buổi thiếu nhận xét).
//
// Mốc 10:00:00 là ĐƯỢC (bao gồm) — `[P5-C03]`.

export type TrangThaiNhanXet =
  | "ON_TIME" // hoàn thành trước hoặc đúng hạn
  | "LATE" // hoàn thành SAU hạn
  | "MISSING" // quá hạn mà chưa hoàn thành
  | "PENDING" // chưa hoàn thành, chưa tới hạn
  | "KHONG_YEU_CAU" // không học viên nào có mặt ⇒ không có gì phải nhận xét
  | "CHUA_DIEM_DANH"; // không xác định được ai phải nhận xét — xem tay, không tự phạt

/** 10:00 giờ VN của ngày (theo lịch) SAU ngày buổi. `ngayBuoi` = "YYYY-MM-DD" giờ VN. */
export function hanNhanXet(ngayBuoi: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ngayBuoi)) throw new Error(`Ngày phải dạng YYYY-MM-DD: ${ngayBuoi}`);
  const [y, m, d] = ngayBuoi.split("-").map(Number);
  const sau = new Date(Date.UTC(y, m - 1, d + 1));
  return new Date(`${sau.toISOString().slice(0, 10)}T10:00:00+07:00`);
}

export type DauVaoNhanXet = {
  ngayBuoi: string;
  /** null = chưa điểm danh (không biết ai có mặt). */
  hocVienCoMat: readonly string[] | null;
  /** Dòng nhận xét đang có cho đúng các (buổi, học viên) liên quan. */
  nhanXet: readonly { studentId: string; createdAt: Date }[];
  now: Date;
};

export type KetQuaNhanXet = { trangThai: TrangThaiNhanXet; han: Date; hoanTatLuc: Date | null; canCo: number; daCo: number };

export function danhGiaNhanXet(v: DauVaoNhanXet): KetQuaNhanXet {
  const han = hanNhanXet(v.ngayBuoi);
  const quaHan = v.now.getTime() > han.getTime();
  if (v.hocVienCoMat == null) return { trangThai: quaHan ? "CHUA_DIEM_DANH" : "PENDING", han, hoanTatLuc: null, canCo: 0, daCo: 0 };
  const can = new Set(v.hocVienCoMat);
  if (can.size === 0) return { trangThai: "KHONG_YEU_CAU", han, hoanTatLuc: null, canCo: 0, daCo: 0 };
  const moc = new Map<string, Date>();
  for (const n of v.nhanXet) if (can.has(n.studentId)) moc.set(n.studentId, n.createdAt);
  const daCo = moc.size;
  if (daCo < can.size) return { trangThai: quaHan ? "MISSING" : "PENDING", han, hoanTatLuc: null, canCo: can.size, daCo };
  const hoanTatLuc = new Date(Math.max(...[...moc.values()].map((d) => d.getTime())));
  return { trangThai: hoanTatLuc.getTime() <= han.getTime() ? "ON_TIME" : "LATE", han, hoanTatLuc, canCo: can.size, daCo };
}
