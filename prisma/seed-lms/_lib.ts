// prisma/seed-lms/_lib.ts — Helpers dùng chung cho bộ seed test diện rộng LMS/CRM.
// - assertLocalDb(): CỔNG AN TOÀN — từ chối chạy nếu DATABASE_URL không trỏ DB local/test
//   (chống seed nhầm 200k rows vào Supabase prod/dev). Bypass bằng SEED_ALLOW_REMOTE=1.
// - Generator dữ liệu VN (tên/SĐT/ngày sinh/địa chỉ Đà Nẵng) — KHÔNG thêm dep (rule).
// - Helpers batch createMany + random.
import type { PrismaClient } from "@prisma/client";
import { laDbCucBo, laTenDbTest, loiTunnelVps } from "../../lib/security/url-db-cuc-bo";

// ─── Safety guard ─────────────────────────────────────────────────────────────
export function assertLocalDb(nhan = "seed-lms"): void {
  const url = process.env.DATABASE_URL ?? "";
  if (process.env.SEED_ALLOW_REMOTE === "1") {
    console.warn(`⚠️  SEED_ALLOW_REMOTE=1 — bỏ qua kiểm tra DB local (${nhan}). Bạn tự chịu trách nhiệm.`);
    return;
  }
  // 28/09/2026 — tunnel VPS (127.0.0.1:<cổng tunnel PROD> = PROD, :<cổng tunnel TEST> = TEST) trông y hệt DB máy và DB test
  // ở đó tên đúng là `satarobo_test` ⇒ chặn trước. Ghi có chủ đích lên DB test qua tunnel thì
  // dùng SEED_ALLOW_REMOTE=1 như workflow "Seed dữ liệu TEST" vẫn làm (nhánh trên).
  const tunnel = loiTunnelVps(url);
  if (tunnel) throw new Error(`[${nhan}] ${tunnel}`);
  const isLocal = laDbCucBo(url);
  const looksTest = laTenDbTest(url) || /satarobo_lmsdemo/.test(url);
  if (!isLocal && !looksTest) {
    let host = "<unparseable>";
    try {
      host = new URL(url).host;
    } catch {
      /* ignore */
    }
    throw new Error(
      `[${nhan}] TỪ CHỐI: DATABASE_URL không trỏ DB local/test (host=${host}). ` +
        `Máy dev thường có \`.env\` trỏ DB DEV — chạy seed ở đó là ghi dữ liệu dựng sẵn ` +
        `vào DB người khác đang nghiệm thu. ` +
        `Nếu thực sự muốn ghi DB remote: đặt SEED_ALLOW_REMOTE=1 (workflow đã đặt sẵn).`,
    );
  }
}

// ─── Deterministic PRNG (seedable) ────────────────────────────────────────────
// Mulberry32 — để mỗi lần chạy cùng scale ra dữ liệu ổn định (dễ debug/idempotent).
let _state = 0x9e3779b9;
export function seedRng(seed = 1234567): void {
  _state = seed >>> 0;
}
function next(): number {
  _state |= 0;
  _state = (_state + 0x6d2b79f5) | 0;
  let t = Math.imul(_state ^ (_state >>> 15), 1 | _state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function rand(min: number, max: number): number {
  return min + Math.floor(next() * (max - min + 1));
}
export function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(next() * arr.length)]!;
}
export function chance(p: number): boolean {
  return next() < p;
}
/** Chọn theo trọng số: weightedPick([[1,0.25],[2,0.5],[3,0.25]]). */
export function weightedPick<T>(pairs: readonly (readonly [T, number])[]): T {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = next() * total;
  for (const [v, w] of pairs) {
    if ((r -= w) <= 0) return v;
  }
  return pairs[pairs.length - 1]![0];
}
export function pad(n: number, width = 6): string {
  return String(n).padStart(width, "0");
}
export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ─── VN name / phone / dob / address generators ───────────────────────────────
const HO = ["Nguyễn", "Trần", "Lê", "Phạm", "Hoàng", "Huỳnh", "Phan", "Vũ", "Võ", "Đặng", "Bùi", "Đỗ", "Hồ", "Ngô", "Dương", "Lý"] as const;
const DEM_M = ["Văn", "Hữu", "Đức", "Minh", "Quang", "Thành", "Công", "Tuấn", "Bá", "Xuân", "Ngọc", "Gia"] as const;
const DEM_F = ["Thị", "Thanh", "Thu", "Ngọc", "Kim", "Diệu", "Phương", "Mỹ", "Hồng", "Thúy", "Khánh", "Gia"] as const;
const TEN_M = ["An", "Bình", "Cường", "Dũng", "Đạt", "Hải", "Hùng", "Khoa", "Long", "Nam", "Phúc", "Quân", "Sơn", "Tài", "Thắng", "Trung", "Việt", "Vinh", "Bảo", "Khang", "Huy", "Kiên", "Lâm", "Nhật", "Đăng", "Khôi"] as const;
const TEN_F = ["Anh", "Chi", "Dung", "Giang", "Hà", "Hân", "Hoa", "Hương", "Lan", "Linh", "Mai", "Nga", "Ngân", "Nhi", "Oanh", "Phương", "Quỳnh", "Thảo", "Trang", "Uyên", "Vy", "Yến", "Châu", "Diễm", "Như", "Trâm"] as const;

export type Gender = "MALE" | "FEMALE";
export function genGender(): Gender {
  return chance(0.52) ? "MALE" : "FEMALE";
}
export function genName(gender: Gender): string {
  const ho = pick(HO);
  const dem = gender === "MALE" ? pick(DEM_M) : pick(DEM_F);
  const ten = gender === "MALE" ? pick(TEN_M) : pick(TEN_F);
  return `${ho} ${dem} ${ten}`;
}
/** SĐT di động VN: 0 + đầu số (3/5/7/8/9) + 8 chữ số. Không đảm bảo unique (phone chỉ @@index). */
export function genPhone(): string {
  const prefix = pick(["3", "5", "7", "8", "9"] as const);
  let rest = "";
  for (let i = 0; i < 8; i++) rest += String(rand(0, 9));
  return `0${prefix}${rest}`;
}
/** DOB cho trẻ theo tuổi (năm). Trả Date. */
export function genChildDob(minAge = 6, maxAge = 14): Date {
  const age = rand(minAge, maxAge);
  const y = 2026 - age;
  const m = rand(0, 11);
  const d = rand(1, 28);
  return new Date(Date.UTC(y, m, d));
}
export function genAdultDob(): Date {
  const age = rand(28, 50);
  const y = 2026 - age;
  return new Date(Date.UTC(y, rand(0, 11), rand(1, 28)));
}
export function gradeForAge(age: number): number {
  return Math.min(8, Math.max(1, age - 5));
}

const DN_DISTRICTS = ["Hải Châu", "Thanh Khê", "Sơn Trà", "Ngũ Hành Sơn", "Liên Chiểu", "Cẩm Lệ", "Hòa Vang"] as const;
const DN_WARDS = ["Phường Hòa Cường Bắc", "Phường Thạc Gián", "Phường An Hải Bắc", "Phường Mỹ An", "Phường Hòa Khánh Nam", "Phường Khuê Trung", "Phường Hòa Minh", "Phường Nại Hiên Đông", "Phường Thanh Bình", "Phường Hòa Thuận Tây"] as const;
const DN_STREETS = ["Nguyễn Văn Linh", "Lê Duẩn", "Trần Phú", "Hùng Vương", "Nguyễn Hữu Thọ", "Hoàng Diệu", "2 Tháng 9", "Điện Biên Phủ", "Nguyễn Tri Phương", "Lê Đình Lý", "Tôn Đức Thắng", "Ngô Quyền", "Phạm Văn Đồng", "Nguyễn Lương Bằng"] as const;

export function genAddress(): { address: string; ward: string; district: string; city: string } {
  return {
    address: `${rand(1, 399)} ${pick(DN_STREETS)}`,
    ward: pick(DN_WARDS),
    district: pick(DN_DISTRICTS),
    city: "Đà Nẵng",
  };
}
export const REL = ["Bố", "Mẹ", "Ông", "Bà"] as const;
export function genRelation(): string {
  return pick(REL);
}

// ─── Batch createMany ─────────────────────────────────────────────────────────
/**
 * Chèn theo lô để tránh vượt giới hạn bind-param + progress log. Trả tổng count.
 * `create` nhận 1 lô và gọi `db.X.createMany({ data: batch as never, skipDuplicates: true })`
 * (cast `as never` vì rows là unknown[] — Prisma validate field ở runtime).
 */
export async function batchCreate(
  label: string,
  rows: unknown[],
  create: (batch: unknown[]) => PromiseLike<{ count: number }>,
  size = 1000,
): Promise<number> {
  let total = 0;
  const parts = chunk(rows, size);
  for (let i = 0; i < parts.length; i++) {
    const res = await create(parts[i]!);
    total += res.count;
    if (parts.length > 1) {
      process.stdout.write(`\r   [${label}] ${Math.min((i + 1) * size, rows.length)}/${rows.length}   `);
    }
  }
  if (parts.length > 1) process.stdout.write("\n");
  return total;
}

// ─── Center / OrgUnit constants (id cố định từ base seed) ──────────────────────
export const CENTERS = {
  CS1: "co-so-nguyen-huu-tho",
  CS2: "co-so-hoang-dieu",
  HO: "hoi-so",
} as const;
export const ORG_CODES = { CS1: "CS1", CS2: "CS2", HO: "HO" } as const;
/** Cơ sở vận hành (có HV/lớp) — KHÔNG gồm HO (back-office). */
export const OPERATING_CENTERS = [CENTERS.CS1, CENTERS.CS2] as const;

export async function requireFoundation(db: PrismaClient): Promise<{
  centerIds: string[];
  courseIds: { laptrinhrobot: string; luyenthirobosim: string };
  orgUnitByCode: Record<string, string>;
  adminId: string;
}> {
  const centers = await db.center.findMany({ select: { id: true } });
  const courses = await db.course.findMany({ select: { id: true, slug: true } });
  const orgs = await db.orgUnit.findMany({ select: { id: true, code: true } });
  const admin = await db.user.findFirst({ where: { role: "SUPER_ADMIN" }, select: { id: true } });
  const ltr = courses.find((c) => c.slug === "laptrinhrobot");
  const ltrs = courses.find((c) => c.slug === "luyenthirobosim");
  if (centers.length < 2 || !ltr || !ltrs || !admin) {
    throw new Error(
      "[seed-lms] Thiếu dữ liệu nền (Center/Course/admin). Chạy base seed trước: " +
        "pnpm exec dotenv -e .env.test -- tsx prisma/seed.ts",
    );
  }
  return {
    centerIds: centers.map((c) => c.id),
    courseIds: { laptrinhrobot: ltr.id, luyenthirobosim: ltrs.id },
    orgUnitByCode: Object.fromEntries(orgs.map((o) => [o.code, o.id])),
    adminId: admin.id,
  };
}
