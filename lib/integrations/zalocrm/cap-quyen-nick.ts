import "server-only";
// lib/integrations/zalocrm/cap-quyen-nick.ts — ai được dùng nick nào (chốt 13/09/2026).
//
// ── CHÍNH SÁCH ─────────────────────────────────────────────────────────────
// *Mọi tư vấn viên và quản lý của một cơ sở đọc/gửi được trên mọi nick thuộc cơ sở đó.*
// Đó là mô hình trực thật: nhiều sale luân phiên trên cùng một nick công ty.
//
// ── VÌ SAO SATA CẤP, KHÔNG PHẢI NGƯỜI GÁN TAY ──────────────────────────────
// `ZaloAccount.ownerUserId` bên fork là 1-1 nên không diễn tả nổi "nhiều người một
// nick"; bảng `ZaloAccountAccess` thì đúng việc và `getZaloScope` đã hợp nhất sẵn.
// Nhưng nếu để gán tay thì mỗi lần tuyển sale mới hoặc đổi ca, ai đó phải nhớ vào gán —
// quên là người ấy mở hộp thư ra TRỐNG, không lỗi, không ai biết vì sao. Sata đã giữ
// sẵn sự thật "ai thuộc cơ sở nào" nên để Sata đẩy sang là hết một việc phải nhớ.
//
// ── 🔴 HAI CHIỀU, VÀ CHIỀU GỠ MỚI LÀ CHIỀU DỄ QUÊN ────────────────────────
// Cấp thì ai cũng nhớ. GỠ — người nghỉ việc, chuyển cơ sở, đổi sang vai không nằm trong
// chính sách — thì không ai nhớ, vì không có triệu chứng: mọi thứ vẫn chạy, chỉ là một
// người không còn phận sự vẫn đọc được chat của khách. Nên endpoint bên fork nhận
// TOÀN BỘ danh sách và tự gỡ phần thừa, thay vì "thêm một người".
//
// ── Cơ sở chưa có nick (hiện trạng tới khi có SIM — việc 9.16) ─────────────
// KHÔNG gọi mạng, KHÔNG ghi nhật ký. Bộ này chạy 288 lượt/ngày; kêu khi chưa có gì để
// làm là cách nhanh nhất khiến người vận hành ngừng đọc nhật ký, rồi bỏ lỡ dòng thật.
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings/service";
import { docKhoaApi, datQuyenNickZalocrm } from "@/lib/integrations/zalocrm/client";
import { ghiNhatKyZalocrm } from "@/lib/integrations/zalocrm/log";
import {
  VAI_DUOC_CAP_NICK,
  VAI_KHONG_THEM_DUOC_VAO_NICK,
} from "@/lib/integrations/zalocrm/vai-tro";
import {
  docMucQuyen,
  nguoiDuocDungMotNick,
  VAI_QUAN_LY_CO_SO,
} from "@/lib/integrations/zalocrm/pham-vi-nick";
import { rateLimit, getRateLimitBackend } from "@/lib/rate-limit";

export type KetQuaCapQuyenOrg = {
  orgCode: string;
  ok: boolean;
  ma?: string;
  soNick: number;
  soNguoi: number;
  /** Bản ghi quyền đã cấp/giữ. */
  capMoi: number;
  /** 🔴 Bản ghi ĐÃ GỠ — người không còn thuộc cơ sở. */
  daGo: number;
  /** `externalId` chưa từng đăng nhập ZaloCRM ⇒ bên kia chưa có tài khoản. Không phải lỗi. */
  chuaCoTaiKhoan: number;
  loi: number;
};

/**
 * Đối soát quyền truy cập nick cho mọi cơ sở đã ánh xạ orgCode.
 *
 * KHÔNG BAO GIỜ NÉM — một cơ sở hỏng không kéo theo cơ sở khác, và cron phải kết thúc.
 */
export async function capQuyenNickZalocrm(): Promise<{
  tong: { capMoi: number; daGo: number; loi: number };
  theoOrg: KetQuaCapQuyenOrg[];
}> {
  const anhXa = await getSetting("zalocrm.orgCodes");
  // Khoá = `Center.code`, giá trị = orgCode. Ở đây cần CẢ HAI: mã cơ sở để tra người,
  // orgCode để gọi API.
  const cap = Object.entries(anhXa ?? {}).filter(
    (e): e is [string, string] => typeof e[1] === "string" && Boolean(e[1]),
  );

  const theoOrg: KetQuaCapQuyenOrg[] = [];
  const daLam = new Set<string>();
  for (const [centerCode, orgCode] of cap) {
    // Hai cơ sở khai trùng orgCode (lỗi gõ trong ô JSON) — làm một lượt, không hai.
    if (daLam.has(orgCode)) continue;
    daLam.add(orgCode);
    theoOrg.push(await capQuyenMotOrg({ centerCode, orgCode }));
  }

  const tong = theoOrg.reduce(
    (a, o) => ({ capMoi: a.capMoi + o.capMoi, daGo: a.daGo + o.daGo, loi: a.loi + o.loi }),
    { capMoi: 0, daGo: 0, loi: 0 },
  );
  return { tong, theoOrg };
}

/**
 * Trần thời gian cho lượt cấp quyền chạy kèm lúc MỞ MÀN. Hết hạn thì bỏ, không đợi thêm.
 *
 * 1,5 giây là mức chịu được cho một lượt tải trang, và nó chỉ phải trả **tối đa một lần
 * mỗi giờ mỗi người** nhờ tiết chế bên dưới. Lượt gọi ngầm phía dưới vẫn chạy nốt theo
 * trần riêng của `goiZalocrm` — ta chỉ thôi ĐỢI nó, không huỷ nó.
 */
const HAN_MO_MAN_MS = 1_500;

/** Một giờ — trùng với ý "mỗi người tối đa một lượt/giờ". */
const CUA_SO_TIET_CHE_MS = 3_600_000;

let daGhiNenTietChe = false;

/**
 * Ghi nền tiết chế MỘT LẦN mỗi tiến trình.
 *
 * Trên Vercel "một lần mỗi tiến trình" = một lần mỗi instance mỗi lần khởi động nguội —
 * vài dòng/ngày, đủ để biết đang chạy `upstash` hay `memory` mà không thành rác. Ghi ở
 * MỖI LƯỢT thì 288 lượt/ngày × số instance, đúng thứ không ai đọc nữa.
 */
function ghiNenTietCheMotLan(): void {
  if (daGhiNenTietChe) return;
  daGhiNenTietChe = true;
  console.info(`[zalocrm] tiết chế cấp quyền khi mở màn: nền ${getRateLimitBackend()}`);
}

export type KetQuaMoMan = "da-cap" | "bo-qua-tiet-che" | "qua-han" | "loi";

/**
 * NỢ-9 — CẤP QUYỀN NGAY LÚC MỞ MÀN, không chờ cron.
 *
 * 🔴 VÌ SAO CÓ: tài khoản bên fork chỉ sinh ra ở LẦN SSO ĐẦU TIÊN, còn
 * `capQuyenNickZalocrm` thì bỏ qua `externalId` mà fork chưa biết (bộ đếm
 * `chuaCoTaiKhoan`). Nên ai đăng nhập lần đầu SAU lượt cron gần nhất sẽ mở hộp thư ra
 * **RỖNG** cho tới lượt cron kế tiếp — trên prod là tới 5 phút, trên `test` là vô hạn vì
 * cron không chạy theo lịch (NỢ-5). Đo được 17/09/2026: `uat.giamdoc` đăng nhập lúc
 * 16:39, cron gần nhất 10:41 ⇒ 0 nick; chạy cron lại ⇒ 2 nick.
 *
 * ── HAI RÀNG BUỘC CỨNG (chủ dự án chốt) ─────────────────────────────────────────────
 *
 * 1. **FAIL-SAFE — hàm này KHÔNG BAO GIỜ NÉM và KHÔNG BAO GIỜ TREO.** Fork chết, chậm,
 *    hay trả lỗi thì màn vẫn mở. Cấp quyền KHÔNG phải điều kiện để vào hộp thư. Đây là
 *    lý do mọi nhánh đều nuốt lỗi và có trần thời gian — nơi gọi `await` được mà vẫn an
 *    toàn. Khoá bằng `[ZC-CQ-01*]`.
 *
 * 2. **MỘT ĐƯỜNG CHÍNH SÁCH DUY NHẤT.** Nó gọi đúng `capQuyenMotOrg` mà cron gọi, nên
 *    tập người gửi sang fork do đúng `nguoiDuocDungNick` tính ra. TUYỆT ĐỐI không lọc
 *    lại, cắt bớt, hay tự dựng danh sách: `PUT …/access` **thay cả tập**, nên hai đường
 *    tính khác nhau là chúng GỠ QUYỀN CỦA NHAU mỗi lượt. Khoá bằng `[ZC-CQ-02]`, và
 *    lưới ấy so THÂN YÊU CẦU THẬT với `nguoiDuocDungNick` — nó bắt được cả kiểu "giữ
 *    nguyên lời gọi nhưng lọc lại kết quả", thứ mà lưới ghim mã nguồn không thấy.
 *
 * ── TIẾT CHẾ ─────────────────────────────────────────────────────────────────────────
 * Dùng `lib/rate-limit.ts` sẵn có (Upstash nếu có khoá, không thì Map trong bộ nhớ theo
 * từng instance). **Mất tiết chế KHÔNG gây sai lệch** — chỉ tốn thêm lượt gọi mạng: vì
 * ràng buộc 2, tập gửi đi luôn giống hệt, nên chạy 1 lần hay 50 lần đều ra một trạng
 * thái. Vì vậy tiết chế hỏng thì **cứ chạy tiếp**, không được biến nó thành cổng chặn.
 *
 * Cấp theo CƠ SỞ chứ không theo người (giống cron): một người mở màn là cả cơ sở của họ
 * được cấp, nên người thứ hai vào ca không phải chờ lượt của chính mình.
 */
export async function capQuyenKhiMoMan(input: {
  /** Chỉ dùng làm khoá tiết chế. */
  userId: string;
  centerCode: string;
  orgCode: string;
}): Promise<KetQuaMoMan> {
  try {
    const tc = await rateLimit({
      key: `zalocrm:capquyen:${input.userId}`,
      max: 1,
      windowMs: CUA_SO_TIET_CHE_MS,
    });
    if (!tc.success) return "bo-qua-tiet-che";
  } catch {
    // Tiết chế hỏng (Redis chết) KHÔNG được chặn việc cấp quyền — xem ghi chú ở trên.
  }
  ghiNenTietCheMotLan();

  try {
    return await Promise.race<KetQuaMoMan>([
      capQuyenMotOrg({ centerCode: input.centerCode, orgCode: input.orgCode }).then(
        (kq): KetQuaMoMan => (kq.loi > 0 ? "loi" : "da-cap"),
      ),
      new Promise<KetQuaMoMan>((giaiQuyet) => {
        setTimeout(() => giaiQuyet("qua-han"), HAN_MO_MAN_MS).unref?.();
      }),
    ]);
  } catch {
    // `capQuyenMotOrg` vốn không ném, nhưng KHÔNG dựa vào lời hứa đó: đây là hàng rào
    // cuối của ràng buộc 1, và nó rẻ.
    return "loi";
  }
}

async function capQuyenMotOrg(input: {
  centerCode: string;
  orgCode: string;
}): Promise<KetQuaCapQuyenOrg> {
  const { centerCode, orgCode } = input;
  const rong: KetQuaCapQuyenOrg = {
    orgCode,
    ok: false,
    soNick: 0,
    soNguoi: 0,
    capMoi: 0,
    daGo: 0,
    chuaCoTaiKhoan: 0,
    loi: 0,
  };

  if (!docKhoaApi(orgCode)) return { ...rong, ma: "CHUA_KHAI_KHOA_API" };

  // `ZaloCrmNick` nằm trong `SCOPE_EXEMPT` nên `scopedDb` KHÔNG lọc hộ, và ở đây cũng
  // KHÔNG cần lọc: cron chạy nhân danh hệ thống, không nhân danh ai. `deletedAt: null`
  // phải viết tay (bảng không ở `SOFT_DELETE_MODELS` — nợ #4 của bản bàn giao).
  const nicks = await db.zaloCrmNick.findMany({
    where: { orgCode, deletedAt: null },
    // `giao` = các dòng ĐÃ GIAO của nick (bảng `ZaloCrmNickGiao`). Thiếu nó ở đây thì
    // mọi nick thành "chưa giao" và cả cơ sở lại thấy hết — hỏng CÂM, không lỗi nào
    // báo. Khoá bằng ca `[ZC-CQ-11]`.
    //
    // ⚠️ Cột cũ `ZaloCrmNick.sataUserId` CỐ Ý không đọc nữa (2 pha — migration
    // `20260924120000` đã chép nó sang bảng giao ở mức `chat`, và cột còn đó để lùi
    // được). Đọc CẢ HAI là hai nguồn sự thật cho cùng một luật, và bản cũ sẽ âm thầm
    // thắng ở những nick mà người ta vừa gỡ giao.
    select: {
      zcrmAccountId: true,
      giao: { select: { sataUserId: true, mucQuyen: true } },
    },
  });
  // ⛔ Chưa có nick ⇒ RA NGAY. Không gọi mạng, không ghi nhật ký. Đây là hiện trạng của
  // mọi cơ sở cho tới khi có SIM thật (việc 9.16), tức là trạng thái BÌNH THƯỜNG hôm nay.
  if (nicks.length === 0) return { ...rong, ok: true, ma: "CHUA_CO_NICK" };

  const { tatCa, macDinh } = await nguoiDuocDungNick(centerCode);

  const kq: KetQuaCapQuyenOrg = {
    ...rong,
    ok: true,
    soNick: nicks.length,
    soNguoi: tatCa.length,
  };

  for (const n of nicks) {
    // MỖI NICK MỘT DANH SÁCH RIÊNG. Trước 24/09 vòng này gửi CÙNG một mảng cho mọi
    // nick; nay nick đã giao chỉ còn người được giao + quản lý cơ sở, và mỗi người
    // mang MỨC của riêng mình.
    const nguoi = nguoiDuocDungMotNick({
      giaoTay: n.giao.map((g) => ({
        sataUserId: g.sataUserId,
        mucQuyen: docMucQuyen(g.mucQuyen),
      })),
      nguoiCuaCoSo: tatCa,
      macDinhDungDuoc: macDinh,
    });
    const res = await datQuyenNickZalocrm(orgCode, n.zcrmAccountId, nguoi);
    if (!res.ok) {
      kq.loi += 1;
      continue;
    }
    kq.capMoi += res.data?.granted ?? 0;
    kq.daGo += res.data?.revoked ?? 0;
    kq.chuaCoTaiKhoan += res.data?.unknown ?? 0;
  }

  // Chỉ ghi vết khi CÓ THAY ĐỔI hoặc có lỗi. Lượt sạch — tức gần như mọi lượt — im lặng.
  if (kq.daGo > 0 || kq.loi > 0) {
    await ghiNhatKyZalocrm({
      orgCode,
      action: "CAP_QUYEN_NICK",
      status: kq.loi > 0 ? "FAILED" : "SUCCESS",
      responsePayload: {
        soNick: kq.soNick,
        soNguoi: kq.soNguoi,
        daGo: kq.daGo,
        chuaCoTaiKhoan: kq.chuaCoTaiKhoan,
      },
      errorMessage: kq.loi > 0 ? `Không đặt được quyền cho ${kq.loi} nick.` : null,
    });
  }

  return kq;
}

/**
 * `User.id` của những người được dùng nick của một cơ sở.
 *
 * Nguồn sự thật là `UserOrgRole` — CÙNG nguồn mà `buildActor` dùng để tính tầm nhìn cơ
 * sở. Cố ý KHÔNG đọc `User.centerId`: cột đó là cơ sở "gốc" lúc tạo tài khoản, không
 * phản ánh điều chuyển, nên lấy nó là cấp quyền theo một sự thật đã cũ.
 *
 * Lọc `status: "ACTIVE"` + hiệu lực theo ngày: người đã hết nhiệm kỳ ở cơ sở phải rơi
 * khỏi danh sách, và chính việc rơi ra đó là thứ sinh ra lệnh GỠ ở bên kia.
 */
export type NguoiCuaCoSo = {
  /**
   * MỌI NHÂN SỰ còn hiệu lực neo tại cơ sở — tập GIAO TAY hợp lệ (24/09/2026).
   *
   * Rộng hơn trước: không lọc theo `VAI_DUOC_CAP_NICK` nữa, nên Giáo vụ / Giáo viên /
   * Kế toán của cơ sở đều thêm tay được. Vẫn KHÔNG vượt ra khỏi cơ sở, và vẫn loại
   * `VAI_KHONG_THEM_DUOC_VAO_NICK` (phụ huynh).
   */
  tatCa: string[];
  /**
   * Tập CON của `tatCa` neo ở đơn vị CẤP TRÊN cơ sở (Hội sở, khối vùng) — KHÔNG phải
   * người của chính cơ sở.
   *
   * Màn dùng nó để gắn nhãn "hội sở": người bấm phải biết mình đang thêm một người
   * ngoài cơ sở vào nick của cơ sở này. Không gắn nhãn thì hai cái tên trông như nhau
   * mà nghĩa khác hẳn.
   */
  hoiSo: string[];
  /**
   * Tập CON dùng nick MẶC ĐỊNH khi nick CHƯA giao ai (`VAI_DUOC_CAP_NICK`).
   *
   * 🔴 KHÁC `tatCa`, và sự khác nhau đó là cả điểm của đợt 24/09: mở rộng tập GIAO TAY
   * mà nhỡ mở luôn tập MẶC ĐỊNH thì mọi nhân sự của cơ sở đọc được mọi nick chưa giao —
   * một lượt nới quyền im lặng, không ai bấm nút nào.
   */
  macDinh: string[];
  /**
   * Tập CON của `tatCa` đang giữ vai quản lý cơ sở (`VAI_QUAN_LY_CO_SO`).
   *
   * ⚠️ Đây là NHÃN cho màn, KHÔNG phải quyền: từ lượt đảo 24/09, quản lý cơ sở không
   * còn `admin` tự động. Màn dùng nó để gắn chữ "quản lý cơ sở" dưới tên và chọn mức
   * mặc định lúc mới thêm. Đừng đưa nó trở lại `nguoiDuocDungMotNick`.
   */
  quanLy: string[];
  /**
   * Mã vai của từng người trong `tatCa`.
   *
   * Màn cần nó để NÓI THẬT: một Giáo viên thêm được vào nick, nhưng vai của họ chưa mở
   * được ZaloCRM (`VAI_ZALOCRM` + quyền `zalocrm:use`), nên dòng giao ấy chưa có tác
   * dụng gì. Giấu chuyện đó đi là dựng một nút không làm gì — luật 12.
   */
  vaiTheoNguoi: Record<string, string[]>;
};

/**
 * Các `path` TỔ TIÊN của một đường dẫn đơn vị, KHÔNG gồm chính nó.
 *
 * `/ho/danang/cs1/` ⇒ `["/ho/", "/ho/danang/"]`.
 *
 * Thuần để cấy lỗi được: đây là chỗ quyết định "ai ở cấp trên được thêm vào nick", và
 * một phép cắt chuỗi sai thì hoặc bỏ sót Hội sở (không ai thấy), hoặc quét cả cây
 * (thêm được người của cơ sở khác — rò chéo cơ sở).
 *
 * ⚠️ Dấu `/` cuối là BẮT BUỘC theo quy ước `path` của repo (xem `schema.prisma`): nó
 * cắt đúng biên node nên `/cs1` không dính `/cs10`. Đường không đúng khuôn ⇒ trả rỗng,
 * KHÔNG đoán.
 */
export function layDuongToTien(path: string | null | undefined): string[] {
  if (typeof path !== "string" || !path.startsWith("/") || !path.endsWith("/")) return [];
  const doan = path.slice(1, -1).split("/").filter(Boolean);
  // Bỏ chính nó (đoạn cuối) ⇒ chỉ còn tổ tiên. Gốc một đoạn thì không có tổ tiên nào.
  const ra: string[] = [];
  for (let i = 1; i < doan.length; i++) ra.push(`/${doan.slice(0, i).join("/")}/`);
  return ra;
}

export async function nguoiDuocDungNick(centerCode: string): Promise<NguoiCuaCoSo> {
  const luc = new Date();

  // ⚠️ `UserOrgRole` KHÔNG có quan hệ Prisma tới `OrgUnit` lẫn `User` (chỉ có `role`),
  // nên không lồng `where` được — phải tra ba bước. Viết `orgUnit: {...}` ở đây là lỗi
  // biên dịch, không phải lỗi chạy; ghi ra để người sau khỏi thử lại.
  const rong: NguoiCuaCoSo = {
    tatCa: [],
    hoiSo: [],
    macDinh: [],
    quanLy: [],
    vaiTheoNguoi: {},
  };

  const donVi = await db.orgUnit.findFirst({
    // `OrgUnit.code` khớp `Center.code` — cầu nối chuẩn của repo
    // (`lib/org/center-bridge.ts`), KHÔNG suy từ tên.
    where: { code: centerCode },
    select: { id: true, path: true },
  });
  if (!donVi) return rong;

  // ── NGƯỜI Ở ĐƠN VỊ CẤP TRÊN CŨNG THÊM TAY ĐƯỢC (chủ dự án chốt 24/09/2026) ──────
  // Nhân sự Hội sở KHÔNG neo ở cơ sở nào, nên câu tra chỉ nhìn đúng một đơn vị sẽ bỏ
  // sót họ — và triệu chứng là "không có tên chị ấy trong màn giao nick", không phải
  // một lỗi. Đo thật: quản lý kiêm nhiệm ở HO biến mất khỏi mọi danh sách.
  //
  // Dùng `path` (materialized path, dạng `/ho/danang/cs1/`) thay vì leo `parentId`
  // từng bậc: cây chỉ sâu 3 tầng nhưng leo bậc là N câu tra, còn đây là MỘT.
  // `path` NULLABLE (P1 additive) ⇒ không có thì chỉ lấy chính cơ sở, KHÔNG đoán.
  const duongToTien = layDuongToTien(donVi.path);
  const toTien = duongToTien.length
    ? await db.orgUnit.findMany({
        where: { path: { in: duongToTien } },
        select: { id: true },
      })
    : [];
  const idToTien = new Set(toTien.map((o) => o.id));
  const moiDonVi = [donVi.id, ...idToTien];

  const dong = await db.userOrgRole.findMany({
    where: {
      status: "ACTIVE",
      orgUnitId: { in: moiDonVi },
      // 24/09/2026 — KHÔNG còn lọc `code: { in: VAI_DUOC_CAP_NICK }`. Tập này nay là
      // "mọi nhân sự của cơ sở" (tập GIAO TAY); ba tập con tính ở dưới theo `role.code`.
      // Loại vai quan hệ: phụ huynh vốn không có dòng `UserOrgRole` nào nên điều kiện
      // này là hàng rào thứ hai — xem `VAI_KHONG_THEM_DUOC_VAO_NICK`.
      role: { code: { notIn: [...VAI_KHONG_THEM_DUOC_VAO_NICK] } },
      // `effectiveTo` nullable (null = vô thời hạn); `effectiveFrom` NOT NULL nên chỉ
      // so một chiều.
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: luc } }],
      effectiveFrom: { lte: luc },
    },
    // `role.code` cần cho CẢ BA tập con (mặc định · quản lý · nhãn vai trên màn). Lấy
    // trong CÙNG câu này thay vì tra thêm một lượt: hai câu tra hai thời điểm là hai
    // sự thật khác nhau, và ở đây chúng quyết định cùng một payload.
    // `orgUnitId` cần cho việc tách "người của cơ sở" khỏi "người hội sở": hai tập có
    // nghĩa khác nhau (xem `hoiSo`), và chỉ tập ĐẦU mới được dùng nick mặc định.
    select: { userId: true, orgUnitId: true, role: { select: { code: true } } },
  });
  const ids = [...new Set(dong.map((d) => d.userId))];
  if (ids.length === 0) return rong;

  // Lọc tài khoản còn hiệu lực ở bước riêng. Nghỉ việc / bị khoá là ca CHÍNH của vế GỠ:
  // dòng `UserOrgRole` của họ thường vẫn còn, nên chỉ lọc ở bảng vai là chưa đủ.
  const conHieuLuc = await db.user.findMany({
    where: { id: { in: ids }, isActive: true, deletedAt: null },
    select: { id: true },
  });
  const tatCa = conHieuLuc.map((u) => u.id);

  // Ba tập con đều lọc lại theo `conHieuLuc`, KHÔNG lấy thẳng từ `dong`: một người đã
  // nghỉ việc vẫn còn dòng `UserOrgRole`, và nếu lọt vào đây thì `pham-vi-nick.ts` giữ
  // họ trong nick — đúng cái vế GỠ mà hệ thống sinh ra để làm.
  const conSong = new Set(tatCa);
  // `role` được `select` ở trên nên trên đường thật nó luôn có. `?.` là để bộ test
  // mock được dòng vai mà không phải dựng cả quan hệ Prisma.
  // 🔴 `macDinh` và `quanLy` CHỈ tính trên dòng neo ĐÚNG TẠI CƠ SỞ. Người hội sở thêm
  // tay được, nhưng KHÔNG tự động dùng được mọi nick chưa giao của mọi cơ sở — đó sẽ là
  // một lượt nới quyền im lặng trên toàn hệ thống, không ai bấm nút nào.
  const locTheoVai = (vai: readonly string[]) => [
    ...new Set(
      dong
        .filter((d) => d.orgUnitId === donVi.id)
        .filter((d) => d.role?.code && vai.includes(d.role.code))
        .map((d) => d.userId)
        .filter((id) => conSong.has(id)),
    ),
  ];

  // Ai CHỈ neo ở cấp trên (không có dòng nào tại chính cơ sở) ⇒ nhãn "hội sở".
  const coDongTaiCoSo = new Set(
    dong.filter((d) => d.orgUnitId === donVi.id).map((d) => d.userId),
  );
  const hoiSo = tatCa.filter((id) => !coDongTaiCoSo.has(id));

  const vaiTheoNguoi: Record<string, string[]> = {};
  for (const d of dong) {
    if (!d.role?.code || !conSong.has(d.userId)) continue;
    (vaiTheoNguoi[d.userId] ??= []).push(d.role.code);
  }

  return {
    tatCa,
    hoiSo,
    macDinh: locTheoVai(VAI_DUOC_CAP_NICK),
    quanLy: locTheoVai(VAI_QUAN_LY_CO_SO),
    vaiTheoNguoi,
  };
}
