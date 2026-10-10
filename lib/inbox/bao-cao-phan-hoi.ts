import "server-only";
// lib/inbox/bao-cao-phan-hoi.ts — GĐ3: ai đang theo kịp khách, ai không.
//
// ── 🔴 BÁO CÁO NÀY CỐ Ý KHÔNG CÓ "THỜI GIAN PHẢN HỒI TRUNG BÌNH" ───────────
// Con số đó đòi ghép từng tin ĐẾN với tin ĐI kế tiếp của cùng hội thoại — không suy
// được từ các cột đang lưu, và cách rẻ tiền hay được dùng (`lastOutboundAt −
// lastInboundAt`) là một con số NÓI DỐI THEO HƯỚNG ĐẸP: nó đo khoảng cách tới lần trả
// lời GẦN NHẤT, nên một hội thoại bị bỏ quên ba ngày rồi mới trả lời vẫn ra "2 phút".
// Thà thiếu một cột còn hơn có một cột làm người đọc yên tâm sai.
//
// Thứ ở đây đo được CHÍNH XÁC và dùng được ngay:
//   · đang chờ trả lời (cột `awaitingReply` — nguồn sự thật của cả hộp thư);
//   · KHÁCH CHỜ LÂU NHẤT bao nhiêu phút — con số một quản lý cần để can thiệp;
//   · tin đến / tin đi ĐÃ GỬI ĐƯỢC trong kỳ.
//
// ── Quy công theo ai ────────────────────────────────────────────────────────
// Hội thoại quy theo `assigneeId` (người phụ trách). Tin ĐI quy theo `sentByUserId` —
// "NGUỒN ATTRIBUTION DUY NHẤT" (spec §3.3 S4), KHÔNG phải người phụ trách: người trực
// thay vẫn được tính đúng công, và một hội thoại đổi người không làm số cũ chạy theo.
//
// ── Cách ly cơ sở ───────────────────────────────────────────────────────────
// Mọi truy vấn gộp `inboxOrgScopeWhere(actor)` bằng `AND`. `Inbox*` KHÔNG đi qua
// `scopedDb` (module này có bộ scope riêng), nên quên một chỗ là rò số của cơ sở khác —
// và số liệu rò thì không ai nhìn ra, khác hẳn một hội thoại lạ hiện trên màn.
import type { InboxChannel } from "@prisma/client";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/actor";
import { inboxOrgScopeWhere } from "@/lib/inbox/scope";

export type DongBaoCaoPhanHoi = {
  /** `null` = chưa giao cho ai / chưa gắn đơn vị. Phải hiện, không được lọc đi. */
  khoa: string | null;
  ten: string;
  soHoiThoai: number;
  choTraLoi: number;
  /** Phút chờ của khách chờ LÂU NHẤT trong nhóm. `null` khi không ai đang chờ. */
  choLauNhatPhut: number | null;
  tinDen: number;
  /** Chỉ đếm tin ĐÃ GỬI ĐƯỢC — tin mô phỏng không phải là đã trả lời khách. */
  tinDi: number;
};

export type BaoCaoPhanHoi = {
  tu: Date;
  den: Date;
  theoNguoi: DongBaoCaoPhanHoi[];
  theoDonVi: DongBaoCaoPhanHoi[];
};

const CHUA_GIAO = "— chưa giao —";
const CHUA_GAN_DON_VI = "— chưa gắn đơn vị —";

/**
 * Số đo phản hồi trong một kỳ.
 *
 * `channel` bỏ trống = mọi kênh của hộp thư. Truyền `ZALO_CA_NHAN` để soi riêng trục
 * nick Zalo cá nhân.
 */
export async function baoCaoPhanHoi(input: {
  actor: Actor;
  tu: Date;
  den: Date;
  channel?: InboxChannel | null;
  now?: Date;
}): Promise<BaoCaoPhanHoi> {
  const luc = input.now ?? new Date();
  const scope = inboxOrgScopeWhere(input.actor);
  const locKenh = input.channel ? { channel: input.channel } : {};

  // Hội thoại CÓ HOẠT ĐỘNG trong kỳ. Không lấy toàn bộ hội thoại đang mở: một hộp thư
  // chạy lâu thì phần lớn hội thoại là chuyện của tháng trước, và gộp chúng vào làm
  // mọi tỉ lệ của kỳ này loãng đi.
  const hoiThoai = await db.inboxConversation.findMany({
    where: {
      AND: [
        { deletedAt: null, ...locKenh, lastMessageAt: { gte: input.tu, lte: input.den } },
        scope,
      ],
    },
    select: {
      id: true,
      assigneeId: true,
      orgUnitId: true,
      awaitingReply: true,
      lastInboundAt: true,
    },
  });

  // Tin trong kỳ — ĐỌC MỘT LƯỢT rồi gộp trong bộ nhớ thay vì bốn `groupBy` rời.
  // Lý do không dùng `groupBy`: số phải chẻ theo CẢ người lẫn đơn vị, mà `orgUnitId`
  // của tin có thể trống (tin mồ côi chưa gắn đơn vị) trong khi hội thoại thì đã gắn —
  // gộp ở đây lấy được đơn vị từ hội thoại, `groupBy` thì không.
  const tin = await db.inboxMessage.findMany({
    where: {
      AND: [{ deletedAt: null, ...locKenh, sentAt: { gte: input.tu, lte: input.den } }, scope],
    },
    select: {
      conversationId: true,
      direction: true,
      deliveryStatus: true,
      sentByUserId: true,
    },
  });

  const hoiTheoId = new Map(hoiThoai.map((h) => [h.id, h]));

  const theoNguoi = new Map<string | null, DongBaoCaoPhanHoi>();
  const theoDonVi = new Map<string | null, DongBaoCaoPhanHoi>();
  const lay = (bang: Map<string | null, DongBaoCaoPhanHoi>, khoa: string | null) => {
    let d = bang.get(khoa);
    if (!d) {
      d = { khoa, ten: "", soHoiThoai: 0, choTraLoi: 0, choLauNhatPhut: null, tinDen: 0, tinDi: 0 };
      bang.set(khoa, d);
    }
    return d;
  };

  for (const h of hoiThoai) {
    for (const d of [lay(theoNguoi, h.assigneeId), lay(theoDonVi, h.orgUnitId)]) {
      d.soHoiThoai += 1;
      if (!h.awaitingReply) continue;
      d.choTraLoi += 1;
      if (!h.lastInboundAt) continue;
      const phut = Math.max(0, Math.round((luc.getTime() - h.lastInboundAt.getTime()) / 60_000));
      d.choLauNhatPhut = Math.max(d.choLauNhatPhut ?? 0, phut);
    }
  }

  for (const t of tin) {
    const hoi = hoiTheoId.get(t.conversationId);
    // Tin của hội thoại nằm NGOÀI kỳ (hội thoại im từ lâu, tin này là tin cuối trước
    // đó) — bỏ, để hai bảng cùng nói về một tập hội thoại.
    if (!hoi) continue;
    if (t.direction === "IN") {
      lay(theoNguoi, hoi.assigneeId).tinDen += 1;
      lay(theoDonVi, hoi.orgUnitId).tinDen += 1;
      continue;
    }
    // Tin ĐI chỉ tính khi THẬT SỰ đi được. Một tin mô phỏng (`SIMULATED`) hay thất bại
    // mà tính là "đã trả lời" thì báo cáo này che đúng thứ nó sinh ra để phơi.
    if (t.deliveryStatus !== "SENT") continue;
    // Quy công cho NGƯỜI BẤM GỬI, không phải người phụ trách.
    lay(theoNguoi, t.sentByUserId ?? hoi.assigneeId).tinDi += 1;
    lay(theoDonVi, hoi.orgUnitId).tinDi += 1;
  }

  await datTen(theoNguoi, theoDonVi);

  return {
    tu: input.tu,
    den: input.den,
    theoNguoi: sapXep([...theoNguoi.values()]),
    theoDonVi: sapXep([...theoDonVi.values()]),
  };
}

/** Tên người và tên đơn vị, tra một lượt. */
async function datTen(
  theoNguoi: Map<string | null, DongBaoCaoPhanHoi>,
  theoDonVi: Map<string | null, DongBaoCaoPhanHoi>,
): Promise<void> {
  const idNguoi = [...theoNguoi.keys()].filter((k): k is string => Boolean(k));
  const idDonVi = [...theoDonVi.keys()].filter((k): k is string => Boolean(k));

  const [nguoi, donVi] = await Promise.all([
    idNguoi.length
      ? db.user.findMany({ where: { id: { in: idNguoi } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    idDonVi.length
      ? db.orgUnit.findMany({ where: { id: { in: idDonVi } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);

  const tenNguoi = new Map(nguoi.map((u) => [u.id, u.name ?? ""]));
  const tenDonVi = new Map(donVi.map((o) => [o.id, o.name]));

  for (const [k, d] of theoNguoi) d.ten = k ? (tenNguoi.get(k) || k) : CHUA_GIAO;
  for (const [k, d] of theoDonVi) d.ten = k ? (tenDonVi.get(k) || k) : CHUA_GAN_DON_VI;
}

/**
 * Thứ tự: ĐANG CHỜ nhiều nhất lên đầu, rồi tới chờ lâu nhất.
 *
 * Cố ý KHÔNG sắp theo "tin đi nhiều nhất": bảng này để tìm chỗ đang kẹt, không phải để
 * xếp hạng ai chăm. Sắp theo sản lượng là mời người đọc nhìn nhầm chỗ.
 */
function sapXep(ds: DongBaoCaoPhanHoi[]): DongBaoCaoPhanHoi[] {
  return ds.sort(
    (a, b) =>
      b.choTraLoi - a.choTraLoi ||
      (b.choLauNhatPhut ?? -1) - (a.choLauNhatPhut ?? -1) ||
      b.soHoiThoai - a.soHoiThoai,
  );
}
