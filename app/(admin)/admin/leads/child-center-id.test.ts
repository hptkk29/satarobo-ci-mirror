// @vitest-environment node
/**
 * V-4 · G-01b — "Cơ sở quan tâm" của một con (LeadChild): GHI LOẠI MÃ NÀO THÌ
 * ĐỌC RA LOẠI MÃ ĐÓ.
 *
 * Lỗi thật đang có — hai đường ghi cùng một ô, bằng hai loại mã khác nhau:
 *
 *   · màn CHI TIẾT lead (`[id]/page.tsx`) nạp `sdb.center.findMany({select:{id,name}})`
 *     ⇒ `<option value>` là **Center.id**;
 *   · màn SỬA lead (`[id]/edit/page.tsx`) nạp `getSelectableOrgUnits()` rồi map
 *     `({ id: o.orgUnitId })` ⇒ `<option value>` là **OrgUnit.id**;
 *   · biểu mẫu TẠO lead (`lead-form.tsx`) đưa thẳng `orgUnits` xuống `ChildFields`
 *     ⇒ cũng là **OrgUnit.id**.
 *
 * `OrgUnit.id` và `Center.id` là hai cuid KHÁC NHAU (`OrgUnit.centerId` là FK
 * @unique trỏ sang Center), nên giá trị lưu từ màn sửa/tạo không khớp bất cứ
 * `Center.id` nào. Hậu quả nhìn thấy được:
 *
 *   (a) ra màn chi tiết, `centerName(c.interestedCenterId)` tra trong danh sách
 *       Center → không thấy → dòng tóm tắt của con MẤT HẲN tên cơ sở, im lặng;
 *   (b) ngược chiều: con do luồng nhận lead ngoài (`lib/lead/intake/ingest.ts`)
 *       hay bản nhập Excel (`lib/lead/import-registered.ts`) tạo ra đang giữ
 *       Center.id — mở màn SỬA thì `<select>` không khớp option nào, tụt về
 *       "— Chưa chọn —", và người dùng bấm Lưu là XOÁ TRẮNG cơ sở đúng.
 *
 * Vì sao chuẩn là Center.id chứ không phải OrgUnit.id: `prisma/schema.prisma`
 * ghi rõ `interestedCenterId // tham chiếu Center`; cả hai đường ghi tự động
 * (ingest + import) đều ghi Center.id; và đây KHÔNG phải cột phạm vi của chính
 * bản ghi (LeadChild không có `centerId`/`orgUnitId` riêng) nên luật "bảng cũ
 * ghi kép centerId + orgUnitId" không áp vào đây. Đổi chuẩn sang OrgUnit.id sẽ
 * phải viết lại dữ liệu đang có trên prod — đúng thứ luật cứng #4 cấm.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";

import { leadChildCenterOptions } from "@/lib/lead/child-center-options";

/** Hình dữ liệu thật `getSelectableOrgUnits()` trả về (lib/org/org-tree.ts:150). */
const DON_VI = [
  {
    orgUnitId: "ou_cs1",
    code: "CS1",
    name: "Trụ sở chính - Nguyễn Hữu Thọ",
    type: "CENTER" as const,
    centerId: "center_cs1",
  },
  {
    orgUnitId: "ou_cs2",
    code: "CS2",
    name: "Cơ sở 2 - Hoàng Diệu",
    type: "CENTER" as const,
    centerId: "center_cs2",
  },
];

describe("[V-4 G-01b] leadChildCenterOptions — option của ô 'Cơ sở quan tâm'", () => {
  it("value là Center.id, KHÔNG phải OrgUnit.id", () => {
    const opts = leadChildCenterOptions(DON_VI);

    expect(opts.map((o) => o.id)).toEqual(["center_cs1", "center_cs2"]);
    // Canh thẳng vào cái đã sai: không một OrgUnit.id nào được lọt ra làm value.
    expect(opts.map((o) => o.id)).not.toContain("ou_cs1");
    expect(opts.map((o) => o.id)).not.toContain("ou_cs2");
  });

  it("giữ nguyên tên hiển thị đã chuẩn hoá theo Center.name", () => {
    // `getSelectableOrgUnits` đã đổi OrgUnit.name generic ("Cơ sở 1") sang
    // Center.name — đừng làm hỏng công đó bằng cách map lại từ nguồn khác.
    expect(leadChildCenterOptions(DON_VI).map((o) => o.name)).toEqual([
      "Trụ sở chính - Nguyễn Hữu Thọ",
      "Cơ sở 2 - Hoàng Diệu",
    ]);
  });

  it("bỏ đơn vị không có Center (HO/REGION) — không đẻ option value rỗng", () => {
    // Ô này trỏ sang bảng Center; HO/REGION không có bản ghi Center nào để trỏ.
    // Lọt ra là dựng một option `value=""` trùng hệt mục "— Chưa chọn —".
    const opts = leadChildCenterOptions([
      { orgUnitId: "ou_ho", code: "HO", name: "Hội sở", type: "HO" as const, centerId: null },
      ...DON_VI,
    ]);

    expect(opts).toHaveLength(2);
    expect(opts.every((o) => o.id.length > 0)).toBe(true);
  });

  it("giữ thứ tự đã sắp của nguồn (người dùng quen vị trí cơ sở trong danh sách)", () => {
    const dao = leadChildCenterOptions([DON_VI[1], DON_VI[0]]);
    expect(dao.map((o) => o.id)).toEqual(["center_cs2", "center_cs1"]);
  });

  it("hai OrgUnit cùng trỏ 1 Center → chỉ 1 option (không nhân đôi dòng)", () => {
    const opts = leadChildCenterOptions([
      DON_VI[0],
      { ...DON_VI[0], orgUnitId: "ou_cs1_cu", code: "CS1_CU" },
    ]);
    expect(opts).toHaveLength(1);
  });

  it("danh sách rỗng → mảng rỗng, không ném", () => {
    expect(leadChildCenterOptions([])).toEqual([]);
  });
});

describe("[V-4 G-01b] chốt chặn nguồn — 3 màn phải cùng một loại mã", () => {
  const doc = (p: string) => fs.readFileSync(p, "utf8");
  const SUA = "app/(admin)/admin/leads/[id]/edit/page.tsx";
  const TAO = "app/(admin)/admin/leads/new/page.tsx";
  const CHI_TIET = "app/(admin)/admin/leads/[id]/page.tsx";
  const FORM = "app/(admin)/admin/leads/_components/lead-form.tsx";

  /** Đoạn `centers={...}` đang truyền cho khối con ở một tệp. */
  const propCenters = (src: string) =>
    [...src.matchAll(/centers=\{([^}]*(?:\}[^}]*)*?)\}\s*\n/g)].map((m) => m[1]);

  it("màn SỬA: `centers` của khối con đi qua helper, không map orgUnitId nữa", () => {
    const src = doc(SUA);
    expect(src).toContain("leadChildCenterOptions");
    // Đây là dòng hỏng: `centers={orgUnits.map((o) => ({ id: o.orgUnitId, ... }))}`.
    // `orgUnits` vẫn được dùng cho ô "Đơn vị" của LEAD (đúng là OrgUnit.id) —
    // nên chỉ cấm đúng cái mảnh đưa orgUnitId vào prop `centers`.
    for (const gt of propCenters(src)) expect(gt).not.toContain("orgUnitId");
  });

  // 03/09/2026 — màn TẠO cũ (`/leads/new`) ĐÃ GỠ, chuyển hẳn sang `/nhap-khach-hang`
  // (chủ dự án chốt; biểu mẫu cũ dựng lead bằng `db.lead.create` trần, không đi qua
  // `ingestIntakeLead` nên thiếu chống trùng SĐT, tra cơ sở và tự chia cho sale).
  // Ca này nay khoá đúng điều đó: màn cũ phải là một trang CHUYỂN HƯỚNG, không được
  // ai dựng lại biểu mẫu ở đấy.
  it("màn TẠO cũ đã gỡ — chỉ còn chuyển hướng, không dựng lại biểu mẫu", () => {
    const src = doc(TAO);
    expect(src).toContain("redirect");
    expect(src).not.toMatch(/centers=\{/);
  });

  it("biểu mẫu lead: `ChildFields` KHÔNG còn nhận thẳng `orgUnits`", () => {
    const src = doc(FORM);
    const i = src.indexOf("<ChildFields");
    expect(i).toBeGreaterThan(-1);
    expect(src.slice(i, i + 300)).not.toContain("centers={orgUnits}");
  });

  it("màn CHI TIẾT (bên ĐỌC) vẫn lấy option từ bảng Center — đừng đổi chuẩn ở đây", () => {
    // Nếu ai đó "vá" bằng cách đổi bên đọc sang OrgUnit thì toàn bộ dữ liệu do
    // ingest/import ghi (Center.id) sẽ mất hiển thị — đảo ngược đúng lỗi này.
    const src = doc(CHI_TIET);
    const i = src.indexOf("const [childCenters");
    expect(i).toBeGreaterThan(-1);
    expect(src.slice(i, i + 300)).toContain("sdb.center.findMany");
  });

  it("chuẩn của cột vẫn là 'tham chiếu Center' trong schema", () => {
    const schema = doc("prisma/schema.prisma");
    const i = schema.indexOf("model LeadChild");
    expect(i).toBeGreaterThan(-1);
    expect(schema.slice(i, i + 1200)).toMatch(/interestedCenterId\s+String\?\s*\/\/ tham chiếu Center/);
  });
});
