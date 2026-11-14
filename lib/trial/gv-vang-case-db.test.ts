import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import { layGvVangChoCase, type KhoLuoiCa } from "./gv-vang-case-db";
import { LY_DO_GV_NGHI } from "./gv-vang-case";

// `@db.Date` — nửa đêm UTC của ngày VN, đúng hình dạng hai cột thật.
const NGAY_27 = new Date(Date.UTC(2026, 8, 27));
const NGAY_28 = new Date(Date.UTC(2026, 8, 28));

type O = Awaited<ReturnType<KhoLuoiCa["shiftAssignment"]["findMany"]>>[number];
function kho(o: O[]): KhoLuoiCa & { goi: ReturnType<typeof vi.fn> } {
  const goi = vi.fn(async () => o);
  return { shiftAssignment: { findMany: goi }, goi } as unknown as KhoLuoiCa & {
    goi: ReturnType<typeof vi.fn>;
  };
}
const nghiPhep = (userId: string, workDate: Date): O => ({
  userId,
  workDate,
  source: "LEAVE",
  templateCode: "P",
  centerId: "cs1",
  segments: [],
  template: { kind: "LEAVE" },
});
const caseChieu = (id: string, teacherId: string | null, date: Date, status = "SCHEDULED") => ({
  id,
  date,
  startTime: "14:00",
  endTime: "15:00",
  teacherId,
  status,
});

describe("layGvVangChoCase", () => {
  it("[GVD-01] ghép ĐÚNG cặp (giáo viên × ngày): nghỉ ngày 27 không đánh dấu case ngày 28", async () => {
    const k = kho([nghiPhep("gv-a", NGAY_27)]);
    const kq = await layGvVangChoCase(k, [
      caseChieu("c27", "gv-a", NGAY_27),
      caseChieu("c28", "gv-a", NGAY_28),
      caseChieu("c27-khac", "gv-b", NGAY_27),
    ]);
    expect([...kq.keys()]).toEqual(["c27"]);
    expect(kq.get("c27")!.lyDo).toBe(LY_DO_GV_NGHI);
  });

  it("[GVD-02] case đã huỷ/đã xong hoặc chưa có GV không xét — và không tra DB nếu không còn gì", async () => {
    const k = kho([nghiPhep("gv-a", NGAY_27)]);
    const kq = await layGvVangChoCase(k, [
      caseChieu("huy", "gv-a", NGAY_27, "CANCELLED"),
      caseChieu("xong", "gv-a", NGAY_27, "COMPLETED"),
      caseChieu("khong-gv", null, NGAY_27),
    ]);
    expect(kq.size).toBe(0);
    expect(k.goi).not.toHaveBeenCalled();
  });

  it("[GVD-03] chỉ đọc ô ca ACTIVE (đổi ca = huỷ ô cũ + tạo ô mới)", async () => {
    const k = kho([]);
    await layGvVangChoCase(k, [caseChieu("c", "gv-a", NGAY_27)]);
    expect(k.goi.mock.calls[0]![0].where.status).toBe("ACTIVE");
  });
});

// ── [GVD-W] DÂY NỐI — lưới ghim mã nguồn ────────────────────────────────────────────
// Luật ở trên xanh vĩnh viễn kể cả khi không cửa nào gọi nó. Khoá: hai cửa đưa bé vào
// case HỎI luật TRƯỚC phép ghi; bước báo tin đứng SAU `decideRequest` và chỉ chạy khi DUYỆT
// đơn nghỉ/đổi ca.
function boChuThich(src: string): string {
  return src
    .split(/\r?\n/)
    .filter((d) => {
      const t = d.trim();
      return !(t.startsWith("//") || t.startsWith("/*") || t.startsWith("*"));
    })
    .join("\n");
}
const doc = (p: string) => boChuThich(fs.readFileSync(path.join(process.cwd(), p), "utf8"));
function thanHam(src: string, ten: string): string {
  const dau = src.indexOf(`export async function ${ten}(`);
  expect(dau, `không thấy hàm ${ten}`).toBeGreaterThan(-1);
  const ke = src.indexOf("\nexport ", dau + 10);
  return src.slice(dau, ke === -1 ? undefined : ke);
}

describe("[GVD-W] dây nối GV vắng ↔ case trial", () => {
  const ACT = doc("app/(admin)/admin/lop-trial/_actions.ts");

  it("[GVD-W1] xếp case: hỏi GV vắng ở case ĐÍCH trước khi chuyển", () => {
    const t = thanHam(ACT, "xepCaseHocVienAction");
    const hoi = t.indexOf("layGvVangChoCase(");
    expect(hoi).toBeGreaterThan(-1);
    expect(hoi).toBeLessThan(t.indexOf("rescheduleTrialEnrollment("));
    expect(t).toContain("where: { id: input.toSessionId }");
  });

  it("[GVD-W2] gắn thẳng vào case: hỏi GV vắng trước khi xếp", () => {
    const t = thanHam(ACT, "enrollLeadChildLopTrialAction");
    const hoi = t.indexOf("layGvVangChoCase(");
    expect(hoi).toBeGreaterThan(-1);
    expect(hoi).toBeLessThan(t.indexOf("enrollLeadChild("));
  });

  it("[GVD-W3] duyệt đơn nghỉ/đổi ca ⇒ báo case trial, SAU decideRequest, chỉ khi APPROVED", () => {
    const t = thanHam(doc("lib/cham-cong/request-actions.ts"), "decideRequestAction");
    const bao = t.indexOf("baoCaseTrialGvVang(");
    expect(bao).toBeGreaterThan(-1);
    expect(bao).toBeGreaterThan(t.indexOf("await decideRequest("));
    const dieuKien = t.slice(t.lastIndexOf("if (", bao), bao);
    expect(dieuKien).toContain('p.data.decision === "APPROVED"');
    expect(dieuKien).toContain('"LEAVE"');
    expect(dieuKien).toContain('"SHIFT_SWAP"');
  });

  it("[GVD-W4] màn lớp trial nạp GV vắng cho MỌI case qua cùng hàm", () => {
    expect(doc("app/(admin)/admin/lop-trial/_lib/queries.ts")).toContain("layGvVangChoCase(");
  });
});
