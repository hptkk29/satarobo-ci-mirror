/**
 * TS-09 — chống vòng lặp cây báo cáo (US-08 AC4), và TS-08 phần THUẦN: vai của vị trí
 * biến thành hàng `UserOrgRoleRow` đúng khuôn `buildActor` ăn được.
 *
 * Tầng DB thật (TS-08 đủ vòng: gán → có quyền, gỡ → 403, người kế nhiệm hưởng nguyên bộ)
 * nằm ở `tests/chat`-style spec chạy trong job CI có Postgres — xem `tests/nen/`.
 * Ở đây chỉ dùng client giả, vì thứ cần chứng minh là THUẬT TOÁN lần cây, không phải SQL.
 */
import { describe, it, expect, vi } from "vitest";
import {
  ReportingCycleError,
  assertNoReportingCycle,
} from "@/lib/org/positions";

type Node = { id: string; title: string; reportsToPositionId: string | null };

/** Client giả chỉ có đúng thứ `assertNoReportingCycle` dùng: `position.findUnique`. */
function fakeClient(nodes: Node[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return {
    position: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => byId.get(where.id) ?? null),
    },
  } as never;
}

const N = (id: string, reportsTo: string | null = null): Node => ({
  id,
  title: id.toUpperCase(),
  reportsToPositionId: reportsTo,
});

describe("[TS-09] assertNoReportingCycle", () => {
  it("cấp trên hợp lệ (chuỗi hở) → cho qua", async () => {
    const c = fakeClient([N("a"), N("b", "c"), N("c")]);
    await expect(assertNoReportingCycle("a", "b", c)).resolves.toBeUndefined();
  });

  it("bỏ trống cấp trên → cho qua, không truy vấn gì", async () => {
    const c = fakeClient([]);
    await expect(assertNoReportingCycle("a", null, c)).resolves.toBeUndefined();
  });

  it("tự báo cáo về chính mình → chặn", async () => {
    const c = fakeClient([N("a")]);
    await expect(assertNoReportingCycle("a", "a", c)).rejects.toBeInstanceOf(ReportingCycleError);
  });

  it("vòng TRỰC TIẾP (B đã báo cáo về A, nay A trỏ về B) → chặn", async () => {
    const c = fakeClient([N("a"), N("b", "a")]);
    await expect(assertNoReportingCycle("a", "b", c)).rejects.toBeInstanceOf(ReportingCycleError);
  });

  it("vòng QUA CHUỖI (A ← B ← C, nay A trỏ về C) → chặn và NÊU RA chuỗi vòng", async () => {
    // Thông báo phải chỉ được mắt xích nào cắt, không chỉ nói "không hợp lệ".
    const c = fakeClient([N("a"), N("b", "a"), N("cc", "b")]);
    await expect(assertNoReportingCycle("a", "cc", c)).rejects.toThrow(/CC → B → A/);
  });

  it("cấp trên không tồn tại → KHÔNG ném ở đây (để FK của DB chặn)", async () => {
    const c = fakeClient([N("a")]);
    await expect(assertNoReportingCycle("a", "khong-co", c)).resolves.toBeUndefined();
  });

  it("cây hỏng sẵn sâu quá trần → fail-closed, không ghi thêm vào đống hỏng", async () => {
    // 100 cấp nối nhau: vượt trần 64 ⇒ phải chặn thay vì lặp mãi.
    const nodes: Node[] = [];
    for (let i = 0; i < 100; i++) nodes.push(N(`p${i}`, `p${i + 1}`));
    nodes.push(N("p100"));
    const c = fakeClient(nodes);
    await expect(assertNoReportingCycle("moi", "p0", c)).rejects.toThrow(/quá 64 cấp/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TS-10 · US-09 AC1 — đúng MỘT phân công PRIMARY còn hiệu lực.
//
// So GIAO KHOẢNG chứ không so "đang hiệu lực lúc này": tạo trước một PRIMARY cho tháng
// sau trong khi PRIMARY hiện tại chưa đóng vẫn là hai chính chồng nhau — và đó đúng là
// cách người ta vô tình tạo ra hai chính (làm quyết định điều động trước ngày hiệu lực).
// ─────────────────────────────────────────────────────────────────────────────
import { PrimaryAssignmentConflictError, assertSinglePrimary } from "@/lib/org/positions";

const NGAY = (s: string) => new Date(`${s}T00:00:00.000Z`);

function fakeAssignments(
  rows: { effectiveFrom: Date; effectiveTo: Date | null; title: string; id?: string }[],
) {
  return {
    positionAssignment: {
      findMany: vi.fn(async ({ where }: { where: { id?: { not: string } } }) =>
        rows
          .filter((r) => !where.id?.not || r.id !== where.id.not)
          .map((r) => ({
            effectiveFrom: r.effectiveFrom,
            effectiveTo: r.effectiveTo,
            position: { title: r.title },
          })),
      ),
    },
  } as never;
}

describe("[TS-10] assertSinglePrimary — US-09 AC1", () => {
  const base = {
    userId: "u1",
    kind: "PRIMARY" as const,
    effectiveFrom: NGAY("2026-03-01"),
    effectiveTo: null,
  };

  it("chưa có PRIMARY nào → cho qua", async () => {
    await expect(
      assertSinglePrimary({ ...base, client: fakeAssignments([]) }),
    ).resolves.toBeUndefined();
  });

  it("đã có PRIMARY vô thời hạn → CHẶN, và nêu tên vị trí đang giữ", async () => {
    const c = fakeAssignments([
      { effectiveFrom: NGAY("2026-01-01"), effectiveTo: null, title: "Quản lý CS1" },
    ]);
    await expect(assertSinglePrimary({ ...base, client: c })).rejects.toThrow(/Quản lý CS1/);
  });

  it("PRIMARY cũ ĐÃ đóng trước ngày bắt đầu mới → cho qua (bàn giao đúng cách)", async () => {
    const c = fakeAssignments([
      { effectiveFrom: NGAY("2026-01-01"), effectiveTo: NGAY("2026-02-01"), title: "Cũ" },
    ]);
    await expect(assertSinglePrimary({ ...base, client: c })).resolves.toBeUndefined();
  });

  it("PRIMARY tương lai chồng lấn PRIMARY hiện tại → CHẶN", async () => {
    // Đây là ca người ta hay vô tình tạo: ký quyết định điều động trước ngày hiệu lực
    // mà quên đóng phân công cũ.
    const c = fakeAssignments([
      { effectiveFrom: NGAY("2026-01-01"), effectiveTo: null, title: "Đang giữ" },
    ]);
    await expect(
      assertSinglePrimary({
        ...base,
        effectiveFrom: NGAY("2026-09-01"),
        effectiveTo: NGAY("2026-12-31"),
        client: c,
      }),
    ).rejects.toBeInstanceOf(PrimaryAssignmentConflictError);
  });

  it("CONCURRENT / DELEGATED → KHÔNG giới hạn, không truy vấn gì", async () => {
    const c = fakeAssignments([
      { effectiveFrom: NGAY("2026-01-01"), effectiveTo: null, title: "Đang giữ" },
    ]);
    for (const kind of ["CONCURRENT", "DELEGATED"] as const) {
      await expect(
        assertSinglePrimary({ ...base, kind, client: c }),
      ).resolves.toBeUndefined();
    }
  });

  it("sửa CHÍNH bản ghi đó → không tự va vào mình", async () => {
    const c = fakeAssignments([
      { id: "a1", effectiveFrom: NGAY("2026-01-01"), effectiveTo: null, title: "Của mình" },
    ]);
    await expect(
      assertSinglePrimary({ ...base, ignoreAssignmentId: "a1", client: c }),
    ).resolves.toBeUndefined();
  });
});
