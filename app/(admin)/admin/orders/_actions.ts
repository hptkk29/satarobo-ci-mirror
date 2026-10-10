"use server";

import { redirect } from "next/navigation";
import { KHOAN_DA_GHI_NHAN } from "@/lib/finance/ghi-nhan";
import { revalidatePath } from "next/cache";
import { Prisma, type OrderStatus, type OrderType } from "@prisma/client";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb, passesScope } from "@/lib/db-scope";
import {
  METHOD_WRONG_CENTER_ERROR,
  methodAllowsOrderType,
  methodServesCenter,
} from "@/lib/payments/method-scope";
import {
  orderCreateManualSchema,
  orderStatusChangeSchema,
} from "@/lib/validators/order";
import { generateOrderCode, withUniqueRetry } from "@/lib/orders/code";
import { checkOrderCreateOwnership } from "@/lib/orders/create-guard";
import { conDonTuCacDong, resolveOrderLeadChildId } from "@/lib/orders/lead-child-link";
import { canTransition } from "@/lib/orders/status";
import { xetDuyetDon } from "@/lib/orders/nguong-duyet";
import { lyDoKhongXoaDuoc } from "@/lib/orders/xoa-don-huy";
import { demDauVetDon, xoaDonVaCon } from "@/lib/orders/xoa-don-db";
import { lyDoSoBuoi, xetSoBuoiDong } from "@/lib/orders/so-buoi-hoc-phan";
import { orgUnitIdForCenter } from "@/lib/org/org-service";
import { recordInstallmentPlan, markInstallmentPaid } from "@/lib/orders/installments";
import { getSetting } from "@/lib/settings/service";
import { expandPhoneVariants } from "@/lib/phone";
import {
  dongThieuGiaiTrinh,
  giaiTrinhGopChoDon,
  khoanVuotTran,
  loiThieuGiaiTrinh,
  loiVuotTran,
  tienDon,
  type KieuGiam,
  docLoaiGiam,
} from "@/lib/orders/giam-gia-dong";
import { ensureParentAccountForOrder } from "@/lib/parents/provision";
import { ensureOrderPaymentRecorded } from "@/lib/finance/payment";
import { ensureFullOrderRequest } from "@/lib/payments/payment-request";
import { dotsGhiTuForm } from "@/lib/payments/ke-hoach-dot";
import { laThuTienLinhHoatBat } from "@/lib/finance/feature";
import { getRequestMetadata } from "@/lib/audit/headers";
import { getAuditActor } from "@/lib/audit/log";
import { ghiTuongTacLeadBoQuaLoi } from "@/lib/lead/tuong-tac/ghi";
import {
  taoDotChoCon,
  huyDotChoCon,
  ganKhoanDaThuChoCon,
  boGanKhoanKhoiCon,
  tachKhoanChoCon,
  chuyenTienGiuaCon,
} from "@/lib/finance/ghi-tien-don";
import { phatHoacDungLaiPhieuGop, huyPhieuGop, dongPhieuGop } from "@/lib/finance/phieu-gop";
import { khoaDonTrongTx } from "@/lib/finance/ghi-tien-don";
import { voidTienKhiHuyDonTrongTx } from "@/lib/orders/huy-don-tien";
import { thongDiepPhieuKhiHuyDon } from "@/lib/finance/soat-phieu-gop";
import type { PhieuDaSoat } from "@/lib/finance/soat-phieu-gop-db";
import { dungHocMotCon, xemTruocDungHoc } from "@/lib/finance/dung-hoc-con";
import { themConVaoDon, xemTruocThemCon } from "@/lib/finance/them-con-vao-don";
import { doiKhoaChoCon, xemTruocDoiKhoa } from "@/lib/finance/doi-khoa-db";
import { mienGiamNoChoCon } from "@/lib/finance/mien-giam-db";
import { docChinhSachUuDai } from "@/lib/finance/uu-dai-setting";
import { writeAudit } from "@/lib/audit/audit-log";
import { canhBaoSuaNguoiMua, type CotNguoiMua } from "@/lib/finance/hoa-don/canh-bao-sua-nguoi-mua";
import { soatGiaDon } from "@/lib/orders/price-guard";
import { congNoDon } from "@/lib/finance/cong-no-don";
import { haiTrucTheoDon, KHONG_CO_TIEN } from "@/lib/finance/hai-truc-theo-don";
import { trangThaiDon } from "@/lib/orders/trang-thai-don";
import {
  hocVienLaCuaNguoiKhac,
  hocVienTrenCacDong,
  studentIdChoDon,
  thieuHocVienODong,
  veMetadataConLead,
} from "@/lib/orders/hoc-vien-dong-don";
import { docHinhThucLop } from "@/lib/orders/hinh-thuc-lop";
import { phamViDon, loPhamViDon, moTaPhamVi } from "@/lib/orders/pham-vi-don";
import { baoDonChoDuyet } from "@/lib/orders/bao-cho-duyet";
import { laDonChoDuyet, WHERE_CHO_DUYET } from "@/lib/orders/cho-duyet";
import { kepCoSoTheoTamNhin } from "@/lib/orders/loc-pham-vi";
import { laKhoaLoaiTruCoach } from "@/lib/finance/coach-pricing";
import { sendEmailForTrigger } from "@/lib/email/trigger";
import { notifyOrderByZnsIfNoEmail } from "@/lib/notify/order";
import { renderTemplate } from "@/lib/email/render";
import { randomUUID } from "node:crypto";
import { sendEmail } from "@/lib/email/send";
import { docMaTheoId } from "@/lib/khuyen-mai/chon-cho-don";
import { NHAN_LY_DO_LOAI, khaiGiamTuMa, lyDoKhongDung } from "@/lib/khuyen-mai/ap-vao-don";
import { ngayVN } from "@/lib/format/thoi-gian-vn";
// GĐ1 POS (06/10/2026) — thu học phí bằng thẻ: ba action ở mục "THU THẺ POS" cuối nhóm phiếu gộp.
import { publishEvent } from "@/lib/events/publish";
import { baoAdminPhieuPos, moPhieuPos } from "@/lib/payments/pos/phieu-pos";
import { kiemTraPhieuPos, type KetQuaKiemPos } from "@/lib/payments/pos/xu-ly-ket-qua";
import { chonPosProvider } from "@/lib/payments/pos/provider/chon";
import type { PhieuPosView } from "@/lib/payments/pos/phieu-pos-luat";
import { baoAdminPhieuPosSchema, kiemTraPhieuPosSchema, taoPhieuPosSchema } from "@/lib/validators/phieu-pos";
import { huyPhieuTheSchema, type HuyPhieuTheInput } from "@/lib/validators/huy-phieu-the";
import type { KetQuaHuyPhieuThe } from "@/lib/payments/pos/huy-phieu-the";
import { huyPhieuThe } from "@/lib/payments/pos/huy-phieu-the-db";
import { QUYEN_THU_THE_POS, quyenTaiCoSoCuaDon } from "@/lib/payments/pos/quyen-co-so";

const PAGE_SIZE = 20;

async function requireOrdersView() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // Gate list-level (nhiều đơn, không có 1 centerId cụ thể) — không truyền target.
  if (!(await checkPermission("orders:view"))) {
    redirect("/dashboard?error=unauthorized");
  }
  return session;
}

async function requireOrdersManage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // orders:manage chỉ HO_ACCOUNTANT (GLOBAL) — không cần target.
  if (!(await checkPermission("orders:manage"))) {
    redirect("/dashboard?error=unauthorized");
  }
  return session;
}

/**
 * G-A (biên bản chốt 4 cổng, 21/08/2026) — cổng TẠO đơn.
 *
 * Trước đây cổng này là `orders:manage`, khiến Sale không tạo được đơn ⇒ không
 * `payments:record` ⇒ không đủ điều kiện convert ⇒ **không chốt được khách**.
 * Nay cổng là `orders:create` (rộng hơn về người, hẹp hơn về phạm vi), còn phạm
 * vi "chỉ đơn gắn lead của mình" do `checkOrderCreateOwnership()` gác bên trong.
 *
 * Trả kèm `canManageAll` để action biết có phải áp ràng buộc chủ-lead hay không.
 */
async function requireOrdersCreate() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // Cả 2 action đều GLOBAL ở mọi RoleDef giữ chúng ⇒ gọi trần, không cần target.
  if (!(await checkPermission("orders:create"))) {
    redirect("/dashboard?error=unauthorized");
  }
  const canManageAll = await checkPermission("orders:manage");
  return { session, canManageAll };
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(
    JSON.stringify({ c: createdAt.toISOString(), i: id }),
  ).toString("base64");
}
function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64").toString()) as {
      c: string;
      i: string;
    };
    return { createdAt: new Date(decoded.c), id: decoded.i };
  } catch {
    return null;
  }
}

export type OrderFilters = {
  dateFrom?: string;
  dateTo?: string;
  status?: OrderStatus;
  type?: OrderType;
  search?: string;
  /**
   * Chỉ lấy đơn đang CHỜ DUYỆT [25/09/2026].
   *
   * ⚠️ Lọc ở SERVER bằng đúng mảnh `where` mà khối "Chờ bạn duyệt" dùng
   * (`WHERE_CHO_DUYET`), KHÔNG lọc trong bộ nhớ trên tập vừa tải. Lọc ở client thì con
   * số trên chip đếm được đúng một TRANG, và người dùng bấm vào thấy 3 đơn trong khi
   * khối trên đầu nói 11 — hai con số cho cùng một câu hỏi.
   */
  choDuyet?: boolean;
  /**
   * Lọc theo CƠ SỞ [25/09/2026]. Rỗng/thiếu = không lọc (xem hết tầm nhìn).
   *
   * ⚠️ Giá trị tới từ client nên PHẢI kẹp về tầm nhìn ở server — xem
   * `kepCoSoTheoTamNhin`. Không kẹp thì một sale gửi id cơ sở khác và điều kiện ấy đi
   * thẳng vào câu tra.
   */
  coSoIds?: string[];
  /**
   * Lọc theo KHU VỰC. Dịch thành danh sách `centerId` ở server (cơ chế cách ly của repo
   * vẫn đo bằng `centerId` — CLAUDE.md luật cứng #3), không lọc thẳng theo `orgUnitId`.
   */
  khuVucId?: string;
};

// ─── QUERY ORDERS LIST ──────────────────────────────────────────────
export async function queryOrders(
  filters: OrderFilters,
  cursor: string | null,
) {
  const session = await requireOrdersView();
  // Cách ly cơ sở: Order ∈ SCOPED_MODELS → findMany tự inject `centerId IN visibleCenterIds`.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const AND: Array<Record<string, unknown>> = [];

  // ── TẦNG LỌC THỨ HAI: SALE CHỈ THẤY ĐƠN CỦA KHÁCH MÌNH [25/09/2026] ─────────
  //
  // Chủ dự án: *"nhớ rule sale nào thì thấy đơn hàng của sale đó"*. `scopedDb` chỉ cách ly
  // theo CƠ SỞ, nên trước bản này mọi sale cùng cơ sở đọc được đơn của nhau (cả tiền lẫn
  // tên khách).
  //
  // ⚠️ Luật nằm ở `lib/orders/pham-vi-don.ts`, KHÔNG viết điều kiện tại chỗ — đọc chú
  // thích ở đó để biết vì sao gate là "có `create` mà không có `manage`" chứ không phải
  // "không có `manage`" (vế sau xoá trắng màn hình của Kế toán cơ sở).
  const pv = phamViDon({
    canManage: await checkPermission("orders:manage"),
    canCreate: await checkPermission("orders:create"),
    userId: session.user.id,
  });
  const loPv = loPhamViDon(pv);
  if (loPv) AND.push(loPv);
  if (filters.dateFrom)
    AND.push({ createdAt: { gte: new Date(filters.dateFrom) } });
  if (filters.dateTo) {
    const to = new Date(filters.dateTo);
    to.setHours(23, 59, 59, 999);
    AND.push({ createdAt: { lte: to } });
  }
  if (filters.choDuyet) AND.push({ ...WHERE_CHO_DUYET });

  // ── LỌC THEO PHẠM VI TỔ CHỨC [25/09/2026] ───────────────────────────────────
  //
  // ⚠️ KẸP TRƯỚC KHI DÙNG. `scopedDb` đứng sau vẫn chặn (Order ∈ SCOPED_MODELS), nhưng
  // dựa vào MỘT lớp cho một cổng đọc là thói quen sai — xem `lib/orders/loc-pham-vi.ts`.
  // Người neo ở HO có `centerScope === "ALL"` nên không có gì để kẹp.
  // `isSuperAdmin`/`isHoLevel` = thấy mọi cơ sở ⇒ không có gì để kẹp. Mọi vai khác kẹp
  // về `visibleCenterIds`, đúng tập mà `scopedDb` cũng đang dùng.
  const coSoXin =
    actor.isSuperAdmin || actor.isHoLevel
      ? [...new Set(filters.coSoIds ?? [])]
      : kepCoSoTheoTamNhin(filters.coSoIds, actor.visibleCenterIds);
  if (coSoXin.length > 0) AND.push({ centerId: { in: coSoXin } });

  // Khu vực ⇒ danh sách cơ sở của khối. MỘT câu tra, và CHỈ khi người dùng thật sự lọc
  // theo khối — hôm nay tổ chức có đúng một khối nên nhánh này gần như không chạy.
  if (filters.khuVucId) {
    const nut = await sdb.orgUnit.findMany({
      where: { type: "CENTER", parentId: filters.khuVucId, deletedAt: null },
      select: { centerId: true },
    });
    const idKhoi = nut
      .map((n: { centerId: string | null }) => n.centerId)
      .filter((x: string | null): x is string => x !== null);
    // Khối không có cơ sở nào ⇒ `in: []` ⇒ 0 dòng. ĐÚNG, và khác hẳn ngữ nghĩa "bỏ điều
    // kiện": người dùng đã chọn một khối cụ thể, trả về mọi đơn là nói dối.
    AND.push({ centerId: { in: idKhoi } });
  }
  if (filters.status) AND.push({ status: filters.status });
  if (filters.type) AND.push({ type: filters.type });
  if (filters.search) {
    const s = filters.search.trim();
    AND.push({
      OR: [
        { code: { contains: s, mode: "insensitive" } },
        { customerName: { contains: s, mode: "insensitive" } },
        { customerPhone: { contains: s } },
      ],
    });
  }

  if (cursor) {
    const decoded = decodeCursor(cursor);
    if (decoded) {
      AND.push({
        OR: [
          { createdAt: { lt: decoded.createdAt } },
          {
            AND: [{ createdAt: decoded.createdAt }, { id: { lt: decoded.id } }],
          },
        ],
      });
    }
  }

  const rows = await sdb.order.findMany({
    where: AND.length ? { AND } : undefined,
    include: {
      paymentMethod: { select: { code: true, name: true } },
      _count: { select: { items: true } },
      // G5 — badge suy diễn "Đã đóng đợt 1" cho danh sách (chỉ cần soDot + status).
      installments: { select: { soDot: true, status: true } },
      // SALE PHỤ TRÁCH [02/10/2026] — xem chú thích ở `salePhuTrachName` bên dưới.
      lead: { select: { assignedToId: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
  });

  const hasMore = rows.length > PAGE_SIZE;
  const rawItems = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  const last = rawItems[rawItems.length - 1];
  const nextCursor =
    hasMore && last ? encodeCursor(last.createdAt, last.id) : null;

  // "Người tạo đơn" — `Order.createdById` là String THUẦN (không quan hệ Prisma, cùng
  // lối với `confirmedByUserId` / `Payment.recordedById`) → tra tên bằng MỘT query User.
  // Khuôn mẫu chép từ `queryPayments` (admin/payments/_actions.ts).
  // User ∈ SCOPE_EXEMPT nên đọc toàn cục OK — và cần vậy: đơn của cơ sở mình có thể do
  // người Hội sở tạo, scope theo cơ sở sẽ làm mất tên chính người đó.
  // ⚠️ GỘP sale phụ trách vào CÙNG lượt tra User [02/10/2026]. Tra riêng là thêm một
  // câu nữa cho mỗi trang danh sách — mà trang admin vốn đã bị nhắc vì độ sâu tuần tự
  // (CLAUDE.md: *"trang admin chậm gần như luôn là độ sâu tuần tự"*).
  const creatorIds = [
    ...new Set(
      [
        ...rawItems.map((r) => r.createdById),
        ...rawItems.map((r) => r.lead?.assignedToId ?? null),
      ].filter((v): v is string => !!v),
    ),
  ];
  const creators = creatorIds.length
    ? await sdb.user.findMany({
        where: { id: { in: creatorIds } },
        select: { id: true, name: true },
      })
    : [];
  const creatorNameById = new Map(creators.map((u) => [u.id, u.name]));

  /**
   * HAI TRỤC cho cả trang — MỘT lượt tra, không N+1 [16/09/2026].
   *
   * Chủ dự án chốt trạng thái đơn suy từ TIỀN và hiển thị hai trục. Trang chi tiết đã đổi;
   * danh sách mà không đổi thì CÙNG MỘT ĐƠN mang hai nhãn khác nhau ở hai màn — đo trên
   * `satarobo_local`: lọc "Đã xác nhận đơn" trả 81 đơn mà **0/81** đơn nào còn mang nhãn
   * đó ở trang chi tiết (77 hoá "Đang đóng", 4 hoá "Đã đóng đủ").
   *
   * ⚠️ Truyền `sdb` (đã scope), KHÔNG phải `db` trần — `Payment` ∈ SCOPED_MODELS.
   */
  const tienTheoDon = await haiTrucTheoDon(sdb, rawItems.map((o) => o.id));

  const items = rawItems.map((o) => {
    const t = tienTheoDon.get(o.id) ?? KHONG_CO_TIEN;
    const so = congNoDon({
      totalAmount: o.totalAmount,
      daGhiNhan: t.daGhiNhan,
      daXacNhan: t.daXacNhan,
    });
    return {
      ...o,
      // null = đơn tạo TRƯỚC 31/08/2026 (chưa có cột) hoặc người tạo đã bị xoá. Màn hình
      // in "—"; cố ý KHÔNG đoán bừa từ nguồn khác.
      createdByName: o.createdById ? (creatorNameById.get(o.createdById) ?? null) : null,
      /**
       * SALE PHỤ TRÁCH LEAD của đơn — `Lead.assignedToId` [02/10/2026].
       *
       * Chủ dự án: *"fix các đơn tôi tạo → sale phụ trách lead đó"*. Ca thật: 119 đơn
       * nhập từ file Excel đều mang `createdById` của NGƯỜI NHẬP, nên cột "Người tạo"
       * in cùng một cái tên cho cả trang và không ai biết khách đó của sale nào.
       *
       * ⚠️ CỐ Ý **KHÔNG** ghi đè `Order.createdById`. Hai lý do, cả hai đo được:
       *  · `createdById` là SỰ THẬT KIỂM TOÁN ("ai bấm tạo đơn này"). Ghi đè nó bằng
       *    người phụ trách là làm nhật ký nói dối, và mất luôn khả năng truy ra đơn nào
       *    do lượt nhập liệu sinh ra.
       *  · Hoa hồng KHÔNG đọc cột này: `convert-lead-v2.ts:629` đã chép
       *    `Enrollment.saleId = lead.assignedToId` ngay lúc chốt, và đó mới là nguồn
       *    tính hoa hồng (chú thích `commission-run.test.ts:40` nói rõ `assignedToId`
       *    là người ĐANG chăm, có thể đã đổi sau — nên tiền dùng ảnh chụp, không dùng
       *    giá trị sống).
       * ⇒ Đây là việc HIỂN THỊ, không phải việc sửa dữ liệu. Màn hình đọc giá trị SỐNG;
       *    sổ tiền giữ ảnh chụp. Hai câu hỏi khác nhau, hai nguồn khác nhau.
       *
       * `null` khi đơn không gắn lead (đơn thủ công), hoặc lead chưa phân sale.
       */
      salePhuTrachName: o.lead?.assignedToId
        ? (creatorNameById.get(o.lead.assignedToId) ?? null)
        : null,
      /**
       * Trạng thái SUY TỪ TIỀN — tính ở SERVER và gửi xuống nguyên vẹn.
       *
       * Cố ý không gửi hai con số thô rồi để client tự gọi `trangThaiDon`: client cũng
       * gọi được (hàm thuần), nhưng như thế là hai chỗ quyết định cùng một nhãn, và
       * trang chi tiết đã tính ở client rồi. Một trong hai phải là nơi duy nhất — chọn
       * server cho danh sách vì `congNoDon` cần số tiền mà chỉ server có.
       */
      trangThai: trangThaiDon({ status: o.status, so }),
      /** Bộ số thô đi kèm, để bảng in được "còn thiếu" mà không phải suy lại. */
      congNo: so,
      /**
       * Đơn này có đang CHỜ DUYỆT không [25/09/2026].
       *
       * Chủ dự án: *"các đơn hàng cần duyệt thì thiết kế nổi bật lên để QLCS biết"*.
       * Suy ở SERVER từ đúng hai cột mà `/orders/duyet` lọc, để danh sách và khối duyệt
       * không bao giờ nói hai điều khác nhau về cùng một đơn.
       */
      choDuyet: laDonChoDuyet(o),
    };
  });

  return {
    items,
    nextCursor,
    moTaPhamVi: moTaPhamVi(pv),
    /**
     * Tổng số đơn CHỜ DUYỆT trong tầm nhìn của người này — cho con số trên chip lọc.
     *
     * ⚠️ Đếm bằng một câu `count` RIÊNG, cố ý không đếm trên `items`: `items` là MỘT
     * TRANG (`PAGE_SIZE`), nên đếm trên nó cho ra "3 chờ duyệt" trong khi thật sự có 11.
     * Một con số sai kiểu đó tệ hơn không có số — nó làm người ta tin là đã duyệt hết.
     *
     * ⚠️ Nằm TRONG `queryOrders` để dùng lại đúng `sdb` + `loPv` đã dựng; tách ra một
     * action riêng là mở đường cho hai phạm vi nhìn khác nhau trên cùng một màn.
     */
    soChoDuyet: await sdb.order.count({
      where: { AND: [...(loPv ? [loPv] : []), { ...WHERE_CHO_DUYET }] },
    }),
  };
}

// ─── CREATE MANUAL ORDER ────────────────────────────────────────────
export async function createOrderManualAction(input: unknown) {
  const { session, canManageAll } = await requireOrdersCreate();
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  // Đọc NGOÀI transaction: `getRequestMetadata` gọi `headers()`, không dùng được bên
  // trong `$transaction` của Prisma.
  const auditMeta = await getRequestMetadata();
  const parsed = orderCreateManualSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      error: "Dữ liệu không hợp lệ",
      issues: parsed.error.flatten(),
    };
  }

  const data = parsed.data;

  // G-A — người chỉ có `orders:create` (Sale) phải gắn đơn vào lead CỦA MÌNH.
  // Lead nạp qua `scopedDb` ⇒ lead ngoài cơ sở trả null ⇒ guard từ chối.
  // Kiểm TRƯỚC mọi truy vấn khác để không rò rỉ thông tin qua thông báo lỗi.
  if (!canManageAll) {
    const leadId = data.leadId?.trim() || null;
    const lead = leadId
      ? await sdb.lead.findFirst({
          where: { id: leadId, deletedAt: null },
          select: { id: true, assignedToId: true, centerId: true },
        })
      : null;
    const guard = checkOrderCreateOwnership({
      canManageAll,
      leadId,
      lead,
      actorUserId: session.user.id,
    });
    if (!guard.ok) return { ok: false as const, error: guard.message };
    // Cơ sở của đơn lấy theo lead (guard trả về), không tin giá trị client gửi.
    data.centerId = guard.enforcedCenterId ?? null;
  }

  // N-2 · quyết định B4 — quy đơn về ĐÚNG MỘT CON. Phiếu 1 con thì suy; phiếu nhiều con
  // mà không chọn thì để `null` và báo cáo nói ra — KHÔNG đoán, vì đoán sai là gán doanh
  // thu sang đứa khác mà TỔNG vẫn khớp nên không ai phát hiện.
  //
  // Cấy lại khi hợp nhất `main` → `test` 16/09/2026: bản `_actions.ts` bên `main` không
  // có bước này, trong khi biểu mẫu vẫn gửi `leadChildId` lên và `Order.leadChildId` có
  // thật trong schema ⇒ ô "Học sinh của đơn" rơi vào hư không, im lặng.
  const leadIdChoCon = data.leadId?.trim() || null;
  const leadChoCon = leadIdChoCon
    ? await sdb.lead.findFirst({
        where: { id: leadIdChoCon, deletedAt: null },
        select: { id: true, children: { select: { id: true, leadId: true } } },
      })
    : null;
  // NỢ-13 (chốt 18/09/2026) — NGUỒN LÀ CÁC DÒNG, không phải ô chọn cấp đơn.
  //
  // Ô "Học sinh của đơn" ở đầu biểu mẫu đã GỠ khi hợp nhất `main`: mỗi dòng hàng nay tự
  // chọn con của nó. Nếu để `requestedLeadChildId: data.leadChildId` thì trường đó luôn
  // rỗng ⇒ mọi đơn rơi về nhánh suy-từ-phiếu ⇒ phiếu có hai con là `null`, và doanh thu
  // của cả hai em rơi vào ô "chưa quy được về con" của `lib/reports/revenue-by-child.ts`.
  // Ca đó KHÔNG hiếm — chủ dự án: *"một phụ huynh đăng ký cho hai con trong cùng một đơn
  // là chuyện thường ở đây"*.
  //
  // `conDonTuCacDong` chỉ trả về con khi MỌI dòng có khai đều trỏ cùng một đứa; đơn hai
  // con vẫn ra `null` — thành thật, và báo cáo có ô riêng để nói ra.
  const childLink = resolveOrderLeadChildId({
    leadId: leadIdChoCon,
    requestedLeadChildId: conDonTuCacDong(data.items),
    children: leadChoCon?.children ?? [],
  });
  if (!childLink.ok) return { ok: false as const, error: childLink.message };
  const leadChildId = childLink.leadChildId;

  // Cách ly cơ sở (ghi): nếu form chọn cơ sở, cơ sở đó phải thuộc tầm nhìn actor
  // (orders:manage hiện là GLOBAL — guard này chỉ chặn khi role bị thu hẹp sau này).
  if (data.centerId && !passesScope("Order", { centerId: data.centerId }, actor)) {
    return { ok: false as const, error: "Không có quyền tạo đơn cho cơ sở này" };
  }

  // ── HỌC VIÊN CỦA TỪNG DÒNG HÀNG (15/09/2026 — đơn nhiều con) ────────────────
  //
  // `OrderItem.studentId` là một quan hệ TIỀN ("khoản này của con nào"), nên id client
  // gửi KHÔNG BAO GIỜ được tin thẳng: tra lại qua `scopedDb` (học viên ngoài tầm nhìn
  // trả rỗng) rồi đối chiếu đủ số. `scopedDb` KHÔNG che write — đây là chỗ tự gác.
  //
  // ⚠️ TỪ CHỐI CẢ ĐƠN, không âm thầm hoá null cái id lạ. Hoá null thì đơn vẫn tạo ra
  // nhưng mất thông tin "của con nào" — và mất im lặng, đúng lúc người nhập tin là đã
  // khai xong. Thà báo lỗi để họ chọn lại.
  const hocVienTrenDong = hocVienTrenCacDong(data.items);
  // Đơn hai con mà còn dòng bỏ trống ô học viên → chặn. Form đã chặn, nhưng form
  // chặn ở CLIENT; cổng thật phải ở đây (luật "scopedDb không che write").
  if (thieuHocVienODong(data.items)) {
    return {
      ok: false as const,
      error:
        "Đơn có nhiều học viên thì mọi dòng phải chọn rõ học viên — nếu không sau này không ai biết khoản tiền là của ai",
    };
  }
  // `data.studentId` (cột trên ĐƠN) đi cùng một cổng — trước đợt này nó chưa từng
  // được tra scope lần nào, tức một lời gọi action tự chế gắn được đơn vào học viên
  // của cơ sở khác. Gộp vào cùng tập để chỉ phải viết cổng MỘT lần.
  const hocVienIds = [
    ...new Set([...hocVienTrenDong, ...(data.studentId?.trim() ? [data.studentId.trim()] : [])]),
  ];
  if (hocVienIds.length > 0) {
    const thay = await sdb.student.findMany({
      where: { id: { in: hocVienIds }, deletedAt: null },
      select: { id: true, name: true, parentPhone: true },
    });
    if (thay.length !== hocVienIds.length) {
      return {
        ok: false as const,
        error:
          "Có học viên không tồn tại hoặc ngoài phạm vi của bạn — chọn lại ở dòng hàng",
      };
    }

    /**
     * ── BƯỚC A1 [16/09/2026]: EM TRÊN DÒNG PHẢI LÀ CON CỦA KHÁCH TRÊN ĐƠN ──
     *
     * Chủ dự án: *"mọi OrderItem khi tạo/sửa phải có học viên thuộc đúng lead/phụ huynh
     * của đơn, sai → từ chối"*.
     *
     * Cổng scope ở TRÊN chỉ hỏi "em này có thật và có thuộc cơ sở bạn nhìn thấy không" —
     * mà cả 247 em của cơ sở đều qua được câu đó. Nó KHÔNG hỏi "em này có phải con của
     * người đang mua không". Đơn `ORD-260915-000007` lọt đúng khe đó: đơn của chị Diễm
     * (`84941000002`) mà hai dòng ghi con của hai gia đình khác.
     *
     * Ô chọn đã vá sáng nay, nhưng vá ở CLIENT. Đây là vế SERVER — luật thật nằm ở
     * `hocVienLaCuaNguoiKhac` (thuần, có test + đã cấy lỗi), dùng chung với màn hình.
     */
    const sdtLead = data.leadId?.trim()
      ? ((await sdb.lead.findUnique({
          where: { id: data.leadId.trim() },
          select: { phone: true },
        }))?.phone ?? null)
      : null;
    const nhaKhac = hocVienLaCuaNguoiKhac(thay, data.customerPhone, sdtLead);
    if (nhaKhac.length > 0) {
      return {
        ok: false as const,
        error:
          `Không tạo được đơn: ${nhaKhac.map((h) => h.name).join(", ")} không phải con của ` +
          `số điện thoại trên đơn. Chọn lại học viên ở dòng hàng, hoặc cập nhật SĐT phụ ` +
          `huynh của em đó trước.`,
      };
    }
  }

  /**
   * CON LEAD trên các dòng — phải THẬT thuộc lead của đơn này [16/09/2026].
   *
   * Chủ dự án: *"lead này đa số là lead chưa chốt nên chưa phải là học viên nên sẽ lấy
   * thông tin con của PH lead đó chứ"*. Nên ô chọn học viên nay bày cả `LeadChild`.
   *
   * ⚠️ CỔNG NÀY KHÔNG PHẢI THỦ TỤC. `leadChildId` client gửi là một quan hệ TIỀN ("khoản
   * này của con nào"), y như `studentId`. Không tra lại thì một lời gọi action tự chế gắn
   * được dòng đơn vào con của gia đình KHÁC — và `LeadChild` KHÔNG thuộc `SCOPED_MODELS`
   * nên `scopedDb` không tự lọc giúp. Vì thế tra theo `leadId` của ĐƠN, chứ không tra
   * "con này có tồn tại không".
   *
   * ⚠️ Không có `leadId` trên đơn mà lại khai con lead ⇒ TỪ CHỐI. Đơn walk-in không gắn
   * lead thì không có cơ sở nào để nói đứa trẻ đó là con của khách này.
   */
  const conLeadTrenDong = [
    ...new Set(
      data.items
        .map((it) => it.leadChildId?.trim())
        .filter((v): v is string => !!v),
    ),
  ];
  if (conLeadTrenDong.length > 0) {
    const leadIdCuaDon = data.leadId?.trim() || null;
    if (!leadIdCuaDon) {
      return {
        ok: false as const,
        error:
          "Đơn không gắn lead nào mà lại chọn con khai trong lead — mở lại trang tạo đơn từ lead, hoặc chọn học viên đã có hồ sơ",
      };
    }
    const thayCon = await sdb.leadChild.findMany({
      where: { id: { in: conLeadTrenDong }, leadId: leadIdCuaDon },
      select: { id: true },
    });
    if (thayCon.length !== conLeadTrenDong.length) {
      return {
        ok: false as const,
        error:
          "Có con không thuộc lead của đơn này — chọn lại ở dòng hàng",
      };
    }
  }

  /**
   * `Order.studentId` — SUY TỪ CÁC DÒNG, không nhận từ client.
   *
   * Cột này chỉ có nghĩa khi cả đơn về ĐÚNG MỘT em; đơn hai con phải để NULL, vì
   * "con nào" lúc đó là thuộc tính của từng dòng chứ không của đơn. Form đã tính
   * đúng như vậy, nhưng nó tính ở CLIENT: gọi thẳng action vẫn gửi được một đơn có
   * hai dòng của hai em mà cột đơn trỏ vào em thứ ba. Từ đó mọi thứ đọc
   * `Order.studentId` — hoàn tiền, ZNS học phí, cổng phụ huynh — nói sai tên một
   * đứa trẻ, và không có lỗi nào nổ ra để ai biết.
   *
   * Không có dòng nào khai học viên thì giữ nguyên giá trị client gửi (đường
   * convert-lead vẫn dựa vào nó) — nhưng nay giá trị ấy đã qua cổng scope ở trên.
   */
  const studentIdCuaDon = studentIdChoDon(data.items, data.studentId);

  // ── DẤU VẾT GIÁ ──────────────────────────────────────────────────────────────
  // Hôm nay server tin tuyệt đối `unitPrice` client gửi, và vì `needsDiscountApproval`
  // chỉ xét `discountAmount > 0` nên đơn HẠ ĐƠN GIÁ không vào hàng chờ duyệt, không ghi
  // log nào, mà vẫn tự chốt được qua webhook — cổng duyệt chỉ che ô "Giảm giá".
  //
  // Ở đây CHỈ SO VÀ GHI DẤU, cố ý không từ chối và cố ý không quy lệch thành
  // `discountAmount` — lý do đầy đủ ở đầu `lib/orders/price-guard.ts` (tóm tắt: bán Coach
  // 1-1 ×2,0 và bán theo học phần ÷4 đều HỢP LỆ theo công văn, còn quy thành giảm giá là
  // bật cổng `sepay.ts` vốn làm tiền về không vào sổ nào).
  const courseIds = [
    ...new Set(
      data.items
        .map((it) => {
          const m = it.metadata as Record<string, unknown> | null | undefined;
          const v = m?.courseId;
          return typeof v === "string" && v ? v : null;
        })
        .filter((v): v is string => v != null),
    ),
  ];
  const productIds = [
    ...new Set(data.items.map((it) => it.productId).filter((v): v is string => !!v)),
  ];
  const [giaKhoa, giaSanPham] = await Promise.all([
    courseIds.length > 0
      ? sdb.course.findMany({
          where: { id: { in: courseIds } },
          // `totalSessions` cho luật MỐC HỌC PHẦN (25/09/2026). Cùng câu tra với giá —
          // thêm một cột, không thêm lượt đi-về nào (luật "độ sâu tuần tự", `[DST-01]`).
          select: { id: true, price: true, totalSessions: true },
        })
      : Promise.resolve([]),
    productIds.length > 0
      ? sdb.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, salePrice: true },
        })
      : Promise.resolve([]),
  ]);
  const bangGia = new Map<string, number | null>([
    ...giaKhoa.map((c) => [c.id, c.price] as const),
    ...giaSanPham.map((p) => [p.id, p.salePrice] as const),
  ]);
  /** Tổng số buổi CHUẨN của từng khoá — vế PHẠM VI của luật mốc học phần. */
  const bangSoBuoiKhoa = new Map<string, number | null>(
    giaKhoa.map((c) => [c.id, c.totalSessions] as const),
  );
  // ── HÌNH THỨC LỚP (SR.QD.219 Điều 5) ────────────────────────────────────────
  // Gác đúng MỘT điều server kiểm được: khoá mà công văn LOẠI khỏi Coach thì không được
  // bán Coach. Những thứ còn lại (`coachFormat` có khớp lớp học thật không, `soBuoi` có
  // đúng số buổi khách mua không) server KHÔNG suy ra được — model `Class` không có cột
  // hình thức lớp — nên chúng chỉ được GHI LẠI, không được dùng để định giá.
  //
  // ⚠️ CỐ Ý KHÔNG đưa hình thức lớp vào `giaNiemYet` của `soatGiaDon` bên dưới. Hôm nay
  // `giaNiemYet` là `Course.price` tra từ DB nên client không chạm được; nếu giá kỳ vọng
  // tính từ `coachFormat` + `soBuoi` (vốn nằm trong payload client) thì client cầm CẢ HAI
  // VẾ của phép so — khai `soBuoi` nhỏ là mọi đơn bán rẻ thành "khớp". Đo + phản biện
  // 14/09/2026; chi tiết ở đầu `lib/orders/hinh-thuc-lop.ts`.
  const hinhThucDong = data.items.map((it) => docHinhThucLop(it.metadata));
  const idKhoaCoach = [
    ...new Set(
      hinhThucDong
        .filter((h) => h.coachFormat !== "GROUP" && h.courseId)
        .map((h) => h.courseId as string),
    ),
  ];
  if (idKhoaCoach.length > 0) {
    const khoaCoach = await sdb.course.findMany({
      where: { id: { in: idKhoaCoach } },
      select: { id: true, name: true, slug: true, code: true },
    });
    const biLoai = khoaCoach.find((c) => laKhoaLoaiTruCoach(c));
    if (biLoai) {
      return {
        ok: false as const,
        error:
          `Khoá "${biLoai.name}" không áp dụng hình thức Coach (SR.QD.219 Điều 5 — gói ` +
          "cam kết 5 buổi, giá cố định Điều 3). Chọn lớp nhóm, hoặc chọn khoá khác.",
      };
    }
  }

  const soatGia = soatGiaDon(
    data.items.map((it) => {
      const m = it.metadata as Record<string, unknown> | null | undefined;
      const courseId = typeof m?.courseId === "string" ? m.courseId : null;
      const khoa = courseId ?? it.productId ?? null;
      return {
        itemName: it.itemName,
        soLuong: it.quantity,
        giaGhi: it.unitPrice,
        giaNiemYet: khoa ? (bangGia.get(khoa) ?? null) : null,
      };
    }),
  );

  // ── TIỀN CỦA ĐƠN: SUY TỪ CÁC DÒNG (15/09/2026) ───────────────────────────────
  //
  // Giảm giá nay khai theo TỪNG DÒNG. Server TÍNH LẠI toàn bộ bằng `tienDon` chứ không
  // nhận con số nào từ client: `discountAmount` client gửi là Ý ĐỊNH, không phải kết
  // quả. Tin nó là để client cầm cả hai vế của phép trừ — gửi `unitPrice` 10.000.000 và
  // `discountAmount` 9.999.999 thì đơn ra 1đ mà không cổng nào thấy gì bất thường.
  // ── KHOẢN GIẢM THEO CHƯƠNG TRÌNH KHUYẾN MÃI [28/09/2026] ─────────────────────
  //
  // 🔴 SERVER TÍNH LẠI TỪ DB. Client chỉ gửi `voucherId`; `kieu`/`giaTri`/`tranTien`/
  // `lyDo` của khoản đó bị GHI ĐÈ bằng `khaiGiamTuMa(<mã đọc từ DB>)`.
  //
  // Nhận số client gửi là để client cầm CẢ HAI VẾ: gửi `voucherId` của chương trình 10%
  // kèm `giaTri: 90` thì đơn ra 10% giá gốc và không cổng nào thấy gì bất thường. Đúng
  // cái bẫy đã ghi ở `lib/orders/hinh-thuc-lop.ts` cho `soBuoi` — ở đó client cầm một
  // vế đã đủ nguy hiểm để phải ghi hẳn một mục CLAUDE.md.
  const idMa = [
    ...new Set(
      data.items.flatMap((it) =>
        (it.discounts ?? []).map((k) => k.voucherId).filter((x): x is string => !!x),
      ),
    ),
  ];
  const maTheoId = await docMaTheoId(idMa);
  // Ngày xét là ngày của SERVER, không phải ngày client gửi (client không gửi ngày, và
  // đừng thêm đường đó: đổi đồng hồ máy là dùng được chương trình đã hết hạn).
  const ngayXet = ngayVN(new Date());
  // MÃ OrgUnit của cơ sở đơn — rỗng khi đơn không gắn cơ sở. Fail-closed: chính sách
  // khai riêng cơ sở sẽ không khớp, chỉ chính sách toàn hệ thống mới qua.
  // `Center` được miễn scope (pass-through) nên `sdb` ở đây đọc y như `db` trần — dùng
  // `sdb` vì đường ghi của admin KHÔNG được import `@/lib/db` trần (ESLint error).
  const maCoSoDon = data.centerId
    ? (await sdb.center.findUnique({ where: { id: data.centerId }, select: { code: true } }))?.code
    : null;
  const phamViCoSoDon = maCoSoDon ? [maCoSoDon] : [];

  const khaiDong = data.items.map((it) => ({
    unitPrice: it.unitPrice,
    quantity: it.quantity,
    // DANH SÁCH khoản giảm của dòng, đúng thứ tự người bán gõ. Validator đã chặn cách
    // khai cũ (một khoản/dòng) cho ra tiếng, nên ở đây chỉ còn MỘT hình dạng.
    giam: (it.discounts ?? []).map((k) => {
      const m = k.voucherId ? maTheoId.get(k.voucherId) : undefined;
      // Có mã hợp lệ ⇒ MỌI con số đến từ `khaiGiamTuMa`, không một field nào của client
      // lọt vào. Không có mã ⇒ khoản gõ tay như cũ.
      if (m) return khaiGiamTuMa(m);
      return {
        kieu: k.kieu as KieuGiam,
        giaTri: k.giaTri,
        lyDo: k.lyDo ?? null,
        // PHIÊN E — NHÃN loại ưu đãi, chở nguyên sang `discounts` JSON. `gopGiamGia` không
        // đọc nó để quyết một đồng nào; validator đã kẹp vào `MA_LOAI_GIAM`.
        loai: docLoaiGiam(k.loai),
        tranTien: null,
        voucherId: null,
      };
    }),
  }));

  // Cổng mã khuyến mãi — TỪ CHỐI cả đơn, không lặng lẽ bỏ mã rồi lưu tiếp. Lưu tiếp là
  // đơn ra đúng giá gốc trong khi sale vừa hứa khách một mức giảm, và không ai biết cho
  // tới lúc phụ huynh đọc phiếu thu.
  for (const [i, it] of data.items.entries()) {
    const tamTinhDong = Math.max(0, it.unitPrice) * Math.max(0, it.quantity);
    for (const [j, k] of (it.discounts ?? []).entries()) {
      if (k.voucherId == null) continue;
      const cho = `dòng ${i + 1} (khoản ${j + 1})`;
      if (k.voucherId === "") {
        return { ok: false as const, error: `Chưa chọn chương trình khuyến mãi ở ${cho}` };
      }
      const m = maTheoId.get(k.voucherId);
      if (!m) return { ok: false as const, error: `Mã khuyến mãi không tồn tại ở ${cho}` };
      // Khoá của dòng nằm trong `metadata.courseId` — `Enrollment` chưa tồn tại lúc tạo
      // đơn nên không có cột nào khác chở nó. Cùng cách đọc với khối gợi ý giá ở trên.
      const meta = it.metadata as Record<string, unknown> | undefined;
      const courseIdDong = typeof meta?.courseId === "string" ? meta.courseId : null;
      // Kiểm LẠI đủ điều kiện bằng chính hàm mà form dùng — một hàm, hai nơi gọi.
      const lyDo = lyDoKhongDung(m, {
        courseId: courseIdDong,
        phamViCoSo: phamViCoSoDon,
        ngay: ngayXet,
        tamTinhDong,
      });
      if (lyDo) {
        return { ok: false as const, error: `${m.ma}: ${NHAN_LY_DO_LOAI[lyDo]} — ${cho}` };
      }
    }
  }

  // ── TRẦN LƯỢT DÙNG THEO NGƯỜI (`Voucher.usageLimitPerUser`) ──────────────────
  //
  // 🔴 Cột này có từ đầu và **chưa từng có ai đọc** (`git grep usageLimitPerUser` ngày
  // 28/09: 0 dòng ngoài schema). Một trần không ai đọc là một trần không tồn tại — người
  // vận hành khai "mỗi khách 1 lượt" rồi yên tâm, trong khi hệ không hề chặn.
  //
  // ⚠️ ĐẶT TRƯỚC TRANSACTION, cố ý. Đây là cổng TỪ CHỐI, và luật rollback của repo bắt
  // mọi cổng đứng TRƯỚC phép ghi đầu tiên. Để trong tx thì nó phải `throw` để rollback —
  // chạy được, nhưng đắt hơn (đã tạo đơn rồi mới huỷ) và thông báo khó nói tử tế.
  //
  // ⚠️ Đếm theo SĐT, không theo tài khoản: đơn walk-in không có `User` nào, và
  // `VoucherRedemption.customerPhone` là ảnh chụp có sẵn đúng cho việc này.
  //
  // KHÔNG chống được đua (hai đơn cùng lúc cùng SĐT). Chấp nhận có chủ đích: trần theo
  // NGƯỜI là luật chống lạm dụng, lệch một lượt không mất tiền. Trần theo TỔNG SỐ LƯỢNG
  // mới là chỗ có đua thật, và nó được khoá bằng `updateMany` có điều kiện trong tx.
  {
    const sdt = data.customerPhone.trim();
    for (const [i, it] of data.items.entries()) {
      for (const [j, k] of (it.discounts ?? []).entries()) {
        if (!k.voucherId) continue;
        const m = maTheoId.get(k.voucherId);
        if (!m) continue; // đã bị cổng trên từ chối
        const tran = await sdb.voucher.findUnique({
          where: { id: m.voucherId },
          select: { usageLimitPerUser: true },
        });
        if (!tran || tran.usageLimitPerUser <= 0) continue;
        const daDung = await sdb.voucherRedemption.count({
          where: { voucherId: m.voucherId, customerPhone: sdt },
        });
        if (daDung >= tran.usageLimitPerUser) {
          return {
            ok: false as const,
            error:
              `${m.ma}: khách ${sdt} đã dùng ${daDung}/${tran.usageLimitPerUser} lượt ` +
              `của chương trình này — dòng ${i + 1} (khoản ${j + 1}).`,
          };
        }
      }
    }
  }

  // ID CỦA TỪNG DÒNG, sinh TRƯỚC [28/09/2026] — để ghi `VoucherRedemption.orderItemId`.
  //
  // ⚠️ Vì sao KHÔNG đọc ngược id sau khi tạo: `order.create` nhận `items` lồng nhau, và
  // Prisma KHÔNG hứa thứ tự của quan hệ đọc ra khớp thứ tự mảng đầu vào. Ghép theo
  // `(itemName, unitPrice)` cũng không được — hai con học CÙNG khoá là hai dòng giống hệt
  // nhau. Sinh id trước là cách duy nhất biết chắc lượt dùng gắn đúng dòng nào.
  //
  // Cột là `String @id @default(cuid())`; đưa giá trị tường minh vào là hợp lệ, và không
  // chỗ nào trong repo ép id phải mang hình dạng cuid (đã `git grep`).
  const itemIds = data.items.map(() => randomUUID());

  // Giải trình BẮT BUỘC cho từng dòng có giảm. Validator đã gác từng dòng một, nhưng
  // gác lại ở đây để thông báo nói được DÒNG NÀO — với đơn bốn dòng thì "thiếu giải
  // trình" không đủ để người bán biết đi sửa ở đâu.
  // TRẦN % lấy từ THAM SỐ VẬN HÀNH, không phải hằng trong mã. Người vận hành sửa ở màn
  // "Cấu hình vận hành" (`orders.maxDiscountPercent`, mặc định 50 — chốt 15/09/2026) và
  // đường ghi này phải đi theo ngay. Đây đúng là cái bẫy CLAUDE.md đã ghi cho
  // `crm.commissionMaxTotalRate`: nới trần ở màn cấu hình mà đường ghi vẫn chặn theo số
  // cũ thì không lỗi nào báo, chỉ có sale gọi điện hỏi vì sao không lưu được đơn.
  const tranPhanTram = await getSetting("orders.maxDiscountPercent");

  // ═══════════════════════════════════════════════════════════════════════════
  // NGƯỠNG DUYỆT — chủ dự án chốt 22/09/2026: quá 4 đợt hoặc quá 1 ưu đãi/dòng thì đơn
  // VẪN LƯU ĐƯỢC nhưng vào hàng chờ Quản lý cơ sở duyệt, và KHÔNG xuất được mã QR.
  //
  // ⚠️ PHẢI truyền `orgUnitId` — khác dòng ngay trên. `orders.maxDiscountPercent` khai
  // `centerOverridable: false` nên bỏ trống là vô hại; hai tham số này khai `true`, và
  // `getSetting` bỏ trống `orgUnitId` thì CHỈ đọc mức toàn cục ⇒ cơ sở chỉnh trần ở màn
  // Cấu hình vận hành mà đường ghi vẫn xét theo số chung, im lặng không báo gì.
  //
  // ⚠️ Áp cho MỌI đơn, không chia đơn cũ/đơn mới — đo prod 23/09: 0 đơn vượt trần 4 đợt,
  // đúng 1 đơn vượt trần ưu đãi và nó còn PENDING_PAYMENT. Không có đơn cũ nào để bảo vệ.
  const orgUnitIdDon = data.centerId ? await orgUnitIdForCenter(data.centerId) : null;
  const [tranSoDot, tranUuDaiMoiDong] = await Promise.all([
    getSetting("orders.maxInstallments", { orgUnitId: orgUnitIdDon }),
    getSetting("orders.maxDiscountItems", { orgUnitId: orgUnitIdDon }),
  ]);

  // Vượt trần ⇒ TỪ CHỐI, không kẹp im lặng. `gopGiamGia` có kẹp như lưới an toàn cho
  // con SỐ, nhưng người bán vừa hứa với phụ huynh một mức bớt khác — để đơn lưu được
  // với 50% trong khi sale gõ 80% là dựng sẵn một cuộc tranh cãi mà hệ thống có đủ dữ
  // kiện để chặn ngay lúc bấm Lưu.
  const vuotTran = khoanVuotTran(khaiDong, tranPhanTram);
  if (vuotTran.length > 0) {
    return { ok: false as const, error: loiVuotTran(vuotTran, tranPhanTram) };
  }

  const thieuLyDo = dongThieuGiaiTrinh(khaiDong, tranPhanTram);
  if (thieuLyDo.length > 0) {
    return { ok: false as const, error: loiThieuGiaiTrinh(thieuLyDo) };
  }

  const tien = tienDon(khaiDong, { phiVanChuyen: data.shippingFee, tranPhanTram });
  const subtotal = tien.tamTinh;

  // Kế hoạch đợt hôm nay ở cấp ĐƠN (form khai `keHoachDot`), nên danh sách có đúng 1 phần
  // tử. Cọc KHÔNG tính vào số đợt — cùng phép đếm với `ke-hoach-dot-editor.tsx`.
  const soDotHocPhi = (data.keHoachDot ?? []).filter((d) => !d.laCoc).length;

  // ── MỐC HỌC PHẦN [chủ dự án chốt 25/09/2026] ────────────────────────────────
  //
  // *"khi sale tạo đơn, nếu buổi học khác 12 24 36 48 tức 1 học phần, 2 học phần, 3 học
  // phần, 4 học phần thì phải qua quản lý duyệt"*, thu hẹp ngay sau đó: *"ở prod có các
  // khoá sata 3,4,5,6,7 có 48 buổi thì mới áp luật này, còn các khoá khác thì không"*.
  //
  // ⚠️ Xét theo TỪNG DÒNG, không theo cả đơn. Một đơn có thể chở hai con học hai khoá
  // khác nhau — gộp lại là không trả lời được "con nào bán lệch mốc", mà đó đúng là thứ
  // quản lý cần biết để bấm duyệt.
  //
  // ⚠️ `hinhThucDong` đã tính Ở TRÊN (dòng `data.items.map(docHinhThucLop)`), dùng lại —
  // đọc `metadata` lần thứ hai là mở đường cho hai cách đọc cùng một cột.
  const soBuoiTheoDong = hinhThucDong.map((h, i) => {
    const x = xetSoBuoiDong({
      tongSoBuoiKhoa: h.courseId ? (bangSoBuoiKhoa.get(h.courseId) ?? null) : null,
      soBuoiMua: h.soBuoi,
    });
    return { viPham: x.canDuyet, cau: lyDoSoBuoi(x, data.items[i]?.itemName ?? "") };
  });

  const xetDuyet = xetDuyetDon({
    keHoach: soDotHocPhi > 0 ? [{ soDot: soDotHocPhi }] : [],
    uuDaiTheoDong: khaiDong.map((d, i) => ({
      soUuDai: d.giam.length,
      nhan: data.items[i]?.itemName ?? undefined,
    })),
    soBuoiTheoDong,
    nguong: { tranSoDot, tranUuDaiMoiDong },
  });

  /**
   * VÌ SAO đơn này phải chờ duyệt — tính MỘT LẦN, dùng ở hai nơi [25/09/2026].
   *
   * Ba cờ này vừa quyết định cột `*ApprovalStatus` ghi xuống DB, vừa quyết định câu chữ
   * của tin báo gửi cho quản lý (`baoDonChoDuyet`). Tính lại ở nơi thứ hai là mở đúng lớp
   * lỗi "hai nguồn cho một sự thật" mà repo đã trả giá ở nội dung CK.
   *
   * ⚠️ ĐỌC THẲNG TỪ `xetDuyet.phan`, KHÔNG dựng lại điều kiện [đổi 25/09/2026].
   * Bản cũ viết `xetDuyet.canDuyet && soDotHocPhi > tranSoDot` — tức chép lại phép so của
   * `xetDuyetDon` ngay cạnh lời gọi nó. Hôm nay hai bản còn khớp; ngày nào một bên đổi
   * (thêm cọc vào phép đếm, đổi `>` thành `>=`) thì cột trong DB và danh sách lý do trên
   * màn nói hai điều khác nhau, và không ca nào đỏ. `[NGD-07]` khoá việc `phan` có mặt ở
   * cả hai nhánh kết quả.
   */
  const lyDoChoDuyet = xetDuyet.phan;
  const totalAmount = tien.tongDon;
  // `tienDong` đã kẹp giảm ≤ tạm tính TỪNG DÒNG, nên tổng không thể âm trừ khi
  // `shippingFee` âm — mà validator đã chặn `min(0)`. Giữ cổng vì nó rẻ và vì mất nó
  // thì một đổi thay ở `tienDon` sẽ đi thẳng ra đơn âm mà không ai chặn.
  if (totalAmount < 0) {
    return { ok: false as const, error: "Tổng tiền không thể âm" };
  }

  // `Order.discountReason` vẫn được hoá đơn · nhật ký đọc, nên nó phải nói được điều gì
  // đó mà không cần biết về cột JSON. Ghép ở MỘT chỗ dùng chung với form.
  const giaiTrinhGop = giaiTrinhGopChoDon(tien.dong);

  // 30/08/2026 — PaymentMethod ∈ SCOPED_MODELS: câu này nay TỰ LỌC theo tầm nhìn cơ sở
  // của người tạo đơn.
  const pm = await sdb.paymentMethod.findUnique({
    where: { id: data.paymentMethodId },
    select: {
      id: true,
      name: true,
      isActive: true,
      centerId: true,
      canBuyCourse: true,
      canBuyPackage: true,
      canBuyExam: true,
      canBuyProduct: true,
    },
  });
  if (!pm)
    return {
      ok: false as const,
      error: "Phương thức thanh toán không tồn tại",
    };
  if (!pm.isActive)
    return {
      ok: false as const,
      error: "Phương thức thanh toán đã bị vô hiệu hoá",
    };

  // ⚠️ CỔNG SERVER cho luật "cơ sở nào dùng ngân hàng của cơ sở đó".
  // Dropdown ở form đã lọc rồi, nhưng lọc client KHÔNG phải lớp bảo vệ: mỗi Server
  // Action là một endpoint HTTP riêng, gọi thẳng với id phương thức của cơ sở khác vẫn
  // tới được đây. Hệ quả nếu thiếu: đơn của CS2 mang phương thức của CS1 ⇒ mã QR dựng
  // theo `order.centerId` nên vẫn trỏ tài khoản CS2, còn sổ sách ghi phương thức CS1 —
  // hai bên lệch nhau đúng ở chỗ đối soát tiền.
  if (!methodServesCenter(pm, data.centerId || null)) {
    return { ok: false as const, error: METHOD_WRONG_CENTER_ERROR };
  }

  if (!methodAllowsOrderType(pm, data.type)) {
    return {
      ok: false as const,
      error: `Phương thức này không hỗ trợ loại đơn "${data.type}"`,
    };
  }

  // Phase 5.10.1 — PRODUCT order validation (single-item v1).
  // Verify product exists, is ACTIVE, has enough stock. The actual stock
  // decrement happens inside the tx below to keep create + decrement atomic.
  let productSnapshot: {
    productId: string;
    name: string;
    salePrice: number;
    currentStock: number;
    quantityRequested: number;
  } | null = null;

  if (data.type === "PRODUCT") {
    const item = data.items[0];
    if (!item || !item.productId) {
      return {
        ok: false as const,
        error: "Đơn PRODUCT phải chọn sản phẩm",
      };
    }
    const product = await sdb.product.findUnique({
      where: { id: item.productId },
      select: {
        id: true,
        name: true,
        salePrice: true,
        stockOnHand: true,
        status: true,
      },
    });
    if (!product) {
      return { ok: false as const, error: "Sản phẩm không tồn tại" };
    }
    if (product.status !== "ACTIVE") {
      return {
        ok: false as const,
        error: `Sản phẩm "${product.name}" không đang bán (status=${product.status})`,
      };
    }
    if (product.stockOnHand < item.quantity) {
      return {
        ok: false as const,
        error: `Tồn kho không đủ. Hiện có ${product.stockOnHand}, yêu cầu ${item.quantity}`,
      };
    }
    productSnapshot = {
      productId: product.id,
      name: product.name,
      salePrice: product.salePrice,
      currentStock: product.stockOnHand,
      quantityRequested: item.quantity,
    };
  }

  const { actorId, actorName } = getAuditActor(session);

  // FIX-C5 — codegen atomic BÊN TRONG tx (`generateOrderCode(tx)`) + retry khi
  // đụng unique-violation (P2002) như backstop. Cả tx re-run khi retry.
  // A0-04: tx từ scopedDb — cast vì extended client không structurally-assignable
  // vào Prisma.TransactionClient (tiền lệ students/classes). Cấu trúc tx GIỮ NGUYÊN.
  const created = await withUniqueRetry(() =>
    sdb.$transaction(async (txRaw) => {
      const tx = txRaw as unknown as Prisma.TransactionClient;
      const code = await generateOrderCode(tx);
      const order = await tx.order.create({
      data: {
        code,
        type: data.type,
        status: data.status,
        customerName: data.customerName.trim(),
        customerPhone: data.customerPhone.trim(),
        // P5 — validator đã trim + lowercase + đưa ô trống về null.
        customerEmail: data.customerEmail,
        customerCccd: data.customerCccd?.trim() || null,
        customerAddress: data.customerAddress?.trim() || null,
        customerWard: data.customerWard?.trim() || null,
        customerCity: data.customerCity?.trim() || null,
        // Suy từ các dòng — xem `studentIdCuaDon` bên trên. KHÔNG dùng `data.studentId`.
        studentId: studentIdCuaDon,
        leadId: data.leadId || null,
        // N-2 — MỘT ĐƠN quy về MỘT CON. Thiếu cột này thì doanh thu/tỷ lệ chốt/chi phí
        // trên mỗi khách không bổ dọc được theo học sinh, mà tổng vẫn khớp nên báo cáo
        // trông vẫn đúng.
        leadChildId,
        centerId: data.centerId || null,
        // Người tạo đơn — cột danh sách /admin/orders. Lấy từ phiên, KHÔNG nhận từ
        // client: đây là thứ dùng để quy trách nhiệm, để client gửi lên là tự mở đường
        // ghi tên người khác vào đơn của mình.
        createdById: session.user.id ?? null,
        paymentMethodId: data.paymentMethodId,
        subtotal,
        // TỔNG các dòng — không phải một số nhập độc lập. Hai đường nhập cho cùng một
        // con tiền là định nghĩa của sổ lệch.
        discountAmount: tien.tongGiam,
        // Snapshot cách nhập giảm giá + giải trình.
        //
        // ⚠️ 23/09/2026 — HAI CỘT DUYỆT SỐNG LẠI, NHƯNG MANG LUẬT MỚI.
        //
        // Chúng bị thôi ghi ngày 14/09 khi chủ dự án bỏ cơ chế duyệt. Nay duyệt quay lại
        // ở dạng KHÁC HẲN: không phải "mọi đơn có giảm giá đều duyệt" (luật cũ, không
        // ngưỡng) mà là "vượt ngưỡng cấu hình mới phải duyệt". Chủ dự án chốt 22/09 dùng
        // LẠI hai cột này thay vì thêm cột thứ ba — prod đang có 0 dòng nên không có dữ
        // liệu cũ để bảo vệ, và thêm một cột nữa cho cùng một câu hỏi là đúng cái bệnh
        // `recordedById`/`createdById` mà đợt này đã gặp hai lần.
        //
        // ⚠️ Hai cột, hai lý do KHÁC NHAU — đừng gộp thành một. Quản lý cơ sở cần biết
        // mình đang duyệt "chia nhiều đợt" hay "chồng nhiều ưu đãi"; gộp lại thì màn
        // duyệt chỉ nói được "đơn này vượt gì đó".
        // ⚠️ Đọc từ `lyDoChoDuyet` đã tính Ở TRÊN, KHÔNG tính lại tại chỗ [25/09/2026].
        // Tin báo gửi cho quản lý cũng đọc đúng hai cờ này; tính hai lần là mở đường cho
        // "cột trong DB nói một đằng, tin trong chuông nói một nẻo".
        installmentApprovalStatus: lyDoChoDuyet.traGop ? "PENDING_APPROVAL" : null,
        discountApprovalStatus: lyDoChoDuyet.giamGia ? "PENDING_APPROVAL" : null,
        soBuoiApprovalStatus: lyDoChoDuyet.soBuoi ? "PENDING_APPROVAL" : null,
        installmentRequestedById: xetDuyet.canDuyet ? (session.user.id ?? null) : null,
        discountRequestedById: xetDuyet.canDuyet ? (session.user.id ?? null) : null,
        soBuoiRequestedById: xetDuyet.canDuyet ? (session.user.id ?? null) : null,
        // % nay là thuộc tính của DÒNG (mỗi dòng một mức), nên ở cấp đơn nó vô nghĩa.
        discountPercent: null,
        discountReason: giaiTrinhGop,
        shippingFee: data.shippingFee,
        totalAmount,
        customerNote: data.customerNote?.trim() || null,
        internalNote: data.internalNote?.trim() || null,
        items: {
          create: data.items.map((it, i) => ({
            // Id sinh sẵn — xem `itemIds` ở trên (cần cho `VoucherRedemption.orderItemId`).
            id: itemIds[i]!,
            type: it.type,
            itemName: it.itemName,
            itemDescription: it.itemDescription || null,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            // TẠM TÍNH của dòng (trước giảm) — `Order.subtotal` = Σ cột này.
            totalPrice: tien.dong[i]!.tamTinh,
            // Số SERVER tính, không phải số client gửi.
            //
            // `discountAmount` là TỔNG của dòng (cột tiền, `Order.discountAmount` = Σ nó);
            // `discountPercent` chỉ có nghĩa khi dòng có ĐÚNG MỘT khoản kiểu %;
            // `discountReason` là bản ghép để đường đọc cũ không phải biết về JSON;
            // `discounts` là bản chi tiết — nguồn sự thật cho hiển thị.
            discountAmount: tien.dong[i]!.giam,
            discountPercent: tien.dong[i]!.phanTram,
            discountReason:
              tien.dong[i]!.khoan
                .filter((k) => k.giam > 0 && k.lyDo)
                .map((k) => k.lyDo)
                .join(" · ") || null,
            discounts:
              tien.dong[i]!.khoan.length > 0
                ? (tien.dong[i]!.khoan as unknown as Prisma.InputJsonValue)
                : Prisma.JsonNull,
            packageId: it.packageId || null,
            examAttemptId: it.examAttemptId || null,
            productId: it.productId || null,
            // Đã được gác ở `hocVienHopLe` bên trên — chỉ id đã tra qua `scopedDb` mới
            // lọt tới đây. Id lạ/ngoài cơ sở đã bị từ chối cả đơn, không âm thầm hoá null.
            studentId: it.studentId || null,
            // CON LEAD đi vào `metadata.leadChildId` (đã gác bằng `conLeadTrenDong` bên
            // trên). Vì sao metadata chứ không một cột riêng: `LeadChild` KHÔNG có cột
            // `studentId`, và cầu nối THẬT giữa hai thế giới là `Enrollment.leadChildId`
            // do `convert-lead-v2` ghi lúc chốt — nên giá trị này chỉ cần sống tới lúc
            // convert rồi ráp lại. Thêm một cột + migration trên bảng có dữ liệu prod cho
            // một giá trị tạm là không xứng, và `metadata` vốn đã giữ `courseId` cùng họ.
            metadata:
              (veMetadataConLead(
                (it.metadata as Record<string, unknown> | null) ?? null,
                it.leadChildId || null,
              ) as Prisma.InputJsonValue | null) ?? Prisma.JsonNull,
          })),
        },
      },
      select: { id: true, code: true },
    });

    // 03/08 — đơn nào cũng phải có phiếu thu để xuất được QR. Đơn mới = chưa trả
    // góp ⇒ đúng MỘT phiếu "thu toàn đơn" (installmentNo=0, amountDue=totalAmount).
    // Phiếu theo đợt chỉ ra đời khi QLCS duyệt kế hoạch (lib/payments/payment-request.ts).
    // Cùng transaction với order.create: có đơn là có phiếu, không có nửa vời.
    await ensureFullOrderRequest(tx, {
      id: order.id,
      code: order.code,
      totalAmount,
      centerId: data.centerId || null,
    });

    // ── LƯỢT DÙNG MÃ KHUYẾN MÃI — CÙNG TRANSACTION VỚI ĐƠN [28/09/2026] ─────────
    //
    // `docs/khuyen-mai/README.md` §4 chốt: ghi `VoucherRedemption` + tăng `usedCount`
    // **cùng transaction** tạo đơn, có điều kiện chống đua. Ngoài transaction là mở ra ca
    // "đơn có giảm giá mà không có dấu vết đã dùng mã" — rồi `usedCount` không bao giờ
    // đúng, và trần số lượng của chương trình thành số trang trí.
    //
    // Số tiền ghi là `k.giam` — SỐ THẬT đã trừ được sau khi kẹp theo phần còn lại của
    // dòng, KHÔNG phải số chương trình hứa. Ảnh chụp phải khớp với tiền đã vào sổ.
    for (const [i, d] of tien.dong.entries()) {
      for (const k of d.khoan) {
        if (!k.voucherId || k.giam <= 0) continue;
        await tx.voucherRedemption.create({
          data: {
            voucherId: k.voucherId,
            orderId: order.id,
            orderItemId: itemIds[i]!,
            customerPhone: data.customerPhone.trim(),
            discountApplied: k.giam,
          },
        });

        // 🔴 CHỐNG ĐUA BẰNG ĐIỀU KIỆN TRONG `where`, KHÔNG bằng "đọc rồi so rồi ghi".
        //
        // Hai sale bán suất cuối cùng cùng lúc: cả hai đọc `usedCount = 9 < 10`, cả hai
        // ghi, chương trình phát 11 suất. `updateMany` có điều kiện đẩy phép so xuống
        // Postgres, nên đúng MỘT lượt thắng.
        //
        // `quantity == null` = không giới hạn ⇒ tăng thẳng, không cần điều kiện.
        const v = await tx.voucher.findUnique({
          where: { id: k.voucherId },
          select: { quantity: true, code: true },
        });
        if (v?.quantity == null) {
          await tx.voucher.update({
            where: { id: k.voucherId },
            data: { usedCount: { increment: 1 } },
          });
        } else {
          const thang = await tx.voucher.updateMany({
            where: { id: k.voucherId, usedCount: { lt: v.quantity } },
            data: { usedCount: { increment: 1 } },
          });
          // ⚠️ THUA ĐUA ⇒ `throw`, KHÔNG `return`. Trong callback `$transaction` của repo
          // này, `return` KHÔNG rollback — và ở đây đã ghi đơn + phiếu thu + lượt dùng
          // rồi, nên `return` là để lại một đơn hưởng ưu đãi đã hết suất. Luật rollback
          // ở CLAUDE.md nói đúng ca này: "buộc phải từ chối sau khi đã ghi thì `throw`".
          if (thang.count === 0) {
            throw new Error(
              `Mã ${v.code} vừa hết suất (${v.quantity}/${v.quantity}) — chọn chương trình khác rồi lưu lại.`,
            );
          }
        }
      }
    }

    // Phase 5.10.1 — Stock decrement + SALE movement for PRODUCT orders.
    // Inside same tx so order + stock move atomically. Defensive guard:
    // if a concurrent order race makes stock < 0, throw to rollback.
    if (productSnapshot) {
      const updated = await tx.product.update({
        where: { id: productSnapshot.productId },
        data: {
          stockOnHand: { decrement: productSnapshot.quantityRequested },
        },
        select: { stockOnHand: true },
      });

      if (updated.stockOnHand < 0) {
        throw new Error("PRODUCT_STOCK_INSUFFICIENT_RACE");
      }

      await tx.productMovement.create({
        data: {
          productId: productSnapshot.productId,
          type: "SALE",
          quantity: -productSnapshot.quantityRequested,
          reason: `Bán theo đơn ${order.code}`,
          orderId: order.id,
          stockBeforeMovement: productSnapshot.currentStock,
          stockAfterMovement: updated.stockOnHand,
          createdByUserId: actorId,
          createdByName: actorName,
        },
      });
    }

    // ⚠️ TRONG CÙNG TRANSACTION — "có đơn là có log", không nửa vời. Trước bản này
    // đường tạo đơn KHÔNG ghi một dòng AuditLog nào (đo trên DB: chỉ có
    // DISCOUNT_APPROVED), nên hạ giá là tuyệt đối vô dấu.
    //
    // Ghi CẢ đơn khớp giá lẫn đơn lệch giá: chỉ ghi đơn lệch thì "không có log"
    // trở thành hai nghĩa khác nhau (chưa từng ghi / đã soát và không lệch), và
    // người soát sau không phân biệt được.
    await writeAudit({
      actor: { id: actorId, name: actorName },
      module: "orders",
      entityType: "Order",
      entityId: order.id,
      action: "CREATE",
      newValues: {
        orderCode: order.code,
        subtotal,
        discountAmount: tien.tongGiam,
        discountReason: giaiTrinhGop,
        totalAmount,
        // Giảm giá theo TỪNG DÒNG (15/09/2026). Ghi cả bản chi tiết chứ không chỉ tổng:
        // tổng không nói được bớt cho ĐỨA NÀO, mà đó đúng là câu hỏi sẽ được hỏi lúc
        // hoàn tiền hoặc lúc phụ huynh thắc mắc.
        giamTungDong: tien.dong.map((d, i) => ({
          dong: i + 1,
          hocVienId: data.items[i]?.studentId ?? null,
          tamTinh: d.tamTinh,
          giam: d.giam,
          thanhTien: d.thanhTien,
          // TỪNG KHOẢN, không chỉ tổng: tổng không nói được bớt theo chương trình nào.
          khoan: d.khoan.map((k) => ({
            kieu: k.kieu,
            giaTri: k.giaTri,
            giam: k.giam,
            lyDo: k.lyDo,
          })),
        })),
        // Dấu vết giá — đủ để soát lại mà không phải mở lại payload.
        giaLech: soatGia.coLech,
        giaTongLechThap: soatGia.tongLechThap,
        giaDongLech: soatGia.dongLech,
        // Khớp `PII_KEY_RE` của viewer ⇒ tự che với người không có quyền xem PII.
        customerPhone: data.customerPhone.trim(),
        shippingFee: data.shippingFee,
        paymentMethodId: data.paymentMethodId,
        leadId: data.leadId || null,
        leadChildId,
        // Cột `Order.studentId` lưu giá trị SUY RA (`studentIdChoDon`), không phải số
        // client gửi — nên vết phải ghi CẢ HAI, khác tên. Một trường `studentId` mơ hồ
        // ở đây là thứ không xử được tranh chấp: không ai biết nó là số nào.
        studentId: studentIdCuaDon,
        studentIdKhai: data.studentId || null,
        itemCount: data.items.length,
        // Hình thức lớp đã KHAI trên từng dòng. Ghi ở đây để đơn bán Coach có lời giải
        // thích đi kèm ngay cạnh `giaLech` — bán 1-1 ×2,0 là HỢP LỆ theo công văn nhưng
        // vẫn rơi vào CAO_HON, và người soát sau cần biết vì sao mà không phải mở payload.
        hinhThucLop: hinhThucDong.map((h) => h.coachFormat),
        soBuoiKhai: hinhThucDong.map((h) => h.soBuoi),
      },
      orgUnitId: data.centerId || null,
      // S-6a — ĐƯỜNG NỐI MÁY GỌI. Đơn là chứng từ tiền; khi có tranh chấp "ai bấm tạo
      // đơn này", tên người ghi chưa đủ (tài khoản dùng chung, phiên bị mượn). Bản trên
      // `main` bỏ hai trường này; cấy lại khi hợp nhất 16/09/2026 — `writeAudit` vốn đã
      // nhận sẵn, chỉ là không ai truyền.
      ip: auditMeta.ip ?? null,
      userAgent: auditMeta.userAgent ?? null,
      tx,
    });

      return order;
    }),
  );

  // ── KẾ HOẠCH THANH TOÁN LẬP NGAY LÚC TẠO ĐƠN [15/09/2026] ───────────────────
  //
  // Chủ dự án: *"đưa phần kế hoạch thanh toán ra trang tạo đơn hàng luôn đi"*. Từ đây
  // người bán chia đợt NGAY trên form tạo đơn, và mở trang chi tiết là đã có sẵn phiếu
  // thu + QR cho từng đợt.
  //
  // ⚠️ NGOÀI transaction tạo đơn, CÓ CHỦ ĐÍCH. `recordInstallmentPlan` mở `db.$transaction`
  // của riêng nó (`lib/orders/installments.ts`) và đọc lại đơn qua `db` — lồng nó vào tx ở
  // trên là đọc một bản ghi CHƯA COMMIT bằng một kết nối khác, tức luôn "Không tìm thấy
  // đơn". Nhét nó vào trong sẽ đòi mổ cả hàm đó, mà hàm đó là đường ghi tiền của 3 chỗ gọi
  // khác; đợt này không mở việc ấy ra.
  //
  // ⚠️ THẤT BẠI Ở ĐÂY KHÔNG ĐƯỢC LÀM HỎNG CÂU TRẢ LỜI "đã tạo đơn". Đơn ĐÃ nằm trong DB;
  // trả `ok: false` là để người bán tin là chưa tạo được rồi bấm lại — và có hai đơn thật
  // cho một khách. Trả kèm CẢNH BÁO để form nói đúng: đơn xong, kế hoạch thì mở trang chi
  // tiết mà đặt lại (khối kế hoạch ở đó vẫn làm được đúng việc ấy).
  //
  // `try/catch` vì `materializeInstallmentRequests` NÉM (`InstallmentMoneyBlocked`) chứ
  // không trả lỗi. Đơn vừa sinh ra thì không thể có phân bổ nào nên cổng A6 không thể nổ ở
  // đây — nhưng một ngoại lệ lọt ra là mất luôn mã đơn vừa tạo khỏi câu trả lời, nên bọc.
  // ── BÁO NGAY CHO NGƯỜI DUYỆT [25/09/2026] ──────────────────────────────────
  //
  // Chủ dự án: *"khi có đơn cần được duyệt thì phải gửi thông báo về ngay cho quản lý để
  // duyệt gấp cho KH được thanh toán"*.
  //
  // ⚠️ NGOÀI transaction, và KHÔNG BAO GIỜ được làm hỏng câu trả lời "đã tạo đơn" — cùng
  // lý lẽ với khối kế hoạch thanh toán ngay dưới. `baoDonChoDuyet` tự nuốt mọi lỗi (có
  // ghi log); ở đây không cần `try` thứ hai, và cũng KHÔNG `await` chặn gì thêm: đơn đã
  // nằm trong DB, tin báo chậm một nhịp không đổi gì, còn một ngoại lệ lọt ra thì người
  // bán bấm tạo đơn lần thứ hai.
  await baoDonChoDuyet({
    orderId: created.id,
    code: created.code,
    centerId: data.centerId || null,
    tenKhach: data.customerName,
    tongTien: totalAmount,
    lyDo: lyDoChoDuyet,
    // Không tự báo cho chính mình: người vừa lập đơn đã biết nó chờ duyệt.
    boQuaUserId: session.user.id ?? null,
  });

  let canhBaoKeHoach: string | null = null;
  const keHoach = data.keHoachDot ?? [];
  if (keHoach.length > 0) {
    try {
      const resKh = await recordInstallmentPlan({
        orderId: created.id,
        // Quy đổi ở BIÊN bằng hàm dùng chung với `recordOrderInstallmentsAction` — hai
        // bản quy đổi ngày/cờ đã-thu là hai cách ghi lệch sổ.
        dots: dotsGhiTuForm(keHoach),
        actorId: session.user.id ?? null,
      });
      if (!resKh.ok) canhBaoKeHoach = resKh.error ?? "Không lưu được kế hoạch thanh toán";
    } catch (err) {
      console.error("[orders] luu ke hoach luc tao don that bai:", err);
      canhBaoKeHoach =
        err instanceof Error ? err.message : "Không lưu được kế hoạch thanh toán";
    }
    revalidatePath(`/orders/${created.id}`);
  }

  // Dòng lịch sử trên hồ sơ lead — chỉ khi đơn có gắn lead (đơn bán lẻ tạo tay thì
  // `leadId` là null và không có hồ sơ nào để kể).
  //
  // ⚠️ ĐẶT SAU TRANSACTION và dùng cửa BỎ QUA LỖI: đây là đường CHẠM TIỀN. Nhét lời gọi
  // này vào trong `$transaction` ở trên là để một lỗi ghi LỊCH SỬ cuộn lại cả cái ĐƠN,
  // cả phiếu thu, cả trừ kho — luật rollback của repo: `throw` trong callback là cuộn
  // toàn bộ. Lịch sử không bao giờ được quyền giết nghiệp vụ tiền.
  if (data.leadId) {
    await ghiTuongTacLeadBoQuaLoi({
      leadId: data.leadId,
      actorId,
      actorName,
      moc: new Date(),
      sk: { viec: "don.tao", maDon: created.code, tongTien: totalAmount },
    });
  }

  revalidatePath("/orders");
  if (productSnapshot) {
    revalidatePath("/products");
    revalidatePath(`/products/${productSnapshot.productId}`);
  }

  sendEmailForTrigger({
    trigger: "ORDER_CONFIRMATION",
    recipient: {
      email: data.customerEmail,
      name: data.customerName,
    },
    vars: {
      customer_name: data.customerName,
      order_code: created.code,
      total_amount: totalAmount,
      payment_method: pm.name ?? "—",
      order_date: new Date(),
      items_list: renderItemsListHtml(data.items),
    },
    context: { type: "Order", id: created.id },
    triggerType: "SYSTEM",
    actor: { userId: actorId, name: actorName },
  }).catch((err) => {
    console.error("[email] ORDER_CONFIRMATION trigger error:", err);
  });

  // P5 — khách không có email thì email trigger ở trên tự bỏ qua; ZNS lo phần đó.
  void notifyOrderByZnsIfNoEmail(created.id);

  return {
    ok: true as const,
    id: created.id,
    code: created.code,
    // Đơn ĐÃ tạo nhưng kế hoạch thì chưa — form phải nói ra, không được im.
    canhBaoKeHoach,
    /**
     * VÌ SAO đơn này phải chờ duyệt — trả về cho form NÓI VỚI SALE [25/09/2026].
     *
     * ⚠️ Trước hôm nay `xetDuyet.lyDo` được TÍNH RỒI VỨT: `loiChuaDuyet` có **0 chỗ gọi**
     * trong mã chạy thật. Hệ quả là sale bấm Lưu, thấy "Đã tạo đơn", rồi mãi tới lúc bấm
     * "Xuất QR" mới biết đơn đang bị chặn — và câu chặn ở đó chỉ nói chung chung. Cổng nào
     * không nói ra lý do là cổng người ta học cách bấm qua (cùng bài học ở cổng tạo đợt).
     *
     * Rỗng = đơn không phải chờ duyệt.
     */
    lyDoChoDuyet: xetDuyet.canDuyet ? xetDuyet.lyDo : [],
  };
}

function renderItemsListHtml(
  items: Array<{ itemName: string; quantity: number; unitPrice: number }>,
): string {
  const rows = items
    .map((it) => {
      const lineTotal = it.unitPrice * it.quantity;
      return `<li>${escapeHtml(it.itemName)} × ${it.quantity} = ${lineTotal.toLocaleString("vi-VN")} đ</li>`;
    })
    .join("");
  return `<ul>${rows}</ul>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ─── CHANGE STATUS ──────────────────────────────────────────────────
export async function changeOrderStatusAction(
  orderId: string,
  input: unknown,
  // FIX-H9 — optimistic lock: Order.updatedAt (ISO) client đã thấy. Lệch → STALE_WRITE.
  expectedUpdatedAt?: string,
) {
  const session = await requireOrdersManage();
  const parsed = orderStatusChangeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: "Dữ liệu không hợp lệ" };
  }

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  // findUnique qua scopedDb đã chống IDOR (ngoài scope → null); giữ passesScope làm belt-and-suspenders.
  const order = await sdb.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      // Mã đơn cho dòng lịch sử trên hồ sơ lead — người đọc cần biết ĐƠN NÀO đổi trạng
      // thái, `id` (cuid) thì không nói gì với họ.
      code: true,
      status: true,
      centerId: true,
      leadId: true,
      totalAmount: true,
      discountApprovalStatus: true,
    },
  });
  if (!order || !passesScope("Order", order, actor)) {
    return { ok: false as const, error: "Không tìm thấy đơn hàng" };
  }

  // ⚠️ ĐÃ GỠ [14/09/2026] — cổng "giảm giá chưa duyệt thì chưa xác nhận đơn" (BGĐ 31/07).
  // Gỡ CÙNG LÚC với cổng máy chốt ở `lib/payments/payos-ingest.ts`: lệch nhịp thì webhook
  // chốt được mà người không chốt được (hoặc ngược lại), và không ai đọc ra vì sao.
  // Thay cho nó là dấu vết `lib/orders/price-guard.ts` + AuditLog ORDER_CREATED.

  if (order.status === parsed.data.toStatus) {
    return {
      ok: false as const,
      error: "Trạng thái mới giống trạng thái hiện tại",
    };
  }

  if (!canTransition(order.status, parsed.data.toStatus)) {
    return {
      ok: false as const,
      error: `Không thể chuyển từ "${order.status}" sang "${parsed.data.toStatus}"`,
    };
  }

  const { actorId, actorName } = getAuditActor(session);
  const metadata = await getRequestMetadata();
  const expectedAt = expectedUpdatedAt ? new Date(expectedUpdatedAt) : null;

  // A0-04: tx từ scopedDb — cast (tiền lệ). Cấu trúc transaction tiền GIỮ NGUYÊN
  // (updateMany optimistic-lock + history + ensureOrderPaymentRecorded atomic).
  const txResult = await sdb.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Prisma.TransactionClient;
    // Rà vòng 5 (30/09/2026) — câu ĐẦU TIÊN, trước mọi phép ghi. Huỷ đơn VOID đợt + soát phiếu gộp;
    // không giữ khoá đơn thì lượt thu đang giữ khoá (`thuTheoPhieuGop` đã qua cổng đợt VOID bằng ảnh
    // chụp) rót tiền vào đợt vừa VOID và ghi `Payment` trên đơn đã huỷ. Mọi điểm lấy khoá đơn khác
    // cũng lấy ở câu đầu ⇒ không vòng chờ. Ca `[V5-01]`, lưới `[KDK-W4]`.
    await khoaDonTrongTx(tx, orderId);
    const updateData: Prisma.OrderUpdateInput = {
      status: parsed.data.toStatus,
    };

    if (
      parsed.data.toStatus === "CONFIRMED" &&
      order.status === "PENDING_PAYMENT"
    ) {
      updateData.confirmedByUserId = actorId;
      updateData.confirmedAt = new Date();
      updateData.paidAt = new Date();
    }

    // FIX-H9 — ghi có điều kiện updatedAt; 0 row ⇒ người khác vừa sửa → STALE_WRITE.
    const upd = await tx.order.updateMany({
      where: { id: orderId, ...(expectedAt ? { updatedAt: expectedAt } : {}) },
      data: updateData as Prisma.OrderUpdateManyMutationInput,
    });
    if (upd.count === 0) return { stale: true as const, phieuGopDaSoat: [] as PhieuDaSoat[] };

    await tx.orderStatusHistory.create({
      data: {
        orderId,
        fromStatus: order.status,
        toStatus: parsed.data.toStatus,
        changedByUserId: actorId,
        changedByName: actorName,
        reason: parsed.data.reason?.trim() || null,
        metadata: metadata as unknown as Prisma.InputJsonValue,
      },
    });

    // ── PHIÊN A (16/09/2026) · HUỶ ĐƠN PHẢI VOID PHIẾU THU ────────────────────
    //
    // Trước bản này, huỷ đơn chỉ đổi `Order.status` — **phiếu thu ở nguyên `PENDING`**. Cộng
    // với việc tầng đối khớp không kiểm trạng thái đơn (đã vá cùng phiên ở
    // `payos-ingest.ts`), hai lỗ ghép lại thành: đơn huỷ → phiếu vẫn sống → phụ huynh quét lại
    // ảnh QR cũ trong điện thoại → `matchKey` bền theo đời phiếu nên khớp ngay → tiền vào một
    // đơn không còn tồn tại. Không ai thấy, vì màn đơn đã huỷ thì chẳng ai mở.
    //
    // ⚠️ VOID mọi phiếu CHƯA PAID, kể cả `PARTIAL` (đã có một phần tiền). VOID **không xoá**
    // đồng nào: `PaymentAllocation` còn nguyên, tiền vẫn truy được. Nó chỉ thôi làm ĐÍCH RÓT.
    // Bỏ `PARTIAL` ra khỏi danh sách là để lại đúng cái phiếu nguy hiểm nhất — phiếu mà khách
    // đã từng quét thành công một lần.
    //
    // ⚠️ Phiếu `PAID` KHÔNG đụng: nó là bằng chứng một lần thu đã hoàn tất. Huỷ đơn không xoá
    // lịch sử tiền; phần xử lý tiền của đơn huỷ là việc của kế toán (hoàn), không phải của một
    // lệnh đổi trạng thái.
    //
    // Rà vòng 5: phần tiền dời sang `voidTienKhiHuyDonTrongTx` — kèm SOÁT phiếu gộp trên các đợt vừa
    // VOID (trước đó phiếu ở lại OPEN và trang đơn đã huỷ vẫn in QR của cả nhà).
    let phieuGopDaSoat: PhieuDaSoat[] = [];
    if (parsed.data.toStatus === "CANCELLED") {
      phieuGopDaSoat = await voidTienKhiHuyDonTrongTx(tx, orderId);
    }

    // T06 (HB-18 / HB-21) — đơn bị LOẠI (huỷ/hoàn) phải được học bù biết: phí học bù mất thì bé chưa điểm danh bị gỡ khỏi case, đơn
    // khoá học mất thì lượt bù tính lại. Chỉ GHI SỰ KIỆN ở đây (cùng transaction ⇒ huỷ rollback thì không có sự kiện); việc xét lại chạy
    // sau ở `lib/hoc-bu/don-doi-db.ts` — một lỗi ở sổ lượt không được làm đơn không huỷ được.
    if (parsed.data.toStatus === "CANCELLED" || parsed.data.toStatus === "REFUNDED") {
      await publishEvent(
        "order.voided",
        { orderId, tuTrangThai: order.status, denTrangThai: parsed.data.toStatus },
        { tx, dedupeKey: `order.voided:${orderId}:${parsed.data.toStatus}` },
      );
    }

    // S1 — xác nhận đơn (thu offline): nếu CHƯA có khoản RECORDED nào (đơn không đi qua
    // installments) → ghi 1 Payment(RECORDED) cho phần đã thu (idempotent theo marker
    // [auto:order-confirm]). Tránh double-count khi installments đã ghi sổ.
    if (parsed.data.toStatus === "CONFIRMED" && order.status === "PENDING_PAYMENT") {
      const recorded = await tx.payment.aggregate({
        where: { orderId, ...KHOAN_DA_GHI_NHAN },
        _count: { _all: true },
      });
      if (recorded._count._all === 0) {
        await ensureOrderPaymentRecorded(tx, {
          orderId,
          amount: order.totalAmount,
          leadId: order.leadId,
          centerId: order.centerId,
          actor: { id: actorId, name: actorName },
        });
      }
    }
    return { stale: false as const, phieuGopDaSoat };
  });

  if (txResult.stale) return { ok: false as const, error: "STALE_WRITE" };

  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  // S6 — đồng bộ trang lead/convert (đổi trạng thái đơn ảnh hưởng "đủ điều kiện chốt").
  if (order.leadId) {
    // Dòng lịch sử — SAU transaction, cửa BỎ QUA LỖI (đường chạm tiền: transaction trên
    // vừa ghi `Payment`, VOID phiếu thu, hết hạn mã QR).
    await ghiTuongTacLeadBoQuaLoi({
      leadId: order.leadId,
      actorId,
      actorName,
      moc: new Date(),
      sk: {
        viec: "don.doi-trang-thai",
        maDon: order.code,
        tu: order.status,
        den: parsed.data.toStatus,
      },
    });
    revalidatePath(`/leads/${order.leadId}`);
    revalidatePath(`/leads/${order.leadId}/convert`);
  }

  // BGĐ 31/07 — xác nhận thanh toán → tự cấp tài khoản phụ huynh theo SĐT + báo ZNS.
  // Fire-and-forget, idempotent (đã có tài khoản → không tạo/gửi lại).
  if (parsed.data.toStatus === "CONFIRMED") {
    ensureParentAccountForOrder(orderId).catch((err) =>
      console.error("[order-confirm] provision parent:", err),
    );
  }

  // Fire PAYMENT_RECEIPT when order transitions to CONFIRMED (paidAt set).
  if (parsed.data.toStatus === "CONFIRMED") {
    const orderForEmail = await sdb.order.findUnique({
      where: { id: orderId },
      include: { paymentMethod: { select: { name: true } } },
    });
    if (orderForEmail) {
      sendEmailForTrigger({
        trigger: "PAYMENT_RECEIPT",
        recipient: {
          email: orderForEmail.customerEmail,
          name: orderForEmail.customerName,
        },
        vars: {
          customer_name: orderForEmail.customerName,
          order_code: orderForEmail.code,
          total_amount: orderForEmail.totalAmount,
          payment_method: orderForEmail.paymentMethod?.name ?? "—",
          paid_at: orderForEmail.paidAt ?? new Date(),
        },
        context: { type: "Order", id: orderForEmail.id },
        triggerType: "SYSTEM",
        actor: { userId: actorId, name: actorName },
      }).catch((err) => {
        console.error("[email] PAYMENT_RECEIPT trigger error:", err);
      });

      // P5 — biên nhận qua ZNS cho khách không có email (xem lib/notify/order.ts).
      void notifyOrderByZnsIfNoEmail(orderForEmail.id);
    }
  }

  // Luật 12 — phiếu gộp của cả nhà vừa bị huỷ/đóng phải được NÓI RA (không thì sale không báo phụ
  // huynh bỏ QR cũ, tiền về hàng chờ rồi phải hoàn).
  return { ok: true as const, thongDiepPhieu: thongDiepPhieuKhiHuyDon(txResult.phieuGopDaSoat) };
}

// ─── UPDATE NOTES (admin internal note) ─────────────────────────────
export async function updateOrderNoteAction(
  orderId: string,
  internalNote: string,
  // FIX-H9 — optimistic lock: Order.updatedAt (ISO) client đã thấy. Lệch → STALE_WRITE.
  expectedUpdatedAt?: string,
) {
  const session = await requireOrdersManage();

  if (internalNote.length > 2000) {
    return { ok: false as const, error: "Ghi chú quá dài (max 2000 ký tự)" };
  }

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const order = await sdb.order.findUnique({
    where: { id: orderId },
    // `leadId` + `code` cho dòng lịch sử trên hồ sơ lead.
    select: { id: true, centerId: true, leadId: true, code: true },
  });
  if (!order || !passesScope("Order", order, actor)) {
    return { ok: false as const, error: "Không tìm thấy đơn hàng" };
  }

  const expectedAt = expectedUpdatedAt ? new Date(expectedUpdatedAt) : null;
  // FIX-H9 — ghi có điều kiện updatedAt; 0 row ⇒ người khác vừa sửa → STALE_WRITE.
  const upd = await sdb.order.updateMany({
    where: { id: orderId, ...(expectedAt ? { updatedAt: expectedAt } : {}) },
    data: { internalNote: internalNote.trim() || null },
  });
  if (upd.count === 0) return { ok: false as const, error: "STALE_WRITE" };

  if (order.leadId) {
    await ghiTuongTacLeadBoQuaLoi({
      leadId: order.leadId,
      ...getAuditActor(session),
      moc: new Date(),
      sk: { viec: "don.sua-ghi-chu", maDon: order.code },
    });
  }

  revalidatePath(`/orders/${orderId}`);
  return { ok: true as const };
}

// ─── UPDATE PAYMENT METHOD (G4 — chỉ khi đơn CHƯA xác nhận thanh toán) ─
export async function updateOrderPaymentMethodAction(
  orderId: string,
  paymentMethodId: string,
  // FIX-H9 — optimistic lock: Order.updatedAt (ISO) client đã thấy. Lệch → STALE_WRITE.
  expectedUpdatedAt?: string,
) {
  const session = await requireOrdersManage();

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const order = await sdb.order.findUnique({
    where: { id: orderId },
    select: { id: true, centerId: true, status: true, type: true },
  });
  if (!order || !passesScope("Order", order, actor)) {
    return { ok: false as const, error: "Không tìm thấy đơn hàng" };
  }
  // G4 (chốt): chỉ cho sửa phương thức khi đơn còn DRAFT/PENDING_PAYMENT (chưa chốt tiền).
  if (order.status !== "DRAFT" && order.status !== "PENDING_PAYMENT") {
    return {
      ok: false as const,
      error: "Chỉ sửa phương thức khi đơn chưa xác nhận thanh toán",
    };
  }

  const pm = await sdb.paymentMethod.findUnique({
    where: { id: paymentMethodId },
    select: {
      id: true,
      isActive: true,
      centerId: true,
      canBuyCourse: true,
      canBuyPackage: true,
      canBuyExam: true,
      canBuyProduct: true,
    },
  });
  if (!pm) {
    return { ok: false as const, error: "Phương thức thanh toán không tồn tại" };
  }
  if (!pm.isActive) {
    return { ok: false as const, error: "Phương thức thanh toán đã bị vô hiệu hoá" };
  }
  // ĐƯỜNG GHI THỨ HAI của cùng một luật. Thiếu vế này thì cách né rất rẻ: tạo đơn đúng
  // phương thức rồi bấm "đổi phương thức" sang phương thức của cơ sở khác.
  // `order.centerId` đã có sẵn trong câu đọc ngay trên, không tốn thêm truy vấn nào.
  if (!methodServesCenter(pm, order.centerId)) {
    return { ok: false as const, error: METHOD_WRONG_CENTER_ERROR };
  }
  if (!methodAllowsOrderType(pm, order.type)) {
    return {
      ok: false as const,
      error: `Phương thức này không hỗ trợ loại đơn "${order.type}"`,
    };
  }

  const expectedAt = expectedUpdatedAt ? new Date(expectedUpdatedAt) : null;
  const upd = await sdb.order.updateMany({
    where: { id: orderId, ...(expectedAt ? { updatedAt: expectedAt } : {}) },
    data: { paymentMethodId },
  });
  if (upd.count === 0) return { ok: false as const, error: "STALE_WRITE" };

  revalidatePath(`/orders/${orderId}`);
  return { ok: true as const };
}

// ─── HELPER: load form data cho create page ─────────────────────────
export async function loadCreateOrderFormData() {
  // G-A — dữ liệu nạp form tạo đơn: cổng theo `orders:create` (không phải
  // `orders:manage`), nếu không Sale mở trang sẽ bị đá về dashboard.
  const { session } = await requireOrdersCreate();
  // PaymentMethod/Course/Product là catalog, Center exempt — scopedDb pass-through.
  const sdb = scopedDb(await resolveActor(session.user.id));

  const [paymentMethods, courses, products, centers, students] = await Promise.all([
    // Nạp CẢ phương thức của mọi cơ sở trong tầm nhìn (scopedDb đã lọc) + phương thức
    // dùng chung, rồi để client lọc lại theo cơ sở ĐANG CHỌN trên form. Cố ý không nạp
    // lại qua server action mỗi lần đổi cơ sở: hàm này chạy MỘT LẦN ở RSC trước khi
    // người dùng chọn gì, và thứ lọt xuống client chỉ là tên + cờ của phương thức —
    // không có số tài khoản nào (tài khoản nằm ở kho VietQR, không ở bảng này).
    sdb.paymentMethod.findMany({
      where: { isActive: true },
      orderBy: { displayOrder: "asc" },
      select: {
        id: true,
        code: true,
        name: true,
        type: true,
        centerId: true,
        canBuyCourse: true,
        canBuyPackage: true,
        canBuyExam: true,
        canBuyProduct: true,
      },
    }),
    sdb.course.findMany({
      // O1/O3: chỉ khoá DẠY thật (Sata 1–8 + combo teachable), loại 2 "danh mục"
      // Lập trình Robot / Luyện thi RoboSim (isTeachable=false). Combo 1&2 là course
      // teachable nên tự nằm trong danh sách "Khoá học".
      // O4: KHÔNG lọc isPublished — khoá Sata teachable bị seed để isPublished=false
      // (publish chỉ dùng cho trang marketing công khai). Đơn hàng gate theo isTeachable.
      where: { isActive: true, isTeachable: true },
      orderBy: { displayOrder: "asc" },
      // `totalSessions` + `slug`: hai thứ màn tạo đơn cần để GỢI Ý giá theo hình thức
      // lớp (SR.QD.219 Điều 5) — giá/buổi = price ÷ totalSessions, và `slug` để nhận ra
      // khoá công văn LOẠI khỏi Coach. Cả hai chỉ phục vụ gợi ý; cổng soát giá vẫn so
      // với `Course.price` như cũ.
      select: {
        id: true,
        code: true,
        name: true,
        price: true,
        type: true,
        slug: true,
        totalSessions: true,
      },
    }),
    sdb.product.findMany({
      // O3: đơn "Sản phẩm" chỉ gồm KIT_ROBOT + SENSOR.
      where: { status: "ACTIVE", category: { in: ["KIT_ROBOT", "SENSOR"] } },
      orderBy: { name: "asc" },
      take: 200,
      select: {
        id: true,
        sku: true,
        name: true,
        salePrice: true,
        stockOnHand: true,
        category: true,
      },
    }),
    sdb.center.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    // ── HỌC VIÊN cho ô "của con nào" trên từng dòng hàng (15/09/2026) ──────────
    //
    // Chủ dự án: "phụ huynh có 2 con và học 2 khoá khác nhau thì phải tạo 2 đơn à?"
    // Một đơn nhiều dòng thì mỗi dòng phải nói được nó mua cho ai
    // (`OrderItem.studentId`).
    //
    // `Student` là SCOPED_MODEL ⇒ `scopedDb` đã tự lọc theo cơ sở của actor; cổng ghi
    // `createOrderManualAction` vẫn tra lại độc lập (scopedDb KHÔNG che write).
    //
    // `parentPhone` đi kèm vì đó là thứ người nhập đối chiếu: một trung tâm có nhiều em
    // trùng tên, và người bán đang cầm SĐT của phụ huynh trước mặt. Chỉ SĐT phụ huynh,
    // KHÔNG kèm gì thêm — danh sách này rơi xuống client.
    sdb.student.findMany({
      where: { deletedAt: null, status: { not: "INACTIVE" } },
      orderBy: { name: "asc" },
      take: 1000,
      select: { id: true, name: true, parentName: true, parentPhone: true },
    }),
  ]);

  return { paymentMethods, courses, products, centers, students };
}

// ─── MANUAL SEND EMAIL từ template (Phase 5.13.1) ───────────────────
export async function sendManualOrderEmailAction(input: {
  orderId: string;
  templateId: string;
  toEmail: string;
  toName?: string | null;
}) {
  const session = await requireOrdersManage();

  if (!input.toEmail?.trim()) {
    return { ok: false as const, error: "Vui lòng nhập email người nhận" };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.toEmail)) {
    return { ok: false as const, error: "Email không hợp lệ" };
  }

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const [template, order] = await Promise.all([
    sdb.emailTemplate.findUnique({ where: { id: input.templateId } }),
    sdb.order.findUnique({
      where: { id: input.orderId },
      include: {
        items: true,
        paymentMethod: { select: { name: true } },
      },
    }),
  ]);
  if (!template)
    return { ok: false as const, error: "Template không tồn tại" };
  if (!template.isActive)
    return { ok: false as const, error: "Template đã bị tắt" };
  if (!order || !passesScope("Order", order, actor)) {
    return { ok: false as const, error: "Đơn hàng không tồn tại" };
  }

  const itemsListInner = order.items
    .map(
      (it) =>
        `<li>${it.itemName} × ${it.quantity} = ${(it.unitPrice * it.quantity).toLocaleString("vi-VN")} đ</li>`,
    )
    .join("");

  const vars = {
    customer_name: order.customerName,
    order_code: order.code,
    total_amount: order.totalAmount,
    payment_method: order.paymentMethod?.name ?? "—",
    order_date: order.createdAt,
    paid_at: order.paidAt ?? "",
    items_list: itemsListInner ? `<ul>${itemsListInner}</ul>` : "",
  };

  const subject = renderTemplate(template.subject, vars);
  const bodyText = renderTemplate(template.bodyText, vars);
  const bodyHtml = renderTemplate(template.bodyHtml, vars);

  const { actorId, actorName } = getAuditActor(session);

  const result = await sendEmail({
    to: input.toEmail.trim(),
    toName: input.toName ?? undefined,
    subject,
    bodyText,
    bodyHtml,
    fromName: template.fromName ?? undefined,
    replyTo: template.replyTo ?? undefined,
    templateId: template.id,
    contextType: "Order",
    contextId: order.id,
    triggeredByUserId: actorId,
    triggeredByName: actorName,
    triggerType: "MANUAL",
  });

  if (!result.ok) {
    return { ok: false as const, error: result.error };
  }

  revalidatePath(`/orders/${input.orderId}`);
  return { ok: true as const, logId: result.logId };
}

// ─── TÌM PHỤ HUYNH THEO SĐT (15/09/2026) ─────────────────────────────────────
//
// Chủ dự án: *"ở phần khách hàng thì khi nhập sđt sẽ thấy lead của sđt đó ... chọn sđt xong
// thì tự điền tên PH, và ở dưới khoá học thì tên học viên được chọn sẵn 1 trong số con của
// PH luôn."*
//
// SĐT LÀ NEO của cả form: từ nó suy ra tên phụ huynh, cơ sở, và danh sách con. Trước bản
// này sale phải gõ tay tên PH rồi tự tìm con trong danh sách 250 học viên của cả cơ sở.
//
// ⚠️ TÌM THEO YÊU CẦU, KHÔNG NẠP CẢ BẢNG vào form. Đo 15/09: 122 lead / 123 con — nạp
// hết vẫn chạy được HÔM NAY, nhưng bảng lead là bảng phình theo thời gian (mỗi quảng cáo
// một đợt lead mới), nên một form nạp-tất-cả là bom hẹn giờ không ai nhớ đã cài. Học viên
// thì vẫn dùng danh sách đã nạp sẵn (đã có `parentPhone`, lọc ở client là đủ).
//
// ⚠️ `phoneVariants` BẮT BUỘC: DB đang có CẢ HAI dạng `0…` và `84…` (xem lib/phone.ts —
// 6 hàm chuẩn hoá khác nhau thời trước). Tra bằng đúng chuỗi người dùng gõ là trượt hết
// bản ghi dạng kia.
export async function timPhuHuynhTheoSdtAction(sdt: string): Promise<{
  ok: boolean;
  leads?: Array<{
    id: string;
    parentName: string;
    phone: string;
    email: string | null;
    centerId: string | null;
    /**
     * Con LEAD KHAI — có thể CHƯA có hồ sơ `Student` nào.
     *
     * ⚠️ MANG CẢ `id` từ 16/09/2026. Bản cũ chỉ trả TÊN, nên ô chọn học viên ở dòng đơn
     * không có gì để lưu và con của lead chưa convert KHÔNG chọn được — dù tên em đang
     * hiện ngay trên dòng gợi ý. Chủ dự án: *"lead này đa số là lead chưa chốt nên chưa
     * phải là học viên nên sẽ lấy thông tin con của PH lead đó chứ"*.
     */
    conKhai: Array<{ id: string; fullName: string }>;
  }>;
  error?: string;
}> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  // Cùng cổng với trang tạo đơn: ai tạo được đơn thì tra được SĐT khách của mình.
  if (!(await checkPermission("orders:create"))) return { ok: false, error: "Không có quyền" };

  const so = (sdt ?? "").replace(/\D/g, "");
  // Dưới 6 chữ số thì mọi SĐT đều khớp — trả rỗng thay vì đổ nửa bảng lead lên màn.
  if (so.length < 6) return { ok: true, leads: [] };

  const actor = await resolveActor(session.user.id);
  const bienThe = expandPhoneVariants([so]);
  const rows = await scopedDb(actor).lead.findMany({
    where: {
      deletedAt: null,
      // Gõ đủ số → khớp chính xác theo mọi biến thể; gõ thiếu → khớp phần đuôi.
      OR: [{ phone: { in: bienThe } }, { phone: { contains: so } }],
    },
    select: {
      id: true,
      parentName: true,
      phone: true,
      email: true,
      centerId: true,
      children: { select: { id: true, fullName: true }, orderBy: { createdAt: "asc" } },
    },
    orderBy: { createdAt: "desc" },
    // Trần 8: danh sách gợi ý dài hơn thì người bán không đọc, chỉ bấm bừa.
    take: 8,
  });

  return {
    ok: true,
    leads: rows.map((l) => ({
      id: l.id,
      parentName: l.parentName,
      phone: l.phone,
      email: l.email,
      centerId: l.centerId,
      // ⚠️ MANG CẢ `id`, không chỉ tên [16/09/2026]. Trước bản này gợi ý lead chỉ trả về
      // TÊN con, nên ô chọn học viên không có gì để lưu và con của lead chưa convert
      // không chọn được — chủ dự án: *"lead này đa số là lead chưa chốt… sẽ lấy thông tin
      // con của PH lead đó chứ"*. Dòng đơn nay lưu `leadChildId`.
      conKhai: l.children.map((c) => ({ id: c.id, fullName: c.fullName })),
    })),
  };
}

// ─── THANH TOÁN LINH HOẠT — kế hoạch n đợt ───────────────────────────
//
// Chủ dự án chốt đổi "thanh toán 2 đợt" thành đóng theo 1/2/3/4 học phần. Luật chia tiền,
// hạn từng đợt và phép kiểm nằm ở `lib/payments/ke-hoach-dot.ts` (thuần, có test) —
// action này chỉ gác quyền/scope rồi chuyển tiếp.
export async function recordOrderInstallmentsAction(input: {
  orderId: string;
  dots: Array<{
    amount: number;
    daThu: boolean;
    dueDate: string | null;
    reminderDays?: number | null;
  }>;
}): Promise<{ ok: boolean; error?: string; thongDiepPhieu?: string | null }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  // orders:manage chỉ HO_ACCOUNTANT (GLOBAL) — không cần target.
  if (!(await checkPermission("orders:manage"))) return { ok: false, error: "Không có quyền" };

  const actor = await resolveActor(session.user.id);
  const order = await scopedDb(actor).order.findUnique({
    where: { id: input.orderId },
    select: { id: true, centerId: true, leadId: true },
  });
  if (!order || !passesScope("Order", order, actor)) {
    return { ok: false, error: "Không tìm thấy đơn hàng" };
  }

  // Ngày từ client là chuỗi — quy về Date ở BIÊN, để phần trong chỉ có một kiểu.
  // Phép quy đổi ở `dotsGhiTuForm` (thuần, có test): từ 15/09/2026 có HAI đường ghi kế
  // hoạch (đây + `createOrderManualAction`) nên nó không được viết tại chỗ nữa.
  const res = await recordInstallmentPlan({
    orderId: input.orderId,
    dots: dotsGhiTuForm(input.dots),
    actorId: session.user.id ?? null,
  });
  if (res.ok) {
    revalidatePath(`/orders/${input.orderId}`);
    // S6 — ghi sổ đợt 1 sinh Payment(RECORDED) → đồng bộ trang lead/convert.
    if (order.leadId) {
      revalidatePath(`/leads/${order.leadId}`);
      revalidatePath(`/leads/${order.leadId}/convert`);
    }
  }
  return res;
}

export async function markOrderInstallmentPaidAction(
  installmentId: string,
  orderId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  // orders:manage chỉ HO_ACCOUNTANT (GLOBAL) — không cần target.
  if (!(await checkPermission("orders:manage"))) return { ok: false, error: "Không có quyền" };

  // R7-00 AC4 — chặn IDOR chéo cơ sở: xác nhận đơn nằm trong scope trước khi mutate.
  const actor = await resolveActor(session.user.id);
  const order = await scopedDb(actor).order.findUnique({
    where: { id: orderId },
    select: { id: true, centerId: true, leadId: true },
  });
  if (!order || !passesScope("Order", order, actor)) {
    return { ok: false, error: "Không tìm thấy đơn hàng" };
  }

  // Truyền orderId ĐÃ scope-check để lib đối chiếu installment thuộc đúng đơn
  // (chống IDOR: installmentId của đơn khác cơ sở).
  const res = await markInstallmentPaid(installmentId, session.user.id ?? null, order.id);
  if (res.ok) {
    revalidatePath(`/orders/${orderId}`);
    // S6 — đóng đợt sinh Payment(RECORDED, nếu đã duyệt) → đồng bộ trang lead/convert.
    if (order.leadId) {
      revalidatePath(`/leads/${order.leadId}`);
      revalidatePath(`/leads/${order.leadId}/convert`);
    }
  }
  return res;
}

// ─── Row type for client ─────────────────────────────────────────────
export type OrderRow = Awaited<ReturnType<typeof queryOrders>>["items"][number];

// ─── THÔNG TIN NGƯỜI MUA TRÊN HOÁ ĐƠN (14/09/2026) ──────────────────────────
//
// Chủ dự án: "thiếu các trường thông tin của khách hàng để xuất hoá đơn khi kế toán duyệt".
// Bốn ô đo từ ba tờ hoá đơn thật mà `Order` chưa có — xem migration
// 20260914120000_hoa_don_thong_tin_nguoi_mua và `lib/finance/hoa-don/nguoi-mua.ts`.
//
// ⚠️ CHUỖI RỖNG GHI THÀNH `null`, KHÔNG ghi "". Đường đọc phân biệt "chưa khai" (rơi về
// cột `customer*`) với "đã khai"; một chuỗi rỗng lọt vào DB là "đã khai bằng ô trắng" —
// tên người mua biến mất khỏi tờ hoá đơn mà không ai thấy lỗi.
//
// KHÔNG chặn khi còn thiếu ô bắt buộc: người nhập thường có thông tin nhỏ giọt (gọi khách
// hỏi mã số thuế mất một buổi). Cổng "đủ chưa" nằm ở khâu XUẤT, và màn hiện rõ còn thiếu
// gì — chặn ở đây chỉ khiến người ta không lưu được phần đã có.
//
// GĐ 8 bước 12 — bốn ô này là thứ in lên TỜ HOÁ ĐƠN và quyết định email nhận hoá đơn ⇒ mỗi lượt sửa
// để lại vết (cũ → mới, CHỈ các ô đổi) trong CÙNG transaction với phép ghi, và trả câu cảnh báo khi
// đơn đang có hoá đơn còn hiệu lực (tờ đã có không tự đổi). `expectedUpdatedAt` BẮT BUỘC (luật 7):
// thiếu nó là ghi đè mù lên lượt sửa của người khác.
const COT_NGUOI_MUA_HOA_DON = ["invoiceBuyerName", "invoiceCompanyName", "invoiceTaxCode", "invoiceEmail"] as const satisfies readonly CotNguoiMua[];

export async function luuThongTinHoaDonAction(
  orderId: string,
  input: {
    invoiceBuyerName?: string | null;
    invoiceCompanyName?: string | null;
    invoiceTaxCode?: string | null;
    invoiceEmail?: string | null;
  },
  expectedUpdatedAt: string,
) {
  const session = await requireOrdersManage();
  // 29/09 (PLAN GĐ 7 mục 12) — người thiếu `orders:view-pii` chỉ thấy MST / email hoá đơn ĐÃ CHE; cho họ
  // ghi là mở đường ghi chuỗi đã che (hoặc giá trị đoán mò) đè lên dữ liệu thật. Màn không vẽ nút Sửa cho
  // họ (`khoiNguoiMuaHoaDon` → `giaTriSua = null`); cổng này là lớp thứ hai, đứng TRƯỚC mọi đọc / ghi.
  if (!(await checkPermission("orders:view-pii"))) {
    return {
      ok: false as const,
      error: "Cần quyền xem thông tin khách để sửa người mua trên hoá đơn",
    };
  }

  const sach = (v: string | null | undefined) => {
    const t = (v ?? "").trim();
    return t.length > 0 ? t : null;
  };
  const dulieu = {
    invoiceBuyerName: sach(input.invoiceBuyerName),
    invoiceCompanyName: sach(input.invoiceCompanyName),
    invoiceTaxCode: sach(input.invoiceTaxCode),
    invoiceEmail: sach(input.invoiceEmail),
  };
  for (const [k, v] of Object.entries(dulieu)) {
    if (v && v.length > 200) {
      return { ok: false as const, error: `Trường ${k} quá dài (tối đa 200 ký tự)` };
    }
  }
  if (dulieu.invoiceEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dulieu.invoiceEmail)) {
    return { ok: false as const, error: "Email nhận hoá đơn không hợp lệ" };
  }

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const order = await sdb.order.findUnique({
    where: { id: orderId },
    select: { id: true, centerId: true },
  });
  // `scopedDb` KHÔNG che write — gác lại lần nữa trước khi ghi.
  if (!order || !passesScope("Order", order, actor)) {
    return { ok: false as const, error: "Không tìm thấy đơn hàng" };
  }

  const expectedAt = new Date(expectedUpdatedAt);
  if (Number.isNaN(expectedAt.getTime())) return { ok: false as const, error: "STALE_WRITE" };
  const { actorId, actorName } = getAuditActor(session);

  const kq = await sdb.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Prisma.TransactionClient;
    // Giá trị CŨ đọc TRONG transaction (không lấy từ client). Hoá đơn đọc LỒNG dưới Order: sale không
    // có `payments:*` vẫn thấy — tra top-level qua `scopedDb` thì câu cảnh báo tắt đúng với họ.
    const cu = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        updatedAt: true,
        centerId: true,
        invoiceBuyerName: true,
        invoiceCompanyName: true,
        invoiceTaxCode: true,
        invoiceEmail: true,
        hoaDonDienTu: {
          where: { trangThai: { in: ["NHAP", "DA_XAC_NHAN"] } },
          select: { id: true, trangThai: true, kyHieu: true, soHoaDon: true },
        },
      },
    });
    if (!cu || cu.updatedAt.getTime() !== expectedAt.getTime()) return { stale: true as const };
    const doi = COT_NGUOI_MUA_HOA_DON.filter((k) => (cu[k] ?? null) !== dulieu[k]);
    if (doi.length === 0) return { stale: false as const, doi, con: cu.hoaDonDienTu };

    const upd = await tx.order.updateMany({ where: { id: orderId, updatedAt: cu.updatedAt }, data: dulieu });
    // Ghi có điều kiện đổi 0 dòng ⇒ commit vô hại (mẫu chống-đua FIX-H9).
    if (upd.count === 0) return { stale: true as const };

    await writeAudit({
      tx,
      actor: { id: actorId, name: actorName },
      module: "orders",
      entityType: "Order",
      entityId: orderId,
      action: "SUA_THONG_TIN_HOA_DON",
      oldValues: Object.fromEntries(doi.map((k) => [k, cu[k] ?? null])),
      newValues: {
        ...Object.fromEntries(doi.map((k) => [k, dulieu[k]])),
        ...(cu.hoaDonDienTu.length > 0
          ? {
              hoaDonConHieuLuc: cu.hoaDonDienTu.map((h) => ({
                id: h.id,
                trangThai: h.trangThai,
                so: [h.kyHieu, h.soHoaDon].filter(Boolean).join("-") || null,
              })),
            }
          : {}),
      },
      changedFields: [...doi],
      orgUnitId: cu.centerId,
    });
    return { stale: false as const, doi, con: cu.hoaDonDienTu };
  });
  if (kq.stale) return { ok: false as const, error: "STALE_WRITE" };

  revalidatePath(`/orders/${orderId}`);
  if (kq.doi.length > 0) revalidatePath("/payments/hoa-don");
  return {
    ok: true as const,
    canhBao: canhBaoSuaNguoiMua({ doi: kq.doi, con: kq.con, emailMoi: dulieu.invoiceEmail }),
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// PHIÊN A (16/09/2026) — ĐỢT THU THEO TỪNG CON
//
// Chủ dự án chốt: *"Sale trên đơn: chọn con → nhập số tiền → hạn → 'Tạo đợt'. Số tiền ≤ học
// phí thực của con − đã thu − đợt đang mở của con. Không bắt lên lịch cả khoá."*
//
// ⚠️ HAI ĐIỂM KHÁC HẲN kế hoạch trả góp cũ (`recordInstallmentPlan`), và cả hai là chủ ý:
//   1. **Không đẻ dòng `Payment` nào.** Đợt chỉ là một khoản PHẢI THU; tiền vào sổ khi và chỉ
//      khi có giao dịch ngân hàng thật. Đó là lý do "Lưu kế hoạch xoá mềm Payment" không thể
//      tái diễn ở đường này — không có gì để dọn.
//   2. **Không đụng `OrderInstallment`.** Sổ kế hoạch cũ đóng băng theo quyết định của chủ dự
//      án; đợt theo con sống ở `PaymentRequest.orderItemId`.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Tạo MỘT đợt thu cho MỘT con.
 *
 * Cổng số tiền nằm ở `kiemTaoDot` (thuần, có test) — ở đây chỉ nạp dữ liệu và ghi.
 */
export async function taoDotChoConAction(input: {
  orderId: string;
  orderItemId: string;
  soTien: number;
  dueDate?: string | null;
}) {
  const session = await requireOrdersManage();
  const actor = await resolveActor(session.user.id);
  const { actorId, actorName } = getAuditActor(session);
  const sdb = scopedDb(actor);

  const order = await sdb.order.findUnique({
    where: { id: input.orderId },
    select: { id: true, centerId: true, orgUnitId: true, status: true },
  });
  if (!order || !passesScope("Order", order, actor)) {
    return { ok: false as const, error: "Không tìm thấy đơn hàng" };
  }
  if (!(await laThuTienLinhHoatBat(order.orgUnitId))) {
    return { ok: false as const, error: "Tính năng thu học phí linh hoạt chưa bật cho cơ sở này" };
  }

  const han = input.dueDate ? new Date(input.dueDate) : null;
  if (han && Number.isNaN(han.getTime())) {
    return { ok: false as const, error: "Hạn đóng không hợp lệ" };
  }

  // PHIÊN B — toàn bộ phần TIỀN chuyển vào `taoDotChoCon`: nó đọc công nợ BÊN TRONG transaction
  // đang giữ advisory lock của đơn. Bản PHIÊN A đọc `noTheoCon` ở ngay đây, ngoài khoá, nên hai
  // sale bấm cùng lúc đều thấy "chưa có đợt nào" và cùng tạo một đợt bằng trọn số nợ.
  //
  // Cổng "đơn còn nhận tiền không" cũng bỏ khỏi đây: `taoDotChoCon` hỏi bằng `locDonNhanTien()`,
  // đúng mảnh lọc mà tầng đối khớp dùng. Hai bản chép tay của một danh sách trạng thái là hai
  // bản sẵn sàng lệch nhau.
  const kq = await taoDotChoCon({
    orderId: order.id,
    orderItemId: input.orderItemId,
    soTien: input.soTien,
    dueDate: han,
    centerId: order.centerId,
    actor: { id: actorId ?? "", name: actorName },
  });
  if (!kq.ok) return kq;

  revalidatePath(`/orders/${input.orderId}`);
  return { ok: true as const };
}

/** Huỷ một đợt CHƯA CÓ TIỀN. Đợt đã nhận đồng nào thì không huỷ — xem `kiemHuyDot`. */
export async function huyDotChoConAction(input: { orderId: string; paymentRequestId: string }) {
  const session = await requireOrdersManage();
  const actor = await resolveActor(session.user.id);
  const { actorId, actorName } = getAuditActor(session);
  const sdb = scopedDb(actor);

  const order = await sdb.order.findUnique({
    where: { id: input.orderId },
    select: { id: true, centerId: true, orgUnitId: true },
  });
  if (!order || !passesScope("Order", order, actor)) {
    return { ok: false as const, error: "Không tìm thấy đơn hàng" };
  }
  if (!(await laThuTienLinhHoatBat(order.orgUnitId))) {
    return { ok: false as const, error: "Tính năng thu học phí linh hoạt chưa bật cho cơ sở này" };
  }

  const kq = await huyDotChoCon({
    orderId: order.id,
    paymentRequestId: input.paymentRequestId,
    centerId: order.centerId,
    actor: { id: actorId ?? "", name: actorName },
  });
  if (!kq.ok) return kq;

  revalidatePath(`/orders/${input.orderId}`);
  return { ok: true as const, thongDiepPhieu: kq.thongDiepPhieu };
}

/**
 * Cổng chung cho ĐƯỜNG B (gắn / bỏ gắn khoản đã thu vào một bé).
 *
 * ⚠️ QUYỀN Ở ĐÂY KHÁC `taoDotChoConAction` NGAY TRÊN, và đó là chủ ý của chủ dự án
 * (chốt 18/09/2026): *"payments:record để gắn, payments:manage để bỏ gắn."*
 *
 * `taoDotChoConAction` gác bằng `requireOrdersManage()` (`orders:manage`, chỉ HO_ACCOUNTANT).
 * Đường B **không** dùng lại nó: tạo một khoản phải thu là việc của kế toán, còn gắn một
 * khoản ĐÃ THU cho đúng bé là việc thường ngày của sale — nó không sinh thêm nghĩa vụ tiền
 * nào, chỉ nói rõ tiền có sẵn thuộc về ai.
 *
 * ⚠️ `requireOrdersManage` còn `redirect()` khi thiếu quyền. Đường B **trả `{ ok: false }`**
 * chứ không redirect: nó được gọi từ một nút trong trang đang mở, và đá người dùng ra
 * `/dashboard` giữa lúc họ đang gắn tiền là mất luôn ngữ cảnh lẫn thao tác dở.
 *
 * Ba vế, thiếu vế nào cũng từ chối:
 *   1. quyền (`payments:record` để gắn / `payments:manage` để bỏ gắn);
 *   2. đơn nằm trong phạm vi cơ sở của người bấm (`passesScope`);
 *   3. **công tắc BẬT cho cơ sở GIỮ ĐƠN** — không phải cơ sở của người bấm. Cùng một sale mở
 *      hai đơn ở hai cơ sở thì phải thấy hai luồng khác nhau; đọc theo người bấm là pilot một
 *      cơ sở hoá ra bật cho mọi đơn mà người đó chạm vào.
 */
async function congDuongB(
  orderId: string,
  quyen: "payments:record" | "payments:manage" | "payments:pos-check",
) {
  const session = await auth();
  if (!session?.user) return { ok: false as const, error: "Chưa đăng nhập" };
  if (!(await checkPermission(quyen))) {
    return { ok: false as const, error: "Không có quyền" };
  }

  const actor = await resolveActor(session.user.id);
  const order = await scopedDb(actor).order.findUnique({
    where: { id: orderId },
    select: { id: true, centerId: true, orgUnitId: true },
  });
  if (!order || !passesScope("Order", order, actor)) {
    // Câu chữ cố ý KHÔNG phân biệt "không có" với "không thuộc cơ sở bạn".
    return { ok: false as const, error: "Không tìm thấy đơn hàng" };
  }

  if (!(await laThuTienLinhHoatBat(order.orgUnitId))) {
    return {
      ok: false as const,
      error: "Tính năng thu học phí linh hoạt chưa bật cho cơ sở này",
    };
  }

  const { actorId, actorName } = getAuditActor(session);
  return { ok: true as const, order, actor: { id: actorId ?? "", name: actorName } };
}

/**
 * ĐƯỜNG B — gắn MỘT khoản đã thu cho MỘT bé.
 *
 * ⚠️ Một khoản gắn cho ĐÚNG MỘT bé. Chia một khoản cho nhiều bé đi đường RIÊNG —
 * `tachKhoanChoConAction` ngay dưới (mục 6 của `lib/finance/ghi-tien-don.ts`). Hàm này KHÔNG
 * bao giờ được chia tiền: "chỉ điền một cột đang trống" là toàn bộ lý do nó an toàn.
 */
export async function ganKhoanChoConAction(input: {
  orderId: string;
  paymentId: string;
  orderItemId: string;
}) {
  const cong = await congDuongB(input.orderId, "payments:record");
  if (!cong.ok) return { ok: false as const, error: cong.error };

  const kq = await ganKhoanDaThuChoCon({
    orderId: cong.order.id,
    paymentId: input.paymentId,
    orderItemId: input.orderItemId,
    actor: cong.actor,
  });
  if (!kq.ok) return kq;

  revalidatePath(`/orders/${input.orderId}`);
  return { ok: true as const, soTien: kq.soTien, tenCon: kq.tenCon };
}

/** ĐƯỜNG B — bỏ gắn. CHỈ kế toán (`payments:manage`), và BẮT BUỘC ghi lý do. */
export async function boGanKhoanChoConAction(input: {
  orderId: string;
  paymentId: string;
  lyDo: string;
}) {
  const cong = await congDuongB(input.orderId, "payments:manage");
  if (!cong.ok) return { ok: false as const, error: cong.error };

  const kq = await boGanKhoanKhoiCon({
    orderId: cong.order.id,
    paymentId: input.paymentId,
    lyDo: input.lyDo,
    actor: cong.actor,
  });
  if (!kq.ok) return kq;

  revalidatePath(`/orders/${input.orderId}`);
  return { ok: true as const, soTien: kq.soTien };
}

/**
 * ĐƯỜNG B · TÁCH — chia MỘT khoản đã thu cho NHIỀU bé [20/09/2026].
 *
 * ⚠️ QUYỀN: `payments:record`, **cùng quyền với "Gắn cho bé…"**, không phải `payments:manage`.
 *
 * Cân nhắc đã làm, vì lệnh này CÓ sinh một bút toán `ADJUSTMENT` — thứ trước nay chỉ kế toán
 * tạo. Nhưng bút toán ấy **đúng bằng −số tiền dòng gốc và trỏ thẳng vào dòng gốc**: nó không
 * đổi tổng tiền của đơn một đồng nào (`tongDaVe` trước = sau), và không tồn tại đầu vào nào
 * khiến nó đổi. Nó là CƠ CHẾ của phép ghi, không phải một quyết định về giá trị.
 *
 * Việc thật mà người bấm đang làm vẫn là ATTRIBUTION — *"9.530.000đ này của bé nào"* — đúng
 * việc thường ngày của sale, và là lý do chủ dự án đặt "Gắn cho bé…" ở `payments:record`.
 * Bắt nó lên `payments:manage` nghĩa là mỗi đơn hai con phải chờ kế toán mới nhập được tiền.
 *
 * Nếu sau này muốn siết: đổi MỘT chuỗi ở dòng `congDuongB(...)` dưới đây. Cổng đã tách sẵn.
 */
export async function tachKhoanChoConAction(input: {
  orderId: string;
  paymentId: string;
  phan: { orderItemId: string; soTien: number }[];
}) {
  const cong = await congDuongB(input.orderId, "payments:record");
  if (!cong.ok) return { ok: false as const, error: cong.error };

  // Chuẩn hoá đầu vào TRƯỚC khi đưa vào cổng. `kiemTachKhoan` đã chặn `NaN`/`Infinity` bằng
  // `tron()`, nhưng một `phan` không phải mảng sẽ ném ở `.filter` bên trong và biến một lỗi
  // dữ liệu thành lỗi 500 — người dùng nhận trang lỗi thay vì một câu tiếng Việt.
  if (!Array.isArray(input.phan) || input.phan.length === 0) {
    return { ok: false as const, error: "Chưa nhập số tiền cho bé nào" };
  }
  const phan = input.phan.map((p) => ({
    orderItemId: String(p?.orderItemId ?? ""),
    soTien: Number(p?.soTien ?? 0),
  }));

  const kq = await tachKhoanChoCon({
    orderId: cong.order.id,
    paymentId: input.paymentId,
    phan,
    actor: cong.actor,
  });
  if (!kq.ok) return kq;

  revalidatePath(`/orders/${input.orderId}`);
  return { ok: true as const, soTien: kq.soTien, soPhan: kq.soPhan, tenCon: kq.tenCon };
}

// ─────────────────────────────────────────────────────────────────────────────
// PHIÊN C · PHIẾU GỘP — phát hành / huỷ / đóng  [20/09/2026]
//
// ⚠️ QUYỀN: **hai mức, không phải một**, và ranh giới là "phiếu đã nhận đồng nào chưa".
//
//   · phát hành + huỷ phiếu CHƯA nhận tiền  → `payments:record`  (việc thường ngày của sale)
//   · đóng phiếu ĐÃ nhận một phần           → `payments:manage`  (kế toán)
//
// Phát một tờ QR và huỷ nó khi chưa ai chuyển gì là việc không đổi một đồng nào trong sổ —
// bắt nó lên `payments:manage` nghĩa là mỗi lần sale tick nhầm một đợt phải chờ kế toán.
// Còn ĐÓNG phiếu là nói "phần đã nhận cứ để đó, đừng thu tiếp bằng tờ này" — đó là một phán
// quyết về tiền đã vào, và nó thuộc kế toán.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Phát MỘT phiếu gộp cho các đợt sale tick.
 *
 * ⚠️ Không kiểm "đơn đã có phiếu OPEN chưa" ở đây: `PaymentBill_orderId_open_key` (chỉ mục
 * partial unique) gác việc đó, và nó là thứ duy nhất gác được khi hai người bấm cùng lúc.
 * `taoPhieuGop` bắt lỗi unique rồi dịch sang tiếng Việt.
 *
 * ⚠️ 09/10/2026 (hai nút QR / Thẻ POS chung một mã): đi qua `phatHoacDungLaiPhieuGop` — nút kia (hoặc tab kia) đã
 * phát phiếu cho CHÍNH đợt này thì DÙNG LẠI mã (`dungLai: true`) thay vì nhận "huỷ hoặc đóng phiếu đó trước".
 */
export async function taoPhieuGopAction(input: {
  orderId: string;
  paymentRequestIds: string[];
}) {
  const cong = await congDuongB(input.orderId, "payments:record");
  if (!cong.ok) return { ok: false as const, error: cong.error };

  if (!Array.isArray(input.paymentRequestIds) || input.paymentRequestIds.length === 0) {
    return { ok: false as const, error: "Chưa chọn đợt nào" };
  }

  const kq = await phatHoacDungLaiPhieuGop({
    orderId: cong.order.id,
    paymentRequestIds: input.paymentRequestIds.map((x) => String(x)),
    actor: cong.actor,
    // Chỉ để câu từ chối nói đúng thẻ của phiếu đang giữ mã còn hạn hay hết (luật 19: BẮT BUỘC, không đồng hồ ngầm).
    now: new Date(),
  });
  if (!kq.ok) return { ok: false as const, error: kq.error };

  // ⚠️ Cảnh báo cạn kho mã đi ra NHẬT KÝ MÁY CHỦ, không ra toast của sale: người bấm không
  // làm gì được với nó, còn người vận hành thì không ngồi xem toast. Ngưỡng 50% là lời nhắc
  // SỚM — kho còn hơn 200.000 mã, nên đây không phải việc gấp, chỉ là việc đừng để quên.
  if (kq.canhBaoKho) console.warn(`[phieu-gop] CẠN KHO MÃ: ${kq.canhBaoKho}`);

  revalidatePath(`/orders/${input.orderId}`);
  return { ok: true as const, billId: kq.billId, ma: kq.ma, tongTien: kq.tongTien, soDong: kq.soDong, dungLai: kq.dungLai };
}

/**
 * HUỶ một phiếu CHƯA nhận đồng nào — `payments:record`. Mã của phiếu VOID hết khớp được.
 *
 * ⚠️ Phiếu đang có THẺ POS đang mở (khách có thể đang quẹt / thẻ chờ kế toán) ⇒ máy chủ từ chối ở `huyPhieuGop`
 * (09/10/2026). Màn ẩn nút Huỷ đúng lúc đó, nhưng cổng thật ở đó, không ở nút.
 */
export async function huyPhieuGopAction(input: {
  orderId: string;
  billId: string;
  lyDo: string;
}) {
  const cong = await congDuongB(input.orderId, "payments:record");
  if (!cong.ok) return { ok: false as const, error: cong.error };

  const kq = await huyPhieuGop({
    orderId: cong.order.id,
    billId: input.billId,
    lyDo: input.lyDo,
    actor: cong.actor,
    // Cổng thẻ POS của `huyPhieuGop` đo hết hạn phiếu thẻ theo giờ này (luật 19: BẮT BUỘC, không đồng hồ ngầm).
    now: new Date(),
  });
  if (!kq.ok) return kq;

  revalidatePath(`/orders/${input.orderId}`);
  return { ok: true as const };
}

/** ĐÓNG một phiếu ĐÃ nhận một phần — CHỈ kế toán (`payments:manage`), bắt buộc ghi lý do. */
export async function dongPhieuGopAction(input: {
  orderId: string;
  billId: string;
  lyDo: string;
}) {
  const cong = await congDuongB(input.orderId, "payments:manage");
  if (!cong.ok) return { ok: false as const, error: cong.error };

  const kq = await dongPhieuGop({
    orderId: cong.order.id,
    billId: input.billId,
    lyDo: input.lyDo,
    actor: cong.actor,
  });
  if (!kq.ok) return kq;

  revalidatePath(`/orders/${input.orderId}`);
  return { ok: true as const, daNhan: kq.daNhan };
}

// ─────────────────────────────────────────────────────────────────────────────
// THU THẺ POS  [GĐ1 · 06/10/2026 — docs/pos-gd1-thiet-ke.md §6]
//
// Quyền RIÊNG `payments:pos-check` (D6) — sale cơ sở + quản lý cơ sở + kế toán HO. Ba action:
//   · TẠO phiếu thu thẻ   → `congDuongB(…, "payments:pos-check")`: quyền · phạm vi · CỜ của cơ sở đơn;
//   · KIỂM TRA / BÁO ADMIN → `congXemPhieuPos`: quyền · phạm vi, KHÔNG hỏi cờ (T8: cờ tắt giữa chừng,
//     sale vẫn phải xem được kết quả khoản tiền đã quẹt).
// Không viết điều kiện quyền / so cơ sở trong action (no-inline-authz); Q-E nằm ở lib. Tiền KHÔNG ghi
// ở đây — pha tiền chạy dưới danh nghĩa HỆ THỐNG (như `nhapLoPos`), chỉ cho giao dịch mang MÃ CỦA
// CHÍNH phiếu người bấm đã qua cổng phạm vi; người bấm không lái được tiền sang chỗ khác.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cổng của KIỂM TRA + BÁO ADMIN: quyền `payments:pos-check` + đơn trong phạm vi. KHÔNG hỏi cờ
 * `billing.flexV1Enabled` (T8). Wrapper MỘT cấp cùng tệp — luật lint
 * `authz/require-can-in-write-action` nhận ra.
 */
async function congXemPhieuPos(orderId: string) {
  const session = await auth();
  if (!session?.user) return { ok: false as const, error: "Chưa đăng nhập" };
  if (!(await checkPermission("payments:pos-check"))) {
    return { ok: false as const, error: "Không có quyền" };
  }
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const order = await sdb.order.findUnique({
    where: { id: orderId },
    select: { id: true, centerId: true, orgUnitId: true },
  });
  // `quyenTaiCoSoCuaDon`: người có vai ở HAI cơ sở (sale@CS1 + kế toán@CS2) qua `checkPermission` trần nhờ vai này và qua `passesScope` nhờ vai kia —
  // phải hỏi lại quyền ĐÓ ở cơ sở CỦA ĐƠN (chỉ v2; xem lib/payments/pos/quyen-co-so.ts). Cổng này phủ luôn kiểm tra · báo admin · huỷ phiếu thẻ.
  if (!order || !passesScope("Order", order, actor) || !quyenTaiCoSoCuaDon(actor, QUYEN_THU_THE_POS, order.centerId)) {
    return { ok: false as const, error: "Không tìm thấy đơn hàng" };
  }
  const { actorId, actorName } = getAuditActor(session);
  return { ok: true as const, order, sdb, actor: { id: actorId ?? "", name: actorName } };
}

/**
 * "Thu bằng thẻ POS" cho MỘT đợt còn nợ — mở (hoặc trả lại) phiếu thu thẻ: mã 5 ký tự CỦA phiếu gộp
 * (D1) + số phải thu. Đơn chờ duyệt / cơ sở chưa khai máy / giao dịch thẻ trước còn ở hàng chờ ⇒ từ
 * chối ở lib (T9/T10/T21).
 */
export async function taoPhieuPosAction(
  input: unknown,
): Promise<{ ok: true; phieu: PhieuPosView } | { ok: false; error: string }> {
  const parsed = taoPhieuPosSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const cong = await congDuongB(parsed.data.orderId, "payments:pos-check");
  if (!cong.ok) return { ok: false, error: cong.error };

  const kq = await moPhieuPos({
    orderId: cong.order.id,
    paymentRequestId: parsed.data.paymentRequestId,
    ...(parsed.data.posTerminalId ? { posTerminalId: parsed.data.posTerminalId } : {}),
    actor: cong.actor,
    now: new Date(),
  });
  if (!kq.ok) return { ok: false, error: kq.error };

  revalidatePath(`/orders/${parsed.data.orderId}`);
  return { ok: true, phieu: kq.phieu };
}

/**
 * "Kiểm tra thanh toán" — hỏi provider (GĐ1: dữ liệu Techcombank đã import) qua `kiemTraPhieuPos`.
 * Chống bấm dồn (≤ 1 lượt hỏi provider / phiếu / 5 giây) nằm TRONG `kiemTraPhieuPos`, dưới khoá dòng
 * phiếu (GĐ2 U1) — action không tự đọc `lastCheckAt`: đọc ngoài khoá thì hai lượt bấm cùng lúc đều qua.
 */
export async function kiemTraPhieuPosAction(
  input: unknown,
): Promise<{ ok: true; ketQua: KetQuaKiemPos } | { ok: false; error: string }> {
  const parsed = kiemTraPhieuPosSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const cong = await congXemPhieuPos(parsed.data.orderId);
  if (!cong.ok) return { ok: false, error: cong.error };

  // Cổng IDOR: phiếu POS phải thuộc CHÍNH đơn đã qua cổng phạm vi (PosPaymentIntent ∈ SCOPED_MODELS).
  const phieu = await cong.sdb.posPaymentIntent.findFirst({
    where: { id: parsed.data.intentId, paymentBill: { orderId: cong.order.id } },
    select: { id: true },
  });
  if (!phieu) return { ok: false, error: "Không tìm thấy phiếu POS" };

  const ketQua = await kiemTraPhieuPos({
    intentId: phieu.id,
    // GĐ4 (T5): CHỈ lượt sale bấm mới gác sức khoẻ máy đồng bộ + chờ ≤ 8″ agent đồng bộ (lưới [POS4-W4]).
    provider: chonPosProvider({ cheDo: "SALE" }),
    triggeredBy: "SALE",
    now: new Date(),
    // Nhật ký kiểm (GĐ2): người bấm. `cong.actor.id` rỗng (phiên không có id) ⇒ không gán ai.
    nguoiKiemId: cong.actor.id || null,
    nguoiBam: cong.actor,
  });
  revalidatePath(`/orders/${cong.order.id}`);
  return { ok: true, ketQua };
}

/** "Báo admin" — đã ≥ 10 phút mà vẫn chưa thấy giao dịch; lib hỏi lại cổng + báo Kế toán HO/Quản trị. */
export async function baoAdminPhieuPosAction(
  input: unknown,
): Promise<{ ok: true; soNguoi: number } | { ok: false; error: string }> {
  const parsed = baoAdminPhieuPosSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const cong = await congXemPhieuPos(parsed.data.orderId);
  if (!cong.ok) return { ok: false, error: cong.error };

  const phieu = await cong.sdb.posPaymentIntent.findFirst({
    where: { id: parsed.data.intentId, paymentBill: { orderId: cong.order.id } },
    select: { id: true },
  });
  if (!phieu) return { ok: false, error: "Không tìm thấy phiếu POS" };

  const kq = await baoAdminPhieuPos({
    intentId: phieu.id,
    orderId: cong.order.id,
    ...(parsed.data.ghiChu ? { ghiChu: parsed.data.ghiChu } : {}),
    actor: cong.actor,
    now: new Date(),
  });
  if (!kq.ok) return { ok: false, error: kq.error };
  return { ok: true, soNguoi: kq.soNguoi };
}

/**
 * "Huỷ phiếu thẻ" — VIỆC 4 (09/10/2026), docs/pos-hai-nut-khai-may.md §6. Lối thoát của cổng Việc 1: bấm nhầm "Thẻ POS"
 * thì phiếu gộp có thẻ mở không huỷ được tới 24 giờ.
 *
 * Thứ tự (màn chỉ là lời hứa, cổng thật ở đây): zod → quyền `payments:pos-check` + phạm vi đơn (`congXemPhieuPos`, KHÔNG hỏi
 * cờ `billing.flexV1Enabled` — T8/V4.13: huỷ GIẢM rủi ro, cờ tắt giữa chừng sale vẫn phải gỡ được phiếu mình đã mở) → cổng IDOR
 * (phiếu thẻ thuộc CHÍNH đơn đã qua cổng, đọc qua `cong.sdb`) → `huyPhieuThe` (lib `huy-phieu-the-db.ts`: khoá đơn → khoá dòng
 * phiếu → ĐỌC LẠI mọi đầu vào dưới khoá → `choPhepHuyPhieuThe` → xác nhận mạnh → ghi `HUY` + `writeAudit`) → làm mới trang đơn.
 *
 * Chữ ký + kiểu kết quả (`KetQuaHuyPhieuThe`) là HỢP ĐỒNG với giao diện — đừng đổi.
 */
export async function huyPhieuTheAction(input: HuyPhieuTheInput): Promise<KetQuaHuyPhieuThe> {
  const parsed = huyPhieuTheSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  // Cổng quyền + phạm vi đứng TRƯỚC mọi thứ: một action ghi không gác gì là một cửa để ngỏ (và lint `authz/require-can-in-write-action`
  // đòi nó). Fail-closed: chưa đăng nhập / không quyền / đơn ngoài phạm vi ⇒ từ chối.
  const cong = await congXemPhieuPos(parsed.data.orderId);
  if (!cong.ok) return { ok: false, error: cong.error };

  // Cổng IDOR: phiếu thẻ phải thuộc CHÍNH đơn đã qua cổng phạm vi (PosPaymentIntent ∈ SCOPED_MODELS) — cùng khuôn kiểm tra / báo admin.
  // Chỉ lấy `id`: lib đọc LẠI mọi thứ dưới khoá, không dữ liệu nào từ đây lọt tới cổng luật.
  const phieu = await cong.sdb.posPaymentIntent.findFirst({
    where: { id: parsed.data.intentId, paymentBill: { orderId: cong.order.id } },
    select: { id: true },
  });
  if (!phieu) return { ok: false, error: "Không tìm thấy phiếu POS" };

  const kq = await huyPhieuThe({
    orderId: cong.order.id,
    intentId: phieu.id,
    lyDo: parsed.data.lyDo,
    ...(parsed.data.ghiChu ? { ghiChu: parsed.data.ghiChu } : {}),
    xacNhanKhachChuaQuet: parsed.data.xacNhanKhachChuaQuet,
    // Người bấm từ PHIÊN; phiên không có id ⇒ `null` (khuôn `kiemTraPhieuPosAction`).
    actor: { id: cong.actor.id || null, name: cong.actor.name },
    now: new Date(),
  });
  if (!kq.ok) return kq;

  revalidatePath(`/orders/${cong.order.id}`);
  return kq;
}

// ─────────────────────────────────────────────────────────────────────────────
// PHIÊN D · DỪNG HỌC MỘT CON  [21/09/2026]
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cổng chung cho hai action dừng học.
 *
 * ⚠️ Quyền `orders:manage`, nhưng **KHÔNG** dùng `requireOrdersManage()` ngay trên: hàm đó
 * `redirect("/dashboard")` khi thiếu quyền, mà hai action này được gọi từ một hộp thoại
 * trong trang đơn đang mở — đá người dùng ra giữa lúc họ đang quyết toán tiền là mất cả
 * ngữ cảnh lẫn thao tác dở. Cùng lý lẽ với `congDuongB`.
 *
 * Ba vế, thiếu vế nào cũng từ chối: quyền · đơn trong tầm nhìn cơ sở · **công tắc bật cho
 * cơ sở GIỮ ĐƠN** (không phải cơ sở của người bấm).
 */
async function congDungHoc(orderId: string) {
  const session = await auth();
  if (!session?.user) return { ok: false as const, error: "Chưa đăng nhập" };
  if (!(await checkPermission("orders:manage"))) {
    return { ok: false as const, error: "Không có quyền" };
  }

  const actor = await resolveActor(session.user.id);
  const order = await scopedDb(actor).order.findUnique({
    where: { id: orderId },
    select: { id: true, centerId: true, orgUnitId: true },
  });
  if (!order || !passesScope("Order", order, actor)) {
    return { ok: false as const, error: "Không tìm thấy đơn hàng" };
  }
  if (!(await laThuTienLinhHoatBat(order.orgUnitId))) {
    return {
      ok: false as const,
      error: "Tính năng thu học phí linh hoạt chưa bật cho cơ sở này",
    };
  }

  const { actorId, actorName } = getAuditActor(session);
  return { ok: true as const, order, actor: { id: actorId ?? "", name: actorName } };
}

/** Màn XEM TRƯỚC — chỉ đọc, không ghi một dòng nào. */
export async function xemTruocDungHocAction(input: {
  orderId: string;
  orderItemId: string;
  lyDo: "PH_CHU_DONG" | "TRUNG_TAM_HUY" | "KHAC";
  buoiCuoiId?: string | null;
}) {
  const cong = await congDungHoc(input.orderId);
  if (!cong.ok) return { ok: false as const, error: cong.error };

  return xemTruocDungHoc({
    orderId: input.orderId,
    orderItemId: input.orderItemId,
    lyDo: input.lyDo,
    ...(input.buoiCuoiId !== undefined ? { buoiCuoiId: input.buoiCuoiId } : {}),
  });
}

/** Xác nhận dừng học — ghi thật. Mọi cổng nằm trong `dungHocMotCon`. */
export async function dungHocConAction(input: {
  orderId: string;
  orderItemId: string;
  lyDo: "PH_CHU_DONG" | "TRUNG_TAM_HUY" | "KHAC";
  buoiCuoiId: string | null;
  ghiChu: string | null;
  phanDu: { kieu: "CHUYEN"; orderItemId: string; soTien: number }[] | { kieu: "HOAN"; soTien: number }[];
}) {
  const cong = await congDungHoc(input.orderId);
  if (!cong.ok) return { ok: false as const, error: cong.error };

  const kq = await dungHocMotCon({
    orderId: cong.order.id,
    orderItemId: input.orderItemId,
    lyDo: input.lyDo,
    buoiCuoiId: input.buoiCuoiId,
    ghiChu: input.ghiChu,
    phanDu: input.phanDu ?? [],
    actor: cong.actor,
  });
  if (!kq.ok) return kq;

  revalidatePath(`/orders/${input.orderId}`);
  // Bé vừa rời lớp ⇒ roster của lớp đó đổi. Không revalidate thì màn lớp còn in tên bé và
  // giáo viên vẫn điểm danh — affordance nói dối bằng dữ liệu cũ.
  revalidatePath("/classes");
  revalidatePath("/hoan-tien");
  return kq;
}

/**
 * F1 — CHUYỂN TIỀN GIỮA HAI CON của cùng một đơn.
 *
 * ⚠️ Quyền `payments:manage` (kế toán), KHÔNG phải `payments:record` của sale.
 *
 * Chọn theo TIỀN LỆ ĐÃ CÓ, không theo cảm tính: `boGanKhoanChoConAction` — đường "sửa một
 * quyết định đã ghi về chủ của tiền" — cũng gác bằng `payments:manage` và cũng bắt buộc
 * ghi lý do. Chuyển tiền giữa hai bé LÀ đúng việc ấy, chỉ gọn hơn một bước.
 *
 * Còn `ganKhoanChoConAction` để ở `payments:record` vì nó chỉ ĐIỀN một cột đang trống —
 * không đổi quyết định của ai.
 */
export async function chuyenTienGiuaConAction(input: {
  orderId: string;
  tuOrderItemId: string;
  denOrderItemId: string;
  soTien: number;
  lyDo: string;
}) {
  const cong = await congDuongB(input.orderId, "payments:manage");
  if (!cong.ok) return { ok: false as const, error: cong.error };

  const kq = await chuyenTienGiuaCon({
    orderId: cong.order.id,
    tuOrderItemId: input.tuOrderItemId,
    denOrderItemId: input.denOrderItemId,
    soTien: input.soTien,
    lyDo: input.lyDo,
    centerId: cong.order.centerId,
    actor: cong.actor,
  });
  if (!kq.ok) return kq;

  revalidatePath(`/orders/${input.orderId}`);
  return kq;
}

// ─────────────────────────────────────────────────────────────────────────────
// F3 · US-19 — THÊM CON VÀO ĐƠN ĐANG HỌC
//
// ⚠️ Dùng LẠI `congDungHoc` làm cổng, không viết cổng thứ hai. Luật gác y hệt nhau
// (`orders:manage` + cách ly cơ sở + cờ `billing.flexV1Enabled` của CƠ SỞ ĐƠN), và một bản
// chép tay thứ hai của cùng một luật thì vá được một bản là chuyện thường — đúng bài học
// `lib/payments/don-nhan-tien.ts` đã ghi sau khi ba nhánh tra đơn lệch nhau.
//
// ⚠️ Chính sách ưu đãi + trần % đọc từ THAM SỐ VẬN HÀNH của cơ sở đơn, rồi TRUYỀN VÀO. Đây
// là chỗ luật `crm.commissionMaxTotalRate` áp: hàm thuần không có mặc định, nên quên truyền
// là lỗi biên dịch chứ không phải một lượt tính theo số cũ.
// ─────────────────────────────────────────────────────────────────────────────

async function chinhSachChoDon(orgUnitId: string | null) {
  const [chinhSach, tranPhanTram] = await Promise.all([
    docChinhSachUuDai(orgUnitId),
    getSetting("orders.maxDiscountPercent", { orgUnitId }),
  ]);
  return { chinhSach, tranPhanTram };
}

/** Màn XEM TRƯỚC — chỉ đọc, không ghi một dòng nào (US-19 AC5). */
export async function xemTruocThemConAction(input: {
  orderId: string;
  conMoi: {
    itemName: string;
    courseId: string;
    quantity: number;
    unitPrice: number;
    giam?: { kieu: "SO_TIEN" | "PHAN_TRAM"; giaTri: number; lyDo?: string | null; loai?: string | null }[];
  };
}) {
  const cong = await congDungHoc(input.orderId);
  if (!cong.ok) return { ok: false as const, error: cong.error };

  const cs = await chinhSachChoDon(cong.order.orgUnitId);
  return xemTruocThemCon({
    orderId: cong.order.id,
    conMoi: {
      ...input.conMoi,
      giam: (input.conMoi.giam ?? []).map((k) => ({
        kieu: k.kieu,
        giaTri: k.giaTri,
        lyDo: k.lyDo ?? null,
        loai: docLoaiGiam(k.loai),
      })),
    },
    ...cs,
  });
}

export async function themConVaoDonAction(input: {
  orderId: string;
  conMoi: {
    itemName: string;
    courseId: string;
    quantity: number;
    unitPrice: number;
    giam?: { kieu: "SO_TIEN" | "PHAN_TRAM"; giaTri: number; lyDo?: string | null; loai?: string | null }[];
    studentId?: string | null;
    enrollmentId?: string | null;
  };
  lyDo: string;
}) {
  const cong = await congDungHoc(input.orderId);
  if (!cong.ok) return { ok: false as const, error: cong.error };

  const cs = await chinhSachChoDon(cong.order.orgUnitId);
  const kq = await themConVaoDon({
    orderId: cong.order.id,
    conMoi: {
      ...input.conMoi,
      giam: (input.conMoi.giam ?? []).map((k) => ({
        kieu: k.kieu,
        giaTri: k.giaTri,
        lyDo: k.lyDo ?? null,
        loai: docLoaiGiam(k.loai),
      })),
    },
    lyDo: input.lyDo,
    actor: cong.actor,
    ...cs,
  });
  if (!kq.ok) return kq;

  revalidatePath(`/orders/${input.orderId}`);
  revalidatePath("/cong-no");
  return kq;
}

// ─────────────────────────────────────────────────────────────────────────────
// F4 · US-20 — ĐỔI KHOÁ / ĐỔI LỚP CHO MỘT CON
//
// ⚠️ Dùng LẠI `congDungHoc` làm cổng (orders:manage + cách ly cơ sở + cờ thu linh hoạt của
// CƠ SỞ ĐƠN), như đường dừng học và đường thêm con. Đây đúng là họ thao tác ấy: nó dừng một
// dòng, tạo một dòng, và chuyển tiền giữa hai dòng.
//
// ⚠️ Nhưng gác THÊM một quyền nữa: `enrollments:transfer`. Thao tác này CHUYỂN GHI DANH sang
// lớp khác — đúng việc mà `transferEnrollment` gác bằng quyền ấy. Bỏ vế này là mở một cửa
// sau: ai có `orders:manage` mà KHÔNG có `enrollments:transfer` vẫn chuyển được lớp, chỉ cần
// đi vòng qua màn đơn hàng.
// ─────────────────────────────────────────────────────────────────────────────

export async function xemTruocDoiKhoaAction(input: {
  orderId: string;
  orderItemId: string;
  targetClassId: string;
  buoiCuoiId?: string | null;
  unitPriceMoi: number;
}) {
  const cong = await congDungHoc(input.orderId);
  if (!cong.ok) return { ok: false as const, error: cong.error };
  if (!(await checkPermission("enrollments:transfer"))) {
    return { ok: false as const, error: "Không có quyền chuyển lớp" };
  }

  const tranPhanTram = await getSetting("orders.maxDiscountPercent", {
    orgUnitId: cong.order.orgUnitId,
  });
  return xemTruocDoiKhoa({
    orderId: cong.order.id,
    orderItemId: input.orderItemId,
    targetClassId: input.targetClassId,
    buoiCuoiId: input.buoiCuoiId ?? null,
    unitPriceMoi: input.unitPriceMoi,
    tranPhanTram,
  });
}

export async function doiKhoaChoConAction(input: {
  orderId: string;
  orderItemId: string;
  targetClassId: string;
  buoiCuoiId?: string | null;
  unitPriceMoi: number;
  hanDotConThieu?: string | null;
  lyDo: string;
  ghiChu?: string | null;
}) {
  const cong = await congDungHoc(input.orderId);
  if (!cong.ok) return { ok: false as const, error: cong.error };
  if (!(await checkPermission("enrollments:transfer"))) {
    return { ok: false as const, error: "Không có quyền chuyển lớp" };
  }

  const tranPhanTram = await getSetting("orders.maxDiscountPercent", {
    orgUnitId: cong.order.orgUnitId,
  });
  const kq = await doiKhoaChoCon({
    orderId: cong.order.id,
    orderItemId: input.orderItemId,
    targetClassId: input.targetClassId,
    buoiCuoiId: input.buoiCuoiId ?? null,
    unitPriceMoi: input.unitPriceMoi,
    hanDotConThieu: input.hanDotConThieu ? new Date(input.hanDotConThieu) : null,
    lyDo: input.lyDo,
    ghiChu: input.ghiChu ?? null,
    tranPhanTram,
    actor: cong.actor,
  });
  if (!kq.ok) return kq;

  revalidatePath(`/orders/${input.orderId}`);
  revalidatePath("/cong-no");
  revalidatePath("/hoan-tien");
  revalidatePath("/enrollments");
  return kq;
}

// ─────────────────────────────────────────────────────────────────────────────
// G1 · US-22 — MIỄN GIẢM NỢ CỦA MỘT CON
//
// ⚠️ Cổng `congDungHoc` = `orders:manage` + cách ly cơ sở + cờ thu linh hoạt. Đo
// `prisma/seed-roles.ts` 22/09/2026: CENTER_MANAGER (QLCS) và HO_ACCOUNTANT CÓ key này;
// CENTER_SALES_CSM thì KHÔNG — đúng AC3 ("sale gọi trực tiếp action → từ chối"), và từ chối
// ở ACTION chứ không chỉ ẩn nút.
//
// ⚠️ BA khai quyền `billing:waive`. Key đó KHÔNG TỒN TẠI trong repo; tự chế một key mới là
// dựng một màn hình không vai nào mở được (bài học `audit-logs:view`). Lý lẽ đầy đủ ở đầu
// `lib/finance/mien-giam.ts`.
// ─────────────────────────────────────────────────────────────────────────────

export async function mienGiamNoAction(input: {
  orderId: string;
  orderItemId: string;
  soTien: number;
  lyDo: string;
}) {
  const cong = await congDungHoc(input.orderId);
  if (!cong.ok) return { ok: false as const, error: cong.error };

  const [hapThu, tranPhanTram] = await Promise.all([
    docChinhSachUuDai(cong.order.orgUnitId).then((cs) => cs.hapThu),
    getSetting("orders.maxDiscountPercent", { orgUnitId: cong.order.orgUnitId }),
  ]);

  const kq = await mienGiamNoChoCon({
    orderId: cong.order.id,
    orderItemId: input.orderItemId,
    soTien: input.soTien,
    lyDo: input.lyDo,
    hapThu,
    tranPhanTram,
    actor: cong.actor,
  });
  if (!kq.ok) return kq;

  revalidatePath(`/orders/${input.orderId}`);
  revalidatePath("/cong-no");
  return kq;
}

// ─── XOÁ ĐƠN ĐÃ HUỶ (xoá CỨNG, chỉ khi đơn SẠCH) ─────────────────────────────────
//
// Chủ dự án chốt 02/10/2026, chọn trong ba phương án: **xoá cứng khi đơn sạch** (thay vì
// chỉ ẩn khỏi danh sách, hoặc xoá mềm đầy đủ).
//
// ⚠️ VÌ SAO KHÔNG XOÁ MỀM dù `Order.deletedAt` đã có sẵn: đo 02/10 — **84 nơi đọc bảng
// `Order`, chỉ 25 nơi lọc `deletedAt`**. Ghi `deletedAt` rồi dừng là đơn biến khỏi danh
// sách mà vẫn hiện ở công nợ, dashboard kế toán, biến động số dư, báo cáo doanh thu.
//
// Luật "đơn nào xoá được" ở MỘT chỗ thuần: `lib/orders/xoa-don-huy.ts`.
//
// ⚠️ QUYỀN: **SUPER_ADMIN**, kiểm bằng vai chứ không đẻ quyền mới. Quyền mới chỉ sống sau
// khi bấm `seed-prod-roles.yml` (RBAC v2 đọc DB), và quãng giữa là không ai xoá được —
// triệu chứng sẽ là "không có quyền" chứ không phải "chưa seed". Cùng lý lẽ đã dùng cho
// luật duyệt số buổi học phần (CLAUDE.md).
export async function xoaDonDaHuyAction(input: { orderId: string; lyDo: string }) {
  const session = await auth();
  if (!session?.user) return { ok: false as const, error: "Chưa đăng nhập" };

  // ── MỌI CỔNG ĐỨNG TRƯỚC PHÉP GHI ĐẦU TIÊN (luật rollback của repo) ──────────────
  const vai = (session.user as { role?: string }).role;
  const cacVai = (session.user as { roles?: string[] }).roles ?? [];
  if (vai !== "SUPER_ADMIN" && !cacVai.includes("SUPER_ADMIN")) {
    return { ok: false as const, error: "Chỉ Quản trị tối cao xoá được đơn" };
  }
  const lyDo = (input.lyDo ?? "").trim();
  if (lyDo.length < 10) {
    return { ok: false as const, error: "Lý do xoá tối thiểu 10 ký tự" };
  }

  const actor = await resolveActor(session.user.id as string);
  const sdb = scopedDb(actor);
  const order = await sdb.order.findUnique({
    where: { id: input.orderId },
    select: { id: true, code: true, status: true, centerId: true, totalAmount: true, orgUnitId: true },
  });
  if (!order) return { ok: false as const, error: "Không tìm thấy đơn" };
  // `scopedDb` KHÔNG che write — tự gác phạm vi, đúng luật #5 của CLAUDE.md.
  if (!passesScope("Order", order, actor)) {
    return { ok: false as const, error: "Đơn không thuộc phạm vi của bạn" };
  }

  // Đếm MỌI dấu vết. `Payment` đếm CẢ dòng đã soft-delete — một khoản xoá mềm vẫn là
  // lịch sử tiền. Dùng `db` trần ở đây là cố ý: đây là phép ĐẾM ĐỂ CHẶN, lọc theo phạm
  // vi sẽ làm đúng dấu vết cần thấy biến mất và cổng hoá ra mở toang (cùng bài học với
  // `lib/payments/method-lookup.ts`). Phạm vi đã gác bằng `passesScope` ngay trên.
  // Đếm dấu vết qua `lib/orders/xoa-don-db.ts` — phép đếm ĐỂ CHẶN phải KHÔNG-SCOPE,
  // và `db` trần bị ESLint cấm trong `app/(admin)/**`. Phạm vi cơ sở đã gác ở trên
  // bằng `passesScope` trên chính đơn.
  const { phieuIds, ...dauVet } = await demDauVetDon(order.id, order.status);
  const lyDoChan = lyDoKhongXoaDuoc(dauVet);
 if (lyDoChan) return { ok: false as const, error: lyDoChan };

  // Ghi nhật ký TRƯỚC khi xoá — sau khi xoá thì không còn gì để chụp lại. `AuditLog` không
  // có khoá ngoại tới `Order` nên dòng này sống sót, đúng ý: nó là dấu vết duy nhất còn lại.
  const a = getAuditActor(session);
  await writeAudit({
    actor: { id: a.actorId, name: a.actorName },
    module: "orders",
    entityType: "Order",
    entityId: order.id,
    action: "DELETE",
    oldValues: { code: order.code, status: order.status, totalAmount: order.totalAmount },
    reason: lyDo,
    orgUnitId: order.orgUnitId ?? null,
    ...(await getRequestMetadata()),
  });

  // Xoá con TRƯỚC rồi mới tới đơn: 8/10 bảng con khai `onDelete: Restrict`, nên thứ tự
  // này là bắt buộc chứ không phải cẩn thận thừa. Mọi bảng giữ TIỀN đã được chứng minh
  // rỗng ở cổng trên; ở đây chỉ còn các bảng mô tả.
  await xoaDonVaCon(order.id, phieuIds);
  revalidatePath("/orders");
  revalidatePath("/cong-no");
  return { ok: true as const, code: order.code };
}
