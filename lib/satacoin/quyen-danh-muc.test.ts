import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { PERMISSIONS } from "@/lib/auth/permissions";

/**
 * Chủ dự án chốt 19/11/2026: danh mục quà SataCoin TOÀN CỤC (tên/giá/bật-tắt) chỉ quản trị cấp hệ thống tạo/sửa;
 * QLCS chỉ xử lý yêu cầu + tồn kho cơ sở mình. Ba tầng phải cùng đọc một điều: ma trận v1 · seed RBAC v2 · cổng action.
 */
describe("[QDM] quyền danh mục quà SataCoin", () => {
  it("[QDM-01] ma trận v1: catalog & quota chỉ SUPER_ADMIN; redeem có QLCS (đối chứng dương)", () => {
    expect(PERMISSIONS["satacoin:catalog"]).toEqual(["SUPER_ADMIN"]);
    expect(PERMISSIONS["satacoin:quota"]).toEqual(["SUPER_ADMIN"]);
    expect(PERMISSIONS["satacoin:redeem"]).toContain("CENTER_MANAGER");
  });

  it("[QDM-02] seed RBAC v2 KHÔNG cấp satacoin:catalog cho vai nào (chỉ SUPER_ADMIN bypass); vẫn cấp redeem", () => {
    const seed = readFileSync(resolve(process.cwd(), "prisma/seed-roles.ts"), "utf8");
    const code = seed.replace(/\/\/[^\n]*/g, "");
    expect(code).not.toMatch(/action:\s*"satacoin:catalog"/);
    expect(code).not.toMatch(/action:\s*"satacoin:quota"/);
    expect(code).toMatch(/action:\s*"satacoin:redeem"/);
  });

  it("[QDM-03] luuQuaAction gác bằng satacoin:catalog; hai action còn lại của QLCS vẫn gác bằng redeem", () => {
    const src = readFileSync(resolve(process.cwd(), "app/(admin)/admin/satacoin/doi-qua/_actions.ts"), "utf8").replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const thanLuu = src.slice(src.indexOf("export async function luuQuaAction"), src.indexOf("const tonSchema"));
    expect(thanLuu).toContain('cong(session, "satacoin:catalog")');
    expect(thanLuu).not.toContain('"satacoin:redeem"');
    const thanTon = src.slice(src.indexOf("export async function dieuChinhTonKhoAction"), src.indexOf("const hanMucSchema"));
    expect(thanTon).toContain('cong(session, "satacoin:redeem")');
    expect(thanTon).toContain('passesScope("SataCoinGiftStock"');
  });
});
