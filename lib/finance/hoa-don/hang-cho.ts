import "server-only";
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
import { chonHoanCuaDon, dieuKienHoanCuaDon, hoanTheoDon, TRANG_THAI_HOAN_CAN_NAP } from "./hoan-tien-don";
import { dungDongHangCho, type DongHangCho, type DonVaoHangCho } from "./dong-hang-cho";
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
  const sdb = scopedDb(actor);
  const boLoc = opts.boLoc ?? null;
  const [don, chuaKhop, misa] = await Promise.all([
    sdb.order.findMany({
      where: {
        ...(opts.orderId ? { id: opts.orderId } : {}),
        ...dieuKienDonHangCho(boLoc),
      },
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
      where: { status: "UNMATCHED" },
      select: { provider: true, amount: true, content: true },
    }),
    // Bước 1 MISA — nút "Phát hành qua MISA" có hay không, hỏi CÙNG lượt (không thêm nhịp tuần tự). Mọi
    // đường dựng dòng (màn, action, route) đi qua đây ⇒ nút và action đọc CÙNG một quyết định.
    cauHinhMisaDong(),
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
  const [giaoDich, daHuy, hangDoi, hoan] = await Promise.all([
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

  // SĐT → số tiền của giao dịch chưa khớp — CÙNG luật bóc với bước chốt (`chua-khop.ts`).
  const chuaKhopCuaSdt = chuaKhopTheoSdt(chuaKhop);

  const khoOk = khoHoaDonDaCauHinh();
  const dong: DongHangCho[] = [];
  let thieuCoSo = 0;
  for (const d of don) {
    const sdt = canonicalPhone(d.customerPhone);
    const r = dungDongHangCho({
      don: { ...d, hoaDonDaHuy: daHuyTheoDon.get(d.id) ?? [], yeuCauHoan: hoanCuaDon.get(d.id) ?? [] },
      giaoDich,
      giaoDichChuaKhop: sdt ? (chuaKhopCuaSdt.get(sdt) ?? []) : [],
      userId: actor.userId,
      coQuyen: coQuyenKeToanTaiCoSo(actor, d.centerId),
      khoOk,
      canViewPii: opts.canViewPii,
      hangDoi,
      gop: opts.gop ?? [],
      misa,
    });
    dong.push(...r.dong);
    thieuCoSo += r.thieuCoSo;
  }
  // Cũ nhất lên trước — lần thu chờ lâu nhất là việc kế toán nên làm trước (khuôn /orders/duyet).
  dong.sort((a, b) => (a.ngayThu === b.ngayThu ? a.key.localeCompare(b.key) : a.ngayThu.localeCompare(b.ngayThu)));
  if (!boLoc) return { dong, thieuCoSo, khoOk };
  // Câu tra lọc tới mức ĐƠN; một đơn có thể giữ hoá đơn của nhiều tháng ⇒ cắt thêm ở mức DÒNG, cùng luật.
  const thangTheoHoaDon = new Map(don.flatMap((d) => d.hoaDonDienTu.map((h) => [h.id, thangCuaHoaDon(h)] as const)));
  return { dong: giuDongTheoThang(dong, thangTheoHoaDon, boLoc.thang), thieuCoSo, khoOk };
}

/**
 * Bước 1 MISA (30/09) — cấu hình nút "Phát hành qua MISA" cho dòng: CẢ công tắc (màn + `hoaDon.misaPhatHanh`)
 * VÀ cổng đã cấu hình (`layCongHoaDon()`). Thiếu một ⇒ `null` ⇒ nút không hiện.
 */
export async function cauHinhMisaDong(): Promise<CauHinhMisaDong | null> {
  if (!(await laMisaPhatHanhBat())) return null;
  const cong = layCongHoaDon();
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
 * `null` = không thấy / nháp (ngăn không lọc tháng).
 */
export async function thangCuaHoaDonTrongTamNhin(actor: Actor, hoaDonId: string): Promise<string | null> {
  const hd = await scopedDb(actor).hoaDonDienTu.findUnique({
    where: { id: hoaDonId },
    select: { trangThai: true, ngayPhatHanh: true, xacNhanLuc: true, createdAt: true },
  });
  return hd ? thangCuaHoaDon(hd) : null;
}
