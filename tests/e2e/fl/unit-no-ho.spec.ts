/**
 * FL2-05 — Bỏ Hội sở khỏi picker/đơn vị nhận học viên (đăng ký học, chuyển cơ sở,
 * hoàn thành khoá). AC theo BA #07 US-LEAD-5 AC3: "Danh sách đơn vị chọn HV không
 * gồm Hội sở (qua OrgUnit tree)".
 *
 * ⚠️ SPEC PHÁC (không nằm trong CI run mặc định của lane). Phần helper thuần assert
 * runnable; luồng UI để fixme khi dựng fixture.
 */
import { test, expect } from "@playwright/test";
import type { OrgUnitType } from "@prisma/client";
import { nonEnrollableCenterIds, notHeadOfficeWhere } from "../../../lib/enrollment-flow";

const ou = (type: OrgUnitType, centerId: string | null) => ({ type, centerId, deletedAt: null });

test.describe("[FL2-05] Bỏ Hội sở khỏi đơn vị nhận học viên", () => {
  // AC3 — "cơ sở nhận HV" = Center CÓ OrgUnit type=CENTER trỏ tới. KHÔNG hardcode "HO".
  // Prod 10/07: Center(hoi-so) mồ côi — seed-orgunit.ts để HO.centerId = null, nên bản cũ
  // (đi từ OrgUnit ra) không bao giờ thấy nó và picker vẫn hiện "Hội sở".
  test("[FL2-05-T1] Center mồ côi (Hội sở) bị loại; CS1/CS2 có OrgUnit CENTER thì giữ", async () => {
    const ids = nonEnrollableCenterIds(
      [{ id: "c-cs1" }, { id: "c-cs2" }, { id: "hoi-so" }],
      [ou("ROOT", null), ou("HO", null), ou("CENTER", "c-cs1"), ou("CENTER", "c-cs2")],
    );
    expect(ids).toEqual(["hoi-so"]);
  });

  // Mở CS mới (CS3/CS4...) chỉ thêm data type=CENTER → tự nhận HV, không sửa code.
  test("[FL2-05-T2] CS mới type=CENTER không bị loại", async () => {
    expect(nonEnrollableCenterIds([{ id: "c-cs3" }], [ou("CENTER", "c-cs3")])).toEqual([]);
  });

  // Where-fragment giữ row centerId=null (legacy), chỉ loại đúng cơ sở Hội sở.
  test("[FL2-05-T3] notHeadOfficeWhere loại HO, giữ centerId null", async () => {
    expect(notHeadOfficeWhere(["c-ho"])).toEqual({
      OR: [{ centerId: null }, { centerId: { notIn: ["c-ho"] } }],
    });
    expect(notHeadOfficeWhere([])).toEqual({});
  });

  // AC3 (UI) — dropdown chọn lớp ở /admin/enrollments/new không có lớp thuộc Hội sở.
  test.fixme("[FL2-05-T4] enrollments/new: picker lớp không gồm cơ sở Hội sở", async () => {
    // TODO(fixture): seed Class@HO + Class@CS1. Mở /admin/enrollments/new bằng SUPER_ADMIN
    // → assert <select> lớp KHÔNG có option centerName "Hội sở".
  });

  // AC3 (UI) — picker cơ sở (nguồn & đích) ở /admin/chuyen-lop không gồm Hội sở.
  // Lõi quyết định đã khoá ở T1 (Center mồ côi bị loại) + T3 (where-fragment). Phần UI
  // còn lại chỉ là truyền `id: { notIn: ids }` vào sdb.center.findMany.
  test.fixme("[FL2-05-T5] chuyen-lop: picker cơ sở không gồm Hội sở", async () => {
    // TODO(fixture): mở /admin/chuyen-lop → assert option "Hội sở" vắng ở cả 2 select cơ sở.
  });
});
