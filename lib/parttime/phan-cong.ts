// lib/parttime/phan-cong.ts — luật phân công & xác nhận nhận lớp (SR.QD.238 · BA 13/10/2026). THUẦN.
//
// Bốn câu hỏi, mỗi câu MỘT hàm — màn hình, server action và bộ đối soát cùng gọi, không viết lại điều kiện ở chỗ gọi:
//   1. chuyển trạng thái này có hợp lệ không          → chuyenTrangThai
//   2. sửa phân công này có phải "đáng kể" không       → doiDangKe (đáng kể ⇒ assignmentVersion + 1, phải nhận lại)
//   3. xác nhận nhận lớp này còn hiệu lực không        → xacNhanConHieuLuc
//   4. buổi này đủ người chưa                          → trangThaiNhanLuc (+ canTroGiang theo PL02)
import type {
  AssignmentDecision,
  StaffAssignmentStatus,
  WorkRole,
} from "@prisma/client";

/** Trạng thái "còn sống" — khớp đúng điều kiện WHERE của hai chỉ mục từng phần trong migration. */
export const TRANG_THAI_SONG: readonly StaffAssignmentStatus[] = [
  "PROPOSED",
  "WAITING_ACCEPTANCE",
  "ACCEPTED",
  "ACTIVE",
  "COMPLETED",
];

const CHUYEN_HOP_LE: Record<StaffAssignmentStatus, readonly StaffAssignmentStatus[]> = {
  PROPOSED: ["WAITING_ACCEPTANCE", "CANCELLED"],
  WAITING_ACCEPTANCE: ["ACCEPTED", "DECLINED", "REPLACED", "CANCELLED"],
  // ACCEPTED/ACTIVE → WAITING_ACCEPTANCE: đổi đáng kể ⇒ phải nhận lại phiên bản mới.
  ACCEPTED: ["ACTIVE", "WAITING_ACCEPTANCE", "REPLACED", "CANCELLED", "COMPLETED"],
  ACTIVE: ["COMPLETED", "WAITING_ACCEPTANCE", "REPLACED", "CANCELLED"],
  DECLINED: [],
  REPLACED: [],
  CANCELLED: [],
  COMPLETED: [],
};

export function chuyenTrangThai(
  tu: StaffAssignmentStatus,
  den: StaffAssignmentStatus,
): { ok: true } | { ok: false; loi: string } {
  if (CHUYEN_HOP_LE[tu].includes(den)) return { ok: true };
  return { ok: false, loi: `Không chuyển được phân công từ ${tu} sang ${den}` };
}

/** Phần "nghĩa vụ" của một phân công — đổi bất kỳ trường nào ⇒ người được phân phải xác nhận lại. */
export type NghiaVu = {
  sourceType: string;
  sourceId: string;
  centerId: string;
  role: WorkRole;
  ngay: string; // "YYYY-MM-DD"
  gioBatDau: string; // "HH:mm"
  gioKetThuc: string; // "HH:mm"
};

const TRUONG_DANG_KE: readonly (keyof NghiaVu)[] = [
  "sourceType",
  "sourceId",
  "centerId",
  "role",
  "ngay",
  "gioBatDau",
  "gioKetThuc",
];

/** Các trường đáng kể đã đổi. Rỗng ⇒ giữ xác nhận cũ (vd chỉ sửa ghi chú). */
export function doiDangKe(cu: NghiaVu, moi: NghiaVu): (keyof NghiaVu)[] {
  return TRUONG_DANG_KE.filter((k) => cu[k] !== moi[k]);
}

export type XacNhan = { assignmentVersion: number; decision: AssignmentDecision };

/**
 * Xác nhận còn hiệu lực ⇔ đúng PHIÊN BẢN hiện tại của phân công VÀ là "nhận". Không cột "đã vô hiệu" nào cả:
 * tăng `assignmentVersion` là đủ làm mọi xác nhận cũ hết hiệu lực — không có đường ghi nào để quên.
 */
export function xacNhanConHieuLuc(xacNhans: readonly XacNhan[], phienBanHienTai: number): XacNhan | null {
  return xacNhans.find((x) => x.assignmentVersion === phienBanHienTai && x.decision === "ACCEPTED") ?? null;
}

// ─── Trợ giảng bắt buộc (PL02) ────────────────────────────────────────────────────────────────

export type NguongTroGiang = { khoa: string; tuHocVien: number };

/** "Sata3 — Ươm Mầm…" / "SATA 3" / "sata3" → "sata3". */
function maKhoa(ten: string): string | null {
  const m = /sata\s*(\d+)/i.exec(ten);
  return m ? `sata${m[1]}` : null;
}

/**
 * TA BẮT BUỘC theo PL02 (Sata3 ≥ 7 HV; Sata4–7 ≥ 9 HV). Khoá không có trong bảng ngưỡng ⇒ `null` = "QLCS quyết định"
 * (văn bản: "Trường hợp khác do Quản lý Trung tâm quyết định") — KHÔNG được hiểu thành "không cần".
 */
export function canTroGiang(
  tenKhoa: string,
  soHocVien: number,
  nguong: readonly NguongTroGiang[],
): { batBuoc: boolean; theoNguong: NguongTroGiang } | null {
  const ma = maKhoa(tenKhoa);
  if (!ma) return null;
  const n = nguong.find((x) => maKhoa(x.khoa) === ma);
  if (!n) return null;
  return { batBuoc: soHocVien >= n.tuHocVien, theoNguong: n };
}

export type YeuCauTroGiang = "REQUIRED" | "OPTIONAL" | "OVERRIDDEN_REQUIRED" | "OVERRIDDEN_OPTIONAL";

/**
 * TA có bắt buộc cho buổi không — MỘT luật cho mọi nơi hỏi (dịch vụ ghi + màn tuần của QLCS):
 * QLCS ghi đè theo lớp thắng; không thì PL02 theo khoá + sĩ số; khoá ngoài bảng / buổi không thuộc lớp / ngày LEGACY
 * ⇒ OPTIONAL (văn bản: "trường hợp khác do QLCS quyết" — QLCS bật bằng ghi đè).
 */
export function yeuCauTroGiangThuan(p: {
  ghiDe: boolean | null;
  tenKhoa: string | null;
  soHocVien: number;
  nguong: readonly NguongTroGiang[] | null;
}): YeuCauTroGiang {
  if (p.ghiDe != null) return p.ghiDe ? "OVERRIDDEN_REQUIRED" : "OVERRIDDEN_OPTIONAL";
  if (!p.tenKhoa || !p.nguong) return "OPTIONAL";
  return canTroGiang(p.tenKhoa, p.soHocVien, p.nguong)?.batBuoc ? "REQUIRED" : "OPTIONAL";
}

export const laTaBatBuoc = (y: YeuCauTroGiang) => y === "REQUIRED" || y === "OVERRIDDEN_REQUIRED";

// ─── Buổi đủ người chưa ───────────────────────────────────────────────────────────────────────

export type PhanCongTomTat = {
  role: WorkRole;
  status: StaffAssignmentStatus;
  /** Có xác nhận NHẬN còn hiệu lực cho phiên bản hiện tại. */
  daNhan: boolean;
};

/**
 * - STAFFING_DRAFT       — một vai bắt buộc CHƯA có ai được phân (hoặc chỉ mới PROPOSED).
 * - WAITING_ACCEPTANCE   — đủ người được phân, chưa ai trong số vai bắt buộc nhận.
 * - PARTIALLY_ACCEPTED   — đủ người, một phần đã nhận.
 * - STAFFING_CONFIRMED   — mọi vai bắt buộc có phân công sống ĐÃ NHẬN.
 * - NEEDS_REASSIGNMENT   — một vai bắt buộc mất người vì bị TỪ CHỐI (kể cả người DẠY THAY từ chối) ⇒ QLCS xếp người khác.
 * - STAFFING_REJECTED    — MỌI phân công của buổi đều bị từ chối (không ai từng nhận/được thay) ⇒ cả đội hình bị bác.
 */
export type TrangThaiNhanLuc =
  | "STAFFING_DRAFT"
  | "WAITING_ACCEPTANCE"
  | "PARTIALLY_ACCEPTED"
  | "STAFFING_CONFIRMED"
  | "NEEDS_REASSIGNMENT"
  | "STAFFING_REJECTED";

/**
 * Buổi đủ người ⇔ MỌI vai bắt buộc có phân công sống ĐÃ NHẬN. Không hardcode "lớp nào cũng 2 người": TA chỉ bắt buộc
 * khi `canTA = true` (PL02 hoặc QLCS quyết). Hàm suy ra, không lưu — nên không bao giờ lệch với phân công thật.
 */
export function trangThaiNhanLuc(phanCong: readonly PhanCongTomTat[], canTA: boolean): TrangThaiNhanLuc {
  const song = phanCong.filter((p) => TRANG_THAI_SONG.includes(p.status));
  const vaiBatBuoc: WorkRole[] = canTA ? ["MAIN_TEACHER", "TEACHING_ASSISTANT"] : ["MAIN_TEACHER"];
  const thieuVai = vaiBatBuoc.filter((r) => !song.some((p) => p.role === r));
  if (thieuVai.length > 0) {
    const biTuChoi = thieuVai.some((r) => phanCong.some((p) => p.role === r && p.status === "DECLINED"));
    if (!biTuChoi) return "STAFFING_DRAFT";
    return phanCong.every((p) => p.status === "DECLINED") ? "STAFFING_REJECTED" : "NEEDS_REASSIGNMENT";
  }
  const batBuoc = song.filter((p) => vaiBatBuoc.includes(p.role));
  if (batBuoc.every((p) => p.status === "PROPOSED")) return "STAFFING_DRAFT";
  const daNhan = batBuoc.filter((p) => p.daNhan).length;
  if (daNhan === batBuoc.length) return "STAFFING_CONFIRMED";
  return daNhan > 0 ? "PARTIALLY_ACCEPTED" : "WAITING_ACCEPTANCE";
}

// ─── ĐỒNG BỘ phân công theo trạng thái SỐNG của buổi (P3a) ──────────────────────────────────────
//
// Một bộ lập kế hoạch THUẦN cho mọi đường đổi buổi / lớp / case học bù / buổi trial. Đường ghi nghiệp vụ không tự
// quyết "phải làm gì với phân công" — nó chỉ đánh dấu buổi cần đồng bộ; bộ thực thi (`phan-cong-db.ts`) đọc trạng
// thái sống, gọi hàm này, rồi làm đúng các bước trả về. Chạy 1 lần hay 10 lần cho cùng kết quả (idempotent).
//
// HỢP ĐỒNG LOẠI PHÂN CÔNG (assignmentType) — ai được ghi đè cái gì:
//   SYSTEM / REGULAR — DẪN XUẤT từ mặc định của nguồn (GV/TA của lớp · teacherId của case học bù / buổi trial · bản
//                       khôi phục sau huỷ đơn dạy thay). Đồng bộ được THAY khi mặc định đổi.
//   SUBSTITUTE        — dẫn xuất từ `ClassSession.substituteTeacherId` (hoặc đơn dạy thay). Đổi GV mặc định của LỚP
//                       KHÔNG BAO GIỜ chạm nó; chỉ thay khi chính trường người dạy thay của buổi thôi chỉ người đó.
//   MANUAL            — QLCS phân tay. Đồng bộ KHÔNG BAO GIỜ ghi; lệch với mặc định ⇒ NGOẠI LỆ, không đoán.
//
// TÌNH TRẠNG BUỔI:
//   MO       — còn đổi được đội hình (SCHEDULED / đang dạy).
//   DA_CHOT  — COMPLETED / NO_SHOW: ĐÓNG BĂNG — không huỷ, không tăng phiên bản, không tạo mới. Phân công đã nhận là bằng
//              chứng "kế hoạch vs thực tế" cho P3b/P4 — huỷ nó là xoá chứng cứ.
//   DA_DONG  — đã huỷ / lớp đã xoá / lớp trial đã huỷ: mọi phân công sống CHƯA chốt ⇒ CANCELLED.
// Ngày trước 15/10/2026 (chính sách cũ) ⇒ như DA_DONG đối với phân công SR.QD.238 còn sống.
// Phân công đã CANCELLED / REPLACED / DECLINED / COMPLETED KHÔNG BAO GIỜ sống lại — mở lại buổi ⇒ dòng MỚI, phiên bản 1.
// Công tắc: ĐÓNG (huỷ) chạy cả khi tắt — chỉ có phân công nếu công tắc từng bật; DỰNG / TĂNG PHIÊN BẢN chỉ khi bật.

export type TinhTrangBuoi = "MO" | "DA_CHOT" | "DA_DONG";

export type PhanCongDangCo = {
  id: string;
  userId: string;
  role: WorkRole;
  status: StaffAssignmentStatus;
  assignmentType: "REGULAR" | "SUBSTITUTE" | "MANUAL" | "SYSTEM" | "CUTOVER";
  nghiaVu: NghiaVu;
};

export type KyVongBuoi = {
  tinhTrang: TinhTrangBuoi;
  /** Lý do khi DA_DONG — ghi vào audit. */
  lyDoDong: string | null;
  /** Ngày buổi thuộc SR.QD.238. */
  apDung: boolean;
  congTacBat: boolean;
  /** Nghĩa vụ SỐNG của buổi (không có `role` — gắn theo từng phân công). */
  lich: Omit<NghiaVu, "role">;
  main: { userId: string; kieu: "SYSTEM" | "SUBSTITUTE" } | null;
  ta: { userId: string } | null;
  /** `ClassSession.substituteTeacherId` hiện tại (null với học bù / trial). */
  nguoiDayThay: string | null;
};

export type BuocDongBo =
  | { loai: "HUY"; id: string; lyDo: string }
  | { loai: "DOI_LICH"; id: string }
  | { loai: "THAY"; cuId: string; role: WorkRole; userId: string; kieu: "SYSTEM" | "SUBSTITUTE" }
  | { loai: "TAO"; role: WorkRole; userId: string; kieu: "SYSTEM" | "SUBSTITUTE" }
  | { loai: "NGOAI_LE"; ma: "LECH_PHAN_CONG_TAY" | "TRUNG_VAI" | "DA_CHOT_NHUNG_BUOI_DONG"; role: WorkRole; userId: string | null; chiTiet: string };

/** Còn sống và CHƯA chốt — tập mà đồng bộ được phép đụng tới. COMPLETED không bao giờ bị đụng. */
export const SONG_CHUA_CHOT: readonly StaffAssignmentStatus[] = ["PROPOSED", "WAITING_ACCEPTANCE", "ACCEPTED", "ACTIVE"];

function danXuatDuoc(pc: PhanCongDangCo, nguoiDayThay: string | null): boolean {
  // CUTOVER = nhập từ GV / TA mặc định của lớp lúc chuyển đổi ⇒ dẫn xuất được như SYSTEM (đổi GV mặc định của lớp thì thay
  // được). Rơi xuống `return false` là bị coi như PHÂN TAY ⇒ ngoại lệ LECH_PHAN_CONG_TAY oan (lưới [CUT-DX]).
  if (pc.assignmentType === "SYSTEM" || pc.assignmentType === "REGULAR" || pc.assignmentType === "CUTOVER") return true;
  // SUBSTITUTE còn được buổi "chống lưng" ⇒ không ai được thay; thôi được chống lưng ⇒ dẫn xuất lại được.
  if (pc.assignmentType === "SUBSTITUTE") return pc.userId !== nguoiDayThay;
  return false; // MANUAL
}

/**
 * Lập kế hoạch đồng bộ. `hienTai` = mọi phân công của buổi (mọi trạng thái). Cặp (người, vai) đã TỪ CHỐI không được
 * dựng lại đúng người đó vào đúng vai đó (cần QLCS xếp người khác) — người KHÁC thì dựng được.
 */
export function keHoachDongBo(kv: KyVongBuoi, hienTai: readonly PhanCongDangCo[]): BuocDongBo[] {
  const song = hienTai.filter((p) => SONG_CHUA_CHOT.includes(p.status));
  if (kv.tinhTrang === "DA_CHOT") return [];
  if (kv.tinhTrang === "DA_DONG" || !kv.apDung) {
    const lyDo = kv.tinhTrang === "DA_DONG" ? (kv.lyDoDong ?? "Buổi đã đóng") : "Buổi trước 15/10/2026 — thuộc chính sách cũ";
    const huy: BuocDongBo[] = song.map((p) => ({ loai: "HUY" as const, id: p.id, lyDo }));
    // Phân công ĐÃ CHỐT trên buổi về sau bị huỷ / thành chính sách cũ: KHÔNG viết lại lịch sử — chỉ báo ngoại lệ để đối soát.
    for (const p of hienTai.filter((x) => x.status === "COMPLETED")) {
      huy.push({ loai: "NGOAI_LE", ma: "DA_CHOT_NHUNG_BUOI_DONG", role: p.role, userId: p.userId, chiTiet: `Phân công đã chốt nhưng buổi: ${lyDo}` });
    }
    return huy;
  }
  if (!kv.congTacBat) return [];

  const tuChoi = new Set(hienTai.filter((p) => p.status === "DECLINED").map((p) => `${p.role}|${p.userId}`));
  const buoc: BuocDongBo[] = [];
  const giu: PhanCongDangCo[] = [];
  // Người đang giữ một vai sống (kể cả COMPLETED — một người không hai vai trong buổi).
  const nguoiDaCoVai = new Map<string, WorkRole>();
  for (const p of hienTai) if (TRANG_THAI_SONG.includes(p.status)) nguoiDaCoVai.set(p.userId, p.role);
  const dangKe = (p: PhanCongDangCo) => doiDangKe(p.nghiaVu, { ...kv.lich, role: p.role }).length > 0;

  // ── GV đứng chính ──
  const mainSong = song.find((p) => p.role === "MAIN_TEACHER") ?? null;
  const daChotMain = hienTai.some((p) => p.role === "MAIN_TEACHER" && p.status === "COMPLETED");
  const kvMain = kv.main;
  const duocNhanMain = (uid: string) => !tuChoi.has(`MAIN_TEACHER|${uid}`) && !nguoiDaCoVai.has(uid);
  if (mainSong) {
    if (kvMain && mainSong.userId === kvMain.userId) giu.push(mainSong);
    else if (danXuatDuoc(mainSong, kv.nguoiDayThay)) {
      if (kvMain && duocNhanMain(kvMain.userId)) {
        buoc.push({ loai: "THAY", cuId: mainSong.id, role: "MAIN_TEACHER", userId: kvMain.userId, kieu: kvMain.kieu });
        nguoiDaCoVai.delete(mainSong.userId);
        nguoiDaCoVai.set(kvMain.userId, "MAIN_TEACHER");
      } else if (!kvMain) {
        buoc.push({ loai: "HUY", id: mainSong.id, lyDo: "Buổi không còn giáo viên mặc định" });
        nguoiDaCoVai.delete(mainSong.userId);
      } else {
        // Người mặc định mới đã từ chối / đang giữ vai khác ⇒ không thay mù, để QLCS quyết.
        giu.push(mainSong);
        buoc.push({ loai: "NGOAI_LE", ma: "TRUNG_VAI", role: "MAIN_TEACHER", userId: kvMain.userId, chiTiet: "Người mặc định mới đã từ chối hoặc đang giữ vai khác trong buổi" });
      }
    } else {
      giu.push(mainSong);
      buoc.push({
        loai: "NGOAI_LE",
        ma: "LECH_PHAN_CONG_TAY",
        role: "MAIN_TEACHER",
        userId: kvMain?.userId ?? null,
        chiTiet: `Phân công ${mainSong.assignmentType} khác người mặc định — không ghi đè`,
      });
    }
  } else if (kvMain && !daChotMain && !tuChoi.has(`MAIN_TEACHER|${kvMain.userId}`)) {
    if (nguoiDaCoVai.has(kvMain.userId)) {
      buoc.push({ loai: "NGOAI_LE", ma: "TRUNG_VAI", role: "MAIN_TEACHER", userId: kvMain.userId, chiTiet: "Người mặc định đang giữ vai khác trong buổi" });
    } else {
      buoc.push({ loai: "TAO", role: "MAIN_TEACHER", userId: kvMain.userId, kieu: kvMain.kieu });
      nguoiDaCoVai.set(kvMain.userId, "MAIN_TEACHER");
    }
  }

  // ── Trợ giảng ── (có thể nhiều TA khác người; chỉ đụng TA DẪN XUẤT)
  const taSong = song.filter((p) => p.role === "TEACHING_ASSISTANT");
  const taDanXuat = taSong.filter((p) => danXuatDuoc(p, kv.nguoiDayThay));
  const taTay = taSong.filter((p) => !taDanXuat.includes(p));
  const kvTa = kv.ta && kv.ta.userId !== kvMain?.userId ? kv.ta : null;
  if (kvTa && taSong.some((p) => p.userId === kvTa.userId)) {
    giu.push(...taSong);
  } else if (kvTa) {
    const coThe = !tuChoi.has(`TEACHING_ASSISTANT|${kvTa.userId}`) && !nguoiDaCoVai.has(kvTa.userId);
    if (taDanXuat.length > 0 && coThe) {
      const [dau, ...con] = taDanXuat;
      buoc.push({ loai: "THAY", cuId: dau.id, role: "TEACHING_ASSISTANT", userId: kvTa.userId, kieu: "SYSTEM" });
      for (const p of con) buoc.push({ loai: "HUY", id: p.id, lyDo: "Trợ giảng mặc định của buổi đã đổi" });
      giu.push(...taTay);
    } else if (taTay.length > 0) {
      giu.push(...taSong); // có TA phân tay ⇒ phân tay thắng, không thêm TA thứ hai
      buoc.push({ loai: "NGOAI_LE", ma: "LECH_PHAN_CONG_TAY", role: "TEACHING_ASSISTANT", userId: kvTa.userId, chiTiet: "Trợ giảng phân tay khác trợ giảng mặc định — không ghi đè" });
    } else if (coThe) {
      giu.push(...taSong);
      buoc.push({ loai: "TAO", role: "TEACHING_ASSISTANT", userId: kvTa.userId, kieu: "SYSTEM" });
    } else {
      giu.push(...taSong);
      if (nguoiDaCoVai.has(kvTa.userId)) {
        buoc.push({ loai: "NGOAI_LE", ma: "TRUNG_VAI", role: "TEACHING_ASSISTANT", userId: kvTa.userId, chiTiet: "Trợ giảng mặc định đang giữ vai khác trong buổi" });
      }
    }
  } else {
    for (const p of taDanXuat) buoc.push({ loai: "HUY", id: p.id, lyDo: "Buổi không còn trợ giảng mặc định" });
    giu.push(...taTay);
  }

  // ── Lịch đổi đáng kể ⇒ phiên bản mới, chỉ cho phân công được GIỮ (cái bị thay / huỷ thì thôi) ──
  for (const p of giu) if (dangKe(p)) buoc.push({ loai: "DOI_LICH", id: p.id });
  return buoc;
}

// ─── Mặc định + tình trạng của MỘT buổi (P3b · dùng chung đồng bộ ↔ màn hình) ──────────────────────
// Bộ đồng bộ (`docBuoi`) và màn đọc theo lô (`bang-phan-cong.ts`) phải nói CÙNG một câu về "buổi này ai đứng mặc định,
// buổi này còn mở không". Trước P3b màn đọc tự suy: GV mặc định = GV lớp (bỏ qua người dạy thay) và "đóng" chỉ theo
// trạng thái buổi (bỏ qua lớp đã huỷ / xoá mềm / lớp trial đã huỷ) ⇒ buổi của lớp đã huỷ hiện "Thiếu người", nút
// "Dựng từ giáo viên của lớp" đếm và gắn nhãn người KHÁC người mà nút ấy thật sự dựng. Một hàm, hai nơi gọi.

/** Dữ liệu THÔ tối thiểu của buổi — mỗi nguồn một hình dạng, đúng các cột cả hai nơi gọi đều đã đọc. */
export type BuoiTho =
  | {
      sourceType: "CLASS_SESSION";
      trangThai: string;
      substituteTeacherId: string | null;
      lop: { teacherId: string | null; assistantId: string | null; status: string; deletedAt: Date | null };
    }
  | { sourceType: "MAKEUP_CASE"; trangThai: string; teacherId: string | null }
  | {
      sourceType: "TRIAL_SESSION";
      trangThai: string;
      teacherId: string | null;
      lopTrial: { teacherId: string | null; assistantId: string | null; status: string };
    };

export type MacDinhBuoi = {
  macDinhMainId: string | null;
  macDinhMainKieu: "SYSTEM" | "SUBSTITUTE";
  macDinhTaId: string | null;
  /** `ClassSession.substituteTeacherId` (null với học bù / trial). */
  nguoiDayThay: string | null;
  tinhTrang: TinhTrangBuoi;
  lyDoDong: string | null;
};

function tinhTrangTheoTrangThai(s: string, dongVi: string | null): { tinhTrang: TinhTrangBuoi; lyDoDong: string | null } {
  if (s === "CANCELLED") return { tinhTrang: "DA_DONG", lyDoDong: "Buổi đã huỷ" };
  if (s === "COMPLETED" || s === "NO_SHOW") return { tinhTrang: "DA_CHOT", lyDoDong: null };
  if (dongVi) return { tinhTrang: "DA_DONG", lyDoDong: dongVi };
  return { tinhTrang: "MO", lyDoDong: null };
}

export function macDinhCuaBuoi(b: BuoiTho): MacDinhBuoi {
  if (b.sourceType === "CLASS_SESSION") {
    const dongVi = b.lop.deletedAt != null ? "Lớp đã bị xoá" : b.lop.status === "CANCELLED" ? "Lớp đã huỷ" : null;
    return {
      macDinhMainId: b.substituteTeacherId ?? b.lop.teacherId,
      macDinhMainKieu: b.substituteTeacherId ? "SUBSTITUTE" : "SYSTEM",
      macDinhTaId: b.lop.assistantId,
      nguoiDayThay: b.substituteTeacherId,
      ...tinhTrangTheoTrangThai(b.trangThai, dongVi),
    };
  }
  if (b.sourceType === "MAKEUP_CASE") {
    // Học bù không có trợ giảng trong schema — TA chỉ phân tay.
    return { macDinhMainId: b.teacherId, macDinhMainKieu: "SYSTEM", macDinhTaId: null, nguoiDayThay: null, ...tinhTrangTheoTrangThai(b.trangThai, null) };
  }
  // Lớp trial huỷ mà buổi vẫn SCHEDULED ⇒ đóng (cancelTrialClass không đổi trạng thái buổi).
  const dongVi = b.lopTrial.status === "CANCELLED" && b.trangThai === "SCHEDULED" ? "Lớp trải nghiệm đã huỷ" : null;
  return {
    macDinhMainId: b.teacherId ?? b.lopTrial.teacherId,
    macDinhMainKieu: "SYSTEM",
    macDinhTaId: b.lopTrial.assistantId,
    nguoiDayThay: null,
    ...tinhTrangTheoTrangThai(b.trangThai, dongVi),
  };
}
