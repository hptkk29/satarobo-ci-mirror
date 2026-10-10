// lib/payments/pos/khai-may-pos.ts — LÕI khai máy POS từ danh sách (GĐ2 POS · 06/10/2026). Script CHẠY TAY
// `scripts/pos-khai-may.ts` gọi tệp này; dữ liệu máy thật sống TRONG SCRIPT (dữ liệu vận hành) — lõi chỉ
// nhận danh sách (luật "mở cơ sở mới = thêm data, không sửa code"). Thiết kế: docs/pos-gd2-thiet-ke.md §6.2.
//
// [TỰ QUYẾT U16] Script chỉ TẠO máy chưa có và ĐIỀN ô đang TRỐNG:
//   · không bao giờ đè giá trị đang có khác giá trị script (báo `lech`);
//   · không chuyển cơ sở (`XUNG_DOT_CO_SO`) — đổi cơ sở của một máy là đổi cơ sở của MỌI giao dịch nó
//     quẹt, việc đó phải qua tab "Máy POS" (có người chịu trách nhiệm + audit);
//   · không bật lại máy đang TẮT (`dangTat`).
// Cơ sở tra theo `Center.code` — không id đóng cứng. Ghi qua `db` của `@/lib/db` ⇒ ghi kép `orgUnitId`
// chạy (`PosTerminal` ∈ BACKFILL_SPECS). Tệp này chạy NGOÀI Next (tsx) ⇒ không kéo tệp nào có
// `import "server-only"` (lưới `[POS2-SEED-06]`).
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit/audit-log";

/** Các ô script được phép ĐIỀN (khi đang trống). `maThietBi` là khoá khớp — không bao giờ sửa. */
export const TRUONG_MA = ["maQuay", "maCuaHang", "maNhaCungCap", "maTcbQuay"] as const;
export type TruongMa = (typeof TRUONG_MA)[number];

export type MayKhai = {
  /** `Center.code` (vd "CS1"). */
  coSo: string;
  maThietBi: string;
  maQuay: string | null;
  maCuaHang: string | null;
  maNhaCungCap: string | null;
  maTcbQuay: string | null;
};

export type TruongLech = { truong: TruongMa; hienTai: string; script: string };

export type ViecKhai =
  | { loai: "TAO"; may: MayKhai; centerId: string }
  | {
      loai: "DIEN";
      id: string;
      maThietBi: string;
      dien: Partial<Record<TruongMa, string>>;
      lech: TruongLech[];
      dangTat: boolean;
    }
  | { loai: "GIU_NGUYEN"; maThietBi: string; lech: TruongLech[]; dangTat: boolean }
  | { loai: "XUNG_DOT_CO_SO"; maThietBi: string; coSoHienTai: string; coSoScript: string }
  | { loai: "THIEU_CO_SO"; maThietBi: string; coSo: string };

export type MayHienCo = {
  id: string;
  maThietBi: string;
  centerId: string;
  active: boolean;
  maQuay: string | null;
  maCuaHang: string | null;
  maNhaCungCap: string | null;
  maTcbQuay: string | null;
};

/** Kế hoạch THUẦN (test bảng `[POS2-SEED-01]`). `coSo` phải gồm cả cơ sở HIỆN TẠI của máy đã có. */
export function keHoachKhaiMay(input: {
  ds: readonly MayKhai[];
  coSo: readonly { id: string; code: string | null; isActive: boolean }[];
  hienCo: readonly MayHienCo[];
}): ViecKhai[] {
  return input.ds.map((may): ViecKhai => {
    const coSo = input.coSo.find((c) => c.code === may.coSo && c.isActive);
    if (!coSo) return { loai: "THIEU_CO_SO", maThietBi: may.maThietBi, coSo: may.coSo };
    const cu = input.hienCo.find((m) => m.maThietBi === may.maThietBi);
    if (!cu) return { loai: "TAO", may, centerId: coSo.id };
    if (cu.centerId !== coSo.id) {
      return {
        loai: "XUNG_DOT_CO_SO",
        maThietBi: may.maThietBi,
        coSoHienTai: input.coSo.find((c) => c.id === cu.centerId)?.code ?? cu.centerId,
        coSoScript: may.coSo,
      };
    }
    const dien: Partial<Record<TruongMa, string>> = {};
    const lech: TruongLech[] = [];
    for (const t of TRUONG_MA) {
      const muon = may[t];
      if (muon === null) continue;
      const dang = cu[t];
      if (dang === null) dien[t] = muon;
      else if (dang !== muon) lech.push({ truong: t, hienTai: dang, script: muon });
    }
    const dangTat = !cu.active;
    return Object.keys(dien).length > 0
      ? { loai: "DIEN", id: cu.id, maThietBi: may.maThietBi, dien, lech, dangTat }
      : { loai: "GIU_NGUYEN", maThietBi: may.maThietBi, lech, dangTat };
  });
}

/** Có việc người vận hành PHẢI nhìn (xung đột cơ sở · thiếu cơ sở · ô lệch) ⇒ script thoát mã 2. */
export function canNguoiXem(viec: readonly ViecKhai[]): boolean {
  return viec.some(
    (v) =>
      v.loai === "XUNG_DOT_CO_SO" ||
      v.loai === "THIEU_CO_SO" ||
      ((v.loai === "DIEN" || v.loai === "GIU_NGUYEN") && v.lech.length > 0),
  );
}

/** Một dòng mô tả cho người chạy script. */
export function moTaViec(v: ViecKhai): string {
  const lech = (ds: readonly TruongLech[]) =>
    ds.length ? ` · LỆCH (giữ giá trị đang có): ${ds.map((l) => `${l.truong} "${l.hienTai}" ≠ script "${l.script}"`).join(", ")}` : "";
  const tat = (b: boolean) => (b ? " · máy đang TẮT (script không tự bật — bật ở tab Máy POS nếu cần)" : "");
  switch (v.loai) {
    case "TAO":
      return `TẠO      ${v.may.maThietBi} → cơ sở ${v.may.coSo}`;
    case "DIEN":
      return `ĐIỀN     ${v.maThietBi}: ${Object.entries(v.dien).map(([k, g]) => `${k}=${g}`).join(", ")}${lech(v.lech)}${tat(v.dangTat)}`;
    case "GIU_NGUYEN":
      return `GIỮ      ${v.maThietBi} (không còn ô trống để điền)${lech(v.lech)}${tat(v.dangTat)}`;
    case "XUNG_DOT_CO_SO":
      return `XUNG ĐỘT ${v.maThietBi}: đang ở ${v.coSoHienTai}, script nói ${v.coSoScript} — KHÔNG chuyển; đổi cơ sở ở tab Máy POS (có audit)`;
    case "THIEU_CO_SO":
      return `THIẾU    ${v.maThietBi}: không có cơ sở đang hoạt động mang mã "${v.coSo}" — không ghi`;
  }
}

const NGUOI_GHI = { id: null, name: "Script pos-khai-may" } as const;

const CHON_MAY = {
  id: true,
  maThietBi: true,
  centerId: true,
  active: true,
  maQuay: true,
  maCuaHang: true,
  maNhaCungCap: true,
  maTcbQuay: true,
} as const satisfies Prisma.PosTerminalSelect;

async function docHienTrang(ds: readonly MayKhai[]) {
  const hienCo = await db.posTerminal.findMany({
    where: { maThietBi: { in: ds.map((m) => m.maThietBi) } },
    select: CHON_MAY,
  });
  const coSo = await db.center.findMany({
    where: { OR: [{ code: { in: [...new Set(ds.map((m) => m.coSo))] } }, { id: { in: hienCo.map((m) => m.centerId) } }] },
    select: { id: true, code: true, isActive: true },
  });
  return { hienCo, coSo };
}

/** Điều kiện "ô đang trống" + dữ liệu điền cho TỪNG ô — viết tường minh (không khoá động) để `tsc` soát kiểu. */
const DIEN_O: Record<
  TruongMa,
  (gia: string) => { where: Prisma.PosTerminalWhereInput; data: Prisma.PosTerminalUpdateManyMutationInput }
> = {
  maQuay: (gia) => ({ where: { maQuay: null }, data: { maQuay: gia } }),
  maCuaHang: (gia) => ({ where: { maCuaHang: null }, data: { maCuaHang: gia } }),
  maNhaCungCap: (gia) => ({ where: { maNhaCungCap: null }, data: { maNhaCungCap: gia } }),
  maTcbQuay: (gia) => ({ where: { maTcbQuay: null }, data: { maTcbQuay: gia } }),
};

/** ĐIỀN ô đang trống — mỗi ô một `updateMany` CÓ ĐIỀU KIỆN `<ô> IS NULL`: ô vừa được người khác khai giữa
 * lúc lập kế hoạch và lúc ghi thì phép ghi đổi 0 dòng (không bao giờ đè). Trả 1 nếu có điền ít nhất một ô. */
async function dienMay(v: Extract<ViecKhai, { loai: "DIEN" }>): Promise<number> {
  return db.$transaction(async (tx) => {
    const daDien: Partial<Record<TruongMa, string>> = {};
    for (const t of TRUONG_MA) {
      const gia = v.dien[t];
      if (gia === undefined) continue;
      const o = DIEN_O[t](gia);
      const u = await tx.posTerminal.updateMany({ where: { id: v.id, ...o.where }, data: o.data });
      if (u.count === 1) daDien[t] = gia;
    }
    const truong = Object.keys(daDien);
    if (truong.length === 0) return 0;
    await writeAudit({
      tx,
      actor: NGUOI_GHI,
      module: "payments",
      entityType: "PosTerminal",
      entityId: v.id,
      action: "UPDATE",
      oldValues: Object.fromEntries(truong.map((t) => [t, null])),
      newValues: daDien,
      reason: "Khai máy POS bằng script (chỉ điền ô đang trống)",
    });
    return 1;
  });
}

/**
 * Khai danh sách máy. `apply: false` (mặc định của script) ⇒ CHỈ lập kế hoạch, không ghi gì. Hai người
 * chạy cùng lúc ⇒ TẠO đụng `maThietBi @unique` (P2002) ⇒ đọc lại, lập lại kế hoạch cho máy đó.
 */
export async function khaiMayPos(input: {
  ds: readonly MayKhai[];
  apply: boolean;
}): Promise<{ viec: ViecKhai[]; daGhi: number; coXungDot: boolean }> {
  const ht = await docHienTrang(input.ds);
  const viec = keHoachKhaiMay({ ds: input.ds, coSo: ht.coSo, hienCo: ht.hienCo });
  if (!input.apply) return { viec, daGhi: 0, coXungDot: canNguoiXem(viec) };

  let daGhi = 0;
  for (let i = 0; i < viec.length; i += 1) {
    const v = viec[i]!;
    if (v.loai === "DIEN") {
      daGhi += await dienMay(v);
      continue;
    }
    if (v.loai !== "TAO") continue;
    try {
      await db.$transaction(async (tx) => {
        const m = await tx.posTerminal.create({
          data: {
            maThietBi: v.may.maThietBi,
            maQuay: v.may.maQuay,
            maCuaHang: v.may.maCuaHang,
            maNhaCungCap: v.may.maNhaCungCap,
            maTcbQuay: v.may.maTcbQuay,
            // PosTerminal ∈ SCOPED_MODELS ⇒ create PHẢI tự set centerId (orgUnitId do ghi kép).
            centerId: v.centerId,
            active: true,
            createdById: null,
          },
          select: CHON_MAY,
        });
        await writeAudit({
          tx,
          actor: NGUOI_GHI,
          module: "payments",
          entityType: "PosTerminal",
          entityId: m.id,
          action: "CREATE",
          newValues: { ...m },
          orgUnitId: m.centerId,
          reason: `Khai máy POS bằng script — cơ sở ${v.may.coSo}`,
        });
      });
      daGhi += 1;
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") throw e;
      // Người khác vừa tạo máy này ⇒ lập lại kế hoạch cho RIÊNG máy đó.
      const lai = await docHienTrang([v.may]);
      const moi = keHoachKhaiMay({ ds: [v.may], coSo: lai.coSo, hienCo: lai.hienCo })[0]!;
      viec[i] = moi;
      if (moi.loai === "DIEN") daGhi += await dienMay(moi);
    }
  }
  return { viec, daGhi, coXungDot: canNguoiXem(viec) };
}
