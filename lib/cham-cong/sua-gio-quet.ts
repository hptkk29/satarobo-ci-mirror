/**
 * lib/cham-cong/sua-gio-quet.ts — DỰNG + GHI dòng `StaffTimeLog` cho một lượt chỉnh giờ tay.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HAI CHẾ ĐỘ — `GHI_DE` và `GHI_THEM` [ĐẢO 06/10/2026, chủ dự án chốt]
 *
 * ~~NGUYÊN TẮC: GHI THÊM, KHÔNG SỬA ĐÈ — dòng quét gốc BẤT BIẾN, sửa giờ chỉ sinh thêm dòng
 * `MANUAL_ADJUST`, engine đọc bức tranh sau cùng.~~ **[ĐẢO 06/10/2026]**
 *
 * Chủ dự án: *"ca có 4 lần check in/out thì QLCS hoặc admin cũng ghi đè được đủ 4 mốc (chỉ
 * vào + ra thì không biết lúc nào với lúc nào)"* — và chốt: **chỉnh tay của quản lý là GHI ĐÈ
 * THẬT: lượt quét gốc của ngày được giữ lại để xem/audit nhưng KHÔNG còn tính công.**
 *
 * Vì sao "chỉ ghi thêm" không đủ nữa: ghi thêm hai mốc 08:00/17:30 lên một ngày đã có 08:32,
 * 11:31, 13:40 thì engine ghép cặp trên CẢ BẢY lượt — người sửa không biết mốc mình gõ sẽ
 * ghép với mốc nào, và kết quả không đoán được. Ghi đè trả lời câu đó: sau lượt sửa, ngày chỉ
 * còn đúng những mốc quản lý vừa nhập.
 *
 *   · `GHI_DE`   — trong CÙNG transaction: đánh dấu mọi lượt CÒN TÍNH của ngày (kể cả lượt
 *                  chỉnh tay cũ) `reviewStatus = DISMISSED` + lý do/ai/khi nào, rồi tạo các
 *                  lượt `MANUAL_ADJUST` mới. Dòng cũ KHÔNG bị xoá, KHÔNG bị sửa giờ/chiều —
 *                  câu "giờ quét THẬT là gì" vẫn trả lời được, chỉ là nó không vào công nữa.
 *   · `GHI_THEM` — hành vi cũ: chỉ thêm dòng. Dùng cho đơn TIMESHEET_FIX chỉ bổ sung MỘT đầu
 *                  (quên quét ra) — ghi đè ở đó là xoá luôn lượt vào thật của người nộp.
 *
 * Tham số `cheDo` BẮT BUỘC, không mặc định (luật 7 — `docs/luat-doc-so-va-ket-luan.md`): ghi
 * đè là phép mất-tính-công trên dữ liệu thật, để `tsc` liệt kê từng chỗ gọi.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * "LƯỢT CÒN TÍNH" — HỎI Ở MỘT CHỖ: `LUOT_CON_TINH`
 *
 * `result = ACCEPTED` VÀ `reviewStatus ≠ DISMISSED`. Mọi câu tính công / hiển thị "lượt hợp
 * lệ" phải đi qua hằng này (recompute, màn chấm công của tôi, cột "Thay đổi" ở /don-tu…).
 * Quên một chỗ là chỗ đó vẫn đếm lượt đã bị thay — và triệu chứng là số lệch nhau giữa hai
 * màn, không phải lỗi. Màn LỊCH SỬ thì vẫn đọc cả lượt đã thay, kèm nhãn `NHAN_DA_BI_THAY`.
 *
 * Trước 06/10/2026 `DISMISSED` có trong enum nhưng KHÔNG đường nào ghi/đọc — nên ngày hôm nay
 * nó mang đúng MỘT nghĩa: "đã được thay bằng chỉnh tay". Ai dùng nó cho nghĩa khác (vd hàng
 * chờ rà cờ "bỏ qua lượt") thì phải tách nhãn, kẻo màn in "đã được thay" cho lượt không ai thay.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MỘT đường, không phải hai
 *
 * Hai nguồn sinh dòng `MANUAL_ADJUST`: duyệt đơn `TIMESHEET_FIX` (`requests.ts`) và quản lý
 * sửa ngoài luồng đơn (`app/(admin)/admin/cham-cong/_actions.ts`). Cả hai DỰNG dòng bằng
 * `dungDongChinhTay` (thuần) và GHI bằng `ghiDongChinhTay` (nhận `tx`, không tự import `db`).
 * Hai bản là hai cơ hội để một bản lệch đi — quên `flags`, quên `reviewStatus`, quên đánh dấu
 * lượt cũ.
 *
 * KHÁC BIỆT giữa hai đường là `adjustRequestId`:
 *   · qua đơn   → `adjustRequestId = <id đơn>`  ⇒ căn cứ là ĐƠN của người lao động
 *   · sửa tay   → `adjustRequestId = null`      ⇒ căn cứ là LÝ DO quản lý ghi
 * và chế độ: sửa tay của quản lý LUÔN `GHI_DE`; đơn thì `cheDoChoDon` quyết.
 */
import type { Prisma } from "@prisma/client";

/** Căn cứ của lượt sửa. */
export type CanCuSuaGio =
  | { kieu: "DON"; requestId: string }
  | { kieu: "SUA_TAY" };

/** Xem đầu file. KHÔNG có mặc định — mỗi chỗ gọi phải nói rõ. */
export type CheDoChinhTay = "GHI_DE" | "GHI_THEM";

/** Tối đa 2 cặp vào–ra một ngày (ca hai buổi). */
export const SO_MOC_TOI_DA = 4;

/** Nhãn từng vị trí mốc — người đọc thấy "Vào 2", không thấy "mốc số 3". */
export const NHAN_VI_TRI_MOC = ["Vào 1", "Ra 1", "Vào 2", "Ra 2"] as const;

/** Vị trí CHẴN là VÀO, LẺ là RA — thứ tự [vào1, ra1, vào2, ra2]. */
export function huongCuaViTri(i: number): "CHECK_IN" | "CHECK_OUT" {
  return i % 2 === 0 ? "CHECK_IN" : "CHECK_OUT";
}

/**
 * Lượt CÒN TÍNH công. Xem đầu file — đây là chỗ DUY NHẤT định nghĩa nó.
 *
 * `reviewStatus` là cột NOT NULL mặc định `PENDING`, nên `not: DISMISSED` không nuốt dòng nào
 * vì NULL (Postgres coi `NULL <> x` là NULL ⇒ loại dòng — bẫy đó không áp ở đây).
 */
export const LUOT_CON_TINH = {
  result: "ACCEPTED",
  reviewStatus: { not: "DISMISSED" },
} as const satisfies Prisma.StaffTimeLogWhereInput;

/** Nhãn cho lượt đã bị thay — màn lịch sử in cạnh lượt (gạch ngang). */
export const NHAN_DA_BI_THAY = "đã được thay bằng chỉnh tay — không còn tính công";

export function laLuotDaBiThay(row: { reviewStatus: string }): boolean {
  return row.reviewStatus === "DISMISSED";
}

/** "HH:mm" trên một ngày công (giờ VN) → thời điểm tuyệt đối. */
export function vnTimeOn(workDate: Date, hhmm: string): Date | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return new Date(
    Date.UTC(workDate.getUTCFullYear(), workDate.getUTCMonth(), workDate.getUTCDate(), h - 7, mi),
  );
}

/** Trim, `""`/`undefined` → `null`, cắt các ô trống ở CUỐI (ô trống ở giữa thì giữ chỗ). */
export function chuanHoaMoc(moc: readonly (string | null | undefined)[]): (string | null)[] {
  const out = moc.map((m) => (typeof m === "string" && m.trim() ? m.trim() : null));
  while (out.length > 0 && out[out.length - 1] === null) out.pop();
  return out;
}

/**
 * Số mốc của "đủ bộ" một ca: ca khai 2 cặp quét (`soCapQuetKyVong = 2`, vd `ST`) ⇒ 4 mốc;
 * mọi ca khác (1 cặp, 0 cặp, không xếp ca) ⇒ 2 mốc.
 *
 * Theo `soCapQuetKyVong` chứ KHÔNG theo số đoạn WORK: `CG` có hai đoạn nhưng khai MỘT cặp quét
 * — đúng định nghĩa "buổi" mà engine (`cumQuetKyVong`) và phép suy hướng một nút dùng.
 */
export function soMocCuaCa(soCapQuetKyVong: number | null | undefined): 2 | 4 {
  return soCapQuetKyVong === 2 ? 4 : 2;
}

/**
 * Đơn TIMESHEET_FIX được duyệt thì GHI ĐÈ hay GHI THÊM (chốt 06/10/2026):
 * đơn khai ĐỦ BỘ mốc của ca (liền nhau từ Vào 1) ⇒ `GHI_DE`; thiếu ⇒ `GHI_THEM` (đơn chỉ bổ
 * sung một đầu — ghi đè ở đó là xoá lượt thật của người nộp).
 */
export function cheDoChoDon(moc: readonly (string | null | undefined)[], soMocCa: 2 | 4): CheDoChinhTay {
  const m = chuanHoaMoc(moc);
  const lienNhau = m.every((x) => x !== null);
  return lienNhau && m.length >= soMocCa ? "GHI_DE" : "GHI_THEM";
}

export type MocDaKiem = {
  viTri: number;
  direction: "CHECK_IN" | "CHECK_OUT";
  hhmm: string;
  loggedAt: Date;
};

/**
 * Kiểm danh sách mốc [vào1, ra1, vào2, ra2]. THUẦN — submit đơn, cột "Thay đổi" và đường ghi
 * cùng gọi, để ba nơi không nói khác nhau về một danh sách.
 *
 *   · 1–4 mốc, đúng định dạng "HH:mm";
 *   · mọi mốc có mặt TĂNG DẦN theo vị trí (bao gồm cặp vào < ra);
 *   · `GHI_DE`: không được bỏ trống ô GIỮA — ghi đè bằng [vào1, _, vào2] là dựng một ngày
 *     VÀO–VÀO, engine ghép cặp ra rác. `GHI_THEM` thì cho bỏ trống (đơn chỉ khai giờ ra).
 */
export function kiemDanhSachMoc(
  workDate: Date,
  mocVao: readonly (string | null | undefined)[],
  cheDo: CheDoChinhTay,
): { ok: true; moc: MocDaKiem[] } | { ok: false; error: string } {
  if (mocVao.length > SO_MOC_TOI_DA) {
    return { ok: false, error: `Tối đa ${SO_MOC_TOI_DA} mốc (2 cặp vào–ra)` };
  }
  const moc = chuanHoaMoc(mocVao);
  if (moc.length === 0) return { ok: false, error: "Nhập ít nhất một mốc giờ" };
  if (cheDo === "GHI_DE") {
    const iTrong = moc.findIndex((x) => x === null);
    if (iTrong !== -1) {
      return {
        ok: false,
        error: `Ghi đè phải nhập mốc liền nhau từ Vào 1 — đang bỏ trống ô ${NHAN_VI_TRI_MOC[iTrong]}`,
      };
    }
  }
  const out: MocDaKiem[] = [];
  for (const [viTri, hhmm] of moc.entries()) {
    if (hhmm === null) continue;
    const loggedAt = vnTimeOn(workDate, hhmm);
    if (!loggedAt) return { ok: false, error: `Giờ "${hhmm}" không hợp lệ` };
    const truoc = out[out.length - 1];
    // Ngưỡng là `<=`: hai mốc trùng phút là dữ liệu vô nghĩa (cặp 0 phút), chặn ở đây thay vì
    // để engine tính ra số âm/0 rồi kẹp lại.
    if (truoc && loggedAt <= truoc.loggedAt) {
      const cungCap = truoc.viTri === viTri - 1 && viTri % 2 === 1;
      return {
        ok: false,
        error: cungCap
          ? `Giờ ra (${hhmm}) phải sau giờ vào (${truoc.hhmm}) — ${NHAN_VI_TRI_MOC[viTri]} sau ${NHAN_VI_TRI_MOC[truoc.viTri]}`
          : `${NHAN_VI_TRI_MOC[viTri]} (${hhmm}) phải sau ${NHAN_VI_TRI_MOC[truoc.viTri]} (${truoc.hhmm})`,
      };
    }
    out.push({ viTri, direction: huongCuaViTri(viTri), hhmm, loggedAt });
  }
  return { ok: true, moc: out };
}

/**
 * Điền sẵn ô ghi đè từ các lượt CÒN TÍNH, theo THỨ TỰ GIỜ — bỏ qua chiều Vào/Ra mà máy ghi
 * (chủ dự án 07/10/2026: "bấm ghi đè thì hiển thị lại các khung giờ nhân viên đã quét rồi để
 * qlcs sửa"). Chiều là thứ hay sai nhất (bấm nhầm, một nút suy sai) — chính vì sai nên mới cần
 * ghi đè, nên đợi chiều "đúng khuôn" mới điền là để trống đúng lúc cần điền nhất.
 *
 *   · trùng phút ⇒ giữ một (hai mốc cùng phút thì `kiemDanhSachMoc` chặn);
 *   · ≤ 4 lượt ⇒ điền lần lượt, số ô = max(số mốc của ca, số lượt làm tròn lên chẵn);
 *   · > 4 lượt ⇒ KHÔNG đoán mốc giữa: điền lượt ĐẦU vào Vào 1 và lượt CUỐI vào ô Ra cuối, ô
 *     giữa để trống cho người sửa chọn từ danh sách (nút Ghi đè tự tắt tới khi điền đủ).
 *
 * `canhBao` khác null ⇒ giao diện PHẢI nói ra: điền sẵn một bức tranh không chắc đúng mà im
 * lặng là mời người ta bấm Ghi đè nguyên trạng.
 */
export function mocDienSan(
  taps: readonly { time: string; dir: "IN" | "OUT" }[],
  soMocCa: 2 | 4,
): { moc: string[]; canhBao: string | null } {
  const sapXep = [...taps].sort((a, b) => a.time.localeCompare(b.time));
  const gio: string[] = [];
  for (const t of sapXep) if (gio[gio.length - 1] !== t.time) gio.push(t.time);

  if (gio.length > SO_MOC_TOI_DA) {
    const soO = soMocCa;
    const moc = Array.from({ length: soO }, () => "");
    moc[0] = gio[0]!;
    moc[soO - 1] = gio[gio.length - 1]!;
    return {
      moc,
      canhBao:
        soO === 2
          ? `Có ${gio.length} lượt quét — đã điền lượt đầu và lượt cuối, kiểm lại trước khi lưu.`
          : `Có ${gio.length} lượt quét — đã điền lượt đầu và lượt cuối; điền Ra 1 / Vào 2 theo danh sách trên.`,
    };
  }

  const soO = Math.max(soMocCa, gio.length + (gio.length % 2));
  const moc = Array.from({ length: soO }, (_, i) => gio[i] ?? "");
  const chieuLech = sapXep.length > 0 && gio.some((g, i) => sapXep.find((t) => t.time === g)!.dir !== (i % 2 === 0 ? "IN" : "OUT"));
  return {
    moc,
    canhBao: chieuLech
      ? "Máy ghi chiều Vào/Ra chưa khớp — đã điền theo thứ tự giờ, kiểm lại trước khi lưu."
      : null,
  };
}

/**
 * "vào 08:00, ra 17:30" (đơn hai mốc) hoặc "vào 1 08:00, ra 1 11:30, vào 2 13:30, ra 2 17:30"
 * — câu thông báo / cột "Thay đổi" đọc được bằng mắt. Số thứ tự chỉ hiện khi có mốc lần 2:
 * đơn hai mốc mà in "vào 1" là bắt người đọc đi tìm "vào 2" không tồn tại.
 */
export function moTaMoc(moc: readonly (string | null | undefined)[]): string {
  const m = chuanHoaMoc(moc);
  const coLan2 = m.length > 2;
  return m
    .flatMap((x, i) => {
      if (!x) return [];
      const nhan = coLan2 ? NHAN_VI_TRI_MOC[i]!.toLowerCase() : huongCuaViTri(i) === "CHECK_IN" ? "vào" : "ra";
      return [`${nhan} ${x}`];
    })
    .join(", ");
}

export type DungDongInput = {
  userId: string;
  /** Cơ sở CHỊU CÔNG của ngày đó — không phải cơ sở của người bấm. */
  centerId: string;
  orgUnitId: string | null;
  /** Ngày công, mốc `@db.Date` (nửa đêm UTC). */
  workDate: Date;
  /** "HH:mm" giờ VN theo thứ tự [vào1, ra1, vào2, ra2]; `null` = ô trống. */
  moc: readonly (string | null)[];
  /** BẮT BUỘC (luật 7). Quyết luật kiểm "ô trống giữa"; phép đánh dấu lượt cũ ở `ghiDongChinhTay`. */
  cheDo: CheDoChinhTay;
  /** Người bấm — vào `reviewedById`. */
  actorId: string;
  now: Date;
  /** Lý do; vào `reviewNote`. */
  lyDo: string | null;
  canCu: CanCuSuaGio;
};

export type DungDongKetQua =
  | { ok: true; rows: Prisma.StaffTimeLogCreateManyInput[] }
  | { ok: false; error: string };

/**
 * Cờ đánh dấu dòng do người dựng chứ không do máy quét. Engine và màn đều đọc cờ này.
 * Đặt tên hằng thay vì rải chuỗi: hai đường cùng dùng, lệch một ký tự là lệch câm.
 */
export const CO_CHINH_TAY = "CHINH_TAY";

export function dungDongChinhTay(input: DungDongInput): DungDongKetQua {
  if (chuanHoaMoc(input.moc).length === 0) {
    return {
      ok: false,
      error:
        input.canCu.kieu === "DON"
          ? "Đơn không có giờ vào/ra để ghi"
          : "Nhập ít nhất một mốc giờ (vào hoặc ra)",
    };
  }
  const kiem = kiemDanhSachMoc(input.workDate, input.moc, input.cheDo);
  if (!kiem.ok) return kiem;

  const rows: Prisma.StaffTimeLogCreateManyInput[] = kiem.moc.map((m) => ({
    userId: input.userId,
    centerId: input.centerId,
    orgUnitId: input.orgUnitId,
    direction: m.direction,
    loggedAt: m.loggedAt,
    workDate: input.workDate,
    source: "MANUAL_ADJUST",
    // ACCEPTED + CONFIRMED: dòng này do người có quyền dựng, nó không phải một lượt quét
    // chờ duyệt. Để PENDING là nó nằm trong hàng chờ của chính người vừa tạo ra nó.
    result: "ACCEPTED",
    reviewStatus: "CONFIRMED",
    reviewedById: input.actorId,
    reviewedAt: input.now,
    reviewNote: input.lyDo?.trim() || null,
    adjustRequestId: input.canCu.kieu === "DON" ? input.canCu.requestId : null,
    flags: [CO_CHINH_TAY],
  }));
  return { ok: true, rows };
}

/** Câu ghi vào `reviewNote` của lượt bị thay — "ai/khi nào" nằm ở `reviewedById/At`. */
export function ghiChuDaBiThay(input: {
  lyDo: string | null;
  canCu: CanCuSuaGio;
  ghiChuCu: string | null;
}): string {
  const goc = input.canCu.kieu === "DON" ? `Đã được thay theo đơn chỉnh công ${input.canCu.requestId}` : "Đã được thay bằng chỉnh tay";
  const lyDo = input.lyDo?.trim();
  const cu = input.ghiChuCu?.trim();
  // Lượt bị thay có thể CHÍNH LÀ một lượt chỉnh tay cũ mang lý do riêng — giữ lại phía sau,
  // không đè mất căn cứ của lần sửa trước.
  return [goc + (lyDo ? `: ${lyDo}` : ""), cu ? `trước đó: ${cu}` : null].filter(Boolean).join(" · ").slice(0, 1000);
}

/** Một lượt vừa bị đánh dấu thay thế — chụp TRƯỚC khi đánh dấu, cho audit "before". */
export type LuotBiThay = {
  id: string;
  direction: string;
  loggedAt: Date;
  source: string;
  flags: string[];
  centerId: string;
  adjustRequestId: string | null;
  reviewedById: string | null;
  reviewNote: string | null;
  /** Đợt 11: trạng thái rà TRƯỚC khi bị thay — huỷ đơn chỉnh công trả về đúng trạng thái này. */
  reviewStatus: string;
  reviewedAt: Date | null;
};

/**
 * Client đủ cho phép ghi. Chỉ hai thứ cần — để cả `db.$transaction` lẫn
 * `scopedDb(..., { bypass: true }).$transaction` truyền vào được.
 */
export type TxGhiChinhTay = Pick<Prisma.TransactionClient, "staffTimeLog" | "$executeRaw">;

/**
 * GHI một lượt chỉnh tay. PHẢI gọi bên trong `$transaction`, SAU mọi cổng (quyền, kỳ đã chốt,
 * lý do) — hàm này là phép ghi đầu tiên, không còn cổng nào phía sau nó (CLAUDE.md, luật
 * rollback: cổng đứng trước phép ghi đầu tiên).
 *
 * ⚠️ `tx` phải KHÔNG scope (đọc được MỌI lượt của ngày). `scopedDb` lọc lượt quét theo cơ sở
 * NƠI QUÉT, trong khi engine tính công trên TOÀN BỘ lượt của người đó trong ngày (`recompute`
 * không lọc cơ sở). Đọc qua scope là bỏ sót lượt quét ở cơ sở khác — nó KHÔNG bị đánh dấu thay
 * và vẫn vào công, lặng im.
 *
 * Khoá tư vấn theo (người, ngày): hai lượt ghi đè cùng lúc mà không khoá thì mỗi bên đánh dấu
 * bức tranh nó đọc được, và cả hai bộ mốc mới cùng sống.
 */
export async function ghiDongChinhTay(
  tx: TxGhiChinhTay,
  input: {
    userId: string;
    workDate: Date;
    cheDo: CheDoChinhTay;
    rows: Prisma.StaffTimeLogCreateManyInput[];
    actorId: string;
    now: Date;
    lyDo: string | null;
    canCu: CanCuSuaGio;
  },
): Promise<{ thayThe: LuotBiThay[] }> {
  const khoa = `chinh-tay:${input.userId}:${input.workDate.toISOString().slice(0, 10)}`;
  // `$executeRaw`, KHÔNG `$queryRaw`: hàm trả `void`, Prisma không giải mã được cột void.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${khoa})::bigint)`;

  let thayThe: LuotBiThay[] = [];
  if (input.cheDo === "GHI_DE") {
    thayThe = await tx.staffTimeLog.findMany({
      where: { userId: input.userId, workDate: input.workDate, ...LUOT_CON_TINH },
      select: {
        id: true,
        direction: true,
        loggedAt: true,
        source: true,
        flags: true,
        centerId: true,
        adjustRequestId: true,
        reviewedById: true,
        reviewNote: true,
        reviewStatus: true,
        reviewedAt: true,
      },
      orderBy: { loggedAt: "asc" },
    });
    // Từng dòng một vì `reviewNote` giữ lại ghi chú CŨ của chính dòng đó. Một ngày có vài lượt
    // nên chi phí không đáng kể; đổi lại không mất căn cứ của lần sửa trước.
    for (const l of thayThe) {
      const r = await tx.staffTimeLog.updateMany({
        where: { id: l.id, ...LUOT_CON_TINH },
        data: {
          reviewStatus: "DISMISSED",
          reviewedById: input.actorId,
          reviewedAt: input.now,
          reviewNote: ghiChuDaBiThay({ lyDo: input.lyDo, canCu: input.canCu, ghiChuCu: l.reviewNote }),
        },
      });
      // Có khoá tư vấn nên không thể xảy ra — nếu xảy ra thì bức tranh vừa đọc đã cũ, và ghi
      // tiếp là ghi đè lên thứ mình chưa thấy. `throw` để rollback cả lượt.
      if (r.count !== 1) throw new Error("Lượt quét của ngày vừa thay đổi — tải lại rồi thử lại");
    }
  }

  await tx.staffTimeLog.createMany({ data: input.rows });
  return { thayThe };
}
