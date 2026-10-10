// prisma/seed-cham-cong.ts — SEED NỀN module chấm công v3 (chạy 1 lần, idempotent).
//
//   pnpm db:seed:cham-cong            # tạo dòng còn thiếu, KHÔNG đè dòng đã có
//   pnpm db:seed:cham-cong -- --force # ĐÈ mọi dòng danh mục về bản trong mã nguồn
//
// GHI 5 NHÓM (cập nhật 07/09/2026 — bản 06/09 chỉ có 3, xem `docs/luat-mo-ta-workflow-prod.md`):
//   1. ShiftTemplate       — 21 mã ca dùng chung (centerId = null)
//   2. LeaveType           — 8 loại nghỉ (K-06 theo MISA)
//   3. WorkLocation        — 1 điểm chấm công cho mỗi cơ sở vận hành (Hội sở KHÔNG có — Q-04)
//   4. SessionCategory     — 7 phân loại buổi (SR.QD.230 PL03 §4)
//   5. TeachingCreditType  — 6 loại công dạy (nguồn × vai)
//
// Sau lần seed đầu, NGUỒN SỰ THẬT là DB và người vận hành sửa trên màn danh mục (PHẦN 6b): không
// có `--force` thì KHÔNG đè cột người dùng đã sửa. Toạ độ WorkLocation để trống → geofence tắt
// (Q-02). Trên PROD chạy qua workflow GitHub `Chấm công · PROD · GHI (seed danh mục nền)`.
//
// TỰ KHAI PHẠM VI TRƯỚC KHI GHI: script in bảng "sẽ tạo / sẽ đè" cho từng nhóm rồi mới ghi dòng
// đầu tiên. Đó là cách người bấm nút thấy được thực tế thay vì tin vào một dòng mô tả có thể đã cũ.
import { PrismaClient } from "@prisma/client";
import {
  khaoSatPhamVi,
  seedLeaveTypes,
  seedSessionCategories,
  seedShiftTemplates,
  seedTeachingCreditTypes,
  seedWorkLocations,
} from "../lib/cham-cong/seed-core";

const force = process.argv.includes("--force");
const db = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL ?? process.env.DATABASE_URL });

async function main() {
  // ── 1. NÓI TRƯỚC sẽ ghi gì, rồi mới ghi ───────────────────────────────────────────────
  const phamVi = await khaoSatPhamVi(db, { force });
  console.log(`[seed-cham-cong] PHẠM VI SẼ GHI · chế độ: ${force ? "--force (ĐÈ dòng đã có)" : "thường (chỉ tạo dòng còn thiếu)"}`);
  console.log(`  ${"NHÓM".padEnd(36)} ${"ĐANG CÓ".padStart(8)} ${"SẼ TẠO".padStart(8)} ${"SẼ ĐÈ".padStart(8)}`);
  for (const p of phamVi) {
    console.log(`  ${p.nhom.padEnd(36)} ${String(p.daCo).padStart(8)} ${String(p.seTao).padStart(8)} ${String(p.seDe).padStart(8)}`);
  }
  const tongTao = phamVi.reduce((s, p) => s + p.seTao, 0);
  const tongDe = phamVi.reduce((s, p) => s + p.seDe, 0);
  console.log(`  ${"TỔNG".padEnd(36)} ${"".padStart(8)} ${String(tongTao).padStart(8)} ${String(tongDe).padStart(8)}`);
  if (tongTao === 0 && tongDe === 0) {
    console.log("[seed-cham-cong] Không có gì để ghi — mọi dòng danh mục đã có.");
  }

  // ── 2. Ghi ────────────────────────────────────────────────────────────────────────────
  const t = await seedShiftTemplates(db, { force });
  const l = await seedLeaveTypes(db, { force });
  const w = await seedWorkLocations(db);
  // Phân loại buổi TRƯỚC danh mục công dạy — FK là Restrict, xem chú thích ở seed-core.
  const pl = await seedSessionCategories(db, { force });
  const c = await seedTeachingCreditTypes(db, { force });

  console.log(
    `[seed-cham-cong] ĐÃ GHI · ShiftTemplate: +${t.created} tạo, ${t.updated} đè · LeaveType: ${l} · WorkLocation: +${w} · SessionCategory: ${pl.ghi} · TeachingCreditType: ${c}`,
  );
  if (pl.nhuongMacDinh > 0) {
    console.log(
      `[seed-cham-cong] ⚠️ ${pl.nhuongMacDinh} phân loại buổi KHÔNG được đặt làm mặc định vì người vận\n` +
        "        hành đã chọn dòng mặc định khác. Không đè lựa chọn của họ ở lần bấm thường —\n" +
        "        muốn ép về bản trong mã nguồn thì chạy lại với --force.",
    );
  }
}

main()
  .catch((e) => {
    console.error("[seed-cham-cong] lỗi:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
