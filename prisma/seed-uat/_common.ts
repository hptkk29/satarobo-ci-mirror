// prisma/seed-uat/_common.ts — nền dùng chung cho bộ seed UAT.
//
// MỤC TIÊU: mỗi tài khoản UAT đăng nhập vào là mọi màn của nó có ~50 dòng THẬT
// (mỗi cơ sở 50), kèm ~15% ca biên để nghiệm thu chạm được nhánh xử lý ngoại lệ.
//
// BA LUẬT CỨNG CỦA BỘ NÀY
//  1. CHỈ THÊM/CẬP NHẬT, KHÔNG BAO GIỜ XOÁ. DB dev CHÍNH LÀ DB của môi trường
//     `test` và đã bị xoá sạch hai lần ngày 23/08/2026 (bản free không có PITR).
//     Không một câu `delete`/`deleteMany`/`$executeRaw` nào được phép ở đây.
//  2. ID CỐ ĐỊNH + số ngẫu nhiên CÓ HẠT GIỐNG ⇒ chạy lại lần hai không đẻ thêm
//     dòng, chỉ cập nhật đúng dòng cũ. Mọi id đều mang tiền tố `uat-`, nên phân
//     biệt được dữ liệu UAT với dữ liệu người thật gõ tay.
//  3. Đi qua `@/lib/db` chứ KHÔNG `new PrismaClient()`: client đó đã cắm
//     `dualWriteExtension` nên `centerId` tự dội sang `orgUnitId`. Tự dựng client
//     là mất ghi kép, và dòng seed sẽ lệch khỏi dòng do ứng dụng tạo.
import { db } from "@/lib/db";

export { db };

// ─── Cổng an toàn ────────────────────────────────────────────────────────────

/**
 * Chặn chạy nhầm. In host DB ra để người chạy nhìn thấy mình đang ghi vào đâu,
 * và bắt đặt `UAT_SEED=1` — lỡ gõ `pnpm db:seed:uat` thì không có gì xảy ra.
 */
export function assertSeedAllowed(): void {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) throw new Error("Thiếu DATABASE_URL");

  let host = "(không đọc được)";
  try {
    host = new URL(url).host;
  } catch {
    /* URL lạ — vẫn in ra để người chạy tự nhìn */
  }
  console.log(`\n  Đích ghi: ${host}`);

  if (process.env.UAT_SEED !== "1") {
    throw new Error(
      "Chưa bật cờ an toàn. Xem host ở trên, ĐÚNG chỗ định ghi thì chạy lại với UAT_SEED=1.",
    );
  }
  // Pooler giao dịch (6543) hay ném `prepared statement "s0" already exists` khi
  // chạy script rời — cảnh báo chứ không chặn, vì có môi trường dùng cổng khác.
  if (url.includes(":6543")) {
    console.warn(
      "  ⚠ Đang dùng pooler giao dịch :6543 — nếu vấp lỗi 'prepared statement s0'\n" +
        "    thì đổi sang DIRECT_URL (session pooler :5432).",
    );
  }
}

// ─── Ngẫu nhiên CÓ HẠT GIỐNG ─────────────────────────────────────────────────
// Không dùng Math.random: chạy lại phải ra đúng bộ dữ liệu cũ, nếu không mỗi lần
// seed lại là một lần đổi tên/đổi số của cùng một dòng.

export function makeRng(seed: number) {
  let a = seed >>> 0;
  return function rng(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = ReturnType<typeof makeRng>;

export const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;
export const int = (rng: Rng, lo: number, hi: number): number =>
  lo + Math.floor(rng() * (hi - lo + 1));
/** true với xác suất p (0..1). Dùng để rắc ca biên. */
export const chance = (rng: Rng, p: number): boolean => rng() < p;

export function shuffle<T>(rng: Rng, xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

// ─── Tên người Việt ──────────────────────────────────────────────────────────

const HO = ["Nguyễn", "Trần", "Lê", "Phạm", "Hoàng", "Huỳnh", "Phan", "Vũ", "Võ", "Đặng",
  "Bùi", "Đỗ", "Hồ", "Ngô", "Dương", "Lý", "Đinh", "Tô", "Mai", "Trịnh"];
const DEM_NAM = ["Văn", "Hữu", "Đức", "Minh", "Quang", "Anh", "Bá", "Công", "Duy", "Gia"];
const DEM_NU = ["Thị", "Ngọc", "Thanh", "Thuỳ", "Khánh", "Mai", "Phương", "Hà", "Diệu", "Bảo"];
const TEN_NAM = ["An", "Bình", "Cường", "Dũng", "Đạt", "Hải", "Hùng", "Khoa", "Lâm", "Long",
  "Minh", "Nam", "Phong", "Quân", "Sơn", "Tâm", "Thành", "Tuấn", "Việt", "Vinh",
  "Bảo", "Kiệt", "Khang", "Nguyên", "Phúc", "Thịnh", "Trí", "Đăng", "Huy", "Lộc"];
const TEN_NU = ["An", "Anh", "Chi", "Dung", "Giang", "Hà", "Hằng", "Hoa", "Huyền", "Lan",
  "Linh", "Mai", "My", "Ngân", "Nhi", "Oanh", "Phương", "Quyên", "Thảo", "Trang",
  "Trâm", "Uyên", "Vy", "Yến", "Hương", "Nga", "Tú", "Diệp", "Khuê", "Ngọc"];

export type GioiTinh = "MALE" | "FEMALE";

export function tenNguoi(rng: Rng, gt: GioiTinh): string {
  const dem = gt === "MALE" ? pick(rng, DEM_NAM) : pick(rng, DEM_NU);
  const ten = gt === "MALE" ? pick(rng, TEN_NAM) : pick(rng, TEN_NU);
  return `${pick(rng, HO)} ${dem} ${ten}`;
}

// ─── Số điện thoại ───────────────────────────────────────────────────────────

/**
 * SĐT chuẩn hoá `84XXXXXXXXX` — khớp `PHONE_VN_RE` trong `lib/phone.ts`.
 *
 * ⚠️ Sinh theo kiểu `Date.now() % 1e8` từng đẻ ra số CHỈ 9 CHỮ SỐ và làm test đỏ
 * ~10% tuỳ GIỜ chạy. Ở đây ghép từ chỉ số nên độ dài cố định, không phụ thuộc giờ.
 */
export function sdt(i: number, dau: "3" | "5" | "7" | "8" | "9" = "9"): string {
  return `84${dau}${String(i).padStart(8, "0")}`;
}

// ─── Ngày giờ ────────────────────────────────────────────────────────────────
// Mốc CỐ ĐỊNH, không dùng `new Date()` cho dữ liệu: chạy lại phải ra đúng ngày cũ.
// (Vercel chạy UTC còn máy dev +07 — xem `lib/time/vn.ts`; ở đây dựng ngày bằng
// Date.UTC rồi bù 7 tiếng để giờ hiển thị ở VN đúng như ý.)

/** Mốc "hôm nay" của bộ seed. Đổi số này = dịch toàn bộ dòng thời gian. */
export const MOC = new Date("2026-08-23T00:00:00.000Z");

/** Ngày VN: 00:00 giờ VN của ngày lệch `days` so với mốc. */
export function ngay(days: number): Date {
  const d = new Date(MOC);
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(-7, 0, 0, 0);
  return d;
}

/** Ngày + giờ VN (hh:mm giờ Việt Nam). */
export function ngayGio(days: number, hh: number, mm = 0): Date {
  const d = ngay(days);
  d.setUTCHours(d.getUTCHours() + hh, mm, 0, 0);
  return d;
}

/** Ngày sinh trong khoảng tuổi cho trước (tính theo mốc). */
export function ngaySinh(rng: Rng, tuoiMin: number, tuoiMax: number): Date {
  const tuoi = int(rng, tuoiMin, tuoiMax);
  const d = new Date(MOC);
  d.setUTCFullYear(d.getUTCFullYear() - tuoi);
  d.setUTCMonth(int(rng, 0, 11), int(rng, 1, 28));
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// ─── Cơ sở ───────────────────────────────────────────────────────────────────

export type CoSo = { key: "CS1" | "CS2"; centerId: string; code: string; name: string };

/** Đọc hai cơ sở dạy học (KHÔNG lấy Hội sở — Hội sở không nhận lead/lớp/học viên). */
export async function layCoSo(): Promise<CoSo[]> {
  const cs = await db.center.findMany({
    where: { code: { in: ["CS1", "CS2"] } },
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  });
  if (cs.length !== 2) {
    throw new Error(
      `Cần đúng 2 cơ sở CS1/CS2, đang có ${cs.length}. Chạy seed nền trước (db:seed:orgunit).`,
    );
  }
  return cs.map((c) => ({
    key: c.code as "CS1" | "CS2",
    centerId: c.id,
    code: c.code ?? "",
    name: c.name,
  }));
}

/** Tài khoản UAT theo email — dùng để gán người phụ trách cho dữ liệu. */
export async function layUat() {
  const users = await db.user.findMany({
    where: { email: { startsWith: "uat." } },
    // `employeeId` là BẮT BUỘC phải mang theo: vài bảng LMS trỏ khoá ngoại sang
    // `Employee` chứ KHÔNG sang `User` (Assignment.createdById, Document.uploadedById)
    // — nhét id của User vào đó là vỡ khoá ngoại.
    select: { id: true, email: true, name: true, centerId: true, role: true, employeeId: true },
  });
  const byEmail = new Map(users.map((u) => [u.email ?? "", u]));
  const get = (local: string) => {
    const u = byEmail.get(`${local}@satarobo.vn`);
    if (!u) throw new Error(`Thiếu tài khoản UAT ${local}@satarobo.vn — tạo tài khoản trước khi seed.`);
    return u;
  };
  return {
    admin: get("uat.admin"),
    giamdoc: get("uat.giamdoc"),
    sale1: get("uat.sale1"),
    sale2: get("uat.sale2"),
    saleho: get("uat.saleho"),
    giaovu: get("uat.giaovu"),
    giaovien: get("uat.giaovien"),
    daotao: get("uat.daotao"),
    ketoan: get("uat.ketoan"),
    nhansu: get("uat.nhansu"),
    marketing: get("uat.marketing"),
    phuhuynh: get("uat.phuhuynh"),
  };
}

export type Uat = Awaited<ReturnType<typeof layUat>>;

/** Sale phụ trách của một cơ sở. */
export function saleCua(uat: Uat, cs: CoSo) {
  return cs.key === "CS1" ? uat.sale1 : uat.sale2;
}

// ─── Tiện ích ────────────────────────────────────────────────────────────────

/** Id ổn định: `uat-<nhóm>-<khoá>`. Chạy lại là trúng đúng dòng cũ. */
export const uid = (nhom: string, ...phan: (string | number)[]) =>
  `uat-${nhom}-${phan.join("-")}`;

/** SỐ DÒNG MỖI CƠ SỞ. Chốt 23/08: mỗi cơ sở 50 ⇒ Hội sở nhìn thấy ~100. */
export const MOI_CO_SO = Number(process.env.UAT_N ?? 50);

/** Tỉ lệ ca biên trộn vào (nghỉ học, lớp đầy, quá hạn…). */
export const TI_LE_CA_BIEN = 0.15;

let _buoc = 0;
export function buoc(ten: string): void {
  _buoc += 1;
  console.log(`\n[${String(_buoc).padStart(2, "0")}] ${ten}`);
}

export function xong(ten: string, n: number | Record<string, number>): void {
  const s = typeof n === "number" ? `${n} dòng` : Object.entries(n).map(([k, v]) => `${k}=${v}`).join("  ");
  console.log(`     ✓ ${ten}: ${s}`);
}

// ─── Ghi theo LÔ ─────────────────────────────────────────────────────────────
// Upsert từng dòng qua mạng tới Supabase tốn ~0,5s/dòng — 100 dòng là gần một
// phút. Dữ liệu seed không cần cập nhật khi chạy lại (id cố định + rng có hạt
// giống ⇒ nội dung y hệt), nên chỉ cần: đọc id đã có (1 truy vấn) → tạo phần
// còn thiếu (1 truy vấn). Hai vòng thay vì N vòng.

/**
 * `id` trong `*CreateManyInput` của Prisma là TUỲ CHỌN (có `@default(cuid())`),
 * nhưng bộ seed này bắt buộc phải tự đặt id — id cố định chính là thứ làm cho
 * chạy lại lần hai không đẻ thêm dòng. Kiểu này ép đúng điều đó ở chỗ khai mảng.
 */
export type CoId<T> = T & { id: string };

/**
 * Tạo những dòng CHƯA CÓ, bỏ qua dòng đã có. Không đụng dòng cũ ⇒ an toàn tuyệt
 * đối với dữ liệu người thật gõ tay (id của họ không mang tiền tố `uat-`).
 *
 * Nhận hai hàm thay vì nhận thẳng delegate của Prisma: delegate có nhiều chồng
 * chữ ký nên ép vào một interface chung sẽ phải `as never` — mà repo cấm `any`
 * và họ hàng của nó. Hai callback giữ được kiểu chặt ở nơi gọi.
 */
export async function taoThieu<T extends { id: string }>(
  rows: T[],
  docId: (ids: string[]) => Promise<{ id: string }[]>,
  tao: (data: T[]) => Promise<{ count: number }>,
): Promise<number> {
  if (rows.length === 0) return 0;
  const daCo = new Set<string>();
  const ids = rows.map((r) => r.id);
  // Chia nhỏ mệnh đề IN — danh sách vài nghìn id làm Postgres phân tích câu dài bất thường.
  for (let i = 0; i < ids.length; i += 500) {
    for (const f of await docId(ids.slice(i, i + 500))) daCo.add(f.id);
  }
  const thieu = rows.filter((r) => !daCo.has(r.id));
  let n = 0;
  for (let i = 0; i < thieu.length; i += 200) {
    n += (await tao(thieu.slice(i, i + 200))).count;
  }
  return n;
}
