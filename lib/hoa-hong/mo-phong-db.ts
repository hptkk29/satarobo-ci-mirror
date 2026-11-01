// lib/hoa-hong/mo-phong-db.ts — THỬ TÍNH chính sách: phần NẠP dữ liệu (CHỈ ĐỌC) + điều phối. Luật nằm ở `mo-phong.ts`.
//
// Nguồn: docs/source-commission/04 §14, L11 (hàm DB chỉ nạp), 05 PR10 `[NHH-POL-10]`.
//
// ── Vì sao KHÔNG có bản tính thứ hai ───────────────────────────────────────────────────────────────────────────
// Với MỖI khoản thu, thử tính gọi `lapThu` — hàm mà engine thật (`quetKhoan`) dùng để dựng đầu vào: chủ sở hữu · cơ sở · học viên ·
// phân loại NEW/RENEWAL theo LẦN MUA (dòng đơn, không theo đợt thu) · nguồn · người hưởng · cửa sổ 90 ngày · GV Trial đã trả bằng engine
// cũ · VAT. Sau đó `tinhHaiKichBan` chạy `tinhDongChoKhoan` hai lần. Lỗi nào của engine thật (hoặc sửa nào của nó) thấy NGAY ở thử tính;
// ngược lại nếu thử tính lệch engine thì `[NHH-POL-10*]` (so với sổ thật trên cùng khoản) đỏ.
//
// ── Bất biến: KHÔNG ghi gì ──────────────────────────────────────────────────────────────────────────────────────
// Không transaction, không sổ / ô / hàng chờ / kỳ, không audit, không sự kiện, không `StudentTransaction` (phân loại tính lại trong bộ
// nhớ rồi bỏ). `lapThu` chỉ đọc; đây là hàm DUY NHẤT của `quet-khoan.ts` file này được import (lưới `[NHH-POL-10-W*]` ghim).
//
// ── Dữ liệu là của HÔM NAY, không phải ảnh lịch sử ─────────────────────────────────────────────────────────────
// Nguồn lead, người phụ trách, phân loại dùng dữ liệu hiện tại (04 §14) — khoản đã ghi sổ với nguồn cũ có thể khác con số ở đây.
//
// ── Phạm vi ────────────────────────────────────────────────────────────────────────────────────────────────────
// `coSoTrongTamNhin` do Server Action lấy từ tầm nhìn của người bấm (cùng nguồn với `scopedDb`); `pathPhamVi` thu hẹp thêm theo đơn vị.
// Khoản được lọc HAI lần: ở câu truy vấn (theo `Payment.centerId` → đơn → lead) và sau `lapThu` theo cơ sở mà ENGINE quy (`kh.co`) —
// hai nơi cùng suy cơ sở nên không lệch, nhưng lớp thứ hai là lớp quyết định.
//
// ⚠️ `now` BẮT BUỘC (luật 19). `tranSoKhoan` BẮT BUỘC (luật 7): không có mặc định ngầm — cắt thì NÓI (`cat`), không cắt im lặng.
import type { Prisma, PrismaClient } from "@prisma/client";

import { WHERE_THUC_THU } from "@/lib/finance/thuc-thu";

import type { BoiCanhQuet } from "./boi-canh";
import { loaiButToan } from "./but-toan";
import type { QuyTac } from "./chon-quy-tac";
import { coSoTrongPhamVi } from "./chinh-sach-service";
import { HoaHongError } from "./kieu";
import {
  dungKichBan,
  haiBoCauHinh,
  khoangThoiDiem,
  kiemKhoang,
  tinhHaiKichBan,
  tongHopMoPhong,
  type KetQuaMoPhong,
  type KhoanChuaTinh,
  type KhoanMoPhong,
} from "./mo-phong";
import { conThucThu, docKhoan, hangButToanCua } from "./nap-khoan";
import { ngayVN } from "./ngay-lam-viec";
import { lapThu } from "./quet-khoan";

/** Mốc cutover GIẢ cho thử tính: mọi tháng đều "thuộc sổ mới" — thử tính hỏi "nếu tính bằng chính sách này", không hỏi "engine nào sở hữu". */
export const KY_SOM_NHAT = "0001-01";

/** Số khoản xử lý song song (mỗi khoản ~10 câu đọc) — vừa phải để không chiếm hết pool kết nối. */
const SONG_SONG = 6;

export type DauVaoMoPhong = {
  client: PrismaClient;
  /** Bối cảnh đã nạp (`dungBoiCanhTuMoc`): chính sách hiện hành, trần, VAT, danh mục. */
  bc: BoiCanhQuet;
  now: Date;
  /** Quy tắc của bản đề xuất (`docQuyTacCuaVersion`). */
  quyTacDeXuat: readonly QuyTac[];
  /** Chính sách bị bản đề xuất thay. */
  policyIdDeXuat: string;
  /** Ngày VN "YYYY-MM-DD", gồm cả hai đầu. */
  tuNgay: string;
  denNgay: string;
  /** Cơ sở người bấm được nhìn: "ALL" hoặc danh sách `centerId`. */
  coSoTrongTamNhin: "ALL" | readonly string[];
  /** Thu hẹp theo đơn vị (path OrgUnit); `null` = cả tầm nhìn. */
  pathPhamVi: string | null;
  /** Trần số khoản thu xét MỖI lượt; vượt ⇒ xét các khoản MỚI nhất và báo `cat`. */
  tranSoKhoan: number;
};

function dieuKienCoSo(tap: readonly string[]): Prisma.PaymentWhereInput {
  return {
    OR: [
      { centerId: { in: [...tap] } },
      { centerId: null, order: { centerId: { in: [...tap] } } },
      { centerId: null, order: { centerId: null, lead: { centerId: { in: [...tap] } } } },
    ],
  };
}

/** Tập cơ sở được xét: tầm nhìn ∩ phạm vi đơn vị. `null` = không giới hạn. */
async function tapCoSo(client: PrismaClient, tamNhin: "ALL" | readonly string[], pathPhamVi: string | null): Promise<ReadonlySet<string> | null> {
  const trongPhamVi = pathPhamVi === null ? null : new Set(await coSoTrongPhamVi(client, pathPhamVi));
  if (tamNhin === "ALL") return trongPhamVi;
  const tap = new Set(tamNhin);
  if (trongPhamVi === null) return tap;
  return new Set([...tap].filter((c) => trongPhamVi.has(c)));
}

type KetQuaMotKhoan =
  | { loai: "TINH"; khoan: KhoanMoPhong }
  | { loai: "CHUA_TINH"; chua: KhoanChuaTinh }
  | { loai: "NGOAI_PHAM_VI"; lyDo: "KHONG_PHAI_HOC_PHI" | "CHUYEN_NOI_BO" | "NGOAI_CO_SO" | "KHONG_CON_THUC_THU" };

export async function moPhongChinhSach(i: DauVaoMoPhong): Promise<KetQuaMoPhong> {
  const loiKhoang = kiemKhoang(i.tuNgay, i.denNgay);
  if (loiKhoang) throw new HoaHongError("KHOANG_KHONG_HOP_LE", loiKhoang);
  if (!Number.isInteger(i.tranSoKhoan) || i.tranSoKhoan < 1) throw new HoaHongError("DU_LIEU_KHONG_HOP_LE", "Trần số khoản thử tính phải là số nguyên dương.");

  const kb = dungKichBan({ quyTacDaNap: i.bc.hoaHong.quyTac, quyTacDeXuat: i.quyTacDeXuat, policyIdDeXuat: i.policyIdDeXuat, now: i.now });
  const cauHinh = haiBoCauHinh(i.bc.hoaHong, kb);
  // Bối cảnh dùng cho `lapThu`: nạp người hưởng cho vai của CẢ HAI bộ; mọi tháng đều thuộc "sổ mới".
  const bcHop: BoiCanhQuet = {
    ...i.bc,
    now: i.now,
    kyCutover: KY_SOM_NHAT,
    hoaHong: { ...i.bc.hoaHong, quyTac: kb.hop },
    coPhamViRole: kb.hop.some((q) => q.scopeType === "ROLE"),
  };

  const tap = await tapCoSo(i.client, i.coSoTrongTamNhin, i.pathPhamVi);
  const { tu, den } = khoangThoiDiem(i.tuNgay, i.denNgay);
  const where: Prisma.PaymentWhereInput = {
    AND: [{ ...WHERE_THUC_THU, paidDate: { gte: tu, lt: den } }, ...(tap === null ? [] : [dieuKienCoSo([...tap])])],
  };

  const [soDuong, hoan, duong] = await Promise.all([
    i.client.payment.count({ where: { AND: [where, { amount: { gt: 0 } }] } }),
    i.client.payment.aggregate({ where: { AND: [where, { amount: { lt: 0 } }] }, _count: { _all: true }, _sum: { amount: true } }),
    // Mới nhất trước: cắt thì bỏ khoản CŨ (số liệu gần hôm nay đáng tin hơn cho câu hỏi "áp từ giờ").
    i.client.payment.findMany({ where: { AND: [where, { amount: { gt: 0 } }] }, orderBy: [{ paidDate: "desc" }, { id: "desc" }], take: i.tranSoKhoan, select: { id: true, paidDate: true } }),
  ]);
  const cat = soDuong > duong.length ? { tran: i.tranSoKhoan, soKhoanChuaXet: soDuong - duong.length, xetTuNgay: ngayVN(duong[duong.length - 1]!.paidDate) } : null;

  const khoan: KhoanMoPhong[] = [];
  const chuaTinh: KhoanChuaTinh[] = [];
  const ngoai = { soKhoanHoan: hoan._count._all, tienHoan: hoan._sum.amount ?? 0, soKhoanKhongPhaiHocPhi: 0, soKhoanChuyenNoiBo: 0 };

  const xuLy = async (paymentId: string): Promise<KetQuaMotKhoan> => {
    const p = await docKhoan(i.client, paymentId);
    if (!p || !conThucThu(p)) return { loai: "NGOAI_PHAM_VI", lyDo: "KHONG_CON_THUC_THU" };
    if (loaiButToan(hangButToanCua(p)) !== "THU") return { loai: "NGOAI_PHAM_VI", lyDo: "CHUYEN_NOI_BO" };
    let lap: Awaited<ReturnType<typeof lapThu>>;
    try {
      lap = await lapThu(i.client, bcHop, p);
    } catch {
      // Một khoản dữ liệu hỏng không được làm sập cả lượt thử tính — nhưng cũng không được im lặng: đếm vào "chưa thể tính".
      return { loai: "CHUA_TINH", chua: { paymentId, ma: "LOI_DU_LIEU", soTien: p.amount } };
    }
    if (lap.loai === "BO_QUA") return { loai: "NGOAI_PHAM_VI", lyDo: "KHONG_PHAI_HOC_PHI" };
    if (lap.loai === "GIU") return { loai: "CHUA_TINH", chua: { paymentId, ma: lap.holds[0]?.code ?? "MANUAL_REVIEW_REQUIRED", soTien: p.amount } };
    const kh = lap.kh;
    if (tap !== null && !tap.has(kh.co.centerId)) return { loai: "NGOAI_PHAM_VI", lyDo: "NGOAI_CO_SO" };
    const kq = tinhHaiKichBan(kh.dauVao, kh.vat.netBase, cauHinh);
    return {
      loai: "TINH",
      khoan: {
        paymentId,
        ngayThu: ngayVN(p.paidDate),
        centerId: kh.co.centerId,
        loai: kh.loaiGiaoDich,
        nhomNguon: kh.nguonChinhSach.sourceGroupId === null ? "UNKNOWN" : (kh.nguon?.groupCode ?? "UNKNOWN"),
        coSo: kh.vat.netBase,
        ...kq,
      },
    };
  };

  for (let b = 0; b < duong.length; b += SONG_SONG) {
    const ra = await Promise.all(duong.slice(b, b + SONG_SONG).map((d) => xuLy(d.id)));
    for (const r of ra) {
      if (r.loai === "TINH") khoan.push(r.khoan);
      else if (r.loai === "CHUA_TINH") chuaTinh.push(r.chua);
      else if (r.lyDo === "KHONG_PHAI_HOC_PHI") ngoai.soKhoanKhongPhaiHocPhi += 1;
      else if (r.lyDo === "CHUYEN_NOI_BO") ngoai.soKhoanChuyenNoiBo += 1;
    }
  }
  // Tất định: thứ tự khoản không phụ thuộc thứ tự hoàn thành của lô song song.
  khoan.sort((a, b) => (a.paymentId < b.paymentId ? -1 : a.paymentId > b.paymentId ? 1 : 0));

  const ten = await docTen(i.client, khoan);
  const tong = tongHopMoPhong({ khoan, chuaTinh, ten, tran: i.bc.hoaHong.tranTongTiLe });
  return {
    ...tong,
    khoang: { tuNgay: i.tuNgay, denNgay: i.denNgay },
    soKhoanTrongKhoang: soDuong,
    cat,
    ngoai,
    phamVi: { soCoSo: tap === null ? null : tap.size },
  };
}

async function docTen(client: PrismaClient, khoan: readonly KhoanMoPhong[]) {
  const centerIds = [...new Set(khoan.map((k) => k.centerId))];
  const [vai, nhom, donVi] = await Promise.all([
    client.beneficiaryRole.findMany({ orderBy: { sortOrder: "asc" }, select: { code: true, name: true } }),
    client.leadSourceGroup.findMany({ select: { code: true, name: true } }),
    centerIds.length ? client.orgUnit.findMany({ where: { centerId: { in: centerIds }, deletedAt: null, type: "CENTER" }, select: { centerId: true, name: true } }) : Promise.resolve([]),
  ]);
  return {
    vai: new Map(vai.map((v) => [v.code, v.name])),
    nhom: new Map(nhom.map((n) => [n.code, n.name])),
    donVi: new Map(donVi.flatMap((o) => (o.centerId ? [[o.centerId, o.name] as const] : []))),
  };
}
