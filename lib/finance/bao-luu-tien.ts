// lib/finance/bao-luu-tien.ts — BẢO LƯU: phần chạm DB. PHIÊN F2 · US-18 AC2.
//
// ─────────────────────────────────────────────────────────────────────────────
// BA VIỆC, VÀ CHỈ BA VIỆC
//
//   1. `apDungDoiHanBaoLuu` — dời hạn các đợt CHƯA TỚI HẠN của con vừa bảo lưu.
//   2. `locDotCuaConDangBaoLuu` — nói cho người đọc biết đợt nào thuộc con đang bảo lưu, để
//      cron đối soát KHÔNG báo nó quá hạn.
//   3. `docBaoLuuCuaDon` — cho màn công nợ theo con hiện nhãn "đang bảo lưu tới …".
//
// KHÔNG có `baoLuuMotCon` / `hocLaiMotCon`. Đó là chủ đích: cửa bảo lưu ĐÃ CÓ ba cái
// (`reserveStudentAction` · `approveReserveRequest` · `resumeStudentReserveAction`) và
// chúng làm đúng phần học vụ. Thêm cửa thứ tư ở đây là hai nguồn sự thật cho một trạng
// thái — lý lẽ đầy đủ ở đầu `lib/finance/bao-luu-con.ts`.
//
// ⚠️ **HỌC LẠI KHÔNG CÓ PHÉP GHI TIỀN NÀO.** Nghe như thiếu sót nên nói rõ: hạn đã dời thì
// GIỮ NGUYÊN sau khi học lại (buổi học cũng dịch đi đúng quãng ấy — AC4 nói *"bảng giá các
// buổi còn lại giữ nguyên"*, không nói dời hạn ngược). Còn việc "thôi tha quá hạn" thì tự
// hết hiệu lực vì `StudentReserve.isActive` thành `false` — nguồn sự thật đổi, mọi người
// đọc đều thấy ngay, không ai phải ghi gì. Đây là cái lợi thẳng của việc KHÔNG chép trạng
// thái xuống `OrderItem`.
import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit, type AuditActor } from "@/lib/audit/audit-log";
import { ghiTienChoDon, type KetQuaGhi } from "@/lib/finance/ghi-tien-don";
import { laThuTienLinhHoatBat } from "@/lib/finance/feature";
import {
  coViecPhaiLam,
  dongNaoDangBaoLuu,
  keHoachDoiHan,
  type BaoLuuCuaDong,
  type DotDeDoiHan,
} from "@/lib/finance/bao-luu-con";

type Tx = Prisma.TransactionClient;
type DocClient = Pick<typeof db, "orderItem" | "studentReserve">;

/** Dòng hàng + đường nối tới học viên. `null` = dòng chưa nối ghi danh. */
type DongCoHocVien = {
  orderItemId: string;
  orderId: string;
  enrollmentId: string | null;
  studentId: string | null;
};

/**
 * Các lượt bảo lưu CÒN HIỆU LỰC của những học viên nói trên.
 *
 * ⚠️ Điều kiện `isActive: true` **và** `endedAt: null` — hai vế, cùng cách `findExpiredReserves`
 * hỏi (`lib/students/reserve-service.ts`). `isActive` là cột phi chuẩn hoá ("denormalised flag
 * (= endedAt is null)") nên về lý nó dư, nhưng nó là cột CÓ CHỈ MỤC (`[studentId, isActive]`)
 * và cột kia là thứ đúng theo định nghĩa. Hỏi cả hai thì nhanh mà không phụ thuộc vào việc
 * cờ phi chuẩn hoá có bị lệch hay không.
 */
async function docLuotBaoLuu(client: DocClient, studentIds: readonly string[]) {
  if (studentIds.length === 0) return [];
  return client.studentReserve.findMany({
    where: { studentId: { in: [...studentIds] }, isActive: true, endedAt: null },
    select: {
      id: true,
      studentId: true,
      enrollmentId: true,
      startedAt: true,
      expectedEndAt: true,
    },
  });
}

async function docDongCoHocVien(
  client: DocClient,
  where: Prisma.OrderItemWhereInput,
): Promise<DongCoHocVien[]> {
  const rows = await client.orderItem.findMany({
    where,
    select: {
      id: true,
      orderId: true,
      enrollmentId: true,
      enrollment: { select: { studentId: true } },
    },
  });
  return rows.map((r) => ({
    orderItemId: r.id,
    orderId: r.orderId,
    enrollmentId: r.enrollmentId,
    studentId: r.enrollment?.studentId ?? null,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// 1 · ÁP DỜI HẠN CHO MỘT LƯỢT BẢO LƯU
// ─────────────────────────────────────────────────────────────────────────────

export type KetQuaDoiHan = {
  /** Số ngày bảo lưu đã dùng để dời. `0` = lượt bảo lưu không khai ngày quay lại. */
  soNgay: number;
  /** Số đợt thật sự đã dời hạn. */
  soDotDaDoi: number;
  /** Các đơn đã chạm (để `revalidatePath`). */
  donDaCham: string[];
  /** Đơn bị BỎ QUA vì cơ sở chưa bật cờ thu học phí linh hoạt. */
  donCoChuaBatCo: number;
};

/**
 * Dời hạn các đợt CHƯA TỚI HẠN của con vừa bảo lưu (US-18 AC2).
 *
 * Gọi SAU khi lượt bảo lưu đã commit. **An toàn khi gọi lại**: khoá chống dời hai lần là
 * `PaymentRequest.pauseShiftReserveId === reserveId` (xem `keHoachDoiHan`), nên bấm lại /
 * chạy lại không làm hạn trôi thêm.
 *
 * ⚠️ **Vì sao là một lượt GHI RIÊNG, không nằm trong transaction bảo lưu:** mọi phép ghi lên
 * sổ tiền của đơn phải đi qua `ghiTienChoDon` (khoá advisory theo `orderId`), và một lượt bảo
 * lưu có thể chạm NHIỀU đơn — lồng nhiều khoá đơn vào transaction học vụ là mời deadlock.
 *
 * ⚠️ **Hỏng nửa đường thì hỏng VỀ PHÍA AN TOÀN.** Bảo lưu đã commit mà phép dời hạn hỏng thì
 * hạn giữ nguyên — và con vẫn KHÔNG bị báo quá hạn, vì phép tha quá hạn đọc `StudentReserve`
 * chứ không đọc kết quả của hàm này (`locDotCuaConDangBaoLuu`). Đây là lý do chính để KHÔNG
 * chép trạng thái bảo lưu xuống sổ tiền: nếu có chép, một lượt ghi hỏng sẽ gỡ luôn phép tha.
 */
export async function apDungDoiHanBaoLuu(input: {
  reserveId: string;
  actor: AuditActor;
  /** Thời điểm coi là "bây giờ" khi hỏi hạn đã qua chưa. Luật 19 — test phải truyền được. */
  now?: Date;
}): Promise<KetQuaGhi<KetQuaDoiHan>> {
  const reserve = await db.studentReserve.findFirst({
    where: { id: input.reserveId, isActive: true, endedAt: null },
    select: {
      id: true,
      studentId: true,
      enrollmentId: true,
      startedAt: true,
      expectedEndAt: true,
    },
  });
  if (!reserve) {
    return { ok: false as const, error: "Lượt bảo lưu không còn hiệu lực" };
  }

  // Dòng hàng của CHÍNH học viên ấy.
  //
  // ⚠️ Mệnh đề `enrollmentId` dưới đây là phép **THU HẸP TRUY VẤN**, KHÔNG phải cổng — đo
  // bằng phép cấy (gỡ nó ra: **0 ca test đỏ**), vì `dongNaoDangBaoLuu` đã lọc đúng vế ấy.
  // Nó ở đây để không nạp mọi dòng hàng của một học viên học nhiều khoá khi lượt bảo lưu chỉ
  // nhắm một ghi danh. Gỡ nó không sinh lỗi; SỬA nó cho sai lại thì cũng không ca nào đỏ, nên
  // đừng đọc nó như một khoá an toàn: khoá thật nằm ở `dongNaoDangBaoLuu` (ca `[BLC-13]`).
  const dong = await docDongCoHocVien(db, {
    enrollment: { studentId: reserve.studentId },
    ...(reserve.enrollmentId ? { enrollmentId: reserve.enrollmentId } : {}),
    order: { deletedAt: null },
  });

  const banDo = dongNaoDangBaoLuu({ dong, luot: [reserve] });
  const theoDon = new Map<string, string[]>();
  for (const d of dong) {
    if (!banDo.has(d.orderItemId)) continue;
    theoDon.set(d.orderId, [...(theoDon.get(d.orderId) ?? []), d.orderItemId]);
  }

  const ra: KetQuaDoiHan = {
    soNgay: 0,
    soDotDaDoi: 0,
    donDaCham: [],
    donCoChuaBatCo: 0,
  };

  for (const [orderId, orderItemIds] of theoDon) {
    const don = await db.order.findUnique({
      where: { id: orderId },
      select: { orgUnitId: true },
    });
    // Cờ theo CƠ SỞ (luật chung của mọi phiên): cờ tắt ⇒ màn + đường cũ y nguyên, kể cả
    // đường này. Bảo lưu vẫn chạy bình thường, chỉ không có phần dời hạn.
    if (!(await laThuTienLinhHoatBat(don?.orgUnitId ?? null))) {
      ra.donCoChuaBatCo++;
      continue;
    }

    const kq = await ghiTienChoDon(orderId, async (tx) => {
      const dot = await docDotDeDoiHan(tx, orderItemIds);
      const ke = keHoachDoiHan({
        dot,
        startedAt: reserve.startedAt,
        expectedEndAt: reserve.expectedEndAt,
        reserveId: reserve.id,
        moc: input.now ?? reserve.startedAt,
      });

      // ── HẾT CỔNG. Từ đây là phép ghi. ────────────────────────────────────
      // `coViecPhaiLam` chứ không phải `ke.doi.length > 0`: bảo lưu KHÔNG khai ngày quay
      // lại vẫn cho ra danh sách `doi` đầy đủ với `hanMoi === hanCu`, và ghi nó là để lại
      // một dòng nhật ký nói rằng có dời trong khi không dời gì.
      if (!coViecPhaiLam(ke)) return { soNgay: ke.soNgay, soDot: 0 };

      for (const d of ke.doi) {
        await tx.paymentRequest.update({
          where: { id: d.id },
          data: {
            dueDate: d.hanMoi,
            pauseShiftReserveId: reserve.id,
            pauseShiftDays: d.tongNgayDaDoi,
          },
        });
      }

      await writeAudit({
        tx,
        actor: input.actor,
        module: "finance",
        entityType: "Order",
        entityId: orderId,
        action: "DOI_HAN_DOT_BAO_LUU",
        changedFields: ["dueDate"],
        // Hạn CŨ của từng đợt nằm ở đây, và đây là chỗ DUY NHẤT nhớ nó — cột trên phiếu chỉ
        // giữ TỔNG số ngày đã dời, không giữ dãy mốc. Thiếu vế này thì câu hỏi "hạn gốc của
        // đợt 2 là ngày nào" không còn ai trả lời được.
        oldValues: {
          reserveId: reserve.id,
          dot: ke.doi.map((d) => ({ id: d.id, soDot: d.installmentNo, hanCu: d.hanCu.toISOString() })),
        },
        newValues: {
          soNgay: ke.soNgay,
          dot: ke.doi.map((d) => ({ id: d.id, soDot: d.installmentNo, hanMoi: d.hanMoi.toISOString() })),
          boQua: ke.boQua,
        },
        reason: `Bảo lưu ${ke.soNgay} ngày — dời hạn ${ke.doi.length} đợt chưa tới hạn`,
        orgUnitId: don?.orgUnitId ?? null,
      });

      return { soNgay: ke.soNgay, soDot: ke.doi.length };
    });

    ra.soNgay = kq.soNgay;
    ra.soDotDaDoi += kq.soDot;
    if (kq.soDot > 0) ra.donDaCham.push(orderId);
  }

  return { ok: true as const, ...ra };
}

async function docDotDeDoiHan(tx: Tx, orderItemIds: readonly string[]): Promise<DotDeDoiHan[]> {
  const rows = await tx.paymentRequest.findMany({
    where: { orderItemId: { in: [...orderItemIds] } },
    select: {
      id: true,
      installmentNo: true,
      dueDate: true,
      status: true,
      pauseShiftReserveId: true,
      pauseShiftDays: true,
    },
    orderBy: { installmentNo: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    installmentNo: r.installmentNo,
    dueDate: r.dueDate,
    status: r.status,
    pauseShiftReserveId: r.pauseShiftReserveId,
    pauseShiftDays: r.pauseShiftDays,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// 2 · ĐỢT NÀO ĐƯỢC THA QUÁ HẠN
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Trong một lô phiếu thu, phiếu nào thuộc con ĐANG BẢO LƯU (US-18 AC2 vế hai:
 * *"không có đợt nào của con đó thành QUA_HAN trong thời gian PAUSED"*).
 *
 * Trả về tập **`PaymentRequest.id` phải LOẠI** khỏi danh sách quá hạn.
 *
 * ⚠️ Hỏi theo LÔ, một câu cho mọi phiếu (`orderItemId IN (…)`), không hỏi từng phiếu một.
 * Repo đã trả giá cho hình dạng N+1 đúng ở đường tiền: `goiYDon` trong
 * `bao-cao-doi-soat-tien.ts` tra một câu cho từng giao dịch, và bản sao cùng hình dạng ở
 * `backfill-orderitem-dry.ts` CHẾT THẬT với `P2028` ngay lượt chạy prod đầu (trần
 * transaction tương tác của Prisma là 5 giây).
 *
 * ⚠️ Phiếu `orderItemId = NULL` (luồng CŨ, "thu toàn đơn") KHÔNG bao giờ nằm trong tập loại:
 * nó không thuộc con nào nên không suy được con nào đang bảo lưu. Đúng chiều fail-closed —
 * nhầm thành "đang bảo lưu" là tha quá hạn cho một khoản không ai xin tha.
 */
export async function locDotCuaConDangBaoLuu(
  client: DocClient,
  phieu: readonly { id: string; orderItemId: string | null }[],
): Promise<Set<string>> {
  const orderItemIds = [...new Set(phieu.map((p) => p.orderItemId).filter((x): x is string => !!x))];
  if (orderItemIds.length === 0) return new Set();

  const dong = await docDongCoHocVien(client, { id: { in: orderItemIds } });
  const studentIds = [...new Set(dong.map((d) => d.studentId).filter((x): x is string => !!x))];
  const luot = await docLuotBaoLuu(client, studentIds);
  if (luot.length === 0) return new Set();

  const banDo = dongNaoDangBaoLuu({ dong, luot });
  const loai = new Set<string>();
  for (const p of phieu) {
    if (p.orderItemId && banDo.has(p.orderItemId)) loai.add(p.id);
  }
  return loai;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3 · ĐỌC ĐỂ HIỂN THỊ
// ─────────────────────────────────────────────────────────────────────────────

export type BaoLuuTrenMan = BaoLuuCuaDong & {
  /** Tổng số ngày các đợt của con này đã bị dời vì lượt bảo lưu ĐANG hiệu lực. */
  soNgayDaDoiHan: number | null;
};

/**
 * Con nào của đơn đang bảo lưu, và hạn đợt đã dời bao nhiêu ngày — cho màn công nợ theo con.
 *
 * ⚠️ CỐ Ý không nhồi vào `docSoTheoCon`. Hàm đó chạy TRONG transaction của mọi phép ghi tiền
 * (`ghiTienChoDon`), nên mỗi câu tra thêm ở đó là thêm thời gian nằm dưới khoá đơn cho một
 * thông tin mà không phép ghi nào cần. Màn hình tự hỏi câu này một lần.
 */
export async function docBaoLuuCuaDon(orderId: string): Promise<Map<string, BaoLuuTrenMan>> {
  const dong = await docDongCoHocVien(db, { orderId });
  const studentIds = [...new Set(dong.map((d) => d.studentId).filter((x): x is string => !!x))];
  const luot = await docLuotBaoLuu(db, studentIds);
  const banDo = dongNaoDangBaoLuu({ dong, luot });
  if (banDo.size === 0) return new Map();

  // Số ngày đã dời: lấy trên ĐỢT, theo đúng lượt bảo lưu đang hiệu lực. Không suy lại từ
  // `startedAt`/`expectedEndAt` — hai số ấy trả lời "bảo lưu bao lâu", còn câu màn hình cần
  // là "hạn đã bị dời bao nhiêu", và chúng KHÁC nhau khi phép dời chưa chạy (hỏng nửa
  // đường) hoặc khi không đợt nào đủ điều kiện dời.
  const dot = await db.paymentRequest.findMany({
    where: {
      orderItemId: { in: [...banDo.keys()] },
      pauseShiftReserveId: { in: [...new Set([...banDo.values()].map((b) => b.reserveId))] },
    },
    select: { orderItemId: true, pauseShiftDays: true },
  });
  const ngayTheoDong = new Map<string, number>();
  for (const d of dot) {
    if (!d.orderItemId) continue;
    ngayTheoDong.set(d.orderItemId, Math.max(ngayTheoDong.get(d.orderItemId) ?? 0, d.pauseShiftDays ?? 0));
  }

  const ra = new Map<string, BaoLuuTrenMan>();
  for (const [orderItemId, b] of banDo) {
    ra.set(orderItemId, { ...b, soNgayDaDoiHan: ngayTheoDong.get(orderItemId) ?? null });
  }
  return ra;
}
