// lib/cham-cong/day-khung.ts — ĐẨY khung ca tuần xuống lưới các ngày TƯƠNG LAI + chỉ báo LỆCH khung↔lưới (T04, 07/10/2026).
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO (đo 07/10/2026): sửa `ShiftWeeklyPattern` KHÔNG đẩy gì xuống lưới. Lưới chỉ đổi khi ai đó bấm "Sinh" cho từng
// tháng — nên sửa khung xong mà quên bấm, lưới và khung nói hai chuyện khác nhau và KHÔNG có chỗ nào hiện sự lệch.
//
// QUYẾT ĐỊNH 07/10/2026 (mục 2): sửa khung phải đẩy xuống các ngày tương lai theo PHẠM VI người dùng chọn, không cần
// bấm "Sinh":
//   · CHI_KHUNG            chỉ lưu khung; lưới giữ nguyên (nút "Sinh" vẫn là cách đẩy sau) và màn hiện chỉ báo lệch
//   · TU_NGAY              đẩy từ ngày X trở đi
//   · MOI_NGAY_CHUA_KHOA   đẩy mọi ngày tương lai chưa khoá  ← mặc định
// Quá khứ và hôm nay KHÔNG BAO GIỜ đổi (ngày X ≤ hôm nay bị kẹp về ngày mai và được BÁO). Kỳ đã chốt không đổi. Ô nhập
// thủ công (IMPORT/MANUAL) không bị đè mặc định; ô của đơn đã duyệt (SWAP/LEAVE) không bao giờ bị đè. Tất cả những luật
// đó nằm ở `chayLenhO` / `ghi-o-luat.ts` — file này CHỈ chọn tập ô cần đẩy và gom kết quả; nó KHÔNG có phép ghi nào.
//
// KHÔNG cần đa phiên bản khung (`effectiveFrom` vẫn ghim 2000-01-01, xem `khung-ca.ts`): "từ ngày X" là RANH GIỚI CỦA
// LẦN ĐẨY này, không phải thuộc tính của khung. Lần "Sinh" sau áp khung hiện hành cho mọi ngày tương lai — đó là việc của
// nút "Sinh", và chỉ báo lệch cho người dùng biết khi nào cần bấm.
// ─────────────────────────────────────────────────────────────────────────────
import { db as dbTran } from "@/lib/db";
import { generateMonthAssignments, type GenerateDb, type GenerateResult } from "./generate-db";
import type { CenterMap } from "./place";

export type PhamViDay = "CHI_KHUNG" | "TU_NGAY" | "MOI_NGAY_CHUA_KHOA";

/** Trần số tháng một lần đẩy chạm tới — chặn một lượt đẩy mở vô hạn (mỗi tháng là một lô khoá + transaction). */
export const SO_THANG_TOI_DA = 12;

export type KetQuaDay = {
  phamVi: PhamViDay;
  /** Khoảng ngày THẬT đã áp, "YYYY-MM-DD" (null khi CHI_KHUNG). Không bao giờ ≤ hôm nay. */
  tuNgay: string | null;
  denNgay: string | null;
  cacThang: string[];
  /** Người chọn "từ ngày X" mà X ≤ hôm nay ⇒ đã kẹp về NGÀY MAI (quá khứ không đổi). */
  daKepVeMai: boolean;
  /** Gộp mọi tháng; null khi CHI_KHUNG. */
  ketQua: GenerateResult | null;
  /**
   * Khung ĐÃ LƯU nhưng lượt đẩy xuống lưới lỗi (action gán). Khung và lưới không còn nói cùng một chuyện — người dùng phải
   * được biết, không phải đoán từ việc không thấy ô đổi.
   */
  loiDay?: string;
};

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const thangCua = (d: Date) => d.toISOString().slice(0, 7);
const cuoiThang = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
const congNgay = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/** Gộp kết quả hai tháng. Các bộ đếm cộng; danh sách nối; `people` lấy lớn nhất (cùng những người đó ở mọi tháng). */
export function gopKetQua(a: GenerateResult, b: GenerateResult): GenerateResult {
  return {
    created: a.created + b.created,
    replaced: a.replaced + b.replaced,
    kept: a.kept + b.kept,
    cleared: a.cleared + b.cleared,
    skippedProtected: a.skippedProtected + b.skippedProtected,
    skippedNoPermission: a.skippedNoPermission + b.skippedNoPermission,
    unknownCode: a.unknownCode + b.unknownCode,
    people: Math.max(a.people, b.people),
    skippedPast: a.skippedPast + b.skippedPast,
    skippedKyDaChot: a.skippedKyDaChot + b.skippedKyDaChot,
    skippedCoSoLa: a.skippedCoSoLa + b.skippedCoSoLa,
    chiTiet: [...a.chiTiet, ...b.chiTiet],
    restWarnings: [...a.restWarnings, ...b.restWarnings],
    warnings: [...a.warnings, ...b.warnings],
  };
}

export function khoiDauKetQua(): GenerateResult {
  return { created: 0, replaced: 0, kept: 0, cleared: 0, skippedProtected: 0, skippedNoPermission: 0, unknownCode: 0, people: 0, skippedPast: 0, skippedKyDaChot: 0, skippedCoSoLa: 0, chiTiet: [], restWarnings: [], warnings: [] };
}

/**
 * Các tháng một lần đẩy sẽ chạm: từ tháng của `tuNgay` đến CUỐI tháng xa nhất mà khối đã có ô — hoặc hết tháng hiện tại nếu
 * khối chưa sinh gì xa hơn (người mới thêm vào cũng được xếp cho phần còn lại của tháng này). Tháng CHƯA từng sinh lưới thì
 * không đẩy: không ai biết người ta muốn sinh nó, đó là việc của nút "Sinh".
 */
async function cacThangCanDay(p: { userIds: string[]; centerId: string; tuNgay: Date; homNay: Date }): Promise<string[]> {
  const nguoiKhoi = await dbTran.shiftWeeklyPattern.findMany({ where: { centerId: p.centerId, effectiveTo: null }, select: { userId: true }, distinct: ["userId"] });
  const nguoi = [...new Set([...nguoiKhoi.map((x) => x.userId), ...p.userIds])];
  const xaNhat = await dbTran.shiftAssignment.aggregate({ _max: { workDate: true }, where: { userId: { in: nguoi }, status: "ACTIVE", workDate: { gt: p.homNay } } });
  const chot = xaNhat._max.workDate && xaNhat._max.workDate.getTime() > cuoiThang(p.homNay).getTime() ? xaNhat._max.workDate : p.homNay;
  const tran = new Date(Date.UTC(p.homNay.getUTCFullYear(), p.homNay.getUTCMonth() + SO_THANG_TOI_DA - 1, 1));
  const den = cuoiThang(chot).getTime() > cuoiThang(tran).getTime() ? cuoiThang(tran) : cuoiThang(chot);
  const out: string[] = [];
  for (let d = new Date(Date.UTC(p.tuNgay.getUTCFullYear(), p.tuNgay.getUTCMonth(), 1)); d.getTime() <= den.getTime(); d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) out.push(thangCua(d));
  return out;
}

/**
 * Đẩy khung ca của `userIds` ở khối `centerId` xuống lưới.
 *
 * @param opts.weekdays  Những thứ vừa bị sửa (0=CN…6=T7); `null` = mọi thứ (thêm / gỡ người khỏi khối).
 * @param opts.tuNgay    Bắt buộc khi `phamVi === "TU_NGAY"`; UTC date-only.
 * @param opts.ghiThat   `false` ⇒ chỉ tính kết cục từng ô (xem trước) — cùng đường quyết định với ghi thật.
 */
export async function dayKhung(opts: {
  /** Đọc KHUNG ca (có thể là client lọc theo cơ sở). */
  db: GenerateDb;
  userIds: string[];
  centerId: string;
  weekdays: number[] | null;
  phamVi: PhamViDay;
  tuNgay: Date | null;
  /** HÔM NAY theo lịch VN (UTC date-only). BẮT BUỘC — luật 19. */
  homNay: Date;
  centerMap: CenterMap;
  canWriteCenter: (centerId: string) => boolean;
  actorUserId: string;
  ghiDeNhapTay: boolean;
  ghiThat: boolean;
}): Promise<KetQuaDay> {
  if (opts.phamVi === "CHI_KHUNG") {
    return { phamVi: opts.phamVi, tuNgay: null, denNgay: null, cacThang: [], daKepVeMai: false, ketQua: null };
  }
  const mai = congNgay(opts.homNay, 1);
  if (opts.phamVi === "TU_NGAY" && !opts.tuNgay) throw new Error("dayKhung: phạm vi TU_NGAY cần `tuNgay`");
  const muonTu = opts.phamVi === "TU_NGAY" ? opts.tuNgay! : mai;
  // Quá khứ và hôm nay KHÔNG BAO GIỜ đổi — kẹp, và nói ra.
  const tuNgay = muonTu.getTime() < mai.getTime() ? mai : muonTu;
  const daKepVeMai = muonTu.getTime() < mai.getTime();
  const cacThang = await cacThangCanDay({ userIds: opts.userIds, centerId: opts.centerId, tuNgay, homNay: opts.homNay });
  const thuDuocDay = opts.weekdays ? new Set(opts.weekdays) : null;

  let gop = khoiDauKetQua();
  for (const periodKey of cacThang) {
    const kq = await generateMonthAssignments({
      db: opts.db,
      periodKey,
      centerMap: opts.centerMap,
      // KHÔNG lọc theo khối: người có hai khối (CS1 + CS2) phải được dựng từ CẢ HAI khung — con trỏ D1/D2 gộp qua các khối.
      // Lọc một khối là dựng ô sai cho họ. Quyền ghi theo cơ sở đích do `canWriteCenter` chặn.
      canWriteCenter: opts.canWriteCenter,
      actorUserId: opts.actorUserId,
      onlyUserIds: opts.userIds,
      homNay: opts.homNay,
      ghiThat: opts.ghiThat,
      ghiDeNhapTay: opts.ghiDeNhapTay,
      // Đẩy khung KHÔNG có đường vượt kỳ chốt: kỳ đã chốt thì không đổi (quyết định 07/10).
      boQuaKyDaChot: false,
      chiNhungNgay: (d) => d.getTime() >= tuNgay.getTime() && (!thuDuocDay || thuDuocDay.has(d.getUTCDay())),
    });
    gop = gopKetQua(gop, kq);
  }
  const denNgay = cacThang.length > 0 ? ymd(cuoiThang(new Date(`${cacThang[cacThang.length - 1]}-01T00:00:00.000Z`))) : null;
  return { phamVi: opts.phamVi, tuNgay: ymd(tuNgay), denNgay, cacThang, daKepVeMai, ketQua: gop };
}

/**
 * CHỈ BÁO LỆCH khung↔lưới của một tháng: bao nhiêu ô tương lai KHÁC khung (sẽ đổi nếu bấm "Sinh"), bao nhiêu ô khác khung
 * nhưng được BẢO VỆ có chủ đích (nhập thủ công / đơn đã duyệt). Đọc, không ghi — dựa vào đúng bản xem trước của "Sinh".
 */
export async function lechKhung(opts: {
  db: GenerateDb;
  periodKey: string;
  centerIds: string[];
  centerMap: CenterMap;
  homNay: Date;
  actorUserId: string;
}): Promise<{ soOLech: number; soOBaoVe: number; theoNguoi: Record<string, number> }> {
  const kq = await generateMonthAssignments({
    db: opts.db,
    periodKey: opts.periodKey,
    centerMap: opts.centerMap,
    centerIds: opts.centerIds,
    // Chỉ báo không cần quyền ghi: đếm mọi ô KHÁC khung bất kể người xem ghi được hay không.
    canWriteCenter: () => true,
    actorUserId: opts.actorUserId,
    homNay: opts.homNay,
    ghiThat: false,
    ghiDeNhapTay: false,
    boQuaKyDaChot: false,
  });
  const theoNguoi: Record<string, number> = {};
  let soOLech = 0;
  for (const c of kq.chiTiet) {
    if (c.action === "CREATE" || c.action === "REPLACE" || c.action === "CLEAR") {
      soOLech += 1;
      theoNguoi[c.userId] = (theoNguoi[c.userId] ?? 0) + 1;
    }
  }
  return { soOLech, soOBaoVe: kq.skippedProtected, theoNguoi };
}
