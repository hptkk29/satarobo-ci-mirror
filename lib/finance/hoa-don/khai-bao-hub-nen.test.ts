// Ca [HHN-*] — NỀN DỮ LIỆU INVOICE HUB (đợt 2, lát S4) PHẢI ĐƯỢC KHAI ĐỦ BA CHỖ, VÀ MIGRATION PHẢI ĐỦ KHOÁ + CHỈ THÊM.
//
// Nguồn: docs/ke-toan-hoa-don/hub/04-KIEN-TRUC-VA-ADR.md §2 + §2.11; hợp đồng 08-HOP-DONG-DOT-2.md luật 4.
// Luật "Nền Hệ thống" #3 (CLAUDE.md): bảng mới mang dữ liệu theo cơ sở giữ CẢ HAI cột `centerId` + `orgUnitId` và khai đủ
// `SCOPED_MODELS`, `getModelPrefixes()`, `BACKFILL_SPECS`. Khai thiếu `getModelPrefixes` là tầm nhìn rơi về diện rộng (vai neo HO bất kỳ
// đọc Hub mọi cơ sở — lỗi #04); khai thiếu `SCOPED_MODELS` là kế toán CS1 đọc được nghĩa vụ/ngoại lệ/yêu cầu người mua của CS2.
//
// HAI NHÓM: sáu bảng `centerId` NOT NULL (BAT_BUOC, KHÔNG vào NULL_IS_GLOBAL_MODELS) và `HoaDonChinhSach` (`centerId` NULLABLE, NULL =
// dùng chung toàn pháp nhân ⇒ vào CẢ SCOPED_MODELS lẫn NULL_IS_GLOBAL_MODELS, BACKFILL `NULL_TOAN_HE_THONG`).
//
// Phần kiểm MIGRATION là LƯỚI GHIM MÃ NGUỒN (luật 11): bóc chú thích SQL `--` TRƯỚC khi soi, neo chuỗi hẹp, khẳng định SỐ LẦN khớp.
// HÀNH VI của chỉ mục từng phần/CHECK/RLS/cách ly được đo THẬT ở `tests/finance/hoa-don-hub-nen-db.test.ts` — lưới ở đây chỉ bảo đảm
// chúng không biến mất khỏi SQL. Thuần: xanh khi DB trỏ cổng chết.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Prisma } from "@prisma/client";
import {
  SCOPED_MODELS,
  NULL_IS_GLOBAL_MODELS,
  SCOPE_EXEMPT,
  getModelPrefixes,
  getModelVisibleCenterIds,
  injectScope,
  passesScope,
} from "@/lib/db-scope";
import { BACKFILL_SPECS } from "@/lib/org/center-bridge";
import type { Actor } from "@/lib/auth/actor";

/** Sáu bảng `centerId` NOT NULL. */
const BAT_BUOC = [
  "HoaDonNghiaVu",
  "HoaDonDong",
  "HoaDonGiaoDichNhaCungCap",
  "HoaDonLenhKy",
  "HoaDonNgoaiLe",
  "HoaDonYeuCauNguoiMua",
] as const;
const CHINH_SACH = "HoaDonChinhSach";
const BAY_BANG = [...BAT_BUOC, CHINH_SACH] as const;

function model(ten: string) {
  const m = Prisma.dmmf.datamodel.models.find((x) => x.name === ten);
  if (!m) throw new Error(`Không có model ${ten} trong schema.prisma`);
  return m;
}

describe("[HHN-01] khai đủ ba chỗ của luật cách ly cơ sở", () => {
  it.each([...BAT_BUOC])("%s ∈ SCOPED_MODELS, KHÔNG ∈ NULL_IS_GLOBAL_MODELS, KHÔNG ∈ SCOPE_EXEMPT", (ten) => {
    // `centerId` NOT NULL: coi NULL là "dùng chung" ở đây là mở `centerId IS NULL OR …` cho bảng chứa khoá nguồn tiền / hộp thư ngoại lệ.
    expect(SCOPED_MODELS.has(ten)).toBe(true);
    expect(NULL_IS_GLOBAL_MODELS.has(ten)).toBe(false);
    expect(SCOPE_EXEMPT.has(ten)).toBe(false);
  });

  it("HoaDonChinhSach ∈ SCOPED_MODELS VÀ ∈ NULL_IS_GLOBAL_MODELS (khuôn PaymentMethod), KHÔNG ∈ SCOPE_EXEMPT", () => {
    // Quên vế NULL_IS_GLOBAL ⇒ chính sách dùng chung (centerId NULL) TÀNG HÌNH với kế toán cấp cơ sở.
    expect(SCOPED_MODELS.has(CHINH_SACH)).toBe(true);
    expect(NULL_IS_GLOBAL_MODELS.has(CHINH_SACH)).toBe(true);
    expect(SCOPE_EXEMPT.has(CHINH_SACH)).toBe(false);
    expect(SCOPED_MODELS.has("PaymentMethod") && NULL_IS_GLOBAL_MODELS.has("PaymentMethod")).toBe(true); // đối chứng: đúng khuôn mẫu
  });

  it.each([...BAY_BANG])("%s: getModelPrefixes = ['payments:'] — cùng họ tiền với HoaDonDienTu", (ten) => {
    // Trống thì rơi về `isHoLevel ? ALL : visibleCenterIds`: ai có MỘT vai neo tại Hội sở, kể cả vai chẳng liên quan tiền, đọc Hub mọi cơ sở.
    expect(getModelPrefixes(ten)).toEqual(["payments:"]);
    expect(getModelPrefixes(ten)).toEqual(getModelPrefixes("HoaDonDienTu"));
  });

  it.each([...BAT_BUOC])("%s: BACKFILL_SPECS có đúng MỘT dòng, BAT_BUOC, scoped = true", (ten) => {
    const spec = BACKFILL_SPECS.filter((s) => s.model === ten);
    expect(spec).toHaveLength(1);
    expect(spec[0]!.nullMeaning).toBe("BAT_BUOC");
    expect(spec[0]!.scoped).toBe(true);
  });

  it("HoaDonChinhSach: BACKFILL_SPECS = NULL_TOAN_HE_THONG (đối soát đêm GIỮ null), scoped = true", () => {
    const spec = BACKFILL_SPECS.filter((s) => s.model === CHINH_SACH);
    expect(spec).toHaveLength(1);
    expect(spec[0]!.nullMeaning).toBe("NULL_TOAN_HE_THONG");
    expect(spec[0]!.scoped).toBe(true);
  });
});

describe("[HHN-02] hình dạng cột — đo từ Prisma.dmmf, không đọc chú thích", () => {
  it.each([...BAT_BUOC])("%s có CẢ centerId (BẮT BUỘC) lẫn orgUnitId (tuỳ chọn, ghi kép)", (ten) => {
    const f = model(ten).fields;
    const center = f.find((x) => x.name === "centerId");
    const ou = f.find((x) => x.name === "orgUnitId");
    expect(center?.isRequired, `${ten}.centerId phải NOT NULL`).toBe(true);
    expect(center?.type).toBe("String");
    expect(ou, `${ten} thiếu orgUnitId`).toBeDefined();
    expect(ou?.isRequired).toBe(false);
  });

  it("HoaDonChinhSach: centerId NULLABLE (NULL = dùng chung toàn pháp nhân) + có orgUnitId", () => {
    const f = model(CHINH_SACH).fields;
    expect(f.find((x) => x.name === "centerId")?.isRequired).toBe(false);
    expect(f.some((x) => x.name === "orgUnitId")).toBe(true);
  });

  it("KHÔNG model Hub nào có xoá mềm (`[HDS-02]`) — 'xoá' = MAT_NGUON/KHONG_XUAT/HET_HIEU_LUC", () => {
    for (const ten of BAY_BANG) expect(model(ten).fields.some((x) => x.name === "deletedAt"), ten).toBe(false);
  });

  it("[BB-CCCD] HoaDonYeuCauNguoiMua KHÔNG có cột CCCD / giấy tờ tuỳ thân (TM-14)", () => {
    const cam = /cccd|cmnd|can_?cuoc|giay_?to|passport|national|identity|socialsecurity|idnumber|soCmt/i;
    for (const f of model("HoaDonYeuCauNguoiMua").fields) expect(f.name, `cột ${f.name}`).not.toMatch(cam);
    // đối chứng dương: mẫu bắt được tên cột thật sự xấu
    expect(cam.test("soCCCD")).toBe(true);
    expect(cam.test("nationalId")).toBe(true);
  });

  it("[BB-TTL] hetHanLuc BẮT BUỘC và KHÔNG default trong schema (TTL do ứng dụng tính từ cấu hình — OD-11)", () => {
    const f = model("HoaDonYeuCauNguoiMua").fields.find((x) => x.name === "hetHanLuc")!;
    expect(f.isRequired).toBe(true);
    expect(f.hasDefaultValue).toBe(false);
  });

  it("tiền là Int (đồng) — không Float; dòng hoá đơn giữ phần lẻ bằng Decimal", () => {
    expect(model("HoaDonNghiaVu").fields.find((x) => x.name === "soTienSnapshot")!.type).toBe("Int");
    const d = model("HoaDonDong").fields;
    for (const n of ["chietKhau", "thanhTien", "tienThue", "congTien"]) expect(d.find((x) => x.name === n)!.type, n).toBe("Int");
    for (const n of ["soLuong", "donGia", "thueSuat"]) expect(d.find((x) => x.name === n)!.type, n).toBe("Decimal");
  });

  it("HoaDonViec (ERD-08, OD-13 còn mở) CHƯA có trong schema", () => {
    expect(Prisma.dmmf.datamodel.models.some((m) => m.name === "HoaDonViec")).toBe(false);
  });
});

describe("[HHN-03] ADR-014 — KHÔNG thêm giá trị vào HoaDonTrangThai / HoaDonNguonPhatHanh", () => {
  const giaTri = (ten: string) => Prisma.dmmf.datamodel.enums.find((e) => e.name === ten)!.values.map((v) => v.name);
  it("HoaDonTrangThai vẫn đúng 6 giá trị cũ", () => {
    expect(giaTri("HoaDonTrangThai")).toEqual(["NHAP", "DA_XAC_NHAN", "THAY_THE", "KHONG_XUAT", "DANG_PHAT_HANH", "LOI_PHAT_HANH"]);
  });
  it("HoaDonNguonPhatHanh vẫn đúng 3 giá trị cũ", () => {
    expect(giaTri("HoaDonNguonPhatHanh")).toEqual(["TAI_LEN", "MISA_API", "MISA_GIA_LAP"]);
  });
  it("trạng thái nghĩa vụ = 5 giá trị THEO MÃ + MAT_NGUON; loại nghĩa vụ = 7 giá trị THEO MÃ (§14.3.1)", () => {
    expect(giaTri("HoaDonNghiaVuTrangThai")).toEqual(["CHO_XUAT", "CHO_QUYET", "DANG_XU_LY", "DA_XUAT", "KHONG_XUAT", "MAT_NGUON"]);
    expect(giaTri("HoaDonNghiaVuLoai")).toEqual([
      "THU_TIEN",
      "THU_HOC_CU",
      "THU_LE_PHI_THI",
      "THU_PHI_HOC_BU",
      "THU_TRUOC",
      "DIEU_CHINH_GIAM",
      "CHUA_PHAN_LOAI",
    ]);
  });
});

// ─── Migration ───────────────────────────────────────────────────────────────
const THU_MUC = resolve(process.cwd(), "prisma/migrations");
const tenMigration = readdirSync(THU_MUC).filter((d) => d.endsWith("_hoa_don_hub_nen"));

function sqlKhongChuThich(): string {
  const raw = readFileSync(resolve(THU_MUC, tenMigration[0]!, "migration.sql"), "utf8");
  return raw
    .split(/\r?\n/)
    .map((d) => d.replace(/--.*$/, ""))
    .join("\n");
}

describe("[HHN-04] migration — một thư mục, đủ khoá, và CHỈ THÊM", () => {
  it("có đúng MỘT thư mục migration `*_hoa_don_hub_nen`, timestamp ≥ 20261120090000 (sau mọi migration của origin/main + origin/test)", () => {
    expect(tenMigration).toHaveLength(1);
    expect(tenMigration[0]!.slice(0, 14) >= "20261120090000", tenMigration[0]).toBe(true);
  });

  it("bật RLS cho ĐÚNG bảy bảng mới (không thiếu, không thừa, mỗi bảng một lần)", () => {
    const bat = [...sqlKhongChuThich().matchAll(/ALTER TABLE "(\w+)" ENABLE ROW LEVEL SECURITY/g)].map((m) => m[1]);
    expect([...bat].sort()).toEqual([...BAY_BANG].sort());
  });

  it("đúng bảy CREATE TABLE, mỗi bảng đúng một lần", () => {
    const ten = [...sqlKhongChuThich().matchAll(/CREATE TABLE IF NOT EXISTS "(\w+)"/g)].map((m) => m[1]);
    expect([...ten].sort()).toEqual([...BAY_BANG].sort());
  });

  it.each([
    ["HoaDonLenhKy_hoaDonId_song_key", '"HoaDonLenhKy" \\("hoaDonId"\\)\\s+WHERE "trangThai" IN \\(\'CHO_KY\', \'DANG_KY\'\\)'],
    ["HoaDonNgoaiLe_dedupeKey_mo_key", '"HoaDonNgoaiLe" \\("dedupeKey"\\)\\s+WHERE "trangThai" IN \\(\'MO\', \'DANG_XU_LY\'\\)'],
    ["HoaDonYeuCauNguoiMua_orderId_mo_key", '"HoaDonYeuCauNguoiMua" \\("orderId"\\)\\s+WHERE "trangThai" = \'DANG_MO\''],
    ["HoaDonChinhSach_phapNhanMa_phienBan_chung_key", '"HoaDonChinhSach" \\("phapNhanMa", "phienBan"\\)\\s+WHERE "centerId" IS NULL'],
  ])("chỉ mục TỪNG PHẦN %s có đúng điều kiện WHERE (đúng một lần)", (ten, duoi) => {
    const sql = sqlKhongChuThich();
    const mau = new RegExp(`CREATE UNIQUE INDEX IF NOT EXISTS "${ten}" ON ${duoi}`, "g");
    expect(sql.match(mau) ?? []).toHaveLength(1);
  });

  it("UNIQUE(nguonLoai, nguonId) của HoaDonNghiaVu và UNIQUE khoaChongTrung của HoaDonDienTu còn trong SQL", () => {
    const sql = sqlKhongChuThich();
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS "HoaDonNghiaVu_nguonLoai_nguonId_key" ON "HoaDonNghiaVu"\("nguonLoai", "nguonId"\)/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS "HoaDonDienTu_khoaChongTrung_key" ON "HoaDonDienTu"\("khoaChongTrung"\)/);
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS "HoaDonGiaoDichNhaCungCap_hoaDonId_loaiLuot_luotThu_key" ON "HoaDonGiaoDichNhaCungCap"\("hoaDonId", "loaiLuot", "luotThu"\)/,
    );
  });

  it("CHECK maker≠checker: HIEU_LUC ⇒ nguoiDuyetId NOT NULL VÀ ≠ nguoiTaoId", () => {
    const khoi = sqlKhongChuThich().match(/CONSTRAINT "HoaDonChinhSach_maker_checker_check" CHECK \(([\s\S]*?)\n\s*\)/);
    expect(khoi, "mất CHECK maker≠checker").not.toBeNull();
    expect(khoi![1]).toMatch(/"trangThai" <> 'HIEU_LUC' OR/);
    expect(khoi![1]).toMatch(/"nguoiDuyetId" IS NOT NULL/);
    expect(khoi![1]).toMatch(/"nguoiDuyetId" <> "nguoiTaoId"/);
  });

  it("CHECK CHO_QUYET ⇒ lyDoCho có chữ (chặn cả NULL lẫn chuỗi trắng — CHECK coi NULL là QUA)", () => {
    const khoi = sqlKhongChuThich().match(/CONSTRAINT "HoaDonNghiaVu_cho_quyet_ly_do_check" CHECK \(([\s\S]*?)\n\s*\)/);
    expect(khoi, "mất CHECK CHO_QUYET").not.toBeNull();
    expect(khoi![1]).toMatch(/"trangThai" <> 'CHO_QUYET' OR/);
    expect(khoi![1]).toMatch(/"lyDoCho" IS NOT NULL AND btrim\("lyDoCho"\) <> ''/);
  });

  it("các CHECK còn lại của bảng mới có mặt (trạng thái / kết quả / lý do bỏ qua / bộ đếm / khoảng ngày)", () => {
    const sql = sqlKhongChuThich();
    for (const ten of [
      "HoaDonGiaoDichNhaCungCap_ket_qua_check",
      "HoaDonGiaoDichNhaCungCap_thong_diep_check",
      "HoaDonLenhKy_trang_thai_check",
      "HoaDonNgoaiLe_trang_thai_check",
      "HoaDonNgoaiLe_ly_do_xu_ly_check",
      "HoaDonYeuCauNguoiMua_trang_thai_check",
      "HoaDonYeuCauNguoiMua_so_lan_check",
      "HoaDonChinhSach_phien_ban_check",
      "HoaDonChinhSach_khoang_ngay_check",
    ]) {
      expect(sql.match(new RegExp(`CONSTRAINT "${ten}" CHECK`, "g")) ?? [], ten).toHaveLength(1);
    }
  });

  it("[BB-TTL] SQL KHÔNG đặt default cho hetHanLuc (không 7 ngày trong DB) và KHÔNG có cột CCCD/giấy tờ", () => {
    const sql = sqlKhongChuThich();
    expect(sql).toMatch(/"hetHanLuc" TIMESTAMPTZ\(6\) NOT NULL,/);
    expect(sql).not.toMatch(/"hetHanLuc"[^,\n]*DEFAULT/);
    expect(sql).not.toMatch(/interval\s+'\d+\s+days?'/i);
    expect(sql).not.toMatch(/cccd|cmnd|can_?cuoc|giay_?to|passport|national/i);
  });

  it("FK đúng ERD: Restrict tới Order/OrderItem/LegalEntity, SetNull cho hoaDonId có thể mất, Cascade cho dòng + lệnh ký", () => {
    const sql = sqlKhongChuThich();
    expect(sql).toMatch(/"HoaDonNghiaVu_orderId_fkey" FOREIGN KEY \("orderId"\) REFERENCES "Order"\("id"\) ON DELETE RESTRICT/);
    expect(sql).toMatch(/"HoaDonNghiaVu_orderItemId_fkey" FOREIGN KEY \("orderItemId"\) REFERENCES "OrderItem"\("id"\) ON DELETE RESTRICT/);
    expect(sql).toMatch(/"HoaDonYeuCauNguoiMua_orderId_fkey" FOREIGN KEY \("orderId"\) REFERENCES "Order"\("id"\) ON DELETE RESTRICT/);
    expect(sql).toMatch(/"HoaDonNghiaVu_hoaDonId_fkey" FOREIGN KEY \("hoaDonId"\) REFERENCES "HoaDonDienTu"\("id"\) ON DELETE SET NULL/);
    expect(sql).toMatch(
      /"HoaDonGiaoDichNhaCungCap_hoaDonId_fkey" FOREIGN KEY \("hoaDonId"\) REFERENCES "HoaDonDienTu"\("id"\) ON DELETE SET NULL/,
    );
    expect(sql).toMatch(/"HoaDonDong_hoaDonId_fkey" FOREIGN KEY \("hoaDonId"\) REFERENCES "HoaDonDienTu"\("id"\) ON DELETE CASCADE/);
    expect(sql).toMatch(/"HoaDonLenhKy_hoaDonId_fkey" FOREIGN KEY \("hoaDonId"\) REFERENCES "HoaDonDienTu"\("id"\) ON DELETE CASCADE/);
    // bốn FK `legalEntityId` (HoaDonDienTu + CauHinhHoaDonCoSo cũ; HoaDonNghiaVu + HoaDonChinhSach mới) đều Restrict (xoá pháp nhân không kéo theo mất chứng từ)
    expect(sql.match(/FOREIGN KEY \("legalEntityId"\) REFERENCES "LegalEntity"\("id"\) ON DELETE RESTRICT/g) ?? []).toHaveLength(4);
    // tự tham chiếu = NO ACTION (như thayTheChoId — xoá cả chuỗi theo đơn không đỏ oan)
    expect(sql).toMatch(/"HoaDonDienTu_hoaDonGocId_fkey" FOREIGN KEY \("hoaDonGocId"\) REFERENCES "HoaDonDienTu"\("id"\) ON DELETE NO ACTION/);
    expect(sql).toMatch(/"HoaDonNghiaVu_nghiaVuGocId_fkey" FOREIGN KEY \("nghiaVuGocId"\) REFERENCES "HoaDonNghiaVu"\("id"\) ON DELETE NO ACTION/);
  });

  it("KHÔNG đổi/bỏ cột, KHÔNG xoá gì, KHÔNG backfill, KHÔNG thêm giá trị vào enum cũ (luật cứng #4, ADR-014)", () => {
    const sql = sqlKhongChuThich();
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bALTER COLUMN\b/i);
    expect(sql).not.toMatch(/\bRENAME\b/i);
    expect(sql).not.toMatch(/\bALTER TYPE\b/i);
    // `ON UPDATE CASCADE` của khoá ngoại là hợp lệ ⇒ chỉ bắt câu lệnh UPDATE thật (`UPDATE "Bảng"`).
    expect(sql).not.toMatch(/\bUPDATE\s+"/i);
    expect(sql).not.toMatch(/\b(DELETE FROM|INSERT INTO|TRUNCATE)\b/i);
    for (const bang of ["Payment", "Order", "OrderItem", "Receipt", "BankTransaction", "PaymentRequest"]) {
      expect(sql, `migration đang ALTER bảng "${bang}"`).not.toMatch(new RegExp(`ALTER TABLE "${bang}"\\s`));
    }
  });

  it("ALTER bảng cũ chỉ ADD COLUMN IF NOT EXISTS và KHÔNG có NOT NULL (đúng 8 + 8 cột, hai bảng)", () => {
    const sql = sqlKhongChuThich();
    for (const [bang, soCot] of [
      ["CauHinhHoaDonCoSo", 8],
      ["HoaDonDienTu", 8],
    ] as const) {
      const m = sql.match(new RegExp(`ALTER TABLE "${bang}"\\s*\\n([\\s\\S]*?);`));
      expect(m, `không thấy ALTER TABLE "${bang}"`).not.toBeNull();
      const dong = m![1]!.split("\n").filter((d) => d.trim() !== "");
      expect(dong, bang).toHaveLength(soCot);
      for (const d of dong) {
        expect(d, d).toMatch(/ADD COLUMN IF NOT EXISTS "\w+" (TEXT|DATE)[,;]?\s*$/);
        expect(d, d).not.toMatch(/NOT NULL/);
      }
    }
    // chỉ hai bảng cũ này bị ALTER
    const bi = [...sql.matchAll(/ALTER TABLE "(\w+)"\s/g)].map((m) => m[1]).filter((b) => !(BAY_BANG as readonly string[]).includes(b!));
    // các `ALTER TABLE … ENABLE RLS` / `ADD CONSTRAINT` của bảng mới đã bị loại; còn lại phải là hai bảng cũ (+ HoaDonDienTu/CauHinh cho FK)
    expect(new Set(bi)).toEqual(new Set(["CauHinhHoaDonCoSo", "HoaDonDienTu"]));
  });

  it("idempotent: mọi ADD COLUMN / CREATE TABLE / CREATE INDEX có IF NOT EXISTS, mọi CREATE TYPE bọc kiểm pg_type (khớp [MIG-01])", () => {
    const sql = sqlKhongChuThich();
    const dong = sql.split("\n");
    expect(dong.filter((d) => /ADD COLUMN/i.test(d) && !/IF NOT EXISTS/i.test(d))).toEqual([]);
    expect(dong.filter((d) => /CREATE (TABLE|UNIQUE INDEX|INDEX)/i.test(d) && !/IF NOT EXISTS/i.test(d))).toEqual([]);
    expect(sql.match(/CREATE TYPE/g) ?? []).toHaveLength(6);
    expect(sql.match(/FROM pg_type WHERE typname = /g) ?? []).toHaveLength(6);
    // mỗi khoá ngoại bọc guard pg_constraint
    const soFk = sql.match(/ADD CONSTRAINT "\w+_fkey"/g) ?? [];
    expect(soFk).toHaveLength(13);
    expect(sql.match(/FROM pg_constraint WHERE conname = '\w+_fkey'/g) ?? []).toHaveLength(13);
  });
});

// ─── scopedDb: hành vi THUẦN của hàm chọn phạm vi (đối chứng với DB thật ở hoa-don-hub-nen-db.test.ts) ──────────────────
function actorCoSo(...cs: string[]): Actor {
  return {
    userId: "u-hhn",
    isSuperAdmin: false,
    isHoLevel: false,
    orgRoles: [],
    permissions: [{ action: "payments:confirm", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "CENTER_ACCOUNTANT", centerScope: cs }],
    visibleCenterIds: cs,
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  } as unknown as Actor;
}
function actorHoiSo(): Actor {
  return {
    userId: "u-hhn-ho",
    isSuperAdmin: false,
    isHoLevel: true,
    orgRoles: [],
    permissions: [{ action: "payments:confirm", scopeType: "GLOBAL", orgUnitId: "ho", roleCode: "HO_ACCOUNTANT", centerScope: "ALL" }],
    visibleCenterIds: [],
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  } as unknown as Actor;
}

describe("[HHN-05] hàm chọn phạm vi — cách ly cơ sở của bảy bảng mới", () => {
  it.each([...BAY_BANG])("%s: actor LAI (neo vai ở HO nhưng payments:* chỉ phủ CS1) ⇒ ['CS1'], KHÔNG rơi về ALL — chỉ nhờ getModelPrefixes", (ten) => {
    // Thiếu prefix ⇒ nhánh `getModelPrefixes().length === 0` ⇒ `isHoLevel ? "ALL"`: người này đọc Hub mọi cơ sở (lỗi #04).
    const lai = { ...actorCoSo("CS1"), isHoLevel: true } as unknown as Actor;
    expect(getModelVisibleCenterIds(ten, lai)).toEqual(["CS1"]);
    // đối chứng: CHÍNH actor đó với model CHƯA khai prefix thì rơi về ALL — chứng minh ca này đo đúng thứ nó định đo
    expect(getModelVisibleCenterIds("ModelChuaKhaiPrefix", lai)).toBe("ALL");
  });

  it.each([...BAT_BUOC])("%s: actor cơ sở CS1 ⇒ `centerId IN [CS1]` TRẦN (không OR NULL); HO ⇒ không lọc", (ten) => {
    expect(getModelVisibleCenterIds(ten, actorCoSo("CS1"))).toEqual(["CS1"]);
    expect(injectScope(ten, {}, actorCoSo("CS1"))).toEqual({ where: { centerId: { in: ["CS1"] } } });
    expect(injectScope(ten, {}, actorHoiSo())).toEqual({}); // đối chứng dương: HO thấy cả hai
    expect(passesScope(ten, { centerId: "CS1" }, actorCoSo("CS1"))).toBe(true);
    expect(passesScope(ten, { centerId: "CS2" }, actorCoSo("CS1")), "CS1 KHÔNG được qua với dòng CS2").toBe(false);
    expect(passesScope(ten, { centerId: null }, actorCoSo("CS1")), "centerId NULL là dữ liệu hỏng ⇒ chặn").toBe(false);
  });

  it("HoaDonChinhSach: actor CS1 thấy dòng CS1 VÀ dòng dùng chung (NULL) nhưng KHÔNG thấy CS2", () => {
    expect(injectScope(CHINH_SACH, {}, actorCoSo("CS1"))).toEqual({
      where: { OR: [{ centerId: null }, { centerId: { in: ["CS1"] } }] },
    });
    expect(passesScope(CHINH_SACH, { centerId: null }, actorCoSo("CS1"))).toBe(true);
    expect(passesScope(CHINH_SACH, { centerId: "CS1" }, actorCoSo("CS1"))).toBe(true);
    expect(passesScope(CHINH_SACH, { centerId: "CS2" }, actorCoSo("CS1"))).toBe(false);
    expect(injectScope(CHINH_SACH, {}, actorHoiSo())).toEqual({});
  });
});

// ─── Migration bỏ luật «người duyệt ≠ người soạn» (chủ dự án chốt 02/11/2026) ───
describe("[HHN-MC] migration bỏ maker≠checker: thả CHECK cũ, giữ «HIEU_LUC ⇒ có người duyệt», không chạm gì khác", () => {
  const ten = readdirSync(THU_MUC).filter((d) => d.endsWith("_hoa_don_chinh_sach_bo_maker_checker"));
  const sql = () =>
    readFileSync(resolve(THU_MUC, ten[0]!, "migration.sql"), "utf8")
      .split(/\r?\n/)
      .map((d) => d.replace(/--.*$/, ""))
      .join("\n");

  it("có đúng MỘT thư mục, timestamp SAU migration nền của Hub (chạy sau khi bảng đã có)", () => {
    expect(ten).toHaveLength(1);
    expect(ten[0]!.slice(0, 14) > tenMigration[0]!.slice(0, 14), ten[0]).toBe(true);
  });
  it("thả CHECK cũ (IF EXISTS — chạy lại không lỗi) và thêm CHECK mới chỉ đòi người duyệt, KHÔNG so với người tạo", () => {
    expect(sql()).toMatch(/DROP CONSTRAINT IF EXISTS "HoaDonChinhSach_maker_checker_check"/);
    const khoi = sql().match(/ADD CONSTRAINT "HoaDonChinhSach_nguoi_duyet_check" CHECK \(([\s\S]*?)\);/);
    expect(khoi, "mất CHECK mới").not.toBeNull();
    expect(khoi![1]).toMatch(/"trangThai" <> 'HIEU_LUC' OR "nguoiDuyetId" IS NOT NULL/);
    expect(khoi![1]).not.toMatch(/nguoiTaoId/);
  });
  it("CHỈ đụng bảng HoaDonChinhSach và chỉ sửa ràng buộc (không xoá bảng/cột, không sửa/xoá dòng dữ liệu)", () => {
    const s = sql();
    expect([...s.matchAll(/ALTER TABLE "(\w+)"/g)].map((m) => m[1])).toEqual(["HoaDonChinhSach", "HoaDonChinhSach", "HoaDonChinhSach"]);
    expect(s).not.toMatch(/DROP (TABLE|COLUMN)|\bUPDATE\b|\bDELETE\b|TRUNCATE/i);
  });
});
