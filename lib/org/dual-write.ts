// lib/org/dual-write.ts — Nền Hệ thống P1 · US-07 AC2: "mọi đường ghi mới ghi cả hai cột".
//
// VÌ SAO LÀ MỘT CƠ CHẾ CHỨ KHÔNG PHẢI 60 LẦN SỬA TAY.
// PR-A (15/06) thêm `orgUnitId` cho 28 bảng rồi backfill MỘT LẦN, và để việc ghi kép cho
// từng call-site tự nhớ. Kết quả đo được hôm nay: >60 call-site production vẫn chỉ ghi
// `centerId` (Notification, StockMovement, User, Lead, Order, Student, chấm công, luồng
// convert…). Nợ không đứng yên — nó lớn thêm mỗi ngày, và mỗi lô bulk-convert là một mẻ
// dòng phải backfill lại. Tiền lệ rõ nhất: migration 20260624010000 backfill
// `Enrollment.centerId`, vậy mà 05/08 vẫn phải viết `scripts/backfill-enrollment-center.ts`
// vá tay vì đường ghi mới tiếp tục đẻ dòng thiếu.
//
// ⇒ Ghi kép làm ở TẦNG CLIENT, một chỗ, áp cho mọi model có đủ hai cột.
//
// LUẬT CỦA CƠ CHẾ NÀY — cố ý hẹp:
//  1. CHỈ điền khi `centerId` có giá trị VÀ `orgUnitId` KHÔNG được truyền. Người gọi đã
//     tự set `orgUnitId` thì tôn trọng nguyên vẹn (50 call-site đang gọi
//     `orgUnitIdForCenter()` bằng tay vẫn đúng, không có nguồn ghi thứ hai đè lên).
//  2. `centerId: null` tường minh → KHÔNG đụng. Ở nhiều bảng null nghĩa là "áp dụng toàn
//     hệ thống" hoặc "chưa đối khớp" (xem BACKFILL_SPECS) — điền vào là hỏng nghĩa.
//  3. KHÔNG suy ngược `orgUnitId` → `centerId`. Chiều đó thuộc P4 (cutover), và làm sớm
//     là đổi hành vi đường cũ — trái luật cứng #2.
//  4. Không ánh xạ được (Center không có OrgUnit tương ứng) → để null, KHÔNG ném lỗi.
//     Ném lỗi ở tầng này là biến một cột phụ thành thứ chặn cả nghiệp vụ; script đối soát
//     đêm mới là chỗ báo.

import type { Prisma, PrismaClient } from "@prisma/client";
import { DUAL_WRITE_MODELS } from "./center-bridge";

/**
 * Cache Center.id → OrgUnit.id trong tiến trình.
 *
 * CHỈ cache KẾT QUẢ CÓ. Tra hụt luôn hỏi lại DB, nên mở cơ sở mới (thêm OrgUnit) là lần
 * ghi kế tiếp thấy ngay, không phải chờ deploy. Đây là khác biệt cố ý với lần cache cây
 * OrgUnit đã phải gỡ (REQ-02): lần đó cache cả kết quả RỖNG nên actor thấy cây cũ và
 * phạm vi về rỗng. Ở đây, sai lầm tệ nhất là một dòng thiếu `orgUnitId` — script đối soát
 * đêm nhặt được, và không ai mất quyền vì nó.
 */
const centerToOrgUnit = new Map<string, string>();

/** Cho test — xoá cache giữa các ca. */
export function __resetCenterBridgeCache(): void {
  centerToOrgUnit.clear();
}

type MinimalClient = {
  center: { findUnique: (a: unknown) => Promise<{ id: string; code: string | null } | null> };
  orgUnit: { findFirst: (a: unknown) => Promise<{ id: string } | null> };
};

async function resolveOrgUnitId(
  client: MinimalClient,
  centerId: string,
): Promise<string | null> {
  const hit = centerToOrgUnit.get(centerId);
  if (hit) return hit;

  // Nhánh 1 — đường thường: OrgUnit trỏ thẳng vào Center.
  const direct = await client.orgUnit.findFirst({
    where: { centerId, deletedAt: null },
    select: { id: true },
  });
  if (direct) {
    centerToOrgUnit.set(centerId, direct.id);
    return direct.id;
  }

  // Nhánh 2 — CẦU CHO CENTER MỒ CÔI, khớp theo `code`.
  // `Center("hoi-so")` (code "HO") không được OrgUnit nào trỏ tới vì luật V7 cấm đơn vị HO
  // mang `centerId`. Đã thử nới luật đó ở US-05 và phải GỠ — nới ra là màn nhân sự neo vai
  // người Hội sở TẠI HO ⇒ isHoLevel ⇒ thấy mọi cơ sở. Cầu theo `code` giải đúng bài toán
  // ánh xạ mà không nạp thêm nghĩa cho cột `centerId`, và KHÔNG đường quyền nào đọc nó.
  const center = await client.center.findUnique({
    where: { id: centerId },
    select: { id: true, code: true },
  });
  if (!center?.code) return null;

  const byCode = await client.orgUnit.findFirst({
    where: { code: center.code, centerId: null, deletedAt: null },
    select: { id: true },
  });
  if (!byCode) return null;

  centerToOrgUnit.set(centerId, byCode.id);
  return byCode.id;
}

/** Một khối `data` (create/update) — điền orgUnitId nếu thiếu. Trả về `true` nếu có đổi. */
async function fillOne(
  client: MinimalClient,
  data: Record<string, unknown>,
): Promise<boolean> {
  if (data.orgUnitId !== undefined) return false; // người gọi đã quyết → tôn trọng
  const centerId = data.centerId;
  // Chỉ nhận chuỗi. `null` tường minh (toàn hệ thống / chưa khớp) và các dạng bọc của
  // Prisma (`{ set: … }`, `{ connect: … }`) đều KHÔNG suy — không đoán thay người viết.
  if (typeof centerId !== "string" || centerId.length === 0) return false;

  const orgUnitId = await resolveOrgUnitId(client, centerId);
  if (!orgUnitId) return false; // không ánh xạ được → để đối soát đêm báo
  data.orgUnitId = orgUnitId;
  return true;
}

async function fillData(client: MinimalClient, data: unknown): Promise<void> {
  if (Array.isArray(data)) {
    for (const d of data) {
      if (d && typeof d === "object") await fillOne(client, d as Record<string, unknown>);
    }
    return;
  }
  if (data && typeof data === "object") {
    await fillOne(client, data as Record<string, unknown>);
  }
}

/**
 * Extension ghi kép. Cắm ở `lib/db.ts` NGAY SAU extension soft-delete, nên `scopedDb`
 * (vốn là `db.$extends`) cũng thừa hưởng — không có đường ghi nào của app đi vòng qua được.
 *
 * ⚠️ KHÔNG hook `updateMany`: ở đó `data` áp cho NHIỀU dòng có thể thuộc nhiều cơ sở khác
 * nhau, mà `where` thì không nói được cơ sở nào. Suy một `orgUnitId` chung cho cả lô là
 * gán sai hàng loạt — thà để trống cho đối soát nhặt.
 */
export function dualWriteExtension() {
  return {
    name: "orgunit-dual-write",
    query: {
      $allModels: {
        async create({ model, args, query }: {
          model: string;
          args: { data?: unknown };
          query: (a: unknown) => Promise<unknown>;
        }) {
          if (DUAL_WRITE_MODELS.has(model) && args?.data) {
            await fillData(dualWriteClient as MinimalClient, args.data);
          }
          return query(args);
        },
        async createMany({ model, args, query }: {
          model: string;
          args: { data?: unknown };
          query: (a: unknown) => Promise<unknown>;
        }) {
          if (DUAL_WRITE_MODELS.has(model) && args?.data) {
            await fillData(dualWriteClient as MinimalClient, args.data);
          }
          return query(args);
        },
        async update({ model, args, query }: {
          model: string;
          args: { data?: unknown };
          query: (a: unknown) => Promise<unknown>;
        }) {
          if (DUAL_WRITE_MODELS.has(model) && args?.data) {
            await fillData(dualWriteClient as MinimalClient, args.data);
          }
          return query(args);
        },
        async upsert({ model, args, query }: {
          model: string;
          args: { create?: unknown; update?: unknown };
          query: (a: unknown) => Promise<unknown>;
        }) {
          if (DUAL_WRITE_MODELS.has(model)) {
            if (args?.create) await fillData(dualWriteClient as MinimalClient, args.create);
            if (args?.update) await fillData(dualWriteClient as MinimalClient, args.update);
          }
          return query(args);
        },
      },
    },
  } satisfies Prisma.Extension | { name: string; query: unknown };
}

/**
 * Client dùng để TRA CỨU bên trong extension.
 *
 * Phải là client TRẦN (chưa qua extension) — dùng chính `db` sẽ đệ quy vô hạn khi
 * `orgUnit.findFirst` lại đi qua hook. `lib/db.ts` gán giá trị này ngay khi dựng xong
 * base client, trước khi bất kỳ query nào chạy.
 */
let dualWriteClient: unknown = null;

export function setDualWriteClient(client: PrismaClient): void {
  dualWriteClient = client;
}
