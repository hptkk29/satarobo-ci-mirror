// [BBP-*] Bắt buộc phòng cho học bù / Trial (chốt lượt 2 điểm 1, 27/10/2026). Thuần.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LOI_GO_PHONG, LOI_THIEU_PHONG, lyDoThieuPhong } from "./bat-buoc-phong";

describe("[BBP] lyDoThieuPhong", () => {
  it("[BBP-01] bản ghi MỚI thiếu phòng ⇒ chặn; có phòng ⇒ qua (đối chứng)", () => {
    expect(lyDoThieuPhong({ taoMoi: true, phongTruoc: null, phongSau: null })).toBe(LOI_THIEU_PHONG);
    expect(lyDoThieuPhong({ taoMoi: true, phongTruoc: null, phongSau: "P1" })).toBeNull();
  });
  it("[BBP-02] bản ghi đã có phòng gỡ về trống ⇒ chặn; đổi sang phòng khác ⇒ qua", () => {
    expect(lyDoThieuPhong({ taoMoi: false, phongTruoc: "P1", phongSau: null })).toBe(LOI_GO_PHONG);
    expect(lyDoThieuPhong({ taoMoi: false, phongTruoc: "P1", phongSau: "P2" })).toBeNull();
  });
  it("[BBP-03] bản ghi CŨ thiếu phòng sửa mà vẫn thiếu ⇒ CHO QUA (chỉ cờ vàng trên màn Phân công)", () => {
    expect(lyDoThieuPhong({ taoMoi: false, phongTruoc: null, phongSau: null })).toBeNull();
  });
});

// Lưới ghim DÂY NỐI: cổng phải có ở MỌI đường ghi phòng của học bù / Trial, và đứng TRƯỚC phép ghi. Mã TRƯỚC bản vá: không đường nào
// hỏi phòng (`roomId: z.string().min(1).nullable()` + `roomId` truyền thẳng vào create / update).
const doc = (p: string) =>
  readFileSync(resolve(process.cwd(), p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
const dem = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe("[BBP-W] cổng phòng nối vào mọi đường ghi", () => {
  it("[BBP-W1] học bù: tạo (taoMoi true) · duyệt + sửa (taoMoi false) — mỗi lời gọi kèm `throw` ngay sau", () => {
    const s = doc("lib/hoc-bu/case-db.ts");
    expect(dem(s, /lyDoThieuPhong\(\{ taoMoi: true, phongTruoc: null, phongSau: p\.roomId \}\)/g)).toBe(1);
    expect(dem(s, /lyDoThieuPhong\(\{ taoMoi: false, phongTruoc: c\.roomId, phongSau: roomId \}\)/g)).toBe(2);
    expect(dem(s, /if \(thieuPhong\) throw new LoiHocBu\(thieuPhong\);/g)).toBe(3);
  });
  it("[BBP-W2] Trial: thêm buổi (sau khi kế thừa phòng lớp) · sửa buổi — trả lỗi TRƯỚC phép ghi", () => {
    const sv = doc("lib/trial/service.ts");
    const i = sv.indexOf("lyDoThieuPhong({ taoMoi: true, phongTruoc: null, phongSau: roomId })");
    expect(i).toBeGreaterThan(sv.indexOf("const roomId = params.roomId === undefined ? cls.roomId : params.roomId;"));
    expect(i).toBeLessThan(sv.indexOf("tx.trialClassSession.create("));
    const ac = doc("app/(admin)/admin/lop-trial/_actions.ts");
    const j = ac.indexOf("lyDoThieuPhong({ taoMoi: false, phongTruoc: ses.roomId,");
    expect(j).toBeGreaterThan(0);
    expect(ac.indexOf("if (thieuPhong) return { ok: false, error: thieuPhong };", j)).toBeGreaterThan(j);
    expect(j).toBeLessThan(ac.indexOf("await sdb.trialClassSession.update({"));
  });
});
