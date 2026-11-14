"use client";

// Khung chat "Hỏi Sata Robo" trên website (chủ dự án chốt 06/11/2026).
// · Hỏi đáp: gửi CẢ cuộc trò chuyện tới /api/public/chatbot (máy chủ không lưu gì); trình duyệt giữ lịch sử.
// · Để lại thông tin: BIỂU MẪU (bắt buộc tên + SĐT + cơ sở, ô đồng ý chính sách) gửi thẳng /api/leads — đúng
//   đường form /lien-he và modal tư vấn đang đi ⇒ qua hệ thống chia lead hiện tại. Chatbot không nhận SĐT trong chat.

import { useEffect, useRef, useState } from "react";
import { canonicalPhone, isValidPhoneVN } from "@/lib/phone";
import { readAttribution } from "@/lib/marketing/attribution";
import { SATA_ROBO_PHONE } from "@/lib/locations";
import { OTichChinhSach } from "@/components/public/o-tich-chinh-sach";
import {
  CAU_CHAO,
  CAU_DU_PHONG,
  DO_DAI_TIN_TOI_DA,
  GOI_Y_NHANH,
  NGUON_LEAD_CHATBOT,
  SO_LUOT_HOI_TOI_DA,
  dungGhiChuLead,
} from "@/lib/chatbot/noi-dung";
import { ghiDaGui } from "@/components/public/popup-hen-gio";
import { phatTinHieuChatbot } from "./tin-hieu";

export type CoSoChatbot = { code: string; name: string; address: string };
export type DuLieuChatbot = { coSo: CoSoChatbot[]; khoaQuanTam: string[] };

type Tin = { role: "user" | "assistant"; content: string };

const LOP = ["Lớp 1", "Lớp 2", "Lớp 3", "Lớp 4", "Lớp 5", "Lớp 6", "Lớp 7", "Lớp 8", "Lớp 9", "Chưa đi học"];

const o = {
  khung: {
    position: "fixed", right: 16, bottom: "calc(16px + var(--nang-banner, 0px))", zIndex: 90,
    width: "min(380px, calc(100vw - 16px))", height: "min(580px, calc(100dvh - 32px))",
    display: "flex", flexDirection: "column", background: "var(--panel, #fff)", color: "var(--text, #241133)",
    border: "1px solid var(--line2, #e5e5e5)", borderRadius: 18, boxShadow: "0 24px 60px rgba(0,0,0,.25)", overflow: "hidden",
  },
  dau: { display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: "linear-gradient(135deg,#7c3aed,#fe8f2d)", color: "#fff" },
  than: { flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 8 },
  tinBot: { alignSelf: "flex-start", maxWidth: "85%", background: "var(--bg2, #f4f1fa)", borderRadius: "14px 14px 14px 4px", padding: "8px 12px", fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap" },
  tinPh: { alignSelf: "flex-end", maxWidth: "85%", background: "#7c3aed", color: "#fff", borderRadius: "14px 14px 4px 14px", padding: "8px 12px", fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap" },
  chip: { border: "1px solid var(--line2, #ddd)", borderRadius: 999, padding: "6px 10px", fontSize: 13, background: "transparent", color: "inherit", cursor: "pointer", textAlign: "left" },
  day: { borderTop: "1px solid var(--line2, #eee)", padding: 10, display: "flex", flexDirection: "column", gap: 8 },
  o: { width: "100%", border: "1px solid var(--line2, #ddd)", borderRadius: 10, padding: "9px 11px", fontSize: 14, background: "var(--panel, #fff)", color: "inherit" },
  nutChinh: { border: 0, borderRadius: 10, padding: "10px 12px", fontSize: 14, fontWeight: 700, background: "#fe8f2d", color: "#241133", cursor: "pointer" },
  nutPhu: { border: "1px solid #7c3aed", borderRadius: 10, padding: "9px 12px", fontSize: 14, fontWeight: 700, background: "transparent", color: "#7c3aed", cursor: "pointer" },
  nhan: { fontSize: 13, fontWeight: 600 },
  loi: { color: "#dc2626", fontSize: 12 },
} satisfies Record<string, React.CSSProperties>;

export function ChatbotWidget({ du, mo, onDong }: { du: DuLieuChatbot; mo: boolean; onDong: () => void }) {
  const [tin, setTin] = useState<Tin[]>([]);
  const [nhap, setNhap] = useState("");
  const [dangGui, setDangGui] = useState(false);
  const [che, setChe] = useState<"chat" | "form" | "xong">("chat");
  const cuoiRef = useRef<HTMLDivElement>(null);
  const oNhapRef = useRef<HTMLTextAreaElement>(null);

  const soLuotHoi = tin.filter((t) => t.role === "user").length;
  const hetLuot = soLuotHoi >= SO_LUOT_HOI_TOI_DA;

  useEffect(() => {
    cuoiRef.current?.scrollIntoView({ block: "end" });
  }, [tin, dangGui, che]);
  // Đang chat ⇒ popup học thử không được bật đè lên (chủ dự án 07/11/2026).
  // CHỈ phát khi mở thật (và "đóng" khi đóng đúng lần mở đó): phát `mo:false` lúc trang vừa tải là đẩy hẹn giờ lần đầu
  // của popup từ 20 giây thành 60 giây dù khách chưa hề mở chat.
  useEffect(() => {
    if (!mo) return;
    phatTinHieuChatbot({ mo: true });
    return () => phatTinHieuChatbot({ mo: false });
  }, [mo]);
  useEffect(() => {
    if (!mo) return;
    if (che === "chat") oNhapRef.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onDong();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [mo, che, onDong]);

  if (!mo) return null;

  async function gui(noiDung: string) {
    const c = noiDung.trim().slice(0, DO_DAI_TIN_TOI_DA);
    if (!c || dangGui || hetLuot) return;
    const lichSu: Tin[] = [...tin, { role: "user", content: c }];
    setTin(lichSu);
    setNhap("");
    setDangGui(true);
    let traLoi = CAU_DU_PHONG;
    try {
      const res = await fetch("/api/public/chatbot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: lichSu }),
      });
      const j = (await res.json().catch(() => null)) as { traLoi?: string } | null;
      if (j?.traLoi) traLoi = j.traLoi;
    } catch {
      /* mạng lỗi ⇒ câu dự phòng */
    }
    setTin([...lichSu, { role: "assistant", content: traLoi }]);
    setDangGui(false);
  }

  return (
    <div role="dialog" aria-modal="false" aria-label="Hỏi Sata Robo" style={o.khung} data-testid="chatbot-khung">
      <div style={o.dau}>
        <div style={{ flex: 1 }}>
          <b style={{ fontSize: 15 }}>Hỏi Sata Robo</b>
          <div style={{ fontSize: 12, opacity: 0.9 }}>Trợ lý AI · tư vấn viên sẽ gọi lại khi ba mẹ cần</div>
        </div>
        <button type="button" onClick={onDong} aria-label="Đóng" style={{ background: "rgba(255,255,255,.2)", border: 0, color: "#fff", width: 30, height: 30, borderRadius: 999, cursor: "pointer", fontSize: 18 }}>
          ×
        </button>
      </div>

      {che === "chat" && (
        <>
          <div style={o.than} aria-live="polite">
            <div style={o.tinBot}>{CAU_CHAO}</div>
            {tin.length === 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
                {GOI_Y_NHANH.map((g) => (
                  <button key={g} type="button" style={o.chip} onClick={() => gui(g)}>
                    {g}
                  </button>
                ))}
              </div>
            )}
            {tin.map((t, i) => (
              <div key={i} style={t.role === "user" ? o.tinPh : o.tinBot}>
                {t.content}
              </div>
            ))}
            {dangGui && <div style={{ ...o.tinBot, opacity: 0.7 }}>Sata Robo đang trả lời…</div>}
            {hetLuot && <div style={o.tinBot}>Ba mẹ để lại thông tin để tư vấn viên gọi lại giải đáp kỹ hơn nhé!</div>}
            <div ref={cuoiRef} />
          </div>
          <div style={o.day}>
            <button type="button" style={o.nutChinh} onClick={() => setChe("form")} data-testid="chatbot-de-lai-thong-tin">
              Để lại thông tin — tư vấn viên gọi lại
            </button>
            <form
              style={{ display: "flex", gap: 6 }}
              onSubmit={(e) => {
                e.preventDefault();
                void gui(nhap);
              }}
            >
              <textarea
                ref={oNhapRef}
                rows={1}
                value={nhap}
                maxLength={DO_DAI_TIN_TOI_DA}
                disabled={dangGui || hetLuot}
                placeholder={hetLuot ? "Đã hết lượt hỏi" : "Nhập câu hỏi…"}
                aria-label="Câu hỏi"
                onChange={(e) => setNhap(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void gui(nhap);
                  }
                }}
                style={{ ...o.o, resize: "none" }}
              />
              <button type="submit" disabled={dangGui || hetLuot || !nhap.trim()} style={{ ...o.nutPhu, padding: "0 12px" }}>
                Gửi
              </button>
            </form>
          </div>
        </>
      )}

      {che === "form" && (
        <FormThongTin
          du={du}
          cauHoi={tin.filter((t) => t.role === "user").map((t) => t.content)}
          onQuayLai={() => setChe("chat")}
          onXong={() => setChe("xong")}
        />
      )}

      {che === "xong" && (
        <div style={{ ...o.than, justifyContent: "center", textAlign: "center", gap: 10 }}>
          <div style={{ fontSize: 40 }}>🎉</div>
          <b>Cảm ơn ba mẹ!</b>
          <p style={{ margin: 0, fontSize: 14 }}>Tư vấn viên Sata Robo sẽ gọi lại sớm. Cần gấp ba mẹ gọi/nhắn Zalo {SATA_ROBO_PHONE.hien}.</p>
          <button type="button" style={o.nutPhu} onClick={onDong}>
            Đóng
          </button>
        </div>
      )}
    </div>
  );
}

function FormThongTin({
  du,
  cauHoi,
  onQuayLai,
  onXong,
}: {
  du: DuLieuChatbot;
  cauHoi: string[];
  onQuayLai: () => void;
  onXong: () => void;
}) {
  const [ten, setTen] = useState("");
  const [sdt, setSdt] = useState("");
  const [coSo, setCoSo] = useState(du.coSo.length === 1 ? du.coSo[0].code : "");
  const [lop, setLop] = useState("");
  const [khoa, setKhoa] = useState("");
  const [diaChi, setDiaChi] = useState("");
  const [dongY, setDongY] = useState(false);
  const [web, setWeb] = useState(""); // honeypot
  const [loi, setLoi] = useState<Record<string, string>>({});
  const [dangGui, setDangGui] = useState(false);
  const moLuc = useRef(Date.now());
  const eventId = useRef(`chatbot-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

  async function gui(e: React.FormEvent) {
    e.preventDefault();
    if (dangGui) return;
    const l: Record<string, string> = {};
    if (ten.trim().length < 2) l.ten = "Vui lòng nhập họ tên (ít nhất 2 ký tự)";
    if (!isValidPhoneVN(sdt)) l.sdt = "Số điện thoại không hợp lệ (VD: 0905123456)";
    if (!coSo) l.coSo = "Vui lòng chọn cơ sở";
    if (!dongY) l.dongY = "Vui lòng đồng ý Chính sách bảo mật";
    setLoi(l);
    if (Object.keys(l).length) return;

    setDangGui(true);
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parentName: ten.trim(),
          phone: canonicalPhone(sdt) ?? sdt.trim(),
          centerCode: coSo,
          source: NGUON_LEAD_CHATBOT,
          note: dungGhiChuLead({ lopCuaCon: lop || null, khoaQuanTam: khoa || null, diaChi: diaChi || null }, cauHoi),
          consentMarketing: true,
          dongYChinhSachBaoMat: true,
          eventId: eventId.current,
          landingPage: window.location.href,
          referrer: document.referrer || undefined,
          ...readAttribution(),
          // Thời gian tính từ lúc vào trang (phụ huynh đã đọc + chat trước khi mở form), không phải từ lúc mở form.
          timeOnPage: Math.max(Math.floor(performance.now() / 1000), Math.floor((Date.now() - moLuc.current) / 1000)),
          website: web,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) throw new Error(j.error ?? "Lỗi hệ thống");
      if (typeof window.fbq === "function") {
        window.fbq("track", "Lead", { content_name: "Chatbot website", value: 0, currency: "VND" }, { eventID: eventId.current });
      }
      // Đã để lại thông tin ⇒ popup học thử coi như đã gửi form (cùng khoá với form popup), không mời lại.
      ghiDaGui(window.localStorage);
      phatTinHieuChatbot({ daGui: true });
      onXong();
    } catch (err) {
      setLoi({ chung: err instanceof Error && err.message !== "Lỗi hệ thống" ? err.message : `Chưa gửi được. Ba mẹ thử lại hoặc gọi ${SATA_ROBO_PHONE.hien} nhé.` });
    } finally {
      setDangGui(false);
    }
  }

  return (
    <form onSubmit={gui} style={{ ...o.than, gap: 10 }} noValidate data-testid="chatbot-form">
      <p style={{ margin: 0, fontSize: 14 }}>Ba mẹ để lại thông tin, tư vấn viên của cơ sở sẽ gọi lại tư vấn học phí và xếp buổi học thử miễn phí.</p>

      <label style={o.nhan}>
        Họ tên phụ huynh *
        <input style={o.o} value={ten} onChange={(e) => setTen(e.target.value)} autoComplete="name" maxLength={100} />
        {loi.ten && <span style={o.loi}>{loi.ten}</span>}
      </label>
      <label style={o.nhan}>
        Số điện thoại *
        <input style={o.o} value={sdt} onChange={(e) => setSdt(e.target.value)} inputMode="tel" autoComplete="tel" maxLength={15} />
        {loi.sdt && <span style={o.loi}>{loi.sdt}</span>}
      </label>
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        <legend style={{ ...o.nhan, marginBottom: 4 }}>Cơ sở gần nhà *</legend>
        {du.coSo.map((c) => (
          <label key={c.code} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, cursor: "pointer", border: `1px solid ${coSo === c.code ? "#7c3aed" : "var(--line2, #ddd)"}`, borderRadius: 10, padding: "8px 10px" }}>
            <input type="radio" name="chatbot-co-so" value={c.code} checked={coSo === c.code} onChange={() => setCoSo(c.code)} style={{ marginTop: 3 }} />
            <span>
              <b>{c.name}</b>
              <br />
              {c.address}
            </span>
          </label>
        ))}
        {loi.coSo && <span style={o.loi}>{loi.coSo}</span>}
      </fieldset>
      <label style={o.nhan}>
        Con đang học
        <select style={o.o} value={lop} onChange={(e) => setLop(e.target.value)}>
          <option value="">— Chọn lớp —</option>
          {LOP.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </label>
      <label style={o.nhan}>
        Khoá quan tâm
        <select style={o.o} value={khoa} onChange={(e) => setKhoa(e.target.value)}>
          <option value="">— Chọn khoá —</option>
          {du.khoaQuanTam.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </label>
      <label style={o.nhan}>
        Địa chỉ (phường / khu vực)
        <input style={o.o} value={diaChi} onChange={(e) => setDiaChi(e.target.value)} maxLength={120} />
      </label>
      <input tabIndex={-1} autoComplete="off" aria-hidden="true" value={web} onChange={(e) => setWeb(e.target.value)} style={{ position: "absolute", left: -9999, width: 1, height: 1 }} />
      <OTichChinhSach id="chatbot-dong-y" checked={dongY} onChange={(e) => setDongY(e.target.checked)} loi={loi.dongY ?? null} />
      {loi.chung && <span style={o.loi}>{loi.chung}</span>}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" style={{ ...o.nutPhu, flex: 1 }} onClick={onQuayLai}>
          Quay lại
        </button>
        <button type="submit" style={{ ...o.nutChinh, flex: 2 }} disabled={dangGui}>
          {dangGui ? "Đang gửi…" : "Gửi thông tin"}
        </button>
      </div>
    </form>
  );
}
