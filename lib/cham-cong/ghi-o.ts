// lib/cham-cong/ghi-o.ts — MỘT service ghi ô lưới ca (T04, 07/10/2026). Không "use server": action ở app/ gọi
// SAU KHI đã kiểm quyền theo cơ sở và truyền `canWriteCenter`.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO (đo 07/10/2026): `ShiftAssignment` có BA đường ghi (`cells.ts` sửa tay/đơn, `generate-db.ts` Sinh,
// `import-core.ts` nhập file) và cả ba đều: đọc ô cũ → huỷ → tạo mới, KHÔNG có khoá, chỉ MỘT trong ba có
// transaction. Chỉ mục duy nhất "một ô ACTIVE mỗi người mỗi ngày" (`ShiftAssignment_user_date_active_key`) là thứ
// duy nhất giữ tính đúng, và không nơi nào bắt P2002 — hai lượt chồng nhau ném lỗi thô ở lượt sau và (đường sửa
// tay, không tx) để ngày đó KHÔNG CÒN ô ACTIVE nào. CI đã đỏ vì đúng chuyện này (10/09/2026, `import.spec.ts`).
//
// Ba đường còn đọc ô cũ bằng client ĐÃ LỌC THEO CƠ SỞ NGƯỜI THAO TÁC (`sdb`): ô ACTIVE ở cơ sở khác vô hình ⇒ "chưa
// có ô" ⇒ lập kế hoạch TẠO ⇒ đụng chỉ mục. Service này đọc bằng client TRẦN và tự kiểm `canWriteCenter` cho ô cũ
// lẫn ô mới.
//
// SERVICE NÀY LÀM:
//   · khoá advisory theo (người, THÁNG) — mọi đường ghi cùng một khoá nên loại trừ lẫn nhau; khoá theo THÁNG chứ không
//     theo ô vì khoá advisory nằm trong bảng khoá dùng chung (`max_locks_per_transaction`), mà một lượt đẩy khung
//     chạm hàng nghìn ô; thứ tự khoá cố định (người ↑, tháng ↑) nên hai lượt chồng nhau không deadlock;
//   · MỘT transaction cho mỗi lô người (trần thời gian tường minh) — ghi dở không để lại ngày trống;
//   · mã ca nạp THEO CƠ SỞ của khối (mã riêng của cơ sở thắng mã chung), không còn `centerId: null` cứng;
//   · cổng quá khứ / kỳ chốt / quyền / bảo vệ nguồn đều ở `ghi-o-luat.ts` — một bảng, một chỗ;
//   · trả KẾT QUẢ TỪNG Ô kèm lý do bỏ qua — không có ô nào bị bỏ mà người dùng không biết vì sao.
// ─────────────────────────────────────────────────────────────────────────────
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { PlaceToken, ShiftSegment } from "./catalog";
import { resolvePlace, type CenterMap } from "./place";
import { markAttendanceDaysDirtyMany } from "./recompute";
import { quyetDinhO, type LyDoBoQua, type NguonO } from "./ghi-o-luat";

export type LenhO = {
  userId: string;
  /** UTC date-only — đồng hồ treo tường VN của ngày công. */
  workDate: Date;
  /** null = xoá ô. */
  code: string | null;
  /** Khối chịu công của người đó ("CS1" / "CS2" / "HO"). */
  homeUnit: string;
  source: NguonO;
  /** Mặc định `{ [homeUnit]: code }`. Import/Sinh truyền con trỏ D1/D2 đã gộp. */
  sourceCells?: Record<string, string>;
  sourceRequestId?: string | null;
  note?: string | null;
  employeeId?: string | null;
};

export type NguCanhGhiO = {
  centerMap: CenterMap;
  /** Quyền theo cơ sở — kiểm CẢ ô cũ lẫn ô mới. */
  canWriteCenter: (centerId: string) => boolean;
  actorUserId: string;
  /**
   * HÔM NAY theo lịch VN (UTC date-only). BẮT BUỘC khi có lệnh nguồn PATTERN (luật 7 + luật 19: hàm không tự đọc
   * đồng hồ); các nguồn khác không dùng, truyền `null`.
   */
  homNay: Date | null;
  /** Bật "Ghi đè cả ô nhập thủ công" (IMPORT/MANUAL). BẮT BUỘC khai — không mặc định (luật 7). */
  ghiDeNhapTay: boolean;
  /**
   * Vượt cổng kỳ chốt. Chỉ `true` khi người gọi ĐÃ kiểm quyền vượt cấp (Hội sở + lý do) — hiện chỉ đường duyệt đơn.
   * BẮT BUỘC khai.
   */
  boQuaKyDaChot: boolean;
};

export type KetO = "TAO" | "THAY" | "GIU" | "XOA" | "BO_QUA";

export type KetQuaO = {
  userId: string;
  workDate: Date;
  ket: KetO;
  lyDo?: LyDoBoQua;
  /** Chi tiết người đọc được (vd. mã ca nào không có). */
  chiTiet?: string;
  truoc: { id: string; templateCode: string; centerId: string; source: NguonO } | null;
  sau: { id: string; templateCode: string; centerId: string } | null;
  /** Cảnh báo của `resolvePlace` (mã cơ sở lạ…). */
  canhBao: string[];
};

export type ThongKeGhiO = Record<KetO, number> & { boQuaTheoLyDo: Partial<Record<LyDoBoQua, number>>; lenhTrung: number };


const ymd = (d: Date) => d.toISOString().slice(0, 10);
const thang = (d: Date) => d.toISOString().slice(0, 7);
const keyO = (userId: string, d: Date) => `${userId}|${ymd(d)}`;

const MAU_SELECT = {
  id: true,
  code: true,
  centerId: true,
  segments: true,
  defaultPlace: true,
  attendanceMode: true,
  dayCredit: true,
  isLeave: true,
  nominalMinutes: true,
  soCapQuetKyVong: true,
} as const;
type Mau = Prisma.ShiftTemplateGetPayload<{ select: typeof MAU_SELECT }>;

function tatCaCoSo(map: CenterMap): string[] {
  return [...new Set([...Object.values(map.byCode).map((c) => c.centerId), map.hoCenterId])];
}

/** Cơ sở của một khối: "HO" → Hội sở; mã cơ sở vận hành → cơ sở đó; khác → null (không ánh xạ được). */
export function coSoCuaKhoi(unit: string, map: CenterMap): string | null {
  if (unit === "HO") return map.hoCenterId;
  return map.byCode[unit]?.centerId ?? null;
}

/** Mã ca THEO CƠ SỞ của khối: mã riêng của cơ sở thắng mã dùng chung. */
function timMau(mau: Map<string, Mau>, code: string, homeCenterId: string | null): Mau | undefined {
  return (homeCenterId ? mau.get(`${code}|${homeCenterId}`) : undefined) ?? mau.get(`${code}|`);
}

async function khoaNguoiThang(tx: Prisma.TransactionClient, userId: string, ym: string): Promise<void> {
  // `$executeRaw`, KHÔNG `$queryRaw`: `pg_advisory_xact_lock` trả `void`, Prisma không đọc được cột kiểu đó.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ghi-o:${userId}:${ym}`})::bigint)`;
}

/**
 * Khoá (người, tháng) của MỘT ô — cho đường hoàn tác đơn đã duyệt (`don/hoan-tac.ts`), vốn tự ghi ô trong giao dịch riêng của nó
 * (khôi phục ô cũ / huỷ ô do đơn tạo). Phải lấy CÙNG khoá với `xuLyLo` thì hai đường mới loại trừ nhau.
 */
export async function khoaOTrongTx(tx: Prisma.TransactionClient, userId: string, workDate: Date): Promise<void> {
  await khoaNguoiThang(tx, userId, thang(workDate));
}

async function xuLyLo(
  c: Prisma.TransactionClient,
  ctx: NguCanhGhiO,
  lenhs: LenhO[],
  ghiThat: boolean,
): Promise<KetQuaO[]> {
  const tx = c;
  const ketQua: KetQuaO[] = [];
  const userIds = [...new Set(lenhs.map((l) => l.userId))].sort();
  const dates = [...new Map(lenhs.map((l) => [ymd(l.workDate), l.workDate])).values()];
  const coSo = tatCaCoSo(ctx.centerMap);

  // 1. KHOÁ trước mọi lần đọc ô — đọc rồi mới khoá là đọc ảnh cũ (chính lỗi đang vá). Thứ tự cố định: người ↑, tháng ↑.
  if (ghiThat) {
    for (const u of userIds) {
      const thangCua = [...new Set(lenhs.filter((l) => l.userId === u).map((l) => thang(l.workDate)))].sort();
      for (const ym of thangCua) await khoaNguoiThang(tx, u, ym);
    }
  }

  // 2. Đọc DƯỚI KHOÁ, bằng client TRẦN: ô, mã ca (chung + riêng cơ sở), kỳ đã chốt.
  const existingRows = await c.shiftAssignment.findMany({
    where: { userId: { in: userIds }, workDate: { in: dates }, status: "ACTIVE" },
    select: { id: true, userId: true, workDate: true, templateCode: true, centerId: true, source: true },
  });
  const existing = new Map(existingRows.map((e) => [keyO(e.userId, e.workDate), e]));
  const mauRows = await c.shiftTemplate.findMany({
    where: { isActive: true, OR: [{ centerId: null }, { centerId: { in: coSo } }] },
    select: MAU_SELECT,
  });
  const mau = new Map(mauRows.map((t) => [`${t.code}|${t.centerId ?? ""}`, t]));
  const periodKeys = [...new Set(lenhs.map((l) => thang(l.workDate)))];
  const kyChot = new Set(
    ctx.boQuaKyDaChot
      ? []
      : (
          await c.attendancePeriod.findMany({
            where: { status: "LOCKED", periodKey: { in: periodKeys }, centerId: { in: coSo } },
            select: { centerId: true, periodKey: true },
          })
        ).map((p) => `${p.centerId}|${p.periodKey}`),
  );

  const dirty: Record<string, { userId: string; workDate: Date }[]> = {};
  const danhDau = (reason: string, l: LenhO) => (dirty[reason] ??= []).push({ userId: l.userId, workDate: l.workDate });

  // 3. Quyết định + ghi từng ô, theo thứ tự (người ↑, ngày ↑) cho kết quả ổn định.
  const sapXep = [...lenhs].sort((a, b) => a.userId.localeCompare(b.userId) || a.workDate.getTime() - b.workDate.getTime());
  for (const l of sapXep) {
    const cu = existing.get(keyO(l.userId, l.workDate)) ?? null;
    const truoc = cu ? { id: cu.id, templateCode: cu.templateCode, centerId: cu.centerId, source: cu.source as NguonO } : null;
    const ym = thang(l.workDate);
    const quaKhu = l.source === "PATTERN" ? ctx.homNay !== null && l.workDate.getTime() <= ctx.homNay.getTime() : false;
    if (l.source === "PATTERN" && ctx.homNay === null) throw new Error("ghi-o: lệnh nguồn PATTERN cần `homNay` (luật 19 — hàm không tự đọc đồng hồ)");
    const homeCenterId = coSoCuaKhoi(l.homeUnit, ctx.centerMap);
    const ra = (p: Omit<KetQuaO, "userId" | "workDate" | "truoc" | "canhBao"> & { canhBao?: string[] }): KetQuaO => ({
      userId: l.userId,
      workDate: l.workDate,
      truoc,
      canhBao: [],
      ...p,
    });

    // Khối không ánh xạ được ⇒ BỎ QUA có lý do (trước T04 bị gán thầm cho Hội sở). Không áp cho lệnh xoá.
    if (l.code !== null && homeCenterId === null && !(l.source === "PATTERN" && quaKhu)) {
      ketQua.push(ra({ ket: "BO_QUA", lyDo: "CO_SO_LA", chiTiet: `khối "${l.homeUnit}"`, sau: null }));
      continue;
    }

    const t = l.code !== null ? timMau(mau, l.code, homeCenterId) : undefined;
    const place = t
      ? resolvePlace({ segments: (t.segments as ShiftSegment[] | null) ?? [], defaultPlace: t.defaultPlace as PlaceToken, homeUnit: l.homeUnit, map: ctx.centerMap })
      : null;
    const quyet = quyetDinhO({
      nguon: l.source,
      cu: truoc ? { source: truoc.source, centerId: truoc.centerId, templateCode: truoc.templateCode } : null,
      // Thiếu mã ca: dùng cơ sở của khối làm ô mới TẠM để các cổng phía trước (quá khứ, bảo vệ, quyền ô cũ) vẫn chạy
      // đúng thứ tự; kết quả TAO/THAY/KY_DA_CHOT/KHONG_QUYEN_CO_SO_MOI sau đó bị thay bằng MA_KHONG_CO.
      moi: l.code === null ? null : { templateCode: l.code, centerId: place?.centerId ?? homeCenterId! },
      ghiDeNhapTay: ctx.ghiDeNhapTay,
      quaKhu,
      coQuyen: ctx.canWriteCenter,
      kyDaChot: (centerId) => kyChot.has(`${centerId}|${ym}`),
    });

    if (l.code !== null && !t && (quyet.ket === "TAO" || quyet.ket === "THAY" || (quyet.ket === "BO_QUA" && (quyet.lyDo === "KY_DA_CHOT" || quyet.lyDo === "KHONG_QUYEN_CO_SO_MOI")))) {
      ketQua.push(ra({ ket: "BO_QUA", lyDo: "MA_KHONG_CO", chiTiet: `mã "${l.code}"`, sau: null }));
      continue;
    }
    if (quyet.ket === "BO_QUA") {
      ketQua.push(ra({ ket: "BO_QUA", lyDo: quyet.lyDo, sau: null }));
      continue;
    }
    if (quyet.ket === "GIU") {
      ketQua.push(ra({ ket: "GIU", sau: truoc ? { id: truoc.id, templateCode: truoc.templateCode, centerId: truoc.centerId } : null }));
      continue;
    }

    const lyDoDirty = l.source === "PATTERN" ? "generate" : l.source === "IMPORT" ? "import" : l.source;
    if (quyet.ket === "XOA") {
      if (ghiThat) await tx.shiftAssignment.updateMany({ where: { id: cu!.id }, data: { status: "CANCELLED", note: l.note ?? undefined } });
      danhDau(lyDoDirty, l);
      ketQua.push(ra({ ket: "XOA", sau: null }));
      continue;
    }

    // TAO / THAY — t và place chắc chắn có (nhánh thiếu mã đã trả ở trên).
    if (quyet.ket === "THAY" && ghiThat) await tx.shiftAssignment.updateMany({ where: { id: cu!.id }, data: { status: "CANCELLED" } });
    const orgUnitId = place!.centerId === ctx.centerMap.hoCenterId ? null : (Object.values(ctx.centerMap.byCode).find((x) => x.centerId === place!.centerId)?.orgUnitId ?? null);
    const sau: KetQuaO["sau"] = ghiThat
      ? await tx.shiftAssignment.create({
        data: {
          userId: l.userId,
          employeeId: l.employeeId ?? undefined,
          centerId: place!.centerId,
          orgUnitId,
          workDate: l.workDate,
          templateId: t!.id,
          templateCode: t!.code,
          segments: place!.segments as unknown as Prisma.InputJsonValue,
          placeMode: place!.placeMode,
          allowedOrgUnitIds: place!.allowedOrgUnitIds,
          attendanceMode: t!.attendanceMode,
          soCapQuetKyVong: t!.soCapQuetKyVong,
          dayCredit: t!.dayCredit,
          isLeave: t!.isLeave,
          nominalMinutes: t!.nominalMinutes,
          sourceCells: (l.sourceCells ?? { [l.homeUnit]: t!.code }) as Prisma.InputJsonValue,
          source: l.source,
          sourceRequestId: l.sourceRequestId ?? null,
          note: l.note ?? null,
          createdById: ctx.actorUserId,
        },
        select: { id: true, templateCode: true, centerId: true },
      })
      : { id: "(xem trước)", templateCode: t!.code, centerId: place!.centerId };
    danhDau(lyDoDirty, l);
    ketQua.push(ra({ ket: quyet.ket, sau, canhBao: place!.warnings }));
  }

  // 4. Xếp hàng tính lại TRONG CÙNG transaction (createMany + skipDuplicates — an toàn trong tx, xem recompute.ts).
  if (ghiThat) {
    for (const [reason, days] of Object.entries(dirty)) await markAttendanceDaysDirtyMany(days, { tx, reason });
  }
  return ketQua;
}

export function demKetQua(ketQua: KetQuaO[], lenhTrung = 0): ThongKeGhiO {
  const dem: ThongKeGhiO = { TAO: 0, THAY: 0, GIU: 0, XOA: 0, BO_QUA: 0, boQuaTheoLyDo: {}, lenhTrung };
  for (const k of ketQua) {
    dem[k.ket] += 1;
    if (k.ket === "BO_QUA" && k.lyDo) dem.boQuaTheoLyDo[k.lyDo] = (dem.boQuaTheoLyDo[k.lyDo] ?? 0) + 1;
  }
  return dem;
}

/**
 * Chạy một loạt lệnh ghi ô.
 *
 * @param opts.ghiThat  `false` ⇒ đọc + quyết định + trả kết quả TỪNG Ô nhưng KHÔNG ghi, KHÔNG khoá, KHÔNG xếp hàng tính
 *                      lại — đúng cùng đường quyết định với ghi thật nên bảng xem trước không kể chuyện khác (luật 12b).
 * @param opts.tx       Người gọi đã có transaction (duyệt đơn: ghi ô + đánh dấu đơn đã áp phải cùng sống/chết). Khi đó
 *                      service dùng nó, không mở transaction riêng và KHÔNG chia lô — người gọi chịu trách nhiệm kích cỡ.
 * @param opts.nguoiMoiLo  Số người trong một transaction (mặc định 25). Lô đã commit giữ nguyên; chạy lại là idempotent
 *                         (ô đã đúng ⇒ GIU).
 */
export async function chayLenhO(opts: {
  ctx: NguCanhGhiO;
  lenhs: LenhO[];
  ghiThat: boolean;
  tx?: Prisma.TransactionClient;
  nguoiMoiLo?: number;
}): Promise<{ ketQua: KetQuaO[]; thongKe: ThongKeGhiO }> {
  // Trùng (người, ngày) trong cùng một loạt: lệnh SAU thắng, và ĐẾM — hai lệnh cho một ô là lỗi của người gọi.
  const theoO = new Map<string, LenhO>();
  let lenhTrung = 0;
  for (const l of opts.lenhs) {
    const k = keyO(l.userId, l.workDate);
    if (theoO.has(k)) lenhTrung += 1;
    theoO.set(k, l);
  }
  const lenhs = [...theoO.values()];
  if (lenhs.length === 0) return { ketQua: [], thongKe: demKetQua([], lenhTrung) };

  if (opts.tx) {
    const ketQua = await xuLyLo(opts.tx, opts.ctx, lenhs, opts.ghiThat);
    return { ketQua, thongKe: demKetQua(ketQua, lenhTrung) };
  }
  if (!opts.ghiThat) {
    // Xem trước: đọc bằng client trần ngoài transaction — không khoá, không ghi.
    const ketQua = await xuLyLo(db as unknown as Prisma.TransactionClient, opts.ctx, lenhs, false);
    return { ketQua, thongKe: demKetQua(ketQua, lenhTrung) };
  }
  const theoNguoi = new Map<string, LenhO[]>();
  for (const l of lenhs) (theoNguoi.get(l.userId) ?? theoNguoi.set(l.userId, []).get(l.userId)!).push(l);
  const nguoi = [...theoNguoi.keys()].sort();
  const co = Math.max(1, opts.nguoiMoiLo ?? 25);
  const ketQua: KetQuaO[] = [];
  for (let i = 0; i < nguoi.length; i += co) {
    const lo = nguoi.slice(i, i + co).flatMap((u) => theoNguoi.get(u)!);
    // Trần tường minh: mặc định 5 giây của Prisma cắt một lô hàng trăm ô ở máy chủ xa (P2028) — nâng trần ở đây là ĐÚNG
    // mức vì lô đã bị chặn kích cỡ (`nguoiMoiLo`); không phải che một N+1 (đọc đã gom một lượt mỗi lô).
    ketQua.push(...(await db.$transaction((tx) => xuLyLo(tx, opts.ctx, lo, true), { timeout: 120_000, maxWait: 15_000 })));
  }
  return { ketQua, thongKe: demKetQua(ketQua, lenhTrung) };
}
