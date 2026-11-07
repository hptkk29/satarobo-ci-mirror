// lib/portal/hv-hanh-trinh-thuan.ts — Cổng học sinh, màn "Hành trình & huy hiệu" (artifact HV-Hanh-trinh): phần THUẦN.
// Bản đồ chặng, huy hiệu (CHỈ loại có luật tính thật từ dữ liệu sẵn có), thang kỹ năng. Không DB.

export type TrangThaiChang = "xong" | "vang" | "sau" | "toi" | "chua-cham";

export type BuoiVaoBanDo = {
  id: string;
  /** Số buổi trong LỘ TRÌNH (1..tổng) — cũng là số chặng. */
  order: number;
  title: string;
  /** Nhãn ngắn `T7, 07/11` tính sẵn theo lịch VN. */
  ngayNgan: string;
  past: boolean;
  attendance: "PRESENT" | "EXCUSED" | "ABSENT" | "MAKEUP" | "FUTURE" | "UNMARKED" | "CANCELLED";
};

export type Chang = {
  n: number;
  trangThai: TrangThaiChang;
  demo: boolean;
  /** Tên bài; `null` khi lớp chưa ghim giáo trình (hiện chữ mờ, không bịa). */
  ten: string | null;
  ngayNgan: string | null;
  coSanPham: boolean;
};

export type HocPhanBanDo = {
  so: number;
  ten: string;
  chip: "Hoàn thành" | "Em đang ở đây" | "Chưa mở";
  chang: Chang[];
};

const laDemo = (t: string) => /^demo\b/i.test(t.trim());
const tenThat = (t: string): string | null => {
  const s = t.trim();
  return s === "" || s === "Buổi học" ? null : s;
};

/**
 * Dựng bản đồ chặng: mỗi học phần 12 chặng (như bản thiết kế 4×12). `tiepTheoId` = buổi tiếp theo; buổi đã huỷ bị bỏ (không có
 * chặng nào "huỷ" trong bản vẽ). Chặng không có buổi tương ứng (khoá chưa xếp đủ lịch) vẫn vẽ ở trạng thái "toi" để đủ lưới.
 */
export function dungBanDo(
  buoi: BuoiVaoBanDo[],
  tiepTheoId: string | null,
  tong: number,
  buoiCoAnh: ReadonlySet<string>,
): HocPhanBanDo[] {
  const theoSo = new Map<number, BuoiVaoBanDo>();
  for (const b of buoi) if (b.attendance !== "CANCELLED" && b.order > 0 && !theoSo.has(b.order)) theoSo.set(b.order, b);
  const soChang = Math.max(tong, ...[...theoSo.keys()], 0);
  const chang: Chang[] = [];
  for (let n = 1; n <= soChang; n++) {
    const b = theoSo.get(n);
    let tt: TrangThaiChang = "toi";
    if (b) {
      if (b.id === tiepTheoId) tt = "sau";
      else if (b.attendance === "ABSENT" || b.attendance === "EXCUSED") tt = "vang";
      else if (b.attendance === "UNMARKED") tt = "chua-cham";
      else if (b.past || b.attendance === "PRESENT" || b.attendance === "MAKEUP") tt = "xong";
    }
    chang.push({
      n,
      trangThai: tt,
      demo: b ? laDemo(b.title) : false,
      ten: b ? tenThat(b.title) : null,
      ngayNgan: b?.ngayNgan ?? null,
      coSanPham: b ? buoiCoAnh.has(b.id) : false,
    });
  }
  const soHp = Math.max(1, Math.ceil(soChang / 12));
  // học phần "đang ở": chứa chặng tiếp theo; không có chặng tiếp theo thì là học phần của chặng đã học cuối cùng
  const viTriTiep = chang.findIndex((c) => c.trangThai === "sau");
  const viTriCuoiHoc = chang.reduce((a, c, i) => (c.trangThai === "xong" || c.trangThai === "vang" ? i : a), -1);
  const hpDang = Math.floor((viTriTiep >= 0 ? viTriTiep : Math.max(0, viTriCuoiHoc)) / 12) + 1;
  const ds: HocPhanBanDo[] = [];
  for (let h = 1; h <= soHp; h++) {
    const c = chang.slice((h - 1) * 12, h * 12);
    const hetHoc = c.length > 0 && c.every((x) => x.trangThai === "xong");
    ds.push({
      so: h,
      ten: `Học phần ${h}`,
      chip: hetHoc ? "Hoàn thành" : h === hpDang ? "Em đang ở đây" : h < hpDang ? "Hoàn thành" : "Chưa mở",
      chang: c,
    });
  }
  return ds;
}

/** Câu mô tả chặng đang chọn (nhãn nhỏ + lời ghi). Không hứa điều hệ thống không biết (vd. "được thầy cô nhận xét"). */
export function moTaChang(c: Chang): { nhan: string; ghi: string } {
  switch (c.trangThai) {
    case "xong":
      return {
        nhan: "ĐÃ HỌC · CÓ MẶT",
        ghi: c.coSanPham ? "Em đã học buổi này. Ảnh sản phẩm của buổi nằm trong Góc sản phẩm." : "Em đã học buổi này.",
      };
    case "vang":
      return { nhan: "EM VẮNG BUỔI NÀY", ghi: "Ba mẹ đang xếp lịch học bù cho em. Học bù xong chặng này sẽ sáng màu cam." };
    case "sau":
      return { nhan: `CHẶNG TIẾP THEO${c.ngayNgan ? ` · ${c.ngayNgan.toUpperCase()}` : ""}`, ghi: "Chuẩn bị tinh thần nhé!" };
    case "chua-cham":
      return { nhan: "ĐÃ DIỄN RA", ghi: "Thầy cô chưa điểm danh buổi này." };
    default:
      return { nhan: "CHƯA TỚI", ghi: "Chặng này sẽ mở khi em học tới." };
  }
}

/** Chặng mở sẵn khi vào trang: chặng đã học gần nhất (như bản thiết kế "tiếp theo − 1"), không có thì chặng tiếp theo, không thì 1. */
export function changMacDinh(ds: HocPhanBanDo[]): number {
  const tat = ds.flatMap((h) => h.chang);
  const xong = [...tat].reverse().find((c) => c.trangThai === "xong");
  return (xong ?? tat.find((c) => c.trangThai === "sau") ?? tat[0])?.n ?? 1;
}

// ── Huy hiệu ──────────────────────────────────────────────────────────────────────────

export type MaHuyHieu = "buoi-dau" | "dung-hen" | "cham-chi" | "diem-10" | "dong-doi" | "xong-hoc-phan" | "nua-chang" | "ve-dich";

export type HuyHieu = { ma: MaHuyHieu; ten: string; dieuKien: string; da: boolean; icon: string };

/** Đường vẽ chép từ artifact. */
const ICON: Record<MaHuyHieu, string> = {
  "buoi-dau": "M12 2l3 7h7l-5.5 4.5 2 7.5L12 16.5 5.5 21l2-7.5L2 9h7z",
  "dung-hen": "M12 7v5l3 3M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
  "cham-chi": "M4 5h16v16H4zM4 10h16M9 15l2 2 4-4",
  "diem-10": "M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z",
  "dong-doi": "M9 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17 9a2.5 2.5 0 1 0 0-5M3 20a6 6 0 0 1 12 0M15 20a4 4 0 0 1 6-3",
  "xong-hoc-phan": "M6 3h12v5a6 6 0 0 1-12 0zM9 21h6M12 14v7",
  "nua-chang": "M3 12h18M12 3v18",
  "ve-dich": "M4 22V4h12l-2 4 2 4H4",
};

export type DauVaoHuyHieu = {
  daHoc: number;
  tong: number;
  /** Số bài nộp ĐÚNG HẠN (có hạn thật và nộp trước hạn). */
  baiDungHan: number;
  /** Có ít nhất một bài đã chấm đạt điểm tối đa. */
  coBaiDiemToiDa: boolean;
  /** Điểm danh theo thứ tự buổi (cũ → mới). */
  diemDanh: string[];
  /** Mức kỹ năng "Hợp tác nhóm" mới nhất. */
  nhom: string | null;
};

/**
 * Huy hiệu chỉ đạt được qua bài tập (nộp đúng hạn · điểm tối đa). «Bài tập & bài thi» tạm ẩn 03/11/2026 ⇒ hệ thống chưa có bài để nộp,
 * hiện hai huy hiệu này là hứa một điều không ai làm được (luật 12) — ẩn cùng mục. Bật lại mục thì hiện lại.
 */
export const HUY_HIEU_CAN_BAI_TAP: readonly MaHuyHieu[] = ["dung-hen", "diem-10"];

/** Lọc danh sách huy hiệu theo công tắc «Bài tập & bài thi» (`dangHien` BẮT BUỘC — không mặc định). */
export function huyHieuTheoMuc(ds: readonly HuyHieu[], dangHien: boolean): HuyHieu[] {
  return dangHien ? [...ds] : ds.filter((h) => !HUY_HIEU_CAN_BAI_TAP.includes(h.ma));
}

/** Chuỗi có mặt liên tiếp dài nhất. Vắng/vắng phép cắt chuỗi; buổi huỷ, chưa tới và chưa chấm KHÔNG cắt và không cộng. */
export function chuoiCoMatDaiNhat(diemDanh: readonly string[]): number {
  let hienTai = 0;
  let max = 0;
  for (const s of diemDanh) {
    if (s === "PRESENT" || s === "MAKEUP") {
      hienTai += 1;
      if (hienTai > max) max = hienTai;
    } else if (s === "ABSENT" || s === "EXCUSED") hienTai = 0;
  }
  return max;
}

/**
 * CHỈ tám huy hiệu có luật tính từ dữ liệu có thật. Bản thiết kế có 12; bốn huy hiệu còn lại (Kỹ sư nhí, Diễn giả, Nhà sáng chế,
 * Thợ săn lỗi) cần dữ liệu "dự án / trình bày / tự cải tiến / tự sửa lỗi" mà hệ thống chưa ghi — KHÔNG vẽ, đừng bịa trạng thái.
 */
export function tinhHuyHieu(i: DauVaoHuyHieu): HuyHieu[] {
  const hocPhan = Math.min(12, i.tong > 0 ? i.tong : 12);
  const dk: Record<MaHuyHieu, { ten: string; dieuKien: string; da: boolean }> = {
    "buoi-dau": { ten: "Buổi đầu tiên", dieuKien: "Học buổi 1", da: i.daHoc >= 1 },
    "dung-hen": { ten: "Đúng hẹn", dieuKien: "Nộp 3 bài đúng hạn", da: i.baiDungHan >= 3 },
    "cham-chi": { ten: "Chăm chỉ", dieuKien: "Có mặt 5 buổi liền", da: chuoiCoMatDaiNhat(i.diemDanh) >= 5 },
    "diem-10": { ten: "Điểm 10", dieuKien: "Một bài đạt điểm tối đa", da: i.coBaiDiemToiDa },
    "dong-doi": { ten: "Đồng đội", dieuKien: "Thầy cô khen làm nhóm", da: i.nhom === "EXCELLENT" },
    "xong-hoc-phan": { ten: "Xong học phần", dieuKien: `Hoàn thành ${hocPhan} buổi`, da: i.tong > 0 && i.daHoc >= hocPhan },
    "nua-chang": {
      ten: "Nửa chặng đường",
      dieuKien: `Học xong ${Math.ceil(i.tong / 2)} buổi`,
      da: i.tong > 12 && i.daHoc * 2 >= i.tong,
    },
    "ve-dich": { ten: "Về đích", dieuKien: "Hoàn thành cả khoá", da: i.tong > 0 && i.daHoc >= i.tong },
  };
  return (Object.keys(dk) as MaHuyHieu[]).map((ma) => ({ ma, icon: ICON[ma], ...dk[ma] }));
}

// ── Kỹ năng ───────────────────────────────────────────────────────────────────────────

export const NHAN_KY_NANG: Record<string, string> = {
  MECH_ASSEMBLY: "Lắp ráp cơ khí",
  ALGORITHM: "Tư duy logic",
  PROGRAMMING: "Lập trình",
  SENSOR: "Cảm biến",
  MOTOR_CONTROL: "Điều khiển động cơ",
  PROBLEM_SOLVING: "Giải quyết vấn đề",
  TEAMWORK: "Hợp tác nhóm",
  PRESENTATION: "Thuyết trình",
  CREATIVITY: "Sáng tạo",
  COMPETITION_READY: "Sẵn sàng thi đấu",
};

const MUC: Record<string, { pct: number; chu: string; sac: "tot" | "vua" | "tap" }> = {
  NEED_SUPPORT: { pct: 45, chu: "Đang tập", sac: "tap" },
  BASIC: { pct: 65, chu: "Cơ bản", sac: "vua" },
  GOOD: { pct: 82, chu: "Tốt", sac: "tot" },
  EXCELLENT: { pct: 95, chu: "Xuất sắc", sac: "tot" },
};

export type KyNang = { ten: string; pct: number; chu: string; sac: "tot" | "vua" | "tap" };

/** Mức MỚI NHẤT của mỗi kỹ năng. `dongs` đã sắp mới → cũ. Mức lạ bị bỏ (không đoán %). */
export function gomKyNang(dongs: { skill: string; level: string }[]): KyNang[] {
  const thay = new Set<string>();
  const ra: KyNang[] = [];
  for (const d of dongs) {
    if (thay.has(d.skill)) continue;
    thay.add(d.skill);
    const m = MUC[d.level];
    if (!m) continue;
    ra.push({ ten: NHAN_KY_NANG[d.skill] ?? d.skill, pct: m.pct, chu: m.chu, sac: m.sac });
  }
  return ra;
}
