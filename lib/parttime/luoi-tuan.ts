// lib/parttime/luoi-tuan.ts — LƯỚI PHÂN CÔNG GIÁO VIÊN (S/C/T): xếp tiết vào ca, suy mã ô, tiền DỰ KIẾN một ca, cổng hỗ trợ
// Trial. THUẦN — không `@/lib/db`, không đồng hồ (`now` truyền vào). Tài liệu: docs/cham-cong/parttime/23-LUOI-PHAN-CONG-GV.md.
//
// Lưới là PROJECTION, không phải nguồn sự thật: mã ô (`MaO`) được SUY RA mỗi lần đọc từ phân công buổi + dòng trực + điểm danh
// Trial. Không bảng nào lưu "D/T/TD" để tính lương. Mã ở đây có KHÔNG GIAN TÊN RIÊNG — `X` · `T` · `D2` của `ShiftTemplate`
// (`lib/cham-cong/catalog.ts`) nghĩa khác hẳn (nghỉ · ca tối · làm tại CS2); KHÔNG BAO GIỜ ghi các mã này vào ô ca chấm công.
//
// Tiền ở đây là DỰ KIẾN (xem trước): mọi số lấy từ tham số chính sách (`ThamSoSrQd238`) — không hằng số. Công thật vẫn chỉ sinh ở
// P5 (QLCS xác nhận, `WorkUnit` chụp đơn giá). Trực theo D-Q3: CHỈ khi có dòng trực tường minh; 0 tiết ⇒ cả ca · 1 ⇒ nửa ca ·
// ≥ `toiDaTietMoiCa` ⇒ 0 (không trả chồng, SR.QD.238 §2). Trial KHÔNG phải tiết đứng chính (§1) — chỉ là lớp phủ `+TR`.
import type { DonViTiet } from "./don-vi-tiet";
import { donGiaMain, phutTrongNgay, type ThamSoSrQd238 } from "./chinh-sach";

/** Mã nền của ô. `null` = cấu hình không có trong bảng mã (quá số tiết tối đa một ca) — màn hiện cảnh báo, không bịa mã. */
export type MaO = "X" | "D" | "T" | "TG" | "TD" | "TTG" | "D2" | "D+TG" | "TG2";

/** Loại hoạt động của MỘT phân công dạy. REGULAR/MAKEUP/ADVANCE/SUBSTITUTE đều là tiết đứng chính (D); TRIAL thì không. */
export type LoaiHoatDong = "REGULAR" | "MAKEUP" | "ADVANCE" | "SUBSTITUTE" | "TRIAL";

export type HoatDongO = {
  /** assignmentId — dòng dõi cho drawer / đối soát. */
  id: string;
  /** id NGUỒN (ClassSession / MakeupCase / TrialClassSession) — để khớp quyết định giữ trực theo case bù. BẮT BUỘC (luật 7). */
  nguonId: string;
  vai: "MAIN" | "TA";
  loai: LoaiHoatDong;
  /** Giờ DẠY "HH:mm" (không gồm 10' chuẩn bị) — cùng quy ước `danhGiaTruc`. */
  gioBatDau: string;
  gioKetThuc: string;
  /** Số tiết của buổi (`donViTiet`) — buổi lệch chuẩn không ghi đè ⇒ NEEDS_POLICY_DECISION. */
  donViTiet: DonViTiet;
};

export type TrucO = {
  dutyId: string;
  /** Case học bù mà QLCS đã chọn "GV TIẾP TỤC trực phần còn lại của ca" (PR6, chủ dự án 24/10/2026). BẮT BUỘC (luật 7). */
  giuVoiCaseBu: readonly string[];
};

/**
 * Ca chứa TRỌN phần dạy `[bat, ket]`. Không ca nào chứa trọn ⇒ null (vượt ca — không đoán). C (13:45–17:30) và T (17:15–21:00)
 * chồng 15': một tiết dạy ≥ 15' không thể nằm trọn trong cả hai, nên kết quả là duy nhất; nếu hai ca cùng chứa (tham số lạ) ⇒ null.
 */
export function xepVaoCa(ts: ThamSoSrQd238, gioBatDau: string, gioKetThuc: string): string | null {
  const a = phutTrongNgay(gioBatDau);
  const b = phutTrongNgay(gioKetThuc);
  const chua = ts.ca.filter((c) => phutTrongNgay(c.tu) <= a && b <= phutTrongNgay(c.den));
  return chua.length === 1 ? chua[0]!.ma : null;
}

/** Mã nền từ số tiết MAIN / TA và việc có dòng trực. Quá 2 tiết (hoặc cấu hình ngoài bảng) ⇒ null. */
export function maNen(p: { main: number; ta: number; truc: boolean }): MaO | null {
  const { main, ta, truc } = p;
  if (main + ta === 0) return truc ? "T" : "X";
  if (main === 1 && ta === 0) return truc ? "TD" : "D";
  if (main === 0 && ta === 1) return truc ? "TTG" : "TG";
  if (main === 2 && ta === 0) return "D2";
  if (main === 1 && ta === 1) return "D+TG";
  if (main === 0 && ta === 2) return "TG2";
  return null;
}

/** Trực quy đổi của một ca có dòng trực: 0 tiết ⇒ 1 ca · dưới `toiDaTietMoiCa` ⇒ nửa ca · đủ ⇒ 0 (SR.QD.238 §2, không trả chồng).
 *  MỘT chỗ cho cả tiền dự kiến (`tinhCaDuKien`) lẫn mã ô (`tinhMaO`, lib/phan-cong/ma-o.ts). */
export function trucQuyDoi(soTiet: number, toiDaTietMoiCa: number): number {
  return soTiet === 0 ? 1 : soTiet < toiDaTietMoiCa ? 0.5 : 0;
}

export type DongTien = {
  loai: "MAIN" | "TA" | "TRUC" | "TRIAL";
  /** Số tiết / số ca (0,5 = nửa ca) / số học viên Trial. */
  soLuong: number;
  donGia: number;
  /** null = không tính được (trực khi có tiết lệch chuẩn chưa quyết). */
  thanhTien: number | null;
  /** Dòng dõi: assignmentId / dutyId. */
  nguon: string[];
};

/** `CAN_QUYET_TRUC`: ca có trực + buổi HỌC BÙ mà chưa ai quyết GV còn trực phần còn lại không ⇒ không suy TD, tiền trực chưa tính. */
export type CanhBaoCa = "POLICY_UNRESOLVED" | "TRUC_CHUA_TINH_DUOC" | "QUA_SO_TIET" | "CAN_QUYET_TRUC";

export type CaDuKien = {
  ma: MaO | null;
  coTrial: boolean;
  dong: DongTien[];
  /** Tổng các dòng tính được (dòng `thanhTien: null` không cộng — đã có cảnh báo). */
  tong: number;
  canhBao: CanhBaoCa[];
};

/** Số tiết của một hoạt động: CHUAN "1" · GHI_DE số thập phân · NEEDS_POLICY_DECISION ⇒ null (không đoán 0,6 / 1,2). */
const soTiet = (d: DonViTiet): number | null => (d.trangThai === "NEEDS_POLICY_DECISION" ? null : Number(d.donVi));

/**
 * Tiền DỰ KIẾN của một ô (người × ngày × ca) ở Rank `rank` (đã giải bằng `rankTaiNgay`). `hoatDong` = phân công dạy CÒN SỐNG
 * của người đó đã xếp vào ca này (`xepVaoCa`); `trial` = kết quả `xetHoTroTrial` của các buổi trial MAIN trong ca.
 */
export function tinhCaDuKien(p: {
  thamSo: ThamSoSrQd238;
  rank: number;
  hoatDong: readonly HoatDongO[];
  truc: TrucO | null;
  trial: readonly { soTien: number }[];
}): CaDuKien {
  const day = p.hoatDong.filter((h) => h.loai !== "TRIAL");
  const main = day.filter((h) => h.vai === "MAIN");
  const ta = day.filter((h) => h.vai === "TA");
  const coTrial = p.hoatDong.some((h) => h.loai === "TRIAL") || p.trial.length > 0;
  const canhBao: CanhBaoCa[] = [];
  const dong: DongTien[] = [];

  const dongDay = (loai: "MAIN" | "TA", ds: readonly HoatDongO[], donGia: number) => {
    if (!ds.length) return;
    let so = 0;
    for (const h of ds) {
      const t = soTiet(h.donViTiet);
      if (t == null) {
        if (!canhBao.includes("POLICY_UNRESOLVED")) canhBao.push("POLICY_UNRESOLVED");
        continue;
      }
      so += t;
    }
    dong.push({ loai, soLuong: so, donGia, thanhTien: Math.round(so * donGia), nguon: ds.map((h) => h.id) });
  };
  dongDay("MAIN", main, donGiaMain(p.thamSo, p.rank));
  dongDay("TA", ta, p.thamSo.donGia.troGiang);

  const soSlot = main.length + ta.length;
  // PR6 (chủ dự án 24/10/2026): GV đang trực được book học bù ⇒ phải có người quyết "còn trực phần còn lại không". Chưa quyết ⇒ KHÔNG
  // suy T + bù = TD: mã chỉ tính phần chắc chắn (dạy), tiền trực chưa tính. Chỉ khi quyết đổi được tiền (ca còn chỗ trả nửa ca trực).
  const buChuaQuyet = p.truc ? main.filter((h) => h.loai === "MAKEUP" && !p.truc!.giuVoiCaseBu.includes(h.nguonId)) : [];
  const choQuyet = p.truc != null && buChuaQuyet.length > 0 && soSlot < p.thamSo.toiDaTietMoiCa;
  const ma = maNen({ main: main.length, ta: ta.length, truc: p.truc != null && !choQuyet });
  if (ma == null) canhBao.push("QUA_SO_TIET");

  if (p.truc) {
    const lech = canhBao.includes("POLICY_UNRESOLVED");
    if (lech || ma == null || choQuyet) {
      // Không đoán một buổi lệch chuẩn (hay ô quá tải) chiếm bao nhiêu nửa ca — giống `danhGiaTruc` chặn Q1; cũng không đoán GV còn trực sau buổi bù.
      dong.push({ loai: "TRUC", soLuong: 0, donGia: p.thamSo.donGia.trucCa, thanhTien: null, nguon: [p.truc.dutyId] });
      if (lech || ma == null) canhBao.push("TRUC_CHUA_TINH_DUOC");
      if (choQuyet) canhBao.push("CAN_QUYET_TRUC");
    } else {
      const soCa = trucQuyDoi(soSlot, p.thamSo.toiDaTietMoiCa);
      dong.push({ loai: "TRUC", soLuong: soCa, donGia: p.thamSo.donGia.trucCa, thanhTien: Math.round(soCa * p.thamSo.donGia.trucCa), nguon: [p.truc.dutyId] });
    }
  }

  for (const t of p.trial) dong.push({ loai: "TRIAL", soLuong: 0, donGia: 0, thanhTien: t.soTien, nguon: [] });
  const tong = dong.reduce((s, d) => s + (d.thanhTien ?? 0), 0);
  return { ma, coTrial, dong, tong, canhBao };
}

// ─── Hỗ trợ Trial ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export type LyDoTrial =
  | "TRIAL_POLICY_DISABLED"
  | "CERTIFICATE_MISSING"
  | "NOT_ASSIGNED_BEFORE_SESSION"
  | "TRIAL_TEACHER_MISMATCH"
  | "CASE_CANCELLED"
  | "STUDENT_ABSENT"
  | "ATTENDANCE_PENDING"
  | "DUPLICATE_CLAIM";

export type XetTrialVao = {
  /** Dòng chính sách hỗ trợ Trial phủ NGÀY buổi, đúng phạm vi cơ sở (null = không có bản nào phủ). */
  chinhSach: { bat: boolean; mucMoiHocVien: number } | null;
  /** Chứng nhận Trial của GV còn hiệu lực TẠI NGÀY buổi. */
  chungNhanHieuLuc: boolean;
  /** Lúc tạo phân công MAIN của buổi trial (từ chính dòng phân công). */
  phanCongTaoLuc: Date;
  batDauBuoi: Date;
  ketThucBuoi: Date;
  /** Người trên phân công vs GV hiện ghi trên buổi — lệch nhau khi đổi GV sau khi buổi đã chốt (phân công đóng băng). */
  nguoiPhanCong: string;
  gvCuaBuoi: string | null;
  buoiHuy: boolean;
  /** `diemDanh: null` = chưa có dòng điểm danh (CHƯA điểm danh — không phải vắng). `hopLe` = ghi danh trial còn hiệu lực. */
  hocVien: readonly { ghiDanhId: string; hopLe: boolean; diemDanh: "PRESENT" | "ABSENT" | null }[];
  now: Date;
};

export type KetQuaTrial = {
  trangThai: "DU_DIEU_KIEN" | "KHONG_DU" | "CHO_DIEM_DANH" | "NEEDS_REVIEW" | "CHUA_DIEN_RA";
  soCoMat: number;
  soTien: number;
  lyDo: LyDoTrial[];
};

/**
 * Hỗ trợ Trial DỰ KIẾN cho MỘT buổi: `mucMoiHocVien × số học viên PRESENT` khi qua MỌI cổng (SR.QD.238 §6: có chứng nhận, được
 * phân công trước ca, tính theo học viên có mặt). Thiếu một cổng ⇒ 0 kèm mã lý do. Không bao giờ coi "chưa điểm danh" là vắng.
 */
export function xetHoTroTrial(v: XetTrialVao): KetQuaTrial {
  if (v.buoiHuy) return { trangThai: "KHONG_DU", soCoMat: 0, soTien: 0, lyDo: ["CASE_CANCELLED"] };
  const lyDo: LyDoTrial[] = [];

  const daThay = new Set<string>();
  let coMat = 0;
  let choDiem = false;
  let coVang = false;
  for (const h of v.hocVien) {
    if (!h.hopLe) continue;
    if (daThay.has(h.ghiDanhId)) {
      if (!lyDo.includes("DUPLICATE_CLAIM")) lyDo.push("DUPLICATE_CLAIM");
      continue;
    }
    daThay.add(h.ghiDanhId);
    if (h.diemDanh === "PRESENT") coMat++;
    else if (h.diemDanh === "ABSENT") coVang = true;
    else choDiem = true;
  }

  if (v.now.getTime() < v.batDauBuoi.getTime()) return { trangThai: "CHUA_DIEN_RA", soCoMat: 0, soTien: 0, lyDo };

  if (v.gvCuaBuoi != null && v.gvCuaBuoi !== v.nguoiPhanCong) {
    return { trangThai: "NEEDS_REVIEW", soCoMat: coMat, soTien: 0, lyDo: [...lyDo, "TRIAL_TEACHER_MISMATCH"] };
  }
  if (!v.chinhSach || !v.chinhSach.bat) lyDo.push("TRIAL_POLICY_DISABLED");
  if (!v.chungNhanHieuLuc) lyDo.push("CERTIFICATE_MISSING");
  if (v.phanCongTaoLuc.getTime() >= v.batDauBuoi.getTime()) lyDo.push("NOT_ASSIGNED_BEFORE_SESSION");

  if (choDiem) return { trangThai: "CHO_DIEM_DANH", soCoMat: coMat, soTien: 0, lyDo: [...lyDo, "ATTENDANCE_PENDING"] };
  const chan = lyDo.some((l) => l !== "DUPLICATE_CLAIM");
  if (coMat === 0) {
    if (coVang) lyDo.push("STUDENT_ABSENT");
    return { trangThai: "KHONG_DU", soCoMat: 0, soTien: 0, lyDo };
  }
  if (chan) return { trangThai: "KHONG_DU", soCoMat: coMat, soTien: 0, lyDo };
  return { trangThai: "DU_DIEU_KIEN", soCoMat: coMat, soTien: coMat * v.chinhSach!.mucMoiHocVien, lyDo };
}
