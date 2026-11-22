// @vitest-environment node
// lib/ai-lead/dich-vu/intake.n1.test.ts — N1 (TRUNG TÍNH) của /lead-intakes: đường PHẢN HỒI không được chạm bất kỳ bảng CRM nào.
//
// Cách đo: `@/lib/db` giả là Proxy CHO PHÉP đúng một danh sách model của Gateway; truy cập model nào KHÁC (Lead · Contact · Student · Order · User…) ném ngay.
// Test thuần-DB-giả này bổ sung cho `[AIL-PV-N1]` (Postgres thật, so TỪNG BYTE hai trạng thái CRM): ở đây bắt cả trường hợp CRM được đọc mà KHÔNG làm đổi phản hồi
// (một lần đọc thừa hôm nay là một nhánh rẽ ngày mai).
//
// Mã ca: [AIL-N1-01..]
import { beforeEach, describe, expect, it, vi } from "vitest";

const mk = vi.hoisted(() => ({
  truyCap: [] as string[],
  cho: new Set(["aiLeadCatalogSnapshot", "aiLeadCampusPublication", "orgUnit", "aiLeadConversation", "aiLeadDraft", "aiLeadRequest", "aiLeadRuleSet"]), // aiLeadRuleSet = bộ quy tắc của CHÍNH Gateway (không phải dữ liệu CRM)
  taoLead: vi.fn(),
  baoHoSo: vi.fn(),
  ownerState: "AI_ACTIVE" as string,
  fbName: "Phụ huynh Minh Anh" as string | null,
  moCoSan: null as null | Record<string, unknown>,
  taoDraft: [] as unknown[],
}));

vi.mock("@/lib/db", () => {
  const catalog = { pages: [{ pageId: "104500000000001", campuses: [{ campusCode: "CS1", name: "CS1", address: "x", acceptingLeads: true }, { campusCode: "CS3", name: "CS3", address: "y", acceptingLeads: false }] }] };
  const hamCua = (model: string, hanh: string, args: unknown[]): unknown => {
    mk.truyCap.push(`${model}.${hanh}`);
    switch (`${model}.${hanh}`) {
      case "aiLeadCatalogSnapshot.findFirst":
        return { version: 7, publishedAt: new Date(0), etag: "cat-7", payload: catalog };
      case "aiLeadRuleSet.findFirst":
        return null; // chưa có bộ quy tắc ⇒ tham số ai.* (N1: quy tắc không đổi phản hồi dù có hay không)
      case "aiLeadCampusPublication.findMany":
        return [{ campusCenterId: "center_cs1", campus: { code: "CS1" } }];
      case "orgUnit.findMany":
        return [{ id: "ou_cs1", centerId: "center_cs1" }];
      case "aiLeadConversation.findUnique":
        return { id: "c1", fbName: mk.fbName, fbNameSource: mk.fbName ? "META_PROFILE_API" : null };
      case "aiLeadConversation.update":
        return {};
      case "aiLeadConversation.findUniqueOrThrow":
        return { id: "c1", pageId: "104500000000001", ownerState: mk.ownerState, fbName: mk.fbName, fbNameSource: mk.fbName ? "META_PROFILE_API" : null, holdingSentAt: null };
      case "aiLeadRequest.createMany":
        return { count: 1 };
      case "aiLeadRequest.updateMany":
        return { count: 1 };
      case "aiLeadDraft.findFirst":
        return mk.moCoSan;
      case "aiLeadDraft.create":
        mk.taoDraft.push((args[0] as { data: unknown }).data);
        return { id: "d1" };
      case "aiLeadDraft.updateMany":
        return { count: 1 };
      default:
        throw new Error(`N1: không có hàm giả cho ${model}.${hanh}`);
    }
  };
  const model = (ten: string) => new Proxy({}, { get: (_t, hanh) => (...args: unknown[]) => Promise.resolve(hamCua(ten, String(hanh), args)) });
  const db: unknown = new Proxy(
    {},
    {
      get(_t, ten) {
        if (typeof ten === "symbol") return undefined;
        if (ten === "$transaction") return async (fn: (tx: unknown) => unknown) => fn(db);
        if (ten === "$queryRaw") return async () => [];
        mk.truyCap.push(String(ten));
        if (!mk.cho.has(String(ten))) throw new Error(`N1: đường phản hồi /lead-intakes chạm model "${String(ten)}"`);
        return model(String(ten));
      },
    },
  );
  return { db };
});
vi.mock("./tao-lead", () => ({ taoLeadTuHoSo: mk.taoLead }));
vi.mock("./thong-bao", () => ({ baoHoSoCanXuLy: mk.baoHoSo }));

import { db } from "@/lib/db";
import { MAC_DINH_CAI_DAT } from "../hop-dong";
import { docFixture } from "../ho-tro-test";
import { xuLyLeadIntake } from "./intake";
import type { NguCanhYeuCau } from "../xac-thuc";

function ctx(sua: (b: Record<string, unknown>) => void = () => undefined, cai: Record<string, unknown> = {}, autoCreatePage = false): NguCanhYeuCau<"leadIntakes"> {
  const body = JSON.parse(JSON.stringify(docFixture("10").request.body)) as Record<string, unknown>;
  sua(body);
  return {
    endpoint: "leadIntakes",
    body: body as never,
    nowMs: 1_793_000_000_000,
    requestId: "req_000000000000000000000001",
    ifNoneMatch: null,
    cai: { ...MAC_DINH_CAI_DAT, inboxLinkTemplate: "", ...cai } as never,
    agent: { id: "ailtgagenttest000001", name: "a", environment: "TEST", secretVersion: 1, active: true, contractStatus: "COMPATIBLE", pages: [{ pageId: "104500000000001", state: "ENABLED", routingCenterId: null, autoCreate: autoCreatePage }] },
  };
}

beforeEach(() => {
  mk.truyCap.length = 0;
  mk.taoDraft.length = 0;
  mk.ownerState = "AI_ACTIVE";
  mk.fbName = "Phụ huynh Minh Anh";
  mk.moCoSan = null;
  mk.taoLead.mockReset();
  mk.baoHoSo.mockReset();
});

describe("[AIL-N1-01] đối chứng: Proxy giả THẬT SỰ chặn mô hình CRM (nếu không thì các ca dưới xanh vì không thấy gì)", () => {
  it.each(["lead", "contact", "student", "order", "user", "leadChild", "payment"])("db.%s ném", (m) => {
    expect(() => (db as unknown as Record<string, unknown>)[m]).toThrow(/N1/);
  });
});

describe("[AIL-N1-02] đường phản hồi chỉ chạm model của Gateway", () => {
  it.each([
    ["10 đủ ⇒ ACCEPTED", () => ctx(), "ACCEPTED"],
    ["thiếu cơ sở ⇒ NEED_INFO", () => ctx((b) => void (b.candidate = { phoneRaw: "0905123456" })), "NEED_INFO"],
    ["CS3 ngừng ⇒ INVALID_SELECTION", () => ctx((b) => void ((b.candidate as Record<string, unknown>).campusCode = "CS3")), "INVALID_SELECTION"],
  ] as const)("%s", async (_t, dung, status) => {
    const ra = await xuLyLeadIntake(dung(), { lenLichNen: () => undefined });
    expect(ra.loai).toBe("ok");
    expect(ra.loai === "ok" && (ra.body.data as { status: string }).status).toBe(status);
    const chamModel = new Set(mk.truyCap.map((s) => s.split(".")[0]));
    for (const m of chamModel) expect(mk.cho.has(m!), `chạm model ngoài danh sách: ${m}`).toBe(true);
  });

  it("hội thoại do NGƯỜI giữ ⇒ HUMAN_QUEUED, vẫn không chạm CRM; dữ liệu khách vẫn vào hồ sơ", async () => {
    mk.ownerState = "HUMAN_ACTIVE";
    const ra = await xuLyLeadIntake(ctx(), { lenLichNen: () => undefined });
    expect(ra.loai === "ok" && (ra.body.data as { status: string }).status).toBe("HUMAN_QUEUED");
    expect(mk.taoDraft.length).toBe(1);
    expect(mk.taoDraft[0]).toMatchObject({ phoneRaw: "0905 123 456", phoneCanonical: "84905123456" });
  });
});

describe("[AIL-N1-03] việc cần CRM (tự tạo lead) chạy SAU phản hồi, không trước", () => {
  it("autoCreate BẬT + đủ điều kiện: lúc `xuLyLeadIntake` trả về, `taoLeadTuHoSo` CHƯA được gọi; nó nằm trong việc nền", async () => {
    const viec: (() => Promise<void>)[] = [];
    mk.taoLead.mockResolvedValue({ ok: true, leadId: "l1", duplicate: false });
    const ra = await xuLyLeadIntake(ctx(undefined, { autoCreateEnabled: true }, true), { lenLichNen: (f) => void viec.push(f) });
    expect(ra.loai).toBe("ok");
    expect(mk.taoLead).not.toHaveBeenCalled();
    expect(viec.length).toBe(1);
    await viec[0]!();
    expect(mk.taoLead).toHaveBeenCalledTimes(1);
  });
  it("công tắc toàn hệ BẬT nhưng Page TẮT (mặc định) ⇒ KHÔNG tạo lead; hồ sơ vẫn báo nhân viên (E2)", async () => {
    const viec: (() => Promise<void>)[] = [];
    await xuLyLeadIntake(ctx(undefined, { autoCreateEnabled: true }, false), { lenLichNen: (f) => void viec.push(f) });
    expect(viec.length).toBe(1);
    await viec[0]!();
    expect(mk.taoLead).not.toHaveBeenCalled();
    expect(mk.baoHoSo).toHaveBeenCalledTimes(1);
  });
  it("autoCreate TẮT ⇒ không việc nền tạo lead; chỉ báo nhân viên", async () => {
    const viec: (() => Promise<void>)[] = [];
    await xuLyLeadIntake(ctx(), { lenLichNen: (f) => void viec.push(f) });
    expect(viec.length).toBe(1);
    await viec[0]!();
    expect(mk.taoLead).not.toHaveBeenCalled();
    expect(mk.baoHoSo).toHaveBeenCalledTimes(1);
  });
});

describe("[AIL-N1-04] phản hồi không phụ thuộc thứ gì ngoài đầu vào được phép", () => {
  it("cùng đầu vào ⇒ cùng phản hồi (trừ receiptId): gọi hai lần với DB giả y hệt", async () => {
    const a = await xuLyLeadIntake(ctx(), { lenLichNen: () => undefined });
    const b = await xuLyLeadIntake(ctx(), { lenLichNen: () => undefined });
    const bo = (r: Awaited<ReturnType<typeof xuLyLeadIntake>>) => (r.loai === "ok" ? { ...(r.body.data as object), receiptId: "R" } : null);
    expect(bo(a)).toEqual(bo(b));
  });
});
