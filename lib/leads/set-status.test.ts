// lib/leads/set-status.test.ts — GĐ1 (literal cập nhật theo enum GĐ5, 10 giá trị).
//
// Bốn tính chất phải khoá, vì sai cái nào cũng hỏng âm thầm:
//  1. Idempotent — module học thử gọi lại mỗi lượt điểm danh; không có tính chất này
//     thì sổ đầy dòng rác và tỷ lệ chuyển đổi bị thổi lên.
//  2. `statusChangedAt` phải dời — đây là mốc thay cho `updatedAt` ở nhắc việc.
//  3. Rơi khỏi phễu phải ghi BẬC TRƯỚC ĐÓ, và lead quay lại phễu KHÔNG được xoá bậc cũ.
//  4. KHÔNG tra ngược orgUnitId từ centerId — hàm tra dùng `db` toàn cục nên sẽ thoát
//     khỏi transaction. Test này chạy với tx giả, không có DB, nên nó bắt được ngay.
import fs from "node:fs";
import { describe, it, expect } from "vitest";
import type { LeadStatus, Prisma } from "@prisma/client";
import { setLeadStatus, recordLeadStatusChange } from "./set-status";
import { ALL_LEAD_STATUSES, LEAD_DROP_STATUSES } from "./status";

type LeadRow = {
  status: LeadStatus;
  centerId: string | null;
  orgUnitId: string | null;
  statusChangedAt: Date | null;
  droppedAtStage: LeadStatus | null;
  lostNote: string | null;
  lostAt: Date | null;
};

type HistoryRow = {
  leadId: string;
  fromStatus: LeadStatus | null;
  toStatus: LeadStatus;
  source: string;
  changedById: string | null;
  changedByName: string | null;
  reason: string | null;
  centerId: string | null;
  orgUnitId: string | null;
};

function fakeTx(lead: LeadRow | null, history: HistoryRow[]): Prisma.TransactionClient {
  return {
    lead: {
      findUnique: async () => lead,
      update: async (args: { data: Partial<LeadRow> }) => {
        if (lead) Object.assign(lead, args.data);
        return lead;
      },
    },
    leadStatusHistory: {
      create: async (args: { data: HistoryRow }) => {
        history.push(args.data);
        return args.data;
      },
    },
  } as unknown as Prisma.TransactionClient;
}

function leadMau(over: Partial<LeadRow> = {}): LeadRow {
  return {
    status: "DANG_TU_VAN",
    centerId: "cs1",
    orgUnitId: "ou-cs1",
    statusChangedAt: null,
    droppedAtStage: null,
    lostNote: null,
    lostAt: null,
    ...over,
  };
}

describe("setLeadStatus — cửa duy nhất đổi trạng thái", () => {
  it("đổi thật thì ghi đúng một dòng sổ", async () => {
    const lead = leadMau();
    const history: HistoryRow[] = [];
    const res = await setLeadStatus({
      tx: fakeTx(lead, history),
      leadId: "l1",
      to: "DA_HEN_HOC_THU",
      source: "admin",
      actorId: "u1",
      actorName: "Sale A",
    });

    expect(res).toEqual({ changed: true, from: "DANG_TU_VAN", to: "DA_HEN_HOC_THU" });
    expect(lead.status).toBe("DA_HEN_HOC_THU");
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      fromStatus: "DANG_TU_VAN",
      toStatus: "DA_HEN_HOC_THU",
      source: "admin",
      changedById: "u1",
      changedByName: "Sale A",
      centerId: "cs1",
      orgUnitId: "ou-cs1",
    });
  });

  it("dời mốc statusChangedAt — mốc mà nhắc việc đọc", async () => {
    const lead = leadMau();
    const truoc = Date.now();
    await setLeadStatus({
      tx: fakeTx(lead, []),
      leadId: "l1",
      to: "DA_HEN_HOC_THU",
      source: "admin",
    });
    expect(lead.statusChangedAt).toBeInstanceOf(Date);
    expect(lead.statusChangedAt!.getTime()).toBeGreaterThanOrEqual(truoc);
  });

  it("IDEMPOTENT: gọi lại cùng trạng thái thì không ghi thêm dòng nào", async () => {
    const lead = leadMau({ status: "CHO_QUYET_DINH" });
    const history: HistoryRow[] = [];
    const tx = fakeTx(lead, history);

    const r1 = await setLeadStatus({ tx, leadId: "l1", to: "CHO_QUYET_DINH", source: "trial" });
    const r2 = await setLeadStatus({ tx, leadId: "l1", to: "CHO_QUYET_DINH", source: "trial" });

    expect(r1).toEqual({ changed: false, reason: "KHONG_DOI" });
    expect(r2).toEqual({ changed: false, reason: "KHONG_DOI" });
    expect(history).toHaveLength(0);
  });

  it("lead không tồn tại → không ném lỗi, báo rõ", async () => {
    const history: HistoryRow[] = [];
    const res = await setLeadStatus({
      tx: fakeTx(null, history),
      leadId: "khong-co",
      to: "DA_MAT",
      source: "admin",
    });
    expect(res).toEqual({ changed: false, reason: "KHONG_THAY_LEAD" });
    expect(history).toHaveLength(0);
  });

  it("rơi khỏi phễu thì ghi BẬC TRƯỚC ĐÓ và lý do", async () => {
    const lead = leadMau({ status: "DA_HOC_THU" });
    await setLeadStatus({
      tx: fakeTx(lead, []),
      leadId: "l1",
      to: "DA_MAT",
      source: "admin",
      reason: "Phụ huynh chọn trung tâm khác",
    });
    expect(lead.droppedAtStage).toBe("DA_HOC_THU");
    expect(lead.lostNote).toBe("Phụ huynh chọn trung tâm khác");
    expect(lead.lostAt).toBeInstanceOf(Date);
  });

  // 27/08 — chốt gộp hai cột lý do rớt về `Lead.lostNote`, bỏ `Lead.dropReason`.
  //
  // Đây là ràng buộc SINH RA TỪ việc gộp, không có ở bản `dropReason`: `lostNote` còn
  // là nơi `markLeadChildLostAction` ghi lý do rớt của TỪNG CON. Bản cũ ghi
  // `dropReason: params.reason ?? null` — cột đó không ai khác dùng nên gán null vô
  // hại. Bê nguyên nếp đó sang `lostNote` là mỗi lượt đổi trạng thái phiếu KHÔNG kèm
  // lý do sẽ xoá trắng lý do rớt của những đứa con đã đánh dấu trước đó.
  it("rơi mà KHÔNG kèm lý do thì KHÔNG được xoá lý do rớt sẵn có của con", async () => {
    const cu = new Date("2026-08-01T00:00:00Z");
    const lead = leadMau({
      status: "DA_LIEN_HE",
      lostNote: "Bé thứ hai: nhà chuyển đi tỉnh khác",
      lostAt: cu,
    });
    await setLeadStatus({
      tx: fakeTx(lead, []),
      leadId: "l1",
      to: "DA_MAT",
      source: "trial",
    });
    expect(lead.droppedAtStage).toBe("DA_LIEN_HE");
    expect(lead.lostNote).toBe("Bé thứ hai: nhà chuyển đi tỉnh khác");
    expect(lead.lostAt).toBe(cu);
  });

  it("nuôi dưỡng cũng tính là rơi", async () => {
    const lead = leadMau({ status: "DA_LIEN_HE" });
    await setLeadStatus({ tx: fakeTx(lead, []), leadId: "l1", to: "DANG_NUOI_DUONG", source: "admin" });
    expect(lead.droppedAtStage).toBe("DA_LIEN_HE");
  });

  it("lead quay lại phễu thì GIỮ bậc rơi cũ — xoá đi là mất số liệu cứu lead", async () => {
    const lead = leadMau({ status: "DANG_NUOI_DUONG", droppedAtStage: "DA_LIEN_HE" });
    await setLeadStatus({ tx: fakeTx(lead, []), leadId: "l1", to: "DANG_TU_VAN", source: "admin" });
    expect(lead.status).toBe("DANG_TU_VAN");
    expect(lead.droppedAtStage).toBe("DA_LIEN_HE");
  });

  // GĐ5 — hai test dưới CỐ Ý vẫn dùng source "auto-assign"/"assign" dù đích đến nay là
  // MOI: bậc ASSIGNED đã gộp vào MOI, việc "đã phân công" nay đọc ở `Lead.assignedToId`
  // chứ không còn là một bậc phễu. Thứ hai test này khoá là hai CỘT cơ sở của dòng sổ,
  // không phải ngữ nghĩa của bậc, nên chỉ cần một lượt đổi trạng thái THẬT là đủ.
  it("lead chưa gán cơ sở vẫn ghi sổ được, hai cột để null", async () => {
    const lead = leadMau({ centerId: null, orgUnitId: null });
    const history: HistoryRow[] = [];
    await setLeadStatus({ tx: fakeTx(lead, history), leadId: "l1", to: "MOI", source: "auto-assign" });
    expect(history[0]).toMatchObject({ centerId: null, orgUnitId: null });
  });

  it("KHÔNG tra ngược orgUnitId từ centerId", async () => {
    // Tx giả không có `db`, nên nếu hàm cố tra ngược thì test này nổ chứ không im.
    const lead = leadMau({ centerId: "cs1", orgUnitId: null });
    const history: HistoryRow[] = [];
    await setLeadStatus({ tx: fakeTx(lead, history), leadId: "l1", to: "MOI", source: "assign" });
    expect(history[0].orgUnitId).toBeNull();
    expect(history[0].centerId).toBe("cs1");
  });
});

describe("LEAD_DROP_STATUSES là MỘT nguồn cho cả cửa ghi lẫn giao diện", () => {
  // Tầng giao diện (`updateLeadStatus` ở màn lead) ép nhập lý do đúng theo tập này,
  // còn cửa ghi dùng chính nó để quyết định có ghi `droppedAtStage`/`lostNote` hay
  // không. Hai bên lệch nhau nghĩa là: có bậc ghi `droppedAtStage` mà không ai hỏi lý
  // do (`lostNote` NULL vĩnh viễn), hoặc hỏi lý do rồi vứt đi.
  for (const to of ALL_LEAD_STATUSES) {
    if (to === "MOI") continue; // trạng thái xuất phát của lead mẫu, không đổi được
    it(`${to}: ghi droppedAtStage ⟺ nằm trong LEAD_DROP_STATUSES`, async () => {
      const lead = leadMau({ status: "MOI" });
      await setLeadStatus({
        tx: fakeTx(lead, []),
        leadId: "lead-1",
        to,
        source: "admin",
        reason: "lý do kiểm thử",
      });
      const laBacRoi = LEAD_DROP_STATUSES.includes(to);
      expect(lead.droppedAtStage).toBe(laBacRoi ? "MOI" : null);
      expect(lead.lostNote).toBe(laBacRoi ? "lý do kiểm thử" : null);
    });
  }

  it("màn lead ép nhập lý do theo ĐÚNG tập này, không chép tay danh sách khác", () => {
    // Không gọi được action thật ở lane unit (auth + Postgres), nên quét nguồn.
    // Bắt đúng lớp lỗi đã xảy ra: cột lý do rớt tồn tại từ GĐ1 mà tới 26/08 vẫn NULL
    // 100% vì không đường người-bấm nào truyền `reason`.
    const src = fs.readFileSync("app/(admin)/admin/leads/actions.ts", "utf8");
    expect(src, "actions.ts không dùng LEAD_DROP_STATUSES để ép lý do").toMatch(
      /LEAD_DROP_STATUSES\.includes\(/,
    );
    expect(src, "reason không được truyền xuống cửa ghi").toMatch(/reason: lyDo/);
  });
});

describe("recordLeadStatusChange — chỉ ghi sổ cho lượt đã claim ở nơi khác", () => {
  it("ghi sổ với from do call-site đưa, không tự đọc lại", async () => {
    // Ở đường tiền/convert, `updateMany` đã đổi status TRƯỚC khi hàm này chạy, nên
    // đọc lại `lead.status` sẽ ra giá trị MỚI. Vì vậy `from` phải do call-site truyền.
    const lead = leadMau({ status: "DA_DANG_KY" });
    const history: HistoryRow[] = [];
    await recordLeadStatusChange({
      tx: fakeTx(lead, history),
      leadId: "l1",
      from: "CHO_QUYET_DINH",
      to: "DA_DANG_KY",
      source: "payment",
      actorId: "u9",
    });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      fromStatus: "CHO_QUYET_DINH",
      toStatus: "DA_DANG_KY",
      source: "payment",
    });
  });

  // GĐ5 — test này vốn là đường "convert" đi tới ENROLLED, khác đích với đường "payment"
  // ở trên (REGISTERED). ENROLLED đã gộp vào DA_DANG_KY nên hai đường nay CÙNG đích;
  // thứ phân biệt "đã chốt hẳn" giờ là `Lead.convertedAt`, không phải status nữa.
  // Vẫn giữ hai test vì chúng khoá hai thứ khác nhau: nội dung dòng sổ, và mốc thời gian.
  it("vẫn dời statusChangedAt", async () => {
    const lead = leadMau({ status: "DA_DANG_KY" });
    await recordLeadStatusChange({
      tx: fakeTx(lead, []),
      leadId: "l1",
      from: "CHO_QUYET_DINH",
      to: "DA_DANG_KY",
      source: "convert",
    });
    expect(lead.statusChangedAt).toBeInstanceOf(Date);
  });
});
