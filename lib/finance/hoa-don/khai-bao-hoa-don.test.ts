// Ca [HDS-*] — BẢNG HOÁ ĐƠN ĐIỆN TỬ PHẢI ĐƯỢC KHAI ĐỦ BA CHỖ, VÀ MIGRATION PHẢI ĐỦ CÁC KHOÁ.
//
// Kế hoạch: docs/ke-toan-hoa-don/PLAN.md §2.2. Luật "Nền Hệ thống" #3 (CLAUDE.md): bảng mới mang
// dữ liệu theo cơ sở giữ CẢ HAI cột `centerId` + `orgUnitId` và khai đủ `SCOPED_MODELS`,
// `getModelPrefixes()`, `BACKFILL_SPECS`. Khai thiếu `getModelPrefixes` là tầm nhìn rơi về diện
// rộng — đúng lỗi từng mắc với bảng điểm danh; khai thiếu `SCOPED_MODELS` là kế toán CS1 đọc được
// hoá đơn (có MST, địa chỉ, CCCD) của khách CS2.
//
// Phần kiểm MIGRATION là LƯỚI GHIM MÃ NGUỒN (luật 11): bóc chú thích SQL `--` trước khi soi, neo
// chuỗi hẹp, khẳng định SỐ LẦN khớp. Hành vi của các chỉ mục từng phần được đo THẬT trên Postgres
// ở `tests/finance/hoa-don-schema.test.ts` — lưới ở đây chỉ bảo đảm chúng không biến mất khỏi SQL.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Prisma } from "@prisma/client";
import { SCOPED_MODELS, NULL_IS_GLOBAL_MODELS, SCOPE_EXEMPT, getModelPrefixes } from "@/lib/db-scope";
import { BACKFILL_SPECS } from "@/lib/org/center-bridge";

const MODEL = "HoaDonDienTu";
const CON = ["HoaDonKhoan", "HoaDonGuiEmail"] as const;

function model(ten: string) {
  const m = Prisma.dmmf.datamodel.models.find((x) => x.name === ten);
  if (!m) throw new Error(`Không có model ${ten} trong schema.prisma`);
  return m;
}

describe("[HDS-01] khai đủ ba chỗ của luật cách ly cơ sở", () => {
  it("HoaDonDienTu ∈ SCOPED_MODELS, KHÔNG ∈ NULL_IS_GLOBAL_MODELS, KHÔNG ∈ SCOPE_EXEMPT", () => {
    // NULL ở đây không có nghĩa "dùng chung" — cột NOT NULL. Đưa vào NULL_IS_GLOBAL là mở
    // `centerId IS NULL OR …` cho một bảng chứa MST và địa chỉ khách.
    expect(SCOPED_MODELS.has(MODEL)).toBe(true);
    expect(NULL_IS_GLOBAL_MODELS.has(MODEL)).toBe(false);
    expect(SCOPE_EXEMPT.has(MODEL)).toBe(false);
  });

  it("getModelPrefixes = ['payments:'] — cùng họ tiền với Payment", () => {
    // Trống thì rơi về `isHoLevel ? ALL : visibleCenterIds`: ai có MỘT vai neo tại Hội sở, kể
    // cả vai chẳng liên quan tiền, đọc được hoá đơn mọi cơ sở.
    expect(getModelPrefixes(MODEL)).toEqual(["payments:"]);
    expect(getModelPrefixes(MODEL)).toEqual(getModelPrefixes("Payment"));
  });

  it("BACKFILL_SPECS: BAT_BUOC, scoped = true", () => {
    const spec = BACKFILL_SPECS.filter((s) => s.model === MODEL);
    expect(spec).toHaveLength(1);
    expect(spec[0]!.nullMeaning).toBe("BAT_BUOC");
    expect(spec[0]!.scoped).toBe(true);
  });
});

describe("[HDS-02] hình dạng cột — đo từ Prisma.dmmf, không đọc chú thích", () => {
  it("HoaDonDienTu có CẢ centerId (BẮT BUỘC) lẫn orgUnitId", () => {
    const f = model(MODEL).fields;
    const center = f.find((x) => x.name === "centerId");
    expect(center?.isRequired, "centerId phải NOT NULL — hoá đơn luôn thuộc đúng một cơ sở").toBe(true);
    expect(f.some((x) => x.name === "orgUnitId")).toBe(true);
  });

  it("hai bảng con KHÔNG mang centerId — cách ly đi qua bảng cha", () => {
    // Nếu một ngày ai thêm `centerId` vào bảng con, lưới [A0-04-T12-01] buộc phân loại nó;
    // ca này nói rõ ý đồ hiện tại để người đó biết họ đang đổi thiết kế.
    for (const ten of CON) {
      expect(model(ten).fields.some((x) => x.name === "centerId"), ten).toBe(false);
    }
  });

  it("số tiền là Int (đồng, như Payment.amount) — không Float", () => {
    const tien = ["tongTien", "tienThaLamTron"].map((n) => model(MODEL).fields.find((x) => x.name === n)!);
    for (const t of tien) expect(t.type, t.name).toBe("Int");
    expect(model("HoaDonKhoan").fields.find((x) => x.name === "soTien")!.type).toBe("Int");
  });

  it("KHÔNG có cột xoá mềm — hoá đơn sai thì THAY, không xoá", () => {
    expect(model(MODEL).fields.some((x) => x.name === "deletedAt")).toBe(false);
  });
});

// ─── Migration ───────────────────────────────────────────────────────────────
const THU_MUC = resolve(process.cwd(), "prisma/migrations");
const tenMigration = readdirSync(THU_MUC).filter((d) => d.endsWith("_hoa_don_dien_tu"));

function sqlKhongChuThich(): string {
  const raw = readFileSync(resolve(THU_MUC, tenMigration[0]!, "migration.sql"), "utf8");
  return raw
    .split(/\r?\n/)
    .map((d) => d.replace(/--.*$/, ""))
    .join("\n");
}

describe("[HDS-03] migration — đủ khoá, và CHỈ THÊM", () => {
  it("có đúng MỘT thư mục migration `*_hoa_don_dien_tu`", () => {
    expect(tenMigration).toHaveLength(1);
  });

  it("timestamp đứng SAU migration mới nhất lúc viết (kể cả nhánh khác)", () => {
    // Mốc cố định, KHÔNG so với "migration cuối cùng hiện có": so thế thì ca này đỏ oan ngay
    // khi ai đó thêm migration sau — lưới hỏng theo thời gian. Đo 26/09/2026 trên MỌI nhánh
    // remote: mới nhất là `20260925120000_*` (hai nhánh chưa merge dùng chung timestamp đó).
    const ts = tenMigration[0]!.slice(0, 14);
    expect(ts > "20260925120000", ts).toBe(true);
  });

  it("bật RLS cho CẢ BA bảng mới", () => {
    const sql = sqlKhongChuThich();
    const bat = [...sql.matchAll(/ALTER TABLE "(\w+)" ENABLE ROW LEVEL SECURITY/g)].map((m) => m[1]);
    expect([...bat].sort()).toEqual(["HoaDonDienTu", "HoaDonGuiEmail", "HoaDonKhoan"]);
  });

  it("chỉ mục từng phần: MỘT khoản chỉ thuộc tối đa MỘT hoá đơn đang hiệu lực", () => {
    const sql = sqlKhongChuThich();
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX[^;]*"HoaDonKhoan_paymentId_hieuLuc_key"[^;]*ON "HoaDonKhoan"\s*\("paymentId"\)\s*WHERE "hieuLuc"/,
    );
  });

  it("chỉ mục từng phần: không hai hoá đơn còn sống mang cùng (MST pháp nhân, ký hiệu, số)", () => {
    const sql = sqlKhongChuThich();
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX[^;]*"HoaDonDienTu_soHoaDon_conSong_key"[^;]*\("phapNhanMst", "kyHieu", "soHoaDon"\)\s*WHERE[^;]*'NHAP'[^;]*'DA_XAC_NHAN'/,
    );
  });

  it("xoá Payment / Order KHÔNG được kéo theo mất hoá đơn (ON DELETE RESTRICT)", () => {
    const sql = sqlKhongChuThich();
    expect(sql).toMatch(/REFERENCES "Payment"\("id"\) ON DELETE RESTRICT/);
    expect(sql).toMatch(/REFERENCES "Order"\("id"\) ON DELETE RESTRICT/);
  });

  it("KHÔNG ALTER bảng tiền đang có dữ liệu PROD (luật cứng #4)", () => {
    const sql = sqlKhongChuThich();
    for (const bang of ["Payment", "Order", "Receipt", "BankTransaction", "PaymentRequest"]) {
      expect(sql, `migration đang ALTER bảng "${bang}"`).not.toMatch(new RegExp(`ALTER TABLE "${bang}"\\s`));
    }
    expect(sql).not.toMatch(/\bDROP\b/);
  });
});

// ─── Migration GĐ 8 ─────────────────────────────────────────────────────────
// Quyết định 27/09: HUỶ hoá đơn đã xác nhận · "không trùng" · "xuất theo số đã thu" · khoá ngoại
// `thayTheChoId`. Ba CHECK chỉ có trong SQL (Prisma không biểu diễn) ⇒ kiểm drift KHÔNG thấy chúng mất;
// lưới này là chỗ duy nhất biết. Hành vi của chúng đo thật ở `[HDB-11..14]` (test:finance-db).
const tenGd8 = readdirSync(THU_MUC).filter((d) => d.endsWith("_hoa_don_gd8"));
function sqlGd8(): string {
  const raw = readFileSync(resolve(THU_MUC, tenGd8[0]!, "migration.sql"), "utf8");
  return raw
    .split(/\r?\n/)
    .map((d) => d.replace(/--.*$/, ""))
    .join("\n");
}

describe("[HDS-04] migration GĐ 8 — chỉ THÊM, đủ cột, đủ ràng buộc", () => {
  it("đúng MỘT thư mục `*_hoa_don_gd8`, timestamp sau mốc đo 27/09 (20260926120000)", () => {
    expect(tenGd8).toHaveLength(1);
    const ts = tenGd8[0]!.slice(0, 14);
    expect(ts > "20260926120000", ts).toBe(true);
  });

  it("thêm đủ 7 cột (huỷ ×3, không trùng ×3, lý do xuất theo số đã thu)", () => {
    const sql = sqlGd8();
    for (const cot of ["huyLyDo", "huyBoiId", "huyLuc", "khongTrungLyDo", "khongTrungBoiId", "khongTrungLuc", "xuatTheoSoDaThuLyDo"]) {
      expect(sql.match(new RegExp(`ADD COLUMN "${cot}"`, "g")) ?? [], cot).toHaveLength(1);
    }
  });

  it("khoá ngoại tự tham chiếu `thayTheChoId` là NO ACTION (không RESTRICT — xoá cả chuỗi theo đơn không đỏ oan)", () => {
    expect(sqlGd8()).toMatch(/"thayTheChoId"\) REFERENCES "HoaDonDienTu"\("id"\) ON DELETE NO ACTION/);
  });

  it("ba CHECK, mỗi cái chặn cả NULL lẫn chuỗi trắng (CHECK coi NULL là QUA)", () => {
    const sql = sqlGd8();
    for (const ten of ["HoaDonDienTu_huy_du_thong_tin_check", "HoaDonDienTu_xuatTheoSoDaThu_lyDo_check", "HoaDonDienTu_khongTrung_du_thong_tin_check"]) {
      const khoi = sql.slice(sql.indexOf(`"${ten}"`), sql.indexOf(";", sql.indexOf(`"${ten}"`)));
      expect(khoi, ten).toMatch(/CHECK/);
      expect(khoi, ten).toMatch(/IS NOT NULL AND btrim\(/);
    }
  });

  it("chỉ mục vân tay PDF (không UNIQUE — kiểm ở mã dưới khoá advisory)", () => {
    const sql = sqlGd8();
    expect(sql).toMatch(/CREATE INDEX "HoaDonDienTu_tepPdfSha256_idx" ON "HoaDonDienTu"\("tepPdfSha256"\)/);
    expect(sql).not.toMatch(/CREATE UNIQUE INDEX[^;]*tepPdfSha256/);
  });

  it("KHÔNG ALTER bảng tiền, KHÔNG DROP, KHÔNG bảng mới", () => {
    const sql = sqlGd8();
    for (const bang of ["Payment", "Order", "Receipt", "BankTransaction", "PaymentRequest"]) {
      expect(sql, bang).not.toMatch(new RegExp(`ALTER TABLE "${bang}"\\s`));
    }
    expect(sql).not.toMatch(/\bDROP\b/);
    expect(sql).not.toMatch(/CREATE TABLE/);
  });
});

// ─── Hai bảng con chỉ đọc QUA `HoaDonDienTu` đã scope ────────────────────────
// `HoaDonKhoan` / `HoaDonGuiEmail` KHÔNG có centerId ⇒ không nằm trong SCOPED_MODELS; tra thẳng ở tầng
// app là đọc hoá đơn của MỌI cơ sở (lib/db-scope.ts ghi rõ). PLAN §2.2 dựa vào lưới này — trước GĐ 8
// nó chưa hề có (rà tồn đọng 26/09). Hôm nay app/ có 0 chỗ vi phạm.
const MAU_CON = /\.(hoaDonKhoan|hoaDonGuiEmail)\.(find\w*|update\w*|create\w*|delete\w*|count|aggregate|groupBy|upsert)\(/g;

function tepApp(): string[] {
  const goc = resolve(process.cwd(), "app");
  return (readdirSync(goc, { recursive: true }) as string[])
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f))
    .map((f) => resolve(goc, f));
}
const boChuThich = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((d) => !d.trimStart().startsWith("//"))
    .join("\n");

describe("[HDS-05] app/ không tra thẳng bảng con của hoá đơn", () => {
  it("đối chứng: mẫu bắt được một lời gọi cài sẵn", () => {
    expect("await sdb.hoaDonGuiEmail.findMany({})".match(MAU_CON)).toHaveLength(1);
    expect("tx.hoaDonKhoan.updateMany({})".match(MAU_CON)).toHaveLength(1);
  });

  it("0 lời gọi top-level `.hoaDonKhoan.` / `.hoaDonGuiEmail.` trong app/**", () => {
    const viPham: string[] = [];
    for (const f of tepApp()) {
      const m = boChuThich(readFileSync(f, "utf8")).match(MAU_CON);
      if (m) viPham.push(`${f}: ${m.join(", ")}`);
    }
    expect(viPham).toEqual([]);
  });
});
