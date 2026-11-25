// lib/chat/members-admin.ts — Admin THÊM / GỠ thành viên nhóm chat lớp bằng tay [22/11/2026].
//
// ⚠️ ĐẢO BR-10/BR-15 (chủ dự án chốt 22/11): trước đây "MANUAL không dùng cho nhóm lớp" —
// nay Admin được thêm nhân viên (Sale, QLCS, Giáo vụ…) vào nhóm lớp, từng nhóm hoặc đồng
// loạt. Thành viên thêm tay mang `source = MANUAL`, `derivedFrom = null`:
//   • `syncConversationMembership` + `reconcileConversationMembership` BỎ QUA MANUAL ở cả hai
//     chiều (không gỡ, không ghi đè) — nên người được thêm KHÔNG tự mất khi dữ liệu lớp đổi;
//   • các bộ đọc theo tư cách (`isAnnouncementRecipient`, `isStaffSender`, `pilot-stats`) đã có
//     nhánh "derivedFrom trống → rơi về vai tài khoản" từ trước: Sale thêm tay không bị đếm
//     vào mẫu số "đã đọc x/N" (đó là PH), và không bị tính là nhân sự đứng lớp cho ZNS.
//
// QUYỀN: `chat:admin` (chỉ SUPER_ADMIN — prisma/seed-roles.ts) — KHÔNG thêm key quyền mới,
// nên lên prod không phải bấm `seed-prod-roles.yml`. Mở cho QLCS sau này = quyết định riêng.
//
// ⚠️ KHÔNG `"use server"` (luật E-bis #1 — file này export schema/hằng/type cho test). Cửa
// cho Client Component là `lib/chat/_actions.ts`.
// ⚠️ ĐỌC/GHI BẰNG `db` TRẦN, KHÔNG `scopedDb` — cùng lý do khối đầu `lib/chat/admin.ts`:
// quyền chat là participant-based, `Conversation` ∈ SCOPE_EXEMPT, Admin HO phải thấy mọi cơ sở.
import { z } from "zod";
import type { Actor, Target } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { isParentOnly } from "@/lib/auth/permissions";
import { actionFail, type ActionResult } from "@/lib/actions/factory";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit/audit-log";
import { ROLE_DEF_LABELS, roleLabel } from "@/lib/labels";
import { CHAT_PARTICIPANT_REMOVED } from "@/lib/chat/events";
import { publishEvent } from "@/lib/events/publish";
import { loadAdminConversationMeta, type AdminConversationMeta } from "@/lib/chat/admin";
import { syncConversationMembership } from "@/lib/chat/sync-membership";

// ─── Hằng số ────────────────────────────────────────────────────────────────

/** Trần số nhóm / số người trong MỘT lượt — chặn lượt bấm nhầm "chọn tất cả" trên dữ liệu lớn. */
export const MEMBERS_ADD_MAX_CONVERSATIONS = 100;
export const MEMBERS_ADD_MAX_USERS = 100;
/** Trần số nhân viên trả cho ô chọn người (lọc/tìm chạy ở client — danh sách nhân viên nhỏ). */
export const ADDABLE_STAFF_LIMIT = 400;
/** Số tên liệt kê tối đa trong tin hệ thống "đã thêm … vào nhóm". */
const SYSTEM_MESSAGE_NAME_LIMIT = 4;
/** Trần thời gian của MỘT giao dịch (một nhóm). */
const TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 } as const;

/**
 * Nhóm vai để lọc ô chọn người. Khoá là "câu người dùng hỏi" (Sale? Quản lý? Giáo vụ?),
 * không phải enum DB — vì cùng một con người có thể mang vai v1 (`User.roles`) lẫn v2
 * (`UserOrgRole`), và prod đang enforce v2.
 */
export const STAFF_BUCKETS = ["QLCS", "GIAO_VU", "SALE", "GIAO_VIEN", "KHAC"] as const;
export type StaffBucket = (typeof STAFF_BUCKETS)[number];

export const STAFF_BUCKET_LABELS: Record<StaffBucket, string> = {
  QLCS: "Quản lý cơ sở",
  GIAO_VU: "Giáo vụ",
  SALE: "Sale / Tư vấn",
  GIAO_VIEN: "Giáo viên",
  KHAC: "Vai khác",
};

// ─── Lỗi ────────────────────────────────────────────────────────────────────

/**
 *   VALIDATION            400  id sai dạng / rỗng / vượt trần
 *   PERMISSION_DENIED     403  không có `chat:admin`
 *   CONVERSATION_NOT_FOUND 404 không có hội thoại
 *   NOT_CLASS_GROUP       409  chỉ thêm vào NHÓM LỚP (1-1 chỉ có đúng hai người)
 *   CONVERSATION_ARCHIVED 409  lớp đã kết thúc — nhóm chỉ để đọc lại
 *   USER_NOT_ELIGIBLE     422  người không được thêm (phụ huynh · khoá · đã xoá)
 *   NOT_MANUAL_MEMBER     409  gỡ người do hệ thống dẫn xuất — sync sẽ thêm lại ngay
 */
export type ChatMembersErrorCode =
  | "VALIDATION"
  | "PERMISSION_DENIED"
  | "CONVERSATION_NOT_FOUND"
  | "NOT_CLASS_GROUP"
  | "CONVERSATION_ARCHIVED"
  | "USER_NOT_ELIGIBLE"
  | "NOT_MANUAL_MEMBER";

// ─── Schema ─────────────────────────────────────────────────────────────────

export const addMembersSchema = z.object({
  conversationIds: z
    .array(z.uuid("Nhóm không hợp lệ"))
    .min(1, "Chọn ít nhất một nhóm lớp")
    .max(MEMBERS_ADD_MAX_CONVERSATIONS, `Tối đa ${MEMBERS_ADD_MAX_CONVERSATIONS} nhóm mỗi lượt`),
  userIds: z
    .array(z.string().min(1).max(64))
    .min(1, "Chọn ít nhất một người")
    .max(MEMBERS_ADD_MAX_USERS, `Tối đa ${MEMBERS_ADD_MAX_USERS} người mỗi lượt`),
  /** Không bắt buộc (chủ dự án: "add thôi") — nếu có thì ghi vào AuditLog.reason. */
  reason: z.string().trim().max(500).optional(),
});
export type AddMembersInput = z.infer<typeof addMembersSchema>;

export const removeManualMemberSchema = z.object({
  conversationId: z.uuid("Nhóm không hợp lệ"),
  userId: z.string().min(1).max(64),
  reason: z.string().trim().max(500).optional(),
});
export type RemoveManualMemberInput = z.infer<typeof removeManualMemberSchema>;

// ─── Kiểu trả ───────────────────────────────────────────────────────────────

export type AddableStaff = {
  userId: string;
  name: string;
  /** Nhãn vai để hiển thị ("Quản lý cơ sở", "Tư vấn & CSKH cơ sở"…) — KHÔNG có SĐT/email. */
  roleLabels: string[];
  buckets: StaffBucket[];
  centerId: string | null;
  centerName: string | null;
};

export type AddableStaffResult = {
  staff: AddableStaff[];
  /** Chỉ có khi truyền `conversationId`: ai ĐÃ ở trong nhóm đó (để ô chọn người xám sẵn). */
  alreadyIn: string[];
};

export type AddableGroup = {
  conversationId: string;
  title: string;
  status: string;
  centerId: string | null;
  centerName: string | null;
  memberCount: number;
};

export type AddMembersGroupResult = {
  conversationId: string;
  title: string;
  /** Người MỚI vào nhóm (kể cả người từng rời rồi quay lại). */
  added: number;
  /** Người đã ở trong nhóm sẵn — bỏ qua, không đổi gì. */
  alreadyIn: number;
  error: { code: ChatMembersErrorCode; message: string } | null;
};

export type AddMembersResult = {
  groups: AddMembersGroupResult[];
  addedTotal: number;
};

export type RemoveManualMemberResult = { conversationId: string; userId: string };

// ─── PHẦN THUẦN ─────────────────────────────────────────────────────────────

type StaffFacts = {
  role: string | null;
  roles: readonly string[];
  /** Mã RoleDef (v2) đang ACTIVE. */
  roleDefCodes: readonly string[];
};

/** Người này thuộc những nhóm vai nào — một người có thể thuộc nhiều nhóm. */
export function bucketsOf(f: StaffFacts): StaffBucket[] {
  const v1 = new Set<string>([...(f.role ? [f.role] : []), ...f.roles]);
  const v2 = new Set(f.roleDefCodes);
  const out: StaffBucket[] = [];
  if (v1.has("CENTER_MANAGER") || v2.has("CENTER_MANAGER")) out.push("QLCS");
  if (v2.has("CENTER_CLASS_MANAGER")) out.push("GIAO_VU");
  if (v1.has("SALES_CSM") || v2.has("CENTER_SALES_CSM") || v2.has("HO_SALE")) out.push("SALE");
  if (v1.has("TEACHER") || v2.has("TEACHER") || v2.has("ASSISTANT_TEACHER")) out.push("GIAO_VIEN");
  if (out.length === 0) out.push("KHAC");
  return out;
}

/** Nhãn vai: ưu tiên RoleDef v2 (đúng thứ prod enforce), lùi về enum v1. Bỏ PARENT. */
export function roleLabelsOf(f: StaffFacts): string[] {
  const labels: string[] = [];
  for (const code of f.roleDefCodes) {
    const l = ROLE_DEF_LABELS[code];
    if (l && code !== "PARENT" && !labels.includes(l)) labels.push(l);
  }
  if (labels.length === 0) {
    for (const r of new Set<string>([...(f.role ? [f.role] : []), ...f.roles])) {
      if (r === "PARENT") continue;
      const l = roleLabel(r);
      if (!labels.includes(l)) labels.push(l);
    }
  }
  return labels;
}

/** Nội dung tin SYSTEM khi Admin thêm người — nói rõ AI được thêm để phụ huynh không ngỡ ngàng. */
export function addedSystemMessage(names: readonly string[]): string {
  const shown = names.slice(0, SYSTEM_MESSAGE_NAME_LIMIT).join(", ");
  const rest = names.length - SYSTEM_MESSAGE_NAME_LIMIT;
  return rest > 0
    ? `Quản trị viên đã thêm ${shown} và ${rest} người khác vào nhóm.`
    : `Quản trị viên đã thêm ${shown} vào nhóm.`;
}

// ─── Cổng quyền ─────────────────────────────────────────────────────────────

function targetOf(meta: Pick<AdminConversationMeta, "centerId" | "classId" | "createdById"> | null): Target {
  return {
    centerId: meta?.centerId ?? null,
    classId: meta?.classId ?? null,
    createdById: meta?.createdById ?? null,
  };
}

function denied(): ActionResult<never> {
  return actionFail("PERMISSION_DENIED", "Chỉ quản trị viên được thêm hoặc gỡ thành viên nhóm.");
}

/** Cổng cấp hàm cho hai loader (chưa có hội thoại cụ thể ⇒ target rỗng, `chat:admin` là GLOBAL). */
function canAdminChat(actor: Actor): boolean {
  return can(actor, "chat:admin", null);
}

// ─── 1. Danh sách nhân viên có thể thêm ─────────────────────────────────────

type StaffRow = {
  id: string;
  name: string | null;
  role: string;
  roles: string[];
  centerId: string | null;
};

/** Điều kiện "được thêm vào nhóm": còn sống, không khoá, và KHÔNG phải tài khoản thuần phụ huynh. */
function eligibleUser(u: { role: string; roles: readonly string[] }): boolean {
  return !isParentOnly({ role: u.role as never, roles: u.roles as never });
}

/**
 * Toàn bộ nhân viên có thể thêm (trần {@link ADDABLE_STAFF_LIMIT}) — client lọc/tìm tại chỗ.
 * Chỉ tên + vai + cơ sở: KHÔNG SĐT/email (BR-30 tinh thần — ô chọn người không cần danh bạ).
 */
export async function listAddableStaffAsActor(
  actor: Actor,
  opts: { conversationId?: string | null } = {},
): Promise<ActionResult<AddableStaffResult>> {
  if (!canAdminChat(actor)) return denied();

  const users = (await db.user.findMany({
    where: { isActive: true, deletedAt: null, role: { not: "PARENT" } },
    select: { id: true, name: true, role: true, roles: true, centerId: true },
    orderBy: { name: "asc" },
    take: ADDABLE_STAFF_LIMIT,
  })) as StaffRow[];
  const eligible = users.filter(eligibleUser);
  if (eligible.length === 0) return { ok: true, data: { staff: [], alreadyIn: [] } };

  const ids = eligible.map((u) => u.id);
  const now = new Date();
  const [orgRoles, centers, inGroup] = await Promise.all([
    db.userOrgRole.findMany({
      where: {
        userId: { in: ids },
        status: "ACTIVE",
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
        role: { isActive: true },
      },
      select: { userId: true, role: { select: { code: true } } },
    }),
    db.center.findMany({ select: { id: true, name: true } }),
    opts.conversationId
      ? db.conversationParticipant.findMany({
          where: { conversationId: opts.conversationId, leftAt: null, userId: { in: ids } },
          select: { userId: true },
        })
      : Promise.resolve([] as { userId: string }[]),
  ]);

  const codesByUser = new Map<string, string[]>();
  for (const r of orgRoles) {
    const list = codesByUser.get(r.userId) ?? [];
    list.push(r.role.code);
    codesByUser.set(r.userId, list);
  }
  const centerName = new Map(centers.map((c) => [c.id, c.name]));

  const staff: AddableStaff[] = eligible.map((u) => {
    const facts: StaffFacts = {
      role: u.role,
      roles: u.roles,
      roleDefCodes: codesByUser.get(u.id) ?? [],
    };
    return {
      userId: u.id,
      name: u.name?.trim() || "Nhân viên",
      roleLabels: roleLabelsOf(facts),
      buckets: bucketsOf(facts),
      centerId: u.centerId,
      centerName: u.centerId ? (centerName.get(u.centerId) ?? null) : null,
    };
  });

  return { ok: true, data: { staff, alreadyIn: inGroup.map((p) => p.userId) } };
}

// ─── 2. Danh sách nhóm lớp để chọn thêm đồng loạt ───────────────────────────

type GroupRowRaw = {
  conversationId: string;
  title: string | null;
  className: string | null;
  status: string;
  centerId: string | null;
  centerName: string | null;
  memberCount: bigint;
};

/** Nhóm lớp CÒN HOẠT ĐỘNG (ACTIVE/LOCKED) — nhóm đã lưu trữ không nhận thêm người. */
export async function listAddableGroupsAsActor(actor: Actor): Promise<ActionResult<AddableGroup[]>> {
  if (!canAdminChat(actor)) return denied();
  const rows = await db.$queryRaw<GroupRowRaw[]>`
    SELECT c."id"           AS "conversationId",
           c."title"        AS "title",
           cls."name"       AS "className",
           c."status"::text AS "status",
           c."centerId"     AS "centerId",
           ctr."name"       AS "centerName",
           (SELECT COUNT(*) FROM "ConversationParticipant" p
             WHERE p."conversationId" = c."id" AND p."leftAt" IS NULL) AS "memberCount"
    FROM "Conversation" c
    LEFT JOIN "Class" cls ON cls."id" = c."subjectId" AND c."subjectType"::text = 'CLASS'
    LEFT JOIN "Center" ctr ON ctr."id" = c."centerId"
    WHERE c."type"::text = 'CLASS_GROUP' AND c."status"::text IN ('ACTIVE', 'LOCKED')
    ORDER BY ctr."name" NULLS LAST, COALESCE(cls."name", c."title") ASC
    LIMIT 500
  `;
  return {
    ok: true,
    data: rows.map((r) => ({
      conversationId: r.conversationId,
      title: r.className ?? r.title ?? "Nhóm lớp",
      status: r.status,
      centerId: r.centerId,
      centerName: r.centerName,
      // COUNT(*) là bigint — Number() trước khi qua biên RSC (JSON không serialize BigInt).
      memberCount: Number(r.memberCount),
    })),
  };
}

// ─── 2b. Ai trong nhóm là người THÊM TAY ───────────────────────────────────

/**
 * `userId` của các thành viên đang ở trong nhóm mà do Admin thêm tay — để màn Thành viên hiện
 * chip "Thêm tay" + nút Gỡ. Tách riêng thay vì nhét `source` vào `ConversationMemberView` dùng
 * chung: kiểu đó đi xuống cả cổng phụ huynh, mà phụ huynh không có lý do biết nguồn của ai.
 *
 * KHÔNG tự gác quyền: nó chỉ trả id, và chỗ gọi (RSC của màn nhân viên) đã đi qua
 * `getConversationMembers` — nơi `assertActiveParticipant` chặn người ngoài nhóm.
 */
export async function listManualMemberIds(conversationId: string): Promise<string[]> {
  const rows = await db.conversationParticipant.findMany({
    where: { conversationId, leftAt: null, source: "MANUAL" },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

// ─── 3. Thêm thành viên ─────────────────────────────────────────────────────

/**
 * Thêm `userIds` vào TỪNG nhóm trong `conversationIds`. MỘT giao dịch cho MỖI nhóm: nhóm nào
 * hỏng chỉ báo lỗi riêng nhóm đó, không kéo 30 nhóm còn lại xuống — kết quả trả theo nhóm để
 * người bấm thấy rõ nhóm nào đã vào, nhóm nào không.
 *
 * THỨ TỰ BẤT DI BẤT DỊCH:
 *   zod → mọi người được thêm đều hợp lệ → mọi nhóm đều qua cổng quyền → (mới tới) ghi.
 * Cổng đứng TRƯỚC phép ghi đầu tiên (luật rollback — `return` không rollback).
 *
 * Trong mỗi nhóm: chạy `syncConversationMembership` TRƯỚC. Lý do: người có vai QLCS/Giáo vụ
 * mà vai được cấp SAU khi nhóm đã tạo (xem sự cố 22/11 — Giáo vụ cấp 22/10 không vào 4 nhóm
 * cũ) nên hàng DERIVED của họ vẫn `leftAt`. Sync đưa họ vào đúng tư cách DERIVED, và vì vậy
 * khi vai bị thu hồi họ TỰ rời — đúng ý định, khác hẳn một dòng MANUAL "dính" mãi.
 * Sau sync, ai vẫn chưa ở trong nhóm mới được ghi MANUAL.
 */
export async function addMembersAsActor(
  actor: Actor,
  actorName: string,
  rawInput: unknown,
): Promise<ActionResult<AddMembersResult>> {
  const parsed = addMembersSchema.safeParse(rawInput);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return actionFail("VALIDATION", issue?.message ?? "Dữ liệu không hợp lệ", issue?.path.join("."));
  }
  const input = parsed.data;
  const conversationIds = [...new Set(input.conversationIds)];
  const userIds = [...new Set(input.userIds)];

  // Cổng 1 — quyền (không target ⇒ GLOBAL), trước khi chạm DB.
  if (!can(actor, "chat:admin", null)) return denied();

  // Cổng 2 — người được thêm. Kiểm LẠI ở server: danh sách ở ô chọn là tiện ích, không phải
  // hàng rào (gọi thẳng action với id của phụ huynh vẫn phải bị chặn).
  const users = await db.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, role: true, roles: true, isActive: true, deletedAt: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  for (const id of userIds) {
    const u = byId.get(id);
    if (!u || !u.isActive || u.deletedAt !== null || !eligibleUser(u)) {
      return actionFail(
        "USER_NOT_ELIGIBLE",
        "Có người không thể thêm vào nhóm (tài khoản phụ huynh, đã khoá hoặc không tồn tại).",
        "userIds",
      );
    }
  }
  const names = userIds.map((id) => byId.get(id)?.name?.trim() || "Nhân viên");

  // Cổng 3 — nhóm tồn tại + quyền theo target từng nhóm.
  const metas: AdminConversationMeta[] = [];
  const missing: string[] = [];
  for (const id of conversationIds) {
    const m = await loadAdminConversationMeta(id);
    if (!m) missing.push(id);
    else metas.push(m);
  }
  if (missing.length === conversationIds.length) {
    return actionFail("CONVERSATION_NOT_FOUND", "Không tìm thấy nhóm này.");
  }
  for (const m of metas) {
    if (!can(actor, "chat:admin", targetOf(m))) return denied();
  }

  const groups: AddMembersGroupResult[] = [];
  for (const id of missing) {
    groups.push({
      conversationId: id,
      title: "Nhóm không còn tồn tại",
      added: 0,
      alreadyIn: 0,
      error: { code: "CONVERSATION_NOT_FOUND", message: "Không tìm thấy nhóm này." },
    });
  }

  for (const meta of metas) {
    const title = meta.className ?? meta.title ?? "Nhóm lớp";
    const refusal = refusalOf(meta);
    if (refusal) {
      groups.push({ conversationId: meta.conversationId, title, added: 0, alreadyIn: 0, error: refusal });
      continue;
    }
    try {
      const r = await db.$transaction(async (tx) => {
        if (meta.classId) await syncConversationMembership(tx, meta.classId);

        const existing = await tx.conversationParticipant.findMany({
          where: { conversationId: meta.conversationId, userId: { in: userIds } },
          select: { id: true, userId: true, leftAt: true },
        });
        const existingByUser = new Map(existing.map((p) => [p.userId, p]));

        const newcomers: string[] = [];
        let alreadyIn = 0;
        for (const uid of userIds) {
          const cur = existingByUser.get(uid);
          if (!cur) {
            await tx.conversationParticipant.create({
              data: {
                conversationId: meta.conversationId,
                userId: uid,
                role: "MEMBER",
                source: "MANUAL",
                derivedFrom: null,
              },
            });
            newcomers.push(uid);
          } else if (cur.leftAt !== null) {
            // Quay lại: mở lại bản ghi CŨ (unique conversationId+userId — không tạo trùng,
            // không đổi joinedAt) và chuyển sang MANUAL để sync/đối soát không gỡ lại.
            await tx.conversationParticipant.update({
              where: { id: cur.id },
              data: { leftAt: null, source: "MANUAL", derivedFrom: null, role: "MEMBER" },
            });
            newcomers.push(uid);
          } else {
            alreadyIn += 1;
          }
        }

        if (newcomers.length > 0) {
          const now = new Date();
          await tx.message.create({
            data: {
              conversationId: meta.conversationId,
              kind: "SYSTEM",
              senderId: null,
              body: addedSystemMessage(newcomers.map((uid) => names[userIds.indexOf(uid)] ?? "Nhân viên")),
            },
          });
          await tx.conversation.update({ where: { id: meta.conversationId }, data: { lastMessageAt: now } });
          await writeAudit({
            actor: { id: actor.userId, name: actorName },
            module: "chat",
            entityType: "Conversation",
            entityId: meta.conversationId,
            action: "UPDATE",
            newValues: { membersAdded: newcomers, source: "MANUAL", classId: meta.classId },
            ...(input.reason ? { reason: input.reason } : {}),
            orgUnitId: meta.orgUnitId,
            tx,
          });
        }
        return { added: newcomers.length, alreadyIn };
      }, TX_OPTIONS);
      groups.push({ conversationId: meta.conversationId, title, ...r, error: null });
    } catch (err) {
      console.error("[chat/members-admin] thêm thành viên hỏng:", meta.conversationId, err);
      groups.push({
        conversationId: meta.conversationId,
        title,
        added: 0,
        alreadyIn: 0,
        error: { code: "VALIDATION", message: "Không thêm được vào nhóm này — vui lòng thử lại." },
      });
    }
  }

  return { ok: true, data: { groups, addedTotal: groups.reduce((s, g) => s + g.added, 0) } };
}

function refusalOf(
  meta: AdminConversationMeta,
): { code: ChatMembersErrorCode; message: string } | null {
  if (meta.type !== "CLASS_GROUP" || !meta.classId) {
    return { code: "NOT_CLASS_GROUP", message: "Chỉ thêm được vào nhóm lớp." };
  }
  if (meta.status === "ARCHIVED") {
    return { code: "CONVERSATION_ARCHIVED", message: "Lớp đã kết thúc — nhóm chỉ để xem lại." };
  }
  return null;
}

// ─── 4. Gỡ thành viên thêm tay ──────────────────────────────────────────────

/**
 * Gỡ MỘT người ĐÃ ĐƯỢC THÊM TAY. Người do hệ thống dẫn xuất (GV, PH, QLCS theo cơ sở) bị từ chối:
 * gỡ họ chỉ có tác dụng đến lần đồng bộ kế tiếp, rồi họ lại hiện về — một nút nói dối.
 * Muốn họ ra khỏi nhóm thì sửa nguồn (phân công GV, ghi danh, vai).
 *
 * Gỡ = đặt `leftAt` (BR-13: không xoá bản ghi) + phát `participant.removed` TRONG tx để kênh
 * realtime đang mở của người đó bị đá ngay (F-KICK).
 */
export async function removeManualMemberAsActor(
  actor: Actor,
  actorName: string,
  rawInput: unknown,
): Promise<ActionResult<RemoveManualMemberResult>> {
  const parsed = removeManualMemberSchema.safeParse(rawInput);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return actionFail("VALIDATION", issue?.message ?? "Dữ liệu không hợp lệ", issue?.path.join("."));
  }
  const input = parsed.data;

  const meta = await loadAdminConversationMeta(input.conversationId);
  if (!meta) return actionFail("CONVERSATION_NOT_FOUND", "Không tìm thấy nhóm này.");
  if (!can(actor, "chat:admin", targetOf(meta))) return denied();

  const participant = await db.conversationParticipant.findUnique({
    where: {
      conversationId_userId: { conversationId: input.conversationId, userId: input.userId },
    },
    select: { id: true, source: true, leftAt: true },
  });
  if (!participant || participant.leftAt !== null) {
    return actionFail("VALIDATION", "Người này không còn trong nhóm.", "userId");
  }
  if (participant.source !== "MANUAL") {
    return actionFail(
      "NOT_MANUAL_MEMBER",
      "Người này do hệ thống tự thêm theo lớp/vai nên không gỡ tay được. Muốn đổi, hãy sửa phân công hoặc vai của họ.",
      "userId",
    );
  }

  const user = await db.user.findUnique({ where: { id: input.userId }, select: { name: true } });
  const name = user?.name?.trim() || "Nhân viên";
  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.conversationParticipant.update({
      where: { id: participant.id },
      data: { leftAt: now },
    });
    await tx.message.create({
      data: {
        conversationId: input.conversationId,
        kind: "SYSTEM",
        senderId: null,
        body: `Quản trị viên đã gỡ ${name} khỏi nhóm.`,
      },
    });
    await tx.conversation.update({ where: { id: input.conversationId }, data: { lastMessageAt: now } });
    await publishEvent(
      CHAT_PARTICIPANT_REMOVED,
      { conversationId: input.conversationId, userId: input.userId },
      { tx, dedupeKey: `${CHAT_PARTICIPANT_REMOVED}:${participant.id}:${now.toISOString()}` },
    );
    await writeAudit({
      actor: { id: actor.userId, name: actorName },
      module: "chat",
      entityType: "Conversation",
      entityId: input.conversationId,
      action: "UPDATE",
      newValues: { memberRemoved: input.userId, source: "MANUAL" },
      ...(input.reason ? { reason: input.reason } : {}),
      orgUnitId: meta.orgUnitId,
      tx,
    });
  }, TX_OPTIONS);

  return { ok: true, data: { conversationId: input.conversationId, userId: input.userId } };
}
