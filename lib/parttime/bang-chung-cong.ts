// lib/parttime/bang-chung-cong.ts — P4 · GẮN CHẤM CÔNG VÀO PHÂN CÔNG (SR.QD.238). THUẦN: không DB, không đồng hồ (`now` bắt
// buộc — luật 7 + 19).
//
// Trả lời MỘT câu: "người được phân vào vai này có BẰNG CHỨNG đã thật sự làm việc đó không?" — KHÔNG trả lời "trả bao nhiêu"
// (P5). Bốn nguồn giữ nguyên nghĩa của chúng, ở đây chỉ GHÉP:
//   · phân công  (SessionStaffAssignment) — AI được giao LÀM GÌ, phiên bản nào, đã nhận phiên bản đó chưa;
//   · chấm công  (StaffTimeLog, đã qua `LUOT_CON_TINH`) — AI có mặt ở ĐÂU, LÚC NÀO;
//   · buổi       (ClassSession / MakeupCase / TrialClassSession) — CÁI GÌ đã diễn ra;
//   · người dạy  (`giaoVienDuocQuyCong` / GV của case / GV của buổi trial) — AI thật sự đứng lớp.
//
// Kết quả là BẢN GHI TÍNH RA (recomputable) mang đủ dòng dõi (assignment + phiên bản + id lượt vào/ra + nguồn người dạy +
// ngày chính sách) và một DẤU VÂN (`dauVan`) của mọi đầu vào — P5 chụp nó khi khoá kỳ và so dấu vân để biết đầu vào đã đổi.
// KHÔNG lưu bảng ở P4 (xem `docs/cham-cong/parttime/06-ATTENDANCE-BINDING-DESIGN.md` §0).
import type { StaffAssignmentStatus, WorkActivityType, WorkRole, WorkSourceType } from "@prisma/client";
import { dedupeTaps, pairLogs, type EngineLog } from "@/lib/cham-cong/engine";
import { vnParts } from "@/lib/time/vn";
import type { TinhTrangBuoi } from "./phan-cong";

// ─── Khoảng có mặt ───────────────────────────────────────────────────────────────────────────

/** Lượt quẹt ĐÃ LỌC `LUOT_CON_TINH` (ACCEPTED + chưa bị thay) — hàm này KHÔNG tự lọc lại. */
export type LuotQuetHopLe = { id: string; loggedAt: Date; direction: "CHECK_IN" | "CHECK_OUT"; centerId: string; flags: readonly string[] };

export type KhoangCoMat = {
  inId: string | null;
  outId: string | null;
  tu: Date;
  /** null = chưa có lượt RA (khoảng còn mở). */
  den: Date | null;
  /** Cơ sở của lượt VÀO — khoảng chỉ gắn được cho phân công CÙNG cơ sở. */
  centerId: string;
  /** Cờ của hai lượt (thiết bị chưa tin cậy, ngoài vùng…) — chỉ là cảnh báo, không loại bằng chứng. */
  canhBao: string[];
};

const phutVn = (d: Date) => {
  const p = vnParts(d);
  return p.hour * 60 + p.minute;
};

/**
 * Khoảng có mặt của MỘT người trong MỘT ngày công — dùng ĐÚNG đường ghép của bảng công (`dedupeTaps` → `pairLogs`):
 * VÀO-RA-VÀO-RA ra HAI khoảng (không gộp "vào đầu – ra cuối", vì thế là bịa ra có mặt lúc vắng); VÀO không RA ra một khoảng
 * MỞ; RA không VÀO bị bỏ.
 */
export function khoangCoMatTrongNgay(luot: readonly LuotQuetHopLe[], bamTrungPhut: number): KhoangCoMat[] {
  const theoId = new Map(luot.map((l) => [l.id, l]));
  // TẤT ĐỊNH: `dedupeTaps` / `pairLogs` chỉ sắp theo PHÚT (sắp ổn định ⇒ hoà thì giữ thứ tự ĐẦU VÀO), mà câu đọc lượt không có
  // `orderBy` ⇒ thứ tự là thứ tự hàng Postgres trả — đổi theo chỗ trống của bảng. Hai lượt cùng phút (bấm đúp, hay nhiều buổi
  // dùng chung lượt) khi đó chọn `inId` khác nhau giữa hai lần đọc ⇒ dấu vân đổi ⇒ đơn vị công bị đánh dấu CŨ oan. Sắp theo
  // (giờ ghi, id) TRƯỚC khi vào engine. `[P4-03c]`.
  const xep = [...luot].sort((a, b) => a.loggedAt.getTime() - b.loggedAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const engine: EngineLog[] = xep.map((l) => ({ id: l.id, minute: phutVn(l.loggedAt), direction: l.direction }));
  const { kept } = dedupeTaps(engine, bamTrungPhut);
  const { pairs } = pairLogs(kept);
  const ra: KhoangCoMat[] = [];
  for (const p of pairs) {
    const vao = p.inId ? theoId.get(p.inId) : undefined;
    if (!vao) continue;
    const raLuot = p.outId ? theoId.get(p.outId) : undefined;
    ra.push({
      inId: vao.id,
      outId: raLuot?.id ?? null,
      tu: vao.loggedAt,
      den: p.open ? null : (raLuot?.loggedAt ?? null),
      centerId: vao.centerId,
      canhBao: [...new Set([...vao.flags, ...(raLuot?.flags ?? [])])].sort(),
    });
  }
  return ra;
}

// ─── Đánh giá một phân công ──────────────────────────────────────────────────────────────────

export type NguonNguoiDay = "actualTeacherId" | "substituteTeacherId" | "class.teacherId" | "makeup.teacherId" | "trial.teacherId" | "trialClass.teacherId";

export type DauVaoBangChung = {
  phanCong: {
    id: string;
    phienBan: number;
    userId: string;
    role: WorkRole;
    status: StaffAssignmentStatus;
    activity: WorkActivityType;
    sourceType: WorkSourceType;
    sourceId: string;
    centerId: string;
    ngay: string; // "YYYY-MM-DD"
    gioBatDau: string; // "HH:mm" — ảnh chụp của PHIÊN BẢN HIỆN TẠI
    gioKetThuc: string;
  };
  /** Đã nhận ĐÚNG phiên bản hiện tại chưa — nhận phiên bản cũ ⇒ false (không tự diễn giải lại). */
  daNhan: boolean;
  /**
   * Q5 — LEGACY_ACTIVE_PENDING_ACCEPTANCE: phân công NHẬP lúc cutover (`assignmentType = CUTOVER`), còn chờ xác nhận, ngày buổi
   * ≤ mốc grace của cơ sở (`shift.parttimeCutoverGraceDen`, rỗng = không grace). Cho CHẤM CÔNG (không cờ ngoài lịch) — KHÔNG
   * phải đã nhận, KHÔNG sinh đơn vị. Cố ý KHÔNG vào dấu vân: đổi mốc grace không được làm cũ đơn vị đã xác nhận.
   */
  graceCutover: boolean;
  buoi: {
    tinhTrang: TinhTrangBuoi;
    /** Ngày thuộc SR.QD.238 — LEGACY ⇒ không gắn. */
    apDung: boolean;
    nguoiDay: { id: string; nguon: NguonNguoiDay } | null;
  };
  /** `tiet.chuanBiPhut` của chính sách tại ngày buổi (null khi LEGACY). */
  chuanBiPhut: number | null;
  /** Mã chính sách áp — dòng dõi. */
  chinhSach: string | null;
  /** MỌI khoảng có mặt của người đó trong ngày (mọi cơ sở) — hàm tự chọn khoảng cùng cơ sở. */
  khoang: readonly KhoangCoMat[];
  dungSai: { treVaoPhut: number; veSomPhut: number };
  now: Date;
};

export type TrangThaiBangChung =
  | "KHONG_AP_DUNG" // ngày LEGACY (trước 15/10/2026)
  | "BUOI_DA_HUY"
  | "CHUA_DEN_GIO"
  | "KHONG_BANG_CHUNG"
  | "DA_VAO" // đang trong buổi, đã vào, chưa ra
  | "THIEU_RA" // buổi đã hết mà không có lượt ra
  | "DI_MUON"
  | "RA_SOM"
  | "SAI_NGUOI_DUNG_LOP"
  | "DU_BANG_CHUNG";

export type MaNgoaiLe =
  | "ASSIGNED_NO_ATTENDANCE"
  | "MAIN_ACTUAL_MISMATCH"
  | "LATE"
  | "EARLY_LEAVE"
  | "MISSING_CHECKOUT"
  | "SESSION_CANCELLED_WITH_ATTENDANCE"
  | "ASSIGNMENT_ACCEPTED_BUT_SESSION_NOT_RUN"
  | "ASSIGNMENT_NOT_ACCEPTED"
  | "PRESENT_AT_OTHER_CENTER";

export type BangChungPhanCong = {
  assignmentId: string;
  assignmentVersion: number;
  userId: string;
  role: WorkRole;
  activity: WorkActivityType;
  sourceType: WorkSourceType;
  sourceId: string;
  centerId: string;
  workDate: string;
  /** Giờ PHẢI CÓ MẶT = bắt đầu − chuẩn bị (SR.QD.238: 10'); null khi LEGACY. */
  requiredFrom: Date | null;
  requiredTo: Date | null;
  trangThai: TrangThaiBangChung;
  /** Các chiều tách rời — KHÔNG gộp vào một cờ. */
  coMat: "CHUA_DEN_GIO" | "KHONG" | "DANG_O" | "THIEU_RA" | "DU" | "KHONG_XET";
  treVaoPhut: number | null; // số phút THÔ (luôn báo, kể cả trong dung sai)
  diMuon: boolean; // treVaoPhut > dung sai
  raSomPhut: number | null;
  raSom: boolean;
  khopNguoiDay: "KHOP" | "LECH" | "KHONG_XET";
  daNhan: boolean;
  /** Xem `DauVaoBangChung.graceCutover`. */
  graceCutover: boolean;
  checkInAt: Date | null;
  checkOutAt: Date | null;
  canhBaoLuot: string[];
  ngoaiLe: MaNgoaiLe[];
  /** Dòng dõi — mọi kết luận lần về được nguồn. */
  dongDoi: {
    attendanceInId: string | null;
    attendanceOutId: string | null;
    nguoiDayId: string | null;
    nguonNguoiDay: NguonNguoiDay | null;
    tinhTrangBuoi: TinhTrangBuoi;
    chinhSach: string | null;
  };
  /** Dấu vân của MỌI đầu vào — đổi bất cứ đầu vào nào ⇒ đổi dấu (P5 dùng để biết bản chụp đã lỗi thời). */
  dauVan: string;
};

const phutGiua = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 60_000);
/** Mốc giờ thật của "HH:mm" ngày `ymd` theo giờ VN. */
export const mocVn = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00+07:00`);

/** FNV-1a 32-bit — tất định, thuần, đủ để so "đầu vào đã đổi chưa" (không phải bảo mật). */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Khoảng cùng cơ sở có PHẦN GIAO lớn nhất với [requiredFrom, requiredTo]; khoảng mở được tính tới `now`. */
function chonKhoang(khoang: readonly KhoangCoMat[], centerId: string, tu: Date, den: Date, now: Date): { k: KhoangCoMat; giao: number } | null {
  let tot: { k: KhoangCoMat; giao: number } | null = null;
  for (const k of khoang) {
    if (k.centerId !== centerId) continue;
    const ketThuc = k.den ?? now;
    const giao = Math.min(ketThuc.getTime(), den.getTime()) - Math.max(k.tu.getTime(), tu.getTime());
    if (giao <= 0) continue;
    if (!tot || giao > tot.giao) tot = { k, giao };
  }
  return tot;
}

export function danhGiaBangChung(v: DauVaoBangChung): BangChungPhanCong {
  const pc = v.phanCong;
  const coChuanBi = v.buoi.apDung && v.chuanBiPhut != null;
  const batDau = mocVn(pc.ngay, pc.gioBatDau);
  const requiredTo = coChuanBi ? mocVn(pc.ngay, pc.gioKetThuc) : null;
  const requiredFrom = coChuanBi ? new Date(batDau.getTime() - (v.chuanBiPhut as number) * 60_000) : null;

  const ra: Omit<BangChungPhanCong, "dauVan"> = {
    assignmentId: pc.id,
    assignmentVersion: pc.phienBan,
    userId: pc.userId,
    role: pc.role,
    activity: pc.activity,
    sourceType: pc.sourceType,
    sourceId: pc.sourceId,
    centerId: pc.centerId,
    workDate: pc.ngay,
    requiredFrom,
    requiredTo,
    trangThai: "KHONG_AP_DUNG",
    coMat: "KHONG_XET",
    treVaoPhut: null,
    diMuon: false,
    raSomPhut: null,
    raSom: false,
    khopNguoiDay: "KHONG_XET",
    daNhan: v.daNhan,
    graceCutover: v.graceCutover && !v.daNhan,
    checkInAt: null,
    checkOutAt: null,
    canhBaoLuot: [],
    ngoaiLe: [],
    dongDoi: {
      attendanceInId: null,
      attendanceOutId: null,
      nguoiDayId: v.buoi.nguoiDay?.id ?? null,
      nguonNguoiDay: v.buoi.nguoiDay?.nguon ?? null,
      tinhTrangBuoi: v.buoi.tinhTrang,
      chinhSach: v.chinhSach,
    },
  };
  const xong = (): BangChungPhanCong => ({ ...ra, dauVan: dauVan(v, ra) });

  // LEGACY: không áp ngữ nghĩa SR.QD.238 ngược về trước 15/10.
  if (!requiredFrom || !requiredTo) return xong();

  const chon = chonKhoang(v.khoang, pc.centerId, requiredFrom, requiredTo, v.now);
  const khacCoSo = (k: KhoangCoMat) => k.centerId !== pc.centerId;

  // Buổi đã huỷ / lớp đã đóng: không có ứng viên thực hiện. Có mặt trong khung ⇒ chỉ báo để đối soát.
  if (v.buoi.tinhTrang === "DA_DONG") {
    ra.trangThai = "BUOI_DA_HUY";
    if (chon) {
      ra.ngoaiLe.push("SESSION_CANCELLED_WITH_ATTENDANCE");
      ra.dongDoi.attendanceInId = chon.k.inId;
      ra.dongDoi.attendanceOutId = chon.k.outId;
    }
    return xong();
  }

  if (v.now.getTime() < requiredFrom.getTime()) {
    ra.trangThai = "CHUA_DEN_GIO";
    ra.coMat = "CHUA_DEN_GIO";
    return xong();
  }

  if (!v.daNhan) ra.ngoaiLe.push("ASSIGNMENT_NOT_ACCEPTED");

  // Người thật sự đứng lớp — CHỈ vai đứng chính, CHỈ khi buổi đã chốt (trước đó cột thực dạy chưa có nghĩa). Trợ giảng không
  // bao giờ nằm trong cột thực dạy ⇒ không xét (§20).
  const daChot = v.buoi.tinhTrang === "DA_CHOT";
  if (pc.role === "MAIN_TEACHER" && daChot && v.buoi.nguoiDay) {
    ra.khopNguoiDay = v.buoi.nguoiDay.id === pc.userId ? "KHOP" : "LECH";
    if (ra.khopNguoiDay === "LECH") ra.ngoaiLe.push("MAIN_ACTUAL_MISMATCH");
  }
  const daHetGio = v.now.getTime() >= requiredTo.getTime();
  if (!daChot && daHetGio && v.daNhan) ra.ngoaiLe.push("ASSIGNMENT_ACCEPTED_BUT_SESSION_NOT_RUN");

  if (!chon) {
    ra.coMat = "KHONG";
    // Có mặt ở cơ sở KHÁC trong khung ⇒ nêu ra (không gắn — khác cơ sở không phải bằng chứng cho buổi này).
    const khac = v.khoang.find((k) => khacCoSo(k) && (k.den ?? v.now).getTime() > requiredFrom.getTime() && k.tu.getTime() < requiredTo.getTime());
    if (khac) ra.ngoaiLe.push("PRESENT_AT_OTHER_CENTER");
    ra.ngoaiLe.push("ASSIGNED_NO_ATTENDANCE");
    ra.trangThai = ra.khopNguoiDay === "LECH" ? "SAI_NGUOI_DUNG_LOP" : "KHONG_BANG_CHUNG";
    return xong();
  }

  const k = chon.k;
  ra.checkInAt = k.tu;
  ra.checkOutAt = k.den;
  ra.canhBaoLuot = k.canhBao;
  ra.dongDoi.attendanceInId = k.inId;
  ra.dongDoi.attendanceOutId = k.outId;
  ra.treVaoPhut = Math.max(0, phutGiua(requiredFrom, k.tu));
  ra.diMuon = ra.treVaoPhut > v.dungSai.treVaoPhut;
  if (ra.diMuon) ra.ngoaiLe.push("LATE");

  if (!k.den) {
    ra.coMat = daHetGio ? "THIEU_RA" : "DANG_O";
    if (daHetGio) ra.ngoaiLe.push("MISSING_CHECKOUT");
  } else {
    ra.raSomPhut = Math.max(0, phutGiua(k.den, requiredTo));
    ra.raSom = ra.raSomPhut > v.dungSai.veSomPhut;
    // Có cả vào lẫn ra ⇒ CÓ MẶT; về sớm là một chiều riêng (không gộp thành "không có mặt", không chia tỉ lệ tiền — P5).
    ra.coMat = "DU";
    if (ra.raSom) ra.ngoaiLe.push("EARLY_LEAVE");
  }

  ra.trangThai =
    ra.khopNguoiDay === "LECH"
      ? "SAI_NGUOI_DUNG_LOP"
      : ra.coMat === "DANG_O"
        ? "DA_VAO"
        : ra.coMat === "THIEU_RA"
          ? "THIEU_RA"
          : ra.diMuon
            ? "DI_MUON"
            : ra.raSom
              ? "RA_SOM"
              : "DU_BANG_CHUNG";
  return xong();
}

function dauVan(v: DauVaoBangChung, ra: Omit<BangChungPhanCong, "dauVan">): string {
  return fnv(
    JSON.stringify([
      ra.assignmentId,
      ra.assignmentVersion,
      v.daNhan,
      v.phanCong.status,
      v.phanCong.ngay,
      v.phanCong.gioBatDau,
      v.phanCong.gioKetThuc,
      v.phanCong.centerId,
      v.buoi.tinhTrang,
      v.buoi.apDung,
      v.buoi.nguoiDay?.id ?? null,
      v.chuanBiPhut,
      v.chinhSach,
      v.dungSai.treVaoPhut,
      v.dungSai.veSomPhut,
      ra.dongDoi.attendanceInId,
      ra.dongDoi.attendanceOutId,
      ra.checkInAt?.toISOString() ?? null,
      ra.checkOutAt?.toISOString() ?? null,
      // `now` CHỈ đổi kết luận khi vượt các mốc — đưa trạng thái đã suy (không đưa `now` thô) để dấu vân ổn định.
      ra.coMat,
    ]),
  );
}

// ─── Ngoại lệ ngoài từng phân công ───────────────────────────────────────────────────────────

export type NgoaiLeBuoi = { sourceType: WorkSourceType; sourceId: string; ma: "SESSION_COMPLETED_WITHOUT_CONFIRMED_MAIN" | "TA_PRESENT_WITHOUT_ASSIGNMENT"; userId: string | null };

/**
 * Ngoại lệ cấp BUỔI: buổi đã chốt mà không có GV đứng chính ĐÃ NHẬN; trợ giảng mặc định của lớp có mặt trọn khung mà không có
 * phân công trợ giảng nào sống. Không tự sửa — chỉ nêu.
 */
export function ngoaiLeCapBuoi(p: {
  sourceType: WorkSourceType;
  sourceId: string;
  centerId: string;
  tinhTrang: TinhTrangBuoi;
  apDung: boolean;
  requiredFrom: Date | null;
  requiredTo: Date | null;
  coMainDaNhan: boolean;
  coTaSong: boolean;
  macDinhTaId: string | null;
  khoangTaMacDinh: readonly KhoangCoMat[];
  now: Date;
}): NgoaiLeBuoi[] {
  const ra: NgoaiLeBuoi[] = [];
  if (!p.apDung || !p.requiredFrom || !p.requiredTo) return ra;
  if (p.tinhTrang === "DA_CHOT" && !p.coMainDaNhan) ra.push({ sourceType: p.sourceType, sourceId: p.sourceId, ma: "SESSION_COMPLETED_WITHOUT_CONFIRMED_MAIN", userId: null });
  if (p.tinhTrang !== "DA_DONG" && p.macDinhTaId && !p.coTaSong && chonKhoang(p.khoangTaMacDinh, p.centerId, p.requiredFrom, p.requiredTo, p.now)) {
    ra.push({ sourceType: p.sourceType, sourceId: p.sourceId, ma: "TA_PRESENT_WITHOUT_ASSIGNMENT", userId: p.macDinhTaId });
  }
  return ra;
}

export type LuotKhongGan = { userId: string; workDate: string; inId: string | null; outId: string | null; tu: Date; den: Date | null; ma: "UNMATCHED_ATTENDANCE" };

/**
 * Khoảng có mặt ở cơ sở không giao với BẤT KỲ khung phân công nào của người đó trong ngày ⇒ `UNMATCHED_ATTENDANCE`. KHÔNG phải
 * lỗi (trực vận hành, họp, việc khác) — chỉ là ngữ cảnh để rà; KHÔNG sinh phân công từ chấm công.
 */
export function luotKhongGan(p: {
  userId: string;
  workDate: string;
  centerId: string;
  khoang: readonly KhoangCoMat[];
  khungPhanCong: readonly { tu: Date; den: Date }[];
  now: Date;
}): LuotKhongGan[] {
  return p.khoang
    .filter((k) => k.centerId === p.centerId)
    .filter((k) => !p.khungPhanCong.some((f) => Math.min((k.den ?? p.now).getTime(), f.den.getTime()) - Math.max(k.tu.getTime(), f.tu.getTime()) > 0))
    .map((k) => ({ userId: p.userId, workDate: p.workDate, inId: k.inId, outId: k.outId, tu: k.tu, den: k.den, ma: "UNMATCHED_ATTENDANCE" as const }));
}
