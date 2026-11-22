// @vitest-environment node
/**
 * N-4 — "`Lead.lastActivityAt` không phản ánh đủ hoạt động."
 *
 * Đo được trên mã trước ticket này: có **13** chỗ tạo `LeadActivity`, chỉ **3**
 * chỗ (đều nằm trong `app/(admin)/admin/leads/actions.ts`) cập nhật
 * `Lead.lastActivityAt`. Mười chỗ còn lại — tự chia lead, gán tay, chia lại khi
 * sale nghỉ, ghi nhận tiền, phiếu trùng SĐT, phiếu thêm con, bàn giao, đổi
 * trạng thái — ghi hoạt động xong để nguyên đồng hồ.
 *
 * Hệ quả KHÔNG nằm ở "code xấu" mà ở con số QLCS đọc:
 *  · cột "số ngày chưa tiếp cận lại" (C-05) đọc ra số SAI, và sai theo cả hai
 *    chiều — lead vừa được chăm vẫn hiện "treo 40 ngày" (đồng hồ chưa bao giờ
 *    chạy), còn ngưỡng vàng ≥ 2 / đỏ ≥ 7 ngày (chốt 24/08/2026) báo động nhầm;
 *  · `isLeadIdle` (`lib/crm/sla.ts:100`) rơi ngược về `createdAt` ⇒ che mất
 *    lead ĐÃ có hoạt động thật.
 *
 * Chốt của ticket — y hệt cách C-07 chữa vết trạng thái: **MỘT đường ghi duy
 * nhất** (`recordLeadActivity`) ghi cả dòng `LeadActivity` lẫn cú bump
 * `lastActivityAt` TRONG CÙNG transaction, cộng một test chặn nguồn để chỗ thứ
 * 14 không mọc ra tuần sau.
 *
 * ⚠️ Phần thứ hai của ticket: **`lastActivityAt` ≠ "đã tiếp cận khách"**. Máy tự
 * chia lead cũng là một dòng `LeadActivity`, nhưng đó không phải Sale gọi cho
 * phụ huynh. Danh sách loại nào được tính là "tiếp cận" CHƯA có quyết định của
 * chủ dự án ⇒ tách hẳn sang `activity-clock.ts` dưới dạng hàm THUẦN nhận danh
 * sách TRUYỀN VÀO, để lúc chốt chỉ sửa đúng một hằng số.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  LEAD_OUTREACH_COUNTS_SYSTEM_NOTE,
  LEAD_OUTREACH_TYPES,
  SYSTEM_ACTIVITY_META,
  firstLeadOutreachAt,
  isLeadOutreach,
  isSystemWrittenActivity,
  lastLeadOutreachAt,
} from "./activity-clock";
import { recordLeadActivity } from "./activity-write";

const goc = process.cwd();
const doc = (p: string) => fs.readFileSync(path.join(goc, p), "utf8");
/** Bỏ chú thích trước khi quét: chú thích GIẢI THÍCH lỗi cũ có nhắc đúng các chuỗi này. */
const boChuThich = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

// ─── Phần 1: đường GHI — một hàm, hai dòng, cùng transaction ─────────────────

const taoMock = () => {
  const create = vi.fn();
  const update = vi.fn();
  // S-3 — cú đóng dấu "chạm khách lần đầu" đi bằng `updateMany` chứ không
  // `update`: điều kiện "chỉ ghi khi còn trống" phải nằm TRONG `where` để DB tự
  // xử, không đọc-rồi-ghi (hai lượt chạm cùng lúc sẽ dời mốc về lần thứ hai).
  const updateMany = vi.fn();
  const tx = { leadActivity: { create }, lead: { update, updateMany } } as never;
  return { create, update, updateMany, tx };
};

describe("[N-4] recordLeadActivity — ghi hoạt động là bump đồng hồ, không tách rời", () => {
  let m: ReturnType<typeof taoMock>;
  const MOC = new Date("2026-08-25T03:00:00.000Z");

  beforeEach(() => {
    m = taoMock();
    m.create.mockResolvedValue({ id: "act-1", createdAt: MOC });
    m.update.mockResolvedValue({ id: "lead-1" });
    m.updateMany.mockResolvedValue({ count: 1 });
  });

  it("ghi ĐỦ hai thứ: dòng hoạt động + cú bump `lastActivityAt`", async () => {
    await recordLeadActivity({
      tx: m.tx,
      leadId: "lead-1",
      actorId: "u-1",
      actorName: "Sale CS1",
      type: "CALL",
      content: "Gọi lần 1, phụ huynh bận",
    });

    expect(m.create).toHaveBeenCalledTimes(1);
    expect(m.update).toHaveBeenCalledTimes(1);
    expect(m.update.mock.calls[0][0].where).toEqual({ id: "lead-1" });
  });

  it("🔴 đồng hồ lấy ĐÚNG mốc của dòng vừa ghi, không lấy `new Date()` phía app", async () => {
    // Backfill của N-4 so `lastActivityAt` với `MAX(LeadActivity.createdAt)`.
    // Lấy đồng hồ app thì hai số lệch nhau vài mili-giây trên MỌI dòng ⇒ lần
    // đối soát nào cũng báo "lệch" và không phân biệt được lệch thật.
    await recordLeadActivity({
      tx: m.tx,
      leadId: "lead-1",
      actorId: null,
      actorName: "Hệ thống",
      type: "NOTE",
      content: "Tự động chia cho Sale A",
    });

    expect(m.update.mock.calls[0][0].data).toEqual({ lastActivityAt: MOC });
  });

  it("🔴 cả hai đi CÙNG transaction mà chỗ gọi đang mở", async () => {
    // Bump ngoài transaction thì lượt ghi hoạt động rollback mà đồng hồ vẫn
    // nhảy — đúng loại sai làm lead treo "hết treo" mà không ai biết vì sao.
    const khac = taoMock();
    await recordLeadActivity({
      tx: m.tx,
      leadId: "lead-1",
      actorName: "Sale CS1",
      type: "MESSAGE",
      content: "Nhắn Zalo",
    });

    expect(khac.create).not.toHaveBeenCalled();
    expect(khac.update).not.toHaveBeenCalled();
    expect(m.create).toHaveBeenCalledTimes(1);
    expect(m.update).toHaveBeenCalledTimes(1);
  });

  it("KHÔNG nuốt lỗi bump — hỏng thì cả lượt ghi phải đổ", async () => {
    m.update.mockRejectedValue(new Error("update chết"));

    await expect(
      recordLeadActivity({
        tx: m.tx,
        leadId: "lead-1",
        actorName: "Hệ thống",
        type: "NOTE",
        content: "x",
      }),
    ).rejects.toThrow();
  });

  it("`metadata` chỉ ghi khi chỗ gọi có truyền — không đè null lên dòng cũ", async () => {
    await recordLeadActivity({
      tx: m.tx,
      leadId: "lead-1",
      actorName: "Hệ thống",
      type: "NOTE",
      content: "x",
    });
    expect(m.create.mock.calls[0][0].data).not.toHaveProperty("metadata");

    m.create.mockClear();
    await recordLeadActivity({
      tx: m.tx,
      leadId: "lead-1",
      actorName: "Hệ thống",
      type: "NOTE",
      content: "x",
      metadata: { system: true },
    });
    expect(m.create.mock.calls[0][0].data.metadata).toEqual({ system: true });
  });

  it("`actorId` bỏ trống → null (đường máy), không rơi vào `undefined` im lặng", async () => {
    await recordLeadActivity({
      tx: m.tx,
      leadId: "lead-1",
      actorName: "Hệ thống (web)",
      type: "NOTE",
      content: "[Trùng SĐT] …",
    });

    expect(m.create.mock.calls[0][0].data.actorId).toBeNull();
  });
});

// ─── Phần 1b (S-3): mốc "chạm khách lần đầu" — đồng hồ SLA-3 phải TẮT được ───
/**
 * S-3 — `Lead.firstContactAt` là cột DUY NHẤT tắt được cảnh báo SLA-3 ("Chưa
 * liên hệ khách > 3 giờ", `lib/crm/sla.ts:78`) và là cột đếm ra "khách chưa được
 * chạm lần nào" trên bảng việc (`soChuaLienHe`, `lib/crm/sale-board.ts:207`).
 *
 * Đo được trên mã trước ticket này: chỗ ghi cột đó — `recordFirstContact`
 * (`lib/crm/handover.ts:69`) — KHÔNG ĐƯỢC GỌI TỪ ĐÂU trong `app/` hay `lib/`;
 * người gọi duy nhất là `tests/e2e/r1/handover.spec.ts`. Nghĩa là trên máy thật
 * cột luôn `null`:
 *   · bảng việc của Sale báo "chưa liên hệ lần nào" cho cả khách đã gọi 10 lần;
 *   · SLA-3 kêu từ lúc phân công cho tới khi lead đóng — không thao tác nào tắt
 *     được. Chuông không bao giờ tắt thì người ta học cách phớt lờ chuông, và cả
 *     cơ chế SLA thành vô dụng.
 *
 * Chốt: đóng dấu ngay TRONG `recordLeadActivity` — đường ghi hoạt động duy nhất
 * (N-4) — nên không có cửa nào ghi hoạt động mà quên mốc, và mốc cùng sống-chết
 * với dòng hoạt động trong một transaction.
 *
 * ⚠️ KHÔNG phải hoạt động nào cũng là "đã chạm khách": máy tự chia lead lúc 2h
 * sáng không phải Sale gọi cho phụ huynh. Bộ lọc là `isLeadOutreach`
 * (`activity-clock.ts`) — dùng lại, không dựng bộ lọc thứ hai ở đây.
 */
describe("[S-3] recordLeadActivity — chạm khách thật thì đóng dấu `firstContactAt`", () => {
  let m: ReturnType<typeof taoMock>;
  const MOC = new Date("2026-08-27T03:00:00.000Z");

  beforeEach(() => {
    m = taoMock();
    m.create.mockResolvedValue({ id: "act-1", createdAt: MOC });
    m.update.mockResolvedValue({ id: "lead-1" });
    m.updateMany.mockResolvedValue({ count: 1 });
  });

  const ghi = (type: string, metadata?: unknown) =>
    recordLeadActivity({
      tx: m.tx,
      leadId: "lead-1",
      actorId: "u-1",
      actorName: "Sale CS1",
      type: type as never,
      content: "nội dung",
      ...(metadata === undefined ? {} : { metadata: metadata as never }),
    });

  it.each([...LEAD_OUTREACH_TYPES])("%s do NGƯỜI ghi → đóng dấu chạm khách", async (type) => {
    await ghi(type);
    expect(m.updateMany).toHaveBeenCalledTimes(1);
    expect(m.updateMany.mock.calls[0][0].data).toEqual({ firstContactAt: MOC });
  });

  it("🔴 dòng do MÁY ghi KHÔNG đóng dấu — không được tắt chuông hộ người", async () => {
    // Đây là cách hỏng nguy hiểm hơn cả bệnh đang chữa: chuông tắt mà không ai
    // gọi khách. Spec `activity-clock.ts:54` gọi đúng tên nó là làm-đẹp-giả.
    await ghi("NOTE", SYSTEM_ACTIVITY_META);
    expect(m.create).toHaveBeenCalledTimes(1);
    expect(m.update).toHaveBeenCalledTimes(1); // `lastActivityAt` vẫn nhảy…
    expect(m.updateMany).not.toHaveBeenCalled(); // …nhưng mốc chạm khách thì không.
  });

  it("🔴 STATUS_CHANGE không phải một lần chạm khách", async () => {
    // Ghi nhận tiền / điểm danh học thử / tự chia đều lật trạng thái. Không lần
    // nào trong đó là Sale nhấc máy.
    await ghi("STATUS_CHANGE");
    expect(m.updateMany).not.toHaveBeenCalled();
  });

  it("🔴 chỉ ghi LẦN ĐẦU — điều kiện `firstContactAt: null` nằm trong `where`", async () => {
    // "Liên hệ LẦN ĐẦU" mà ghi đè mỗi lượt thì SLA-3 vẫn tắt được, nhưng phễu
    // mất mốc gốc: báo cáo "bao lâu từ lúc nhận khách tới lần gọi đầu" hoá ra
    // luôn bằng "tới lần gọi gần nhất". Để DB tự lọc, không đọc-rồi-ghi.
    await ghi("CALL");
    expect(m.updateMany.mock.calls[0][0].where).toEqual({
      id: "lead-1",
      firstContactAt: null,
    });
  });

  it("mốc lấy ĐÚNG `createdAt` của dòng vừa ghi, không `new Date()` phía app", async () => {
    await ghi("MESSAGE");
    expect(m.updateMany.mock.calls[0][0].data.firstContactAt).toBe(MOC);
  });

  it("🔴 đi CÙNG transaction mà chỗ gọi đang mở", async () => {
    const khac = taoMock();
    await ghi("CALL");
    expect(khac.updateMany).not.toHaveBeenCalled();
    expect(m.updateMany).toHaveBeenCalledTimes(1);
  });

  it("KHÔNG nuốt lỗi đóng dấu — hỏng thì cả lượt ghi phải đổ", async () => {
    // Nuốt lỗi ở đây = dòng "đã gọi" nằm trong sổ mà chuông vẫn kêu, và không ai
    // lần ra vì sao. Cùng bài học đã vá ở N-4 với cú bump `lastActivityAt`.
    m.updateMany.mockRejectedValue(new Error("updateMany chết"));
    await expect(ghi("CALL")).rejects.toThrow();
  });
});

// ─── Phần 2: đồng hồ "đã TIẾP CẬN" — khái niệm THỨ HAI, chưa chốt ────────────

const act = (type: string, ngay: string, metadata?: unknown) =>
  ({ type, createdAt: new Date(ngay), metadata }) as never;

describe("[N-4] lastLeadOutreachAt — 'có hoạt động' ≠ 'đã tiếp cận khách'", () => {
  it("🔴 máy tự chia lead KHÔNG được tính là đã tiếp cận", () => {
    // Đây là cả lý do phải tách hai khái niệm: sau khi vá N-4, mọi dòng máy ghi
    // đều bump `lastActivityAt`. Dùng thẳng cột đó làm "lần tiếp cận gần nhất"
    // là dựng lại đúng cái làm-đẹp-giả mà spec `:54` cảnh báo, chỉ đổi nguyên do.
    const hoatDong = [
      act("CALL", "2026-08-01T02:00:00Z"),
      act("NOTE", "2026-08-20T02:00:00Z", { system: true }),
    ];

    expect(lastLeadOutreachAt(hoatDong, LEAD_OUTREACH_TYPES)).toEqual(
      new Date("2026-08-01T02:00:00Z"),
    );
  });

  it("ghi chú do NGƯỜI viết vẫn tính (không có dấu `system`)", () => {
    const hoatDong = [
      act("CALL", "2026-08-01T02:00:00Z"),
      act("NOTE", "2026-08-20T02:00:00Z"),
    ];

    expect(lastLeadOutreachAt(hoatDong, LEAD_OUTREACH_TYPES)).toEqual(
      new Date("2026-08-20T02:00:00Z"),
    );
  });

  it("🔴 danh sách loại là THAM SỐ — đổi danh sách là đổi kết quả, không phải sửa hàm", () => {
    // Chủ dự án chưa chốt loại nào tính. Test này ghim rằng lúc chốt chỉ phải
    // sửa hằng số, chứ không phải mở lại thân hàm.
    const hoatDong = [
      act("CALL", "2026-08-01T02:00:00Z"),
      act("EMAIL", "2026-08-10T02:00:00Z"),
    ];

    expect(lastLeadOutreachAt(hoatDong, ["CALL"] as never)).toEqual(
      new Date("2026-08-01T02:00:00Z"),
    );
    expect(lastLeadOutreachAt(hoatDong, ["CALL", "EMAIL"] as never)).toEqual(
      new Date("2026-08-10T02:00:00Z"),
    );
  });

  it("chưa tiếp cận lần nào → null (chỗ gọi tự quyết rơi về `createdAt` hay không)", () => {
    expect(lastLeadOutreachAt([], LEAD_OUTREACH_TYPES)).toBeNull();
    expect(
      lastLeadOutreachAt([act("STATUS_CHANGE", "2026-08-20T02:00:00Z")], LEAD_OUTREACH_TYPES),
    ).toBeNull();
  });

  it("lấy lần GẦN NHẤT bất kể thứ tự mảng đưa vào", () => {
    const hoatDong = [
      act("CALL", "2026-08-20T02:00:00Z"),
      act("MESSAGE", "2026-08-22T02:00:00Z"),
      act("CALL", "2026-08-05T02:00:00Z"),
    ];

    expect(lastLeadOutreachAt(hoatDong, LEAD_OUTREACH_TYPES)).toEqual(
      new Date("2026-08-22T02:00:00Z"),
    );
  });

  it("`isSystemWrittenActivity` chịu được metadata rác (null / chuỗi / mảng)", () => {
    expect(isSystemWrittenActivity(null)).toBe(false);
    expect(isSystemWrittenActivity("system")).toBe(false);
    expect(isSystemWrittenActivity([{ system: true }])).toBe(false);
    expect(isSystemWrittenActivity({ system: "true" })).toBe(false);
    expect(isSystemWrittenActivity({ system: true })).toBe(true);
  });

  it("bật cờ đếm-cả-dòng-máy thì dòng máy được tính (đường thoát nếu chủ dự án chốt ngược)", () => {
    const dongMay = act("NOTE", "2026-08-20T02:00:00Z", { system: true });

    expect(isLeadOutreach(dongMay, LEAD_OUTREACH_TYPES, true)).toBe(true);
    expect(isLeadOutreach(dongMay, LEAD_OUTREACH_TYPES, false)).toBe(false);
    // Mặc định = hằng số, không phải một giá trị thứ ba lẻ loi trong thân hàm.
    expect(isLeadOutreach(dongMay, LEAD_OUTREACH_TYPES)).toBe(
      LEAD_OUTREACH_COUNTS_SYSTEM_NOTE,
    );
  });
});

describe("[S-3] firstLeadOutreachAt — mốc chạm khách ĐẦU TIÊN (dùng cho backfill)", () => {
  it("lấy lần SỚM NHẤT, bất kể thứ tự mảng đưa vào", () => {
    const hoatDong = [
      act("MESSAGE", "2026-08-22T02:00:00Z"),
      act("CALL", "2026-08-05T02:00:00Z"),
      act("CALL", "2026-08-20T02:00:00Z"),
    ];

    expect(firstLeadOutreachAt(hoatDong, LEAD_OUTREACH_TYPES)).toEqual(
      new Date("2026-08-05T02:00:00Z"),
    );
  });

  it("🔴 dòng máy KHÔNG kéo mốc đầu về sớm hơn", () => {
    // Lead nào cũng có một dòng "Tự động chia cho Sale A" ngay lúc vào. Tính nó
    // là mốc chạm đầu thì mọi lead trên prod đều "đã liên hệ ngay khi vào" —
    // đúng cái làm-đẹp-giả, chỉ khác là làm một lần cho toàn bộ dữ liệu cũ.
    const hoatDong = [
      act("NOTE", "2026-08-01T02:00:00Z", { system: true }),
      act("CALL", "2026-08-05T02:00:00Z"),
    ];

    expect(firstLeadOutreachAt(hoatDong, LEAD_OUTREACH_TYPES)).toEqual(
      new Date("2026-08-05T02:00:00Z"),
    );
  });

  it("chưa chạm lần nào → null (không tự rơi về `createdAt`)", () => {
    expect(firstLeadOutreachAt([], LEAD_OUTREACH_TYPES)).toBeNull();
    expect(
      firstLeadOutreachAt([act("STATUS_CHANGE", "2026-08-20T02:00:00Z")], LEAD_OUTREACH_TYPES),
    ).toBeNull();
  });

  it("🔴 danh sách loại vẫn là THAM SỐ — cùng một hàm, hai kết quả", () => {
    const hoatDong = [
      act("EMAIL", "2026-08-01T02:00:00Z"),
      act("CALL", "2026-08-10T02:00:00Z"),
    ];

    expect(firstLeadOutreachAt(hoatDong, ["CALL"] as never)).toEqual(
      new Date("2026-08-10T02:00:00Z"),
    );
    expect(firstLeadOutreachAt(hoatDong, ["CALL", "EMAIL"] as never)).toEqual(
      new Date("2026-08-01T02:00:00Z"),
    );
  });
});

// ─── Phần 3: chốt chặn nguồn — không đường nào được tự tay ghi hoạt động ─────

describe("[N-4] chốt chặn nguồn — mọi đường ghi hoạt động đi qua một cửa", () => {
  const DUONG_GHI_HOAT_DONG = [
    "app/(admin)/admin/leads/actions.ts", // bật/tắt dùng chung · tạo lịch học thử · ghi nhật ký tay · bàn giao
    "lib/lead/assign.ts", // chia luân phiên · chia lại khi sale nghỉ
    "lib/lead/auto-assign.ts", // tự chia lead mới · gán tay
    "lib/lead/dedup.ts", // phiếu trùng SĐT
    "lib/lead/intake/ingest.ts", // thêm con · ghi nội dung phiếu trùng · gán theo mã NV
    "lib/lead/status-trail-write.ts", // C-07 — dòng timeline của lượt đổi trạng thái
  ];

  it.each(DUONG_GHI_HOAT_DONG)("%s đi qua `recordLeadActivity`", (p) => {
    expect(boChuThich(doc(p))).toContain("recordLeadActivity");
  });

  it("🔴 CHỈ `activity-write.ts` được tự tay tạo `LeadActivity`", () => {
    // Chính đây là bệnh của N-4: 13 chỗ ghi, mỗi chỗ tự quyết có bump đồng hồ
    // hay không, và 10 chỗ quyết là không. Vá tay 13 chỗ chỉ dời được ngày chỗ
    // thứ 14 sinh ra.
    const viPham: string[] = [];
    const quet = (thuMuc: string) => {
      for (const e of fs.readdirSync(path.join(goc, thuMuc), { withFileTypes: true })) {
        const con = `${thuMuc}/${e.name}`;
        if (e.isDirectory()) {
          if (e.name === "node_modules" || e.name === ".next") continue;
          quet(con);
          continue;
        }
        if (!/\.tsx?$/.test(e.name) || /\.(test|spec)\.tsx?$/.test(e.name)) continue;
        // HAI CỬA GHI, cả hai là THƯ VIỆN — miễn trừ 20/09/2026 khi hợp nhất `main`.
        //
        // 🔴 NỢ-15: `main` (#301, "Lead: lịch sử tương tác đầy đủ") dựng cửa thứ hai
        // `lib/lead/tuong-tac/ghi.ts`, trong khi `test` có lưới này nói "chỉ một cửa".
        // Hai bản KHÔNG cùng ngữ nghĩa lỗi — `activity-write` vs `ghiTuongTacLead`
        // (NÉM, dùng trong transaction) vs `ghiTuongTacLeadBoQuaLoi` (nuốt lỗi, dùng
        // sau commit) — nên gộp phải đo từng nơi gọi, là một đợt riêng.
        //
        // Lưới này GIỮ ĐÚNG điều nó sinh ra để giữ: **không màn/action nào tự tay
        // `leadActivity.create`**. Vế "một nguồn duy nhất" thì đã mất — ghi ra đây để
        // người đọc sau không tưởng là đã dọn xong.
        if (con.endsWith("lib/lead/activity-write.ts")) continue;
        if (con.endsWith("lib/lead/tuong-tac/ghi.ts")) continue;
        const than = boChuThich(fs.readFileSync(path.join(goc, con), "utf8"));
        if (/\bleadActivity\.(create|createMany|upsert)\b/.test(than)) viPham.push(con);
      }
    };
    quet("lib");
    quet("app");

    expect(viPham).toEqual([]);
  });

  it("🔴 định nghĩa 'đã tiếp cận' không được tách làm hai bản", () => {
    // `hasSaleInteraction` (`lib/lead/auto-assign.ts`) đã mang SẴN đúng khái
    // niệm này ở phía DB: lead đã có tương tác của sale thì KHÔNG auto-chia
    // lại. Hai bản định nghĩa cùng một câu hỏi mà lệch nhau là bug câm — nên
    // khi chủ dự án chốt danh sách, test này đỏ và bắt sửa cả hai chỗ.
    const than = boChuThich(doc("lib/lead/auto-assign.ts"));
    const thanHam = than.slice(than.indexOf("export async function hasSaleInteraction"));
    const loai = new Set(
      [...thanHam.slice(0, thanHam.indexOf("\n}")).matchAll(/"([A-Z_]+)"/g)].map((mm) => mm[1]),
    );

    expect([...loai].sort()).toEqual([...LEAD_OUTREACH_TYPES].sort());
  });
});

// ─── Phần 4 (S-3): dấu "dòng máy" phải THẬT, không thì bộ lọc chạm khách vô nghĩa
/**
 * S-3 — `isLeadOutreach` phân biệt người/máy bằng ĐÚNG MỘT dấu: `metadata.system
 * === true`. Trước ticket này dấu đó chỉ được đóng ở 2 trong 10 dòng do máy ghi
 * (`lib/lead/auto-assign.ts`). Tám dòng còn lại — chia luân phiên, chia lại khi
 * sale nghỉ, phiếu trùng SĐT, phiếu thêm con, ghi nội dung phiếu trùng, gán theo
 * mã NV, bật/tắt "dùng chung", ghi chú hẹn học thử — là `NOTE` KHÔNG dấu.
 *
 * Trước S-3 điều đó chỉ làm `hasSaleInteraction` nhận nhầm (lead vừa được máy
 * chia đã bị coi là "sale đã tương tác" ⇒ không auto-chia lại nữa). Sau S-3 nó
 * còn TẮT LUÔN cảnh báo SLA-3 ngay lúc lead vào hệ thống — tức thay một chuông
 * kêu mãi bằng một chuông không bao giờ kêu. Nên dấu phải đóng đủ TRƯỚC, và test
 * này giữ cho nó đủ mãi.
 */
describe("[S-3] mọi dòng hoạt động do MÁY ghi đều mang dấu `SYSTEM_ACTIVITY_META`", () => {
  /** Cắt ra từng khối đối số của `recordLeadActivity({ … })` bằng đếm ngoặc. */
  const khoiGoi = (than: string): string[] => {
    const ra: string[] = [];
    const moc = "recordLeadActivity({";
    for (let i = than.indexOf(moc); i !== -1; ) {
      let sau = 0;
      let j = than.indexOf("{", i);
      for (; j < than.length; j++) {
        if (than[j] === "{") sau++;
        else if (than[j] === "}" && --sau === 0) break;
      }
      ra.push(than.slice(i, j + 1));
      i = than.indexOf(moc, j);
    }
    return ra;
  };

  // Bốn tệp KHÔNG có đường người ghi: mọi dòng trong đó đều do máy sinh.
  const TEP_TOAN_MAY = [
    "lib/lead/assign.ts", // chia luân phiên · chia lại khi sale nghỉ
    "lib/lead/auto-assign.ts", // tự chia lead mới · gán tay
    "lib/lead/dedup.ts", // phiếu trùng SĐT
    "lib/lead/intake/ingest.ts", // thêm con · nội dung phiếu trùng · gán theo mã NV
  ];

  it.each(TEP_TOAN_MAY)("%s — mọi lượt ghi đều đóng dấu máy", (p) => {
    const khoi = khoiGoi(boChuThich(doc(p)));
    expect(khoi.length).toBeGreaterThan(0);
    const thieu = khoi.filter((k) => !k.includes("SYSTEM_ACTIVITY_META"));
    expect(thieu).toEqual([]);
  });

  it("🔴 màn lead: hai dòng máy có dấu, dòng NGƯỜI ghi thì KHÔNG", () => {
    // `app/(admin)/admin/leads/actions.ts` trộn cả hai loại nên không kẹp cả tệp
    // được. Kẹp đích danh: nhầm chiều nào cũng hỏng — đóng dấu lên dòng người là
    // vứt mốc chạm khách thật, quên dấu ở dòng máy là tắt chuông hộ người.
    const khoi = khoiGoi(boChuThich(doc("app/(admin)/admin/leads/actions.ts")));
    const timDuy = (khoa: string) => {
      const hop = khoi.filter((k) => k.includes(khoa));
      expect(hop).toHaveLength(1);
      return hop[0]!;
    };

    expect(timDuy("dùng chung")).toContain("SYSTEM_ACTIVITY_META");
    expect(timDuy("[Trải nghiệm]")).toContain("SYSTEM_ACTIVITY_META");
    // Nhật ký tay của Sale (loại do người chọn: Gọi / Nhắn / Email / Ghi chú).
    expect(timDuy("parsedType.data")).not.toContain("SYSTEM_ACTIVITY_META");
  });

  it("🔴 `SYSTEM_ACTIVITY_META` là MỘT hằng, không phải chữ `{ system: true }` chép tay", () => {
    // Chép tay thì mỗi chỗ tự do gõ `{ system: 1 }` hay `{ isSystem: true }` và
    // `isSystemWrittenActivity` lặng lẽ trả false — hỏng câm đúng loại đang chữa.
    for (const p of [...TEP_TOAN_MAY, "app/(admin)/admin/leads/actions.ts"]) {
      expect(boChuThich(doc(p))).not.toMatch(/\{\s*system:\s*true\s*\}/);
    }
    expect(SYSTEM_ACTIVITY_META).toEqual({ system: true });
    expect(isSystemWrittenActivity(SYSTEM_ACTIVITY_META)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S-9 (27/08/2026) — cờ `lamMoiDongHo`: tách DÒNG NHẬT KÝ khỏi ĐỒNG HỒ SLA.
//
// Chốt của chủ dự án: người không phụ trách phiếu vẫn ghi chú được, chỉ là ghi
// chú của họ không làm mới mốc SLA. Nên hàm này phải làm được đúng một việc rất
// dễ làm sai: LƯU dòng, mà KHÔNG chạm hai cột đồng hồ.
// ─────────────────────────────────────────────────────────────────────────────
describe("[S-9] lamMoiDongHo=false — dòng nhật ký LƯU, đồng hồ đứng im", () => {
  let m: ReturnType<typeof taoMock>;
  const MOC = new Date("2026-08-27T03:00:00.000Z");

  beforeEach(() => {
    m = taoMock();
    m.create.mockResolvedValue({ id: "act-9", createdAt: MOC });
    m.update.mockResolvedValue({ id: "lead-1" });
    m.updateMany.mockResolvedValue({ count: 1 });
  });

  const ghi = (lamMoiDongHo?: boolean) =>
    recordLeadActivity({
      tx: m.tx,
      leadId: "lead-1",
      actorId: "u-nguoi-la",
      actorName: "Đồng nghiệp",
      type: "CALL",
      content: "Nghe máy hộ: phụ huynh hỏi lịch khai giảng",
      ...(lamMoiDongHo === undefined ? {} : { lamMoiDongHo }),
    });

  it("dòng hoạt động vẫn được tạo, đầy đủ nội dung", async () => {
    const row = await ghi(false);

    expect(m.create).toHaveBeenCalledTimes(1);
    expect(m.create.mock.calls[0][0].data).toMatchObject({
      leadId: "lead-1",
      content: "Nghe máy hộ: phụ huynh hỏi lịch khai giảng",
    });
    expect(row.id).toBe("act-9");
  });

  it("KHÔNG bump `lastActivityAt` (SLA-4 + cột 'chưa tiếp cận lại' giữ nguyên)", async () => {
    await ghi(false);
    expect(m.update).not.toHaveBeenCalled();
  });

  it("KHÔNG đóng `firstContactAt` — chuông SLA-3 còn kêu", async () => {
    // Mốc này chỉ ghi được MỘT lần và không có đường undo, nên đóng nhầm là mất
    // hẳn cảnh báo của phiếu đó, vĩnh viễn.
    await ghi(false);
    expect(m.updateMany).not.toHaveBeenCalled();
  });

  it("mặc định (không truyền cờ) vẫn làm mới đồng hồ — mọi đường ghi cũ không đổi", async () => {
    await ghi(undefined);
    expect(m.update).toHaveBeenCalledTimes(1);
    expect(m.updateMany).toHaveBeenCalledTimes(1);
  });

  it("truyền `true` tường minh cũng vậy", async () => {
    await ghi(true);
    expect(m.update).toHaveBeenCalledTimes(1);
    expect(m.updateMany).toHaveBeenCalledTimes(1);
  });
});

describe("[S-9] chỉ đường ghi chú của người-không-phụ-trách mới tắt đồng hồ", () => {
  it("KHÔNG đường ghi nào khác truyền `lamMoiDongHo`", () => {
    // Cờ này nguy hiểm theo chiều ngược lại: truyền `false` ở một đường chạm
    // khách THẬT là làm phiếu treo mãi trong danh sách "chưa tiếp cận" mà không
    // báo gì. Giữ danh sách chỗ dùng ngắn và tường minh.
    const boChuThich = (s: string) =>
      s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const duocPhep = new Set([
      path.join("app", "(admin)", "admin", "leads", "actions.ts"),
      // S5/ZaloCRM — tin Sale gửi khách qua nick Zalo cá nhân. Cùng câu hỏi, cùng
      // hàm luật (`duocLamMoiDongHoChamSoc`), chỉ khác chỗ vào: đường webhook
      // KHÔNG có phiên đăng nhập nên `coQuyenDieuPhoi` được truyền vào chứ không
      // hỏi được từ session. Xem `quyetDinhMocNhanTin` để biết bốn ca của luật.
      path.join("lib", "integrations", "zalocrm", "lead-timeline.ts"),
    ]);
    const pham: string[] = [];
    const di = (thuMuc: string) => {
      for (const m of fs.readdirSync(thuMuc, { withFileTypes: true })) {
        if (m.name.startsWith(".") || m.name === "node_modules") continue;
        const p = path.join(thuMuc, m.name);
        if (m.isDirectory()) di(p);
        else if (/\.tsx?$/.test(m.name) && !/\.test\.tsx?$/.test(m.name)) {
          if (p === path.join("lib", "lead", "activity-write.ts")) continue;
          if (boChuThich(fs.readFileSync(p, "utf8")).includes("lamMoiDongHo")) pham.push(p);
        }
      }
    };
    for (const goc of ["app", "lib", "components"]) di(goc);
    expect(pham.filter((p) => !duocPhep.has(path.normalize(p)))).toEqual([]);
  });
});
