"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";
import { getAssignableTeachers } from "@/lib/teachers/assignable";
import { SETTINGS } from "@/lib/settings/registry";
import { kiemChinhSach, type ChinhSachHoaHong } from "@/lib/crm/chinh-sach-hoa-hong";
import { KHOA_TRAN_HOA_HONG } from "@/lib/hoa-hong/huong-xu-ly-tran";
import { loiHaTranVoiChinhSachActive } from "@/lib/hoa-hong/kiem-tran-moi";
import {
  getSetting,
  setGlobalSetting,
  clearCenterSetting,
  setCenterSetting,
  type SetResult,
} from "@/lib/settings/service";
// ⚠️ GỘP main 16/09: `main` KHÔNG đổi tên `catalogPrefixes` — nó THÊM
// `catalogPrefixesDayDuoc` (cả hai vẫn export ở `lib/notifications/catalog.ts`, dòng 487 và
// 524). Thân tệp sau gộp dùng bản `…DayDuoc` ở cả hai chỗ (:92 và :107), nên bản import
// `catalogPrefixes` của nhánh này thành mồ côi và bị bỏ — KHÔNG phải mất tính năng.
import { catalogPrefixesDayDuoc } from "@/lib/notifications/catalog";
import { timManXuat } from "@/lib/export/danh-muc-xuat";
import { maVaiCoThat } from "@/lib/export/vai-he-thong";

function actorName(user: { id: string; name?: string | null; email?: string | null }): string {
  return user.name ?? user.email ?? user.id;
}

/** R6-A — Lưu cấu hình GLOBAL (chỉ SUPER_ADMIN). */
export async function saveGlobalSettingAction(input: {
  key: string;
  value: unknown;
  reason: string;
}): Promise<SetResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: { code: "AUTH", message: "Chưa đăng nhập" } };
  const actor = await resolveActor(session.user.id);
  // HẠ trần hoa hồng xuống dưới tổng của chính sách ĐANG CHẠY ⇒ từ chối kèm đường lui (W2, res1 R1-M4). Đứng ở tầng action vì phép kiểm kéo `chinh-sach-service` (vòng với `settings/service` nếu đặt ở
  // `kiem-theo-db` — xem `lib/hoa-hong/kiem-tran-moi.ts`); chỉ chạy khi người lưu ĐƯỢC lưu (SUPER_ADMIN, có lý do) và giá trị đã qua Zod, để không thay câu lỗi quyền / định dạng của `setGlobalSetting`.
  if (input.key === KHOA_TRAN_HOA_HONG && actor.isSuperAdmin && input.reason?.trim()) {
    const v = SETTINGS[KHOA_TRAN_HOA_HONG].schema.safeParse(input.value);
    const loiTran = v.success ? await loiHaTranVoiChinhSachActive(v.data, new Date()) : null;
    if (loiTran) return { ok: false, error: { code: "VALIDATION", message: loiTran, field: KHOA_TRAN_HOA_HONG } };
  }
  const res = await setGlobalSetting(actor, {
    key: input.key,
    value: input.value,
    reason: input.reason,
    actorName: actorName(session.user),
  });
  if (res.ok) revalidatePath("/admin/cau-hinh-van-hanh");
  return res;
}

/** R6-A — Lưu override theo cơ sở (CENTER_MANAGER cơ sở đó / SUPER_ADMIN). */
export async function saveCenterSettingAction(input: {
  orgUnitId: string;
  key: string;
  value: unknown;
  reason: string;
}): Promise<SetResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: { code: "AUTH", message: "Chưa đăng nhập" } };
  const actor = await resolveActor(session.user.id);
  const res = await setCenterSetting(actor, {
    orgUnitId: input.orgUnitId,
    key: input.key,
    value: input.value,
    reason: input.reason,
    actorName: actorName(session.user),
  });
  if (res.ok) revalidatePath("/admin/cau-hinh-van-hanh");
  return res;
}

/**
 * PHIÊN H — GỠ override của một cơ sở ⇒ cơ sở quay về THEO TOÀN HỆ.
 *
 * ⚠️ KHÁC "tắt riêng". Tắt riêng ghi `false` vào sổ (một quyết định); gỡ là rút lại quyết
 * định ấy, và mức toàn hệ có thể đang BẬT. Lý lẽ đầy đủ ở `clearCenterSetting`.
 */
export async function xoaCenterSettingAction(input: {
  orgUnitId: string;
  key: string;
  reason: string;
}): Promise<SetResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: { code: "AUTH", message: "Chưa đăng nhập" } };
  const actor = await resolveActor(session.user.id);
  const res = await clearCenterSetting(actor, {
    orgUnitId: input.orgUnitId,
    key: input.key,
    reason: input.reason,
    actorName: actorName(session.user),
  });
  if (res.ok) revalidatePath("/admin/cau-hinh-van-hanh");
  return res;
}

/**
 * Lưu danh sách loại thông báo được đẩy Web Push (tab "Thông báo điện thoại").
 *
 * Chỉ SUPER_ADMIN — cổng nằm trong `setGlobalSetting`, KHÔNG lặp lại ở đây. Lặp lại là tạo ra
 * hai nguồn sự thật cho cùng một câu hỏi, và nguồn ở tầng dưới mới là nguồn thật.
 *
 * ⚠️ Ghi CẢ DANH SÁCH chứ không ghi từng mục bật/tắt. Nghe thì thừa, nhưng đây là chỗ tránh
 * một lớp lỗi thật: hai người cùng mở màn này, mỗi người bấm một công tắc khác nhau rồi lưu —
 * với API "bật mục X" thì cả hai cùng thắng và ra một trạng thái chưa ai chọn. Ghi cả danh
 * sách thì người lưu sau ghi đè người trước, và nhật ký kiểm toán có `oldValues` đủ để thấy
 * chuyện gì vừa xảy ra.
 */
export async function luuLoaiDuocDayAction(input: {
  tienTo: string[];
  reason: string;
}): Promise<SetResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: { code: "AUTH", message: "Chưa đăng nhập" } };
  }

  // Chuẩn hoá TRƯỚC khi đưa xuống: bỏ trùng, bỏ rỗng, sắp theo đúng thứ tự khai trong catalog.
  //
  // Vì sao sắp lại: giá trị này nằm trong `oldValues`/`newValues` của nhật ký kiểm toán. Nếu
  // thứ tự chạy theo thứ tự người dùng bấm thì hai lần lưu CÙNG một lựa chọn vẫn ra hai JSON
  // khác nhau, và người đọc nhật ký sẽ đi tìm một thay đổi không tồn tại.
  const thuTu = new Map(catalogPrefixesDayDuoc().map((p, i) => [p, i] as const));
  const tienTo = [...new Set(input.tienTo.filter((t) => typeof t === "string" && t.length > 0))].sort(
    (a, b) => (thuTu.get(a) ?? 9999) - (thuTu.get(b) ?? 9999) || a.localeCompare(b),
  );

  // ⚠️ ĐỐI CHIẾU DANH MỤC Ở ĐÂY, không ở registry — xem khối chú thích tại `push.tienToDuocDay`
  // trong `lib/settings/registry.ts`: đặt phép kiểm đó ở tầng kia tạo 11 vòng import mà
  // `lint:boundaries` chặn cứng.
  //
  // TỪ CHỐI chứ không lặng lẽ lọc bỏ. Lọc bỏ thì người dùng bấm Lưu, thấy báo thành công, rồi
  // loại họ vừa chọn biến mất không dấu vết — màn hình nói dối đúng nghĩa. Một khoá lạ tới được
  // đây nghĩa là giao diện và danh mục đã lệch nhau; đó là thứ phải nổ ra, không phải thứ để
  // dọn dẹp im lặng.
    // Danh sách HẸP: bỏ các loại của vòng quét — chúng không bao giờ đẩy được, nên lưu
  // vào cấu hình cũng vô nghĩa. Xem `catalogPrefixesDayDuoc`.
  const hopLe = new Set(catalogPrefixesDayDuoc());
  const la = tienTo.filter((t) => !hopLe.has(t));
  if (la.length > 0) {
    return {
      ok: false,
      error: {
        code: "VALIDATION",
        message: `Không có loại thông báo nào mang mã ${la.join(", ")} — tải lại trang rồi thử lại`,
        field: "push.tienToDuocDay",
      },
    };
  }

  const actor = await resolveActor(session.user.id);
  const res = await setGlobalSetting(actor, {
    key: "push.tienToDuocDay",
    value: tienTo,
    reason: input.reason,
    actorName: session.user.name ?? session.user.email ?? session.user.id,
  });

  if (res.ok) revalidatePath("/admin/cau-hinh-van-hanh");
  return res;
}

/**
 * Lưu danh sách giáo viên LUÔN HIỆN khi xếp buổi học thử (key `trial.gvMienLocTheoCa`).
 *
 * Khuôn giống `luuLoaiDuocDayAction` ngay trên — ghi CẢ DANH SÁCH chứ không ghi từng người
 * bật/tắt, vì cùng một lý do: với API "bật người X" thì hai người cùng mở màn, mỗi người gạt
 * một công tắc rồi lưu, và cả hai cùng thắng ra một trạng thái chưa ai chọn.
 *
 * ── MỘT CHỖ KHÁC `luuLoaiDuocDayAction`, CÓ CHỦ ĐÍCH: CỔNG QUYỀN ĐỨNG TRƯỚC ───────────────
 * Bên kia đối chiếu với một danh mục HẰNG trong mã, nên để `setGlobalSetting` gác quyền ở
 * tầng dưới là đủ. Action này thì đi HỎI DB bằng chính những mã người dùng gửi lên, rồi trả
 * lời "mã này không phải giáo viên". Không gác trước thì bất kỳ ai đăng nhập cũng dò được
 * danh sách người bằng cách đọc thông báo lỗi, và mỗi lần dò là một truy vấn.
 *
 * Cổng ở tầng dưới VẪN nguyên (`setGlobalSetting` kiểm `isSuperAdmin`) — đây là lớp thứ hai,
 * không phải bản sao của luật: quyền vẫn hỏi qua `checkPermission`, không so vai inline.
 */
export async function luuGvMienTruAction(input: {
  userIds: string[];
  reason: string;
}): Promise<SetResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: { code: "AUTH", message: "Chưa đăng nhập" } };
  }
  if (!(await checkPermission("settings:edit"))) {
    return {
      ok: false,
      error: {
        code: "FORBIDDEN",
        message: "Chỉ quản trị cấp cao nhất được sửa cấu hình toàn hệ thống",
      },
    };
  }

  const parsed = z
    .object({
      // `.max(50)` khớp trần của registry — chặn ở đây để câu báo lỗi nói được "quá 50
      // người" thay vì một thông điệp Zod chung chung từ tầng dưới.
      userIds: z.array(z.string()).max(50, "Tối đa 50 giáo viên được miễn"),
      reason: z.string().trim().min(1, "Nhập lý do thay đổi"),
    })
    .safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "VALIDATION",
        message: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ",
        field: "trial.gvMienLocTheoCa",
      },
    };
  }

  // Bỏ TRÙNG và sắp thứ tự ỔN ĐỊNH (theo mã, không theo tên).
  //
  // Bỏ trùng thì im lặng được: công tắc không sinh ra được hai lần cùng một người, nên trùng
  // chỉ đến từ lời gọi tay và nó vẫn mang đúng một lựa chọn.
  //
  // Sắp theo MÃ chứ không theo tên: giá trị này nằm trong `oldValues`/`newValues` của nhật ký
  // kiểm toán. Sắp theo tên thì một người đổi tên là cả danh sách đảo thứ tự, và lần lưu sau
  // đẻ ra một dòng nhật ký trông như có thay đổi trong khi không ai được thêm hay bớt.
  const userIds = [...new Set(parsed.data.userIds)].sort();

  // Dòng TRỐNG bị bắt riêng, vì nếu để nó rơi xuống phép đối chiếu bên dưới thì câu báo lỗi
  // sẽ là "Không có giáo viên nào mang mã " — một câu cụt không nói được gì.
  if (userIds.some((id) => id.trim().length === 0)) {
    return {
      ok: false,
      error: {
        code: "VALIDATION",
        message: "Có dòng trống trong danh sách — tải lại trang rồi thử lại",
        field: "trial.gvMienLocTheoCa",
      },
    };
  }

  // ⚠️ ĐỐI CHIẾU DANH SÁCH GIÁO VIÊN Ở ĐÂY, không ở registry — xem khối chú thích tại
  // `trial.gvMienLocTheoCa` trong `lib/settings/registry.ts`: registry là tầng thấp nhất,
  // kéo `lib/teachers/assignable` (→ `lib/db`) vào đó là đẻ vòng import.
  //
  // TỪ CHỐI chứ không lặng lẽ lọc bỏ. Lọc bỏ thì người dùng bấm Lưu, thấy báo thành công, rồi
  // người họ vừa chọn biến mất không dấu vết — màn hình nói dối đúng nghĩa. Một mã lạ tới
  // được đây nghĩa là giao diện và dữ liệu đã lệch nhau; đó là thứ phải nổ ra.
  const hopLe = new Set((await getAssignableTeachers({})).map((g) => g.id));
  const la = userIds.filter((id) => !hopLe.has(id));
  if (la.length > 0) {
    return {
      ok: false,
      error: {
        code: "VALIDATION",
        message: `Không có giáo viên nào mang mã ${la.join(", ")} — tải lại trang rồi thử lại`,
        field: "trial.gvMienLocTheoCa",
      },
    };
  }

  const actor = await resolveActor(session.user.id);
  const res = await setGlobalSetting(actor, {
    key: "trial.gvMienLocTheoCa",
    value: userIds,
    reason: parsed.data.reason,
    actorName: actorName(session.user),
  });

  if (res.ok) revalidatePath("/admin/cau-hinh-van-hanh");
  return res;
}

/**
 * Lưu TOÀN BỘ chính sách hoa hồng (key `crm.commissionPolicies`).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VÌ SAO CÓ ACTION RIÊNG, KHÔNG DÙNG `saveGlobalSettingAction`
 *
 * Vì luật nghiệp vụ phải chạy TRƯỚC khi ghi, và luật đó cần MỘT KEY KHÁC trong cùng
 * registry: trần `crm.commissionMaxTotalRate`. `setGlobalSetting` chỉ kiểm zod của chính
 * key đang ghi, nên nó không thể biết tổng tỉ lệ có vượt trần hay không.
 *
 * Đây cũng đúng khuôn mà `savePushTopicsAction` ngay trên đã dùng: phép kiểm cần dữ liệu
 * NGOÀI key đó thì đặt ở tầng action, không nhét vào registry — nhét vào là đẻ vòng import
 * mà `lint:boundaries` chặn cứng (11 vòng, đã gỡ ở `45fc7225`).
 *
 * ⚠️ Màn cũng chạy `kiemChinhSach` để người khai thấy lỗi ngay khi gõ. Điều đó KHÔNG thay
 * được cổng ở đây: Server Action là endpoint HTTP riêng — gọi thẳng nó thì màn không đứng
 * chắn được. Hai nơi, MỘT hàm, không chép luật.
 *
 * ⚠️ Trần đọc từ CẤU HÌNH, không dùng hằng `MAX_TOTAL_RATE` trong mã: đúng bài học
 * `crm.commissionMaxTotalRate` đã ghi ở CLAUDE.md — người vận hành nới trần ở màn mà đường
 * ghi vẫn chặn theo số cũ thì trần thành đồ trang trí.
 */
export async function luuChinhSachHoaHongAction(input: {
  chinhSach: ChinhSachHoaHong[];
  lyDo: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };

  const parsed = z
    .object({
      chinhSach: SETTINGS["crm.commissionPolicies"].schema,
      lyDo: z.string().trim().min(5, "Nhập lý do thay đổi (tối thiểu 5 ký tự)").max(500),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const tran = await getSetting("crm.commissionMaxTotalRate");
  const loi = kiemChinhSach(parsed.data.chinhSach as ChinhSachHoaHong[], {
    tranTongTiLe: typeof tran === "number" ? tran : 0.09,
  });
  if (loi.length > 0) return { ok: false, error: loi.join(" · ") };

  const actor = await resolveActor(session.user.id);
  const res = await setGlobalSetting(actor, {
    key: "crm.commissionPolicies",
    value: parsed.data.chinhSach,
    reason: parsed.data.lyDo,
    actorName: session.user.name ?? session.user.email ?? session.user.id,
  });
  if (!res.ok) return { ok: false, error: res.error.message };

  revalidatePath("/admin/cau-hinh-van-hanh");
  return { ok: true };
}

// ==========================================================================
//  TAB "Nick Zalo CRM" — giao nick cho người.
import { isZalocrmEnabled } from "@/lib/flags";
import { datGiaoNick, type MaLoiGiaoNick } from "@/lib/integrations/zalocrm/giao-nick";
import { MUC_QUYEN } from "@/lib/integrations/zalocrm/pham-vi-nick";
import { writeAudit } from "@/lib/audit/audit-log";
//  Dời từ `app/(admin)/admin/zalo-crm/nick/_actions.ts` ngày 24/09 khi màn riêng được
//  gộp vào đây thành một tab.
// ==========================================================================
// Server Action của màn "Giao nick Zalo".
//
// Cổng ở ĐÂY là bắt buộc, không phải lặp lại cổng của trang: layout gate và page gate
// không chặn được một lượt POST gọi thẳng vào Server Action (luật cứng #5 của repo).
//
// Luật "ai được nhận nick" nằm trong `giaoNick` (`lib/integrations/zalocrm/giao-nick.ts`),
// KHÔNG viết lại ở đây — hai bản của cùng một luật là hai bản sẽ lệch nhau.

// 🔴 `mucQuyen` là ENUM ở cổng vào, KHÔNG phải `z.string()`. Giá trị này đi thẳng sang
// ZaloCRM; nhận chuỗi tự do ở đây là để trình duyệt đặt mức cho chính nó. `MUC_QUYEN` là
// nguồn duy nhất — thêm mức thứ tư thì cổng này tự nhận, không phải nhớ sửa hai nơi.
const schema = z.object({
  zcrmAccountId: z.string().min(1).max(128),
  // Mảng RỖNG = GỠ HẾT, nick về lại "cả cơ sở đều thấy". Đó là trạng thái hợp lệ.
  // Trần 50: một cơ sở có vài chục người; số lớn hơn là dấu hiệu thân yêu cầu bị dựng.
  giao: z
    .array(
      z.object({
        sataUserId: z.string().min(1).max(128),
        mucQuyen: z.enum(MUC_QUYEN),
      }),
    )
    .max(50),
});

const THONG_DIEP: Record<MaLoiGiaoNick, string> = {
  KHONG_THAY_NICK: "Không tìm thấy nick này.",
  NICK_NGOAI_TAM_NHIN: "Nick không thuộc cơ sở bạn quản lý.",
  NICK_CHUA_CO_CO_SO: "Nick chưa gắn cơ sở (hoặc cơ sở chưa đặt mã) nên chưa giao được.",
  NGUOI_NGOAI_CO_SO: "Người này không thuộc cơ sở của nick, hoặc không giữ vai được dùng nick.",
  TRUNG_NGUOI: "Một người được chọn hai lần — mỗi người chỉ một dòng.",
};

export async function giaoNickAction(
  input: unknown,
): Promise<{ ok: boolean; error?: string }> {
  if (!isZalocrmEnabled()) return { ok: false, error: "Tính năng chưa bật." };

  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("zalocrm:manage-nick"))) return { ok: false, error: "Không có quyền" };

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu sai" };

  const actor = await resolveActor(session.user.id);
  const kq = await datGiaoNick({
    actor: {
      isSuperAdmin: actor.isSuperAdmin,
      isHoLevel: actor.isHoLevel,
      visibleCenterIds: actor.visibleCenterIds,
    },
    zcrmAccountId: parsed.data.zcrmAccountId,
    giao: parsed.data.giao,
  });
  if (!kq.ok) return { ok: false, error: THONG_DIEP[kq.ma] };

  // Đây là thay đổi PHÂN QUYỀN trên dữ liệu khách hàng thật — phải có vết. Ghi CẢ danh
  // sách lẫn mức, để đọc `AuditLog` là dựng lại được ai giao nick nào cho ai, mức nào,
  // lúc nào. Ghi mỗi số lượng thì vết ấy trả lời được "có đổi không" mà không trả lời
  // được "đổi thành gì" — tức vô dụng đúng lúc cần nó.
  await writeAudit({
    actor: {
      id: session.user.id,
      name: session.user.name ?? session.user.email ?? session.user.id,
    },
    module: "integrations",
    entityType: "ZaloCrmNick",
    entityId: parsed.data.zcrmAccountId,
    action: "GIAO_NICK",
    newValues: { giao: parsed.data.giao },
    changedFields: ["giao"],
  });

  // Tab nằm trong màn Cấu hình vận hành từ 24/09. Đường cũ `/admin/zalo-crm/nick` KHÔNG
  // còn tồn tại, nên revalidate nó là không làm gì cả — bảng giữ dữ liệu cũ cho tới khi
  // người dùng tự tải lại trang, và triệu chứng đọc như "bấm lưu không ăn".
  revalidatePath("/admin/cau-hinh-van-hanh");
  return { ok: true };
}

/**
 * Lưu ma trận quyền xuất dữ liệu (chốt 27/09/2026 — chỉ Quản trị tối cao).
 *
 * `setGlobalSetting` đã tự gác `settings:edit` + ghi audit kèm lý do, nên ở đây KHÔNG gác
 * lại — gác đôi là hai luật rồi sẽ lệch nhau. Việc riêng của action này là hai phép kiểm
 * mà schema của registry không làm được:
 *
 *   · **Mã màn phải CÓ THẬT** trong `MAN_XUAT`. Schema chỉ biết "chuỗi → mảng chuỗi", nên
 *     một mã gõ sai lọt xuống DB rồi nằm đó vĩnh viễn: không màn nào đọc, không lỗi nào
 *     ném, và người vận hành tưởng mình đã giao quyền.
 *   · **Mã vai phải CÓ THẬT** trong `RoleDef`. Cùng lý do, và tệ hơn: một vai gõ sai trông
 *     hệt một vai đã bị xoá.
 *
 * ⚠️ Ghi ĐỦ mọi màn (kể cả màn để rỗng). `vaiDuocXuat()` phân biệt "vắng mặt ⇒ theo mặc
 * định" với "rỗng ⇒ chỉ admin", nên lược màn rỗng ra khi lưu là lặng lẽ trả nó về mặc định
 * — đúng lúc người dùng vừa bỏ hết tick để siết lại.
 */
export async function luuQuyenXuatAction(input: {
  bang: Record<string, string[]>;
  lyDo: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };

  const parsed = z
    .object({
      bang: SETTINGS["export.vaiTheoMan"].schema,
      lyDo: z.string().trim().min(5, "Nhập lý do thay đổi (tối thiểu 5 ký tự)").max(500),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const bang = parsed.data.bang as Record<string, string[]>;

  const maLa = Object.keys(bang).filter((k) => !timManXuat(k));
  if (maLa.length > 0) {
    return { ok: false, error: `Không có màn xuất nào mang mã: ${maLa.join(", ")}` };
  }

  const vaiThat = await maVaiCoThat();
  const vaiLa = [...new Set(Object.values(bang).flat())].filter((v) => !vaiThat.has(v));
  if (vaiLa.length > 0) {
    return { ok: false, error: `Không có vai nào mang mã: ${vaiLa.join(", ")}` };
  }

  const actor = await resolveActor(session.user.id);
  const res = await setGlobalSetting(actor, {
    key: "export.vaiTheoMan",
    value: bang,
    reason: parsed.data.lyDo,
    actorName: actorName(session.user),
  });
  if (!res.ok) return { ok: false, error: res.error.message };

  revalidatePath("/admin/cau-hinh-van-hanh");
  return { ok: true };
}
