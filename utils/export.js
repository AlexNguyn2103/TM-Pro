const PDFDocument = require("pdfkit");
const ExcelJS = require("exceljs");
const path = require("path");

const FONT_REGULAR = path.join(
  __dirname,
  "..",
  "assets",
  "fonts",
  "DejaVuSans.ttf",
);
const FONT_BOLD = path.join(
  __dirname,
  "..",
  "assets",
  "fonts",
  "DejaVuSans-Bold.ttf",
);

const STATUS_LABEL = {
  todo: "Cần làm",
  in_progress: "Đang làm",
  submitted: "Chờ duyệt",
  approved: "Hoàn thành",
  rejected: "Bị từ chối",
};

const PRIORITY_LABEL = {
  low: "Thấp",
  medium: "Trung bình",
  high: "Cao",
  urgent: "Khẩn cấp",
};

const ROLE_LABEL = {
  leader: "Nhóm trưởng",
  vice_leader: "Phó nhóm",
  member: "Thành viên",
  custom: "Khác",
};

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("vi-VN");
}

// ============================================================
// PDF Report (pdfkit)
// ============================================================
async function generatePDFReport(res, data) {
  const { project, members, tasks, stats } = data;
  const safeName = (project.name || "project").replace(/[^a-zA-Z0-9_-]+/g, "_");

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="bao-cao-${safeName}.pdf"`,
  );

  const doc = new PDFDocument({ margin: 40, size: "A4" });
  doc.registerFont("Regular", FONT_REGULAR);
  doc.registerFont("Bold", FONT_BOLD);
  doc.pipe(res);

  // ── Header ──
  doc
    .font("Bold")
    .fontSize(20)
    .fillColor("#0a0a1a")
    .text("BÁO CÁO TỔNG KẾT DỰ ÁN", { align: "center" });
  doc.moveDown(0.3);
  doc
    .font("Bold")
    .fontSize(16)
    .fillColor("#0072e0")
    .text(project.name, { align: "center" });
  doc.moveDown(1);

  // ── Project info ──
  doc.font("Bold").fontSize(12).fillColor("#0a0a1a").text("Thông tin dự án");
  doc
    .moveTo(40, doc.y + 2)
    .lineTo(555, doc.y + 2)
    .strokeColor("#cccccc")
    .stroke();
  doc.moveDown(0.5);
  doc.font("Regular").fontSize(10).fillColor("#333333");
  doc.text(`Chủ dự án: ${project.owner_name || "—"}`);
  doc.text(`Mô tả: ${project.description || "—"}`);
  doc.text(`Hạn chót: ${fmtDate(project.deadline)}`);
  doc.text(
    `Trạng thái: ${project.status === "completed" ? "Hoàn thành" : project.status === "archived" ? "Lưu trữ" : "Đang hoạt động"}`,
  );
  doc.text(`Mã tham gia: ${project.invite_code}`);
  doc.text(`Ngày tạo: ${fmtDate(project.created_at)}`);
  doc.text(`Ngày xuất báo cáo: ${fmtDate(new Date())}`);
  doc.moveDown(0.8);

  // ── Overview stats ──
  doc.font("Bold").fontSize(12).fillColor("#0a0a1a").text("Tổng quan tiến độ");
  doc
    .moveTo(40, doc.y + 2)
    .lineTo(555, doc.y + 2)
    .strokeColor("#cccccc")
    .stroke();
  doc.moveDown(0.5);
  doc.font("Regular").fontSize(10).fillColor("#333333");
  doc.text(`Tổng số nhiệm vụ: ${stats.totalTasks}`);
  doc.text(`Hoàn thành: ${stats.doneTasks} (${stats.progress}%)`);
  doc.text(`Số thành viên: ${members.length}`);

  // Progress bar
  const barX = 40,
    barY = doc.y + 8,
    barW = 515,
    barH = 10;
  doc.roundedRect(barX, barY, barW, barH, 4).fillColor("#e6e6f0").fill();
  doc
    .roundedRect(barX, barY, barW * (stats.progress / 100), barH, 4)
    .fillColor("#0072e0")
    .fill();
  doc.fillColor("#333333");
  doc.y = barY + barH + 14;

  // ── Members table ──
  doc
    .font("Bold")
    .fontSize(12)
    .fillColor("#0a0a1a")
    .text("Danh sách thành viên & điểm số");
  doc
    .moveTo(40, doc.y + 2)
    .lineTo(555, doc.y + 2)
    .strokeColor("#cccccc")
    .stroke();
  doc.moveDown(0.5);

  drawTableHeader(doc, ["Tên", "Vai trò", "Điểm"], [280, 165, 70]);
  members.forEach((m, i) => {
    checkPageBreak(doc);
    drawTableRow(
      doc,
      [
        m.display_name || m.username,
        m.custom_role_name || ROLE_LABEL[m.role] || m.role,
        String(m.score ?? 0),
      ],
      [280, 165, 70],
      i % 2 === 0,
    );
  });
  doc.moveDown(1);

  // ── Tasks table ──
  checkPageBreak(doc, 100);
  doc.font("Bold").fontSize(12).fillColor("#0a0a1a").text("Danh sách nhiệm vụ");
  doc
    .moveTo(40, doc.y + 2)
    .lineTo(555, doc.y + 2)
    .strokeColor("#cccccc")
    .stroke();
  doc.moveDown(0.5);

  drawTableHeader(
    doc,
    ["Nhiệm vụ", "Phụ trách", "Hạn", "Ưu tiên", "Trạng thái"],
    [165, 110, 80, 70, 90],
  );
  tasks.forEach((t, i) => {
    checkPageBreak(doc);
    drawTableRow(
      doc,
      [
        t.title,
        t.assignee_name || "—",
        fmtDate(t.deadline),
        PRIORITY_LABEL[t.priority] || t.priority,
        STATUS_LABEL[t.status] || t.status,
      ],
      [165, 110, 80, 70, 90],
      i % 2 === 0,
    );
  });

  // ── Footer ──
  doc.moveDown(1.5);
  doc
    .font("Regular")
    .fontSize(8)
    .fillColor("#999999")
    .text("Báo cáo được tạo tự động bởi TM — 19A-Teamly", { align: "center" });

  doc.end();
}

function checkPageBreak(doc, margin = 30) {
  if (doc.y > doc.page.height - doc.page.margins.bottom - margin) {
    doc.addPage();
  }
}

function drawTableHeader(doc, cols, widths) {
  const startX = 40;
  let x = startX;
  const y = doc.y;
  doc.font("Bold").fontSize(9).fillColor("#ffffff");
  doc
    .rect(
      startX,
      y,
      widths.reduce((a, b) => a + b, 0),
      20,
    )
    .fillColor("#0072e0")
    .fill();
  doc.fillColor("#ffffff");
  cols.forEach((c, i) => {
    doc.text(c, x + 6, y + 5, { width: widths[i] - 8, ellipsis: true });
    x += widths[i];
  });
  doc.y = y + 20;
}

function drawTableRow(doc, cols, widths, shaded) {
  const startX = 40;
  const y = doc.y;
  const rowH = 18;
  if (shaded) {
    doc
      .rect(
        startX,
        y,
        widths.reduce((a, b) => a + b, 0),
        rowH,
      )
      .fillColor("#f2f4fb")
      .fill();
  }
  doc.font("Regular").fontSize(8.5).fillColor("#333333");
  let x = startX;
  cols.forEach((c, i) => {
    doc.text(String(c), x + 6, y + 4, { width: widths[i] - 8, ellipsis: true });
    x += widths[i];
  });
  doc.y = y + rowH;
}

// ============================================================
// Excel Report (exceljs)
// ============================================================
async function generateExcelReport(res, data) {
  const { project, members, tasks, stats } = data;
  const safeName = (project.name || "project").replace(/[^a-zA-Z0-9_-]+/g, "_");

  const wb = new ExcelJS.Workbook();
  wb.creator = "TM - 19A-Teamly";
  wb.created = new Date();

  // ── Sheet 1: Tổng quan ──
  const ov = wb.addWorksheet("Tổng quan");
  ov.columns = [{ width: 28 }, { width: 40 }];
  ov.addRow(["BÁO CÁO TỔNG KẾT DỰ ÁN"]).font = { bold: true, size: 14 };
  ov.addRow([project.name]).font = {
    bold: true,
    size: 12,
    color: { argb: "FF0072E0" },
  };
  ov.addRow([]);
  const infoRows = [
    ["Chủ dự án", project.owner_name || "—"],
    ["Mô tả", project.description || "—"],
    ["Hạn chót", fmtDate(project.deadline)],
    [
      "Trạng thái",
      project.status === "completed"
        ? "Hoàn thành"
        : project.status === "archived"
          ? "Lưu trữ"
          : "Đang hoạt động",
    ],
    ["Mã tham gia", project.invite_code],
    ["Ngày tạo", fmtDate(project.created_at)],
    ["Ngày xuất báo cáo", fmtDate(new Date())],
    [],
    ["Tổng số nhiệm vụ", stats.totalTasks],
    ["Hoàn thành", stats.doneTasks],
    ["Tiến độ (%)", stats.progress],
    ["Số thành viên", members.length],
  ];
  infoRows.forEach((r) => {
    const row = ov.addRow(r);
    if (r[0]) row.getCell(1).font = { bold: true };
  });

  // ── Sheet 2: Thành viên ──
  const ms = wb.addWorksheet("Thành viên");
  ms.columns = [
    { header: "Tên hiển thị", key: "name", width: 28 },
    { header: "Tài khoản", key: "username", width: 20 },
    { header: "Vai trò", key: "role", width: 18 },
    { header: "Điểm số", key: "score", width: 12 },
  ];
  styleHeaderRow(ms.getRow(1));
  members.forEach((m) => {
    ms.addRow({
      name: m.display_name || m.username,
      username: m.username,
      role: m.custom_role_name || ROLE_LABEL[m.role] || m.role,
      score: m.score ?? 0,
    });
  });
  zebra(ms);

  // ── Sheet 3: Nhiệm vụ ──
  const ts = wb.addWorksheet("Nhiệm vụ");
  ts.columns = [
    { header: "Tên nhiệm vụ", key: "title", width: 35 },
    { header: "Phụ trách", key: "assignee", width: 22 },
    { header: "Hạn chót", key: "deadline", width: 14 },
    { header: "Độ ưu tiên", key: "priority", width: 14 },
    { header: "Trạng thái", key: "status", width: 16 },
  ];
  styleHeaderRow(ts.getRow(1));
  tasks.forEach((t) => {
    ts.addRow({
      title: t.title,
      assignee: t.assignee_name || "—",
      deadline: fmtDate(t.deadline),
      priority: PRIORITY_LABEL[t.priority] || t.priority,
      status: STATUS_LABEL[t.status] || t.status,
    });
  });
  zebra(ts);

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="bao-cao-${safeName}.xlsx"`,
  );
  await wb.xlsx.write(res);
  res.end();
}

function styleHeaderRow(row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF0072E0" },
    };
    cell.alignment = { vertical: "middle" };
  });
}

function zebra(sheet) {
  for (let i = 2; i <= sheet.rowCount; i++) {
    if (i % 2 === 0) {
      sheet.getRow(i).eachCell((cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF2F4FB" },
        };
      });
    }
  }
}

module.exports = { generatePDFReport, generateExcelReport };
