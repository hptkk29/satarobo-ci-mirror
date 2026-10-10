// Đường GHI khoá quan tâm của một con — kiểm HÀNH VI bằng một `tx` giả trong bộ nhớ.
//
// Thứ cần khoá: (1) ghi đúng cột của con; (2) bản sao trên lead đổi theo ĐÚNG luật
// `dongBoKhoaTuCon` — kể cả vế "không đè khoá người dùng đặt tay"; (3) chọn lại cùng khoá
// không đẻ dòng lịch sử "đã sửa" giả.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Prisma } from "@prisma/client";

vi.mock("@/lib/audit/log", () => ({ logLeadAudit: vi.fn(async () => undefined) }));

import { datKhoaQuanTamCon, khoaConDaDoi, khoaLeadDaDoi } from "./khoa-quan-tam-con";
import { logLeadAudit } from "@/lib/audit/log";

type Con = { id: string; leadId: string; fullName: string; interestedCourseId: string | null; updatedAt: number };

function khoGia(p: { khoaLead: string | null; con: Con[] }) {
  const lead = { id: "L1", courseId: p.khoaLead, lastActivityAt: null as Date | null };
  const con = p.con.map((c) => ({ ...c }));
  let dongHo = 1000;
  const lichSu: unknown[] = [];
  const tx = {
    leadChild: {
      // Trả BẢN SAO như Prisma thật — trả chính object thì `update` sửa luôn giá trị
      // "trước khi sửa" mà hàm đã đọc, và phép thử đo một thứ Prisma không bao giờ làm.
      findUnique: async ({ where }: { where: { id: string } }) => {
        const c = con.find((x) => x.id === where.id);
        return c ? { ...c } : null;
      },
      findMany: async () => [...con].sort((a, b) => b.updatedAt - a.updatedAt),
      updateMany: async ({ where, data }: { where: { id: { in: string[] } }; data: { interestedCourseId: string } }) => {
        for (const c of con) if (where.id.in.includes(c.id)) c.interestedCourseId = data.interestedCourseId;
        return { count: where.id.in.length };
      },
      update: async ({ where, data }: { where: { id: string }; data: { interestedCourseId: string } }) => {
        const c = con.find((x) => x.id === where.id)!;
        c.interestedCourseId = data.interestedCourseId;
        c.updatedAt = ++dongHo;
        return c;
      },
    },
    lead: {
      findUnique: async () => ({ courseId: lead.courseId }),
      update: async ({ data }: { data: { courseId?: string | null; lastActivityAt?: Date } }) => {
        if ("courseId" in data) lead.courseId = data.courseId ?? null;
        if (data.lastActivityAt) lead.lastActivityAt = data.lastActivityAt;
        return lead;
      },
    },
    leadActivity: {
      create: async (a: unknown) => {
        lichSu.push(a);
        return a;
      },
    },
  };
  return { tx: tx as unknown as Prisma.TransactionClient, lead, con, lichSu };
}

const GOI = { actorId: "u1", actorName: "Sale A", noiDoi: "lop-trial" };

describe("datKhoaQuanTamCon", () => {
  beforeEach(() => vi.mocked(logLeadAudit).mockClear());

  it("[KQC-01] bé chưa có khoá, lead chưa có khoá ⇒ ghi cho bé VÀ lead nhận theo", async () => {
    const k = khoGia({
      khoaLead: null,
      con: [{ id: "c1", leadId: "L1", fullName: "Bé An", interestedCourseId: null, updatedAt: 1 }],
    });
    const r = await datKhoaQuanTamCon(k.tx, { leadChildId: "c1", courseId: "sata2", ...GOI });
    expect(r).toEqual({ doi: true });
    expect(k.con[0].interestedCourseId).toBe("sata2");
    expect(k.lead.courseId).toBe("sata2");
    expect(k.lichSu).toHaveLength(1);
    expect(vi.mocked(logLeadAudit)).toHaveBeenCalledTimes(1);
  });

  it("[KQC-02] ⚠️ ĐẢO 26/09: chọn khoá cho bé ⇒ lead nhận ĐÚNG khoá đó, kể cả khi lead đang mang khoá gõ tay", () => {
    // Luật 17/09 giữ khoá gõ tay của lead. Chủ dự án 26/09: "1 cái đổi thì đổi hết cùng
    // nhau" ⇒ lựa chọn tường minh cho bé thắng.
    return (async () => {
      const k = khoGia({
        khoaLead: "combo1",
        con: [{ id: "c1", leadId: "L1", fullName: "Bé An", interestedCourseId: null, updatedAt: 1 }],
      });
      await datKhoaQuanTamCon(k.tx, { leadChildId: "c1", courseId: "sata2", ...GOI });
      expect(k.con[0].interestedCourseId).toBe("sata2");
      expect(k.lead.courseId).toBe("sata2");
    })();
  });

  it("[KQC-03] lead đang lấy khoá theo CHÍNH bé này ⇒ đổi theo", async () => {
    const k = khoGia({
      khoaLead: "sata1",
      con: [{ id: "c1", leadId: "L1", fullName: "Bé An", interestedCourseId: "sata1", updatedAt: 1 }],
    });
    await datKhoaQuanTamCon(k.tx, { leadChildId: "c1", courseId: "sata3", ...GOI });
    expect(k.lead.courseId).toBe("sata3");
  });

  it("[KQC-04] chọn lại ĐÚNG khoá đang có ⇒ không ghi gì, không đẻ lịch sử giả", async () => {
    const k = khoGia({
      khoaLead: "sata2",
      con: [{ id: "c1", leadId: "L1", fullName: "Bé An", interestedCourseId: "sata2", updatedAt: 1 }],
    });
    const r = await datKhoaQuanTamCon(k.tx, { leadChildId: "c1", courseId: "sata2", ...GOI });
    expect(r).toEqual({ doi: false });
    expect(k.lichSu).toHaveLength(0);
    expect(vi.mocked(logLeadAudit)).not.toHaveBeenCalled();
  });

  it("[KQC-05] không thấy hồ sơ con ⇒ NÉM (để transaction cuộn lại), không trả ok im lặng", async () => {
    const k = khoGia({ khoaLead: null, con: [] });
    await expect(
      datKhoaQuanTamCon(k.tx, { leadChildId: "khong-co", courseId: "sata2", ...GOI }),
    ).rejects.toThrow();
  });
});

describe("khoaLeadDaDoi — lead đổi khoá ⇒ bé đổi theo (26/09)", () => {
  it("[KQC-06] bé chưa có khoá + bé mang khoá cũ của lead đổi theo; bé khoá riêng GIỮ", async () => {
    const k = khoGia({
      khoaLead: "sata1",
      con: [
        { id: "trong", leadId: "L1", fullName: "A", interestedCourseId: null, updatedAt: 1 },
        { id: "theo", leadId: "L1", fullName: "B", interestedCourseId: "sata1", updatedAt: 2 },
        { id: "rieng", leadId: "L1", fullName: "C", interestedCourseId: "combo", updatedAt: 3 },
      ],
    });
    const n = await khoaLeadDaDoi(k.tx, { leadId: "L1", khoaLeadCu: "sata1", khoaLeadMoi: "sata2" });
    expect(n).toBe(2);
    expect(Object.fromEntries(k.con.map((c) => [c.id, c.interestedCourseId]))).toEqual({
      trong: "sata2",
      theo: "sata2",
      rieng: "combo",
    });
  });

  it("[KQC-07] Lưu hồ sơ lead mà khoá KHÔNG đổi ⇒ không bé nào bị đụng", async () => {
    const k = khoGia({
      khoaLead: "sata1",
      con: [{ id: "c", leadId: "L1", fullName: "A", interestedCourseId: null, updatedAt: 1 }],
    });
    expect(await khoaLeadDaDoi(k.tx, { leadId: "L1", khoaLeadCu: "sata1", khoaLeadMoi: "sata1" })).toBe(0);
    expect(k.con[0].interestedCourseId).toBeNull();
  });
});

describe("khoaConDaDoi — đường SỬA con trên màn lead (26/09)", () => {
  it("[KQC-08] Lưu con mà khoá KHÔNG đổi ⇒ lead giữ nguyên (sửa tên bé không đè khoá)", async () => {
    const k = khoGia({
      khoaLead: "combo1",
      con: [{ id: "c", leadId: "L1", fullName: "A", interestedCourseId: "sata2", updatedAt: 1 }],
    });
    await khoaConDaDoi(k.tx, { leadId: "L1", khoaConCu: "sata2", khoaConMoi: "sata2" });
    expect(k.lead.courseId).toBe("combo1");
  });

  it("[KQC-09] đổi khoá con trên màn lead ⇒ lead nhận khoá mới", async () => {
    const k = khoGia({
      khoaLead: "combo1",
      con: [{ id: "c", leadId: "L1", fullName: "A", interestedCourseId: "sata3", updatedAt: 1 }],
    });
    await khoaConDaDoi(k.tx, { leadId: "L1", khoaConCu: "sata2", khoaConMoi: "sata3" });
    expect(k.lead.courseId).toBe("sata3");
  });
});
