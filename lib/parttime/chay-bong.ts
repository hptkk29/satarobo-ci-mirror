// lib/parttime/chay-bong.ts — CHẠY BÓNG Parttime (công tắc WORKUNIT_SHADOW): dựng đơn vị công việc TRONG BỘ NHỚ, so với nguồn
// công dạy CŨ, và cổng KHÔNG-LỆCH trước khi được nghĩ tới công tắc tiền. THUẦN — không DB, không ghi gì.
//
// Đơn vị bóng mang trạng thái SHADOW (không bao giờ CONFIRMED): không có đường nào từ đây tới bảng WorkUnit / WorkConfirmation /
// CompensationAdjustment (lưới M-SHADOW-01 đếm dòng ba bảng đó quanh một lượt chạy bóng).
//
// Nguồn CŨ = `loadBuoiDay` (`lib/cham-cong/cong-day-db.ts`): buổi ĐÃ CHỐT — người ĐỨNG LỚP (`thực dạy ?? dạy thay ?? GV lớp`) vai
// MAIN / SUBSTITUTE + trợ giảng CẤP LỚP vai ASSISTANT; case dạy bù vai MAIN. Trial tách riêng ở cả hai phía (không so).

export type HoatDongBong = "MAIN" | "TA" | "SUBSTITUTE" | "MAKEUP" | "OPS";
/** SHADOW = tính được · POLICY_UNRESOLVED = Q1 chưa quyết (60'/120') · CUTOVER_GRACE = nhập cutover chưa nhận · BLOCKED = lý do khác. */
export type TrangThaiBong = "SHADOW" | "POLICY_UNRESOLVED" | "CUTOVER_GRACE" | "BLOCKED";

export type DongBong = {
  sourceType: string;
  sourceId: string;
  userId: string;
  workDate: string;
  hoatDong: HoatDongBong;
  donVi: string | null;
  trangThai: TrangThaiBong;
  lyDo: string[];
  /** Phân công / dòng trực sinh ra dòng này — truy được. */
  nguonId: string;
  /** OPS: mã ca của dòng trực. */
  shiftCode?: string;
};

/** Một dòng đối soát P5a (đủ để dựng dòng bóng). */
export type DauVaoDayBong = {
  assignmentId: string;
  assignmentType: string;
  userId: string;
  role: string;
  activity: string;
  sourceType: string;
  sourceId: string;
  workDate: string;
  lop: "TU_DONG" | "XEM_TAY" | "CHAN" | "KHONG_AP_DUNG" | "CHUA_XONG";
  lyDo: readonly string[];
  donVi: string | null;
};

export function dongBongDay(d: DauVaoDayBong): DongBong | null {
  if (d.lop === "KHONG_AP_DUNG" || d.lop === "CHUA_XONG") return null;
  const hoatDong: HoatDongBong =
    d.role === "TEACHING_ASSISTANT" ? "TA" : d.activity === "MAKEUP" ? "MAKEUP" : d.assignmentType === "SUBSTITUTE" ? "SUBSTITUTE" : "MAIN";
  const trangThai: TrangThaiBong =
    d.lop === "TU_DONG" || d.lop === "XEM_TAY"
      ? "SHADOW"
      : d.lyDo.includes("THOI_LUONG_KHONG_CHUAN")
        ? "POLICY_UNRESOLVED"
        : d.lyDo.includes("CUTOVER_GRACE")
          ? "CUTOVER_GRACE"
          : "BLOCKED";
  return {
    sourceType: d.sourceType,
    sourceId: d.sourceId,
    userId: d.userId,
    workDate: d.workDate,
    hoatDong,
    donVi: trangThai === "SHADOW" ? d.donVi : null,
    trangThai,
    lyDo: [...d.lyDo],
    nguonId: d.assignmentId,
  };
}

export type DauVaoTrucBong = { dutyId: string; userId: string; ngay: string; shiftCode: string; lop: string; lyDo: readonly string[]; donViTra: string | null };

export function dongBongTruc(t: DauVaoTrucBong): DongBong | null {
  if (t.lop === "KHONG_AP_DUNG" || t.lop === "CHO") return null;
  const unresolved = t.lyDo.includes("Q1_THOI_LUONG") || t.lyDo.includes("Q2_VUOT_CA");
  const trangThai: TrangThaiBong = t.donViTra != null ? "SHADOW" : unresolved ? "POLICY_UNRESOLVED" : "BLOCKED";
  return { sourceType: "OPERATIONS_DUTY", sourceId: t.dutyId, userId: t.userId, workDate: t.ngay, hoatDong: "OPS", donVi: t.donViTra, trangThai, lyDo: [...t.lyDo], nguonId: t.dutyId, shiftCode: t.shiftCode };
}

/** Dòng công dạy CŨ. */
export type DongCu = { sourceType: "CLASS_SESSION" | "MAKEUP_CASE"; sourceId: string; userId: string; workDate: string; vai: "MAIN" | "SUBSTITUTE" | "ASSISTANT" };
/** Ô ca cũ (đối chiếu trực). */
export type OCaCu = { userId: string; workDate: string; shiftCode: string };

export type LoaiLech =
  | "MATCH"
  | "MISSING_NEW"
  | "EXTRA_NEW"
  | "WRONG_TEACHER"
  | "WRONG_ROLE"
  | "WRONG_ACTIVITY"
  | "WRONG_UNITS"
  | "OPS_MISMATCH"
  | "POLICY_UNRESOLVED"
  | "DUPLICATE";

export type DongSoSanh = {
  loai: LoaiLech;
  sourceType: string;
  sourceId: string;
  workDate: string;
  userIdCu: string | null;
  userIdMoi: string | null;
  vaiCu: DongCu["vai"] | null;
  hoatDongMoi: HoatDongBong | null;
  donViMoi: string | null;
  lyDo: string[];
};

const laDungLop = (h: HoatDongBong) => h === "MAIN" || h === "SUBSTITUTE" || h === "MAKEUP";
const kieuKhop = (vai: DongCu["vai"], h: HoatDongBong, sourceType: string) =>
  vai === "ASSISTANT" ? h === "TA" : vai === "SUBSTITUTE" ? h === "SUBSTITUTE" : sourceType === "MAKEUP_CASE" ? h === "MAKEUP" : h === "MAIN";

export function soSanhBong(p: { bong: readonly DongBong[]; cu: readonly DongCu[]; oCa: readonly OCaCu[] }): DongSoSanh[] {
  const ra: DongSoSanh[] = [];
  const dong = (loai: LoaiLech, s: { sourceType: string; sourceId: string; workDate: string }, c: DongCu | null, m: DongBong | null, lyDo: string[] = []): DongSoSanh => ({
    loai,
    sourceType: s.sourceType,
    sourceId: s.sourceId,
    workDate: s.workDate,
    userIdCu: c?.userId ?? null,
    userIdMoi: m?.userId ?? null,
    vaiCu: c?.vai ?? null,
    hoatDongMoi: m?.hoatDong ?? null,
    donViMoi: m?.donVi ?? null,
    lyDo,
  });

  // ── dạy: theo buổi ──
  const day = p.bong.filter((b) => b.hoatDong !== "OPS");
  const buoi = new Set([...day.map((b) => `${b.sourceType}:${b.sourceId}`), ...p.cu.map((c) => `${c.sourceType}:${c.sourceId}`)]);
  for (const k of [...buoi].sort()) {
    let moi = day.filter((b) => `${b.sourceType}:${b.sourceId}` === k);
    let cu = p.cu.filter((c) => `${c.sourceType}:${c.sourceId}` === k);
    const goc = (moi[0] ?? cu[0])!;
    // Trùng (một người hai dòng trong cùng buổi) ở bất kỳ phía nào ⇒ DUPLICATE, bỏ khỏi so khớp.
    for (const [ten, ds] of [["mới", moi], ["cũ", cu]] as const) {
      const dem = new Map<string, number>();
      for (const x of ds) dem.set(x.userId, (dem.get(x.userId) ?? 0) + 1);
      for (const [u, n] of dem) if (n > 1) ra.push(dong("DUPLICATE", goc, ten === "cũ" ? (cu.find((c) => c.userId === u) ?? null) : null, ten === "mới" ? (moi.find((m) => m.userId === u) ?? null) : null, [`${n} dòng ${ten}`]));
      const trung = new Set([...dem].filter(([, n]) => n > 1).map(([u]) => u));
      if (ten === "mới") moi = moi.filter((x) => !trung.has(x.userId));
      else cu = cu.filter((x) => !trung.has(x.userId));
    }
    const conCu = [...cu];
    const conMoi: DongBong[] = [];
    for (const m of moi) {
      const i = conCu.findIndex((c) => c.userId === m.userId);
      const c = i >= 0 ? conCu.splice(i, 1)[0]! : null;
      if (m.trangThai === "POLICY_UNRESOLVED") {
        ra.push(dong("POLICY_UNRESOLVED", m, c, m, m.lyDo));
        continue;
      }
      if (!c) {
        conMoi.push(m);
        continue;
      }
      if (m.trangThai !== "SHADOW") ra.push(dong("MISSING_NEW", m, c, m, [m.trangThai, ...m.lyDo]));
      else if ((c.vai === "ASSISTANT") !== (m.hoatDong === "TA")) ra.push(dong("WRONG_ROLE", m, c, m));
      else if (!kieuKhop(c.vai, m.hoatDong, m.sourceType)) ra.push(dong("WRONG_ACTIVITY", m, c, m));
      else if (m.donVi !== "1") ra.push(dong("WRONG_UNITS", m, c, m, [`đơn vị ${m.donVi}`]));
      else ra.push(dong("MATCH", m, c, m));
    }
    // Người đứng lớp KHÁC NHAU ở hai phía ⇒ một dòng WRONG_TEACHER thay vì một thiếu + một thừa.
    const cuDung = conCu.find((c) => c.vai !== "ASSISTANT");
    const moiDung = conMoi.find((m) => laDungLop(m.hoatDong) && m.trangThai === "SHADOW");
    if (cuDung && moiDung) {
      ra.push(dong("WRONG_TEACHER", moiDung, cuDung, moiDung));
      conCu.splice(conCu.indexOf(cuDung), 1);
      conMoi.splice(conMoi.indexOf(moiDung), 1);
    }
    for (const c of conCu) ra.push(dong("MISSING_NEW", { sourceType: c.sourceType, sourceId: c.sourceId, workDate: c.workDate }, c, null, ["không có đơn vị mới"]));
    for (const m of conMoi) if (m.trangThai === "SHADOW") ra.push(dong("EXTRA_NEW", m, null, m));
  }

  // ── trực: chỉ phía mới (cũ không có khái niệm trực tường minh) — đối chiếu với ô ca cũ cùng người · ngày · mã ca ──
  for (const m of p.bong.filter((b) => b.hoatDong === "OPS")) {
    if (m.trangThai === "POLICY_UNRESOLVED") {
      ra.push(dong("POLICY_UNRESOLVED", m, null, m, m.lyDo));
      continue;
    }
    if (m.trangThai !== "SHADOW") continue;
    const coCa = p.oCa.some((o) => o.userId === m.userId && o.workDate === m.workDate && o.shiftCode === m.shiftCode);
    ra.push(dong(coCa && m.donVi === "1" ? "MATCH" : "OPS_MISMATCH", m, null, m, coCa ? (m.donVi === "1" ? [] : [`đơn vị trực ${m.donVi} (ô ca cũ = 1)`]) : ["không có ô ca cũ cùng mã"]));
  }
  return ra;
}

/** Loại lệch CHẶN cổng (bắt buộc = 0). POLICY_UNRESOLVED phải được LOẠI TRỪ có chủ đích (danh sách buổi / dòng trực). */
export const LECH_CHAN: readonly LoaiLech[] = ["MISSING_NEW", "EXTRA_NEW", "WRONG_TEACHER", "WRONG_ROLE", "DUPLICATE"];

export function congKhongLech(ss: readonly DongSoSanh[], p: { loaiTru: ReadonlySet<string> }): { dat: boolean; dem: Record<LoaiLech, number>; chan: string[]; canhBao: string[] } {
  const dem = Object.fromEntries(
    (["MATCH", "MISSING_NEW", "EXTRA_NEW", "WRONG_TEACHER", "WRONG_ROLE", "WRONG_ACTIVITY", "WRONG_UNITS", "OPS_MISMATCH", "POLICY_UNRESOLVED", "DUPLICATE"] as const).map((k) => [k, 0]),
  ) as Record<LoaiLech, number>;
  for (const s of ss) dem[s.loai]++;
  const chan = LECH_CHAN.filter((k) => dem[k] > 0).map((k) => `${k} = ${dem[k]}`);
  const chuaLoaiTru = ss.filter((s) => s.loai === "POLICY_UNRESOLVED" && !p.loaiTru.has(s.sourceId));
  if (chuaLoaiTru.length) chan.push(`POLICY_UNRESOLVED chưa loại trừ có chủ đích = ${chuaLoaiTru.length}`);
  const canhBao = (["WRONG_ACTIVITY", "WRONG_UNITS", "OPS_MISMATCH"] as const).filter((k) => dem[k] > 0).map((k) => `${k} = ${dem[k]} (phải xem từng dòng)`);
  return { dat: chan.length === 0, dem, chan, canhBao };
}
