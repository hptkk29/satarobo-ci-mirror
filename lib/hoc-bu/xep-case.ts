// XẾP BÉ VÀO CASE DẠY BÙ — luật THUẦN (docs/hoc-bu/DAC-TA.md §3.2–3.3).
//
// Chốt chủ dự án 29/09/2026:
//   · "1 case có thể có nhiều bé nhưng các bé phải học chung khoá chung buổi bù thì mới add
//     vào được còn không thì phải tạo case khác" — và không chéo cơ sở (chốt 3);
//   · "phải thu tiền mới xếp vào case" khi hết lượt; QLCS/GĐ/Admin duyệt miễn phí ngoại lệ.
//
// Màn danh sách (khoá nút + in lý do), hộp chọn case và HAI server action (tạo case, xếp vào
// case có sẵn) cùng hỏi ở đây — để nút mở ra đúng là thứ server sẽ nhận (luật 12).

/** Khoá nhóm: bé chỉ ngồi chung case khi trùng cả ba. */
export type NhomBu = { centerId: string | null; courseId: string; lessonId: string | null };

export function cungNhom(a: NhomBu, b: NhomBu): boolean {
  return (
    a.centerId !== null &&
    a.centerId === b.centerId &&
    a.courseId === b.courseId &&
    a.lessonId !== null &&
    a.lessonId === b.lessonId
  );
}

/** Trạng thái tiền của MỘT dòng cần bù. */
export type TrangThaiPhi =
  | { loai: "LUOT" } // còn lượt miễn phí
  | { loai: "MIEN_PHI" } // hết lượt, đã duyệt miễn phí ngoại lệ
  | { loai: "DA_THU" } // hết lượt, phí bù đã thu đủ
  | { loai: "CHO_THU"; orderId: string } // đã tạo phí, chưa thu đủ
  | { loai: "CAN_THU" }; // hết lượt, chưa tạo phí

export function trangThaiPhi(p: {
  conLuot: number;
  freeApproved: boolean;
  phi: { orderId: string; daThuDu: boolean } | null;
}): TrangThaiPhi {
  // Thứ tự có chủ đích: tiền ĐÃ THU thắng lượt miễn phí — bé đã trả thì lần xếp này dùng
  // khoản đã trả, không tiêu thêm lượt (chốt 5: vắng buổi bù có phí thì giữ phí xếp lần sau).
  if (p.phi?.daThuDu) return { loai: "DA_THU" };
  if (p.freeApproved) return { loai: "MIEN_PHI" };
  if (p.conLuot > 0) return { loai: "LUOT" };
  if (p.phi) return { loai: "CHO_THU", orderId: p.phi.orderId };
  return { loai: "CAN_THU" };
}

export type KetQuaXep = { ok: true; dungLuot: boolean } | { ok: false; lyDo: string };

/** Bé này xếp vào case được chưa (chỉ xét TIỀN/LƯỢT). */
export function duocXep(phi: TrangThaiPhi): KetQuaXep {
  switch (phi.loai) {
    case "LUOT":
      return { ok: true, dungLuot: true };
    case "MIEN_PHI":
    case "DA_THU":
      return { ok: true, dungLuot: false };
    case "CHO_THU":
      return { ok: false, lyDo: "Hết lượt — phí bù chưa thu đủ" };
    case "CAN_THU":
      return { ok: false, lyDo: "Hết lượt — cần thu phí bù trước" };
  }
}

/** Cả nhóm bé chọn cùng lúc có xếp chung một case được không. */
export function kiemNhom(
  be: readonly (NhomBu & { hocVien: string })[],
): { ok: true; nhom: NhomBu } | { ok: false; lyDo: string } {
  const dau = be[0];
  if (!dau) return { ok: false, lyDo: "Chưa chọn học viên nào" };
  if (!dau.centerId) return { ok: false, lyDo: `${dau.hocVien}: lớp chưa gắn cơ sở — không xếp case được` };
  if (!dau.lessonId) return { ok: false, lyDo: `${dau.hocVien}: buổi vắng chưa gắn bài — không xác định được buổi bù` };
  for (const b of be.slice(1)) {
    if (b.centerId !== dau.centerId) return { ok: false, lyDo: `${b.hocVien} khác cơ sở — tạo case riêng` };
    if (b.courseId !== dau.courseId) return { ok: false, lyDo: `${b.hocVien} khác khoá — tạo case riêng` };
    if (b.lessonId !== dau.lessonId) return { ok: false, lyDo: `${b.hocVien} vắng buổi khác — tạo case riêng` };
  }
  return { ok: true, nhom: { centerId: dau.centerId, courseId: dau.courseId, lessonId: dau.lessonId } };
}

/** Case có sẵn nhận thêm bé được không. */
export function caseNhanThem(
  c: NhomBu & { status: string },
  be: NhomBu,
): { ok: true } | { ok: false; lyDo: string } {
  if (c.status !== "SCHEDULED") return { ok: false, lyDo: "Case đã điểm danh hoặc đã huỷ" };
  if (!cungNhom(c, be)) return { ok: false, lyDo: "Case khác cơ sở / khoá / buổi bù" };
  return { ok: true };
}
