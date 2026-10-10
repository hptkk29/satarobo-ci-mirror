/**
 * Ca [NHH-SRC-23u] — `kiemNguoiGioiThieu`: cùng luật với CHECK `LeadAttribution_nguoi_gioi_thieu_chk`,
 * trả lỗi TRƯỚC khi chạm DB (07 §2.6.5). THUẦN. Lưới của CHECK thật là `[NHH-SRC-23c]` (Postgres).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { kiemNguoiGioiThieu } from "./ghi-nguon";

const rong = {
  referrerKind: null,
  referrerEmployeeId: null,
  referrerParentUserId: null,
  referrerStudentId: null,
  referrerAffiliateId: null,
} as const;

describe("[NHH-SRC-23u] kiemNguoiGioiThieu", () => {
  it("không người (kind NULL, mọi cột NULL) ⇒ hợp lệ", () => {
    expect(kiemNguoiGioiThieu(rong)).toBeNull();
  });

  it("EMPLOYEE đúng MỘT nhân viên ⇒ hợp lệ; thêm cột phụ huynh ⇒ lỗi", () => {
    expect(kiemNguoiGioiThieu({ ...rong, referrerKind: "EMPLOYEE", referrerEmployeeId: "E1" })).toBeNull();
    expect(
      kiemNguoiGioiThieu({ ...rong, referrerKind: "EMPLOYEE", referrerEmployeeId: "E1", referrerParentUserId: "U1" }),
    ).not.toBeNull();
    expect(kiemNguoiGioiThieu({ ...rong, referrerKind: "EMPLOYEE" })).not.toBeNull();
  });

  it("PARENT cần user HOẶC học viên (hoặc cả hai), không kèm nhân viên/đối tác", () => {
    expect(kiemNguoiGioiThieu({ ...rong, referrerKind: "PARENT", referrerParentUserId: "U1" })).toBeNull();
    expect(kiemNguoiGioiThieu({ ...rong, referrerKind: "PARENT", referrerStudentId: "S1" })).toBeNull();
    expect(
      kiemNguoiGioiThieu({ ...rong, referrerKind: "PARENT", referrerParentUserId: "U1", referrerStudentId: "S1" }),
    ).toBeNull();
    expect(kiemNguoiGioiThieu({ ...rong, referrerKind: "PARENT" })).not.toBeNull();
    expect(
      kiemNguoiGioiThieu({ ...rong, referrerKind: "PARENT", referrerParentUserId: "U1", referrerEmployeeId: "E1" }),
    ).not.toBeNull();
  });

  it("AFFILIATE cần đúng đối tác; kind NULL mà có cột người ⇒ lỗi", () => {
    expect(kiemNguoiGioiThieu({ ...rong, referrerKind: "AFFILIATE", referrerAffiliateId: "A1" })).toBeNull();
    expect(kiemNguoiGioiThieu({ ...rong, referrerKind: "AFFILIATE" })).not.toBeNull();
    expect(kiemNguoiGioiThieu({ ...rong, referrerEmployeeId: "E1" })).not.toBeNull();
  });
});

/** Bóc chú thích — dòng TRƯỚC, khối SAU (chú thích dòng hay nhắc `lib/nguon/*`). */
function docMa(p: string): string {
  return readFileSync(resolve(process.cwd(), p), "utf8")
    .split(/\r?\n/)
    .map((d) => d.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Ca [NHH-SRC-23w] — THỨ TỰ cổng/phép ghi trong tầng ghi (CLAUDE.md "luật rollback": từ chối = `throw`, mọi
 * cổng đứng TRƯỚC phép ghi đầu tiên). Quét `cong-truoc-phep-ghi.test.ts` chỉ phủ lib/finance·payments·…,
 * KHÔNG phủ lib/nguon. Trong transaction Prisma, `throw` lùi cả lượt nên lỗi thứ tự này KHÔNG lộ ở hành vi —
 * nó chỉ nổ khi ai đó đổi `throw` thành `return` (đúng sự cố 17/09 ở `goGanTheoCon`). Nên ghim bằng mã nguồn.
 */
describe("[NHH-SRC-23w] tầng ghi nguồn — cổng đứng TRƯỚC phép ghi, từ chối bằng throw", () => {
  const ma = docMa("lib/nguon/ghi-nguon.ts");
  const vt = (s: string, tu = 0) => ma.indexOf(s, tu);

  it("taoNguonBanDau: kiemDuLieu(d) đứng trước createMany; skipDuplicates đúng MỘT lần", () => {
    const dau = vt("export async function taoNguonBanDau(");
    const gate = vt("kiemDuLieu(d);", dau);
    const ghi = vt("tx.leadAttribution.createMany(", dau);
    expect(dau).toBeGreaterThan(0);
    expect(gate).toBeGreaterThan(dau);
    expect(ghi).toBeGreaterThan(gate);
    // PR2 thêm `taoNguonTheoLo` (cùng khuôn, cho đường Excel) ⇒ ĐÚNG HAI lần trong tệp: một ở mỗi hàm tạo.
    const thanTaoNguonBanDau = ma.slice(dau, vt("export async function taoNguonTheoLo(", dau));
    expect([...thanTaoNguonBanDau.matchAll(/skipDuplicates:\s*true/g)]).toHaveLength(1);
    expect([...ma.matchAll(/skipDuplicates:\s*true/g)]).toHaveLength(2);
  });

  it("taoNguonTheoLo (PR2): kiemDuLieu từng dòng đứng trước createMany; lệch số dòng ⇒ throw (không return)", () => {
    const dau = vt("export async function taoNguonTheoLo(");
    const gate = vt("kiemDuLieu(d);", dau);
    const ghi = vt("tx.leadAttribution.createMany(", dau);
    expect(dau).toBeGreaterThan(0);
    expect(gate).toBeGreaterThan(dau);
    expect(ghi).toBeGreaterThan(gate);
    const sau = ma.slice(ghi, vt("export type TouchpointMoi", dau));
    expect(sau).toMatch(/r\.count !== ds\.length\)\s*\{\s*throw new Error/);
    expect(sau).not.toMatch(/return \{ ok: false/);
  });

  it("doiNguon: cả hai cổng (lý do, kiemDuLieu) đứng trước updateMany đầu tiên", () => {
    const dau = vt("export async function doiNguon(");
    const ghi = vt("tx.leadAttribution.updateMany(", dau);
    const gLyDo = vt("LY_DO_NGAN", dau);
    const gDuLieu = vt("kiemDuLieu(moi);", dau);
    expect(dau).toBeGreaterThan(0);
    expect(ghi).toBeGreaterThan(dau);
    expect(gLyDo).toBeGreaterThan(dau);
    expect(gLyDo).toBeLessThan(ghi);
    expect(gDuLieu).toBeGreaterThan(dau);
    expect(gDuLieu).toBeLessThan(ghi);
  });

  it("MỘT `return { ok: false` duy nhất, và nó đứng ngay sau phép `updateMany` CÓ ĐIỀU KIỆN (ngoại lệ FIX-H9)", () => {
    const thatBai = [...ma.matchAll(/return \{ ok: false/g)];
    expect(thatBai).toHaveLength(1);
    const i = thatBai[0]!.index!;
    const upd = vt("where: { leadId, updatedAt: daDocUpdatedAt }");
    expect(upd).toBeGreaterThan(0);
    expect(upd).toBeLessThan(i);
    // Giữa phép ghi có điều kiện và dòng trả lỗi chỉ có đúng phép kiểm đếm dòng.
    expect(ma.slice(upd, i)).toMatch(/r\.count === 0\)\s*$/);
  });

  it("[tự kiểm] bộ đếm THẤY `return { ok: false` mới", () => {
    expect([..."if (x) return { ok: false, loi: 1 };".matchAll(/return \{ ok: false/g)]).toHaveLength(1);
  });
});

/**
 * Ca [NHH-SRC-23x] — NGUỒN GỐC BẤT BIẾN [chủ dự án chốt 07/10/2026]: `doiNguon` KHÔNG ghi `originalGroupId` /
 * `inheritedFromLeadId` / `attributedAt`. Hành vi thật ở `[NHH-SRC-23d]` (Postgres); đây là lưới ghim DÂY NỐI —
 * thứ mà ca hành vi không thấy: gộp lead là ngoại lệ HỢP LỆ (mang cả nguồn gốc của bản thắng), nên ai "đồng bộ
 * cho gọn" bằng cách cho `doiNguon` dùng `cot(...)` đủ 17 cột thì `[NHH-SRC-23d]` đỏ, còn ai cho đường gộp dùng
 * `cotDoi(...)` thì CHỈ `[NHH-SRC-18]` (gộp, Postgres) đỏ. Ghim theo biểu thức, không theo chỗ đặt dòng.
 */
describe("[NHH-SRC-23x] đổi nguồn không ghi nguồn gốc — dây nối trong ghi-nguon.ts", () => {
  const ma = docMa("lib/nguon/ghi-nguon.ts");
  const BA_COT = /originalGroupId|inheritedFromLeadId|attributedAt/;
  const khoi = (dau: string, cuoi: string): string => {
    const a = ma.indexOf(dau);
    const z = ma.indexOf(cuoi, a + dau.length);
    expect(a, dau).toBeGreaterThanOrEqual(0);
    expect(z, cuoi).toBeGreaterThan(a);
    return ma.slice(a, z);
  };

  it("`cotDoi` (cột của đổi nguồn) không nhắc cột nguồn gốc nào; `cot` (đủ 17) thì nhắc cả ba", () => {
    const doi = khoi("function cotDoi(", "\n}\n");
    expect(doi).not.toMatch(BA_COT);
    expect(doi).toMatch(/groupId: d\.groupId/); // đối chứng dương: bộ cắt khối thật sự lấy được thân hàm
    const day = khoi("function cot(", "\n}\n");
    for (const c of ["originalGroupId", "inheritedFromLeadId", "attributedAt"]) expect(day, c).toContain(c);
    expect(day).toMatch(/\.\.\.cotDoi\(d\)/);
  });

  it("kiểu `DuLieuDoiNguon` bỏ đúng ba cột; `doiNguon` nhận kiểu đó và ghi bằng `cotDoi(moi)`", () => {
    const kieu = khoi("export type DuLieuDoiNguon", ";\n");
    for (const c of ["originalGroupId", "inheritedFromLeadId", "attributedAt"]) expect(kieu, c).toContain(`"${c}"`);
    const d = khoi("export async function doiNguon(", "async function doiNguonKhiGop(");
    expect(d).toMatch(/moi: DuLieuDoiNguon;/);
    expect(d).not.toMatch(/moi: DuLieuNguon\b/);
    expect(d).toMatch(/cotGhi: cotDoi\(moi\)/);
    expect(d).not.toMatch(/\bcot\(/);
  });

  it("đường GỘP là ngoại lệ DUY NHẤT: `doiNguonKhiGop` không export, ghi bằng `cot(moi)`, đúng MỘT chỗ gọi (trong gopQuyNguon)", () => {
    expect(ma).not.toMatch(/export (async )?function doiNguonKhiGop/);
    const g = khoi("async function doiNguonKhiGop(", "async function ghiDoiNguon(");
    expect(g).toMatch(/cotGhi: cot\(moi\)/);
    const goi = [...ma.matchAll(/doiNguonKhiGop\(/g)];
    expect(goi).toHaveLength(2); // 1 định nghĩa + 1 lời gọi
    const gop = ma.slice(ma.indexOf("async function gopQuyNguon("));
    expect(gop).toMatch(/await doiNguonKhiGop\(tx,/);
  });

  it("[tự kiểm] bộ cắt khối THẤY một thân hàm giả có `attributedAt`", () => {
    expect(BA_COT.test("function cotDoi(d) { return { attributedAt: d.attributedAt }; }")).toBe(true);
  });
});
