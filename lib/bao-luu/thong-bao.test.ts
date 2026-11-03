// lib/bao-luu/thong-bao.test.ts — LƯỚI GHIM MÃ NGUỒN: người nhận chuông bảo lưu chọn theo QUYỀN, không theo vai cũ. [BLC-W*]
//
// Luật cần khoá có dạng "lời gọi này phải đi qua hàm kia" — test thuần không chứng minh được (thứ cần kiểm là nguồn người nhận, nằm sau DB). Hành vi thật được
// khoá ở `tests/finance/bao-luu-chuong.test.ts` ([BLC-01..04], Postgres thật); lưới này canh việc ai đó đưa `quanLyCoSo` / `User.role` quay lại.
// Sự cố 12/10/2026: chuông "chờ duyệt" tới "UAT — Giáo vụ CS1" (vai cũ CENTER_MANAGER, vai RBAC Giáo vụ).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ACTION_REGISTRY } from "@/lib/auth/action-registry";

/** Bỏ chú thích khối + dòng: chú thích giải thích bản vá hay chứa đúng chuỗi đang cấm (luật 11). */
const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const MA = boChuThich(doc("lib/bao-luu/thong-bao.ts"));

describe("[BLC-W] chuông bảo lưu — nguồn người nhận (neo mã nguồn)", () => {
  it("[BLC-W1] thong-bao.ts KHÔNG import / gọi `quanLyCoSo`, KHÔNG chọn người theo `User.role(s)` / CENTER_MANAGER", () => {
    expect(MA).not.toMatch(/quanLyCoSo/);
    expect(MA).not.toMatch(/CENTER_MANAGER/);
    expect(MA).not.toMatch(/\broles\s*:/);
    expect(MA).not.toMatch(/\bhasSome\b|\bhas\s*:/);
  });

  it("[BLC-W2] ba chỗ chọn người nhận (chờ duyệt · mọi chuông cron/vòng đời · gia hạn chờ duyệt) đều đi qua `nguoiGiuQuyenBaoLuu(`, đúng 3 lời gọi", () => {
    const loiGoi = MA.match(/(?:await\s+|\?\s*)nguoiGiuQuyenBaoLuu\(/g) ?? [];
    expect(loiGoi).toHaveLength(3);
    expect(MA).toMatch(/nguoiGiuQuyenBaoLuu\(hs\.centerId,\s*QUYEN_CHUONG\.choDuyet\)/);
    expect(MA).toMatch(/nguoiGiuQuyenBaoLuu\(hs\.centerId,\s*QUYEN_CHUONG\.giaHanChoDuyet\)/);
    expect(MA).toMatch(/nguoiGiuQuyenBaoLuu\(hs\.centerId,\s*QUYEN_CHUONG\[/);
  });

  it("[BLC-W3] `nguoiGiuQuyenBaoLuu` đi qua bộ phân giải quyền theo cơ sở VÀ lọc tài khoản khoá / đã xoá", () => {
    expect(MA).toMatch(/nguoiGiuQuyenTaiCoSo\(centerId,\s*actions\)/);
    expect(MA).toMatch(/isActive:\s*true,\s*deletedAt:\s*null/);
  });

  it("[BLC-W4] mọi quyền trong `QUYEN_CHUONG` là hành động CÓ THẬT trong registry (chuỗi gõ sai ⇒ không ai giữ ⇒ chuông rỗng, câm)", () => {
    const khoi = doc("lib/bao-luu/thong-bao.ts").match(/export const QUYEN_CHUONG = \{([\s\S]*?)\} as const/);
    expect(khoi, "không tìm thấy khai báo QUYEN_CHUONG").not.toBeNull();
    const quyen = [...boChuThich(khoi![1]).matchAll(/"(bao-luu:[a-z-]+)"/g)].map((m) => m[1]);
    expect(quyen.length).toBeGreaterThanOrEqual(7);
    for (const q of quyen) expect(ACTION_REGISTRY, `${q} không có trong ACTION_REGISTRY`).toContain(q);
  });

  it("[BLC-W5] không tệp nào khác của module bảo lưu (lib/bao-luu · app/(admin)/admin/bao-luu · cron) tự chọn người nhận bằng `quanLyCoSo`", () => {
    const tep = [
      "lib/bao-luu/cron-chay.ts",
      "lib/bao-luu/vong-doi.ts",
      "lib/bao-luu/dich-vu.ts",
      "lib/bao-luu/tam-dung-lop.ts",
      "lib/bao-luu/yeu-cau-hoan.ts",
      "app/(admin)/admin/bao-luu/_actions.ts",
    ];
    for (const t of tep) expect(boChuThich(doc(t)), `${t} dùng quanLyCoSo`).not.toMatch(/quanLyCoSo/);
  });
});
