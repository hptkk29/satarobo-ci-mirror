// lib/cham-cong/bang-cong-thang-db.ts — nạp + dựng dữ liệu Bảng công tháng.
//
// ⚠️ MỘT NGUỒN CHO CẢ MÀN HÌNH LẪN FILE EXCEL.
//
// Trang `/cham-cong/bang-cong-thang` và route xuất Excel đều gọi hàm này. Nếu mỗi bên tự truy
// vấn thì tới lượt sửa thứ hai chúng sẽ lệch, và triệu chứng là thứ tệ nhất có thể có ở một
// module chấm công: **file gửi kế toán in số khác màn hình quản lý vừa duyệt**. Repo đã bỏng
// ba lần trong hai tuần vì site GV tự suy lại con số admin đã có (luật 12b) — đây là cùng lỗi
// ở quy mô tiền lương.
//
// Phần LUẬT (ô này màu gì) nằm ở `mau-o-cong.ts`, thuần và có test. File này chỉ nạp và ghép.
import type { scopedDb } from "@/lib/db-scope";
import { vnParts } from "@/lib/time/vn";
import { flagInfo } from "@/lib/cham-cong/flag-labels";
import { laLuotDaBiThay } from "@/lib/cham-cong/sua-gio-quet";
import { holidayYmdSet, loadHolidayRanges } from "@/lib/cham-cong/holidays";
import { getSetting } from "@/lib/settings/service";
import { daysOfMonth } from "@/lib/cham-cong/generate";
import {
  DAU_HIEU_META,
  MAU_O,
  demTheoMau,
  phanLoaiO,
  type DauHieu,
  type DemMau,
  type MauO,
} from "@/lib/cham-cong/mau-o-cong";

export type ONgay = {
  mau: MauO;
  dauHieu: DauHieu[];
  code: string | null;
  /**
   * Công THỰC NHẬN của ngày (`StaffAttendanceDay.dayCreditEarned`).
   *
   * ⚠️ Đọc cột đã tính, KHÔNG suy từ mã ca. Engine đã cộng cả nghỉ lễ (`holidayPaidUnits`
   * nằm cột riêng) và giữ nguyên phần quản lý ghi đè (`overrideUnits`) — tự nhân lại từ
   * `dayCredit` của mã là ra số khác bảng công ngày, đúng lỗi site GV đã mắc ba lần (luật 12b).
   */
  cong: number;
  /** Phút làm thật trong ngày — cho tooltip. */
  phut: number;
  /** "07:55" — mốc VÀO đầu tiên trong ngày. Rỗng khi không có cặp nào. */
  vao: string;
  /** "17:32" — mốc RA cuối cùng. Rỗng khi cặp cuối còn mở (thiếu lượt ra). */
  ra: string;
  /**
   * TỪNG cặp vào–ra trong ngày, theo thứ tự thời gian.
   *
   * Ca khai 2 lần chấm (`HC`, `ST`) đòi 4 lượt quét — in mỗi mốc đầu/cuối là giấu mất lượt
   * giữa ca, tức giấu đúng thứ người quản lý cần kiểm. `ra` rỗng = cặp còn mở (thiếu lượt ra).
   */
  cacCap: { vao: string; ra: string }[];
  moTa: string;
};

export type HangBangCong = {
  userId: string;
  name: string;
  jobLabel: string | null;
  o: Record<number, ONgay | undefined>;
  dem: DemMau;
  /** Tổng công cả tháng — cộng từ `dayCreditEarned` của từng ngày, không tính lại. */
  tongCong: number;
  /** Tổng phút làm thật cả tháng. */
  tongPhut: number;
  /**
   * Đếm từ CỜ, không từ màu.
   *
   * Một ngày vừa đi muộn vừa về sớm chỉ mang MỘT màu (ưu tiên đi muộn), nên đếm theo màu là
   * cột "Về sớm" hụt đúng những ngày tệ nhất. Chốt 25/09 đòi "phân định rõ" — phân định mà
   * đếm sai thì tệ hơn không phân định.
   */
  soDiMuon: number;
  soVeSom: number;
};

export type NgayCot = {
  day: number;
  wd: number;
  label: string;
  off: boolean;
  holiday: boolean;
  today: boolean;
};

export type MaCaDong = {
  code: string;
  name: string;
  gio: string;
  cong: number;
  soCapQuet: number;
};

export type BangCongThang = {
  rows: HangBangCong[];
  days: NgayCot[];
  maCa: MaCaDong[];
  locked: boolean;
};

/**
 * Mốc vào đầu / ra cuối trong ngày, đọc từ `StaffAttendanceDay.pairs`.
 *
 * ⚠️ Đọc CẶP ĐÃ GHÉP của engine, KHÔNG tự ghép lại từ `StaffTimeLog`. Engine đã chống trùng
 * 2′, loại lượt bị từ chối và xử cặp mở — ghép lại ở đây là ra giờ khác bảng công ngày cho
 * cùng một hôm (luật 12b).
 *
 * `pairs` là cột Json nên soi kiểu tại chỗ, không tin vào khai báo. `start`/`end` là PHÚT kể
 * từ 00:00 giờ VN.
 */
function mocVaoRa(pairs: unknown): { vao: string; ra: string; cacCap: { vao: string; ra: string }[] } {
  const rong = { vao: "", ra: "", cacCap: [] as { vao: string; ra: string }[] };
  if (!Array.isArray(pairs) || pairs.length === 0) return rong;
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const cap: { s: number; vao: string; ra: string }[] = [];
  for (const raw of pairs) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw as { start?: unknown; end?: unknown; open?: unknown };
    if (typeof p.start !== "number") continue;
    cap.push({
      s: p.start,
      vao: hhmm(p.start),
      // Cặp còn MỞ không có giờ ra thật — để trống chứ đừng in `end` của nó, kẻo ngày thiếu
      // lượt ra lại hiện một giờ ra trông như bình thường.
      ra: p.open !== true && typeof p.end === "number" ? hhmm(p.end) : "",
    });
  }
  if (cap.length === 0) return rong;
  cap.sort((a, b) => a.s - b.s);
  const coRa = cap.filter((c) => c.ra);
  return {
    vao: cap[0].vao,
    ra: coRa.length ? coRa[coRa.length - 1].ra : "",
    cacCap: cap.map((c) => ({ vao: c.vao, ra: c.ra })),
  };
}

/** "1" / "0,5" — bỏ số 0 thừa, dấu phẩy thập phân kiểu Việt. */
function soCong(n: number): string {
  return n.toLocaleString("vi-VN", { maximumFractionDigits: 2 });
}

/** "7h30" từ số phút. 0 phút trả chuỗi rỗng (người gọi tự bỏ qua). */
function gioPhut(m: number): string {
  return m ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}` : "";
}

/** "08:00–11:30 · 13:30–17:30" từ các đoạn WORK. Mã không có đoạn giờ ⇒ chuỗi rỗng. */
function gioCua(segments: unknown): string {
  if (!Array.isArray(segments)) return "";
  return (segments as { start?: string; end?: string; kind?: string }[])
    .filter((s) => s?.kind === "WORK" && s.start && s.end)
    .map((s) => `${s.start}–${s.end}`)
    .join(" · ");
}

/**
 * @param sdb  PHẢI là `scopedDb(actor)` — cách ly cơ sở của module này đi qua đó. Truyền `db`
 *             trần vào là một người cấp cơ sở đọc được bảng công cơ sở khác.
 * @param today "YYYY-MM-DD" giờ VN. Người gọi truyền vào, hàm KHÔNG đọc đồng hồ — nếu không
 *             thì mọi test của nó thành bom hẹn giờ (luật 19).
 */
export async function loadBangCongThang(input: {
  sdb: ReturnType<typeof scopedDb>;
  coSo: string;
  ky: string;
  orgUnitId: string | null;
  today: string;
  lockedStatus: string | null;
}): Promise<BangCongThang> {
  const { sdb, coSo, ky, orgUnitId, today, lockedStatus } = input;
  const [y, m] = ky.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 0));
  const locked = lockedStatus === "LOCKED";

  const [patterns, assignHere, weeklyOff] = await Promise.all([
    sdb.shiftWeeklyPattern.findMany({
      where: { centerId: coSo, effectiveTo: null },
      select: { userId: true, jobLabel: true, displayOrder: true },
    }),
    sdb.shiftAssignment.findMany({
      where: { workDate: { gte: from, lte: to }, status: "ACTIVE", centerId: coSo },
      select: { userId: true },
    }),
    getSetting("shift.weeklyOffDays", { orgUnitId }),
  ]);

  const userIds = [
    ...new Set([...patterns.map((p) => p.userId), ...assignHere.map((a) => a.userId)]),
  ];

  const [assignments, dayRows, users, templates, holidayRows] = await Promise.all([
    userIds.length
      ? sdb.shiftAssignment.findMany({
          where: { userId: { in: userIds }, workDate: { gte: from, lte: to }, status: "ACTIVE" },
          select: { userId: true, workDate: true, templateCode: true },
        })
      : Promise.resolve([]),
    userIds.length
      ? sdb.staffAttendanceDay.findMany({
          where: { userId: { in: userIds }, workDate: { gte: from, lte: to } },
          select: {
            userId: true,
            workDate: true,
            dayType: true,
            flags: true,
            absenceStatus: true,
            overrideUnits: true,
            dayCreditEarned: true,
            workedMinutes: true,
            pairs: true,
          },
        })
      : Promise.resolve([]),
    userIds.length
      ? sdb.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        })
      : Promise.resolve([]),
    sdb.shiftTemplate.findMany({
      where: { isActive: true },
      select: { code: true, name: true, segments: true, dayCredit: true, soCapQuetKyVong: true },
      orderBy: { displayOrder: "asc" },
    }),
    // KHÔNG qua `sdb`: `Holiday` bị scopedDb cắt mất dòng `centerId = null`, tức mọi ngày lễ
    // TOÀN HỆ THỐNG (Tết, 30/4, 2/9) tàng hình với người cấp cơ sở.
    loadHolidayRanges(coSo, from, to),
  ]);

  const holidays = holidayYmdSet(holidayRows);
  const offSet = new Set(weeklyOff as number[]);

  const days: NgayCot[] = daysOfMonth(y, m).map((d) => {
    const ymd = d.toISOString().slice(0, 10);
    return {
      day: d.getUTCDate(),
      wd: d.getUTCDay(),
      label: `${String(d.getUTCDate()).padStart(2, "0")}/${String(m).padStart(2, "0")}`,
      off: offSet.has(d.getUTCDay()),
      holiday: holidays.has(ymd),
      today: ymd === today,
    };
  });

  const nameOf = new Map(users.map((u) => [u.id, u.name?.trim() || u.email || u.id]));
  const jobOf = new Map(patterns.map((p) => [p.userId, p.jobLabel]));
  const orderOf = new Map(patterns.map((p) => [p.userId, p.displayOrder]));

  const caOf = new Map<string, string>();
  for (const a of assignments) {
    caOf.set(`${a.userId}|${a.workDate.toISOString().slice(0, 10)}`, a.templateCode);
  }
  const ngayOf = new Map<string, (typeof dayRows)[number]>();
  for (const d of dayRows) ngayOf.set(`${d.userId}|${d.workDate.toISOString().slice(0, 10)}`, d);

  const rows: HangBangCong[] = userIds.map((uid) => {
    const o: Record<number, ONgay> = {};
    const ketQua: { mau: MauO }[] = [];
    let tongCong = 0;
    let tongPhut = 0;
    let soDiMuon = 0;
    let soVeSom = 0;
    for (const d of days) {
      const ymd = `${ky}-${String(d.day).padStart(2, "0")}`;
      const code = caOf.get(`${uid}|${ymd}`) ?? null;
      const row = ngayOf.get(`${uid}|${ymd}`);
      const r = phanLoaiO({
        coCa: code !== null,
        daQua: ymd <= today,
        daTinh: row !== undefined,
        dayType: row?.dayType ?? null,
        flags: row?.flags ?? [],
        absenceStatus: row?.absenceStatus ?? null,
        overrideUnits: row?.overrideUnits ?? null,
        locked,
      });
      const ghiChu = r.dauHieu.map((k) => DAU_HIEU_META[k].nhan).join(" · ");
      if (row?.flags?.includes("DI_MUON")) soDiMuon += 1;
      if (row?.flags?.includes("VE_SOM")) soVeSom += 1;
      const cong = row?.dayCreditEarned ?? 0;
      const phut = row?.workedMinutes ?? 0;
      tongCong += cong;
      tongPhut += phut;
      const moc = mocVaoRa(row?.pairs);
      o[d.day] = {
        mau: r.mau,
        dauHieu: r.dauHieu,
        code,
        cong,
        phut,
        vao: moc.vao,
        ra: moc.ra,
        cacCap: moc.cacCap,
        // Tooltip nói ĐỦ thông tin của ngày đó — chốt 25/09: "show rõ các thông tin của các
        // ngày đó, bao nhiêu công". Ô chỉ rộng 48px nên chi tiết ở đây, không nhồi vào ô.
        moTa:
          `${d.label} — ${MAU_O[r.mau].nhan}` +
          (code ? ` · ca ${code}` : "") +
          (row ? ` · ${soCong(cong)} công` : "") +
          (phut > 0 ? ` · ${gioPhut(phut)}` : "") +
          (ghiChu ? ` · ${ghiChu}` : ""),
      };
      ketQua.push({ mau: r.mau });
    }
    return {
      userId: uid,
      name: nameOf.get(uid) ?? uid,
      jobLabel: jobOf.get(uid) ?? null,
      o,
      dem: demTheoMau(ketQua),
      tongCong: Math.round(tongCong * 100) / 100,
      tongPhut,
      soDiMuon,
      soVeSom,
    };
  });

  // Nặng lên đầu — đó là câu hỏi màn này sinh ra để trả lời. Hoà thì theo thứ tự khung ca
  // (giữ đúng thứ tự người vận hành đã sắp), rồi tới tên.
  rows.sort(
    (a, b) =>
      b.dem.nang - a.dem.nang ||
      b.dem.THIEU_LUOT - a.dem.THIEU_LUOT ||
      (orderOf.get(a.userId) ?? 999) - (orderOf.get(b.userId) ?? 999) ||
      a.name.localeCompare(b.name, "vi"),
  );

  // CHỈ mã ca có mặt trong kỳ — lọc ở ĐÂY chứ không ở trang, để bảng tra trên màn và sheet
  // "Chu giai" trong file Excel không bao giờ liệt kê hai tập khác nhau.
  const maDaDung = new Set(caOf.values());
  const maCa: MaCaDong[] = templates
    .filter((t) => maDaDung.has(t.code))
    .map((t) => ({
      code: t.code,
      name: t.name,
      gio: gioCua(t.segments),
      cong: t.dayCredit,
      soCapQuet: t.soCapQuetKyVong,
    }));

  return { rows, days, maCa, locked };
}

// ─────────────────────────────────────────────────────────────────────────────
// LƯỢT QUÉT TỪNG NGÀY CỦA TỪNG NGƯỜI — chỉ route xuất Excel dùng
//
// CỐ Ý không nạp ở trang: màn hình không in từng lượt (đã có màn "Bảng công ngày" và trang
// chi tiết một người cho việc đó), nên kéo vài nghìn dòng `StaffTimeLog` mỗi lần mở lưới là
// trả giá cho thứ không ai nhìn.

export type LuotQuetDong = {
  ngay: string;
  /** "14:03" giờ VN. */
  gio: string;
  ten: string;
  vaoRa: string;
  noiCham: string;
  /** "Đã ghi" hoặc lý do bị từ chối. */
  ketQua: string;
  co: string;
};

/**
 * Mọi lần bấm trong kỳ, kể cả lượt BỊ TỪ CHỐI.
 *
 * ⚠️ Giữ cả lượt bị từ chối, và nói rõ lý do: đó chính là thứ giải thích một ngày `KHÔNG CÓ
 * LƯỢT` — người ta có bấm, máy không nhận (mã hết hạn, sai điểm chấm, quá trần ngày). Lọc
 * chúng đi là xoá đúng bằng chứng người bị oan cần.
 *
 * ⚠️ Giờ đổi sang MÚI VN bằng `vnParts`. `loggedAt` là `Timestamptz` và máy chủ chạy UTC —
 * in thẳng `getHours()` là lệch 7 tiếng trên Vercel mà đúng trên máy dev.
 */
export async function loadLuotQuetThang(input: {
  sdb: ReturnType<typeof scopedDb>;
  userIds: readonly string[];
  ky: string;
  tenTheoUser: ReadonlyMap<string, string>;
}): Promise<LuotQuetDong[]> {
  const { sdb, userIds, ky, tenTheoUser } = input;
  if (userIds.length === 0) return [];
  const [y, m] = ky.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 0));

  const rows = await sdb.staffTimeLog.findMany({
    where: { userId: { in: [...userIds] }, workDate: { gte: from, lte: to } },
    select: {
      userId: true,
      workDate: true,
      loggedAt: true,
      direction: true,
      result: true,
      rejectReason: true,
      // 06/10/2026 — lượt đã bị ghi đè bằng chỉnh tay vẫn XUẤT (đây là sổ lượt quét, người đọc
      // cần thấy giờ thật), nhưng cột Kết quả phải nói nó không còn tính.
      reviewStatus: true,
      flags: true,
      workLocation: { select: { name: true } },
    },
    orderBy: [{ workDate: "asc" }, { loggedAt: "asc" }],
  });

  return rows.map((r) => {
    const p = vnParts(r.loggedAt);
    return {
      ngay: r.workDate.toISOString().slice(0, 10),
      gio: `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`,
      ten: tenTheoUser.get(r.userId) ?? r.userId,
      vaoRa: r.direction === "CHECK_IN" ? "Vào" : "Ra",
      noiCham: r.workLocation?.name ?? "",
      ketQua:
        r.result !== "ACCEPTED"
          ? `Bị từ chối: ${r.rejectReason ?? r.result}`
          : laLuotDaBiThay(r)
            ? "Đã được thay bằng chỉnh tay — không tính công"
            : "Đã ghi",
      // Nhan tieng Viet, khong in ma tran: tep nay de NGUOI doc, va bang nhan da co san
      // mot ban duy nhat o `flag-labels.ts`.
      co: r.flags.map((f) => flagInfo(f).text).join(" · "),
    };
  });
}
