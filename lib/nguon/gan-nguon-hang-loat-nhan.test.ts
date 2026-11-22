// @vitest-environment node
/**
 * [GHN-N-*] phần THUẦN của «gán nguồn hàng loạt» (`gan-nguon-hang-loat-nhan.ts`) + LƯỚI GHIM MÃ NGUỒN cho phần ghi (`gan-nguon-hang-loat.ts`).
 *
 *   [GHN-N-01] `congDonLo` cộng đủ mọi bộ đếm, giữ câu lỗi ĐẦU TIÊN, lấy con trỏ/hết-lead của lô SAU
 *   [GHN-N-02] lý do: < 10 ký tự sau trim ⇒ có câu lỗi; đủ ⇒ null
 *   [GHN-N-03] phần ghi KHÔNG tự viết luật ghi: mọi lead đi qua `doiNguonLead` (không gọi `doiNguon`/`tx.leadAttribution`); lead đọc qua `scopedDb` + `whereHangCho`, và danh sách id từ trình duyệt CHỈ ĐƯỢC GIAO với hàng chờ (`whereHangCho(null, …)`) — không bao giờ là phạm vi tự thân; có cổng «đã có tiền» TRƯỚC `doiNguonLead`
 *   [GHN-N-05] trang: ô tick (`coTheChon`) chỉ khi người xem có ĐÚNG khoá của action (`scope.has("sources:manage")`) ∧ còn nguồn gán chung được; chỉ bọc `ChonLeadProvider` khi `coTheChon`; bảng nhận cờ ấy
 *   [GHN-N-04] action gác `sources:manage` + cờ module ở đầu hàm; danh sách id có TRẦN số lượng (`.max(TOI_DA_ID_GAN)`) và không tự `revalidatePath`
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LO_RONG, congDonLo, kiemLyDoGanHangLoat, type KetQuaLoGanHangLoat } from "./gan-nguon-hang-loat-nhan";

const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

describe("phần thuần", () => {
  it("[GHN-N-01] congDonLo", () => {
    const a: KetQuaLoGanHangLoat = { daDoi: 20, boQuaCoTien: 3, boQuaKhoa: 1, boQuaCungNguon: 2, boQuaVuaDoi: 0, khongDoiDuoc: 1, loiDauTien: "lỗi một", daQuet: 25, conTro: "c1", hetLead: false };
    const b: KetQuaLoGanHangLoat = { daDoi: 4, boQuaCoTien: 1, boQuaKhoa: 0, boQuaCungNguon: 5, boQuaVuaDoi: 2, khongDoiDuoc: 1, loiDauTien: "lỗi hai", daQuet: 8, conTro: "c2", hetLead: true };
    expect(congDonLo(a, b)).toEqual({ daDoi: 24, boQuaCoTien: 4, boQuaKhoa: 1, boQuaCungNguon: 7, boQuaVuaDoi: 2, khongDoiDuoc: 2, loiDauTien: "lỗi một", daQuet: 33, conTro: "c2", hetLead: true });
    expect(congDonLo(LO_RONG, a)).toEqual({ ...a, conTro: "c1" });
    // Lô sau không có con trỏ (rỗng) ⇒ giữ con trỏ cũ.
    expect(congDonLo(a, { ...LO_RONG, hetLead: true }).conTro).toBe("c1");
  });

  it("[GHN-N-02] kiemLyDoGanHangLoat", () => {
    expect(kiemLyDoGanHangLoat(null)).toMatch(/tối thiểu 10/);
    expect(kiemLyDoGanHangLoat("         x      ")).toMatch(/tối thiểu 10/);
    expect(kiemLyDoGanHangLoat("  đủ mười ký tự  ")).toBeNull();
  });
});

describe("lưới ghim mã nguồn", () => {
  const ghi = doc("lib/nguon/gan-nguon-hang-loat.ts");

  it("[GHN-N-03] đường ghi duy nhất là doiNguonLead; lead do máy chủ chọn; cổng đã-có-tiền đứng TRƯỚC lời gọi ghi", () => {
    expect((ghi.match(/\bdoiNguonLead\(/g) ?? []).length, "đúng MỘT lời gọi ghi").toBe(1);
    expect(ghi).not.toMatch(/\bdoiNguon\(/); // hàm ghi thô cần thẻ ghi nguồn — không được gọi vòng qua cổng quyền
    expect(ghi).not.toMatch(/\.leadAttribution\.(update|updateMany|create|upsert|delete)/);
    expect(ghi).toMatch(/scopedDb\(p\.actor\)\.lead\.findMany/);
    // Phạm vi `ids` = GIAO với hàng chờ MỌI vấn đề của người bấm; phạm vi `loc` = đúng bộ lọc. Không có đường nào đọc lead mà không qua `whereHangCho`.
    expect((ghi.match(/\bwhereHangCho\(/g) ?? []).length, "đúng hai nơi dựng where").toBe(2);
    expect(ghi).toMatch(/whereHangCho\(null,\s*p\.coSoId\)\s*,\s*\{\s*id:\s*\{\s*in:\s*p\.pham\.ids\s*\}\s*\}/);
    expect(ghi).not.toMatch(/where:\s*\{\s*id:\s*\{\s*in:/); // id trần không qua hàng chờ = đường «đổi mọi lead đoán được id»
    const cong = ghi.indexOf("coDauVaoTaiChinh(await docDauVaoTaiChinh(");
    const doi = ghi.indexOf("doiNguonLead({");
    expect(cong, "thiếu cổng đã-có-tiền").toBeGreaterThan(-1);
    expect(doi).toBeGreaterThan(cong);
    // Cổng khoá nguồn cũng đứng trước.
    expect(ghi.indexOf("nguonDangKhoa(a.signals)")).toBeGreaterThan(-1);
    expect(ghi.indexOf("nguonDangKhoa(a.signals)")).toBeLessThan(doi);
  });

  it("[GHN-N-04] action: gác quyền + cờ ở đầu hàm, không nhận id lead", () => {
    const act = doc("app/(admin)/admin/nguon-hoa-hong/nguon/_actions-gan-hang-loat.ts");
    expect(act).toMatch(/checkPermission\("sources:manage"\)/);
    expect(act.indexOf('checkPermission("sources:manage")')).toBeLessThan(act.indexOf("safeParse"));
    expect(act).toMatch(/laQuanLyNguonBat\(\)/);
    expect(act).toMatch(/\.max\(TOI_DA_ID_GAN\)/); // danh sách id có trần (độ dài yêu cầu); phần «chỉ thu hẹp» do lib đảm nhiệm — xem GHN-N-03
    expect(act).not.toMatch(/revalidatePath/); // làm mới giữa các lô gỡ hộp thoại đang chạy
  });
  it("[GHN-N-05] trang: ô tick chỉ khi có đúng khoá của action; provider chỉ khi coTheChon; bảng nhận cờ", () => {
    const trang = doc("app/(admin)/admin/nguon-hoa-hong/nguon/page.tsx");
    // Khoá để VẼ ô tick = khoá mà action KIỂM (luật 12): cùng chuỗi `sources:manage`, và có điều kiện còn nguồn để gán.
    expect(trang).toMatch(/const nguonHangLoat = ds\.tong > 0 && scope\.has\("sources:manage"\) \? await docNguonChoHangLoat\(now\) : \[\];/);
    expect(trang).toMatch(/const coTheChon = nguonHangLoat\.length > 0;/);
    expect((trang.match(/coTheChon=\{coTheChon\}/g) ?? []).length, "bảng phải nhận đúng cờ").toBe(1);
    expect((trang.match(/<ChonLeadProvider\b/g) ?? []).length).toBe(1);
    expect(trang).toMatch(/\) : coTheChon \? \(\s*(?:\/\/[^\n]*\n\s*)*<ChonLeadProvider/); // provider nằm trong nhánh coTheChon, không bọc vô điều kiện
    expect(trang).not.toMatch(/coTheChon=\{true\}/);
    // Không còn đường «chỉ khi lọc Chưa rõ nguồn»: gán hàng loạt dùng ở MỌI bộ lọc (chủ dự án 05/11/2026).
    expect(trang).not.toMatch(/lyDo === "UNKNOWN" &&/);
    const bang = doc("app/(admin)/admin/nguon-hoa-hong/nguon/_components/hang-cho-bang.tsx");
    expect((bang.match(/\{coTheChon && \(/g) ?? []).length, "hai chỗ vẽ ô tick (đầu bảng + mỗi dòng) đều sau cờ").toBe(2);
  });});
