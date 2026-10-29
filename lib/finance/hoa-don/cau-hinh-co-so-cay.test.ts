// Ca [CHY-*] — pháp nhân của cơ sở theo CÂY TỔ CHỨC: chọn cơ sở ⇒ tự chọn đúng pháp nhân phát hành (khớp MST).
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  center: vi.fn(),
  orgUnit: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: { center: { findUnique: h.center }, orgUnit: { findUnique: h.orgUnit } } }));
vi.mock("@/lib/db-scope", () => ({ scopedDb: vi.fn() }));
vi.mock("@/lib/audit/write-audit", () => ({ writeAudit: vi.fn() }));

import { phapNhanTheoCayToChuc } from "./cau-hinh-co-so";
import { docPhapNhanCuaCayToChuc } from "./cau-hinh-co-so-db";
import { CAU_HINH_HOA_DON_MAC_DINH } from "./phap-nhan";

const DS = CAU_HINH_HOA_DON_MAC_DINH.phapNhan;

describe("[CHY-01] so khớp pháp nhân của Cây tổ chức với danh sách phát hành hoá đơn (theo MST)", () => {
  it("CS1 gắn STEM ROBOTICS & AI ⇒ tự chọn STEM_ROBOTICS_AI; CS2 gắn New Vision ⇒ NEW_VISION; HO/Sata Robo ⇒ SATA_ROBO", () => {
    expect(phapNhanTheoCayToChuc({ taxCode: "0402341056", legalName: "x" }, DS)).toMatchObject({ loai: "KHOP", ma: "STEM_ROBOTICS_AI" });
    expect(phapNhanTheoCayToChuc({ taxCode: "0402341070", legalName: "x" }, DS)).toMatchObject({ loai: "KHOP", ma: "NEW_VISION" });
    expect(phapNhanTheoCayToChuc({ taxCode: "0402301783", legalName: "x" }, DS)).toMatchObject({ loai: "KHOP", ma: "SATA_ROBO" });
  });
  it("khớp theo MST, KHÔNG theo tên: tên giống mà MST khác ⇒ không khớp", () => {
    const r = phapNhanTheoCayToChuc({ taxCode: "0999999999", legalName: "CÔNG TY CỔ PHẦN CÔNG NGHỆ GIÁO DỤC NEW VISION" }, DS);
    expect(r).toMatchObject({ loai: "KHONG_CO_TRONG_DANH_SACH", maSoThue: "0999999999" });
  });
  it("MST ghi có khoảng trắng vẫn khớp; pháp nhân đang TẮT trong danh sách thì không khớp", () => {
    expect(phapNhanTheoCayToChuc({ taxCode: " 0402341056 ", legalName: "x" }, DS)).toMatchObject({ loai: "KHOP" });
    const tat = DS.map((p) => (p.ma === "NEW_VISION" ? { ...p, bat: false } : p));
    expect(phapNhanTheoCayToChuc({ taxCode: "0402341070", legalName: "x" }, tat)).toMatchObject({ loai: "KHONG_CO_TRONG_DANH_SACH" });
  });
  it("cây chưa gắn pháp nhân ⇒ CHUA_GAN (không đoán)", () => {
    expect(phapNhanTheoCayToChuc(null, DS)).toEqual({ loai: "CHUA_GAN" });
  });
});

describe("[CHY-02] đọc pháp nhân của cơ sở từ Cây tổ chức", () => {
  beforeEach(() => {
    h.center.mockReset();
    h.orgUnit.mockReset();
  });
  it("tra OrgUnit theo ĐÚNG mã cơ sở, trả MST + tên của pháp nhân gắn trên đơn vị đó", async () => {
    h.center.mockResolvedValue({ code: "CS1" });
    h.orgUnit.mockResolvedValue({ legalEntity: { taxCode: "0402341056", legalName: "STEM", deletedAt: null } });
    expect(await docPhapNhanCuaCayToChuc("cs1-id")).toEqual({ taxCode: "0402341056", legalName: "STEM" });
    expect(h.orgUnit).toHaveBeenCalledWith(expect.objectContaining({ where: { code: "CS1" } }));
  });
  it("cơ sở không có mã / không có đơn vị / chưa gắn pháp nhân / pháp nhân đã xoá mềm ⇒ null", async () => {
    h.center.mockResolvedValue({ code: null });
    expect(await docPhapNhanCuaCayToChuc("a")).toBeNull();
    h.center.mockResolvedValue({ code: "CS9" });
    h.orgUnit.mockResolvedValue(null);
    expect(await docPhapNhanCuaCayToChuc("a")).toBeNull();
    h.orgUnit.mockResolvedValue({ legalEntity: null });
    expect(await docPhapNhanCuaCayToChuc("a")).toBeNull();
    h.orgUnit.mockResolvedValue({ legalEntity: { taxCode: "0402341056", legalName: "x", deletedAt: new Date() } });
    expect(await docPhapNhanCuaCayToChuc("a")).toBeNull();
  });
});
