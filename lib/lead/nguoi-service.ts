import "server-only";

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { chiaChoLead, baoLoLeadMoi, thuHoiChuongLeadCu } from "@/lib/lead/assign-lead";
import { TERMINAL_LEAD_STATUSES } from "@/lib/lead/assign";
import { canManualAssign } from "@/lib/lead/assign-guard";
import { logLeadAudit } from "@/lib/audit/log";
import { orgUnitIdForCenter } from "@/lib/org/org-service";
import { mocCatNguoi, soNgayIm, type LeadDeDoNguoi } from "@/lib/lead/lead-nguoi";
import type { VisibleCenterIds } from "@/lib/lead-handover/service";
import { recordLeadActivity } from "@/lib/lead/activity-write";
import { SYSTEM_ACTIVITY_META } from "@/lib/lead/activity-clock";

/**
 * TÌM VÀ PHÂN BỔ LẠI LEAD NGUỘI.
 *
 * Yêu cầu 15/09/2026: "lọc các KH (chưa đăng ký, ghi danh) mà sale không tương tác trong vòng
 * 90 ngày ... quản lý có thể lọc và phân bổ cho các sale khác".
 *
 * Khác `lib/lead-handover/service.ts` ở MỘT điểm quyết định: màn bàn giao bắt chọn TỪNG sale
 * nguồn, còn ở đây quét TOÀN BỘ sale cùng lúc — đó là thứ chủ dự án chọn, và cũng là thứ duy
 * nhất cho phép quản lý nhìn ra bức tranh "ai đang ôm lead mà không chăm".
 *
 * ⚠️ Phép đo "không tương tác" và mọi giới hạn của nó nằm ở `lib/lead/lead-nguoi.ts`. Đọc
 * khối chú thích ở đó trước khi sửa bất cứ gì tại đây.
 */

/** Một dòng trong danh sách lead nguội. */
export interface DongLeadNguoi {
  id: string;
  parentName: string;
  phone: string;
  status: string;
  centerId: string | null;
  /** Người đang giữ; `null` = chưa chia cho ai. */
  chuId: string | null;
  chuTen: string | null;
  soNgayIm: number;
}

/**
 * Trần số lead quét để SẮP XẾP.
 *
 * Phép đo "im bao lâu" là `max()` của bốn cột, mà Prisma không sắp xếp được theo `max()` của
 * nhiều cột. Nên bước một chỉ lấy `id` + bốn cột ngày của MỌI dòng khớp (mỗi dòng vài chục
 * byte), sắp trong bộ nhớ, rồi bước hai mới nạp đủ trường cho đúng một trang.
 *
 * Trần này là lưới an toàn cho ngày sổ lead phình to, không phải giới hạn thiết kế: 1.300
 * dòng × 5 trường là không đáng kể. Vượt trần thì màn hình NÓI RA (xem `quetThieu`) chứ không
 * âm thầm cắt — cắt im lặng ở một màn phân bổ hàng loạt là để người dùng tưởng mình đã xử lý
 * hết trong khi còn nguyên một đống chưa ai thấy.
 */
const TRAN_QUET = 20_000;

/**
 * Điều kiện "lead CHƯA CHỐT" — sao chép nguyên ý của `onlyActive` ở màn bàn giao.
 *
 * ⚠️ Hai vế, không phải một. Sau GĐ5 tập đóng chỉ còn `DA_MAT`, nên lọc theo `status` MỘT
 * MÌNH sẽ lôi cả lead đã convert xong từ đời nào vào danh sách. `convertedAt` do chính lượt
 * convert ghi ⇒ có mốc = hồ sơ đã khép.
 */
const CHUA_CHOT = {
  deletedAt: null,
  status: { notIn: [...TERMINAL_LEAD_STATUSES] as never },
  convertedAt: null,
} satisfies Prisma.LeadWhereInput;

/**
 * Câu `where` cho lead nguội.
 *
 * Mỗi cột mốc phải ĐỀU ở trước mốc cắt — `OR` là sai: chỉ cần một cột cũ là lead lọt vào, kể
 * cả khi Sale vừa gọi khách hôm qua.
 */
export function dungWhereNguoi(params: {
  now: Date;
  nguongNgay: number;
  visibleCenterIds: VisibleCenterIds;
  centerId?: string | null;
}): Prisma.LeadWhereInput {
  const cat = mocCatNguoi(params.now, params.nguongNgay);
  const truocCat = { lt: cat };
  const and: Prisma.LeadWhereInput[] = [
    // `null` nghĩa là "chưa từng xảy ra" ⇒ vẫn tính là nguội. Bỏ vế `null` đi là loại đúng
    // những lead chưa ai đụng tới lần nào — nhóm đáng lọc nhất.
    { OR: [{ lastActivityAt: null }, { lastActivityAt: truocCat }] },
    { OR: [{ firstContactAt: null }, { firstContactAt: truocCat }] },
    { OR: [{ assignedAt: null }, { assignedAt: truocCat }] },
    { createdAt: truocCat },
  ];
  if (params.visibleCenterIds !== "ALL") {
    // Mảng rỗng → không match lead nào (fail-safe), đúng nếp của màn bàn giao.
    and.push({ centerId: { in: params.visibleCenterIds } });
  }
  if (params.centerId) and.push({ centerId: params.centerId });
  return { ...CHUA_CHOT, AND: and };
}

export interface KetQuaTim {
  /** Tổng số lead khớp — đếm ở DB, không phải độ dài trang. */
  tong: number;
  dong: DongLeadNguoi[];
  trang: number;
  soTrang: number;
  /** Số lead khớp nhưng nằm ngoài trần quét ⇒ chưa được sắp xếp. 0 là bình thường. */
  quetThieu: number;
}

/**
 * Lấy MỘT TRANG lead nguội, sắp theo "im lâu nhất trước".
 *
 * ⚠️ Hai bước, có lý do. Bản đầu nạp 500 dòng rồi cắt trang ở trình duyệt — với sổ 1.279 lead
 * thì 779 dòng cuối KHÔNG AI THẤY, mà màn hình vẫn báo "tìm thấy 1.279". Con số nói một đằng,
 * danh sách bày một nẻo, và người dùng bấm phân bổ tưởng mình đã soát hết.
 */
export async function timLeadNguoi(params: {
  now: Date;
  nguongNgay: number;
  visibleCenterIds: VisibleCenterIds;
  centerId?: string | null;
  trang: number;
  soDong: number;
}): Promise<KetQuaTim> {
  const where = dungWhereNguoi(params);

  // Bước 1 — chỉ id + bốn cột ngày, đủ để tính và sắp theo phép đo thật.
  const [tong, nhe] = await Promise.all([
    db.lead.count({ where }),
    db.lead.findMany({
      where,
      select: {
        id: true,
        lastActivityAt: true,
        firstContactAt: true,
        assignedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
      take: TRAN_QUET,
    }),
  ]);

  const xepHang = nhe
    .map((l) => ({ id: l.id, ngay: soNgayIm(l satisfies LeadDeDoNguoi, params.now) }))
    // Im lâu nhất lên trước: đó là thứ quản lý cần xử lý đầu tiên. Tie-break theo `id` để
    // hai lần tải cùng dữ liệu cho ra cùng thứ tự — thứ tự nhảy giữa hai lần tải là cách
    // chắc chắn để người dùng tick nhầm dòng.
    .sort((a, b) => b.ngay - a.ngay || a.id.localeCompare(b.id));

  const soTrang = Math.max(1, Math.ceil(xepHang.length / params.soDong));
  const trang = Math.min(Math.max(1, params.trang), soTrang);
  const lat = xepHang.slice((trang - 1) * params.soDong, trang * params.soDong);

  if (lat.length === 0) {
    return { tong, dong: [], trang, soTrang, quetThieu: Math.max(0, tong - nhe.length) };
  }

  // Bước 2 — nạp đủ trường cho ĐÚNG những dòng của trang này.
  const day = await db.lead.findMany({
    where: { id: { in: lat.map((x) => x.id) } },
    select: {
      id: true,
      parentName: true,
      phone: true,
      status: true,
      centerId: true,
      assignedToId: true,
      assignedTo: { select: { name: true } },
    },
  });
  const theoId = new Map(day.map((d) => [d.id, d]));

  const dong = lat.flatMap((x) => {
    const d = theoId.get(x.id);
    if (!d) return []; // lead vừa bị xoá giữa hai truy vấn — bỏ, không dựng dòng rỗng
    return [
      {
        id: d.id,
        parentName: d.parentName,
        phone: d.phone,
        status: d.status as string,
        centerId: d.centerId,
        chuId: d.assignedToId,
        chuTen: d.assignedTo?.name ?? null,
        soNgayIm: x.ngay,
      },
    ];
  });

  return { tong, dong, trang, soTrang, quetThieu: Math.max(0, tong - nhe.length) };
}

export type CachPhanBo = { kieu: "vong" } | { kieu: "nguoi"; nhanId: string };

export interface KetQuaPhanBo {
  ok: boolean;
  /** Số lead thực sự đổi chủ. */
  daChia: number;
  /** Lead bị bỏ qua kèm lý do — KHÔNG được im lặng nuốt. */
  boQua: { leadId: string; lyDo: string }[];
}

/**
 * PHÂN BỔ LẠI một lô lead nguội.
 *
 * Hai cách, chủ dự án chốt có cả hai:
 *   · `vong`  — đi qua `chiaChoLead` nên ăn theo ma trận + sổ chia lead sẵn có. Công bằng, có
 *               vết, và không cần quản lý tự cân tải.
 *   · `nguoi` — giao đích danh. Quản lý tự quyết ai nhận.
 *
 * ── ⚠️ KHÔNG BAO GIỜ CHIA CHÉO CƠ SỞ ────────────────────────────────────────────────────
 * Chủ dự án chốt 16/09/2026: "lead nằm ở cs nào thì chia đều lại cs đó, chứ không được chia
 * qua cs khác".
 *
 * Nhánh `vong` vốn đã đúng — nó truyền `targetCenterId: lead.centerId` nên pool chỉ gồm người
 * của chính cơ sở đó. Lỗ nằm ở nhánh `nguoi`: trước bản vá KHÔNG có phép kiểm nào, nên quản lý
 * chọn một tư vấn viên CS1 là lead của CS2 nhảy sang tay họ.
 *
 * Phép kiểm dùng `canManualAssign` — luật gán tay dùng chung của repo, đừng chép lại — nhưng
 * truyền `actorIsHoLevel: FALSE` một cách CÓ CHỦ ĐÍCH, kể cả khi người bấm là Hội sở. Hàm đó
 * vốn mở cửa cho HO đi xuyên cơ sở, và cửa ấy đúng cho màn "giao tay một lead", nhưng SAI ở
 * đây: màn này tên là "phân bổ lại", không phải "chuyển cơ sở". Đổi cơ sở cho lead là một
 * quyết định vận hành khác, có màn riêng, và thông báo lỗi của `canManualAssign` cũng chỉ
 * đúng sang đó ("Dùng Chuyển lead nếu muốn đổi cơ sở").
 *
 * ⚠️ KIỂM LẠI ĐIỀU KIỆN NGUỘI Ở ĐÂY, không tin danh sách client gửi lên. Giữa lúc màn hình
 * dựng danh sách và lúc quản lý bấm nút, Sale có thể vừa gọi khách xong — phân bổ đúng lead
 * ấy là giật việc khỏi tay người đang làm. Đây cũng là luật chung: id từ client là dữ liệu,
 * không phải sự thật.
 */
export async function phanBoLaiLeadNguoi(params: {
  leadIds: readonly string[];
  cach: CachPhanBo;
  now: Date;
  nguongNgay: number;
  visibleCenterIds: VisibleCenterIds;
  actorId: string | null;
  actorName: string;
  lyDo: string;
}): Promise<KetQuaPhanBo> {
  const boQua: { leadId: string; lyDo: string }[] = [];
  if (params.leadIds.length === 0) return { ok: true, daChia: 0, boQua };

  // Lọc lại theo ĐÚNG câu `where` đã dựng danh sách, cộng thêm ràng buộc id.
  const hopLe = await db.lead.findMany({
    where: {
      ...dungWhereNguoi({
        now: params.now,
        nguongNgay: params.nguongNgay,
        visibleCenterIds: params.visibleCenterIds,
      }),
      id: { in: [...params.leadIds] },
    },
    select: { id: true, centerId: true, assignedToId: true },
  });
  const conNguoi = new Set(hopLe.map((l) => l.id));
  for (const id of params.leadIds) {
    if (!conNguoi.has(id)) {
      boQua.push({
        leadId: id,
        lyDo: "Lead không còn ở trạng thái nguội (vừa có người chăm, đã chốt, hoặc ngoài tầm nhìn cơ sở)",
      });
    }
  }

  // Người nhận đích danh: nạp MỘT lần, kiểm cho từng lead theo cơ sở của chính lead đó.
  const nhan =
    params.cach.kieu === "nguoi"
      ? await db.user.findUnique({
          where: { id: params.cach.nhanId },
          select: { id: true, name: true, centerId: true, isActive: true, deletedAt: true },
        })
      : null;
  if (params.cach.kieu === "nguoi" && !nhan) {
    return {
      ok: false,
      daChia: 0,
      boQua: [{ leadId: "", lyDo: "Không tìm thấy tư vấn viên nhận" }],
    };
  }

  const daChia: { leadId: string; ownerId: string }[] = [];
  const mocLuot = params.now.getTime();

  for (const lead of hopLe) {
    if (!lead.centerId) {
      boQua.push({ leadId: lead.id, lyDo: "Lead chưa thuộc cơ sở nào — không có pool để chia" });
      continue;
    }
    const chuCu = lead.assignedToId;

    if (params.cach.kieu === "nguoi" && nhan) {
      if (chuCu === nhan.id) {
        boQua.push({ leadId: lead.id, lyDo: "Người nhận trùng người đang giữ" });
        continue;
      }
      // ⚠️ `actorIsHoLevel: false` là CỐ Ý — xem khối chú thích của hàm này.
      const gac = canManualAssign({
        sale: nhan,
        leadCenterId: lead.centerId,
        actorIsHoLevel: false,
      });
      if (!gac.ok) {
        boQua.push({ leadId: lead.id, lyDo: gac.error });
        continue;
      }

      const orgUnitId = await orgUnitIdForCenter(lead.centerId);
      await db.$transaction(async (tx) => {
        await tx.lead.update({
          where: { id: lead.id },
          data: {
            assignedToId: nhan.id,
            assignedAt: params.now,
            assignedById: params.actorId,
            assignmentSource: "MANAGER",
          },
        });
        await tx.leadAssignmentHistory.create({
          data: {
            leadId: lead.id,
            fromUserId: chuCu,
            toUserId: nhan.id,
            assignedById: params.actorId,
            reason: params.lyDo,
          },
        });
        // N-4 — đi qua cửa chung (dòng + đồng hồ trong một lượt), S-3 — đóng dấu máy.
        await recordLeadActivity({
          tx,
          leadId: lead.id,
          actorId: params.actorId,
          actorName: params.actorName,
          type: "NOTE",
          content: `Phân bổ lại lead nguội (${params.nguongNgay}+ ngày không ai chăm) — ${params.lyDo}`,
          metadata: { ...SYSTEM_ACTIVITY_META, nguoi: true, orgUnitId },
        });
        await logLeadAudit({
          leadId: lead.id,
          action: "ASSIGN",
          actorId: params.actorId,
          actorName: params.actorName,
          oldValues: { assignedToId: chuCu },
          newValues: { assignedToId: nhan.id },
          changedFields: ["assignedToId"],
          reason: params.lyDo,
          tx,
        });
      });
      await thuHoiChuongLeadCu({ chuCuId: chuCu, chuMoiId: nhan.id, leadId: lead.id });
      daChia.push({ leadId: lead.id, ownerId: nhan.id });
      continue;
    }

    // Chia vòng: đi qua đúng cỗ máy chia sẵn có nên sổ chia lead không bị lệch, và
    // `targetCenterId` là cơ sở của CHÍNH lead ⇒ pool không bao giờ vượt ra ngoài cơ sở đó.
    const kq = await chiaChoLead(lead.id, {
      targetCenterId: lead.centerId,
      createdById: params.actorId,
      entryPoint: "IMPORT",
      explicitOwnerId: null,
      imLangChuong: true,
    }).catch((err) => {
      console.error("[lead-nguoi] chia vòng:", err);
      return null;
    });
    if (!kq?.assignedToId) {
      boQua.push({ leadId: lead.id, lyDo: "Pool của cơ sở không có tư vấn viên nào đang bật" });
      continue;
    }
    daChia.push({ leadId: lead.id, ownerId: kq.assignedToId });
  }

  // MỘT tin gộp cho mỗi người nhận — không bắn N chuông (xem `lib/push/allowlist.ts`).
  await baoLoLeadMoi({
    daChia,
    nguon: { kieu: "sale_nghi", tuNguoi: "danh sách lead lâu ngày chưa chăm" },
    mocLuot,
    boQuaNguoi: params.actorId,
  });

  return { ok: true, daChia: daChia.length, boQua };
}
