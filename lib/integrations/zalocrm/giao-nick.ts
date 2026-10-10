import "server-only";
// lib/integrations/zalocrm/giao-nick.ts — GIAO NICK CHO NGƯỜI (tab "Nick Zalo CRM").
//
// Ghi bảng `ZaloCrmNickGiao`. Luật "ai đọc được nick đã giao, ở mức nào" thì ở
// `pham-vi-nick.ts` và được lượt đối soát đẩy sang ZaloCRM ≤5 phút sau — file này chỉ lo
// phần GHI và cổng.
//
// ── NHIỀU NGƯỜI MỘT NICK, MỖI NGƯỜI MỘT MỨC (chủ dự án chốt 24/09/2026) ────
// Trước đó một nick giao được cho ĐÚNG MỘT người (`ZaloCrmNick.sataUserId`). Mô hình ấy
// không diễn tả nổi trực thật: một nick CS1 có hai sale luân phiên, và quản lý kiêm hai
// cơ sở thì phải với tới nick của cả hai. Nay là một BẢNG, và mức lấy đúng ba giá trị
// ZaloCRM hiểu (`read`/`chat`/`admin`).
//
// ── 🔴 THAY CẢ TẬP, KHÔNG PHẢI "THÊM MỘT NGƯỜI" ───────────────────────────
// `datGiaoNick` nhận danh sách ĐẦY ĐỦ và tự gỡ phần thừa. Làm kiểu "thêm/bớt từng dòng"
// thì vế GỠ nằm ở một nút riêng mà không ai bấm, và danh sách chỉ có phình — đúng lớp
// hỏng câm mà cả module này sinh ra để tránh.
//
// ── 🔴 CỔNG: NGƯỜI NHẬN PHẢI THUỘC ĐÚNG CƠ SỞ CỦA NICK ────────────────────
// Thiếu cổng này thì một quản lý CS1 giao được nick của CS1 cho người CS2 — tức mở một
// đường rò chéo cơ sở bằng đúng màn sinh ra để siết quyền. `zcrmAccountId` đi từ trình
// duyệt nên KHÔNG được tin; phải tra lại nick, lấy cơ sở của nó, rồi hỏi
// `nguoiDuocDungNick` xem người nhận có trong danh sách hợp lệ của cơ sở ấy không.
//
// Và cổng đó phải hỏi CÙNG một nguồn mà lượt đối soát hỏi. Dựng danh sách "người được
// giao" bằng một câu tra riêng là tạo bản thứ hai của cùng một luật — rồi hai bản lệch
// nhau âm thầm, và triệu chứng sẽ là "giao xong mà người ta vẫn không thấy nick".
import { db } from "@/lib/db";
import { nguoiDuocDungNick } from "@/lib/integrations/zalocrm/cap-quyen-nick";
import { whereNickTheoActor, type ActorTamNhinNick } from "@/lib/integrations/zalocrm/nick-admin";
import type { MucQuyen } from "@/lib/integrations/zalocrm/pham-vi-nick";
import { maVaiCuaNguoiDung, vaiZaloCrm } from "@/lib/integrations/zalocrm/vai-tro";

export type MaLoiGiaoNick =
  | "KHONG_THAY_NICK"
  | "NICK_NGOAI_TAM_NHIN"
  | "NICK_CHUA_CO_CO_SO"
  | "NGUOI_NGOAI_CO_SO"
  | "TRUNG_NGUOI";

export type KetQuaGiaoNick =
  | { ok: true; soDong: number }
  | { ok: false; ma: MaLoiGiaoNick };

/** Một dòng giao: ai, ở mức nào. */
export type DongGiao = { sataUserId: string; mucQuyen: MucQuyen };

/** Người có thể nhận nick, kèm tên để dựng ô chọn. */
export type NguoiNhanDuoc = {
  id: string;
  ten: string;
  email: string | null;
  /** Đang giữ vai quản lý cơ sở — NHÃN, không phải quyền (đảo 24/09). */
  laQuanLy: boolean;
  /**
   * Neo ở đơn vị CẤP TRÊN cơ sở (Hội sở, khối vùng), không phải người của cơ sở này.
   *
   * Màn PHẢI nói ra: thêm một người hội sở vào nick của một cơ sở là một quyết định
   * khác hẳn thêm người của chính cơ sở đó, mà hai cái tên trông y hệt nhau.
   */
  laHoiSo: boolean;
  /**
   * 🔴 Vai của họ có mở được ZaloCRM không.
   *
   * `false` = thêm vào nick được, nhưng dòng giao ấy CHƯA có tác dụng gì: không có vé
   * SSO ⇒ bên ZaloCRM chưa có tài khoản nào mang `externalId` này ⇒ lượt đối soát đếm
   * họ vào `chuaCoTaiKhoan` rồi bỏ qua. Màn PHẢI nói ra, không thì đây là một nút bấm
   * xong không có gì xảy ra (luật 12).
   *
   * Đo bằng `vaiZaloCrm()` — ánh xạ vé SSO, cổng CỨNG nhất trong ba cổng. Hai cổng kia
   * là quyền `zalocrm:use` (mở được màn) và `ZaloAccountAccess` (thấy nick nào).
   */
  dungDuocZalocrm: boolean;
  /** Mã vai, để phân biệt hai người trùng tên và để câu giải thích nói đúng vai nào. */
  maVai: string[];
};

/**
 * Danh sách người có thể nhận nick của MỘT cơ sở.
 *
 * Dùng chung `nguoiDuocDungNick` với lượt đối soát — ô chọn trên màn và cổng khi ghi
 * nhìn cùng một sự thật. Trả rỗng khi cơ sở không có ai hợp lệ; đó là trạng thái bình
 * thường (cơ sở mới), không phải lỗi.
 *
 * 24/09/2026 — danh sách nay là MỌI NHÂN SỰ của cơ sở (chủ dự án chốt), không chỉ tư vấn
 * viên và quản lý. Ranh giới cơ sở GIỮ NGUYÊN.
 *
 * `laQuanLy` đi kèm để màn NÓI THẬT: quản lý cơ sở luôn có `admin` trên mọi nick của cơ
 * sở mình, nên hiện họ như một dòng giao bình thường (gỡ được, đổi mức được) là hứa một
 * điều màn không giữ được — bấm gỡ xong họ vẫn thấy nick. Luật 12 (affordance).
 */
export async function nguoiNhanDuocNick(centerCode: string): Promise<NguoiNhanDuoc[]> {
  const { tatCa, hoiSo, quanLy, vaiTheoNguoi } = await nguoiDuocDungNick(centerCode);
  if (tatCa.length === 0) return [];
  const laQL = new Set(quanLy);
  const laHO = new Set(hoiSo);
  const ds = await db.user.findMany({
    where: { id: { in: tatCa } },
    // `role` (enum v1) đi kèm vì `vaiZaloCrm` khớp CẢ HAI hệ tên vai: local/dev chạy v1,
    // prod chạy v2 (`UserOrgRole.role.code`). Đọc một hệ là câu trả lời đổi theo môi
    // trường — đúng lớp lỗi `vai-tro.ts` cảnh báo.
    select: { id: true, name: true, email: true, role: true },
    orderBy: { name: "asc" },
  });
  return ds.map((u) => {
    const maVai = maVaiCuaNguoiDung({ role: u.role, orgRoles: null }).concat(
      vaiTheoNguoi[u.id] ?? [],
    );
    return {
      id: u.id,
      ten: u.name ?? u.email ?? u.id,
      email: u.email,
      laQuanLy: laQL.has(u.id),
      laHoiSo: laHO.has(u.id),
      dungDuocZalocrm: vaiZaloCrm(maVai) !== null,
      maVai: [...new Set(maVai)],
    };
  });
}

/**
 * ĐẶT danh sách người được giao một nick (thay cả tập).
 *
 * `giao: []` = gỡ hết, nick về lại "cả cơ sở đều thấy ở mức `chat`" — xem
 * `pham-vi-nick.ts` về vì sao nhánh "chưa giao" phải tồn tại.
 *
 * KHÔNG revalidate, KHÔNG audit ở đây — đó là việc của Server Action gọi nó. Hàm này chỉ
 * lo luật + phép ghi, để test được mà không dựng Next.
 */
export async function datGiaoNick(input: {
  actor: ActorTamNhinNick;
  zcrmAccountId: string;
  giao: readonly DongGiao[];
}): Promise<KetQuaGiaoNick> {
  const nick = await db.zaloCrmNick.findFirst({
    where: { zcrmAccountId: input.zcrmAccountId, deletedAt: null },
    select: { id: true, centerId: true },
  });
  if (!nick) return { ok: false, ma: "KHONG_THAY_NICK" };

  // Tầm nhìn: hỏi CÙNG mảnh `where` mà màn Tích hợp dùng, không viết lại điều kiện tại
  // chỗ. Tra lần hai có `whereNickTheoActor` là cách rẻ nhất để chắc người bấm thật sự
  // nhìn thấy nick này — `zcrmAccountId` đến từ trình duyệt.
  const trongTam = await db.zaloCrmNick.findFirst({
    where: { ...whereNickTheoActor(input.actor), zcrmAccountId: input.zcrmAccountId },
    select: { id: true },
  });
  if (!trongTam) return { ok: false, ma: "NICK_NGOAI_TAM_NHIN" };

  // Trùng người trong cùng một lượt gửi: từ chối thay vì lấy dòng cuối. Khoá duy nhất
  // `[nickId, sataUserId]` sẽ ném `P2002` ở giữa phép ghi, và một lỗi 500 không nói được
  // cho người dùng biết họ vừa chọn một người hai lần.
  const idGui = input.giao.map((g) => g.sataUserId);
  if (new Set(idGui).size !== idGui.length) return { ok: false, ma: "TRUNG_NGUOI" };

  if (idGui.length > 0) {
    if (!nick.centerId) return { ok: false, ma: "NICK_CHUA_CO_CO_SO" };
    const coSo = await db.center.findUnique({
      where: { id: nick.centerId },
      select: { code: true },
    });
    // `Center.code` là NULLABLE trong schema. Không có mã thì `nguoiDuocDungNick` không
    // tra được đơn vị ⇒ danh sách hợp lệ RỖNG ⇒ cổng dưới sẽ từ chối mọi người. Từ chối
    // ở đây với mã lỗi ĐÚNG NGUYÊN NHÂN, thay vì để người dùng đọc "người ngoài cơ sở"
    // cho một cơ sở chưa đặt mã.
    if (!coSo?.code) return { ok: false, ma: "NICK_CHUA_CO_CO_SO" };

    const { tatCa } = await nguoiDuocDungNick(coSo.code);
    const hopLe = new Set(tatCa);
    // MỌI người phải hợp lệ. Lọc bớt người sai rồi ghi phần còn lại là im lặng làm một
    // việc KHÁC việc người dùng bấm — họ đọc "đã lưu" và tin rằng cả danh sách đã vào.
    if (idGui.some((id) => !hopLe.has(id))) return { ok: false, ma: "NGUOI_NGOAI_CO_SO" };
  }

  await db.$transaction(async (tx) => {
    // Gỡ TRƯỚC, theo `notIn` — không `deleteMany` sạch rồi tạo lại: xoá-rồi-tạo làm mất
    // `createdAt` của những dòng không đổi, và để một khoảng trong giao dịch mà nick
    // không có ai (lượt đối soát đọc trúng khoảng đó sẽ gỡ sạch bên ZaloCRM).
    // Nhánh rỗng bỏ hẳn `notIn`. ⚠️ Đo 24/09/2026 bằng phép cấy: Prisma 5.22 dịch
    // `notIn: []` thành một điều kiện LUÔN ĐÚNG, nên bỏ nhánh `if` đi thì "gỡ hết" VẪN
    // chạy đúng và KHÔNG ca nào đỏ. Nhánh này là phòng xa, không phải thứ đang gánh —
    // nói thẳng ra để người sau đừng tưởng có lưới canh nó.
    //
    // Giữ vì hướng hỏng của nó là hướng CÂM: một bản Prisma sau đổi `notIn: []` thành
    // "không khớp gì" là "gỡ hết" lặng lẽ không gỡ ai, người bị gỡ vẫn đọc chat khách,
    // và triệu chứng duy nhất là một con số trên màn. `[ZCG-03]` sẽ bắt được NGÀY ĐÓ —
    // đã đo: cấy `{ sataUserId: { in: [] } }` cho nhánh rỗng ⇒ đúng `[ZCG-03]` đỏ.
    await tx.zaloCrmNickGiao.deleteMany({
      where: {
        nickId: nick.id,
        ...(idGui.length ? { sataUserId: { notIn: idGui } } : {}),
      },
    });
    for (const g of input.giao) {
      await tx.zaloCrmNickGiao.upsert({
        where: { nickId_sataUserId: { nickId: nick.id, sataUserId: g.sataUserId } },
        update: { mucQuyen: g.mucQuyen },
        create: { nickId: nick.id, sataUserId: g.sataUserId, mucQuyen: g.mucQuyen },
      });
    }
    // Cột CŨ `ZaloCrmNick.sataUserId` — giữ đồng bộ ở mức thô suốt pha A (2 pha: bảng
    // mới đã thay, cột cũ còn đó để lùi mã được). KHÔNG đường nào đang ĐỌC nó nữa, nên
    // giá trị này chỉ có nghĩa nếu ai đó lùi mã về bản trước 24/09 — và lúc ấy "một
    // người duy nhất" là cách diễn giải gần đúng nhất còn lại. Nhiều hơn một ⇒ `null`,
    // tức "chưa giao", tức cả cơ sở thấy: nới hơn thực tế nhưng KHÔNG bỏ sót ai, còn
    // giữ lại một cái tên cũ thì cắt mất những người kia.
    await tx.zaloCrmNick.update({
      where: { id: nick.id },
      data: { sataUserId: idGui.length === 1 ? idGui[0]! : null },
    });
  });

  return { ok: true, soDong: idGui.length };
}
