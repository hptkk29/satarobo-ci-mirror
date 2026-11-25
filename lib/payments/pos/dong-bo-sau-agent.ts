import "server-only";
// lib/payments/pos/dong-bo-sau-agent.ts — KIỂM LẠI phiếu thu thẻ sau một lô của máy đồng bộ (GĐ4 POS — T26). §7.
//
// Đặc tả mục 3: "mỗi batch mới ⇒ tự chạy khớp cho phiếu POS đang mở của cơ sở đó". Tập kiểm:
//   · phiếu MỞ (CHO_QUET / THAT_BAI) + phiếu HET_HAN chưa bị thay, tạo trong 7 ngày, của CƠ SỞ agent HOẶC mang mã
//     xuất hiện trong lô (mọi cơ sở — quẹt chéo Q-E phải ra CAN_XU_LY, không kẹt "chưa thấy");
//   · phiếu (mọi trạng thái trừ HUY) đang giữ giao dịch vừa có tín hiệu hủy/hoàn (D7 ⇒ CANCELLED_AFTER_PAID).
// Trần 30 phiếu, ngân sách 10 giây; phiếu mang TÍN HIỆU HỦY đi TRƯỚC, rồi cũ trước; còn lại để poller. Mỗi phiếu đi
// CHÍNH `kiemTraPhieuPos` (nguồn AGENT, chịu cửa sổ chống bấm dồn 5″ của GĐ2 — sale đang chờ job cùng phiếu ⇒ lượt
// này ra CACHE, vô hại: poller hỏi lại phiếu MỞ). NGOẠI LỆ (rà đối kháng RV-05): phiếu mang tín hiệu hủy KHÔNG chịu
// cửa sổ (`boQuaChongDon`) — tín hiệu chỉ tới MỘT lần và poller không quét phiếu đã đóng, nên CACHE ở đây là mất
// hẳn CANCELLED_AFTER_PAID; phiếu tín hiệu lỗi / bị cắt vì hết giờ ⇒ trả `btIdChuaXong` để nơi gọi KHÔNG ghi băm cho
// dòng mang tín hiệu (lượt đồng bộ sau xử lý lại). Với provider
// lượt máy (`cheDo: "MAY"` — không chờ; agent không sẵn sàng ⇒ chỉ tin PAID). KHÔNG đường tiền riêng (lưới [POS4-W1]).
import { db } from "@/lib/db";
import { chonPosProvider } from "./provider/chon";
import { TRANG_THAI_MO } from "./phieu-pos-luat";
import { CUA_SO_DONG_BO_MS, idPhieuHetHanChuaBiThay } from "./dong-bo-sau-nhap";
import { kiemTraPhieuPos } from "./xu-ly-ket-qua";

const TRAN_PHIEU = 30;
const NGAN_SACH_MS = 10_000;

export async function dongBoPhieuPosSauAgent(x: {
  centerId: string;
  /** Mã 5 ký tự (`tachMaPos`) của các dòng đi qua lõi ở lô này. */
  maPhieu: readonly string[];
  /** Giao dịch vừa có tín hiệu hủy/hoàn (gốc của VOID, dòng mang cột Hoàn/Hủy). */
  btIdCoTinHieuHuy: readonly string[];
  /** BẮT BUỘC (luật 19) — mỗi phiếu một mốc mới. */
  dongHo: () => Date;
}): Promise<{ daKiem: number; loi: number; boQuaHetGio: number; btIdChuaXong: string[] }> {
  const batDau = x.dongHo();
  const thuoc = [{ centerId: x.centerId }, ...(x.maPhieu.length ? [{ code5: { in: [...x.maPhieu] } }] : [])];
  const tu = new Date(batDau.getTime() - CUA_SO_DONG_BO_MS);
  const [mo, hetHanIds, tinHieu] = await Promise.all([
    db.posPaymentIntent.findMany({
      where: { status: { in: [...TRANG_THAI_MO] }, createdAt: { gte: tu, lte: batDau }, OR: thuoc },
      orderBy: { createdAt: "asc" },
      take: TRAN_PHIEU,
      select: { id: true, createdAt: true },
    }),
    idPhieuHetHanChuaBiThay({ now: batDau, cuaSoMs: CUA_SO_DONG_BO_MS, take: TRAN_PHIEU }),
    x.btIdCoTinHieuHuy.length
      ? db.posPaymentIntent.findMany({
          where: { bankTransactionId: { in: [...x.btIdCoTinHieuHuy] }, status: { not: "HUY" } },
          select: { id: true, createdAt: true, bankTransactionId: true },
        })
      : Promise.resolve([]),
  ]);
  const hetHan = hetHanIds.length
    ? await db.posPaymentIntent.findMany({ where: { id: { in: hetHanIds }, OR: thuoc }, select: { id: true, createdAt: true } })
    : [];
  const btTinHieu = new Map(tinHieu.map((p) => [p.id, p.bankTransactionId]));
  const cuTruoc = (a: { createdAt: Date }, b: { createdAt: Date }) => a.createdAt.getTime() - b.createdAt.getTime();
  const conLai = new Map<string, { id: string; createdAt: Date }>();
  for (const p of [...mo, ...hetHan]) if (!btTinHieu.has(p.id)) conLai.set(p.id, p);
  const ds = [...[...tinHieu].sort(cuTruoc), ...[...conLai.values()].sort(cuTruoc)].slice(0, TRAN_PHIEU).map((p) => p.id);

  const provider = chonPosProvider({ cheDo: "MAY" });
  const kq = { daKiem: 0, loi: 0, boQuaHetGio: 0, btIdChuaXong: [] as string[] };
  const chuaXong = (id: string) => {
    const bt = btTinHieu.get(id);
    if (bt) kq.btIdChuaXong.push(bt);
  };
  // Phiếu tín hiệu bị trần 30 cắt ⇒ cũng "chưa xong".
  for (const p of tinHieu) if (!ds.includes(p.id)) chuaXong(p.id);
  for (let i = 0; i < ds.length; i += 1) {
    const t = x.dongHo();
    if (t.getTime() - batDau.getTime() > NGAN_SACH_MS) {
      kq.boQuaHetGio += ds.length - i;
      for (const id of ds.slice(i)) chuaXong(id);
      break;
    }
    const id = ds[i]!;
    try {
      await kiemTraPhieuPos({
        intentId: id,
        provider,
        triggeredBy: "AGENT",
        now: t,
        nguoiKiemId: null,
        ...(btTinHieu.has(id) ? { boQuaChongDon: true as const } : {}),
      });
      kq.daKiem += 1;
    } catch (err) {
      kq.loi += 1;
      chuaXong(id);
      console.error(`[pos-agent] kiểm lại phiếu ${id} sau lô lỗi:`, err);
    }
  }
  return kq;
}
