import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/crm/commission-cutover-gate", () => ({ chanThangThuocSoMoi: vi.fn() }));
vi.mock("@/lib/hoa-hong/cutover", () => ({ docThangThuocSoMoi: vi.fn() }));

import { findAttendedTrialForLeadChild } from "./trial-teacher-commission";

// Dữ liệu: bé học buổi 1 khoá SATA3 (GV thầy A), buổi 2 khoá SATA4 (GV cô B), CẢ HAI có mặt.
type Loc = { courseId?: string | null };
const BUOI = {
  sata3: { courseId: "SATA3", trialSessionId: "s3", lop: "L3", gv: "thay-A", tao: 1 },
  sata4: { courseId: "SATA4", trialSessionId: "s4", lop: "L4", gv: "co-B", tao: 2 },
};

function client(buoi: Array<{ courseId: string | null; trialSessionId: string; lop: string; gv: string; tao: number }>) {
  return {
    trialAttendance: {
      findFirst: vi.fn(async ({ where }: { where: { trialEnrollment: Loc & { leadChildId: string } } }) => {
        const loc = where.trialEnrollment;
        const khop = buoi
          .filter((b) => !("courseId" in loc) || b.courseId === loc.courseId)
          .sort((a, b) => b.tao - a.tao)[0];
        return khop
          ? {
              trialSessionId: khop.trialSessionId,
              trialEnrollment: {
                trialClassId: khop.lop,
                trialClass: { name: khop.lop, teacherId: null },
              },
            }
          : null;
      }),
    },
    trialClassSession: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const b = buoi.find((x) => x.trialSessionId === where.id);
        return b ? { teacherId: b.gv } : null;
      }),
    },
  };
}

describe("[TTC-K] hoa hồng GV Trial theo KHOÁ PH chốt", () => {
  const ca2 = [BUOI.sata3, BUOI.sata4];

  it("[TTC-K1] PH chốt SATA4 ⇒ chỉ cô B (buổi SATA4), dù thầy A dạy buổi SATA3", async () => {
    const t = await findAttendedTrialForLeadChild(client(ca2) as never, "be1", "SATA4");
    expect(t?.teacherUserId).toBe("co-B");
  });

  it("[TTC-K2] PH chốt SATA3 ⇒ chỉ thầy A, dù cô B là buổi GẦN NHẤT", async () => {
    const t = await findAttendedTrialForLeadChild(client(ca2) as never, "be1", "SATA3");
    expect(t?.teacherUserId).toBe("thay-A");
  });

  it("[TTC-K3] PH chốt khoá bé CHƯA trial ⇒ không ai được hoa hồng (không rơi về buổi khoá khác)", async () => {
    const t = await findAttendedTrialForLeadChild(client(ca2) as never, "be1", "SATA5");
    expect(t).toBeNull();
  });

  it("[TTC-K4] lượt trial cũ chưa biết khoá (NULL) là đường lùi khi không có lượt khớp", async () => {
    const cu = [{ courseId: null, trialSessionId: "s0", lop: "L0", gv: "thay-C", tao: 0 }];
    const t = await findAttendedTrialForLeadChild(client(cu) as never, "be1", "SATA3");
    expect(t?.teacherUserId).toBe("thay-C");
  });

  it("[TTC-K5] lượt KHỚP khoá thắng lượt chưa biết khoá, dù lượt chưa biết mới hơn", async () => {
    const hon = [
      { courseId: null, trialSessionId: "s0", lop: "L0", gv: "thay-C", tao: 9 },
      BUOI.sata3,
    ];
    const t = await findAttendedTrialForLeadChild(client(hon) as never, "be1", "SATA3");
    expect(t?.teacherUserId).toBe("thay-A");
  });

  it("[TTC-K6] courseId = null (không tra được khoá) ⇒ hành vi cũ: buổi có mặt gần nhất", async () => {
    const t = await findAttendedTrialForLeadChild(client(ca2) as never, "be1", null);
    expect(t?.teacherUserId).toBe("co-B");
  });
});
