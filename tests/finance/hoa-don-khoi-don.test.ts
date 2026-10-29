// Ca [KHD-DB-*] — loader khối "Hoá đơn điện tử" của trang chi tiết đơn trên Postgres THẬT (GĐ 7,
// docs/ke-toan-hoa-don/PLAN.md §8).
//
// Thứ test thuần KHÔNG nói được, đo ở đây:
//   · đọc LỒNG dưới Order: bản `THAY_THE` + dòng nối `hieuLuc=false` KHÔNG khoá khoản (khoản về "chờ");
//   · lượt gửi MỚI NHẤT ghép đúng dòng `EmailQueue` (trạng thái hàng đợi thắng lượt gửi chưa cập nhật);
//   · nút tải hỏi ĐÚNG hai cổng của route — `passesScope("HoaDonDienTu")` (tiền tố `payments:`) và
//     `duocTaiBanHoaDon` — trên Actor thật chứ không phải cờ gõ tay (luật 9: cổng phải được cho ăn bằng
//     đường THẬT cho nó ăn);
//   · đơn ngoài phạm vi `orders:` ⇒ `null`.
// Bộ này KHÔNG gọi `resetDb()` — dọn đúng id của mình (DB dùng chung với các bộ tài chính khác).
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/finance/hoa-don/kho-tep", async (goc) => ({
  ...(await goc<typeof import("@/lib/finance/hoa-don/kho-tep")>()),
  khoHoaDonDaCauHinh: () => true,
}));

import type { Actor, PermEntry } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { napKhoiHoaDonDon } from "@/lib/finance/hoa-don/nap-khoi-hoa-don-don";

if (!RUN_DB_TESTS) console.warn(`[KHD-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-khd-";
const CS = `${T}center`;
const CS_KHAC = `${T}center-khac`;
const DON = `${T}don`;
const P1 = `${T}p1`;
const P2 = `${T}p2`;
const HD = `${T}hd`;
const HD_CU = `${T}hd-cu`;
const Q = `${T}queue`;
const SALE = `${T}sale`;
const EMAIL = "phuhuynh.khoidon@example.com";
const DA_XAC_NHAN_KHOAN = "CONFIRMED"; // hằng — lưới `truc-a` quét cả tệp test

const quyen = (action: string, centerScope: PermEntry["centerScope"]): PermEntry => ({
  action,
  scopeType: "CENTER",
  orgUnitId: `${T}ou`,
  roleCode: "CENTER_SALES_CSM",
  centerScope,
});

/** Actor cấp cơ sở — `orders:view` tại CS; `payments:*` tuỳ ca (không có ⇒ rơi về `visibleCenterIds`). */
const actor = (permissions: PermEntry[]): Actor => ({
  userId: SALE,
  isSuperAdmin: false,
  isHoLevel: false,
  orgRoles: [],
  permissions: [quyen("orders:view", [CS]), ...permissions],
  visibleCenterIds: [CS],
  visibleOrgUnitIds: [],
  grantsAllow: new Set<string>(),
  assignedClassIds: new Set<string>(),
});

async function don() {
  await db.emailQueue.deleteMany({ where: { id: Q } });
  await db.hoaDonDienTu.deleteMany({ where: { orderId: DON } });
  await db.payment.deleteMany({ where: { orderId: DON } });
  await db.order.deleteMany({ where: { id: DON } });
  await db.center.deleteMany({ where: { id: { in: [CS, CS_KHAC] } } });
}

async function dungFixture() {
  await don();
  await db.center.create({ data: { id: CS, name: "Cơ sở fixture KHD", slug: `${T}co-so`, address: "211 Nguyễn Hữu Thọ" } });
  await db.center.create({ data: { id: CS_KHAC, name: "Cơ sở khác KHD", slug: `${T}co-so-khac`, address: "114 Hoàng Diệu" } });
  await db.order.create({
    data: {
      id: DON,
      code: "ORD-269926-000701",
      type: "COURSE",
      status: "CONFIRMED",
      customerName: "PH KHD",
      customerPhone: "0999000777",
      customerEmail: EMAIL,
      totalAmount: 5_000_000,
      centerId: CS,
    },
  });
  for (const [id, amount, ngay] of [
    [P1, 3_000_000, "2699-09-20T03:00:00Z"],
    [P2, 2_000_000, "2699-09-25T03:00:00Z"],
  ] as const) {
    await db.payment.create({
      data: {
        id,
        orderId: DON,
        amount,
        method: "CASH",
        paidDate: new Date(ngay),
        saleStatus: "RECORDED",
        accountantStatus: DA_XAC_NHAN_KHOAN,
        centerId: CS,
      },
    });
  }
  // P1 — hoá đơn ĐÃ XÁC NHẬN, lượt gửi còn DANG_GUI nhưng hàng đợi đã SENT.
  await db.emailQueue.create({
    data: {
      id: Q,
      toEmail: EMAIL,
      payload: {},
      status: "SENT",
      attempts: 1,
      sentAt: new Date("2699-09-21T02:12:00Z"),
      contextType: "HoaDonGuiEmail",
      contextId: `${T}gui`,
    },
  });
  await db.hoaDonDienTu.create({
    data: {
      id: HD,
      orderId: DON,
      centerId: CS,
      trangThai: "DA_XAC_NHAN",
      kyHieu: "1C99TSR",
      soHoaDon: "701",
      ngayPhatHanh: new Date("2699-09-21T00:00:00Z"),
      tepPdfKey: `hoa-don/KHD/${DON}/u.pdf`,
      tepPdfTen: "hd-701.pdf",
      tepXmlKey: `hoa-don/KHD/${DON}/u.xml`,
      tepXmlTen: "hd-701.xml",
      emailNhan: EMAIL,
      tongTien: 3_000_000,
      taoBoiId: `${T}ke-toan`,
      khoan: { create: [{ paymentId: P1, soTien: 3_000_000 }] },
      guiEmail: { create: [{ lanGui: 1, toi: EMAIL, trangThai: "DANG_GUI", emailQueueId: Q }] },
    },
  });
  // P2 — chỉ có một bản ĐÃ BỊ THAY (dòng nối hieuLuc=false) ⇒ khoản phải về "chờ".
  await db.hoaDonDienTu.create({
    data: {
      id: HD_CU,
      orderId: DON,
      centerId: CS,
      trangThai: "THAY_THE",
      huyLyDo: "Kế toán huỷ để xuất lại",
      huyBoiId: `${T}ke-toan`,
      huyLuc: new Date("2699-09-22T00:00:00Z"),
      kyHieu: "1C99TSR",
      soHoaDon: "700",
      tepPdfKey: `hoa-don/KHD/${DON}/cu.pdf`,
      tongTien: 2_000_000,
      taoBoiId: `${T}ke-toan`,
      khoan: { create: [{ paymentId: P2, soTien: 2_000_000, hieuLuc: false }] },
    },
  });
}

describe.skipIf(!RUN_DB_TESTS)("[KHD-DB] khối Hoá đơn trên trang đơn — Postgres thật", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[KHD-DB-01] sale có PII: bản đã xác nhận tải được + email ĐÃ GỬI theo hàng đợi; bản bị thay KHÔNG khoá khoản", async () => {
    const k = await napKhoiHoaDonDon(actor([]), { orderId: DON, xemPii: true, keToan: false });
    expect(k).not.toBeNull();
    expect(k!.dong.map((d) => d.trangThai)).toEqual(["DA_XUAT", "CHO"]);
    const [daXuat, cho] = k!.dong;
    expect(daXuat).toMatchObject({
      soTien: 3_000_000,
      soHoaDon: "1C99TSR · số 701",
      taiPdf: `/payments/hoa-don/${HD}/tai-ve?loai=pdf`,
      taiXml: `/payments/hoa-don/${HD}/tai-ve?loai=xml`,
      lyDoKhongTai: null,
    });
    expect(daXuat!.email).toMatchObject({ loai: "DA_GUI", nhan: `Đã gửi tới ${EMAIL} lúc 09:12 21/09/2699` });
    expect(cho).toMatchObject({ soTien: 2_000_000, soHoaDon: null, taiPdf: null });
    // GĐ 8 — khoản từng nằm trên hoá đơn ĐÃ HUỶ ⇒ dặn sale đừng gửi bản cũ (không kèm lý do huỷ).
    expect(cho!.huyTruoc).toBe("Hoá đơn 1C99TSR-700 đã huỷ ngày 22/09/2699 — đừng gửi bản cũ cho khách, chờ kế toán xuất lại");
    // Không bao giờ lộ khoá tệp (kể cả của bản bị thay).
    expect(JSON.stringify(k)).not.toContain("hoa-don/KHD/");
  });

  it("[KHD-DB-02] quyền `payments:` neo ở cơ sở KHÁC ⇒ route không thấy hoá đơn ⇒ KHÔNG nút, nói lý do", async () => {
    const k = await napKhoiHoaDonDon(actor([quyen("payments:record", [CS_KHAC])]), {
      orderId: DON,
      xemPii: true,
      keToan: false,
    });
    const daXuat = k!.dong.find((d) => d.trangThai === "DA_XUAT")!;
    expect(daXuat).toMatchObject({ taiPdf: null, taiXml: null });
    expect(daXuat.lyDoKhongTai).toMatch(/ngoài phạm vi/);
  });

  it("[KHD-DB-03] thiếu `orders:view-pii` ⇒ email bị che, không nút tải", async () => {
    const k = await napKhoiHoaDonDon(actor([]), { orderId: DON, xemPii: false, keToan: false });
    const json = JSON.stringify(k);
    expect(json).not.toContain(EMAIL);
    const daXuat = k!.dong.find((d) => d.trangThai === "DA_XUAT")!;
    expect(daXuat.email!.nhan).toContain("ph**************@example.com");
    expect(daXuat.taiPdf).toBeNull();
  });

  it("[KHD-DB-04] kế toán của ĐÚNG cơ sở, không PII ⇒ vẫn tải được (nhánh kế toán của route)", async () => {
    const keToan = actor([quyen("payments:confirm", [CS])]);
    const k = await napKhoiHoaDonDon(keToan, { orderId: DON, xemPii: false, keToan: true });
    expect(k!.dong.find((d) => d.trangThai === "DA_XUAT")!.taiPdf).toBe(`/payments/hoa-don/${HD}/tai-ve?loai=pdf`);
    // Đối chứng: cờ `payments:confirm` trần mà KHÔNG neo ở cơ sở này ⇒ không tải.
    const neoCoSoKhac = actor([quyen("payments:confirm", [CS_KHAC]), quyen("payments:record", [CS])]);
    const k2 = await napKhoiHoaDonDon(neoCoSoKhac, { orderId: DON, xemPii: false, keToan: true });
    expect(k2!.dong.find((d) => d.trangThai === "DA_XUAT")!.taiPdf).toBeNull();
  });

  it("[KHD-DB-05] đơn ngoài phạm vi `orders:` ⇒ null (không dựng khối nào)", async () => {
    const ngoai: Actor = { ...actor([]), permissions: [quyen("orders:view", [CS_KHAC])], visibleCenterIds: [CS_KHAC] };
    expect(await napKhoiHoaDonDon(ngoai, { orderId: DON, xemPii: true, keToan: false })).toBeNull();
  });
});
