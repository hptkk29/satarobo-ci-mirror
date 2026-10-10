// lib/cham-cong/seed-core.ts — logic seed nền (dùng chung cho prisma/seed-cham-cong.ts và test).
import type { PrismaClient } from "@prisma/client";
import {
  LEAVE_TYPE_CATALOG,
  SESSION_CATEGORY_CATALOG,
  SHIFT_CATALOG,
  TEACHING_CREDIT_CATALOG,
} from "./catalog";

type Db = Pick<
  PrismaClient,
  "shiftTemplate" | "leaveType" | "center" | "workLocation" | "teachingCreditType" | "sessionCategory"
>;

export async function seedShiftTemplates(db: Db, opts: { force?: boolean } = {}): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;
  for (const e of SHIFT_CATALOG) {
    const existing = await db.shiftTemplate.findFirst({ where: { code: e.code, centerId: null }, select: { id: true } });
    const data = {
      name: e.name,
      kind: e.kind,
      segments: e.segments,
      defaultPlace: e.defaultPlace,
      attendanceMode: e.attendanceMode,
      dayCredit: e.dayCredit,
      isLeave: e.isLeave,
      nominalMinutes: e.nominalMinutes,
      payMode: e.payMode,
      soCapQuetKyVong: e.soCapQuetKyVong,
      amStart: e.amStart ?? null,
      amEnd: e.amEnd ?? null,
      pmStart: e.pmStart ?? null,
      pmEnd: e.pmEnd ?? null,
      pmBreakStart: e.pmBreakStart ?? null,
      pmBreakEnd: e.pmBreakEnd ?? null,
      note: e.note ?? null,
      displayOrder: e.displayOrder,
    };
    if (!existing) {
      await db.shiftTemplate.create({ data: { code: e.code, centerId: null, ...data } });
      created += 1;
    } else if (opts.force) {
      await db.shiftTemplate.update({ where: { id: existing.id }, data });
      updated += 1;
    }
  }
  return { created, updated };
}

export async function seedLeaveTypes(db: Db, opts: { force?: boolean } = {}): Promise<number> {
  let n = 0;
  for (const [i, l] of LEAVE_TYPE_CATALOG.entries()) {
    const existing = await db.leaveType.findUnique({ where: { code: l.code }, select: { id: true } });
    if (existing && !opts.force) continue;
    await db.leaveType.upsert({
      where: { code: l.code },
      create: { ...l, displayOrder: i + 1 },
      update: { ...l, displayOrder: i + 1 },
    });
    n += 1;
  }
  return n;
}

/**
 * Danh mục PHÂN LOẠI BUỔI (SR.QD.230 PL03 §4).
 *
 * Chạy TRƯỚC `seedTeachingCreditTypes`: một dòng công dạy có thể trỏ tới phân loại, và FK để
 * `onDelete: Restrict` — thứ tự ngược lại sẽ hỏng ngay khi BLĐ thêm dòng riêng cho Workshop.
 */
export async function seedSessionCategories(
  db: Db,
  opts: { force?: boolean } = {},
): Promise<{ ghi: number; nhuongMacDinh: number }> {
  let ghi = 0;
  let nhuongMacDinh = 0;

  for (const [i, c] of SESSION_CATEGORY_CATALOG.entries()) {
    const existing = await db.sessionCategory.findUnique({ where: { code: c.code }, select: { id: true } });
    if (existing && !opts.force) continue;

    let datMacDinh = c.isDefault;

    // ── GHI LÊN DÒNG KHÁC: chỉ được phép sau `--force` (chốt chủ dự án 07/09/2026) ─────────
    //
    // Partial unique index `SessionCategory_one_default` chỉ cho ĐÚNG MỘT dòng mặc định, nên đặt
    // dòng này làm mặc định thì phải nhả cờ ở dòng đang giữ. Nhưng dòng đang giữ có thể là dòng
    // NGƯỜI VẬN HÀNH đã tự chọn trên màn Phân loại buổi.
    //
    // Bản đầu chạy `updateMany` vô điều kiện, và nó lọt được vào lần bấm THƯỜNG: khi dòng
    // CHINH_THUC chưa tồn tại (`!existing`) mà DB đã có phân loại khác đang giữ cờ mặc định. Lần
    // bấm không có `--force` mà vẫn đè lựa chọn của người khác — đúng thứ chữ "idempotent, KHÔNG
    // đè cột người dùng đã sửa" ở đầu file hứa là không xảy ra.
    //
    // Nay: có người đang giữ mà KHÔNG force ⇒ NHƯỜNG. Tạo dòng mới ở trạng thái không-mặc-định và
    // đếm riêng để lần bấm nào cũng nói ra. Không ai đang giữ ⇒ `updateMany` không đụng dòng nào,
    // chạy hay không cũng như nhau.
    if (c.isDefault) {
      const dangGiu = await db.sessionCategory.findFirst({
        where: { isDefault: true, code: { not: c.code } },
        select: { code: true },
      });
      if (dangGiu && !opts.force) {
        datMacDinh = false;
        nhuongMacDinh += 1;
      } else if (dangGiu) {
        await db.sessionCategory.updateMany({
          where: { isDefault: true, code: { not: c.code } },
          data: { isDefault: false },
        });
      }
    }

    await db.sessionCategory.upsert({
      where: { code: c.code },
      create: { ...c, isDefault: datMacDinh, displayOrder: i + 1 },
      update: { ...c, isDefault: datMacDinh, displayOrder: i + 1 },
    });
    ghi += 1;
  }
  return { ghi, nhuongMacDinh };
}

/**
 * 6 loại công dạy (lớp/trải nghiệm × chính/thay/trợ giảng).
 *
 * Mặc định giữ ĐÚNG hành vi đang chạy — chỉ lớp chính + dạy thay cộng vào kỳ — để bật tính
 * năng không làm đổi số công dạy của ai. Bật thêm loại nào là quyết định của BLĐ, làm trên màn.
 */
export async function seedTeachingCreditTypes(db: Db, opts: { force?: boolean } = {}): Promise<number> {
  let n = 0;
  for (const [i, t] of TEACHING_CREDIT_CATALOG.entries()) {
    const existing = await db.teachingCreditType.findUnique({ where: { code: t.code }, select: { id: true } });
    if (existing && !opts.force) continue;
    await db.teachingCreditType.upsert({
      where: { code: t.code },
      create: { ...t, displayOrder: i + 1 },
      update: { ...t, displayOrder: i + 1 },
    });
    n += 1;
  }
  return n;
}

/** 1 WorkLocation cho mỗi Center vận hành (code CS1/CS2…), KHÔNG tạo cho Hội sở (Q-04). */
export async function seedWorkLocations(db: Db): Promise<number> {
  const centers = await db.center.findMany({
    where: { isActive: true, code: { not: null } },
    select: { id: true, code: true, name: true, latitude: true, longitude: true, allowedRadiusMeters: true },
  });
  let n = 0;
  for (const c of centers) {
    const code = c.code as string;
    if (code === "HO") continue;
    const existing = await db.workLocation.findUnique({ where: { code }, select: { id: true } });
    if (existing) continue;
    await db.workLocation.create({
      data: {
        code,
        name: c.name,
        centerId: c.id,
        latitude: c.latitude,
        longitude: c.longitude,
        radiusMeters: c.allowedRadiusMeters ?? 100,
        geofenceEnabled: false,
      },
    });
    n += 1;
  }
  return n;
}

// ── KHẢO SÁT PHẠM VI GHI — chạy TRƯỚC khi ghi dòng đầu tiên ─────────────────────────────
//
// Vì sao cần (chốt chủ dự án 07/09/2026): nút seed prod đã ĐỔI PHẠM VI hai lần mà phần mô tả ở
// đầu workflow không đổi theo — bản 06/09 ghi "3 thứ", hôm nay script ghi 5 nhóm. Người bấm nút
// đọc mô tả, còn thứ chạy là script.
//
// Nên script phải TỰ NÓI phạm vi thật ngay trước khi ghi, thay vì để người bấm tin vào một dòng
// chú thích có thể đã cũ. Toàn bộ hàm này là phép ĐẾM — không ghi gì.

export type DongPhamVi = {
  nhom: string;
  /** Số dòng đang có trong DB (theo mã trong danh mục). */
  daCo: number;
  /** Số dòng danh mục trong mã nguồn. */
  trongDanhMuc: number;
  /** Sẽ TẠO mới. */
  seTao: number;
  /** Sẽ ĐÈ lên dòng đã có — chỉ khác 0 khi bật `--force`. */
  seDe: number;
};

async function demTheoMa(
  dem: (codes: string[]) => Promise<number>,
  codes: string[],
  nhom: string,
  force: boolean,
): Promise<DongPhamVi> {
  const daCo = await dem(codes);
  return {
    nhom,
    daCo,
    trongDanhMuc: codes.length,
    seTao: codes.length - daCo,
    seDe: force ? daCo : 0,
  };
}

/** Phạm vi ghi của `prisma/seed-cham-cong.ts`, đếm trước khi ghi. KHÔNG ghi gì. */
export async function khaoSatPhamVi(db: Db, opts: { force?: boolean } = {}): Promise<DongPhamVi[]> {
  const force = opts.force === true;

  // WorkLocation không theo danh mục mà theo CƠ SỞ đang hoạt động, và KHÔNG có đường `--force`
  // (`seedWorkLocations` bỏ qua điểm đã có, không nhận opts) — nên `seĐè` luôn 0.
  const centers = await db.center.findMany({
    where: { isActive: true, code: { not: null } },
    select: { code: true },
  });
  const maCoSo = centers.map((c) => c.code as string).filter((c) => c !== "HO");
  const wlDaCo = await db.workLocation.count({ where: { code: { in: maCoSo } } });

  return [
    await demTheoMa(
      (codes) => db.shiftTemplate.count({ where: { code: { in: codes }, centerId: null } }),
      SHIFT_CATALOG.map((x) => x.code),
      "ShiftTemplate (mã ca)",
      force,
    ),
    await demTheoMa(
      (codes) => db.leaveType.count({ where: { code: { in: codes } } }),
      LEAVE_TYPE_CATALOG.map((x) => x.code),
      "LeaveType (loại nghỉ)",
      force,
    ),
    {
      nhom: "WorkLocation (điểm chấm công)",
      daCo: wlDaCo,
      trongDanhMuc: maCoSo.length,
      seTao: maCoSo.length - wlDaCo,
      seDe: 0,
    },
    await demTheoMa(
      (codes) => db.sessionCategory.count({ where: { code: { in: codes } } }),
      SESSION_CATEGORY_CATALOG.map((x) => x.code),
      "SessionCategory (phân loại buổi)",
      force,
    ),
    await demTheoMa(
      (codes) => db.teachingCreditType.count({ where: { code: { in: codes } } }),
      TEACHING_CREDIT_CATALOG.map((x) => x.code),
      "TeachingCreditType (loại công dạy)",
      force,
    ),
  ];
}
