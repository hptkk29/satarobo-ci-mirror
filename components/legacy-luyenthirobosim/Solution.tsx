"use client";

import Image from "next/image";

const compareRows = [
  {
    feature: "Người hướng dẫn",
    free: "Tự mò trên Youtube — không có thầy chỉ",
    course: "Giảng viên chỉ MẸO + TRICK chuyên môn",
  },
  {
    feature: "Kết quả học",
    free: "Cùng cách làm như đa số → cùng kết quả như đa số",
    course: "Cách làm khác đa số → kết quả khác đa số",
  },
  {
    feature: "Vị trí thi",
    free: "Đứng chung vạch với hàng nghìn bạn khác",
    course: "Vượt lên trước — vào nhóm TOP đi tiếp",
  },
  {
    feature: "Kết quả thi",
    free: "BTC cắt top — đa số rơi vào nhóm BỊ LOẠI",
    course: "PASS vòng loại — bước vào sân chơi khu vực",
  },
];

export default function Solution() {
  return (
    <section className="lp-solution section" id="solution" aria-labelledby="solution-heading">
      <div className="container">
        <h2 id="solution-heading" className="section-title text-center">
          ĐÂY LÀ LÝ DO PHỤ HUYNH TINH Ý<br />
          <span className="gradient-text">CHỌN KHOÁ LUYỆN THI ROBOSIM CHO CON</span>
        </h2>
        <p className="section-subtitle text-center">
          Bố mẹ không cần biết kỹ thuật.<br />
          Chỉ cần biết: con đang ở đâu — và sau khoá học, con sẽ ở đâu.
        </p>

        <div className="lp-solution__grid">
          <div className="lp-solution__content">
            <h3 className="lp-solution__sub-heading">
              🤖 Khoá Luyện Thi không chỉ giải đề. Khoá Luyện Thi <em>GIẢI TỐI ƯU</em>.
            </h3>
            <p className="lp-solution__context">
              Cùng 1 đề thi vòng loại RBT2026. Cùng 180 phút. Cùng phần mềm RoboSim.<br />
              Khác biệt nằm ở <strong>4 điều — chỉ giảng viên chuyên môn mới có:</strong>
            </p>
            <ul className="lp-solution__points" role="list">
              <li>
                <span className="lp-solution__point-icon" aria-hidden="true">⚙️</span>
                <div>
                  <strong>CÁCH DI CHUYỂN robot NHANH nhất, CHÍNH XÁC nhất.</strong>
                  <span> (Mỗi giây tiết kiệm = thêm 1 điểm có thể ăn được.)</span>
                </div>
              </li>
              <li>
                <span className="lp-solution__point-icon" aria-hidden="true">🎯</span>
                <div>
                  <strong>TRICK + MẸO không có trên Youtube — không có ở khoá free.</strong>
                  <span> (Đây là kỹ thuật giảng viên tích luỹ qua nhiều mùa thi.)</span>
                </div>
              </li>
              <li>
                <span className="lp-solution__point-icon" aria-hidden="true">📋</span>
                <div>
                  <strong>HƯỚNG DẪN từng bước trong video — con xem 1 lần là làm được.</strong>
                  <span> (Không cần bố mẹ kèm. Không cần thầy cô đứng cạnh.)</span>
                </div>
              </li>
              <li>
                <span className="lp-solution__point-icon" aria-hidden="true">⏱️</span>
                <div>
                  <strong>RÈN PHẢN XẠ trong RoboSim —</strong>
                  <span> đến phòng thi 180 phút, con chỉ cần LẶP LẠI thao tác đã quen tay.</span>
                </div>
              </li>
            </ul>
          </div>
          <div className="lp-solution__visual">
            <Image
              src="/luyenthirobosim/demo_robosim.png"
              alt="Sa bàn RoboSim — giao diện phần mềm thi vòng loại RBT2026"
              className="lp-solution__img"
              loading="lazy"
              width={1912}
              height={989}
            />
          </div>
        </div>

        <div style={{ marginTop: 48 }}>
          <h3
            style={{
              fontSize: 16,
              fontWeight: 800,
              color: "var(--text-primary)",
              marginBottom: 20,
              textAlign: "center",
            }}
          >
            📊 Khác biệt giữa &ldquo;tự luyện free&rdquo; và &ldquo;học khoá luyện thi&rdquo;:
          </h3>

          <div
            style={{
              borderRadius: 20,
              overflow: "hidden",
              boxShadow: "0 4px 24px rgba(91,45,142,0.10)",
              border: "1px solid rgba(91,45,142,0.10)",
            }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
              <div
                style={{
                  background: "linear-gradient(135deg, #fee2e2, #fef3c7)",
                  padding: "14px 16px",
                  textAlign: "center",
                  borderRight: "1px solid rgba(255,255,255,0.6)",
                }}
              >
                <span style={{ fontSize: 18 }}>❌</span>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 800,
                    color: "#b91c1c",
                    marginTop: 4,
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                  }}
                >
                  Học Free
                </div>
              </div>
              <div
                style={{
                  background: "linear-gradient(135deg, #d1fae5, #ede9fe)",
                  padding: "14px 16px",
                  textAlign: "center",
                }}
              >
                <span style={{ fontSize: 18 }}>✅</span>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 800,
                    color: "#065f46",
                    marginTop: 4,
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                  }}
                >
                  Học Khoá Luyện Thi
                </div>
              </div>
            </div>

            {compareRows.map((row, i) => (
              <div key={i}>
                <div
                  style={{
                    background: i % 2 === 0 ? "#f8f7ff" : "#fafafa",
                    padding: "8px 16px",
                    borderTop: "1px solid rgba(91,45,142,0.08)",
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      color: "var(--purple)",
                      textTransform: "uppercase",
                      letterSpacing: 0.8,
                    }}
                  >
                    {row.feature}
                  </span>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    background: i % 2 === 0 ? "#f8f7ff" : "#fafafa",
                  }}
                >
                  <div
                    style={{
                      padding: "12px 14px",
                      borderRight: "1px solid rgba(91,45,142,0.08)",
                      fontSize: 13,
                      color: "#6B5A8A",
                      lineHeight: 1.6,
                      background: "rgba(254,226,226,0.25)",
                    }}
                  >
                    {row.free}
                  </div>
                  <div
                    style={{
                      padding: "12px 14px",
                      fontSize: 13,
                      fontWeight: 600,
                      color: "#064e3b",
                      lineHeight: 1.6,
                      background: "rgba(209,250,229,0.30)",
                    }}
                  >
                    {row.course}
                  </div>
                </div>
              </div>
            ))}

            <div
              style={{
                background: "linear-gradient(135deg, #5B2D8E, #7C3AED)",
                padding: "14px 20px",
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
              }}
            >
              <div
                style={{
                  textAlign: "center",
                  color: "rgba(255,255,255,0.7)",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                😔 Đứng cùng đám đông
              </div>
              <div
                style={{
                  textAlign: "center",
                  color: "#fff",
                  fontSize: 12,
                  fontWeight: 800,
                }}
              >
                🏆 VƯỢT LÊN — PASS!
              </div>
            </div>
          </div>
        </div>

        <p className="lp-solution__soft-cta">
          👉 Con bố mẹ ở bảng nào?{" "}
          <a href="#courses" aria-label="Xem chi tiết khoá học R1 và R2">
            Xem chi tiết khoá học bên dưới ↓
          </a>
        </p>
      </div>
    </section>
  );
}
