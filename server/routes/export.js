const express = require("express");
const PDFDocument = require("pdfkit");
const ExcelJS = require("exceljs");
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, HeadingLevel } = require("docx");
const db = require("../db");

function fmtRMB(n) { return "¥" + Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 }); }
function fmtIDR(n) { return "Rp " + Number(n || 0).toLocaleString("id-ID", { maximumFractionDigits: 0 }); }

const NAVY = "#1F3864";
const TEAL = "#0F6E6E";
const GRAY = "#666666";
const LIGHT = "#F4F6F6";

// shared professional invoice header — used by every service type
function drawInvoiceHeader(doc, { companySuffix, serviceName, invoiceNumber, orderDate, paymentDate, trackingCode, logisticsTrackingCode, billTo }) {
  // top color band
  doc.rect(0, 0, doc.page.width, 90).fill(NAVY);
  doc.fillColor("#FFFFFF").fontSize(22).font("Helvetica-Bold").text(`NEXUS - ${companySuffix}`, 50, 28);
  doc.fontSize(12).font("Helvetica").fillColor("#CFE0E8").text(serviceName, 50, 58);

  doc.fillColor("#000000").font("Helvetica");
  let y = 110;
  doc.fontSize(11).fillColor(TEAL).font("Helvetica-Bold").text(`Order #${invoiceNumber}`, 50, y);
  y += 20;
  doc.fontSize(10).fillColor("#000").font("Helvetica");
  doc.text(`Order date: ${orderDate || "-"}`, 50, y);
  doc.text(`Payment date: ${paymentDate || "-"}`, 300, y);
  y += 16;
  if (trackingCode !== undefined) {
    doc.text(`Tracking code (ours): ${trackingCode || "-"}`, 50, y);
    doc.text(`Tracking code (logistics): ${logisticsTrackingCode || "-"}`, 300, y);
    y += 22;
  } else {
    y += 6;
  }

  doc.moveTo(50, y).lineTo(doc.page.width - 50, y).strokeColor("#DDDDDD").stroke();
  y += 14;
  doc.fontSize(10).fillColor(GRAY).text("BILL TO", 50, y);
  y += 14;
  doc.fontSize(13).fillColor("#000").font("Helvetica-Bold").text(billTo || "-", 50, y);
  doc.font("Helvetica");
  y += 26;
  return y;
}

function drawBankSection(doc, y, bankAccount, invoiceNumber, cfg) {
  const bank = bankAccount || { bank_name: cfg.bank_name, account_name: cfg.bank_account_name, account_number: cfg.bank_account_number };
  doc.rect(50, y, doc.page.width - 100, 90).fill(LIGHT);
  doc.fillColor(TEAL).fontSize(12).font("Helvetica-Bold").text("Bank Transfer Information", 62, y + 10);
  doc.fillColor("#000").fontSize(10).font("Helvetica");
  doc.text(`Bank name: ${bank.bank_name || "-"}`, 62, y + 30);
  doc.text(`Account name: ${bank.account_name || "-"}`, 62, y + 44);
  doc.text(`Account number: ${bank.account_number || "-"}`, 62, y + 58);
  doc.text(`Memo: Order #${invoiceNumber}`, 62, y + 72);
  return y + 100;
}

function drawTeamMemberSection(doc, y, teamMember) {
  if (!teamMember) return y;
  doc.fontSize(10).fillColor(GRAY).font("Helvetica-Bold").text("Contact our team", 50, y);
  y += 14;
  doc.fillColor("#000").font("Helvetica").fontSize(10);
  const label = teamMember.person_name || teamMember.company_name || "Team member";
  const contact = [teamMember.whatsapp && `WA: ${teamMember.whatsapp}`, teamMember.wechat && `WeChat: ${teamMember.wechat}`, teamMember.phone && `Phone: ${teamMember.phone}`].filter(Boolean).join("  ·  ");
  doc.text(`${label}${contact ? "  —  " + contact : ""}`, 50, y);
  return y + 20;
}

module.exports = function () {
  const router = express.Router();

  // ---- PDF invoice for a Nadylan (Track A) order ----
  router.get("/order/:id/pdf", (req, res) => {
    const order = db.prepare("SELECT * FROM orders WHERE id=?").get(req.params.id);
    if (!order) return res.status(404).send("Order not found");
    const items = db.prepare("SELECT * FROM order_items WHERE order_id=?").all(order.id);
    const cfg = {};
    db.prepare("SELECT key, value FROM config").all().forEach((r) => (cfg[r.key] = r.value));

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=invoice-${order.invoice_number || order.id}.pdf`);

    const doc = new PDFDocument({ margin: 50, size: "A4" });
    doc.pipe(res);

    let y = drawInvoiceHeader(doc, {
      companySuffix: "NADYLAN",
      serviceName: "Sourcing Invoice",
      invoiceNumber: order.invoice_number || order.id,
      orderDate: order.created_at ? order.created_at.slice(0, 10) : "-",
      paymentDate: order.payment_date,
      trackingCode: order.tracking_code,
      logisticsTrackingCode: order.logistics_tracking_code,
      billTo: order.buyer_name,
    });

    // product table — when a markup is active, scale displayed item prices by the same ratio
    // so the invoice is internally consistent (the markup stays genuinely invisible)
    const rawCost = items.reduce((s, i) => {
      const lineTotal = (i.unit_price || 0) * (i.qty || 1);
      const lineRmb = (i.currency === "IDR") ? lineTotal / order.fx_rate : lineTotal;
      return s + lineRmb;
    }, 0);
    const markupRatio = rawCost > 0 ? order.product_cost / rawCost : 1;

    doc.fontSize(11).fillColor(TEAL).font("Helvetica-Bold").text("Products", 50, y);
    y += 18;
    doc.fontSize(9).fillColor(GRAY).font("Helvetica-Bold");
    doc.text("Product", 50, y); doc.text("Qty", 320, y); doc.text("Price", 400, y);
    y += 14;
    doc.moveTo(50, y).lineTo(doc.page.width - 50, y).strokeColor("#DDDDDD").stroke();
    y += 8;
    doc.font("Helvetica").fillColor("#000").fontSize(9.5);
    items.forEach((i) => {
      const displayPrice = (i.unit_price || 0) * markupRatio;
      doc.text(`${i.name}${i.spec ? " (" + i.spec + ")" : ""}`, 50, y, { width: 260 });
      doc.text(String(i.qty), 320, y);
      doc.text(i.currency === "IDR" ? fmtIDR(displayPrice) : fmtRMB(displayPrice), 400, y);
      y += 16;
    });
    y += 10;

    // cost breakdown
    doc.moveTo(50, y).lineTo(doc.page.width - 50, y).strokeColor("#DDDDDD").stroke();
    y += 14;
    doc.fontSize(11).fillColor(TEAL).font("Helvetica-Bold").text("Cost Breakdown (RMB / IDR)", 50, y);
    y += 18;
    doc.fontSize(10).fillColor("#000").font("Helvetica");
    const fx = order.fx_rate;
    const rows = [
      ["Product cost", `${fmtRMB(order.product_cost)}  /  ${fmtIDR(order.product_cost * fx)}`],
      ["Total CBM", `${order.cbm_total}`],
      ["Logistics — national (China domestic)", `${fmtRMB(order.logistics_supplier_to_cn)}  /  ${fmtIDR((order.logistics_supplier_to_cn || 0) * fx)}`],
      ["Logistics — international (freight + last mile)", `${fmtRMB((order.cbm_total || 0) * (order.logistics_rate_per_cbm || 0) + (order.logistics_id_to_buyer || 0))}  /  ${fmtIDR(((order.cbm_total || 0) * (order.logistics_rate_per_cbm || 0) + (order.logistics_id_to_buyer || 0)) * fx)}`],
    ];
    if (order.service_fee > 0) rows.push([`Service fee (${order.fee_pct}%)`, `${fmtRMB(order.service_fee)}  /  ${fmtIDR(order.service_fee * fx)}`]);
    rows.forEach(([label, val]) => {
      doc.fillColor(GRAY).text(label, 50, y);
      doc.fillColor("#000").text(val, 300, y, { width: 250, align: "right" });
      y += 16;
    });
    y += 6;
    doc.moveTo(50, y).lineTo(doc.page.width - 50, y).strokeColor(NAVY).lineWidth(1.5).stroke();
    y += 10;
    doc.fontSize(13).fillColor(NAVY).font("Helvetica-Bold");
    doc.text("Total client payment", 50, y);
    doc.text(`${fmtRMB(order.total_payment)}  /  ${fmtIDR(order.total_payment * fx)}`, 250, y, { width: 300, align: "right" });
    y += 30;

    const orderBankAccount = order.bank_account_id ? db.prepare("SELECT * FROM bank_accounts WHERE id=?").get(order.bank_account_id) : null;
    const orderTeamMember = order.team_member_id ? db.prepare("SELECT * FROM clients WHERE id=?").get(order.team_member_id) : null;
    y = drawBankSection(doc, y, orderBankAccount, order.invoice_number || order.id, cfg);
    y = drawTeamMemberSection(doc, y + 8, orderTeamMember);

    doc.fontSize(8).fillColor("#AAAAAA").text("Generated by NEXUS Ecosystem", 50, doc.page.height - 40, { align: "center", width: doc.page.width - 100 });

    doc.end();
  });

  // ---- PDF invoice for a Guangzhou Mate tour ----
  router.get("/tour/:id/pdf", (req, res) => {
    const tour = db.prepare("SELECT * FROM tours WHERE id=?").get(req.params.id);
    if (!tour) return res.status(404).send("Tour not found");
    const cfg = {};
    db.prepare("SELECT key, value FROM config").all().forEach((r) => (cfg[r.key] = r.value));

    const SERVICE_NAMES = {
      only_booking: "Booking Fee Only",
      custom_itinerary: "Custom Itinerary Only",
      bigbus: "Custom Big Bus Tour",
      private: "Private Tour",
    };
    const serviceName = SERVICE_NAMES[tour.tour_category] || tour.tier_name || "Tour Service";

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=invoice-${tour.invoice_number || tour.id}.pdf`);

    const doc = new PDFDocument({ margin: 50, size: "A4" });
    doc.pipe(res);

    let y = drawInvoiceHeader(doc, {
      companySuffix: "GUANGZHOUMATE",
      serviceName,
      invoiceNumber: tour.invoice_number || tour.id,
      orderDate: tour.created_at ? tour.created_at.slice(0, 10) : "-",
      paymentDate: tour.payment_date,
      billTo: tour.client_name || "-",
    });

    doc.fontSize(11).fillColor(TEAL).font("Helvetica-Bold").text("Service Details", 50, y);
    y += 18;
    doc.fontSize(10).fillColor("#000").font("Helvetica");
    if (tour.tier_name) { doc.text(`Package: ${tour.tier_name}`, 50, y); y += 15; }
    if (tour.date_from) { doc.text(`Travel: ${tour.date_from} -> ${tour.date_to || ""}  (${tour.days || tour.pax_or_days || "-"} days)`, 50, y); y += 15; }
    if (tour.pax_adults || tour.pax_children || tour.pax_infants || tour.pax_elderly) {
      doc.text(`Pax: ${tour.pax_adults || 0} adult, ${tour.pax_children || 0} child, ${tour.pax_infants || 0} infant, ${tour.pax_elderly || 0} elderly`, 50, y);
      y += 15;
    }
    if (tour.destinations) {
      doc.text("Destinations:", 50, y); y += 14;
      doc.fontSize(9).fillColor(GRAY).text(tour.destinations, 60, y, { width: 450 });
      y += (tour.destinations.split("\n").length * 12) + 10;
      doc.fillColor("#000").fontSize(10);
    }
    y += 10;

    doc.moveTo(50, y).lineTo(doc.page.width - 50, y).strokeColor("#DDDDDD").stroke();
    y += 14;
    doc.fontSize(11).fillColor(TEAL).font("Helvetica-Bold").text("Cost Breakdown (IDR)", 50, y);
    y += 18;
    doc.fontSize(10).fillColor("#000").font("Helvetica");
    const costItems = db.prepare("SELECT * FROM tour_cost_items WHERE tour_id=?").all(tour.id);
    costItems.forEach((c) => {
      doc.fillColor(GRAY).text(c.label, 50, y);
      doc.fillColor("#000").text(fmtIDR(c.amount), 300, y, { width: 250, align: "right" });
      y += 16;
    });
    const rows = [];
    if (tour.tour_category === "bigbus" || tour.tour_category === "private") rows.push(["Total cost to us", fmtIDR(tour.cost)]);
    rows.push(["Booking fee (5%)", fmtIDR(tour.booking_fee)]);
    rows.forEach(([label, val]) => {
      doc.fillColor(GRAY).text(label, 50, y);
      doc.fillColor("#000").text(val, 300, y, { width: 250, align: "right" });
      y += 16;
    });
    y += 6;
    doc.moveTo(50, y).lineTo(doc.page.width - 50, y).strokeColor(NAVY).lineWidth(1.5).stroke();
    y += 10;
    doc.fontSize(13).fillColor(NAVY).font("Helvetica-Bold");
    doc.text("Total client payment", 50, y);
    doc.text(fmtIDR(tour.revenue), 250, y, { width: 300, align: "right" });
    y += 30;

    const tourBankAccount = tour.bank_account_id ? db.prepare("SELECT * FROM bank_accounts WHERE id=?").get(tour.bank_account_id) : null;
    const tourTeamMember = tour.team_member_id ? db.prepare("SELECT * FROM clients WHERE id=?").get(tour.team_member_id) : null;
    y = drawBankSection(doc, y, tourBankAccount, tour.invoice_number || tour.id, cfg);
    y = drawTeamMemberSection(doc, y + 8, tourTeamMember);

    doc.fontSize(8).fillColor("#AAAAAA").text("Generated by NEXUS Ecosystem", 50, doc.page.height - 40, { align: "center", width: doc.page.width - 100 });

    doc.end();
  });

  // ---- Excel export: all transactions ----
  router.get("/budget/transactions.xlsx", async (req, res) => {
    const rows = db.prepare("SELECT * FROM transactions ORDER BY created_at DESC").all();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Transactions");
    ws.columns = [
      { header: "Date", key: "created_at", width: 20 },
      { header: "Kind", key: "kind", width: 12 },
      { header: "Category", key: "category", width: 24 },
      { header: "Amount (RMB)", key: "amount_rmb", width: 16 },
      { header: "Source", key: "source", width: 14 },
      { header: "Note", key: "note", width: 40 },
    ];
    ws.getRow(1).font = { bold: true };
    rows.forEach((r) => ws.addRow(r));

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=nexus-transactions.xlsx");
    await wb.xlsx.write(res);
    res.end();
  });

  // ---- Excel export: Nadylan orders ----
  router.get("/business/orders.xlsx", async (req, res) => {
    const rows = db.prepare("SELECT * FROM orders ORDER BY created_at DESC").all();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Orders");
    ws.columns = [
      { header: "Order #", key: "id", width: 10 },
      { header: "Buyer", key: "buyer_name", width: 22 },
      { header: "Product Cost", key: "product_cost", width: 14 },
      { header: "CBM Total", key: "cbm_total", width: 12 },
      { header: "Fee %", key: "fee_pct", width: 10 },
      { header: "Logistics", key: "logistics_cost", width: 14 },
      { header: "Total Payment", key: "total_payment", width: 16 },
      { header: "Net Profit", key: "net_profit", width: 14 },
      { header: "Pipeline Status", key: "pipeline_status", width: 24 },
      { header: "Tracking Code", key: "tracking_code", width: 18 },
      { header: "Date", key: "created_at", width: 20 },
    ];
    ws.getRow(1).font = { bold: true };
    rows.forEach((r) => ws.addRow(r));

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=nexus-orders.xlsx");
    await wb.xlsx.write(res);
    res.end();
  });

  // ---- PDF: full budget report ----
  router.get("/budget/report.pdf", (req, res) => {
    const cfg = {};
    db.prepare("SELECT key, value FROM config").all().forEach((r) => (cfg[r.key] = r.value));
    const monthRows = db.prepare(`
      SELECT category, kind, COALESCE(SUM(amount_rmb),0) as total
      FROM transactions WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
      GROUP BY category, kind
    `).all();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=nexus-budget-report.pdf");

    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(res);

    doc.fontSize(20).fillColor("#1F3864").text("NEXUS — Household Budget Report");
    doc.fontSize(10).fillColor("#666").text(`Generated: ${new Date().toISOString().slice(0, 10)}`);
    doc.moveDown(1);

    doc.fontSize(13).fillColor("#0F6E6E").text("This Month");
    doc.fontSize(11).fillColor("#000");
    monthRows.forEach((r) => {
      doc.text(`${r.category} (${r.kind}): ${fmtRMB(r.total)}`);
    });

    doc.moveDown(1);
    doc.fontSize(13).fillColor("#0F6E6E").text("Baseline Config");
    doc.fontSize(11).fillColor("#000");
    doc.text(`Monthly cap: ${fmtRMB(cfg.monthly_cap_rmb)}`);
    doc.text(`Living reserve: ${fmtRMB(cfg.living_reserve_rmb)}`);
    doc.text(`Revenue goal: ${fmtIDR(cfg.revenue_goal_idr)} by ${cfg.revenue_goal_deadline}`);

    doc.end();
  });

  // ---- Product spec sheet (Excel) — bilingual labels, easy for Chinese buyers ----
  router.get("/catalog/:id/xlsx", async (req, res) => {
    const p = db.prepare("SELECT * FROM catalog_products WHERE id=?").get(req.params.id);
    if (!p) return res.status(404).send("Product not found");
    const costItems = db.prepare("SELECT * FROM track_b_cost_items WHERE catalog_product_id=? ORDER BY price_type").all(p.id);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Spec Sheet 规格表");
    ws.columns = [{ width: 28 }, { width: 30 }];
    const rows = [
      ["Product / 产品", p.name],
      ["Category / 类别", p.category],
      ["Grade / 等级", p.grade || "-"],
      ["Process / 处理法", p.process || "-"],
      ["Altitude / 海拔", p.altitude || "-"],
      ["Variety / 品种", p.variety || "-"],
      ["Moisture % / 水分含量", p.moisture_pct ?? "-"],
      ["Defect % / 瑕疵率", p.defect_pct ?? "-"],
      ["MOQ (kg) / 最小起订量", p.moq_kg ?? "-"],
      ["Packaging (kg/jute bag) / 包装(每麻袋kg)", p.packaging_kg_per_jute ?? "-"],
      ["Ready stock / 现货", p.ready_stock ? "Yes / 有" : "No / 无 (made to order)"],
      ["Price (IDR/kg) / 价格(印尼盾/kg)", p.price_idr_per_kg ?? "-"],
      ["Price (RMB/kg) / 价格(人民币/kg)", p.price_rmb_per_kg ?? "-"],
    ];
    rows.forEach((r) => ws.addRow(r));
    ws.getColumn(1).font = { bold: true };

    if (costItems.length) {
      ws.addRow([]);
      ws.addRow(["Cost Breakdown / 成本明细"]).font = { bold: true };
      ws.addRow(["Price Type / 定价类型", "Item / 项目", "Amount / 金额", "Currency / 货币"]).font = { bold: true };
      costItems.forEach((c) => ws.addRow([c.price_type, c.label, c.amount, c.currency]));
      ["FOB", "CIF", "Futures"].forEach((type) => {
        const total = costItems.filter((c) => c.price_type === type).reduce((s, c) => s + c.amount, 0);
        if (total > 0) ws.addRow([`${type} Total`, "", total]);
      });
    }

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=spec-sheet-${p.id}.xlsx`);
    await wb.xlsx.write(res);
    res.end();
  });

  // ---- Product spec sheet (Word) ----
  router.get("/catalog/:id/docx", async (req, res) => {
    const p = db.prepare("SELECT * FROM catalog_products WHERE id=?").get(req.params.id);
    if (!p) return res.status(404).send("Product not found");

    const row = (label, value) => new TableRow({ children: [
      new TableCell({ width: { size: 40, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun({ text: label, bold: true })] })] }),
      new TableCell({ width: { size: 60, type: WidthType.PERCENTAGE }, children: [new Paragraph(String(value ?? "-"))] }),
    ]});

    const doc = new Document({
      sections: [{
        children: [
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: `${p.name} — Product Spec Sheet / 产品规格表`, bold: true })] }),
          new Paragraph({ text: `Category / 类别: ${p.category}`, spacing: { after: 200 } }),
          new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
            row("Grade / 等级", p.grade),
            row("Process / 处理法", p.process),
            row("Altitude / 海拔", p.altitude),
            row("Variety / 品种", p.variety),
            row("Moisture % / 水分含量", p.moisture_pct),
            row("Defect % / 瑕疵率", p.defect_pct),
            row("MOQ (kg) / 最小起订量", p.moq_kg),
            row("Packaging (kg/jute bag) / 包装(每麻袋kg)", p.packaging_kg_per_jute),
            row("Ready stock / 现货", p.ready_stock ? "Yes / 有" : "No / 无"),
            row("Price (IDR/kg) / 价格(印尼盾/kg)", p.price_idr_per_kg),
            row("Price (RMB/kg) / 价格(人民币/kg)", p.price_rmb_per_kg),
            row("Certificates / 证书", p.certificate_docs || "See certificate guide"),
          ]}),
        ],
      }],
    });

    const buf = await Packer.toBuffer(doc);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename=spec-sheet-${p.id}.docx`);
    res.send(buf);
  });

  // ---- Track B order summary — full Chinese language, with margin/fee breakdown ----
  router.get("/trackb/orders/:id/docx-zh", async (req, res) => {
    const o = db.prepare("SELECT * FROM track_b_orders WHERE id=?").get(req.params.id);
    if (!o) return res.status(404).send("Order not found");
    const cfg = {};
    db.prepare("SELECT key, value FROM config").all().forEach((r) => (cfg[r.key] = r.value));
    const bankAccount = o.bank_account_id ? db.prepare("SELECT * FROM bank_accounts WHERE id=?").get(o.bank_account_id) : null;
    const teamMember = o.team_member_id ? db.prepare("SELECT * FROM clients WHERE id=?").get(o.team_member_id) : null;
    const bank = bankAccount || { bank_name: cfg.bank_name, account_name: cfg.bank_account_name, account_number: cfg.bank_account_number };

    const row = (label, value) => new TableRow({ children: [
      new TableCell({ width: { size: 40, type: WidthType.PERCENTAGE }, shading: { fill: "F4F6F6" }, children: [new Paragraph({ children: [new TextRun({ text: label, bold: true })] })] }),
      new TableCell({ width: { size: 60, type: WidthType.PERCENTAGE }, children: [new Paragraph(String(value ?? "-"))] }),
    ]});

    const rows = [
      row("价格/kg (印尼盾 IDR)", o.price_per_kg_idr ?? "-"),
      row("价格/kg (人民币 RMB)", o.price_per_kg_rmb ?? "-"),
      row("运费", o.freight),
      row("保险费", o.insurance),
      row("增值税", o.vat),
      row("其他费用", o.misc_fees),
      row("付款方式", o.payment_method || "-"),
      row("状态", o.pipeline_status || "-"),
    ];

    const doc = new Document({
      sections: [{
        children: [
          new Paragraph({ children: [new TextRun({ text: "NEXUS - NADYLAN", bold: true, size: 32, color: "1F3864" })] }),
          new Paragraph({ children: [new TextRun({ text: "供货发票 (Sourcing Invoice)", size: 22, color: "0F6E6E" })], spacing: { after: 200 } }),
          new Paragraph({ children: [new TextRun({ text: `订单号 Order #${o.invoice_number || o.id}`, bold: true })] }),
          new Paragraph({ text: `日期 Date: ${o.created_at ? o.created_at.slice(0, 10) : "-"}    付款日期 Payment date: ${o.payment_date || "-"}`, spacing: { after: 200 } }),
          new Paragraph({ children: [new TextRun({ text: "买方 BILL TO", bold: true, color: "666666", size: 18 })] }),
          new Paragraph({ children: [new TextRun({ text: o.buyer_name, bold: true, size: 24 })], spacing: { after: 200 } }),
          new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }),
          new Paragraph({ text: "", spacing: { after: 200 } }),
          new Paragraph({ children: [new TextRun({ text: "银行转账信息 Bank Transfer Information", bold: true, color: "0F6E6E" })] }),
          new Paragraph({ text: `银行 Bank: ${bank.bank_name || "-"}` }),
          new Paragraph({ text: `账户名 Account name: ${bank.account_name || "-"}` }),
          new Paragraph({ text: `账号 Account number: ${bank.account_number || "-"}` }),
          new Paragraph({ text: `备注 Memo: Order #${o.invoice_number || o.id}`, spacing: { after: 200 } }),
          ...(teamMember ? [
            new Paragraph({ children: [new TextRun({ text: "联系我们的团队 Contact our team", bold: true, color: "666666", size: 18 })] }),
            new Paragraph({ text: `${teamMember.person_name || teamMember.company_name}${teamMember.whatsapp ? "  WA: " + teamMember.whatsapp : ""}${teamMember.wechat ? "  WeChat: " + teamMember.wechat : ""}` }),
          ] : []),
        ],
      }],
    });

    const buf = await Packer.toBuffer(doc);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename=order-${o.invoice_number || o.id}-zh.docx`);
    res.send(buf);
  });

  // ---- Trip summary PDF — condensed info for building the custom itinerary ----
  router.get("/tour/:id/summary-pdf", (req, res) => {
    const tour = db.prepare("SELECT * FROM tours WHERE id=?").get(req.params.id);
    if (!tour) return res.status(404).send("Tour not found");
    const costItems = db.prepare("SELECT * FROM tour_cost_items WHERE tour_id=?").all(tour.id);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=trip-summary-${tour.invoice_number || tour.id}.pdf`);

    const doc = new PDFDocument({ margin: 50, size: "A4" });
    doc.pipe(res);

    doc.rect(0, 0, doc.page.width, 70).fill(NAVY);
    doc.fillColor("#FFFFFF").fontSize(18).font("Helvetica-Bold").text("Trip Planning Summary", 50, 24);
    doc.fillColor("#CFE0E8").fontSize(11).font("Helvetica").text(`Order #${tour.invoice_number || tour.id}`, 50, 46);

    doc.fillColor("#000");
    let y = 95;
    const SERVICE_NAMES = { only_booking: "Booking Fee Only", custom_itinerary: "Custom Itinerary Only", bigbus: "Custom Big Bus Tour", private: "Private Tour" };
    doc.fontSize(11).font("Helvetica-Bold").text(`Client: ${tour.client_name || "-"}`, 50, y); y += 18;
    doc.font("Helvetica").text(`Service: ${SERVICE_NAMES[tour.tour_category] || tour.tour_category}`, 50, y); y += 16;
    doc.text(`Travel dates: ${tour.date_from || "-"} -> ${tour.date_to || "-"}  (${tour.days || tour.pax_or_days || "-"} days)`, 50, y); y += 16;
    doc.text(`Pax: ${tour.pax_adults || 0} adult, ${tour.pax_children || 0} child, ${tour.pax_infants || 0} infant, ${tour.pax_elderly || 0} elderly`, 50, y); y += 20;

    doc.fontSize(11).fillColor(TEAL).font("Helvetica-Bold").text("Destinations Requested", 50, y); y += 16;
    doc.fillColor("#000").font("Helvetica").fontSize(10);
    doc.text(tour.destinations || "None specified", 60, y, { width: 470 });
    y += (tour.destinations ? tour.destinations.split("\n").length * 12 : 12) + 16;

    doc.fontSize(11).fillColor(TEAL).font("Helvetica-Bold").text("Food Preferences", 50, y); y += 16;
    doc.fillColor("#000").font("Helvetica").fontSize(10);
    doc.text(`Wants to eat: ${tour.food_wanted || "-"}`, 60, y); y += 14;
    doc.text(`Cannot eat / avoid: ${tour.food_avoid || "-"}`, 60, y); y += 24;

    doc.fontSize(11).fillColor(TEAL).font("Helvetica-Bold").text("Cost Notes", 50, y); y += 16;
    doc.fillColor("#000").font("Helvetica").fontSize(10);
    if (costItems.length) {
      costItems.forEach((c) => { doc.text(`${c.label}: ${fmtIDR(c.amount)}`, 60, y); y += 14; });
    } else {
      doc.text("No itemized costs entered yet.", 60, y); y += 14;
    }

    doc.fontSize(8).fillColor("#AAAAAA").text("Generated by NEXUS Ecosystem — for internal planning use", 50, doc.page.height - 40, { align: "center", width: doc.page.width - 100 });
    doc.end();
  });

  return router;
};
