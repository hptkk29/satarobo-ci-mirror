/**
 * Ca [DBD-*] — phần GHI của đồng bộ hai chiều HV ↔ lead (26/09/2026), chạy trên một `tx` giả
 * trong bộ nhớ (đủ đúng mấy lệnh mà `dong-bo-lead-db.ts` gọi) để khẳng định HÀNH VI: bản ghi
 * nào đổi, đổi thành gì, và — quan trọng không kém — bản ghi nào KHÔNG được đụng.
 *
 * Phần chạm Postgres thật (một transaction không scope thấy HV ở cơ sở khác) canh bằng smoke
 * localhost; ở đây canh luật.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const nhatKy = vi.hoisted(() => ({ lead: [] as unknown[], hv: [] as unknown[] }));
vi.mock("@/lib/audit/log", () => ({
  logLeadAudit: vi.fn(async (p: unknown) => void nhatKy.lead.push(p)),
  logStudentAudit: vi.fn(async (p: unknown) => void nhatKy.hv.push(p)),
}));

import type { Prisma } from "@prisma/client";
import { dongBoTuCon, dongBoTuHocVien, dongBoTuLead } from "./dong-bo-lead-db";

type Row = Record<string, unknown> & { id: string };

function chon(r: Row, select: Record<string, boolean> | undefined) {
  if (!select) return { ...r };
  return Object.fromEntries(Object.keys(select).map((k) => [k, r[k] ?? null]));
}

function khop(r: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v && typeof v === "object" && !(v instanceof Date) && "not" in (v as object)) {
      return r[k] !== (v as { not: unknown }).not;
    }
    return (r[k] ?? null) === v;
  });
}

/** `tx` giả — đúng các lệnh mà module gọi, và đếm số lượt ghi. */
function taoTx(du: { leads: Row[]; hvs: Row[]; cons: Row[] }) {
  const ghi = { lead: 0, hv: 0, con: 0 };
  const bang = (rows: Row[], dem: "lead" | "hv" | "con") => ({
    findFirst: async ({ where, select }: { where: Record<string, unknown>; select?: Record<string, boolean> }) => {
      const r = rows.find((x) => khop(x, where));
      return r ? chon(r, select) : null;
    },
    findUnique: async ({ where, select }: { where: { id: string }; select?: Record<string, boolean> }) => {
      const r = rows.find((x) => x.id === where.id);
      return r ? chon(r, select) : null;
    },
    findMany: async ({ where, select }: { where: Record<string, unknown>; select?: Record<string, boolean> }) =>
      rows.filter((x) => khop(x, where)).map((r) => chon(r, select)),
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const r = rows.find((x) => x.id === where.id)!;
      Object.assign(r, data);
      ghi[dem]++;
      return r;
    },
  });
  const tx = {
    lead: bang(du.leads, "lead"),
    student: bang(du.hvs, "hv"),
    leadChild: bang(du.cons, "con"),
  } as unknown as Prisma.TransactionClient;
  return { tx, ghi };
}

const ACTOR = { id: "u_sale", name: "Sale A" };

const LEAD = (): Row => ({
  id: "lead_1",
  deletedAt: null,
  parentName: "Trần Thị Hoa",
  phone: "84905123456",
  email: "hoa@example.com",
  facebookUrl: null,
  parentGender: "FEMALE",
  parentDob: null,
  city: "Tp Đà Nẵng",
  ward: "Phường Hải Châu",
  addressLine: "12 Lê Lợi",
});
const HV = (id: string, extra: Partial<Row> = {}): Row => ({
  id,
  deletedAt: null,
  leadId: "lead_1",
  leadChildId: null,
  parentName: "Trần Thị Hoa",
  parentPhone: "0905123456",
  parentEmail: "hoa@example.com",
  parentFacebookUrl: null,
  parentGender: "FEMALE",
  parentDob: null,
  city: "Tp Đà Nẵng",
  ward: "Phường Hải Châu",
  address: "12 Lê Lợi",
  dateOfBirth: null,
  gender: "MALE",
  school: "TH A",
  currentGrade: 3,
  ...extra,
});
const CON = (): Row => ({
  id: "con_1",
  leadId: "lead_1",
  dob: null,
  gender: "Nam",
  schoolName: "TH A",
  gradeLevel: "Lớp 3",
});

function anh(r: Row): Record<string, unknown> {
  const { id: _id, deletedAt: _d, leadId: _l, leadChildId: _c, ...rest } = r;
  void _id;
  void _d;
  void _l;
  void _c;
  return rest;
}

beforeEach(() => {
  nhatKy.lead.length = 0;
  nhatKy.hv.length = 0;
});

describe("dongBoTuHocVien — sửa ở màn Học viên", () => {
  it("[DBD-01] đổi SĐT + địa chỉ ⇒ phiếu lead đổi (SĐT dạng 84…) + anh/chị/em cùng phiếu đổi", async () => {
    const du = {
      leads: [LEAD()],
      hvs: [HV("hv_a"), HV("hv_b"), HV("hv_x", { leadId: "lead_khac" })],
      cons: [CON()],
    };
    const { tx } = taoTx(du);
    const truoc = anh(HV("hv_a"));
    const sau = { ...truoc, parentPhone: "0912 000 111", ward: "Phường Thanh Khê" } as never;

    const r = await dongBoTuHocVien({
      tx,
      studentId: "hv_a",
      leadId: "lead_1",
      leadChildId: null,
      truoc: truoc as never,
      sau,
      actor: ACTOR,
    });

    expect(du.leads[0]).toMatchObject({ phone: "84912000111", ward: "Phường Thanh Khê" });
    // Anh/chị/em nhận ĐÚNG giá trị dạng hồ sơ HV, không vòng qua dạng lead.
    expect(du.hvs[1]).toMatchObject({ parentPhone: "0912 000 111", ward: "Phường Thanh Khê" });
    // HV nối phiếu KHÁC: không đụng.
    expect(du.hvs[2]).toMatchObject({ parentPhone: "0905123456", ward: "Phường Hải Châu" });
    expect(r).toEqual({ leadIds: ["lead_1"], studentIds: ["hv_b"] });
    expect(nhatKy.lead).toHaveLength(1);
    expect(nhatKy.hv).toHaveLength(1);
  });

  it("[DBD-02] đổi ngày sinh / lớp của con ⇒ bé trong phiếu đổi ('Lớp 5')", async () => {
    const du = { leads: [LEAD()], hvs: [HV("hv_a", { leadChildId: "con_1" })], cons: [CON()] };
    const { tx } = taoTx(du);
    const truoc = anh(du.hvs[0]!);
    const ngay = new Date("2017-04-02T00:00:00Z");
    const sau = { ...truoc, currentGrade: 5, dateOfBirth: ngay } as never;

    await dongBoTuHocVien({
      tx,
      studentId: "hv_a",
      leadId: "lead_1",
      leadChildId: "con_1",
      truoc: truoc as never,
      sau,
      actor: ACTOR,
    });

    expect(du.cons[0]).toMatchObject({ gradeLevel: "Lớp 5", dob: ngay });
    // Chỉ ô con đổi ⇒ phiếu lead (ô phụ huynh) không bị ghi.
    expect(du.leads[0]).toEqual(LEAD());
  });

  it("[DBD-03] lưu suông / đổi định dạng SĐT cùng một số ⇒ KHÔNG ghi gì, KHÔNG nhật ký", async () => {
    const du = { leads: [LEAD()], hvs: [HV("hv_a"), HV("hv_b")], cons: [CON()] };
    const { tx, ghi } = taoTx(du);
    const truoc = anh(HV("hv_a"));
    await dongBoTuHocVien({
      tx,
      studentId: "hv_a",
      leadId: "lead_1",
      leadChildId: "con_1",
      truoc: truoc as never,
      sau: { ...truoc, parentPhone: "+84 905 123 456" } as never,
      actor: ACTOR,
    });
    expect(ghi).toEqual({ lead: 0, hv: 0, con: 0 });
    expect(nhatKy.lead).toHaveLength(0);
    expect(nhatKy.hv).toHaveLength(0);
  });

  it("[DBD-04] HV CHƯA nối lead ⇒ không đụng phiếu nào", async () => {
    const du = { leads: [LEAD()], hvs: [HV("hv_a", { leadId: null })], cons: [CON()] };
    const { tx, ghi } = taoTx(du);
    const truoc = anh(du.hvs[0]!);
    await dongBoTuHocVien({
      tx,
      studentId: "hv_a",
      leadId: null,
      leadChildId: null,
      truoc: truoc as never,
      sau: { ...truoc, parentEmail: "moi@example.com" } as never,
      actor: ACTOR,
    });
    expect(ghi).toEqual({ lead: 0, hv: 0, con: 0 });
  });
});

describe("dongBoTuLead / dongBoTuCon — sửa ở màn Lead", () => {
  it("[DBD-05] phiếu đổi SĐT/email ⇒ MỌI HV nối phiếu đổi (SĐT dạng 0…); HV phiếu khác không đụng", async () => {
    const du = {
      leads: [LEAD()],
      hvs: [HV("hv_a"), HV("hv_b"), HV("hv_x", { leadId: "lead_khac" })],
      cons: [],
    };
    const { tx } = taoTx(du);
    const r = await dongBoTuLead({
      tx,
      leadId: "lead_1",
      truoc: anh(LEAD()) as never,
      // Hình dạng `updateData` của updateLeadFields: CHỈ ô được gửi.
      sau: { phone: "84912000111", email: "moi@example.com" },
      actor: ACTOR,
    });
    expect(r.studentIds.sort()).toEqual(["hv_a", "hv_b"]);
    for (const hv of du.hvs.slice(0, 2)) {
      expect(hv).toMatchObject({ parentPhone: "0912000111", parentEmail: "moi@example.com" });
    }
    expect(du.hvs[2]).toMatchObject({ parentPhone: "0905123456" });
  });

  it("[DBD-06] bé đổi 'Lớp 4' ⇒ HV nối bé thành lớp 4; 'Mầm non' ⇒ KHÔNG ghi lớp", async () => {
    const du = { leads: [LEAD()], hvs: [HV("hv_a", { leadChildId: "con_1" })], cons: [CON()] };
    const { tx } = taoTx(du);
    await dongBoTuCon({
      tx,
      leadChildId: "con_1",
      truoc: anh(CON()) as never,
      sau: { gradeLevel: "Lớp 4", gender: "Nữ" },
      actor: ACTOR,
    });
    expect(du.hvs[0]).toMatchObject({ currentGrade: 4, gender: "FEMALE" });

    await dongBoTuCon({
      tx,
      leadChildId: "con_1",
      truoc: anh({ ...CON(), gradeLevel: "Lớp 4" }) as never,
      sau: { gradeLevel: "Mầm non" },
      actor: ACTOR,
    });
    expect(du.hvs[0]).toMatchObject({ currentGrade: 4 });
  });

  it("[DBD-07] lượt sửa phiếu không chạm ô chung ⇒ không đọc, không ghi HV nào", async () => {
    const du = { leads: [LEAD()], hvs: [HV("hv_a")], cons: [] };
    const { tx, ghi } = taoTx(du);
    const r = await dongBoTuLead({
      tx,
      leadId: "lead_1",
      truoc: anh(LEAD()) as never,
      sau: { parentName: "Trần Thị Hoa" },
      actor: ACTOR,
    });
    expect(r.studentIds).toEqual([]);
    expect(ghi.hv).toBe(0);
  });
});
