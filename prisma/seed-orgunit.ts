// prisma/seed-orgunit.ts — Seed cây OrgUnit idempotent (ticket A0-01 §3; đổi hình ở P1 · US-05).
//
// HÌNH CÂY (chủ dự án chốt 11/08/2026 theo BA 08/08 §1.1 — README bàn giao §1 "BA thắng"):
//
//   HO (gốc, depth 0)                       path "/ho/"
//    └── DANANG (REGION)                    path "/ho/danang/"
//         ├── CS1 (CENTER, OWNED)           path "/ho/danang/cs1/"
//         └── CS2 (CENTER, OWNED)           path "/ho/danang/cs2/"
//
// KHÁC hình cũ hai điểm, cả hai đều có chủ đích:
//  1. KHÔNG còn node ROOT "SATAROBO". Trước đây ROOT là gốc kỹ thuật và HO/CS1/CS2 nằm
//     ngang hàng dưới nó (Doc 15 OI-1). Bản BA thắng nên HO là gốc thật. Node SATAROBO
//     trên DB ĐANG CHẠY không bị migration đụng tới — nó được dời/đóng bằng
//     `scripts/nen-p1-reshape-org-tree.ts` (dry-run mặc định, người vận hành chạy tay).
//  2. OrgUnit("HO").centerId = Center("HO") = "hoi-so". Trước P1 luật cấm HO mang centerId,
//     nên Center "hoi-so" MỒ CÔI: `orgUnitIdForCenter('hoi-so')` trả null ⇒ mọi bản ghi
//     của Hội sở không bao giờ nhận orgUnitId, và tới P4 (lật scope sang orgUnitId) thì
//     biến mất sạch. Đây là bịt lỗ đó tại gốc.
import { PrismaClient, type OrgUnitType } from "@prisma/client";
import { childPath } from "../lib/org/path";

type UnitSpec = {
  code: string;
  type: OrgUnitType;
  name: string;
  address: string | null;
  /** Center cũ (code) để gán centerId. HO cũng có — xem ghi chú đầu file. */
  centerCode: string | null;
  /** code của đơn vị cha; null = gốc. */
  parentCode: string | null;
};

/** Xương sống LUÔN được dựng, kể cả khi `codes` chỉ xin một cơ sở — cơ sở phải có tổ tiên. */
const SPINE: UnitSpec[] = [
  {
    code: "HO",
    type: "HO",
    name: "Hội sở",
    address: "114 Hoàng Diệu, Đà Nẵng",
    // ⚠️ centerCode: null CÓ CHỦ ĐÍCH. Center("hoi-so") là bản ghi MỒ CÔI đã biết — gắn nó
    // vào đây làm rò quyền qua màn nhân sự (xem ghi chú dài ở validateCenterId).
    // Việc bịt mồ côi thuộc US-07, bằng cầu ánh xạ tường minh.
    centerCode: null,
    parentCode: null,
  },
  {
    code: "DANANG",
    type: "REGION",
    name: "Khối Đà Nẵng",
    address: null,
    centerCode: null,
    parentCode: "HO",
  },
];

/**
 * Các đơn vị CƠ SỞ. Export để **bộ test không phải chép lại danh sách** — nó cần biết cơ sở
 * nào đòi một dòng `Center` tương ứng (xem `seedOrg` trong `tests/e2e/_helpers/seed.ts`).
 * Chép tay ở đó là đẻ bản thứ hai, và hai bản sẽ lệch nhau vào ngày mở CS3.
 */
export const CENTERS: UnitSpec[] = [
  {
    code: "CS1",
    type: "CENTER",
    name: "Cơ sở 1",
    address: "211 Nguyễn Hữu Thọ, Đà Nẵng",
    centerCode: "CS1",
    parentCode: "DANANG",
  },
  {
    code: "CS2",
    type: "CENTER",
    name: "Cơ sở 2",
    address: "114 Hoàng Diệu, Đà Nẵng",
    centerCode: "CS2",
    parentCode: "DANANG",
  },
];

/**
 * US-06 AC2 — pháp nhân GỐC của SataRobo. MST lấy từ `lib/locations.ts` (nguồn đang dùng
 * cho JSON-LD của site public) để không đẻ ra con số thứ hai.
 * Idempotent theo `taxCode`.
 */
export async function seedPrimaryLegalEntity(db: PrismaClient): Promise<string> {
  const taxCode = "0402301783";
  // Hạ cờ mọi pháp nhân gốc KHÁC trước khi upsert — DB có partial unique index
  // `LegalEntity_isPrimary_unique`. Trên DB dev/test (dùng chung với test.satarobo.vn),
  // ai đó tạo pháp nhân gốc khác qua UI là `pnpm db:seed` đỏ ở ngay dòng đầu, kéo theo
  // toàn bộ cây OrgUnit không được seed.
  await db.legalEntity.updateMany({
    where: { isPrimary: true, taxCode: { not: taxCode } },
    data: { isPrimary: false },
  });
  const le = await db.legalEntity.upsert({
    where: { taxCode },
    update: {
      legalName: "Công ty Cổ phần Công nghệ Giáo dục Sata Robo",
      isPrimary: true,
      isActive: true,
      deletedAt: null,
    },
    create: {
      taxCode,
      legalName: "Công ty Cổ phần Công nghệ Giáo dục Sata Robo",
      address: "211 Nguyễn Hữu Thọ, Đà Nẵng",
      isPrimary: true,
    },
    select: { id: true },
  });
  return le.id;
}

/**
 * Seed cây. `codes` lọc CƠ SỞ (mặc định: CS1 + CS2); xương sống HO/DANANG luôn có.
 * Idempotent qua upsert theo `code` → chạy nhiều lần không tạo trùng (AC8).
 * `path`/`depth` tính ngay tại đây, không trông chờ migration backfill — seed chạy trên
 * DB test vốn được TRUNCATE sạch nên không có gì để backfill.
 * Mọi đơn vị gắn về pháp nhân gốc (US-06 AC2) — chưa có franchise thật nên tất cả OWNED.
 */
export async function seedOrgUnits(db: PrismaClient, codes?: string[]): Promise<void> {
  const wantedCenters = codes
    ? CENTERS.filter((u) => codes.map((c) => c.toUpperCase()).includes(u.code))
    : CENTERS;

  // "HO" trong `codes` nghĩa là "cần đơn vị HO" — nó vốn nằm trong xương sống nên không
  // phải lọc gì; giữ chữ ký cũ để 20+ call-site `seedOrg(["HO","CS1","CS2"])` không đổi.
  const legalEntityId = await seedPrimaryLegalEntity(db);
  const idByCode = new Map<string, string>();
  const pathByCode = new Map<string, string>();

  for (const u of [...SPINE, ...wantedCenters]) {
    const parentId = u.parentCode ? (idByCode.get(u.parentCode) ?? null) : null;
    const parentPath = u.parentCode ? (pathByCode.get(u.parentCode) ?? null) : null;
    const path = childPath(parentPath, u.code);
    const depth = path.split("/").filter(Boolean).length - 1;

    let centerId: string | null = null;
    if (u.centerCode) {
      const c = await db.center.findFirst({
        where: { code: u.centerCode },
        select: { id: true },
      });
      centerId = c?.id ?? null;
    }

    const common = {
      type: u.type,
      name: u.name,
      address: u.address,
      parentId,
      centerId,
      path,
      depth,
      relationshipType: "OWNED" as const,
      status: "ACTIVE" as const,
      legalEntityId,
      isActive: true,
      deletedAt: null,
    };
    const row = await db.orgUnit.upsert({
      where: { code: u.code },
      update: common,
      create: { code: u.code, ...common },
    });
    idByCode.set(u.code, row.id);
    pathByCode.set(u.code, path);
  }
}

// Chạy trực tiếp: `tsx prisma/seed-orgunit.ts` (không kích hoạt khi được import).
if (process.argv[1]?.includes("seed-orgunit")) {
  const db = new PrismaClient();
  seedOrgUnits(db)
    .then(() => console.log("✅ Seeded OrgUnit (HO → DANANG → CS1/CS2)"))
    .catch((e) => {
      console.error("❌ seedOrgUnits:", e);
      process.exitCode = 1;
    })
    .finally(() => void db.$disconnect());
}
