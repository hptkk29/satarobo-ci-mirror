// tests/cham-cong/timelog.spec.ts — L4: vé 120s tiêu nguyên tử + ghi lượt có cờ + ngày được tính lại.
import { PrismaClient } from "@prisma/client";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedShiftTemplates } from "../../lib/cham-cong/seed-core";
import { vnDateOnly } from "../../lib/time/vn";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL) /* từ chối cả tunnel VPS (CONG_TUNNEL_VPS) */;
const d = isLocal ? describe : describe.skip;
const TAG = "cc-timelog";

d("vé + ghi lượt + tính lại", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let userId = "";
  let centerId = "";
  let wlId = "";
  let mod: typeof import("../../lib/cham-cong/timelog");
  let rc: typeof import("../../lib/cham-cong/recompute");

  beforeAll(async () => {
    mod = await import("../../lib/cham-cong/timelog");
    rc = await import("../../lib/cham-cong/recompute");
    await seedShiftTemplates(db);
    const old = await db.user.findMany({ where: { email: { endsWith: `@${TAG}.test` } }, select: { id: true } });
    const ids = old.map((u) => u.id);
    await db.staffAttendanceDay.deleteMany({ where: { userId: { in: ids } } });
    await db.staffTimeLog.deleteMany({ where: { userId: { in: ids } } });
    await db.attendanceTicket.deleteMany({ where: { userId: { in: ids } } });
    await db.shiftAssignment.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    const c = await db.center.upsert({ where: { slug: `${TAG}-cs1` }, update: {}, create: { slug: `${TAG}-cs1`, name: "CS1 timelog", address: "x", code: `${TAG}-CS1` }, select: { id: true } });
    centerId = c.id;
    const wl = await db.workLocation.upsert({
      where: { code: `${TAG}-CS1` },
      update: { latitude: 16.0471, longitude: 108.2062, radiusMeters: 100, geofenceEnabled: true, isActive: true },
      create: { code: `${TAG}-CS1`, name: "Quầy CS1", centerId, latitude: 16.0471, longitude: 108.2062, radiusMeters: 100, geofenceEnabled: true },
      select: { id: true },
    });
    wlId = wl.id;
    userId = (await db.user.create({ data: { email: `nv@${TAG}.test`, name: "NV timelog", role: "SALES_CSM", roles: ["SALES_CSM"], password: "x", centerId }, select: { id: true } })).id;
  });
  afterAll(async () => {
    await db.staffAttendanceDay.deleteMany({ where: { userId } });
    await db.staffTimeLog.deleteMany({ where: { userId } });
    await db.attendanceTicket.deleteMany({ where: { userId } });
    await db.shiftAssignment.deleteMany({ where: { userId } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  });

  // ══ ĐƯỜNG CÔNG TÁC (phần A, 15/09/2026) ═══════════════════════════════════════════════
  //
  // `workLocationId: null` — không mã QR, không điểm chấm, không geofence. Bốn ca dưới đây
  // canh đúng bốn khẳng định của bản vá, và mỗi ca tự dọn lượt của mình (luật 18).
  describe("lượt CÔNG TÁC — workLocationId = null", () => {
    const homNay = () => vnDateOnly(new Date());
    const donDep = async () => {
      await db.staffTimeLog.deleteMany({ where: { userId } });
      await db.staffAttendanceDay.deleteMany({ where: { userId } });
    };
    // 🔴 DỌN SAU khối này, không chỉ dọn TRƯỚC mỗi ca.
    //
    // Bản đầu chỉ có `donDep()` ở đầu từng ca, và ca "điểm ĐÃ bật định vị" đứng SAU khối
    // này lập tức ĐỎ với `TRUNG_2_PHUT`: lượt CHECK_IN cuối của tôi còn nằm đó, cách lượt
    // của ca kia chưa tới 2 phút. Đúng luật 18 — và đúng chữ ký của nó: ca vô tội đứng sau
    // là ca báo lỗi.
    afterAll(async () => {
      await donDep();
      await db.shiftAssignment.deleteMany({ where: { userId } });
      await db.center.deleteMany({ where: { slug: `${TAG}-cs2` } });
    });

    it("ghi được KHÔNG cần điểm chấm, và centerId = CƠ SỞ NHÀ của người đó", async () => {
      await donDep();
      const r = await mod.recordTimeLog({
        userId,
        workLocationId: null,
        direction: "CHECK_IN",
        latitude: 16.05,
        longitude: 108.22,
        accuracyMeters: 12,
        source: "CONG_TAC",
      });
      expect(r.ok, "đường công tác KHÔNG được bị từ chối vì thiếu điểm chấm").toBe(true);
      if (!r.ok) return;
      // Chốt của chủ dự án: "centerId = CƠ SỞ TRỰC THUỘC của người đó (chi phí về nơi họ
      // thuộc về)". Người này có `User.centerId = centerId` ⇒ `resolveHomeCenter` trả về nó.
      expect(r.centerId).toBe(centerId);

      const log = await db.staffTimeLog.findUnique({
        where: { id: r.logId },
        select: {
          workLocationId: true, source: true, centerId: true,
          latitude: true, longitude: true, accuracyMeters: true,
          distanceMeters: true, withinGeofence: true, flags: true,
        },
      });
      expect(log!.workLocationId).toBeNull();
      // `source` riêng — chủ dự án chốt "có source riêng trong StaffTimeLog để phân biệt được".
      expect(log!.source).toBe("CONG_TAC");
      // TOẠ ĐỘ VẪN LƯU dù không có điểm chấm để so.
      expect(log!.latitude).toBeCloseTo(16.05, 4);
      expect(log!.accuracyMeters).toBe(12);
      // Không có điểm chấm ⇒ không đo được khoảng cách. `null`, KHÔNG phải 0.
      expect(log!.distanceMeters).toBeNull();
      expect(log!.withinGeofence).toBeNull();
      // Không cờ vị trí nào: đường này KHÔNG tự gắn cờ (chủ dự án: "hiện toạ độ cho quản lý
      // rà, không tự gắn cờ").
      expect(log!.flags).not.toContain("NGOAI_VUNG");
      expect(log!.flags).not.toContain("CHUA_TOA_DO");
      expect(log!.flags).not.toContain("THIEU_GPS");
    });

    it("KHÔNG lấy được vị trí vẫn GHI, chỉ gắn cờ THIEU_GPS", async () => {
      await donDep();
      // "Người ở chỗ sóng kém mà không chấm được là hỏng đúng mục đích."
      const r = await mod.recordTimeLog({
        userId, workLocationId: null, direction: "CHECK_IN",
        latitude: null, longitude: null, source: "CONG_TAC",
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.flags).toContain("THIEU_GPS");
    });

    it("GPS lệch quá 200m vẫn ghi, gắn cờ GPS_KEM_CHINH_XAC", async () => {
      await donDep();
      const r = await mod.recordTimeLog({
        userId, workLocationId: null, direction: "CHECK_IN",
        latitude: 16.05, longitude: 108.22, accuracyMeters: 950, source: "CONG_TAC",
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.flags).toContain("GPS_KEM_CHINH_XAC");
      expect(r.flags).not.toContain("THIEU_GPS");
    });

    // 🔑 `centerId` lấy từ CƠ SỞ NHÀ, KHÔNG phải cơ sở ô ca được xếp.
    //
    // Ca này cố ý cho hai giá trị KHÁC NHAU. Bản đầu của fixture để ô ca cùng cơ sở với
    // người, và lượt cấy `wl?.centerId ?? assignment?.centerId ?? home.centerId` ra XANH —
    // hai đường cho cùng một kết quả nên chẳng phân biệt được gì (luật 8, tầng sâu).
    it("centerId = cơ sở NHÀ, kể cả khi ô ca hôm nay được xếp ở cơ sở KHÁC", async () => {
      await donDep();
      const cs2 = await db.center.upsert({
        where: { slug: `${TAG}-cs2` },
        update: {},
        create: { slug: `${TAG}-cs2`, name: "CS2 timelog", address: "y", code: `${TAG}-CS2` },
        select: { id: true },
      });
      const tpl = await db.shiftTemplate.findFirst({ where: { code: "NG" }, select: { id: true } });
      await db.shiftAssignment.create({
        data: {
          userId, centerId: cs2.id, workDate: homNay(), templateId: tpl!.id, templateCode: "NG",
          placeMode: "OFFSITE", attendanceMode: "REQUIRED", soCapQuetKyVong: 1,
          segments: [], status: "ACTIVE", source: "MANUAL",
        },
      });
      const r = await mod.recordTimeLog({
        userId, workLocationId: null, direction: "CHECK_IN", source: "CONG_TAC",
        latitude: 16.05, longitude: 108.22,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      // "Chi phí về nơi họ THUỘC VỀ", không phải nơi ca được xếp.
      expect(r.centerId).toBe(centerId);
      expect(r.centerId).not.toBe(cs2.id);
      await db.shiftAssignment.deleteMany({ where: { userId } });
    });

    // Ca AT_UNITS + KHÔNG có điểm chấm: nhánh `SAI_NOI_LAM` đọc `wl.orgUnitId`/`wl.centerId`,
    // nên thiếu cổng `wl != null` là NÉM LỖI chứ không phải gắn cờ nhầm. Ca này canh đúng đó.
    it("ca AT_UNITS nhưng lượt KHÔNG có điểm chấm → không SAI_NOI_LAM, không ném lỗi", async () => {
      await donDep();
      const tpl = await db.shiftTemplate.findFirst({ where: { code: "S" }, select: { id: true } });
      await db.shiftAssignment.create({
        data: {
          userId, centerId, workDate: homNay(), templateId: tpl!.id, templateCode: "S",
          placeMode: "AT_UNITS", attendanceMode: "REQUIRED", soCapQuetKyVong: 1,
          segments: [], status: "ACTIVE", source: "MANUAL",
        },
      });
      const r = await mod.recordTimeLog({
        userId, workLocationId: null, direction: "CHECK_IN", source: "CONG_TAC",
        latitude: 16.05, longitude: 108.22,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.flags).not.toContain("SAI_NOI_LAM");
      await db.shiftAssignment.deleteMany({ where: { userId } });
    });

    it("KHÔNG gắn SAI_NOI_LAM — ca công tác không có nơi nào để sai", async () => {
      await donDep();
      // Vế đối xứng (luật 16): ca công tác là OFFSITE nên nhánh SAI_NOI_LAM không chạy, dù
      // người đó đang đứng ở đâu.
      const tpl = await db.shiftTemplate.findFirst({ where: { code: "NG" }, select: { id: true } });
      await db.shiftAssignment.create({
        data: {
          userId, centerId, workDate: homNay(), templateId: tpl!.id, templateCode: "NG",
          placeMode: "OFFSITE", attendanceMode: "REQUIRED", soCapQuetKyVong: 1,
          segments: [], status: "ACTIVE", source: "MANUAL",
        },
      });
      const r = await mod.recordTimeLog({
        userId, workLocationId: null, direction: "CHECK_IN",
        latitude: 21.03, longitude: 105.85, source: "CONG_TAC", // Hà Nội, cách CS1 ~760km
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.flags).not.toContain("SAI_NOI_LAM");
      // Có ca xếp ⇒ cũng không phải "chấm ngoài lịch".
      expect(r.flags).not.toContain("CHAM_NGOAI_LICH");
      await db.shiftAssignment.deleteMany({ where: { userId } });
    });
  });

  it("vé: cấp → tiêu được đúng 1 lần; sai nonce / dùng lại / hết hạn đều fail-closed", async () => {
    const t = await mod.issueTicket({ userId, workLocationId: wlId });
    expect(await mod.consumeTicket({ ticketId: t.ticketId, nonce: "sai", userId })).toEqual({ ok: false, reason: "TICKET_INVALID" });
    expect(await mod.consumeTicket({ ticketId: t.ticketId, nonce: t.nonce, userId })).toEqual({ ok: true, workLocationId: wlId });
    expect(await mod.consumeTicket({ ticketId: t.ticketId, nonce: t.nonce, userId })).toEqual({ ok: false, reason: "TICKET_REUSED" });
    const t2 = await mod.issueTicket({ userId, workLocationId: wlId });
    await db.attendanceTicket.update({ where: { id: t2.ticketId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await mod.consumeTicket({ ticketId: t2.ticketId, nonce: t2.nonce, userId })).toEqual({ ok: false, reason: "TICKET_EXPIRED" });
  });

  it("điểm ĐÃ bật định vị: NGOÀI VÙNG bị chặn, THIẾU GPS thì GHI + gắn cờ", async () => {
    // Điểm ĐÃ bật định vị vẫn CHẶN người đứng ngoài vùng, và đảo ấy (so với Q-07 cũ "ghi luôn
    // + gắn cờ") vẫn nguyên: mã QR tĩnh dán ở quầy thì ai chụp ảnh cũng quét được, nên định vị
    // là lớp bảo vệ CÒN LẠI duy nhất.
    //
    // ⚠️ NHƯNG THIẾU TOẠ ĐỘ THÌ KHÔNG CÒN BỊ CHẶN — đảo 16/09/2026.
    //
    // Đo prod hôm ấy: 53 lượt bị từ chối vì `NO_GPS`, đang xảy ra hằng ngày. Người bị chặn
    // không chấm được, mà vé thì đã tiêu. Chốt của chủ dự án: *"Không mất lớp bảo vệ nào: kẻ
    // gian lận có toạ độ (giả) chứ không thiếu toạ độ."* Chặn người KHÔNG có toạ độ chỉ chặn
    // được người trung thực đứng chỗ sóng kém; kẻ gian gửi lên một cặp toạ độ bịa và bị vế
    // NGOÀI VÙNG chặn — vế ấy giữ nguyên, và ca này canh cả hai vế cạnh nhau đúng vì thế.
    const r1 = await mod.recordTimeLog({ userId, workLocationId: wlId, direction: "CHECK_IN", latitude: 16.0472, longitude: 108.2063 });
    expect(r1.ok).toBe(true);
    if (r1.ok) expect(r1.flags).toEqual(["CHAM_NGOAI_LICH"]); // chưa xếp ca hôm nay

    // VẾ GIỮ NGUYÊN — lớp bảo vệ thật.
    const r2 = await mod.recordTimeLog({ userId, workLocationId: wlId, direction: "CHECK_IN", latitude: 16.06, longitude: 108.22 });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.rejectReason).toBe("OUTSIDE_GEOFENCE");

    // VẾ ĐẢO — thiếu toạ độ: GHI ĐƯỢC, và mang cờ để Quản lý rà.
    const r3 = await mod.recordTimeLog({ userId, workLocationId: wlId, direction: "CHECK_OUT" });
    expect(r3.ok, "thiếu GPS KHÔNG còn bị chặn — xem chốt 16/09").toBe(true);
    if (r3.ok) expect(r3.flags).toContain("THIEU_GPS");

    // Trùng 2′ vẫn là CỜ chứ không phải chặn — người bấm nhầm hai lần không bị mất lượt.
    //
    // ⚠️ CHIỀU của lượt này phải là CHECK_OUT, và đó là HỆ QUẢ BẬC HAI của bản vá 16/09.
    //
    // Luật trùng 2′ so với lượt ACCEPTED NGAY TRƯỚC ĐÓ và đòi CÙNG CHIỀU (`timelog.ts`:
    // `last.direction === input.direction`) — nó canh việc bấm hai lần một nút, không canh
    // vào-ra-vào. Trước bản vá, `r3` (thiếu GPS) bị CHẶN nên không để lại dòng nào, và lượt
    // ngay trước `r4` vẫn là `r1` cùng chiều CHECK_IN. Nay `r3` ĐƯỢC GHI, nên lượt ngay
    // trước `r4` là một CHECK_OUT — khác chiều, không còn là trùng.
    //
    // Đổi chiều `r4` thay vì nới luật: luật vẫn đúng, chỉ có kịch bản đổi vì dòng giữa nay
    // tồn tại. Sửa luật ở đây là đi vá một thứ không hỏng.
    const r4 = await mod.recordTimeLog({ userId, workLocationId: wlId, direction: "CHECK_OUT", latitude: 16.0472, longitude: 108.2063 });
    expect(r4.ok).toBe(true);
    if (r4.ok) expect(r4.flags).toContain("TRUNG_2_PHUT");

    const rows = await db.staffTimeLog.findMany({ where: { userId, result: "ACCEPTED" } });
    // r1 + r3 + r4. Chỉ lượt NGOÀI VÙNG không để lại dòng ACCEPTED nào.
    expect(rows).toHaveLength(3);
    expect(rows.every((x) => x.centerId === centerId)).toBe(true);
  });

  it("điểm CHƯA khai toạ độ: chạy như cũ — ghi + gắn cờ, không chặn ai", async () => {
    // Chặn vô điều kiện là khoá cửa cả công ty: `geofenceEnabled` mặc định false và toạ độ mặc
    // định null, nên điểm chưa đo thực địa sẽ từ chối mọi người. Khoá hành vi đó lại ở đây.
    const c2 = await db.center.upsert({ where: { slug: `${TAG}-cs3` }, update: {}, create: { slug: `${TAG}-cs3`, name: "CS3 timelog", address: "x", code: `${TAG}-CS3` }, select: { id: true } });
    const wl2 = await db.workLocation.upsert({
      where: { code: `${TAG}-CS3` },
      update: { latitude: null, longitude: null, geofenceEnabled: false, isActive: true },
      create: { code: `${TAG}-CS3`, name: "Quầy CS3", centerId: c2.id, geofenceEnabled: false },
      select: { id: true },
    });
    const u2 = await db.user.create({ data: { email: `nv2@${TAG}.test`, name: "NV chưa toạ độ", role: "SALES_CSM", roles: ["SALES_CSM"], password: "x", centerId: c2.id }, select: { id: true } });
    try {
      const r = await mod.recordTimeLog({ userId: u2.id, workLocationId: wl2.id, direction: "CHECK_IN" });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.flags).toContain("CHUA_TOA_DO");
    } finally {
      await db.staffAttendanceDay.deleteMany({ where: { userId: u2.id } });
      await db.staffTimeLog.deleteMany({ where: { userId: u2.id } });
      await db.user.deleteMany({ where: { id: u2.id } });
    }
  });

  it("có ca S tại cơ sở khác → SAI_NOI_LAM; tính lại ngày ra dòng có cờ chuyển tiếp", async () => {
    const other = await db.center.upsert({ where: { slug: `${TAG}-cs2` }, update: {}, create: { slug: `${TAG}-cs2`, name: "CS2 timelog", address: "x", code: `${TAG}-CS2` }, select: { id: true } });
    const tplS = await db.shiftTemplate.findFirstOrThrow({ where: { code: "S", centerId: null }, select: { id: true } });
    const workDate = (await db.staffTimeLog.findFirstOrThrow({ where: { userId }, select: { workDate: true } })).workDate;
    await db.shiftAssignment.create({ data: { userId, centerId: other.id, workDate, templateId: tplS.id, templateCode: "S", segments: [{ start: "07:45", end: "11:30", kind: "WORK", orgUnitIds: [] }], placeMode: "AT_UNITS", attendanceMode: "REQUIRED", dayCredit: 1, source: "MANUAL" } });
    const r = await mod.recordTimeLog({ userId, workLocationId: wlId, direction: "CHECK_OUT", latitude: 16.0471, longitude: 108.2062, now: new Date(Date.now() + 10 * 60_000) });
    expect(r.ok && r.flags.includes("SAI_NOI_LAM")).toBe(true);
    await rc.recomputeAttendanceDay(userId, workDate);
    const day = await db.staffAttendanceDay.findUniqueOrThrow({ where: { userId_workDate: { userId, workDate } } });
    expect(day.flags).toContain("SAI_NOI_LAM");
    expect(day.dayCreditEarned).toBe(1); // T-01: cờ, không trừ
    // Event hàng đợi đã được xếp
    const ev = await db.domainEvent.count({ where: { type: "hr.attendance_day_dirty", payloadJson: { path: ["userId"], equals: userId } } });
    expect(ev).toBeGreaterThan(0);
  });
  // ── HỘI SỞ quét ở CS1 (08/09/2026) — KHOÁ LẠI LÝ DO cờ đang đúng ────────────────
  //
  // Hôm nay người Hội sở quét ở CS1 nhận cờ `CHAM_NGOAI_LICH`. Đó là TÌNH CỜ, không
  // phải thiết kế: prod có 0 `ShiftAssignment` nên ai quét cũng "ngoài lịch". Cờ đó nói
  // về LỊCH ("hôm nay không có ca nào"), không nói gì về NƠI CHỐN.
  //
  // Hai ca dưới dựng ca làm THẬT cho người Hội sở để hành vi không lặng lẽ đổi nghĩa
  // vào ngày Hội sở có ca đầu tiên.
  describe("người Hội sở quét ở cơ sở khác", () => {
    let hoUserId = "";
    let hoCenterId = "";
    const ngay = () => new Date(Date.now() + 30 * 60_000);

    beforeAll(async () => {
      const ho = await db.center.upsert({
        where: { slug: `${TAG}-ho` },
        update: {},
        create: { slug: `${TAG}-ho`, name: "Hội sở timelog", address: "x", code: `${TAG}-HO` },
        select: { id: true },
      });
      hoCenterId = ho.id;
      hoUserId = (
        await db.user.create({
          data: { email: `ho@${TAG}.test`, name: "NV Hội sở", role: "HR", roles: ["HR"], password: "x", centerId: hoCenterId },
          select: { id: true },
        })
      ).id;
    });

    afterAll(async () => {
      await db.staffAttendanceDay.deleteMany({ where: { userId: hoUserId } });
      await db.staffTimeLog.deleteMany({ where: { userId: hoUserId } });
      await db.shiftAssignment.deleteMany({ where: { userId: hoUserId } });
      await db.user.deleteMany({ where: { id: hoUserId } });
    });

    async function xepCa(placeMode: "AT_UNITS" | "ANY_CENTER", workDate: Date) {
      const tpl = await db.shiftTemplate.findFirstOrThrow({ where: { code: "S", centerId: null }, select: { id: true } });
      await db.shiftAssignment.deleteMany({ where: { userId: hoUserId } });
      await db.shiftAssignment.create({
        data: {
          userId: hoUserId,
          centerId: hoCenterId, // ca ở HỘI SỞ
          workDate,
          templateId: tpl.id,
          templateCode: "S",
          segments: [{ start: "07:45", end: "11:30", kind: "WORK", orgUnitIds: [] }],
          placeMode,
          attendanceMode: "REQUIRED",
          dayCredit: 1,
          source: "MANUAL",
        },
      });
    }

    it("ca AT_UNITS ở Hội sở, quét tại CS1 → SAI_NOI_LAM (hành vi ĐÚNG, khoá lại)", async () => {
      const now = ngay();
      // ⚠️ NGÀY VN, không phải ngày UTC. `recordTimeLog` chốt ngày làm việc bằng
      // `vnDateOnly(now)` (lib/cham-cong/timelog.ts:82); test dựng theo UTC thì hai bên
      // lệch một ngày mỗi khi UTC ≥ 17:00 (VN đã sang ngày mới) — ca xếp cho hôm qua,
      // lượt quét rơi vào hôm nay, và cờ CHAM_NGOAI_LICH bật đúng theo luật.
      // Đo 08/09: CI xanh ở run 14:17Z, đỏ ở 15:49Z và 15:58Z — `now + 90'` vượt 17:00Z.
      const workDate = vnDateOnly(now);
      await xepCa("AT_UNITS", workDate);
      const r = await mod.recordTimeLog({
        userId: hoUserId,
        workLocationId: wlId,
        direction: "CHECK_IN",
        latitude: 16.0471,
        longitude: 108.2062,
        now,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.flags).toContain("SAI_NOI_LAM");
      // CÓ ca ⇒ KHÔNG phải "ngoài lịch". Hai cờ nói hai chuyện khác nhau.
      expect(r.flags).not.toContain("CHAM_NGOAI_LICH");
      // Log ghi NƠI QUÉT, không phải nơi trực thuộc.
      expect(r.centerId).toBe(centerId);
    });

    // ✅ KHÔNG CỜ NÀO LÀ HÀNH VI ĐÚNG — chốt vận hành 08/09/2026.
    //
    // Từng có đề xuất thêm cờ `KHAC_CO_SO_TRUC_THUOC` cho ca "quét ở cơ sở khác nơi
    // trực thuộc". ĐÃ BỎ, vì thực tế vận hành làm nó thành nhiễu chứ không phải tín hiệu:
    //
    //   · văn phòng Hội sở đang đặt NGAY TẠI CS1, và có thể dời bất cứ lúc nào;
    //   · hầu hết nhân sự làm ở NHIỀU cơ sở — trưởng phòng ở HO vẫn dạy lớp ở CS1/CS2,
    //     giáo viên trực CS1 vẫn có buổi ở CS2.
    //
    // ⇒ "quét ở cơ sở khác nơi trực thuộc" là chuyện BÌNH THƯỜNG; gắn cờ là bật gần như
    // mọi lượt quét. Nơi quét được ghi như DỮ LIỆU (`StaffTimeLog.centerId`), không gắn cờ.
    //
    // Cờ chỉ dành cho việc BẤT THƯỜNG: `SAI_NOI_LAM` khi ca nói rõ `AT_UNITS` mà điểm
    // chấm không thuộc đơn vị cho phép (xem ca ngay trên).
    it("ca ANY_CENTER ở Hội sở, quét tại CS1 → KHÔNG cờ nào (ĐÚNG: nơi quét là dữ liệu, không phải cờ)", async () => {
      const now = new Date(Date.now() + 90 * 60_000);
      // ⚠️ NGÀY VN, không phải ngày UTC. `recordTimeLog` chốt ngày làm việc bằng
      // `vnDateOnly(now)` (lib/cham-cong/timelog.ts:82); test dựng theo UTC thì hai bên
      // lệch một ngày mỗi khi UTC ≥ 17:00 (VN đã sang ngày mới) — ca xếp cho hôm qua,
      // lượt quét rơi vào hôm nay, và cờ CHAM_NGOAI_LICH bật đúng theo luật.
      // Đo 08/09: CI xanh ở run 14:17Z, đỏ ở 15:49Z và 15:58Z — `now + 90'` vượt 17:00Z.
      const workDate = vnDateOnly(now);
      await xepCa("ANY_CENTER", workDate);
      const r = await mod.recordTimeLog({
        userId: hoUserId,
        workLocationId: wlId,
        direction: "CHECK_IN",
        latitude: 16.0471,
        longitude: 108.2062,
        now,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.flags).not.toContain("SAI_NOI_LAM");
      expect(r.flags).not.toContain("CHAM_NGOAI_LICH");
      // Ghi được, và gán về NƠI QUÉT — đây là nửa đúng của cặp "nơi quét vs nơi trực thuộc".
      expect(r.centerId).toBe(centerId);
      expect(r.centerId).not.toBe(hoCenterId);
    });
  });
});
