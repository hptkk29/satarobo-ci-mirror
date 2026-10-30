// @vitest-environment node
/**
 * [GHIM-DB-*] — LEAD NGUỘI ĐƯỢC PHÂN BỔ LẠI nổi lên đầu `/leads`, chạy `phanBoLaiLeadNguoi` THẬT
 * trên Postgres LOCAL (yêu cầu 28/10/2026).
 *
 * Cái cần chứng minh mà test thuần không chứng minh được: `conGhim` so `lastActivityAt <=
 * phanBoLaiNguoiAt` bằng ĐÚNG GIÁ TRỊ DB ghi ra. Nếu hai cột lệch nhau dù một mili-giây thì lead
 * hết ghim ngay lúc vừa sinh, và mọi test thuần vẫn xanh.
 *
 *   [GHIM-DB-01] phân bổ đích danh: đổi chủ + dòng ghi chú "lâu ngày chưa chăm" + mốc ghim khớp
 *                `lastActivityAt` ⇒ `conGhim` = true
 *   [GHIM-DB-02] Sale chăm lại (ghi hoạt động qua cửa chung) ⇒ `conGhim` = false, cột ghim giữ nguyên
 *   [GHIM-DB-03] đối chứng: lead không bị phân bổ lại ⇒ không ghim
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`. Dọn theo tiền tố `GHIMNG_`. LUẬT 18: mỗi ca tự dựng dữ liệu.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const SESS = vi.hoisted(() => ({
  current: null as null | { user: { id: string; role: string; roles: string[]; centerId: string | null; name: string; email: string; tokenVersion: number } },
}));
vi.mock("@/lib/auth", () => ({ auth: async () => SESS.current }));
vi.mock("next/cache", async (orig) => ({ ...(await orig<typeof import("next/cache")>()), revalidatePath: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "user-agent": "vitest" }) }));

// Chuông đẩy không thuộc phạm vi ca này — tắt hai lời gọi ra ngoài, giữ nguyên phần còn lại.
vi.mock("@/lib/lead/assign-lead", async (orig) => ({
  ...(await orig<typeof import("@/lib/lead/assign-lead")>()),
  thuHoiChuongLeadCu: async () => {},
  baoLoLeadMoi: async () => {},
}));

import { db } from "../../lib/db";
import { conGhim } from "../../lib/lead/ghim-phan-bo-lai";
import { recordLeadActivity } from "../../lib/lead/activity-write";
import { phanBoLaiLeadNguoi } from "../../lib/lead/nguoi-service";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { damBaoToChuc } from "./_nguon-fixture";
import LeadsPage from "../../app/(admin)/admin/leads/page";
import { LeadsTable } from "../../app/(admin)/admin/leads/_components/leads-table";

const RUN = RUN_DB_TESTS;
const P = "GHIMNG_";
const NGAY = 24 * 60 * 60 * 1000;

async function xoa(): Promise<void> {
  const leads = await db.lead.findMany({ where: { parentName: { startsWith: P } }, select: { id: true } });
  const ids = leads.map((l) => l.id);
  await db.leadAssignmentHistory.deleteMany({ where: { leadId: { in: ids } } });
  await db.leadActivity.deleteMany({ where: { leadId: { in: ids } } });
  await db.lead.deleteMany({ where: { id: { in: ids } } });
  const users = await db.user.findMany({ where: { email: { startsWith: P } }, select: { id: true } });
  await db.userOrgRole.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
  await db.user.deleteMany({ where: { email: { startsWith: P } } });
}

/** Duyệt cây phần tử React tìm `<LeadsTable>` và trả props của nó — trang là RSC, gọi thẳng như hàm. */
function timBang(node: unknown): { leads: { id: string; phanBoLaiNguoiAt: string | null }[] } | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const n of node) { const r = timBang(n); if (r) return r; }
    return null;
  }
  const el = node as { type?: unknown; props?: { children?: unknown } };
  if (el.type === LeadsTable) return el.props as never;
  return timBang(el.props?.children);
}

async function docDanhSach(user: { id: string; email: string | null; name: string | null }) {
  SESS.current = { user: { id: user.id, role: "SALES_CSM", roles: ["SALES_CSM"], centerId: null, name: user.name ?? "", email: user.email ?? "", tokenVersion: 0 } };
  const bang = timBang(await LeadsPage({ searchParams: Promise.resolve({}) }));
  expect(bang, "không tìm thấy <LeadsTable> trong kết quả trang").not.toBeNull();
  return bang!.leads;
}

async function dung() {
  const cs = await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } });
  const taoSale = (ten: string) =>
    db.user.create({
      data: { name: `${P}${ten}`, email: `${P}${ten}@example.test`, role: "SALES_CSM", roles: ["SALES_CSM"], centerId: cs.id, isActive: true },
      select: { id: true, email: true, name: true },
    });
  const [cu, moi] = await Promise.all([taoSale("cu"), taoSale("moi")]);
  // Vai RBAC v2 tại CS1 — thiếu dòng này `scopedDb` không cho thấy lead nào (cơ sở nhìn thấy rỗng).
  const ou = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } });
  const rd = await db.roleDef.findUniqueOrThrow({ where: { code: "CENTER_SALES_CSM" }, select: { id: true } });
  for (const u of [cu, moi]) {
    await db.userOrgRole.create({ data: { userId: u.id, orgUnitId: ou.id, roleId: rd.id, grantedById: "ghimng", effectiveFrom: new Date(Date.now() - 3_600_000) } });
  }
  const xaXua = new Date(Date.now() - 120 * NGAY);
  const lead = await db.lead.create({
    data: {
      parentName: `${P}phu-huynh`,
      phone: "0903777001",
      centerId: cs.id,
      assignedToId: cu.id,
      createdAt: xaXua,
      assignedAt: xaXua,
      lastActivityAt: xaXua,
      lastInboundAt: xaXua,
    },
    select: { id: true },
  });
  return { cs, cu, moi, lead };
}

describe.skipIf(!RUN)("[GHIM-DB] lead nguội được phân bổ lại — ghi chú + ghim", () => {
  beforeAll(async () => {
    await damBaoToChuc({ vai: ["CENTER_SALES_CSM"] });
  });
  beforeEach(xoa);
  afterAll(xoa);

  const phanBo = (leadId: string, nhanId: string) =>
    phanBoLaiLeadNguoi({
      leadIds: [leadId],
      cach: { kieu: "nguoi", nhanId },
      now: new Date(),
      nguongNgay: 90,
      visibleCenterIds: "ALL",
      actorId: null,
      actorName: "QLCS test",
      lyDo: "Sale cũ nghỉ việc",
    });

  it("[GHIM-DB-01] đổi chủ + ghi chú 'lâu ngày chưa chăm' + mốc ghim khớp lastActivityAt", async () => {
    const { moi, lead } = await dung();
    const kq = await phanBo(lead.id, moi.id);
    expect(kq.daChia).toBe(1);

    const sau = await db.lead.findUniqueOrThrow({
      where: { id: lead.id },
      select: { assignedToId: true, phanBoLaiNguoiAt: true, lastActivityAt: true },
    });
    expect(sau.assignedToId).toBe(moi.id);
    expect(sau.phanBoLaiNguoiAt).not.toBeNull();
    // ⚠️ Khớp TỪNG mili-giây: `conGhim` dựa vào đúng phép so này.
    expect(sau.lastActivityAt?.getTime()).toBe(sau.phanBoLaiNguoiAt?.getTime());
    expect(conGhim(sau)).toBe(true);

    const ghiChu = await db.leadActivity.findFirst({ where: { leadId: lead.id, type: "NOTE" }, select: { content: true } });
    expect(ghiChu?.content).toContain("Được phân bổ lại do lead lâu ngày chưa chăm");
    expect(ghiChu?.content).toContain("Sale cũ nghỉ việc");
  });

  it("[GHIM-DB-02] Sale chăm lại ⇒ hết ghim, không ai phải gỡ tay", async () => {
    const { moi, lead } = await dung();
    await phanBo(lead.id, moi.id);
    const truoc = await db.lead.findUniqueOrThrow({ where: { id: lead.id }, select: { phanBoLaiNguoiAt: true } });

    // Đợi sang mili-giây khác để chắc chắn hoạt động mới CÓ mốc muộn hơn (luật 19: đồng hồ DB).
    await new Promise((r) => setTimeout(r, 15));
    await db.$transaction((tx) =>
      recordLeadActivity({ tx, leadId: lead.id, actorId: moi.id, actorName: "Sale mới", type: "CALL", content: "Gọi phụ huynh" }),
    );

    const sau = await db.lead.findUniqueOrThrow({
      where: { id: lead.id },
      select: { phanBoLaiNguoiAt: true, lastActivityAt: true },
    });
    expect(sau.phanBoLaiNguoiAt?.getTime()).toBe(truoc.phanBoLaiNguoiAt?.getTime());
    expect(conGhim(sau)).toBe(false);
  });

  it("[GHIM-DB-03] đối chứng: lead không bị phân bổ lại ⇒ không ghim", async () => {
    const { lead } = await dung();
    const l = await db.lead.findUniqueOrThrow({ where: { id: lead.id }, select: { phanBoLaiNguoiAt: true, lastActivityAt: true } });
    expect(l.phanBoLaiNguoiAt).toBeNull();
    expect(conGhim(l)).toBe(false);
  });

  it("[GHIM-DB-04] /leads: lead được phân bổ lại nổi lên ĐẦU kèm mốc; chăm lại thì về chỗ thường", async () => {
    const { cs, cu, moi, lead } = await dung();
    // Hai lead THƯỜNG của người nhận, lastInboundAt MỚI hơn nhiều so với lead cũ 120 ngày.
    for (const [i, ten] of ["a", "b"].entries()) {
      await db.lead.create({
        data: { parentName: `${P}thuong-${ten}`, phone: `090377710${i + 2}`, centerId: cs.id, assignedToId: moi.id, lastInboundAt: new Date(Date.now() - i * 3_600_000) },
      });
    }

    // Trước khi phân bổ: lead cũ chưa của `moi` ⇒ không có trong danh sách của họ.
    expect((await docDanhSach(moi)).some((l) => l.id === lead.id)).toBe(false);

    await phanBo(lead.id, moi.id);
    const truoc = await docDanhSach(moi);
    expect(truoc).toHaveLength(3);
    // ⚠️ Lead có lastInboundAt CŨ NHẤT mà đứng ĐẦU ⇒ do ghim, không phải do thứ tự thường.
    expect(truoc[0]!.id).toBe(lead.id);
    expect(truoc[0]!.phanBoLaiNguoiAt).not.toBeNull();
    expect(truoc.slice(1).every((l) => l.phanBoLaiNguoiAt === null)).toBe(true);

    // Người KHÁC (chủ cũ) không bị ghim lead này — đối chứng: ghim gắn với người đang giữ.
    expect((await docDanhSach(cu)).some((l) => l.id === lead.id)).toBe(false);

    await new Promise((r) => setTimeout(r, 15));
    await db.$transaction((tx) =>
      recordLeadActivity({ tx, leadId: lead.id, actorId: moi.id, actorName: "Sale mới", type: "CALL", content: "Gọi phụ huynh" }),
    );
    const sau = await docDanhSach(moi);
    expect(sau).toHaveLength(3);
    expect(sau.every((l) => l.phanBoLaiNguoiAt === null)).toBe(true);
    // Hết ghim ⇒ về đúng chỗ của `lastInboundAt` (cũ nhất ⇒ cuối), không còn ở đầu.
    expect(sau[sau.length - 1]!.id).toBe(lead.id);
  });
});
