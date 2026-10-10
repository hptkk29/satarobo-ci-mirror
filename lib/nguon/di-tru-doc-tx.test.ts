/**
 * Ca [QN-DT-04a..g] — tầng ĐỌC di trú (`docDuLieuDiTru`) chạy trên `tx` GIẢ: không cần Postgres.
 *
 * Vì sao có tệp này (lượt cấy lại 07/10/2026, luật 14): ca DB `[NHH-SRC-19c]` có fixture QUÁ SẠCH để
 * phân biệt vài lỗi — trong DB nháp không có lead nào NGOÀI phạm vi, không lead nào mang CẢ `createdById`
 * lẫn mã trong ghi chú, không phiếu nhãn-máy nào TRƯỚC mốc 01/10 mà vẫn có mã, không lead nào SĐT rỗng.
 * Cấy 5 lỗi tương ứng vào `di-tru-db.ts` ⇒ cả bộ vẫn XANH. Ở đây tx giả cho phép đặt ĐÚNG những lead ấy
 * và đọc ĐÚNG đối số mà tầng đọc gửi cho Prisma (phạm vi, `deletedAt`, `select.attribution`).
 *
 * Mọi ngày TUYỆT ĐỐI (luật 19). Không đọc đồng hồ.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DANH_MUC_GOC } from "./danh-muc-goc";
import { docDuLieuDiTru } from "./di-tru-db";

type Tx = Parameters<typeof docDuLieuDiTru>[0];

type DongLead = {
  id: string;
  source: string | null;
  createdAt: Date;
  createdById: string | null;
  note: string | null;
  affiliateId: string | null;
  phone: string;
  attribution?: { id: string } | null;
};

type DongVai = { userId: string; status: "ACTIVE" | "EXPIRED"; effectiveFrom: Date; effectiveTo: Date | null; role: { code: string } };

const TRUOC_MOC = new Date("2026-09-20T03:00:00.000Z");
const SAU_MOC = new Date("2026-10-02T03:00:00.000Z");

const lead = (id: string, phu: Partial<DongLead> = {}): DongLead => ({
  id,
  source: "Website",
  createdAt: TRUOC_MOC,
  createdById: null,
  note: null,
  affiliateId: null,
  phone: `0990${id.replace(/\D/g, "").padStart(6, "0")}`,
  ...phu,
});

function giaTx(c: {
  leads?: DongLead[];
  nhanVien?: { id: string; employeeCode: string }[];
  users?: { id: string; employeeId: string | null }[];
  vai?: DongVai[];
  /** Id Affiliate CÓ THẬT trong DB (câu `affiliate.findMany` chỉ trả những id này). */
  affiliates?: string[];
  /** Dòng AuditLog đổi mã nhân viên, đúng hình dạng câu `$queryRaw` trả ra (mã THÔ, chưa chuẩn hoá). */
  lichSu?: { entityId: string; createdAt: Date; maCu: string | null; maMoi: string | null }[];
}) {
  const leads = c.leads ?? [];
  const users = c.users ?? [];
  const vai = c.vai ?? [];
  const tx = {
    lead: {
      findMany: vi.fn(async (_a: unknown) => leads),
      count: vi.fn(async (_a: unknown) => 0),
    },
    affiliate: { findMany: vi.fn(async () => (c.affiliates ?? []).map((id) => ({ id }))) },
    user: {
      findMany: vi.fn(async (a: { where: { id?: { in: string[] }; employeeId?: { in: string[] } } }) =>
        users.filter((u) => (a.where.id ? a.where.id.in.includes(u.id) : u.employeeId !== null && !!a.where.employeeId?.in.includes(u.employeeId))),
      ),
    },
    employee: { findMany: vi.fn(async () => c.nhanVien ?? []) },
    $queryRaw: vi.fn(async () => c.lichSu ?? []),
    userOrgRole: {
      findMany: vi.fn(async (a: { where: { userId: { in: string[] } } }) => vai.filter((v) => a.where.userId.in.includes(v.userId))),
    },
    leadSourceGroup: { findMany: vi.fn(async () => DANH_MUC_GOC.map((d) => ({ code: d.code }))) },
  };
  return { tx, as: tx as unknown as Tx };
}

const goiDau = (m: { mock: { calls: unknown[][] } }) => m.mock.calls[0]?.[0] as { where: Record<string, unknown>; select: Record<string, unknown> };

describe("[QN-DT-04a] phạm vi và đối số gửi cho Prisma", () => {
  it("phạm vi {leadIds} ⇒ lead.findMany VÀ lead.count cùng lọc `id in` đúng danh sách", async () => {
    const g = giaTx({});
    await docDuLieuDiTru(g.as, { coBangQuyNguon: true, phamVi: { leadIds: ["a", "b"] } });
    const tim = goiDau(g.tx.lead.findMany);
    const dem = goiDau(g.tx.lead.count);
    expect(tim.where.id).toEqual({ in: ["a", "b"] });
    expect(dem.where.id).toEqual({ in: ["a", "b"] });
  });

  it('phạm vi "TAT_CA" ⇒ KHÔNG có khoá id (đối chứng dương — vế trên không phải luôn-đúng)', async () => {
    const g = giaTx({});
    await docDuLieuDiTru(g.as, { coBangQuyNguon: true, phamVi: "TAT_CA" });
    expect("id" in goiDau(g.tx.lead.findMany).where).toBe(false);
    expect("id" in goiDau(g.tx.lead.count).where).toBe(false);
  });

  it("chỉ đọc lead CÒN SỐNG; đếm riêng lead đã xoá mềm", async () => {
    const g = giaTx({});
    await docDuLieuDiTru(g.as, { coBangQuyNguon: true, phamVi: "TAT_CA" });
    expect(goiDau(g.tx.lead.findMany).where.deletedAt).toBeNull();
    expect(goiDau(g.tx.lead.count).where.deletedAt).toEqual({ not: null });
  });

  it("[PB-1] chưa có bảng quy nguồn ⇒ select.attribution = false và KHÔNG đọc LeadSourceGroup; có bảng ⇒ join + đọc danh mục", async () => {
    const chua = giaTx({});
    await docDuLieuDiTru(chua.as, { coBangQuyNguon: false, phamVi: "TAT_CA" });
    expect(goiDau(chua.tx.lead.findMany).select.attribution).toBe(false);
    expect(chua.tx.leadSourceGroup.findMany).not.toHaveBeenCalled();

    const co = giaTx({});
    await docDuLieuDiTru(co.as, { coBangQuyNguon: true, phamVi: "TAT_CA" });
    expect(goiDau(co.tx.lead.findMany).select.attribution).toEqual({ select: { id: true } });
    expect(co.tx.leadSourceGroup.findMany).toHaveBeenCalledTimes(1);
  });

  it("lead ĐÃ có quy nguồn bị bỏ khỏi `hang` và được đếm riêng", async () => {
    const g = giaTx({ leads: [lead("1"), lead("2", { attribution: { id: "qn" } })] });
    const kq = await docDuLieuDiTru(g.as, { coBangQuyNguon: true, phamVi: "TAT_CA" });
    expect(kq.hang.map((h) => h.leadId)).toEqual(["1"]);
    expect(kq.daCoQuyNguon).toBe(1);
  });
});

describe("[QN-DT-04g] affiliate: id treo ≠ id có thật", () => {
  it("nhãn quatang + affiliateId KHÔNG tồn tại ⇒ PAID_ADS; tồn tại (chưa phân loại) ⇒ UNKNOWN + AFF_CHUA_PHAN_LOAI", async () => {
    const treo = giaTx({ leads: [lead("1", { source: "quatang", affiliateId: "aff-ma" })], affiliates: [] });
    const kqTreo = await docDuLieuDiTru(treo.as, { coBangQuyNguon: true, phamVi: "TAT_CA" });
    const k1 = kqTreo.hang[0]!.kq;
    expect(k1.loai === "INVALID" ? null : [k1.nhom, k1.xemTay]).toEqual(["PAID_ADS", []]);

    const co = giaTx({ leads: [lead("1", { source: "quatang", affiliateId: "aff-that" })], affiliates: ["aff-that"] });
    const kqCo = await docDuLieuDiTru(co.as, { coBangQuyNguon: true, phamVi: "TAT_CA" });
    const k2 = kqCo.hang[0]!.kq;
    expect(k2.loai === "INVALID" ? null : [k2.nhom, k2.xemTay]).toEqual(["UNKNOWN", ["AFF_CHUA_PHAN_LOAI"]]);
  });
});

describe("[QN-DT-04b] trùng SĐT", () => {
  it("0… và 84… cùng số ⇒ trùng; SĐT RỖNG không bao giờ thành nhóm trùng", async () => {
    const g = giaTx({
      leads: [
        lead("1", { phone: "0901234567" }),
        lead("2", { phone: "84901234567" }),
        lead("3", { phone: "" }),
        lead("4", { phone: "" }),
        lead("5", { phone: "0911000000" }),
      ],
    });
    const kq = await docDuLieuDiTru(g.as, { coBangQuyNguon: true, phamVi: "TAT_CA" });
    expect([...kq.trungSdt].sort()).toEqual(["1", "2"]);
    expect(kq.nhomTrungSdt).toEqual([["1", "2"]]);
  });
});

describe("[QN-DT-04c] giải người nhập — createdById thắng mã trong ghi chú", () => {
  const nhanVien = [
    { id: "E1", employeeCode: "SR.NV.001" },
    { id: "E2", employeeCode: "SR.NV.002" },
  ];
  const users = [
    { id: "U1", employeeId: "E1" },
    { id: "U2", employeeId: "E2" },
  ];
  const vai: DongVai[] = [
    { userId: "U1", status: "ACTIVE", effectiveFrom: new Date("2026-09-01T00:00:00.000Z"), effectiveTo: null, role: { code: "CENTER_SALES_CSM" } },
    { userId: "U2", status: "ACTIVE", effectiveFrom: new Date("2026-09-01T00:00:00.000Z"), effectiveTo: null, role: { code: "TEACHER" } },
  ];

  it("phiếu có CẢ createdById (E1, CSKH) lẫn mã SR.NV.002 (E2, GV) ⇒ người nhập là E1, nhóm EMPLOYEE_REFERRAL", async () => {
    const g = giaTx({
      leads: [lead("1", { source: "sale-form-app", createdAt: SAU_MOC, createdById: "U1", note: "Nhân viên nhập: SR.NV.002" })],
      nhanVien,
      users,
      vai,
    });
    const kq = await docDuLieuDiTru(g.as, { coBangQuyNguon: true, phamVi: "TAT_CA" });
    const k = kq.hang[0]!.kq;
    expect(k.loai === "INVALID" ? null : [k.nhom, k.vaiNguon, k.nguoi]).toEqual(["EMPLOYEE_REFERRAL", "SALE", { kind: "EMPLOYEE", employeeId: "E1" }]);
  });

  it("đối chứng dương: KHÔNG có createdById ⇒ mã trong ghi chú giải ra E2 (GV) ⇒ EMPLOYEE_REFERRAL", async () => {
    const g = giaTx({
      leads: [lead("1", { source: "sale-form-app", createdAt: SAU_MOC, note: "Nhân viên nhập: SR.NV.002" })],
      nhanVien,
      users,
      vai,
    });
    const kq = await docDuLieuDiTru(g.as, { coBangQuyNguon: true, phamVi: "TAT_CA" });
    const k = kq.hang[0]!.kq;
    expect(k.loai === "INVALID" ? null : [k.nhom, k.vaiNguon, k.nguoi]).toEqual(["EMPLOYEE_REFERRAL", "TEACHER", { kind: "EMPLOYEE", employeeId: "E2" }]);
  });

  it("bảng `maNv` CHỈ tính phiếu nhãn-máy TỪ 01/10: phiếu trước mốc có mã vẫn KHÔNG vào", async () => {
    const g = giaTx({
      leads: [
        lead("1", { source: "sale-form", createdAt: TRUOC_MOC, note: "Nhân viên nhập: SR.NV.002" }),
        lead("2", { source: "sale-form", createdAt: SAU_MOC, note: "Nhân viên nhập: SR.NV.002" }),
      ],
      nhanVien,
      users,
      vai,
    });
    const kq = await docDuLieuDiTru(g.as, { coBangQuyNguon: true, phamVi: "TAT_CA" });
    expect(kq.maNv).toHaveLength(1);
    expect(kq.maNv[0]).toMatchObject({ ma: "SR.NV.002", soPhieu: 1, employeeId: "E2", nhom: "EMPLOYEE_REFERRAL", vai: "TEACHER" });
    // Phiếu trước mốc vẫn được ánh xạ (PAID_ADS theo D12), chỉ không vào bảng mã.
    const truoc = kq.hang.find((h) => h.leadId === "1")!.kq;
    expect(truoc.loai === "INVALID" ? null : [truoc.nhom, truoc.nguoi]).toEqual(["PAID_ADS", null]);
  });
});

describe("[QN-DT-04f] lịch sử đổi mã đi vào PHÉP LÙI đã chuẩn hoá (mã thô trong AuditLog)", () => {
  // E2 hôm nay giữ SR.NV.002; trước 03/10 nó giữ SR.NV.009. AuditLog ghi mã THÔ: chữ thường / đảo đoạn.
  const nhanVien = [{ id: "E2", employeeCode: "SR.NV.002" }];
  const lichSu = [{ entityId: "E2", createdAt: new Date("2026-10-03T00:00:00.000Z"), maCu: "nv.sr.009", maMoi: "sr.nv.002" }];
  const phieu = (id: string, ma: string) =>
    lead(id, { source: "sale-form", createdAt: SAU_MOC, note: `Nhân viên nhập: ${ma}` });

  it("SR.NV.002 TRƯỚC khi E2 nhận nó ⇒ chưa ai giữ (maMoi thô 'sr.nv.002' phải được chuẩn hoá để gỡ khoá hôm nay)", async () => {
    const g = giaTx({ leads: [phieu("1", "SR.NV.002")], nhanVien, lichSu });
    const kq = await docDuLieuDiTru(g.as, { coBangQuyNguon: true, phamVi: "TAT_CA" });
    const k = kq.hang[0]!.kq;
    expect(k.loai === "INVALID" ? null : [k.nhom, k.nguoi, k.xemTay]).toEqual(["OTHER", null, ["MA_NV_KHONG_GIAI"]]);
  });

  it("mã CŨ thô 'nv.sr.009' (chữ thường, đảo đoạn) tra ra E2 (maCu phải được chuẩn hoá)", async () => {
    const g = giaTx({ leads: [phieu("1", "nv.sr.009")], nhanVien, lichSu });
    const kq = await docDuLieuDiTru(g.as, { coBangQuyNguon: true, phamVi: "TAT_CA" });
    const k = kq.hang[0]!.kq;
    expect(k.loai === "INVALID" ? null : k.nguoi).toEqual({ kind: "EMPLOYEE", employeeId: "E2" });
  });
});

describe("[QN-DT-04d] vai theo ngày — biên và mốc hiệu lực", () => {
  const t = (iso: string) => new Date(iso);
  const nv = [{ id: "E1", employeeCode: "SR.NV.001" }];
  const us = [{ id: "U1", employeeId: "E1" }];
  const mot = (vai: DongVai[], tao: Date) => {
    const g = giaTx({ leads: [lead("1", { source: "sale-form-app", createdAt: tao, createdById: "U1" })], nhanVien: nv, users: us, vai });
    return docDuLieuDiTru(g.as, { coBangQuyNguon: true, phamVi: "TAT_CA" }).then((kq) => {
      const k = kq.hang[0]!.kq;
      // Trả CẢ vai: sau khi bốn nhóm nhân sự gộp thành một, nhóm không còn phân biệt được vai cũ/vai mới — chỉ `vaiNguon` mới cắn
      // được phép cấy biên `<=` (vai CŨ MANAGER thắng vai MỚI TEACHER nếu biên bị đọc thành "cả hai cùng hiệu lực").
      return k.loai === "INVALID" ? null : [k.nhom, k.vaiNguon, k.xemTay];
    });
  };

  it("effectiveTo là biên MỞ, effectiveFrom là biên ĐÓNG: đúng lúc vai cũ hết hạn thì CHỈ còn vai mới", async () => {
    // Cặp vai được chọn để NẾU biên bị đọc thành "cả hai cùng hiệu lực" thì bậc đầu của bảng chọn vai CŨ:
    // MANAGEMENT (bậc 2) thắng TEACHER (bậc 3). Chọn cặp mà vai cũ KHÔNG thắng thì phép cấy `<=` vẫn xanh.
    const vai: DongVai[] = [
      { userId: "U1", status: "EXPIRED", effectiveFrom: t("2026-09-01T00:00:00.000Z"), effectiveTo: t("2026-10-03T00:00:00.000Z"), role: { code: "CENTER_MANAGER" } },
      { userId: "U1", status: "ACTIVE", effectiveFrom: t("2026-10-03T00:00:00.000Z"), effectiveTo: null, role: { code: "TEACHER" } },
    ];
    // Ngay TRƯỚC biên: chỉ vai cũ hiệu lực.
    expect(await mot(vai, t("2026-10-02T23:59:59.999Z"))).toEqual(["EMPLOYEE_REFERRAL", "MANAGER", []]);
    // ĐÚNG biên: vai cũ hết (biên mở), vai mới bắt đầu (biên đóng) ⇒ TEACHER, vẫn không phải "vai hiện tại".
    expect(await mot(vai, t("2026-10-03T00:00:00.000Z"))).toEqual(["EMPLOYEE_REFERRAL", "TEACHER", []]);
  });

  it("effectiveFrom SAU phiếu ⇒ vai chưa hiệu lực ⇒ VAI_SUY_TU_HIEN_TAI (không được coi là hiệu lực)", async () => {
    const vai: DongVai[] = [
      { userId: "U1", status: "ACTIVE", effectiveFrom: t("2026-10-05T00:00:00.000Z"), effectiveTo: null, role: { code: "CENTER_SALES_CSM" } },
    ];
    expect(await mot(vai, SAU_MOC)).toEqual(["EMPLOYEE_REFERRAL", "SALE", ["VAI_SUY_TU_HIEN_TAI"]]);
  });

  it("vai đã EXPIRED nhưng đang hiệu lực LÚC ĐÓ vẫn tính (không lọc status ở phép 'tại ngày')", async () => {
    const vai: DongVai[] = [
      { userId: "U1", status: "EXPIRED", effectiveFrom: t("2026-09-01T00:00:00.000Z"), effectiveTo: t("2026-10-10T00:00:00.000Z"), role: { code: "TEACHER" } },
    ];
    expect(await mot(vai, SAU_MOC)).toEqual(["EMPLOYEE_REFERRAL", "TEACHER", []]);
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

describe("[QN-DT-04e] phạm vi BẮT BUỘC (luật 7) — chữ ký, không mặc định", () => {
  const ma = docMa("lib/nguon/di-tru-db.ts");

  it("`phamVi: PhamViDiTru` không tuỳ chọn, và không có giá trị mặc định ở chỗ bóc `opts`", () => {
    expect(ma).toMatch(/opts:\s*\{\s*coBangQuyNguon:\s*boolean;\s*phamVi:\s*PhamViDiTru\s*\}/);
    expect(ma).not.toMatch(/phamVi\s*\?\s*:/);
    expect(ma).not.toMatch(/\bphamVi\s*=\s*["{]/);
    expect(ma).not.toMatch(/\{\s*coBangQuyNguon\s*,\s*phamVi\s*=/);
  });

  it("[tự kiểm] bộ so khớp THẤY chữ ký lỏng", () => {
    expect("opts: { coBangQuyNguon: boolean; phamVi?: PhamViDiTru }").toMatch(/phamVi\s*\?\s*:/);
    expect('const { coBangQuyNguon, phamVi = "TAT_CA" } = opts;').toMatch(/\{\s*coBangQuyNguon\s*,\s*phamVi\s*=/);
  });
});
