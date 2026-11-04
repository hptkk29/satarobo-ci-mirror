// @vitest-environment node
/**
 * [NLD-*] `noiLeadChoDonTay` — quyết định nối `Order.leadId` cho đơn lập TAY (O1) trên Postgres THẬT (PR0b, doc 03 §5.4). Bản đầu nằm thẳng trong Server Action nên reviewer cấy được
 * `hocVienIds: []` / «NHIEU ⇒ gắn leadIds[0]» / bỏ cảnh báo mà không ca nào đỏ — nay mọi điều kiện ở một hàm test được.
 *
 *   [NLD-01] chỉ chạy khi: quản lý ∧ form không khai lead ∧ đơn khoá học (ba vế, mỗi vế một đối chứng)
 *   [NLD-02] khách lẻ + SĐT khớp ĐÚNG MỘT lead cùng cơ sở ⇒ gắn
 *   [NLD-03] NHIỀU lead cùng SĐT ⇒ KHÔNG gắn, báo số lead (cảnh báo) — và `leadId` KHÔNG có trong kết quả
 *   [NLD-04] đơn CÓ học viên ⇒ chỉ theo Student.leadId; học viên chưa nối lead mà SĐT khớp một lead ⇒ KHÔNG gắn (ca lỗi HIGH của review)
 *   [NLD-05] cách ly cơ sở: lead cơ sở khác không bị gắn, không bị đếm vào cảnh báo (không lộ «SĐT có ở cơ sở khác»)
 *   [NLD-06] đơn KHÔNG khai cơ sở: người chỉ thấy một cơ sở ⇒ FAIL-CLOSED (chỉ lead chưa có cơ sở); người thấy MỌI cơ sở ⇒ không cách ly (reviewer: `centerIdDon = null` từng tắt cách ly)
 *   [NLD-07] Student.leadId trỏ lead CHƯA convert ⇒ KHÔNG gắn (convert sau đó sẽ gom khoản của học viên này về ghi danh bé khác)
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`; dọn theo tiền tố `NLD_`. Mỗi ca tự dựng hiện trường (luật 18).
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "../../lib/db";
import { noiLeadChoDonTay } from "../../lib/nguon/lead-cho-don-moi-db";
import { RUN_DB_TESTS } from "../_helpers/db-gate";

const P = "NLD_";
const CS1 = `${P}cs1`;
const CS2 = `${P}cs2`;
const SDT = "0977000321";
let seq = 0;

async function don() {
  await db.student.deleteMany({ where: { id: { startsWith: P } } });
  await db.lead.deleteMany({ where: { id: { startsWith: P } } });
  await db.center.deleteMany({ where: { id: { in: [CS1, CS2] } } });
}
const lead = (key: string, phone: string, centerId: string | null = CS1, convertedAt: Date | null = new Date()) => db.lead.create({ data: { id: `${P}l-${key}`, parentName: `PH ${key}`, phone, status: "DA_DANG_KY", centerId, convertedAt } });
const hocVien = async (key: string, leadId: string | null) => {
  const id = `${P}hv-${key}-${(seq += 1)}`;
  await db.student.create({ data: { id, name: `Bé ${key}`, centerId: CS1, leadId } });
  return id;
};
const goi = (over: Partial<Parameters<typeof noiLeadChoDonTay>[0]> = {}) =>
  noiLeadChoDonTay({ canManageAll: true, leadKhaiTrenForm: null, loaiDon: "COURSE", customerPhone: SDT, hocVienIds: [], centerIdDon: CS1, nhinThayMoiCoSo: false, ...over });

describe.skipIf(!RUN_DB_TESTS)("[NLD] nối Order.leadId cho đơn lập tay (Postgres thật)", () => {
  beforeEach(async () => {
    await don();
    await db.center.create({ data: { id: CS1, name: "CS NLD 1", slug: `${P}cs1`, address: "x" } });
    await db.center.create({ data: { id: CS2, name: "CS NLD 2", slug: `${P}cs2`, address: "y" } });
  });
  afterAll(async () => {
    await don();
    await db.$disconnect();
  });

  it("[NLD-01] chỉ chạy khi quản lý ∧ form không khai lead ∧ đơn khoá học — thiếu MỘT vế thì không nối gì, không báo gì (đối chứng dương: đủ ba vế ⇒ nối)", async () => {
    await lead("a", SDT);
    const khong = { leadNoiTuDong: null, canhBaoLead: null };
    expect(await goi({ canManageAll: false })).toEqual(khong); // Sale: đã bị ép lead của mình ở cổng G-A
    expect(await goi({ leadKhaiTrenForm: `${P}l-khac` })).toEqual(khong); // form đã khai ⇒ không đè
    expect(await goi({ loaiDon: "PRODUCT" })).toEqual(khong); // đơn bán lẻ
    expect(await goi()).toEqual({ leadNoiTuDong: { leadId: `${P}l-a`, nguon: "SDT" }, canhBaoLead: null });
  });

  it("[NLD-02] khách lẻ + SĐT (dạng 84…) khớp đúng MỘT lead cùng cơ sở ⇒ gắn", async () => {
    await lead("a", "84977000321");
    expect(await goi()).toEqual({ leadNoiTuDong: { leadId: `${P}l-a`, nguon: "SDT" }, canhBaoLead: null });
  });

  it("[NLD-03] HAI lead cùng SĐT ⇒ KHÔNG gắn (kể cả lead đầu), báo số lead", async () => {
    await lead("a", SDT);
    await lead("b", "84977000321");
    const r = await goi();
    expect(r.leadNoiTuDong).toBeNull();
    expect(r.canhBaoLead).toEqual({ soLead: 2 });
  });

  it("[NLD-04] đơn CÓ học viên ⇒ chỉ theo Student.leadId: học viên nối lead ⇒ gắn; học viên CHƯA nối lead mà SĐT khớp một lead ⇒ KHÔNG gắn (ca lỗi HIGH của review)", async () => {
    await lead("a", SDT);
    const noi = await hocVien("noi", `${P}l-a`);
    expect(await goi({ hocVienIds: [noi], customerPhone: "0900000000" })).toEqual({ leadNoiTuDong: { leadId: `${P}l-a`, nguon: "HOC_VIEN" }, canhBaoLead: null });
    const chuaNoi = await hocVien("chua", null);
    expect(await goi({ hocVienIds: [chuaNoi] })).toEqual({ leadNoiTuDong: null, canhBaoLead: null });
  });

  it("[NLD-05] CÁCH LY CƠ SỞ: lead cơ sở khác không bị gắn và KHÔNG bị đếm vào cảnh báo; đối chứng dương: cùng SĐT ở cơ sở của đơn thì gắn", async () => {
    await lead("khac", SDT, CS2);
    expect(await goi()).toEqual({ leadNoiTuDong: null, canhBaoLead: null });
    await lead("cung", "84977000321", CS1);
    expect(await goi()).toEqual({ leadNoiTuDong: { leadId: `${P}l-cung`, nguon: "SDT" }, canhBaoLead: null }); // KHÔNG thành NHIEU vì lead cơ sở khác
  });

  it("[NLD-06] đơn KHÔNG khai cơ sở: người chỉ thấy MỘT cơ sở ⇒ fail-closed (lead cơ sở nào cũng KHÔNG bị gắn/đếm; lead chưa có cơ sở thì được); người thấy MỌI cơ sở ⇒ không cách ly", async () => {
    await lead("cs2", SDT, CS2);
    const khong = { leadNoiTuDong: null, canhBaoLead: null };
    expect(await goi({ centerIdDon: null })).toEqual(khong);
    expect(await goi({ centerIdDon: null, nhinThayMoiCoSo: true })).toEqual({ leadNoiTuDong: { leadId: `${P}l-cs2`, nguon: "SDT" }, canhBaoLead: null }); // đối chứng dương
    await lead("cs1", "84977000321", CS1);
    expect(await goi({ centerIdDon: null })).toEqual(khong); // hai lead ở hai cơ sở: người hạn chế KHÔNG được biết có «2 lead»
    expect((await goi({ centerIdDon: null, nhinThayMoiCoSo: true })).canhBaoLead).toEqual({ soLead: 2 });
    await lead("chua", "0977000999", null);
    expect(await goi({ centerIdDon: null, customerPhone: "0977000999" })).toEqual({ leadNoiTuDong: { leadId: `${P}l-chua`, nguon: "SDT" }, canhBaoLead: null });
  });

  it("[NLD-07] Student.leadId trỏ lead CHƯA convert ⇒ KHÔNG gắn; đối chứng dương: cùng học viên khi lead đã convert ⇒ gắn", async () => {
    await lead("chuaconvert", SDT, CS1, null);
    const hv = await hocVien("b", `${P}l-chuaconvert`);
    expect(await goi({ hocVienIds: [hv] })).toEqual({ leadNoiTuDong: null, canhBaoLead: null });
    await db.lead.update({ where: { id: `${P}l-chuaconvert` }, data: { convertedAt: new Date() } });
    expect(await goi({ hocVienIds: [hv] })).toEqual({ leadNoiTuDong: { leadId: `${P}l-chuaconvert`, nguon: "HOC_VIEN" }, canhBaoLead: null });
  });
});