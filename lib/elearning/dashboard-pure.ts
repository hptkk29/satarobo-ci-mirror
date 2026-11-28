// lib/elearning/dashboard-pure.ts — phần THUẦN của trang chủ người học: KPI, nhóm theo hạn, chọn "tiếp tục học",
// lọc/sắp xếp/phân trang "Khoá của tôi". Không import React/DB ⇒ test được bằng Vitest.
//
// ⚠️ Mọi con số ở đây suy từ danh sách `KhoaCuaToi` mà server đã nạp (2 truy vấn bất kể số khoá — xem
// `napKhoaCuaToi`). KHÔNG số liệu giả, KHÔNG truy vấn theo từng khoá.
//
// ⚠️ Không đổi điều kiện hoàn thành/trạng thái: `status` do server ghi; hàm ở đây chỉ ĐỌC và gom nhóm để hiển thị.

import { nguoiHocTuLamDuoc } from "@/lib/elearning/lesson-kind";

export type KhoaRut = {
  enrollmentId: string;
  tenKhoa: string;
  status: string;
  dueAt: Date | null;
  progressPercent: number;
};

export type SacThai = "success" | "warning" | "danger" | "info" | "muted";

/** Cửa sổ "sắp đến hạn", tính theo ngày. */
export const NGAY_SAP_HAN = 7;
const MS_NGAY = 86_400_000;

export const daXong = (status: string) => status === "COMPLETED" || status === "COMPLETED_LATE";

export type NhomHan = "XONG" | "QUA_HAN" | "SAP_HAN" | "CON_HAN" | "KHONG_HAN";

/**
 * Xếp một khoá vào nhóm theo hạn.
 * `QUA_HAN` khi server đã đặt `OVERDUE` HOẶC hạn đã qua mà cron chưa kịp cập nhật — người học đọc ngày, và
 * "còn hạn" cho một ngày đã qua còn tệ hơn nhãn đến sớm vài giờ.
 */
export function nhomHan(k: Pick<KhoaRut, "status" | "dueAt">, now: Date): NhomHan {
  if (daXong(k.status)) return "XONG";
  if (k.status === "OVERDUE") return "QUA_HAN";
  if (!k.dueAt) return "KHONG_HAN";
  const conLai = k.dueAt.getTime() - now.getTime();
  if (conLai < 0) return "QUA_HAN";
  return conLai <= NGAY_SAP_HAN * MS_NGAY ? "SAP_HAN" : "CON_HAN";
}

const NHAN_TRANG_THAI: Record<string, { nhan: string; sac: SacThai }> = {
  NOT_STARTED: { nhan: "Chưa bắt đầu", sac: "muted" },
  IN_PROGRESS: { nhan: "Đang học", sac: "success" },
  COMPLETED: { nhan: "Đã hoàn thành", sac: "info" },
  COMPLETED_LATE: { nhan: "Hoàn thành (trễ hạn)", sac: "info" },
  OVERDUE: { nhan: "Quá hạn", sac: "danger" },
};

/** Nhãn + sắc trạng thái. Màu KHÔNG đứng một mình: luôn kèm nhãn chữ. Trạng thái lạ in nguyên mã, không đoán. */
export function trangThaiHienThi(k: Pick<KhoaRut, "status" | "dueAt">, now: Date): { nhan: string; sac: SacThai } {
  // Hạn đã qua mà cron chưa chuyển OVERDUE: hiển thị "Quá hạn" để khớp với dòng hạn bên cạnh.
  if (!daXong(k.status) && nhomHan(k, now) === "QUA_HAN") return { nhan: "Quá hạn", sac: "danger" };
  return NHAN_TRANG_THAI[k.status] ?? { nhan: k.status, sac: "muted" };
}

/** Dòng hạn: "Hạn 30/10/2026 · còn 5 ngày" / "· quá 2 ngày" / "Chưa đặt hạn". Hoàn thành thì không có dòng hạn. */
export function dongHan(k: Pick<KhoaRut, "status" | "dueAt">, now: Date): { chu: string; sac: SacThai } | null {
  const nhom = nhomHan(k, now);
  if (nhom === "XONG") return null;
  if (!k.dueAt) return { chu: "Chưa đặt hạn", sac: "muted" };
  const ngay = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }).format(k.dueAt);
  const soNgay = Math.ceil(Math.abs(k.dueAt.getTime() - now.getTime()) / MS_NGAY);
  if (nhom === "QUA_HAN") return { chu: `Hạn ${ngay} · quá ${soNgay} ngày`, sac: "danger" };
  if (nhom === "SAP_HAN") return { chu: `Hạn ${ngay} · còn ${soNgay} ngày`, sac: "warning" };
  return { chu: `Hạn ${ngay}`, sac: "muted" };
}

export type Kpi = {
  tong: number;
  dangHoc: number;
  chuaBatDau: number;
  hoanThanh: number;
  sapHan: number;
  quaHan: number;
};

export function tinhKpi(khoa: readonly KhoaRut[], now: Date): Kpi {
  const kpi: Kpi = { tong: khoa.length, dangHoc: 0, chuaBatDau: 0, hoanThanh: 0, sapHan: 0, quaHan: 0 };
  for (const k of khoa) {
    if (daXong(k.status)) {
      kpi.hoanThanh += 1;
      continue;
    }
    if (k.status === "IN_PROGRESS") kpi.dangHoc += 1;
    else if (k.status === "NOT_STARTED") kpi.chuaBatDau += 1;
    const n = nhomHan(k, now);
    if (n === "SAP_HAN") kpi.sapHan += 1;
    else if (n === "QUA_HAN") kpi.quaHan += 1;
  }
  return kpi;
}

/** Khoá nên "tiếp tục": ưu tiên khoá đã có tiến độ (đang dở), rồi khoá chưa bắt đầu. Danh sách đã sắp theo hạn gần nhất. */
export function chonTiepTuc(khoa: readonly KhoaRut[]): KhoaRut | null {
  const chuaXong = khoa.filter((k) => !daXong(k.status));
  return chuaXong.find((k) => k.status === "IN_PROGRESS" || k.progressPercent > 0) ?? chuaXong[0] ?? null;
}

export type NhomViec = { ma: "QUA_HAN" | "SAP_HAN" | "SAU_DO"; nhan: string; muc: KhoaRut[] };

const THU_TU_HAN = (a: KhoaRut, b: KhoaRut) =>
  (a.dueAt?.getTime() ?? Number.POSITIVE_INFINITY) - (b.dueAt?.getTime() ?? Number.POSITIVE_INFINITY);

/** "Việc cần làm" gom theo độ gấp (khuôn Timeline của Moodle): quá hạn · trong 7 ngày · sau đó. Nhóm rỗng bị bỏ. */
export function nhomViecCanLam(khoa: readonly KhoaRut[], now: Date): NhomViec[] {
  const nhom: NhomViec[] = [
    { ma: "QUA_HAN", nhan: "Quá hạn", muc: [] },
    { ma: "SAP_HAN", nhan: `Trong ${NGAY_SAP_HAN} ngày tới`, muc: [] },
    { ma: "SAU_DO", nhan: "Sau đó", muc: [] },
  ];
  for (const k of khoa) {
    const n = nhomHan(k, now);
    if (n === "XONG") continue;
    (n === "QUA_HAN" ? nhom[0] : n === "SAP_HAN" ? nhom[1] : nhom[2])!.muc.push(k);
  }
  for (const g of nhom) g.muc.sort(THU_TU_HAN);
  return nhom.filter((g) => g.muc.length > 0);
}

// ── Lọc / sắp xếp / phân trang "Khoá của tôi" ───────────────────────────────────────────────────

export const LOC_TRANG_THAI = [
  { ma: "tat-ca", nhan: "Tất cả" },
  { ma: "dang-hoc", nhan: "Đang học" },
  { ma: "chua-bat-dau", nhan: "Chưa bắt đầu" },
  { ma: "sap-han", nhan: "Sắp đến hạn" },
  { ma: "qua-han", nhan: "Quá hạn" },
  { ma: "hoan-thanh", nhan: "Đã hoàn thành" },
] as const;
export type LocTrangThai = (typeof LOC_TRANG_THAI)[number]["ma"];

export const SAP_XEP = [
  { ma: "han", nhan: "Hạn gần nhất" },
  { ma: "tien-do", nhan: "Tiến độ cao nhất" },
  { ma: "ten", nhan: "Tên A→Z" },
] as const;
export type SapXep = (typeof SAP_XEP)[number]["ma"];

export const SO_KHOA_MOI_TRANG = 12;

export function docLoc(v: string | undefined): LocTrangThai {
  return LOC_TRANG_THAI.find((l) => l.ma === v)?.ma ?? "tat-ca";
}
export function docSapXep(v: string | undefined): SapXep {
  return SAP_XEP.find((s) => s.ma === v)?.ma ?? "han";
}

/** Bỏ dấu + thường hoá: "Quy trình" khớp "quy trinh". */
export function chuanHoaTim(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}

function khopLoc(k: KhoaRut, loc: LocTrangThai, now: Date): boolean {
  switch (loc) {
    case "tat-ca":
      return true;
    case "dang-hoc":
      return k.status === "IN_PROGRESS";
    case "chua-bat-dau":
      return k.status === "NOT_STARTED";
    case "sap-han":
      return nhomHan(k, now) === "SAP_HAN";
    case "qua-han":
      return nhomHan(k, now) === "QUA_HAN";
    case "hoan-thanh":
      return daXong(k.status);
  }
}

export type KetQuaDanhSach = {
  dong: KhoaRut[];
  /** Số khoá sau lọc (trước phân trang). */
  tong: number;
  trang: number;
  tongTrang: number;
  /** Đếm theo từng bộ lọc trên TOÀN danh sách (không phụ thuộc ô tìm) — để chip hiện số. */
  dem: Record<LocTrangThai, number>;
};

export function locSapXepKhoa(
  khoa: readonly KhoaRut[],
  o: { loc: LocTrangThai; q: string; sapXep: SapXep; trang: number; coTrang?: number },
  now: Date,
): KetQuaDanhSach {
  const coTrang = o.coTrang ?? SO_KHOA_MOI_TRANG;
  const dem = {} as Record<LocTrangThai, number>;
  for (const l of LOC_TRANG_THAI) dem[l.ma] = khoa.filter((k) => khopLoc(k, l.ma, now)).length;

  const tim = chuanHoaTim(o.q);
  const sau = khoa.filter((k) => khopLoc(k, o.loc, now) && (tim === "" || chuanHoaTim(k.tenKhoa).includes(tim)));

  const sapXep = [...sau];
  if (o.sapXep === "han") {
    // Chưa xong lên trước, trong đó hạn gần nhất lên đầu (đúng thứ tự "việc phải làm" của trang chủ cũ).
    sapXep.sort((a, b) => Number(daXong(a.status)) - Number(daXong(b.status)) || THU_TU_HAN(a, b));
  } else if (o.sapXep === "tien-do") {
    sapXep.sort((a, b) => b.progressPercent - a.progressPercent || a.tenKhoa.localeCompare(b.tenKhoa, "vi"));
  } else {
    sapXep.sort((a, b) => a.tenKhoa.localeCompare(b.tenKhoa, "vi"));
  }

  const tongTrang = Math.max(1, Math.ceil(sapXep.length / coTrang));
  const trang = Math.min(Math.max(1, Math.floor(o.trang) || 1), tongTrang);
  return {
    dong: sapXep.slice((trang - 1) * coTrang, trang * coTrang),
    tong: sapXep.length,
    trang,
    tongTrang,
    dem,
  };
}

// ── Tổng quan theo thiết kế `Main.html` (18/11/2026): "Bài tiếp theo", "Hạn của bạn", dòng ngày ─────────────────────────────

/** Phần của một bài mà các hàm dưới cần (khớp `BaiCuaLuot`, khai lại để file này không phụ thuộc DB). */
export type BaiRut = {
  id: string;
  title: string;
  kind: string;
  required: boolean;
  thoiLuongGiay?: number | null;
  minReadSeconds?: number | null;
  nguonYoutube?: boolean;
};

export type BaiTiepTheo = {
  bai: BaiRut;
  /** Thứ tự 1-based của bài trong các bài BẮT BUỘC (khớp "bài 3 trên 8"). Bài không bắt buộc ⇒ `null`. */
  viTri: number | null;
};

/**
 * Chọn bài để "Học tiếp": bài người này chạm gần nhất mà chưa xong (nếu nó còn trong phiên bản đang học), không thì bài BẮT BUỘC đầu tiên chưa xong
 * theo thứ tự khoá, không thì bài (kể cả không bắt buộc) đầu tiên chưa xong. `null` khi không còn bài nào.
 */
export function chonBaiTiepTheoTongQuan(
  dsGoc: readonly BaiRut[],
  daXongBai: ReadonlySet<string>,
  chamGanNhat: string | null,
): BaiTiepTheo | null {
  // CÙNG quy tắc với `chonBaiTiepTheo` của Đề cương (`lesson-tree.ts`): chỉ bài NGƯỜI HỌC TỰ LÀM ĐƯỢC (buổi trực tiếp chỉ xong khi giảng viên điểm danh)
  // — hai màn gọi một nút "Tiếp tục" thì phải trỏ cùng một bài. Vị trí "bài k trên m" vẫn đếm trên TOÀN BỘ bài bắt buộc.
  const ds = dsGoc.filter((b) => nguoiHocTuLamDuoc(b.kind));
  const batBuoc = dsGoc.filter((b) => b.required);
  const viTriCua = (b: BaiRut) => {
    const i = batBuoc.findIndex((x) => x.id === b.id);
    return i >= 0 ? i + 1 : null;
  };
  const dangDo = chamGanNhat ? ds.find((b) => b.id === chamGanNhat && !daXongBai.has(b.id)) : undefined;
  const bai = dangDo ?? ds.find((b) => b.required && !daXongBai.has(b.id)) ?? ds.find((b) => !daXongBai.has(b.id));
  return bai ? { bai, viTri: viTriCua(bai) } : null;
}

/**
 * Thời gian còn lại ước lượng (giây) của các bài BẮT BUỘC chưa xong — CHỈ khi MỌI bài còn lại là video có độ dài thật. Có một bài không đo được
 * (đọc, bài tập, bài kiểm tra…) thì trả `null`: nói "còn khoảng 1 giờ" khi một nửa khoá không đo được là bịa.
 */
export function uocConLaiGiay(ds: readonly BaiRut[], daXongBai: ReadonlySet<string>): number | null {
  const con = ds.filter((b) => b.required && !daXongBai.has(b.id));
  if (con.length === 0) return null;
  let tong = 0;
  for (const b of con) {
    if (b.kind !== "VIDEO" || !b.thoiLuongGiay || b.thoiLuongGiay <= 0) return null;
    tong += b.thoiLuongGiay;
  }
  return tong;
}

/** "còn khoảng 1 giờ 10 phút" / "còn khoảng 25 phút" — làm tròn tới phút, tối thiểu 1 phút. */
export function chuConLai(giay: number): string {
  const phutTong = Math.max(1, Math.round(giay / 60));
  const gio = Math.floor(phutTong / 60);
  const phut = phutTong % 60;
  if (gio === 0) return `còn khoảng ${phut} phút`;
  return phut === 0 ? `còn khoảng ${gio} giờ` : `còn khoảng ${gio} giờ ${phut} phút`;
}

/** "12:40" từ số giây (giờ chỉ hiện khi ≥ 1 giờ). */
export function chuDongHo(giay: number): string {
  const t = Math.max(0, Math.round(giay));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const hai = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${hai(m)}:${hai(s)}` : `${m}:${hai(s)}`;
}

const dinhDang = (d: Date, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", ...o }).format(d);
/** "05/12" — ghép tay: mẫu `vi-VN` chỉ có ngày+tháng cho ra "05-12" (dấu gạch), không khớp thiết kế. */
export const ngayNgan = (d: Date) => {
  const p = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit" }).formatToParts(d);
  return `${p.find((x) => x.type === "day")?.value}/${p.find((x) => x.type === "month")?.value}`;
};
export const ngayDayDu = (d: Date) => dinhDang(d, { day: "2-digit", month: "2-digit", year: "numeric" });

/** "Thứ Ba 17/11/2026 · 1 khoá quá hạn, 1 khoá đến hạn tuần này" — chỉ nói điều có thật; không có gì cần ưu tiên thì nói vậy. */
export function dongNgayTongQuan(now: Date, kpi: Pick<Kpi, "tong" | "quaHan" | "sapHan">): string {
  const thu = dinhDang(now, { weekday: "long" });
  const dau = `${thu.charAt(0).toUpperCase()}${thu.slice(1)} ${ngayDayDu(now)}`;
  if (kpi.tong === 0) return `${dau} · chưa có khoá nào được giao`;
  const phan: string[] = [];
  if (kpi.quaHan > 0) phan.push(`${kpi.quaHan} khoá quá hạn`);
  if (kpi.sapHan > 0) phan.push(`${kpi.sapHan} khoá đến hạn tuần này`);
  return phan.length > 0 ? `${dau} · ${phan.join(", ")}` : `${dau} · không có khoá nào quá hạn hay sắp đến hạn`;
}

export type DongHanCuaBan = { phu: string; nhan: string; sac: SacThai };

/**
 * Một dòng "Hạn của bạn": dòng phụ "1/4 bài · hạn 12/11" + nhãn trạng thái ("Quá hạn 5 ngày" · "Còn 3 ngày" · "Chưa bắt đầu" · "Đang học").
 * Không có số bài (khoá chưa có bài) thì bỏ phần "n/m bài", không bịa "0/0".
 */
export function dongHanCuaBan(
  k: Pick<KhoaRut, "status" | "dueAt">,
  now: Date,
  tienDo: { xong: number; tong: number } | undefined,
): DongHanCuaBan {
  const phu = [tienDo ? `${tienDo.xong}/${tienDo.tong} bài` : null, k.dueAt ? `hạn ${ngayNgan(k.dueAt)}` : "chưa đặt hạn"].filter(Boolean).join(" · ");
  const nhom = nhomHan(k, now);
  const soNgay = k.dueAt ? Math.ceil(Math.abs(k.dueAt.getTime() - now.getTime()) / MS_NGAY) : 0;
  if (nhom === "QUA_HAN") return { phu, nhan: k.dueAt ? `Quá hạn ${soNgay} ngày` : "Quá hạn", sac: "danger" };
  if (nhom === "SAP_HAN") return { phu, nhan: `Còn ${soNgay} ngày`, sac: "warning" };
  return k.status === "IN_PROGRESS" ? { phu, nhan: "Đang học", sac: "success" } : { phu, nhan: "Chưa bắt đầu", sac: "muted" };
}
