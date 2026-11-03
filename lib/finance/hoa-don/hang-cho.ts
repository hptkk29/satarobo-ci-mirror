import "server-only";
import type { Prisma } from "@prisma/client";
import type { Actor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { canonicalPhone } from "@/lib/phone";
import { chuaKhopTheoSdt } from "./chua-khop";
import { nguonGiaoDich } from "./nguon-khoan";
import { coQuyenKeToanTaiCoSo, phamViKeToan } from "./quyen";
import { khoHoaDonDaCauHinh } from "./kho-tep";
import { laMisaPhatHanhBat } from "./feature";
import { layCongHoaDon } from "./cong-phat-hanh";
import type { CauHinhMisaDong } from "./nut-phat-hanh-misa";
import type { NhaCungCapApi } from "./phap-nhan";
import { chonHoanCuaDon, dieuKienHoanCuaDon, hoanTheoDon, TRANG_THAI_HOAN_CAN_NAP } from "./hoan-tien-don";
import { dungDongHangCho, type DongHangCho, type DonVaoHangCho } from "./dong-hang-cho";
import { soSanhDongMoiTruoc } from "./ngan-hang-cho";
import { docCauHinhDangBat } from "./cau-hinh-co-so-db";
import { ngayVN } from "@/lib/format/thoi-gian-vn";
import {
  dieuKienCoSoChon,
  dieuKienDonHangCho,
  giuDongTheoThang,
  thangCuaHoaDon,
  TRANG_THAI_CON_HIEU_LUC,
  type BoLoc,
} from "./loc-hang-cho";

// lib/finance/hoa-don/hang-cho.ts — nạp dữ liệu cho màn Hoá đơn điện tử (PLAN §4, §10). CHỈ ĐỌC.
//
// Hai nhịp, ba câu top-level, KHÔNG N+1 (luật độ sâu tuần tự — `[DST-01]`):
//   nhịp 1 (song song): đơn ứng viên + con lồng · giao dịch CHƯA KHỚP
//   nhịp 2: giao dịch mà khoản + phân bổ của các đơn trỏ tới
// Mọi quyết định dòng/ngăn/nút nằm ở `dong-hang-cho.ts` (thuần, có test).
//
// ⚠️ Khoản đọc LỒNG dưới Order, KHÔNG tra top-level `sdb.payment`: câu top-level lọc từng dòng theo
// `Payment.centerId`, dòng đảo lệch/NULL bị ẩn với kế toán cơ sở ⇒ `soTienRong` thiếu phần trừ ⇒
// xuất hoá đơn cho tiền đã hoàn. Quan hệ lồng KHÔNG được hook xoá mềm ⇒ tự `deletedAt: null`.
// ⚠️ `content` của giao dịch chưa khớp chứa SĐT — chỉ dùng để bóc SĐT ở đây, KHÔNG đưa xuống client.

// Điều kiện ĐƠN của câu tra (khoản ứng viên · hoá đơn còn hiệu lực · lọc cơ sở + tháng) nằm ở
// `loc-hang-cho.ts` — thuần, có test [LHC-*].

export type KetQuaHangCho = {
  dong: DongHangCho[];
  /** Số KHOẢN tiền thật trên đơn chưa có cơ sở — không tạo hoá đơn được, màn phải nói ra. */
  thieuCoSo: number;
  khoOk: boolean;
};

/**
 * Nạp NGUỒN của hàng chờ cho một tập đơn (điều kiện `where` do người gọi đưa): đơn + khoản + phiếu + hoá đơn còn hiệu lực, giao dịch chưa khớp,
 * giao dịch mà khoản trỏ tới, hoá đơn đã huỷ, hàng đợi email, yêu cầu hoàn, cấu hình cơ sở. CHỈ ĐỌC; không quyết định gì về ngăn / dòng.
 *
 * Tách ra từ `napHangChoHoaDon` (Invoice Hub S8) để scanner bóng dùng CHÍNH các câu tra này — hai bên đọc cùng một bộ select thì "lệch" mới
 * nghĩa là lệch về LUẬT, không phải lệch về DỮ LIỆU ĐỌC. Mã di chuyển nguyên, không đổi hành vi (màn và các test hàng chờ giữ nguyên).
 */
export async function napNguonHangCho(actor: Actor, where: Prisma.OrderWhereInput) {
  const sdb = scopedDb(actor);
  const [don, chuaKhop, misa, vin] = await Promise.all([
    sdb.order.findMany({
      where,
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        code: true,
        type: true,
        status: true,
        centerId: true,
        deletedAt: true,
        center: { select: { code: true, name: true } },
        customerName: true,
        customerPhone: true,
        customerEmail: true,
        customerAddress: true,
        customerWard: true,
        customerCity: true,
        customerCccd: true,
        invoiceBuyerName: true,
        invoiceCompanyName: true,
        invoiceTaxCode: true,
        invoiceEmail: true,
        payments: {
          where: { deletedAt: null },
          select: {
            id: true,
            amount: true,
            method: true,
            note: true,
            paymentType: true,
            accountantStatus: true,
            enrollmentId: true,
            orderItemId: true,
            recordedById: true,
            adjustmentOfId: true,
            paidDate: true,
            deletedAt: true,
            createdAt: true,
          },
        },
        paymentRequests: {
          select: {
            id: true,
            orderItemId: true,
            installmentNo: true,
            amountDue: true,
            status: true,
            allocations: {
              select: { bankTransactionId: true, paymentRequestId: true, amount: true, roundingWaived: true },
            },
          },
        },
        hoaDonDienTu: {
          where: { trangThai: { in: [...TRANG_THAI_CON_HIEU_LUC] } },
          select: {
            id: true,
            trangThai: true,
            kyHieu: true,
            soHoaDon: true,
            ngayPhatHanh: true,
            tepPdfKey: true,
            tepPdfTen: true,
            tepXmlTen: true,
            emailNhan: true,
            guiEmailKhach: true,
            xuatTheoSoDaThu: true,
            lyDo: true,
            xacNhanLuc: true,
            // Phép lọc DÒNG theo tháng (`thangCuaHoaDon`) — ngăn "Không xuất" tính theo lúc đánh dấu.
            createdAt: true,
            updatedAt: true,
            // Dấu người mua lúc tải phiếu chờ — dòng nháp cảnh báo khi người mua đã đổi (bam-nguoi-mua.ts).
            nguoiMuaHashLucIn: true,
            khongTrungLyDo: true,
            xuatTheoSoDaThuLyDo: true,
            tongTien: true,
            // Bước 1 MISA (30/09) — nguồn bản + trạng thái máy phát hành (ngăn "Phát hành MISA", nhãn mô phỏng).
            nguonPhatHanh: true,
            // Nhà cung cấp của bản đã phát hành qua API (NULL = bản cũ = MISA) — quyết cổng cho "Kiểm tra lại" / "Phát hành lại".
            nhaCungCapMa: true,
            misaLoiMa: true,
            misaLoiThongDiep: true,
            misaSoLanGui: true,
            misaGuiLuc: true,
            khoan: { where: { hieuLuc: true }, select: { paymentId: true, soTien: true } },
            // GĐ 8 — lượt gửi mới nhất (nút "Gửi lại email" + trạng thái email trên màn kế toán).
            guiEmail: {
              orderBy: { lanGui: "desc" },
              take: 1,
              select: { lanGui: true, toi: true, trangThai: true, loi: true, emailQueueId: true, updatedAt: true },
            },
          },
        },
      },
    }),
    sdb.bankTransaction.findMany({
      // `allocations: none`: giao dịch đã được phiếu gộp tự rót MỘT PHẦN (còn dư, vẫn UNMATCHED) đã có khoản thu của nó — liệt kê cả số tiền ở đây là báo thiếu hoá đơn hai lần.
      where: { status: "UNMATCHED", allocations: { none: {} } },
      select: { provider: true, amount: true, content: true },
    }),
    // Bước 1 MISA — nút "Phát hành qua MISA" có hay không, hỏi CÙNG lượt (không thêm nhịp tuần tự). Mọi
    // đường dựng dòng (màn, action, route) đi qua đây ⇒ nút và action đọc CÙNG một quyết định.
    cauHinhMisaDong(),
    // [02/11/2026] Cổng VIN-HOADON — CÙNG lượt: dòng của pháp nhân VIN đọc cấu hình này, dòng của pháp nhân MISA đọc `misa`.
    cauHinhMisaDong("VIN_HOADON"),
  ]);

  // Nhịp 2 — giao dịch mà khoản (marker) + phân bổ trỏ tới, một câu.
  const btIds = new Set<string>();
  const txnIds = new Set<string>();
  for (const d of don) {
    for (const r of d.paymentRequests) for (const a of r.allocations) btIds.add(a.bankTransactionId);
    for (const p of d.payments) {
      const n = nguonGiaoDich(p.note);
      if (n.loai === "GAN_TAY") btIds.add(n.bankTransactionId);
      else if (n.loai === "WEBHOOK") txnIds.add(n.providerTxnId);
    }
  }
  // GĐ 8 — hoá đơn ĐÃ HUỶ của các đơn trong màn + dòng hàng đợi của lượt gửi, cùng lượt với giao dịch
  // (không thêm nhịp tuần tự). `tepPdfKey` chỉ để suy `coTepPdf` — khoá tệp không rời loader.
  const queueIds = don.flatMap((d) => d.hoaDonDienTu.flatMap((h) => h.guiEmail.map((g) => g.emailQueueId))).filter(
    (id): id is string => id != null,
  );
  // 29/09 (Q1) — yêu cầu hoàn học phí của các đơn trong màn, CÙNG lô (không thêm nhịp tuần tự).
  // `RefundRequest` không auto-scope — tập đơn ở đây đã qua `scopedDb` (câu nhịp 1) nên không nới ai.
  const donIds = don.map((d) => d.id);
  const [giaoDich, daHuy, hangDoi, hoan, cauHinhCoSo] = await Promise.all([
    btIds.size + txnIds.size === 0
      ? []
      : sdb.bankTransaction.findMany({
          where: { OR: [{ id: { in: [...btIds] } }, { providerTxnId: { in: [...txnIds] } }] },
          select: { id: true, provider: true, providerTxnId: true, transferredAt: true, amount: true },
        }),
    don.length === 0
      ? []
      : sdb.hoaDonDienTu.findMany({
          where: { orderId: { in: don.map((d) => d.id) }, trangThai: "THAY_THE" },
          select: {
            id: true,
            orderId: true,
            kyHieu: true,
            soHoaDon: true,
            huyLuc: true,
            huyLyDo: true,
            tepPdfKey: true,
            khoan: { select: { paymentId: true } },
          },
        }),
    queueIds.length === 0
      ? []
      : // CHỈ cột trạng thái — dòng hàng đợi mang địa chỉ + thân email + văn bản lỗi.
        sdb.emailQueue.findMany({
          where: { id: { in: queueIds } },
          select: { id: true, status: true, sentAt: true, attempts: true, maxAttempts: true },
        }),
    donIds.length === 0
      ? []
      : sdb.refundRequest.findMany({
          where: dieuKienHoanCuaDon(donIds, TRANG_THAI_HOAN_CAN_NAP),
          select: chonHoanCuaDon(donIds),
        }),
    // PR2 — cấu hình hoá đơn của các cơ sở có đơn trong màn, CÙNG lô (không thêm nhịp tuần tự).
    docCauHinhDangBat(actor, [...new Set(don.map((d) => d.centerId).filter((c): c is string => Boolean(c)))]),
  ]);
  const hoanCuaDon = hoanTheoDon(hoan);
  const daHuyTheoDon = new Map<string, DonVaoHangCho["hoaDonDaHuy"]>();
  for (const h of daHuy) {
    const ds = daHuyTheoDon.get(h.orderId) ?? [];
    ds.push({
      id: h.id,
      kyHieu: h.kyHieu,
      soHoaDon: h.soHoaDon,
      huyLuc: h.huyLuc,
      huyLyDo: h.huyLyDo,
      coTepPdf: Boolean(h.tepPdfKey),
      paymentIds: h.khoan.map((k) => k.paymentId),
    });
    daHuyTheoDon.set(h.orderId, ds);
  }

  return {
    don,
    giaoDich,
    hangDoi,
    misa,
    vin,
    cauHinhCoSo,
    hoanCuaDon,
    daHuyTheoDon,
    // SĐT → số tiền của giao dịch chưa khớp — CÙNG luật bóc với bước chốt (`chua-khop.ts`).
    chuaKhopCuaSdt: chuaKhopTheoSdt(chuaKhop),
    khoOk: khoHoaDonDaCauHinh(),
  };
}

/** Nguồn đã nạp của hàng chờ — đầu vào của `dungHangChoMotDon`. */
export type NguonHangCho = Awaited<ReturnType<typeof napNguonHangCho>>;
/** Một đơn trong nguồn đã nạp. */
export type DonHangChoDaNap = NguonHangCho["don"][number];

/** Giao dịch ngân hàng CHƯA KHỚP có SĐT trùng SĐT khách của đơn — cùng phép màn dùng; engine S3 cũng cần đúng tập này. */
export function giaoDichChuaKhopCuaDon(nguon: NguonHangCho, d: DonHangChoDaNap): { amount: number }[] {
  const sdt = canonicalPhone(d.customerPhone);
  return sdt ? (nguon.chuaKhopCuaSdt.get(sdt) ?? []) : [];
}

/** Đơn → dạng đầu vào của `dungDongHangCho` (gắn hoá đơn đã huỷ + yêu cầu hoàn của đơn). */
export function donVaoHangCho(nguon: NguonHangCho, d: DonHangChoDaNap): DonVaoHangCho {
  return { ...d, hoaDonDaHuy: nguon.daHuyTheoDon.get(d.id) ?? [], yeuCauHoan: nguon.hoanCuaDon.get(d.id) ?? [] };
}

/** Dựng dòng hàng chờ của MỘT đơn từ nguồn đã nạp. THUẦN theo (nguồn, đơn, actor, tuỳ chọn) — màn và scanner cùng gọi. */
export function dungHangChoMotDon(
  nguon: NguonHangCho,
  d: DonHangChoDaNap,
  actor: Actor,
  opts: { canViewPii: boolean; gop: readonly string[] },
) {
  return dungDongHangCho({
    don: donVaoHangCho(nguon, d),
    giaoDich: nguon.giaoDich,
    giaoDichChuaKhop: giaoDichChuaKhopCuaDon(nguon, d),
    userId: actor.userId,
    coQuyen: coQuyenKeToanTaiCoSo(actor, d.centerId),
    khoOk: nguon.khoOk,
    canViewPii: opts.canViewPii,
    hangDoi: nguon.hangDoi,
    gop: opts.gop,
    misa: nguon.misa,
    vin: nguon.vin,
    cauHinhCoSo: nguon.cauHinhCoSo,
    homNay: ngayVN(new Date()),
  });
}

export async function napHangChoHoaDon(
  actor: Actor,
  /**
   * `orderId` chỉ THU HẸP (route phiếu chờ, action lưu nháp): dòng được dựng bằng CHÍNH hàm màn
   * dùng, nên khoá `?chon=` và tập khoản khớp đúng thứ kế toán đang nhìn — server không nhận
   * danh sách khoản từ client.
   *
   * `boLoc` (cơ sở + tháng — `docBoLoc`) cũng chỉ THU HẸP, ở CÂU TRA: ngăn "Đã xuất" / "Không xuất"
   * theo tháng, ngăn việc tồn thì không (PLAN §10). Không truyền = không lọc (đường thu hẹp theo đơn).
   *
   * `gop` (Q2, 29/09) — tập khoá lần thu kế toán đang GỘP, đọc từ CHÍNH khoá dòng đang chọn (`gopTuKhoa`).
   * Không truyền = không gộp — mặc định fail-closed: dòng gộp không ra ⇒ đường tìm theo khoá gộp không thấy.
   */
  opts: { canViewPii: boolean; orderId?: string; boLoc?: BoLoc | null; gop?: readonly string[] },
): Promise<KetQuaHangCho> {
  const boLoc = opts.boLoc ?? null;
  const nguon = await napNguonHangCho(actor, {
    ...(opts.orderId ? { id: opts.orderId } : {}),
    ...dieuKienDonHangCho(boLoc),
  });
  const dong: DongHangCho[] = [];
  let thieuCoSo = 0;
  for (const d of nguon.don) {
    const r = dungHangChoMotDon(nguon, d, actor, { canViewPii: opts.canViewPii, gop: opts.gop ?? [] });
    dong.push(...r.dong);
    thieuCoSo += r.thieuCoSo;
  }
  const khoOk = nguon.khoOk;
  // Mới nhất lên trước, khoá phụ ổn định — CÙNG luật với `sapXepTrongNgan` (ngan-hang-cho.ts).
  dong.sort(soSanhDongMoiTruoc);
  if (!boLoc) return { dong, thieuCoSo, khoOk };
  // Câu tra lọc tới mức ĐƠN; một đơn có thể giữ hoá đơn của nhiều tháng ⇒ cắt thêm ở mức DÒNG, cùng luật.
  const thangTheoHoaDon = new Map(nguon.don.flatMap((d) => d.hoaDonDienTu.map((h) => [h.id, thangCuaHoaDon(h)] as const)));
  return { dong: giuDongTheoThang(dong, thangTheoHoaDon, boLoc.thang), thieuCoSo, khoOk };
}

/**
 * Bước 1 MISA (30/09) — cấu hình nút "Phát hành qua MISA" cho dòng: CẢ công tắc (màn + `hoaDon.misaPhatHanh`)
 * VÀ cổng đã cấu hình (`layCongHoaDon()`). Thiếu một ⇒ `null` ⇒ nút không hiện.
 */
export async function cauHinhMisaDong(nhaCungCap: NhaCungCapApi = "MISA_MEINVOICE"): Promise<CauHinhMisaDong | null> {
  if (!(await laMisaPhatHanhBat())) return null;
  const cong = layCongHoaDon(nhaCungCap);
  return cong ? { moiTruong: cong.moiTruong } : null;
}

/**
 * Cơ sở cho ô lọc — CHỈ cơ sở trong phạm vi kế toán (`payments:confirm`) của người xem: người kiêm
 * sale CS2 thấy đơn CS2 qua `scopedDb` nhưng không làm hoá đơn ở đó ⇒ không bày CS2 (CLAUDE.md "cho
 * một vai mới vào một màn cũ"). Trang đọc `?coSo=` bằng CÙNG tập (`phamViKeToan` → `docBoLoc`).
 */
export async function napCoSoLocHoaDon(actor: Actor): Promise<{ id: string; ma: string; ten: string }[]> {
  const ds = await scopedDb(actor).center.findMany({
    where: dieuKienCoSoChon(phamViKeToan(actor)),
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true },
  });
  return ds.map((c) => ({ id: c.id, ma: c.code ?? "", ten: c.name }));
}

/**
 * Tháng (sổ) của MỘT hoá đơn trong tầm nhìn — cho đường dẫn `?hoaDon=<id>` (thông báo "email hoá đơn
 * không tới được") không mang tháng: hoá đơn tháng trước phải mở được mà không bắt người ta tự chọn tháng.
 * `null` = không thấy hoá đơn; `thang: null` = nháp (ngăn không lọc tháng). Trả cả CƠ SỞ của hoá đơn: màn không còn
 * chế độ "tất cả cơ sở", nên đường dẫn không mang `?coSo=` phải mở đúng cơ sở của hoá đơn ấy.
 */
export async function thangCuaHoaDonTrongTamNhin(
  actor: Actor,
  hoaDonId: string,
): Promise<{ thang: string | null; coSoId: string } | null> {
  const hd = await scopedDb(actor).hoaDonDienTu.findUnique({
    where: { id: hoaDonId },
    select: { centerId: true, trangThai: true, ngayPhatHanh: true, xacNhanLuc: true, createdAt: true },
  });
  return hd ? { thang: thangCuaHoaDon(hd), coSoId: hd.centerId } : null;
}
