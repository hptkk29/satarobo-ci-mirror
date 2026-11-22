// [CGH] — hai luật ghi hồ sơ học viên thêm sau lượt rà đối kháng 25/09/2026.
//
//   · [CGH-01..04] `uuTienTheoCoSoMoi` — đổi cơ sở thì "cơ sở ưu tiên" chỉ dời theo khi nó
//     đang là BẢN SAO của cơ sở cũ (form đã bỏ ô ưu tiên — D3 — nên không còn chỗ sửa).
//   · [CGH-05..06] cổng URL ảnh đại diện ở HAI đường ghi của form (create/update) — trước
//     đây chỉ action đổi ảnh có cổng, nên một POST tay qua form đi vòng được.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { uuTienTheoCoSoMoi } from "./doc-form";
import { laUrlAnhHocVien } from "@/lib/students/anh-dai-dien-url";

describe("[CGH] cơ sở ưu tiên khi đổi cơ sở", () => {
  const truoc = { centerId: "cs1", preferredCenterId: "cs1" };

  it("[CGH-01] ưu tiên là bản sao cơ sở cũ ⇒ dời theo cơ sở mới", () => {
    expect(
      uuTienTheoCoSoMoi({ truoc, centerIdMoi: "cs2", orgUnitIdMoi: "ou2", formGuiUuTien: false }),
    ).toEqual({ preferredCenterId: "cs2", preferredOrgUnitId: "ou2" });
  });

  it("[CGH-02] ưu tiên là lựa chọn THẬT (khác cơ sở cũ) ⇒ giữ nguyên", () => {
    expect(
      uuTienTheoCoSoMoi({
        truoc: { centerId: "cs1", preferredCenterId: "cs3" },
        centerIdMoi: "cs2",
        orgUnitIdMoi: "ou2",
        formGuiUuTien: false,
      }),
    ).toBeNull();
  });

  it("[CGH-03] ưu tiên trống ⇒ không bịa ra ưu tiên (cổng PH tự rơi về cơ sở thật)", () => {
    expect(
      uuTienTheoCoSoMoi({
        truoc: { centerId: "cs1", preferredCenterId: null },
        centerIdMoi: "cs2",
        orgUnitIdMoi: "ou2",
        formGuiUuTien: false,
      }),
    ).toBeNull();
  });

  it("[CGH-04] không đổi cơ sở / form tự gửi ô ưu tiên ⇒ không đụng", () => {
    expect(
      uuTienTheoCoSoMoi({ truoc, centerIdMoi: "cs1", orgUnitIdMoi: "ou1", formGuiUuTien: false }),
    ).toBeNull();
    expect(
      uuTienTheoCoSoMoi({ truoc, centerIdMoi: undefined, orgUnitIdMoi: undefined, formGuiUuTien: false }),
    ).toBeNull();
    expect(
      uuTienTheoCoSoMoi({ truoc, centerIdMoi: "cs2", orgUnitIdMoi: "ou2", formGuiUuTien: true }),
    ).toBeNull();
  });
});

// Lưới ghim mã nguồn (mẫu "LƯỚI GHIM MÃ NGUỒN" ở CLAUDE.md): luật cần khoá là "lời gọi này
// có mặt ở đường ghi", thứ test thuần không chứng minh được. Bỏ chú thích trước khi soi —
// chú thích giải thích bản vá chứa đúng các chuỗi đang tìm.
const ACTIONS = resolve(process.cwd(), "app/(admin)/admin/students/_actions.ts");
const khongChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
function thanHam(ten: string): string {
  const s = khongChuThich(readFileSync(ACTIONS, "utf8"));
  const i = s.indexOf(`export async function ${ten}(`);
  expect(i, ten).toBeGreaterThan(-1);
  const j = s.indexOf("\nexport async function ", i + 1);
  return s.slice(i, j === -1 ? undefined : j);
}

describe("[CGH] cổng URL ảnh đại diện ở đường ghi của form", () => {
  it("[CGH-05] createStudent kiểm URL bằng laUrlAnhHocVien( trước khi tạo", () => {
    const f = thanHam("createStudent");
    const iKiem = f.indexOf("laUrlAnhHocVien(");
    expect(iKiem).toBeGreaterThan(-1);
    expect(iKiem).toBeLessThan(f.indexOf(".student.create("));
  });

  it("[CGH-06] updateStudent bỏ khoá avatarUrl TRƯỚC khi validate", () => {
    const f = thanHam("updateStudent");
    const iBo = f.indexOf("delete raw.avatarUrl");
    expect(iBo).toBeGreaterThan(-1);
    expect(iBo).toBeLessThan(f.indexOf("studentUpdateSchema.safeParse("));
  });

  it("[CGH-07] luật URL: chỉ khuôn do route upload sinh ra", () => {
    const goc = "https://cdn.satarobo.vn";
    const dung = `${goc}/uploads/students/2026-09/1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed.jpg`;
    expect(laUrlAnhHocVien(dung, goc)).toBe(true);
    expect(laUrlAnhHocVien("https://evil.example/p.gif", goc)).toBe(false);
    expect(laUrlAnhHocVien(`${dung}?x=1`, goc)).toBe(false);
    expect(laUrlAnhHocVien(`${goc}.evil.example/uploads/students/2026-09/x.jpg`, goc)).toBe(false);
  });
});
