"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor, type Actor } from "@/lib/auth/actor";
import { scopedDb, passesScope, getModelVisibleCenterIds } from "@/lib/db-scope";
import {
  paymentMethodCreateSchema,
  paymentMethodUpdateSchema,
} from "@/lib/validators/payment-method";
import {
  logPaymentMethodAudit,
  detectChangedFields,
  getAuditActor,
} from "@/lib/audit/log";
import { paymentMethodCodeTaken } from "@/lib/payments/method-lookup";
import {
  canWriteSharedMethod,
  SHARED_METHOD_FORBIDDEN,
} from "@/lib/payments/method-scope";

// ⚠️ 30/08/2026 — PaymentMethod KHÔNG còn là catalog toàn cục: nó có `centerId` và nằm
// trong SCOPED_MODELS ∩ NULL_IS_GLOBAL_MODELS (lib/db-scope.ts). Hệ quả cho file này:
//
//  1. ĐỌC được scopedDb tự lọc — người cấp cơ sở chỉ thấy phương thức của cơ sở mình
//     cộng các phương thức dùng chung (centerId null).
//  2. GHI thì KHÔNG — scopedDb chỉ auto-scope 7 method đọc (CLAUDE.md §5). Mọi
//     update/toggle dưới đây phải tự `passesScope()` trên bản ghi ĐÃ ĐỌC, nếu không
//     kế toán CS1 sửa được phương thức CS2 chỉ bằng cách đoán id (IDOR ghi).
//  3. DÒNG DÙNG CHUNG (`centerId = null`) còn một luật NỮA, không suy ra được từ
//     `passesScope`: nó trả true cho mọi actor (đúng nghĩa "ai cũng ĐỌC được"), nhưng
//     "ai cũng đọc được" KHÔNG kéo theo "ai cũng SỬA được". Thiếu `canWriteSharedMethod`
//     thì kế toán CS1 kéo được "Tiền mặt" dùng chung về riêng CS1 — đo thật: sau lượt
//     lưu đó CS2 còn ĐÚNG 0 phương thức thanh toán. Khoá ở `[PTTT-10]`.
//  4. Gate `payments:manage` vẫn gọi TRẦN (không target) — cố ý: quyền "được vào màn
//     danh mục" là quyết định mức màn hình, còn "được đụng dòng nào" do passesScope +
//     canWriteSharedMethod lo, sau khi đã biết dòng đích.
async function requirePaymentsManage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("payments:manage"))) {
    redirect("/dashboard?error=unauthorized");
  }
  const actor = await resolveActor(session.user.id);
  return { session, actor, sdb: scopedDb(actor) };
}

/** Câu từ chối dùng chung khi actor với tay sang phương thức của cơ sở khác. */
const OUT_OF_SCOPE = "Phương thức này thuộc cơ sở khác — bạn không có quyền sửa.";

/**
 * Actor có tầm nhìn TOÀN HỆ THỐNG không (Hội sở / SUPER_ADMIN).
 *
 * Hỏi qua chính cổng scope chuẩn thay vì đọc `actor.isHoLevel` trần: `getModelVisibleCenterIds`
 * là nơi duy nhất gộp đủ isSuperAdmin + prefix action + neo vai, nên hai đường không thể lệch.
 */
function seesAllCenters(actor: Actor): boolean {
  return getModelVisibleCenterIds("PaymentMethod", actor) === "ALL";
}

function readForm(formData: FormData) {
  const image = String(formData.get("image") ?? "").trim();
  return {
    code: String(formData.get("code") ?? "").toUpperCase().trim(),
    name: String(formData.get("name") ?? "").trim(),
    type: formData.get("type"),
    description: (formData.get("description") || null) as string | null,
    image: image || null,
    canBuyCourse: formData.get("canBuyCourse") === "on",
    canBuyPackage: formData.get("canBuyPackage") === "on",
    canBuyExam: formData.get("canBuyExam") === "on",
    canBuyProduct: formData.get("canBuyProduct") === "on",
    canDeposit: formData.get("canDeposit") === "on",
    bankBin: (formData.get("bankBin") || null) as string | null,
    bankName: (formData.get("bankName") || null) as string | null,
    bankBranch: (formData.get("bankBranch") || null) as string | null,
    bankAccountNumber: (formData.get("bankAccountNumber") || null) as string | null,
    bankAccountName: (formData.get("bankAccountName") || null) as string | null,
    gatewayConfig: (formData.get("gatewayConfig") || null) as string | null,
    // "" (mục "— Dùng chung —") → null, chuẩn hoá trong Zod schema.
    centerId: (formData.get("centerId") || null) as string | null,
    displayOrder: Number(formData.get("displayOrder") ?? 0),
    isActive: formData.get("isActive") === "on",
  };
}

// ⚠️ 31/08/2026 — ĐẢO chốt 30/08: form nay CÓ ô khai tài khoản (hiện khi loại = chuyển
// khoản), và 5 cột bank* là NGUỒN DỰNG MÃ QR. Nên readForm phải đọc lại chúng và action
// phải ghi lại chúng — bỏ sót là người vận hành khai tài khoản xong bấm Lưu mà không có
// gì được lưu.

// ─── CREATE ───────────────────────────────────────────────────────────
export async function createPaymentMethodAction(formData: FormData) {
  const { session, actor, sdb } = await requirePaymentsManage();

  const parsed = paymentMethodCreateSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return {
      ok: false as const,
      error: "Dữ liệu không hợp lệ",
      issues: parsed.error.flatten(),
    };
  }

  // ⚠️ Kiểm trùng mã phải KHÔNG-SCOPE: `code` là @unique TOÀN CỤC, nên câu này bắt buộc
  // thấy được cả dòng của cơ sở khác. Hỏi qua `sdb` thì actor CS1 đặt trùng mã của CS2 sẽ
  // được báo "chưa ai dùng", lưu xuống rồi mới ăn lỗi unique thô của Postgres — thông báo
  // không đọc được và không nói phải sửa gì. Xem lib/payments/method-lookup.ts.
  if (await paymentMethodCodeTaken(parsed.data.code)) {
    return {
      ok: false as const,
      error: `Mã "${parsed.data.code}" đã tồn tại (mã là duy nhất trên toàn hệ thống — phương thức riêng của cơ sở nên đặt mã có hậu tố cơ sở, vd BANK_CS1).`,
    };
  }

  // Chống tạo phương thức GẮN SANG cơ sở ngoài tầm nhìn. scopedDb không che write, và
  // Server Action là endpoint HTTP riêng — lọc dropdown ở client không phải lớp bảo vệ.
  if (
    parsed.data.centerId &&
    !passesScope("PaymentMethod", { centerId: parsed.data.centerId }, actor)
  ) {
    return { ok: false as const, error: OUT_OF_SCOPE };
  }

  // Tạo dòng DÙNG CHUNG là tạo thứ mọi cơ sở sẽ thấy ⇒ đòi tầm nhìn toàn hệ thống.
  if (
    !canWriteSharedMethod({
      nextCenterId: parsed.data.centerId,
      actorSeesAllCenters: seesAllCenters(actor),
    })
  ) {
    return { ok: false as const, error: SHARED_METHOD_FORBIDDEN };
  }

  const { actorId, actorName } = getAuditActor(session);

  const gatewayConfigJson = parsed.data.gatewayConfig?.trim()
    ? (JSON.parse(parsed.data.gatewayConfig) as Prisma.InputJsonValue)
    : undefined;

  // A0-04: tx từ scopedDb — cast (tiền lệ); cấu trúc transaction giữ nguyên.
  const created = await sdb.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Prisma.TransactionClient;
    const pm = await tx.paymentMethod.create({
      data: {
        code: parsed.data.code,
        name: parsed.data.name,
        type: parsed.data.type,
        description: parsed.data.description ?? null,
        image: parsed.data.image ?? null,
        canBuyCourse: parsed.data.canBuyCourse,
        canBuyPackage: parsed.data.canBuyPackage,
        canBuyExam: parsed.data.canBuyExam,
        canBuyProduct: parsed.data.canBuyProduct,
        canDeposit: parsed.data.canDeposit,
        bankBin: parsed.data.bankBin ?? null,
        bankName: parsed.data.bankName ?? null,
        bankBranch: parsed.data.bankBranch ?? null,
        bankAccountNumber: parsed.data.bankAccountNumber ?? null,
        bankAccountName: parsed.data.bankAccountName ?? null,
        gatewayConfig: gatewayConfigJson,
        // PaymentMethod ∈ SCOPED_MODELS ⇒ create PHẢI tự set centerId (scopedDb không
        // che write). Bỏ sót thì dòng vừa tạo lại rơi vào nhóm "dùng chung" — nghĩa
        // ngược hẳn với ý người tạo, và hiện ra ở MỌI cơ sở.
        centerId: parsed.data.centerId,
        displayOrder: parsed.data.displayOrder,
        isActive: parsed.data.isActive,
      },
      select: {
        id: true,
        code: true,
        name: true,
        type: true,
        isActive: true,
        centerId: true,
      },
    });

    await logPaymentMethodAudit({
      paymentMethodId: pm.id,
      action: "CREATE",
      actorId,
      actorName,
      newValues: {
        code: pm.code,
        name: pm.name,
        type: pm.type,
        isActive: pm.isActive,
        centerId: pm.centerId,
      },
      tx,
    });

    return pm;
  });

  revalidatePath("/payment-methods");
  return { ok: true as const, id: created.id };
}

// ─── UPDATE ───────────────────────────────────────────────────────────
const SNAPSHOT_SELECT = {
  code: true,
  name: true,
  type: true,
  description: true,
  image: true,
  canBuyCourse: true,
  canBuyPackage: true,
  canBuyExam: true,
  canBuyProduct: true,
  canDeposit: true,
  // 31/08 — bank* trở lại ảnh chụp: chúng nay là tài khoản NHẬN TIỀN THẬT, đổi số tài
  // khoản là việc phải tra được trong nhật ký.
  bankBin: true,
  bankName: true,
  bankBranch: true,
  bankAccountNumber: true,
  bankAccountName: true,
  gatewayConfig: true,
  // Đổi cơ sở của một phương thức là thay đổi có hệ quả tiền (đơn của cơ sở kia mất
  // lựa chọn) ⇒ phải nằm trong ảnh chụp để `detectChangedFields` ghi được vào audit.
  centerId: true,
  displayOrder: true,
  isActive: true,
} as const;


export async function updatePaymentMethodAction(
  id: string,
  formData: FormData,
) {
  const { session, actor, sdb } = await requirePaymentsManage();

  const before = await sdb.paymentMethod.findUnique({
    where: { id },
    select: SNAPSHOT_SELECT,
  });
  if (!before) return { ok: false as const, error: "Không tìm thấy" };
  // Chống IDOR GHI: `sdb.findUnique` có scope nên bản ghi ngoài tầm nhìn đã ra null ở
  // trên, nhưng passesScope là lưới thứ hai và là thứ chịu được ngày mai ai đó đổi
  // câu đọc sang `db` trần.
  if (!passesScope("PaymentMethod", before, actor)) {
    return { ok: false as const, error: OUT_OF_SCOPE };
  }

  const parsed = paymentMethodUpdateSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return {
      ok: false as const,
      error: "Dữ liệu không hợp lệ",
      issues: parsed.error.flatten(),
    };
  }

  // Cùng lý do KHÔNG-SCOPE như ở create. `exceptId` để dòng đang sửa không tự báo trùng
  // với chính nó (form gửi lại `code` cũ ở mọi lần lưu).
  if (await paymentMethodCodeTaken(parsed.data.code, id)) {
    return {
      ok: false as const,
      error: `Mã "${parsed.data.code}" đã tồn tại (mã là duy nhất trên toàn hệ thống).`,
    };
  }

  // Kiểm CẢ HAI đầu: nguồn (passesScope trên `before`, ở trên) và ĐÍCH (dưới đây).
  // Thiếu vế đích thì actor CS1 đẩy được phương thức của mình sang CS2 — mất một cách
  // thu tiền ở CS1 và đẻ một phương thức lạ ở CS2, cả hai bên đều không ai ngờ.
  //
  // Cố ý KHÔNG viết `parsed.data.centerId !== before.centerId` để bỏ qua khi không đổi:
  // so `.centerId` trong Server Action là đúng thứ lint `no-inline-authz` (TS-03) cấm,
  // và bỏ qua cũng chẳng lợi gì — cơ sở giữ nguyên thì `passesScope` vốn đã pass ở lượt
  // kiểm `before`.
  if (
    parsed.data.centerId &&
    !passesScope("PaymentMethod", { centerId: parsed.data.centerId }, actor)
  ) {
    return { ok: false as const, error: OUT_OF_SCOPE };
  }

  // Tạo dòng DÙNG CHUNG là tạo thứ mọi cơ sở sẽ thấy ⇒ đòi tầm nhìn toàn hệ thống.
  if (
    !canWriteSharedMethod({
      nextCenterId: parsed.data.centerId,
      actorSeesAllCenters: seesAllCenters(actor),
    })
  ) {
    return { ok: false as const, error: SHARED_METHOD_FORBIDDEN };
  }

  // ⚠️ HẸP DẦN PHẠM VI của một phương thức là thao tác PHÁ, không phải thao tác sửa.
  //
  // Thao tác tự nhiên nhất của tính năng này là mở "Chuyển khoản ngân hàng" (dùng chung)
  // rồi đặt Cơ sở = CS1, vì người vận hành nghĩ "tài khoản ngân hàng này là của CS1".
  // Nhưng nếu CS2 đang có đơn trỏ vào chính dòng đó thì sau lượt lưu: form tạo đơn của
  // CS2 mất phương thức, và `updateOrderPaymentMethodAction` từ chối mọi đơn cũ của CS2
  // vì phương thức nay thuộc cơ sở khác. Không có màn nào cảnh báo, cũng không có màn nào
  // lấy lại. Nên ĐẾM TRƯỚC và từ chối kèm con số, thay vì để người dùng phát hiện bằng
  // cách mất đường thu tiền.
  //
  // Chỉ đếm khi phạm vi THẬT SỰ hẹp lại (đang dùng chung → gán về một cơ sở). Mở rộng
  // (cơ sở → dùng chung) không bao giờ làm ai mất gì nên không chặn.
  if (before.centerId === null && parsed.data.centerId !== null) {
    const nextCenterId = parsed.data.centerId;
    const [orphanOrders, orphanPayments] = await Promise.all([
      sdb.order.count({
        where: {
          paymentMethodId: id,
          OR: [{ centerId: null }, { NOT: { centerId: nextCenterId } }],
        },
      }),
      sdb.payment.count({
        where: {
          method: before.code,
          deletedAt: null,
          OR: [{ centerId: null }, { NOT: { centerId: nextCenterId } }],
        },
      }),
    ]);
    if (orphanOrders + orphanPayments > 0) {
      return {
        ok: false as const,
        error: `Không gắn được vào một cơ sở: đang có ${orphanOrders} đơn hàng và ${orphanPayments} khoản thu của cơ sở KHÁC dùng phương thức này — gắn vào sẽ khoá đường thu tiền của họ. Hãy tạo một phương thức MỚI riêng cho cơ sở thay vì đổi dòng dùng chung.`,
      };
    }
  }

  const { actorId, actorName } = getAuditActor(session);

  const gatewayConfigJson = parsed.data.gatewayConfig?.trim()
    ? (JSON.parse(parsed.data.gatewayConfig) as Prisma.InputJsonValue)
    : Prisma.JsonNull;

  await sdb.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Prisma.TransactionClient;
    const updated = await tx.paymentMethod.update({
      where: { id },
      data: {
        code: parsed.data.code,
        name: parsed.data.name,
        type: parsed.data.type,
        description: parsed.data.description ?? null,
        image: parsed.data.image ?? null,
        canBuyCourse: parsed.data.canBuyCourse,
        canBuyPackage: parsed.data.canBuyPackage,
        canBuyExam: parsed.data.canBuyExam,
        canBuyProduct: parsed.data.canBuyProduct,
        canDeposit: parsed.data.canDeposit,
        bankBin: parsed.data.bankBin ?? null,
        bankName: parsed.data.bankName ?? null,
        bankBranch: parsed.data.bankBranch ?? null,
        bankAccountNumber: parsed.data.bankAccountNumber ?? null,
        bankAccountName: parsed.data.bankAccountName ?? null,
        gatewayConfig: gatewayConfigJson,
        centerId: parsed.data.centerId,
        // ⚠️ Phải set orgUnitId TƯỜNG MINH khi đưa dòng về "dùng chung".
        // Ghi kép (lib/org/dual-write.ts) cố ý KHÔNG đụng khi `centerId: null` — ở nhiều
        // bảng null nghĩa là "chưa đối khớp" nên điền vào là hỏng nghĩa. Hệ quả ở đây:
        // dòng từ CS1 chuyển về dùng chung sẽ còn `orgUnitId` trỏ CS1, thành cặp
        // (centerId NULL, orgUnitId CS1) — cron đối soát đêm KHÔNG thấy (nó chỉ đếm
        // "centerId có mà orgUnitId thiếu", và chỉ so lệch khi cả hai non-null), nên sai
        // này tàng hình vĩnh viễn cho tới P4 khi đường đọc chuyển sang orgUnitId.
        // Chiều ngược lại (gán về một cơ sở) thì dual-write tự điền, không cần làm gì.
        ...(parsed.data.centerId === null ? { orgUnitId: null } : {}),
        displayOrder: parsed.data.displayOrder,
        isActive: parsed.data.isActive,
      },
      select: SNAPSHOT_SELECT,
    });

    await logPaymentMethodAudit({
      paymentMethodId: id,
      action: "UPDATE",
      actorId,
      actorName,
      oldValues: before,
      newValues: updated,
      changedFields: detectChangedFields(before, updated),
      tx,
    });
  });

  revalidatePath("/payment-methods");
  revalidatePath(`/payment-methods/${id}/edit`);
  return { ok: true as const };
}

// ─── TOGGLE ACTIVE ────────────────────────────────────────────────────
export async function togglePaymentMethodActiveAction(id: string) {
  const { session, actor, sdb } = await requirePaymentsManage();

  const pm = await sdb.paymentMethod.findUnique({
    where: { id },
    select: { isActive: true, code: true, centerId: true },
  });
  if (!pm) return { ok: false as const, error: "Không tìm thấy" };
  // Bật/tắt cũng là GHI ⇒ cùng lưới chống IDOR như update. Tắt phương thức của cơ sở
  // khác là chặn đường thu tiền của họ mà không ai ở đó biết vì sao.
  if (!passesScope("PaymentMethod", pm, actor)) {
    return { ok: false as const, error: OUT_OF_SCOPE };
  }
  // Tắt một dòng DÙNG CHUNG là tắt đường thu tiền đó ở MỌI cơ sở, không riêng cơ sở
  // người bấm — cùng lớp rủi ro với việc kéo nó về một cơ sở.
  if (
    !canWriteSharedMethod({
      currentCenterId: pm.centerId,
      nextCenterId: pm.centerId,
      actorSeesAllCenters: seesAllCenters(actor),
    })
  ) {
    return { ok: false as const, error: SHARED_METHOD_FORBIDDEN };
  }

  const { actorId, actorName } = getAuditActor(session);
  const willBeActive = !pm.isActive;

  await sdb.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Prisma.TransactionClient;
    await tx.paymentMethod.update({
      where: { id },
      data: { isActive: willBeActive },
    });

    await logPaymentMethodAudit({
      paymentMethodId: id,
      action: willBeActive ? "ENABLE" : "DISABLE",
      actorId,
      actorName,
      oldValues: { isActive: pm.isActive },
      newValues: { isActive: willBeActive },
      changedFields: ["isActive"],
      tx,
    });
  });

  revalidatePath("/payment-methods");
  return { ok: true as const, isActive: willBeActive };
}
