// US-04 — unit phần THUẦN của job đối soát: phân loại REMOVE/ADD, bỏ qua MANUAL
// (BR-15), idempotent sau khi thi hành. DB-touching kiểm bằng scripts/_zztest-chat-us04.ts
// (TS-07 trên DB dev — quy ước ZZTEST của repo).
import { describe, it, expect } from "vitest";
import { diffMembership, type ExistingParticipantLite } from "./reconcile-membership";
import type { DesiredParticipant } from "./sync-membership";

const d = (
  userId: string,
  derivedFrom: DesiredParticipant["derivedFrom"] = "CLASS_STUDENT_PARENT",
): DesiredParticipant => ({
  userId,
  role: derivedFrom === "CLASS_TEACHER" ? "MODERATOR" : "MEMBER",
  derivedFrom,
});

const p = (
  userId: string,
  over: Partial<ExistingParticipantLite> = {},
): ExistingParticipantLite => ({
  id: `row-${userId}`,
  userId,
  source: "DERIVED",
  derivedFrom: "CLASS_STUDENT_PARENT",
  leftAt: null,
  ...over,
});

describe("[US-04/TS-07] diffMembership — phân loại lệch", () => {
  it("REMOVE: DERIVED active không còn trong tập dẫn xuất", () => {
    const diff = diffMembership([d("ph1")], [p("ph1"), p("ph3")]);
    expect(diff.removes.map((x) => x.userId)).toEqual(["ph3"]);
    expect(diff.adds).toEqual([]);
  });

  it("ADD/MISSING: user thuộc tập dẫn xuất nhưng chưa có bản ghi — CHỈ log, không thi hành", () => {
    const diff = diffMembership([d("ph1"), d("gv1", "CLASS_TEACHER")], [p("ph1")]);
    expect(diff.removes).toEqual([]);
    expect(diff.adds).toEqual([
      { participant: d("gv1", "CLASS_TEACHER"), reason: "MISSING" },
    ]);
  });

  it("ADD/LEFT: bản ghi DERIVED đã leftAt nhưng user vẫn thuộc tập dẫn xuất", () => {
    const diff = diffMembership([d("ph1")], [p("ph1", { leftAt: new Date() })]);
    expect(diff.adds).toEqual([{ participant: d("ph1"), reason: "LEFT" }]);
    expect(diff.removes).toEqual([]);
  });

  it("BR-15: MANUAL active thừa → KHÔNG REMOVE (ngoại lệ Admin không bị job gỡ)", () => {
    const diff = diffMembership([], [p("khach", { source: "MANUAL" })]);
    expect(diff.removes).toEqual([]);
    expect(diff.adds).toEqual([]);
  });

  it("BR-15: user desired đang có bản ghi MANUAL (kể cả đã leftAt) → KHÔNG ADD", () => {
    // Khớp sync: cur.source === MANUAL → continue, bất kể leftAt (Admin chủ động gỡ).
    const active = diffMembership([d("ph1")], [p("ph1", { source: "MANUAL" })]);
    expect(active.adds).toEqual([]);
    const left = diffMembership(
      [d("ph1")],
      [p("ph1", { source: "MANUAL", leftAt: new Date() })],
    );
    expect(left.adds).toEqual([]);
    expect(left.removes).toEqual([]);
  });

  it("khớp hoàn toàn → 0 drift (đêm sạch)", () => {
    const diff = diffMembership(
      [d("ph1"), d("gv1", "CLASS_TEACHER"), d("ql1", "CENTER_MANAGER")],
      [
        p("ph1"),
        p("gv1", { derivedFrom: "CLASS_TEACHER" }),
        p("ql1", { derivedFrom: "CENTER_MANAGER" }),
        p("roi-lop", { leftAt: new Date() }), // đã rời từ trước, không desired → không lệch
      ],
    );
    expect(diff.removes).toEqual([]);
    expect(diff.adds).toEqual([]);
  });

  it("idempotent: sau khi thi hành REMOVE (leftAt set) → diff lần 2 không còn REMOVE", () => {
    const desired = [d("ph1")];
    const before = [p("ph1"), p("ph3")];
    const first = diffMembership(desired, before);
    expect(first.removes.map((x) => x.userId)).toEqual(["ph3"]);
    // Giả lập job đã set leftAt cho ph3 rồi chạy lại.
    const after = before.map((row) =>
      row.userId === "ph3" ? { ...row, leftAt: new Date() } : row,
    );
    const second = diffMembership(desired, after);
    expect(second.removes).toEqual([]);
    expect(second.adds).toEqual([]); // ph3 không desired → leftAt set là trạng thái ĐÚNG
  });

  it("lớp rỗng participant + desired rỗng → không nổ, 0 drift", () => {
    expect(diffMembership([], [])).toEqual({ removes: [], adds: [] });
  });
});
