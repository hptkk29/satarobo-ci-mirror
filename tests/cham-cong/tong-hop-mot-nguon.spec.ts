// tests/cham-cong/tong-hop-mot-nguon.spec.ts — CỔNG luật 12b cho mục 1.
//
// Khẳng định DUY NHẤT: con số admin thấy (`buildPeriodSummary`) và con số site giáo viên thấy
// (`getMyAttendanceDays` → `gopNgayCong`) là CÙNG MỘT SỐ, trên cùng dữ liệu.
//
// Vì sao cần dù hai bên đã gọi chung một hàm: chúng gọi chung *hôm nay*. Ba lần trước cũng
// từng "chung nguồn" cho tới khi một trang thêm một phép cộng riêng cho tiện. Ca này đỏ ngay
// khi ai đó dựng bản tính thứ hai — nó canh HÀNH VI, không canh văn bản mã (luật 11).
//
// ⚠️ Ngày TUYỆT ĐỐI, không đọc đồng hồ (luật 19). Mỗi ca tự dọn dữ liệu của mình (luật 18).
import { PrismaClient } from "@prisma/client";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal =
  laDbCucBo(DB_URL) && laTenDbTest(DB_URL) /* từ chối cả tunnel VPS (CONG_TUNNEL_VPS) */;
const d = isLocal ? describe : describe.skip;
if (!isLocal)
  console.warn(
    "[cham-cong/tong-hop-mot-nguon] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test",
  );

const TAG = "cc-mot-nguon";
const utc = (y: number, m: number, dd: number) => new Date(Date.UTC(y, m - 1, dd));

d("tổng hợp công — admin và site GV đọc CÙNG MỘT SỐ", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let centerId = "";
  let userId = "";

  beforeAll(async () => {
    const c = await db.center.create({
      data: { name: `${TAG} CS`, code: "MOTNGUON1", address: "x", slug: `${TAG}-cs` },
    });
    centerId = c.id;
    const u = await db.user.create({
      data: { email: `${TAG}@x.test`, name: `${TAG} NV`, role: "TEACHER", centerId },
    });
    userId = u.id;
  });

  afterAll(async () => {
    await db.staffAttendanceDay.deleteMany({ where: { userId } });
    await db.attendancePeriod.deleteMany({ where: { centerId } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.center.deleteMany({ where: { id: centerId } });
    await db.$disconnect();
  });

  beforeEach(async () => {
    await db.staffAttendanceDay.deleteMany({ where: { userId } });
    await db.attendancePeriod.deleteMany({ where: { centerId } });
  });

  it("mọi cột tổng khớp nhau, kể cả cột mới (phút muộn, ngày đã làm)", async () => {
    // Dữ liệu CỐ Ý lệch nhau từng ngày — số tròn trịa không kiểm được gì.
    await db.staffAttendanceDay.createMany({
      data: [
        { userId, centerId, workDate: utc(2026, 9, 1), dayType: "WORK", templateCode: "HC",
          dayCreditExpected: 1, dayCreditEarned: 1, workedMinutes: 480, expectedMinutes: 480,
          lateMinutes: 7, earlyLeaveMinutes: 0, flags: ["DI_MUON"] },
        { userId, centerId, workDate: utc(2026, 9, 2), dayType: "WORK", templateCode: "HC",
          dayCreditExpected: 1, dayCreditEarned: 0, workedMinutes: 0, expectedMinutes: 480,
          lateMinutes: 0, earlyLeaveMinutes: 0, flags: ["KHONG_CO_LUOT"] },
        { userId, centerId, workDate: utc(2026, 9, 3), dayType: "WORK", templateCode: "HC",
          dayCreditExpected: 1, dayCreditEarned: 1, overrideUnits: 0.5, workedMinutes: 300,
          // Cờ theo đúng hình dạng engine ghi: `lateMinutes > 0` LUÔN kèm `DI_MUON` (đợt 2 đơn từ
          // đếm muộn theo cờ — fixture cũ để 63′ không cờ, dữ liệu engine không bao giờ sinh ra).
          expectedMinutes: 480, lateMinutes: 63, earlyLeaveMinutes: 25, flags: ["DI_MUON", "VE_SOM"] },
        { userId, centerId, workDate: utc(2026, 9, 4), dayType: "LEAVE", templateCode: "P",
          dayCreditExpected: 0, dayCreditEarned: 0, leaveUnits: 1, workedMinutes: 0 },
        { userId, centerId, workDate: utc(2026, 9, 5), dayType: "WEEKLY_OFF", templateCode: "X",
          dayCreditExpected: 0, dayCreditEarned: 0, workedMinutes: 0 },
      ],
    });

    const { buildPeriodSummary } = await import("../../lib/cham-cong/period");
    const { getMyAttendanceDays } = await import("../../lib/cham-cong/my-schedule");
    const { gopNgayCong } = await import("../../lib/cham-cong/tong-hop-cong");

    const adminRow = (await buildPeriodSummary(centerId, "2026-09")).rows.find(
      (r) => r.userId === userId,
    );
    expect(adminRow, "admin phải thấy người này").toBeTruthy();

    const myDays = await getMyAttendanceDays(userId, utc(2026, 9, 1), utc(2026, 10, 1));
    const gv = gopNgayCong(myDays.map((x) => x.gop));

    expect(gv.units).toBe(adminRow!.units);
    expect(gv.expectedUnits).toBe(adminRow!.expectedUnits);
    expect(gv.leaveUnits).toBe(adminRow!.leaveUnits);
    expect(gv.workedMinutes).toBe(adminRow!.workedMinutes);
    expect(gv.expectedMinutes).toBe(adminRow!.expectedMinutes);
    expect(gv.lateCount).toBe(adminRow!.lateCount);
    expect(gv.latePhut).toBe(adminRow!.lateMinutes);
    expect(gv.earlyLeaveCount).toBe(adminRow!.earlyLeaveCount);
    expect(gv.earlyLeavePhut).toBe(adminRow!.earlyLeaveMinutes);
    expect(gv.ngayDaLam).toBe(adminRow!.workedDays);
    expect(gv.ngayCoCa).toBe(adminRow!.scheduledDays);
    expect(gv.missingTapDays).toBe(adminRow!.missingTapDays);
    expect(gv.overrideDays).toBe(adminRow!.overrideDays);
    expect(gv.flaggedDays).toBe(adminRow!.flaggedDays);

    // Và các số phải có GIÁ TRỊ, không phải hai số 0 bằng nhau — hai phép tính cùng trả 0
    // thì ca này xanh mà chẳng chứng minh gì (luật 8 áp cho một con số).
    expect(gv.units).toBe(1.5);
    expect(gv.ngayDaLam).toBe(2);
    expect(gv.ngayCoCa).toBe(3);
    expect(gv.latePhut).toBe(70);
  });

  it("công chuẩn: null khi kỳ chưa lập, ra đúng số khi kế toán đã điền", async () => {
    const { tomTatCongThang } = await import("../../lib/cham-cong/bang-cong-gv");
    const { getMyAttendanceDays } = await import("../../lib/cham-cong/my-schedule");

    await db.staffAttendanceDay.create({
      data: { userId, centerId, workDate: utc(2026, 9, 1), dayType: "WORK", templateCode: "HC",
        dayCreditExpected: 1, dayCreditEarned: 1, workedMinutes: 480, expectedMinutes: 480 },
    });
    const ngay = (await getMyAttendanceDays(userId, utc(2026, 9, 1), utc(2026, 10, 1))).map(
      (x) => x.gop,
    );

    const KHUNG = {
      kyKhoa: "2026-09",
      dauThang: "2026-09-01",
      cuoiThang: "2026-09-30",
      homNay: "2026-10-05",
      don: null,
    };

    const chuaLap = await db.attendancePeriod.findUnique({
      where: { centerId_periodKey: { centerId, periodKey: "2026-09" } },
      select: { standardUnits: true, status: true, lockedAt: true },
    });
    expect(chuaLap).toBeNull();
    expect(
      tomTatCongThang({
        ...KHUNG,
        ngay,
        congChuan: chuaLap?.standardUnits ?? null,
        kyTrangThai: chuaLap?.status ?? null,
        kyChotLuc: chuaLap?.lockedAt ?? null,
      }).congChuan,
    ).toBeNull();

    await db.attendancePeriod.create({
      data: { centerId, periodKey: "2026-09", standardUnits: 25, status: "LOCKED" },
    });
    const daLap = await db.attendancePeriod.findUnique({
      where: { centerId_periodKey: { centerId, periodKey: "2026-09" } },
      select: { standardUnits: true, status: true, lockedAt: true },
    });
    const t = tomTatCongThang({
      ...KHUNG,
      ngay,
      congChuan: daLap!.standardUnits,
      kyTrangThai: daLap!.status,
      kyChotLuc: daLap!.lockedAt,
    });
    expect(t.congChuan).toBe(25);
    expect(t.kyTrangThai).toBe("LOCKED");
  });
});
