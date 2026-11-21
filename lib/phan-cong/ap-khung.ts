// lib/phan-cong/ap-khung.ts — LẬP KẾ HOẠCH "Áp khung lịch" (GĐ4, docs/phan-cong-gop/KHAO-SAT.md chốt 13). THUẦN — không DB, không đồng hồ.
//
// Khung = MỘT tuần mẫu của cơ sở: ai trực ca nào thứ mấy, ai đứng chính / trợ giảng lớp nào thứ mấy. Áp khung = chép khung đó sang các
// tuần đích. Hàm này chỉ trả DANH SÁCH BƯỚC; thực thi ở `ap-khung-db.ts` qua cửa ghi sẵn có (nguồn `AP_KHUNG`).
//
// Luật (prompt GĐ4 + mặc định QUYET-DINH-DEM G4-*):
//   · bỏ qua ngày ≤ hôm nay (không viết lại hôm nay / quá khứ);
//   · KHÔNG chép học bù / Trial (chỉ lớp chính thức + trực);
//   · buổi lớp đích khớp mẫu theo (lớp, thứ trong tuần, giờ bắt đầu) — lớp không có buổi ở ngày đích thì thôi;
//   · `BO_SUNG`: chỉ thêm (trực chưa có · vai còn trống / khác mẫu thì THAY); `GHI_DE`: như bổ sung + GỠ ca trực thừa (người có trực ở
//     đích mà mẫu không có, trong phạm vi giáo viên được chọn);
//   · `giaoVien` null = mọi người trong mẫu; có danh sách ⇒ chỉ đụng những người đó.

export type CheDoApKhung = "BO_SUNG" | "GHI_DE";

export type MauTuan = {
  truc: readonly { userId: string; thu: number; ca: string }[];
  phanCong: readonly { userId: string; classId: string; thu: number; gioBatDau: string; role: "MAIN_TEACHER" | "TEACHING_ASSISTANT" }[];
};

export type DichApKhung = {
  ngays: readonly string[];
  buoiLop: readonly { sourceId: string; classId: string; ngay: string; gioBatDau: string; mo: boolean; main: string | null; ta: readonly string[] }[];
  truc: readonly { id: string; userId: string; ngay: string; ca: string }[];
};

export type BuocApKhung =
  | { loai: "GIAO_TRUC"; userId: string; ngay: string; ca: string }
  | { loai: "GO_TRUC"; dutyId: string; userId: string; ngay: string; ca: string }
  | { loai: "DAT_NGUOI"; sourceId: string; ngay: string; role: "MAIN_TEACHER" | "TEACHING_ASSISTANT"; userId: string; boUserId: string | null };

/** 1 = Thứ Hai … 7 = Chủ nhật (ISO) của ngày "YYYY-MM-DD". */
export const thuCua = (ymd: string) => ((new Date(`${ymd}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;

/**
 * Chia các bước theo TUẦN đích (Thứ Hai → Chủ nhật, theo ngày "YYYY-MM-DD" đã là giờ VN) — mỗi tuần một giao dịch (chốt lượt 2 điểm 5).
 * Tuần tăng dần; trong tuần GIỮ thứ tự của kế hoạch (gỡ trước giao như `keHoachApKhung` đã xếp).
 */
export function chiaBuocTheoTuan(buoc: readonly BuocApKhung[]): { thuHai: string; buoc: BuocApKhung[] }[] {
  const theoTuan = new Map<string, BuocApKhung[]>();
  for (const b of buoc) {
    const d = new Date(`${b.ngay}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - (thuCua(b.ngay) - 1));
    const k = d.toISOString().slice(0, 10);
    theoTuan.set(k, [...(theoTuan.get(k) ?? []), b]);
  }
  return [...theoTuan.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([thuHai, ds]) => ({ thuHai, buoc: ds }));
}

export function keHoachApKhung(p: {
  mau: MauTuan;
  dich: DichApKhung;
  giaoVien: readonly string[] | null;
  cheDo: CheDoApKhung;
  /** "YYYY-MM-DD" giờ VN. BẮT BUỘC (luật 7). */
  homNay: string;
}): { buoc: BuocApKhung[]; boQuaNgay: string[]; xungDot: { sourceId: string; ngay: string; userId: string; lyDo: string }[] } {
  const chon = (u: string) => p.giaoVien == null || p.giaoVien.includes(u);
  const buoc: BuocApKhung[] = [];
  const boQuaNgay: string[] = [];
  const xungDot: { sourceId: string; ngay: string; userId: string; lyDo: string }[] = [];
  for (const ngay of p.dich.ngays) {
    if (ngay <= p.homNay) {
      boQuaNgay.push(ngay);
      continue;
    }
    const thu = thuCua(ngay);
    // Trực.
    const mauTruc = p.mau.truc.filter((t) => t.thu === thu && chon(t.userId));
    const dichTruc = p.dich.truc.filter((t) => t.ngay === ngay);
    for (const t of mauTruc) if (!dichTruc.some((d) => d.userId === t.userId && d.ca === t.ca)) buoc.push({ loai: "GIAO_TRUC", userId: t.userId, ngay, ca: t.ca });
    if (p.cheDo === "GHI_DE") {
      for (const d of dichTruc) if (chon(d.userId) && !mauTruc.some((t) => t.userId === d.userId && t.ca === d.ca)) buoc.push({ loai: "GO_TRUC", dutyId: d.id, userId: d.userId, ngay, ca: d.ca });
    }
    // Lớp chính thức.
    for (const m of p.mau.phanCong.filter((x) => x.thu === thu && chon(x.userId))) {
      const b = p.dich.buoiLop.find((x) => x.ngay === ngay && x.classId === m.classId && x.gioBatDau === m.gioBatDau && x.mo);
      if (!b) continue;
      // Một người không hai vai trong buổi: người mẫu đang giữ vai KIA ở buổi đích ⇒ không đoán đổi vai, báo để QLCS xem.
      const vaiKia = m.role === "MAIN_TEACHER" ? b.ta.includes(m.userId) : b.main === m.userId;
      if (vaiKia) {
        xungDot.push({ sourceId: b.sourceId, ngay, userId: m.userId, lyDo: "Người này đang giữ vai khác ở buổi đích" });
        continue;
      }
      if (m.role === "MAIN_TEACHER") {
        if (b.main !== m.userId) buoc.push({ loai: "DAT_NGUOI", sourceId: b.sourceId, ngay, role: m.role, userId: m.userId, boUserId: b.main });
      } else if (!b.ta.includes(m.userId)) {
        // Trợ giảng: thay người ĐANG giữ (một trợ giảng / buổi trên màn gộp); không có ai thì thêm.
        buoc.push({ loai: "DAT_NGUOI", sourceId: b.sourceId, ngay, role: m.role, userId: m.userId, boUserId: b.ta[0] ?? null });
      }
    }
  }
  return { buoc, boQuaNgay, xungDot };
}
