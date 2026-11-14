// lib/enrollments/ke-hoach-di-lich-su.ts — ĐIỂM DANH + NHẬN XÉT ĐI THEO HỌC VIÊN SANG LỚP MỚI. THUẦN, không DB.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO CÓ [chủ dự án, 06/11/2026]
//
//   "Chuyển lớp của 1 học viên thì các buổi điểm danh, các nhận xét của học viên đó bị MẤT khi sang lớp mới,
//    và giáo viên phải nhận xét lại — là đường sai."
//
// Gốc: `Attendance` và `StudentSessionFeedback` gắn theo (BUỔI, học viên) mà buổi thuộc về MỘT lớp. Chuyển lớp tạo ghi danh mới và
// đánh dấu ghi danh cũ `TRANSFERRED`, còn hai bảng ấy ở nguyên buổi của lớp cũ — nên ở lớp mới, mọi buổi cùng bài đã qua đều trống.
// Đo prod 06/11: 11 lượt chuyển lớp, 143 dòng điểm danh + 32 nhận xét nằm lại ở lớp cũ.
//
// ─────────────────────────────────────────────────────────────────────────────
// LUẬT (mỗi dòng là một quyết định, và có ca test canh)
//
//  1. GHÉP THEO BÀI HỌC. Buổi cũ → buổi CÙNG `lessonId` của lớp mới (không huỷ). Khác khoá thì không có bài chung ⇒ không ghép được
//     (đúng: bài của khoá cũ không tồn tại ở khoá mới) — không đoán theo số thứ tự buổi.
//  2. CHỈ buổi lớp mới ĐÃ DIỄN RA TẠI LÚC HỌC VIÊN CHUYỂN SANG (`date <= now`, với `now` = thời điểm chuyển). Buổi sau mốc đó học viên đã là
//     thành viên lớp mới và việc chấm là của giáo viên lớp mới — ghi sẵn "có mặt" lên đó là điểm danh khống, đè lên việc giáo viên chấm.
//     ⚠️ Bản vá dữ liệu cũ từng dùng `now()` của LÚC CHẠY thay vì mốc chuyển và ghi nhầm 2/50 dòng (08/11/2026) — `[LSH-DB-08]` canh đúng chỗ này.
//  3. ĐIỂM DANH: chỉ chuyển CÓ MẶT / TRỄ ("đã học bài này"). KHÔNG chuyển vắng: vắng phải đi kèm dòng cần bù (`needsMakeup`, kiểm
//     toàn vẹn học bù) mà dòng cần bù thuộc điểm danh ở lớp cũ — chép vắng sang là đẻ ra "vắng mà không có dòng cần bù".
//     Lớp mới đã có dòng điểm danh thì GIỮ nguyên dòng ấy (giáo viên lớp mới đã chấm thật).
//  4. NHẬN XÉT: chuyển hết. Lớp mới ĐÃ có nhận xét cho buổi đó (giáo viên nhận xét chồng) ⇒ LẤY CÁI ĐẦU: bản có `createdAt` SỚM HƠN
//     thắng; nếu bản nguồn sớm hơn thì nó thay nội dung bản đích (nội dung bị thay phải được lưu vào audit — người gọi lo).
//  5. Nhiều buổi nguồn cùng một bài (học bù…) rơi vào cùng một buổi đích ⇒ chọn buổi nguồn SỚM NHẤT (điểm danh theo ngày buổi,
//     nhận xét theo `createdAt`).
//  6. Chạy lại bao nhiêu lần cũng không đẻ thêm: dòng đã có ở đích ⇒ không tạo (điểm danh) / không thay vì nguồn không còn sớm hơn
//     (nhận xét, sau lần thay đầu `createdAt` của bản đích = của nguồn).

export type BuoiDich = {
  id: string;
  lessonId: string | null;
  date: Date;
  /** `ClassSession.status` — chỉ để loại buổi đã huỷ. */
  status: string;
};

export type DiemDanhNguon = {
  id: string;
  sessionId: string;
  lessonId: string | null;
  ngayBuoi: Date;
  status: string;
};

export type NhanXetNguon = {
  id: string;
  sessionId: string;
  lessonId: string | null;
  createdAt: Date;
};

export type KeHoachDiLichSu = {
  /** Tạo dòng điểm danh ở buổi đích: nguồn → buổi đích. */
  diemDanhTao: { nguonId: string; buoiDichId: string }[];
  /** Tạo nhận xét ở buổi đích (đích chưa có). */
  nhanXetTao: { nguonId: string; buoiDichId: string }[];
  /** Đích ĐÃ có nhận xét nhưng nguồn SỚM HƠN ⇒ nguồn thắng, thay nội dung bản đích. */
  nhanXetThay: { nguonId: string; nhanXetDichId: string; buoiDichId: string }[];
  /** Đếm vì sao KHÔNG chuyển — cho báo cáo/audit, và để test thấy từng nhánh bị chặn. */
  boQua: {
    khongCoBaiHoc: number;
    khongCoBuoiTuongUng: number;
    buoiDichChuaDienRa: number;
    diemDanhVang: number;
    diemDanhDaCoOLopMoi: number;
    nhanXetDichDaSomHon: number;
    trungBuoiNguonCungBai: number;
  };
};

/** Trạng thái điểm danh được chuyển sang lớp mới. */
export const TRANG_THAI_DIEM_DANH_DI_THEO = ["PRESENT", "LATE"] as const;

/**
 * Lập kế hoạch chuyển điểm danh + nhận xét của MỘT học viên từ các buổi lớp cũ sang buổi lớp mới.
 *
 * Người gọi nạp: buổi của lớp mới (kể cả đã/chưa diễn ra), điểm danh + nhận xét của học viên ở lớp cũ, và những gì lớp mới ĐÃ có cho
 * học viên này (để không đè). `now` truyền vào — ĐỪNG đọc đồng hồ ở đây (luật 19).
 */
export function lapKeHoachDiLichSu(input: {
  buoiDich: readonly BuoiDich[];
  diemDanhNguon: readonly DiemDanhNguon[];
  nhanXetNguon: readonly NhanXetNguon[];
  /** Buổi đích mà học viên ĐÃ có dòng điểm danh. */
  diemDanhDichCoSan: ReadonlySet<string>;
  /** Buổi đích → nhận xét đã có của học viên (id + `createdAt`). */
  nhanXetDichCoSan: ReadonlyMap<string, { id: string; createdAt: Date }>;
  now: Date;
}): KeHoachDiLichSu {
  const boQua: KeHoachDiLichSu["boQua"] = {
    khongCoBaiHoc: 0,
    khongCoBuoiTuongUng: 0,
    buoiDichChuaDienRa: 0,
    diemDanhVang: 0,
    diemDanhDaCoOLopMoi: 0,
    nhanXetDichDaSomHon: 0,
    trungBuoiNguonCungBai: 0,
  };

  // Bài → buổi đích đầu tiên (không huỷ). Nhiều buổi cùng bài ở một lớp hiếm (đo prod: 0) — lấy buổi SỚM NHẤT để kết quả ổn định.
  const buoiTheoBai = new Map<string, BuoiDich>();
  for (const b of [...input.buoiDich].sort((x, y) => x.date.getTime() - y.date.getTime())) {
    if (b.status === "CANCELLED" || !b.lessonId) continue;
    if (!buoiTheoBai.has(b.lessonId)) buoiTheoBai.set(b.lessonId, b);
  }
  const nowMs = input.now.getTime();

  // Tìm buổi đích cho một bài, hoặc ghi lý do bỏ qua. Trả null nếu không chuyển được.
  const timDich = (lessonId: string | null): BuoiDich | null => {
    if (!lessonId) {
      boQua.khongCoBaiHoc++;
      return null;
    }
    const b = buoiTheoBai.get(lessonId);
    if (!b) {
      boQua.khongCoBuoiTuongUng++;
      return null;
    }
    if (b.date.getTime() > nowMs) {
      boQua.buoiDichChuaDienRa++;
      return null;
    }
    return b;
  };

  // ── ĐIỂM DANH ──
  const dd = new Map<string, { nguon: DiemDanhNguon; dich: BuoiDich }>();
  for (const a of [...input.diemDanhNguon].sort((x, y) => x.ngayBuoi.getTime() - y.ngayBuoi.getTime())) {
    if (!(TRANG_THAI_DIEM_DANH_DI_THEO as readonly string[]).includes(a.status)) {
      boQua.diemDanhVang++;
      continue;
    }
    const dich = timDich(a.lessonId);
    if (!dich) continue;
    if (input.diemDanhDichCoSan.has(dich.id)) {
      boQua.diemDanhDaCoOLopMoi++;
      continue;
    }
    if (dd.has(dich.id)) {
      boQua.trungBuoiNguonCungBai++;
      continue;
    }
    dd.set(dich.id, { nguon: a, dich });
  }

  // ── NHẬN XÉT ──
  const nx = new Map<string, { nguon: NhanXetNguon; dich: BuoiDich }>();
  for (const f of [...input.nhanXetNguon].sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime())) {
    const dich = timDich(f.lessonId);
    if (!dich) continue;
    if (nx.has(dich.id)) {
      boQua.trungBuoiNguonCungBai++;
      continue;
    }
    nx.set(dich.id, { nguon: f, dich });
  }

  const nhanXetTao: KeHoachDiLichSu["nhanXetTao"] = [];
  const nhanXetThay: KeHoachDiLichSu["nhanXetThay"] = [];
  for (const { nguon, dich } of nx.values()) {
    const co = input.nhanXetDichCoSan.get(dich.id);
    if (!co) {
      nhanXetTao.push({ nguonId: nguon.id, buoiDichId: dich.id });
    } else if (nguon.createdAt.getTime() < co.createdAt.getTime()) {
      // LẤY CÁI ĐẦU: nguồn viết trước ⇒ nguồn thắng.
      nhanXetThay.push({ nguonId: nguon.id, nhanXetDichId: co.id, buoiDichId: dich.id });
    } else {
      boQua.nhanXetDichDaSomHon++;
    }
  }

  return {
    diemDanhTao: [...dd.values()].map(({ nguon, dich }) => ({ nguonId: nguon.id, buoiDichId: dich.id })),
    nhanXetTao,
    nhanXetThay,
    boQua,
  };
}
