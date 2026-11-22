import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { SYSTEM_ACTOR } from "@/lib/auth/system-actor";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/db-scope";
import { ngayVN } from "@/lib/format/thoi-gian-vn";
import { doiChieuBong } from "./engine/doi-chieu-bong";
import { phanLoaiNghiaVu, type DongDonNghiaVu } from "./engine/phan-loai-nghia-vu";
import { coSoQuetDuoc, laHubQuetBat } from "./feature";
import { donVaoHangCho, dungHangChoMotDon, giaoDichChuaKhopCuaDon, napNguonHangCho } from "./hang-cho";
import { lapKeHoachDon, type DauVaoKeHoach, type HienCoNghiaVu, type KeHoachDon, type NgoaiLeDangMo } from "./quet-nghia-vu-ke-hoach";
import { guiThongBaoNgoaiLe } from "./ngoai-le-thong-bao-db";
import { ghepLoTheoTang, tickCua, type UngVienQuet } from "./quet-nghia-vu-lo";

// lib/finance/hoa-don/quet-nghia-vu-db.ts — NGƯỜI CHẠY scanner bóng nghĩa vụ hoá đơn (Invoice Hub S8). Pha P2 của cron `hoa-don-misa-doi-soat`.
//
// ─────────────────────────────────────────────────────────────────────────────
// SCANNER NÀY LÀM GÌ, VÀ KHÔNG LÀM GÌ
//
//   LÀM:  với mỗi đơn trong lô — nạp nguồn bằng CHÍNH các câu tra của màn hàng chờ (`napNguonHangCho`), dựng dòng hàng chờ (`dungDongHangCho`) và
//         nghĩa vụ (`phanLoaiNghiaVu`) trên CÙNG dữ liệu, đối chiếu (`doiChieuBong`), lập kế hoạch (`lapKeHoachDon`, thuần) rồi GHI đúng kế hoạch
//         vào bảng chiếu `HoaDonNghiaVu` + hộp thư ngoại lệ `HoaDonNgoaiLe`. Có ngoại lệ mới thì báo kế toán Ở CƠ SỞ ĐÓ.
//   KHÔNG: gọi nhà cung cấp, ký, phát hành, tạo hay sửa `HoaDonDienTu` / `HoaDonKhoan`; ghi `Payment` / `Order` / `PaymentRequest` / bất kỳ bảng tiền
//         nào (TD-02: bảng chiếu không phải sổ tiền thứ ba — file này cũng KHÔNG đọc nó để tính nợ); `publishEvent` (TD-03). Lưới `[QNW-*]` ghim.
//
// ─────────────────────────────────────────────────────────────────────────────
// KHÓA VÀ ĐỒNG THỜI — LỆCH CÓ CHỦ Ý SO VỚI ADR §7.3 (ghi vào ma trận + mô tả PR)
//
//   ADR §7.3 viết: "từ CUT-04 giữ `khoaDonTrongTx` làm câu ĐẦU của transaction". Bản này KHÔNG lấy khoá đó, vì nó nằm trên đường webhook / R7 —
//   lấy nó mỗi 10 phút cho mọi đơn là chen vào đường tiền mà scanner (chỉ ghi bảng chiếu) không cần bảo vệ gì ở đó. Thay vào đó:
//     · plan tính NGOÀI giao dịch từ dữ liệu đọc; đơn không có gì để ghi (trạng thái ổn định — gần như mọi đơn mọi lượt) KHÔNG mở giao dịch, KHÔNG khoá;
//     · đơn có việc ghi: mở giao dịch, lấy khoá tư vấn RIÊNG theo đơn (`hoa-don-quet:<orderId>` — không đụng khoá đơn của đường tiền), ĐỌC LẠI bảng chiếu
//       + ngoại lệ dưới khoá rồi LẬP LẠI kế hoạch với cùng kết quả engine. Hai lượt chạy chồng nhau: lượt sau chờ, đọc thấy dòng của lượt trước, kế hoạch rỗng;
//     · lớp cuối: `UNIQUE(nguonLoai,nguonId)` + `createMany(skipDuplicates)`, chỉ mục từng phần `dedupeKey` (ngoại lệ mở), `updateMany … where phienBan`.
//   Không có khoá cấp LƯỢT CHẠY: khoá phiên (`pg_advisory_lock`) không an toàn qua pooler, khoá giao dịch giữ một kết nối suốt lượt thì tốn pool
//   (`connection_limit` nhỏ). Hệ quả chấp nhận: hai lượt chạy chồng nhau có thể cùng TÍNH một đơn (đọc + engine) — tốn việc, không sai kết quả.
//
// ⚠️ Mọi `create` set `centerId` từ `Order.centerId` (planner ném nếu lệch); mọi `update` chỉ trúng dòng đã nạp theo đơn đó và đã qua kiểm cơ sở của
// planner. `scopedDb` không che write — việc cách ly nằm ở planner (không bao giờ ghi chéo đơn / chéo cơ sở) và được test chéo cơ sở ở `[QND-01b]`.

// ── THAM SỐ VẬN HÀNH (không phải tham số pháp lý — TD-10) ─────────────────────────────────────────────────────────────────────────
/** Cửa sổ "mới đổi": khoản thu / hoá đơn sửa trong N giờ gần nhất là ứng viên tầng 1. Chồng lấn rộng để cron lỡ nhiều lượt vẫn không mất. */
export const CUA_SO_GIO = 72;
/** Dòng chiếu CHƯA ổn định (CHO_XUAT / CHO_QUYET / DANG_XU_LY) quá N phút chưa được quét lại thì vào tầng 2. */
export const KIEM_LAI_PHUT = 60;
const LO_NHIP_TIM = 500;

const TRANG_THAI_CHUA_ON_DINH = ["CHO_XUAT", "CHO_QUYET", "DANG_XU_LY"] as const;
const LY_DO_TU_DONG_DONG = "Điều kiện sinh ngoại lệ đã hết — scanner tự đóng.";

export type KetQuaQuet = {
  /** Số đơn đã tính. */
  don: number;
  tao: number;
  capNhat: number;
  ngoaiLeMo: number;
  ngoaiLeDong: number;
  /** Dòng không tạo được vì thiếu ngày thu. */
  khongTao: number;
  /** `chenhLech` giữa engine và hàng chờ đã thấy ở lượt này (đo độ khớp của CUT-05; đã thành ngoại lệ LECH_SHADOW). */
  lechShadow: number;
  /** Cập nhật bị bỏ vì dòng đã bị đổi bởi ai đó giữa chừng (khoá lạc quan) — lượt sau tính lại. */
  xungDot: number;
  loiDon: number;
  loiMa: string | null;
  dungSom: boolean;
  thongBao: number;
  loiThongBao: number;
  /** Lỗi cấp lượt (đọc lô / nạp nguồn thất bại) — nhãn ngắn, KHÔNG kèm câu lỗi gốc (có thể mang giá trị dữ liệu). */
  loi: string | null;
};

const rong = (): KetQuaQuet => ({
  don: 0, tao: 0, capNhat: 0, ngoaiLeMo: 0, ngoaiLeDong: 0, khongTao: 0, lechShadow: 0, xungDot: 0, loiDon: 0, loiMa: null, dungSom: false, thongBao: 0, loiThongBao: 0, loi: null,
});

const maLoi = (e: unknown): string => {
  const ma = (e as { code?: unknown } | null)?.code;
  if (typeof ma === "string" && /^[A-Z0-9_]{2,12}$/.test(ma)) return ma;
  return e instanceof Error && /^[A-Za-z]{2,40}$/.test(e.name) ? e.name : "LOI";
};

type Tx = Prisma.TransactionClient;

// ── ỨNG VIÊN ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Ba tầng ứng viên (mỗi tầng tối đa 2.000 đơn):
 *   · thayDoi   — khoản thu hoặc hoá đơn đổi trong cửa sổ (kể cả khoản vừa bị xoá mềm: `where` mang khoá `deletedAt` cấp cao nhất nên bộ lọc xoá mềm của `db` không chèn thêm);
 *   · chuaOnDinh — đơn có dòng chiếu CHƯA ổn định mà lần quét cuối quá `KIEM_LAI_PHUT` (quét lại để thấy hoá đơn thay thế, khoản bị từ chối…);
 *   · quetVong  — đơn có khoản thu mà CHƯA có dòng chiếu nào (phủ dữ liệu lịch sử khi vừa bật cờ); hết đơn như vậy thì quét vòng MỌI đơn có khoản thu để
 *                 phát hiện trôi (đường ghi SQL thô không đổi `updatedAt`).
 * Thứ tự/cắt lô ở `chonDonCanQuet` (xoay vòng tất định theo tick — không lưu con trỏ).
 */
export async function docUngVienQuet(now: Date, coSo: readonly string[]): Promise<UngVienQuet> {
  const tu = new Date(now.getTime() - CUA_SO_GIO * 3_600_000);
  const kiemLai = new Date(now.getTime() - KIEM_LAI_PHUT * 60_000);
  const sdb = scopedDb(SYSTEM_ACTOR);
  const [khoan, hoaDon, chuaOnDinh, chuaCoDong] = await Promise.all([
    db.payment.findMany({
      // `deletedAt: undefined` — KHOÁ có mặt ở cấp cao nhất nên `injectSoftDelete` (lib/soft-delete.ts) không chèn `deletedAt: null`, còn Prisma bỏ qua giá trị
      // undefined ⇒ cả khoản đã xoá mềm. Một `OR` lồng nhắc `deletedAt` KHÔNG đủ (bộ lọc chỉ nhìn khoá cấp cao nhất) — `[QND-10]` đã bắt đúng lỗi đó.
      where: { updatedAt: { gte: tu }, deletedAt: undefined, order: { centerId: { in: [...coSo] } } },
      select: { orderId: true },
      distinct: ["orderId"],
      take: 2000,
    }),
    db.hoaDonDienTu.findMany({ where: { updatedAt: { gte: tu }, centerId: { in: [...coSo] } }, select: { orderId: true }, distinct: ["orderId"], take: 2000 }),
    db.hoaDonNghiaVu.findMany({
      where: { trangThai: { in: [...TRANG_THAI_CHUA_ON_DINH] }, quetLanCuoiLuc: { lt: kiemLai }, centerId: { in: [...coSo] } },
      select: { orderId: true },
      distinct: ["orderId"],
      take: 2000,
    }),
    sdb.order.findMany({
      where: { payments: { some: { deletedAt: null } }, hoaDonNghiaVu: { none: {} }, centerId: { in: [...coSo] } },
      select: { id: true },
      orderBy: { id: "asc" },
      take: 2000,
    }),
  ]);
  const quetVong =
    chuaCoDong.length > 0
      ? chuaCoDong.map((o) => o.id)
      : (await sdb.order.findMany({ where: { payments: { some: { deletedAt: null } }, centerId: { in: [...coSo] } }, select: { id: true }, orderBy: { id: "asc" }, take: 2000 })).map((o) => o.id);
  return {
    thayDoi: [...new Set([...khoan.map((p) => p.orderId), ...hoaDon.map((h) => h.orderId)])],
    chuaOnDinh: chuaOnDinh.map((r) => r.orderId),
    quetVong,
  };
}

/** Lô đơn của lượt này: mỗi tầng xoay vòng theo tick, gộp theo ưu tiên (thay đổi → chưa ổn định → quét vòng), trần `TRAN_DON_MOI_LUOT`. */
export async function chonDonCanQuet(now: Date, coSo: readonly string[]): Promise<string[]> {
  return ghepLoTheoTang(await docUngVienQuet(now, coSo), tickCua(now));
}

// ── QUÉT ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

type DauVaoDon = Omit<DauVaoKeHoach, "hienCo" | "ngoaiLeMo" | "ngoaiLeBoQua">;

const CHON_HIEN_CO = {
  id: true, nguonLoai: true, nguonId: true, loai: true, trangThai: true, lyDoCho: true, hoaDonId: true, orderItemId: true,
  sourceHash: true, soTienSnapshot: true, phienBan: true, centerId: true,
} as const;

const sangHienCo = (r: { id: string; nguonLoai: "PAYMENT" | "BILLING"; nguonId: string; loai: HienCoNghiaVu["loai"]; trangThai: HienCoNghiaVu["trangThai"]; lyDoCho: string | null; hoaDonId: string | null; orderItemId: string | null; sourceHash: string; soTienSnapshot: number; phienBan: number; centerId: string }): HienCoNghiaVu => ({ ...r });
const sangNgoaiLeMo = (r: { id: string; dedupeKey: string; trangThai: string; loai: string }): NgoaiLeDangMo => ({ id: r.id, dedupeKey: r.dedupeKey, trangThai: r.trangThai === "DANG_XU_LY" ? "DANG_XU_LY" : "MO", loai: r.loai });

const coViecGhi = (k: KeHoachDon) => k.tao.length + k.capNhat.length + k.ngoaiLeTao.length + k.ngoaiLeDong.length > 0;

type KetQuaGhi = { tao: number; capNhat: number; ngoaiLeMo: number; ngoaiLeDong: number; khongTao: number; xungDot: number; giu: string[] };

/**
 * GHI kế hoạch của MỘT đơn. Giao dịch ngắn: khoá tư vấn riêng → đọc lại dưới khoá → lập lại kế hoạch (cùng engine) → ghi. Từ chối = `throw`
 * (planner ném khi dữ liệu chéo đơn / chéo cơ sở / thiếu lý do) và nó chạy TRƯỚC phép ghi đầu tiên.
 */
async function ghiKeHoach(orderId: string, dauVao: DauVaoDon, now: Date): Promise<KetQuaGhi> {
  return await db.$transaction(
    async (tx: Tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`hoa-don-quet:${orderId}`})::bigint)`;
      const [hienCo, ngoaiLeMo, boQua] = await Promise.all([
        tx.hoaDonNghiaVu.findMany({ where: { orderId }, select: CHON_HIEN_CO }),
        tx.hoaDonNgoaiLe.findMany({ where: { orderId, trangThai: { in: ["MO", "DANG_XU_LY"] } }, select: { id: true, dedupeKey: true, trangThai: true, loai: true } }),
        tx.hoaDonNgoaiLe.findMany({ where: { orderId, trangThai: "BO_QUA_CO_LY_DO" }, select: { dedupeKey: true } }),
      ]);
      const kh = lapKeHoachDon({
        ...dauVao,
        hienCo: hienCo.map(sangHienCo),
        ngoaiLeMo: ngoaiLeMo.map(sangNgoaiLeMo),
        ngoaiLeBoQua: new Set(boQua.map((b) => b.dedupeKey)),
      });
      if (!coViecGhi(kh)) return { tao: 0, capNhat: 0, ngoaiLeMo: 0, ngoaiLeDong: 0, khongTao: kh.khongTao.length, xungDot: 0, giu: kh.giu };

      // 1) Tạo dòng chiếu — khoản GỐC trước, điều chỉnh (trỏ về gốc) sau, để khoá ngoại luôn có đích.
      const goc = kh.tao.filter((t) => t.nghiaVuGocKhoa == null);
      const phuThuoc = kh.tao.filter((t) => t.nghiaVuGocKhoa != null);
      const dongMoi = (t: KeHoachDon["tao"][number], nghiaVuGocId: string | null): Prisma.HoaDonNghiaVuCreateManyInput => ({
        id: randomUUID(),
        centerId: t.centerId,
        orderId: t.orderId,
        orderItemId: t.orderItemId,
        nguonLoai: t.nguonLoai,
        nguonId: t.nguonId,
        loai: t.loai,
        trangThai: t.trangThai,
        lyDoCho: t.lyDoCho,
        ngayPhatSinh: new Date(`${t.ngayPhatSinh}T00:00:00Z`),
        nghiaVuGocId,
        hoaDonId: t.hoaDonId,
        soTienSnapshot: t.soTienSnapshot,
        sourceHash: t.sourceHash,
        quetLanCuoiLuc: now,
        createdAt: now,
      });
      if (goc.length > 0) await tx.hoaDonNghiaVu.createMany({ data: goc.map((t) => dongMoi(t, null)), skipDuplicates: true });
      const sauGoc = goc.length > 0 ? await tx.hoaDonNghiaVu.findMany({ where: { orderId }, select: { id: true, nguonLoai: true, nguonId: true } }) : hienCo;
      const idTheoKhoa = new Map<string, string>(sauGoc.map((r) => [`${r.nguonLoai}:${r.nguonId}`, r.id] as const));
      if (phuThuoc.length > 0) {
        await tx.hoaDonNghiaVu.createMany({ data: phuThuoc.map((t) => dongMoi(t, idTheoKhoa.get(t.nghiaVuGocKhoa!) ?? null)), skipDuplicates: true });
      }
      const idSauTao =
        kh.tao.length > 0
          ? new Map<string, string>((await tx.hoaDonNghiaVu.findMany({ where: { orderId }, select: { id: true, nguonLoai: true, nguonId: true } })).map((r) => [`${r.nguonLoai}:${r.nguonId}`, r.id] as const))
          : idTheoKhoa;

      // 2) Cập nhật — khoá lạc quan theo phienBan; 0 dòng trúng = ai đó đã đổi dòng đó, KHÔNG phải lỗi (lượt sau tính lại).
      let capNhat = 0;
      let xungDot = 0;
      for (const c of kh.capNhat) {
        const r = await tx.hoaDonNghiaVu.updateMany({
          where: { id: c.id, phienBan: c.phienBanCu },
          data: { ...c.data, phienBan: { increment: 1 }, quetLanCuoiLuc: now },
        });
        if (r.count === 1) capNhat += 1;
        else xungDot += 1;
      }

      // 3) Ngoại lệ — mở mới (idempotent theo chỉ mục từng phần `dedupeKey`), đóng cái hết điều kiện.
      let ngoaiLeMoi = 0;
      if (kh.ngoaiLeTao.length > 0) {
        const dong = kh.ngoaiLeTao.map((n) => ({
          id: randomUUID(),
          centerId: n.centerId,
          loai: n.loai,
          muc: n.muc,
          nghiaVuId: n.nghiaVuKhoa ? (idSauTao.get(n.nghiaVuKhoa) ?? null) : null,
          hoaDonId: n.hoaDonId,
          orderId: n.orderId,
          trangThai: "MO",
          dedupeKey: n.dedupeKey,
          createdAt: now,
        }));
        await tx.hoaDonNgoaiLe.createMany({ data: dong, skipDuplicates: true });
        // Bao nhiêu dòng là CỦA LƯỢT NÀY (id sinh ngay trên) — chỗ trùng bị bỏ qua thì không có.
        ngoaiLeMoi = await tx.hoaDonNgoaiLe.count({ where: { id: { in: dong.map((x) => x.id) } } });
      }
      let ngoaiLeDong = 0;
      if (kh.ngoaiLeDong.length > 0) {
        ngoaiLeDong = (
          await tx.hoaDonNgoaiLe.updateMany({
            where: { id: { in: kh.ngoaiLeDong.map((x) => x.id) }, trangThai: "MO" },
            data: { trangThai: "DA_XU_LY", lyDoXuLy: LY_DO_TU_DONG_DONG },
          })
        ).count;
      }
      return { tao: kh.tao.length, capNhat, ngoaiLeMo: ngoaiLeMoi, ngoaiLeDong, khongTao: kh.khongTao.length, xungDot, giu: kh.giu };
    },
    { timeout: 20_000, maxWait: 10_000 },
  );
}

/**
 * Quét một tập đơn (đã chọn lô). `conThoiGian` BẮT BUỘC (luật 7): hết giờ thì dừng SAU đơn hiện tại, không bao giờ giữa một đơn.
 * Đơn lỗi (dữ liệu sai / DB ngắt) chỉ làm hỏng đơn đó — các đơn khác vẫn được quét; lượt sau tính lại từ đầu.
 * `coSoDuocQuet` BẮT BUỘC (luật 7 — mặc định "mọi cơ sở" là đúng cái lỗi thí điểm sinh ra để tránh): đơn của cơ sở ngoài tập này KHÔNG được nạp, không dòng, không ngoại lệ, không chuông,
 * kể cả khi người gọi lỡ đưa id vào (lô đã lọc theo cơ sở từ `docUngVienQuet`; đây là lớp thứ hai).
 */
export async function quetCacDon(input: { orderIds: readonly string[]; now: Date; conThoiGian: () => boolean; coSoDuocQuet: ReadonlySet<string> }): Promise<KetQuaQuet> {
  const kq = rong();
  const ids = [...new Set(input.orderIds)];
  if (ids.length === 0 || input.coSoDuocQuet.size === 0) return kq;

  const nguon = await napNguonHangCho(SYSTEM_ACTOR, { id: { in: ids }, centerId: { in: [...input.coSoDuocQuet] } });
  const sdb = scopedDb(SYSTEM_ACTOR);
  const [items, khoan, dongHienCo, ngoaiLeHienCo, ngoaiLeBoQuaHienCo] = await Promise.all([
    sdb.orderItem.findMany({ where: { orderId: { in: ids } }, select: { id: true, orderId: true, type: true, status: true, usedValue: true } }),
    db.payment.findMany({ where: { orderId: { in: ids } }, select: { id: true, orderId: true, centerId: true } }),
    db.hoaDonNghiaVu.findMany({ where: { orderId: { in: ids } }, select: { ...CHON_HIEN_CO, orderId: true } }),
    db.hoaDonNgoaiLe.findMany({ where: { orderId: { in: ids }, trangThai: { in: ["MO", "DANG_XU_LY"] } }, select: { id: true, dedupeKey: true, trangThai: true, loai: true, orderId: true } }),
    db.hoaDonNgoaiLe.findMany({ where: { orderId: { in: ids }, trangThai: "BO_QUA_CO_LY_DO" }, select: { dedupeKey: true, orderId: true } }),
  ]);
  const theoDon = <T extends { orderId: string | null }>(ds: readonly T[]) => {
    const m = new Map<string, T[]>();
    for (const x of ds) if (x.orderId) m.set(x.orderId, [...(m.get(x.orderId) ?? []), x]);
    return m;
  };
  const itemsTheoDon = theoDon(items);
  const khoanTheoDon = theoDon(khoan);
  const dongTheoDon = theoDon(dongHienCo);
  const nlTheoDon = theoDon(ngoaiLeHienCo);
  const boQuaTheoDon = theoDon(ngoaiLeBoQuaHienCo);
  const giuTatCa: string[] = [];

  for (const d of nguon.don) {
    if (!input.conThoiGian()) {
      kq.dungSom = true;
      break;
    }
    kq.don += 1;
    try {
      const hangCho = dungHangChoMotDon(nguon, d, SYSTEM_ACTOR, { canViewPii: false, gop: [] });
      const dongDon: DongDonNghiaVu[] = (itemsTheoDon.get(d.id) ?? []).map((i) => ({ id: i.id, type: i.type, trangThai: i.status, usedValue: i.usedValue }));
      const engine = phanLoaiNghiaVu({
        don: donVaoHangCho(nguon, d),
        dongDon,
        giaoDich: nguon.giaoDich,
        giaoDichChuaKhop: giaoDichChuaKhopCuaDon(nguon, d),
        // OD-03 (cọc) CHƯA TRẢ LỜI: không có tín hiệu "thu trước" và coi thu trước như học phí — ĐÚNG hành vi của hàng chờ hôm nay, nên engine ≡ hàng chờ.
        thuTruocPaymentIds: new Set<string>(),
        chinhSachThuTruoc: "NHU_HOC_PHI",
        // OD-05 (lập theo hoàn tất / dừng học) CHƯA CHỐT: chỉ nghĩa vụ theo khoản thu.
        cheDo: "THEO_KHOAN_THU",
      });
      const baoCao = doiChieuBong({ engine, hangCho });
      kq.lechShadow += baoCao.chenhLech.length;
      const dauVao: DauVaoDon = {
        orderId: d.id,
        centerId: d.centerId,
        cheDo: "THEO_KHOAN_THU",
        now: input.now,
        engine,
        baoCao,
        ngayThu: new Map(d.payments.map((p) => [p.id, ngayVN(p.paidDate)] as const)),
        khoanKhacCoSo: new Set((khoanTheoDon.get(d.id) ?? []).filter((p) => p.centerId != null && p.centerId !== d.centerId).map((p) => p.id)),
      };
      // Kế hoạch SƠ BỘ ngoài giao dịch: không việc ghi ⇒ không mở giao dịch, không khoá (trạng thái ổn định — gần như mọi đơn mọi lượt).
      const so = lapKeHoachDon({ ...dauVao, hienCo: (dongTheoDon.get(d.id) ?? []).map(sangHienCo), ngoaiLeMo: (nlTheoDon.get(d.id) ?? []).map(sangNgoaiLeMo), ngoaiLeBoQua: new Set((boQuaTheoDon.get(d.id) ?? []).map((b) => b.dedupeKey)) });
      kq.khongTao += so.khongTao.length;
      if (!coViecGhi(so)) {
        giuTatCa.push(...so.giu);
        continue;
      }
      const g = await ghiKeHoach(d.id, dauVao, input.now);
      kq.tao += g.tao;
      kq.capNhat += g.capNhat;
      kq.ngoaiLeMo += g.ngoaiLeMo;
      kq.ngoaiLeDong += g.ngoaiLeDong;
      kq.xungDot += g.xungDot;
      giuTatCa.push(...g.giu);
    } catch (e) {
      kq.loiDon += 1;
      kq.loiMa ??= maLoi(e);
    }
  }

  // Nhịp tim: MỘT câu cho cả dòng đã khớp mà không đổi (chia lô cho an toàn tham số).
  for (let i = 0; i < giuTatCa.length; i += LO_NHIP_TIM) {
    await db.hoaDonNghiaVu.updateMany({ where: { id: { in: giuTatCa.slice(i, i + LO_NHIP_TIM) } }, data: { quetLanCuoiLuc: input.now } });
  }
  return kq;
}

// ── ĐIỂM VÀO CỦA CRON ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Pha P2 của cron: cờ TẮT ⇒ `null` và KHÔNG chạm bảng nào của Hub (kể cả đọc). Bật ⇒ chọn lô, quét, báo chuông. Mọi lỗi cấp lượt được bắt và trả về
 * dạng nhãn ngắn — pha P1 (đối soát bản treo) đã chạy xong từ trước và kết quả của nó không bao giờ bị lỗi ở đây làm mất.
 */
export async function chayQuetBong(input: { now: Date; conThoiGian: () => boolean }): Promise<KetQuaQuet | null> {
  let coSo: string[];
  try {
    if (!(await laHubQuetBat())) return null;
    coSo = await coSoQuetDuoc();
    // Công tắc tổng bật mà CHƯA cơ sở nào được bật thí điểm ⇒ như tắt: không đọc, không ghi bảng nào của Hub.
    if (coSo.length === 0) return null;
  } catch (e) {
    return { ...rong(), loi: `CO:${maLoi(e)}` };
  }
  const kq = rong();
  try {
    const ds = await chonDonCanQuet(input.now, coSo);
    Object.assign(kq, await quetCacDon({ orderIds: ds, now: input.now, conThoiGian: input.conThoiGian, coSoDuocQuet: new Set(coSo) }));
  } catch (e) {
    kq.loi = `QUET:${maLoi(e)}`;
  }
  try {
    Object.assign(kq, await guiThongBaoNgoaiLe(input.now));
  } catch (e) {
    kq.loi ??= `CHUONG:${maLoi(e)}`;
  }
  return kq;
}
