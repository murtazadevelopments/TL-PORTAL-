const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');

const UNICODE_FONT_PATH = path.join(
  __dirname,
  '../assets/fonts/NotoSansArabic-Regular.ttf'
);
const LOGO_PATH = path.join(__dirname, '../assets/logo.png');
let unicodeFontBytes = null;
let logoPngBytes = null;
try {
  unicodeFontBytes = fs.readFileSync(UNICODE_FONT_PATH);
} catch (err) {
  console.warn('employee export PDF font missing:', err.message || err);
}
try {
  logoPngBytes = fs.readFileSync(LOGO_PATH);
} catch (err) {
  console.warn('employee export PDF logo missing:', err.message || err);
}

const LAST_JOB_LABELS = {
  still_employed: 'Still employed elsewhere',
  resigned: 'Resigned',
  terminated: 'Terminated',
  fresh_graduate: 'Fresh graduate',
  other: 'Other',
};

const EXPORT_COLUMNS = [
  { key: 'employee_id', label: 'Employee ID', width: 72 },
  { key: 'name', label: 'Full name', width: 96 },
  { key: 'username', label: 'Username', width: 78 },
  { key: 'email', label: 'Email', width: 110 },
  { key: 'contact_number', label: 'Contact', width: 78 },
  { key: 'cnic_number', label: 'CNIC', width: 86 },
  { key: 'address', label: 'Address', width: 90 },
  { key: 'date_of_birth', label: 'DOB', width: 58 },
  { key: 'education', label: 'Education', width: 90 },
  { key: 'last_job_status', label: 'Last job status', width: 86 },
  { key: 'role', label: 'Role', width: 52 },
  { key: 'status', label: 'Status', width: 48 },
  { key: 'employment_type', label: 'Type', width: 48 },
  { key: 'department', label: 'Team', width: 78 },
  { key: 'designation', label: 'Designation', width: 86 },
  { key: 'branch', label: 'Branch', width: 72 },
  { key: 'shift', label: 'Shift', width: 52 },
  { key: 'date_of_joining', label: 'Joined', width: 58 },
  { key: 'work_hours', label: 'Hours', width: 48 },
  { key: 'reference_person_name', label: 'Reference', width: 72 },
  { key: 'emergency_contact_name', label: 'Emergency name', width: 80 },
  { key: 'emergency_contact_number', label: 'Emergency phone', width: 78 },
  { key: 'bank_name', label: 'Bank', width: 64 },
  { key: 'account_title', label: 'Account title', width: 86 },
  { key: 'iban', label: 'IBAN', width: 90 },
  { key: 'account_number', label: 'Account no.', width: 78 },
];

const PDF_GROUPS = [
  {
    title: 'Contact',
    fields: [
      ['Username', 'username'],
      ['Email', 'email'],
      ['Phone', 'contact_number'],
      ['CNIC', 'cnic_number'],
      ['Address', 'address'],
      ['Date of birth', 'date_of_birth'],
      ['Education', 'education'],
      ['Last job', 'last_job_status'],
    ],
  },
  {
    title: 'Employment',
    fields: [
      ['Role', 'role'],
      ['Team', 'department'],
      ['Designation', 'designation'],
      ['Branch', 'branch'],
      ['Shift', 'shift'],
      ['Joined', 'date_of_joining'],
      ['Work hours', 'work_hours'],
      ['Reference', 'reference_person_name'],
    ],
  },
  {
    title: 'Bank & emergency',
    fields: [
      ['Emergency name', 'emergency_contact_name'],
      ['Emergency phone', 'emergency_contact_number'],
      ['Bank', 'bank_name'],
      ['Account title', 'account_title'],
      ['IBAN', 'iban'],
      ['Account no.', 'account_number'],
    ],
  },
];

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(value) {
  if (!value) return '';
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const dt = new Date(value);
  if (!Number.isFinite(dt.getTime())) return text;
  return dt.toISOString().slice(0, 10);
}

function formatWorkHours(row) {
  const start = row.work_start_hour;
  const end = row.work_end_hour;
  if (start == null && end == null) return '';
  const a = start == null || start === '' ? '-' : String(start);
  const b = end == null || end === '' ? '-' : String(end);
  return `${a}-${b}`;
}

function cellValue(row, key) {
  if (key === 'date_of_birth' || key === 'date_of_joining') {
    return formatDate(row[key]);
  }
  if (key === 'last_job_status') {
    const raw = String(row.last_job_status || '').trim();
    return LAST_JOB_LABELS[raw] || raw;
  }
  if (key === 'work_hours') return formatWorkHours(row);
  const value = row[key];
  if (value == null) return '';
  return String(value).trim();
}

function displayRows(records) {
  return records.map((row) => {
    const out = {};
    for (const col of EXPORT_COLUMNS) out[col.key] = cellValue(row, col.key);
    return out;
  });
}

function displayValue(row, key) {
  const value = row[key];
  return value == null || String(value).trim() === '' ? '-' : String(value).trim();
}

function buildExcelXml(records, meta = {}) {
  const rows = displayRows(records);
  const columns = EXPORT_COLUMNS.map(
    (col) => `<Column ss:Width="${col.width}"/>`
  ).join('');
  const header = EXPORT_COLUMNS.map(
    (col) =>
      `<Cell ss:StyleID="Header"><Data ss:Type="String">${xmlEscape(col.label)}</Data></Cell>`
  ).join('');
  const body = rows
    .map((row, index) => {
      const style = index % 2 === 1 ? ' ss:StyleID="Stripe"' : '';
      const cells = EXPORT_COLUMNS.map((col) => {
        const value = row[col.key] || '';
        return `<Cell${style}><Data ss:Type="String">${xmlEscape(value)}</Data></Cell>`;
      }).join('');
      return `<Row>${cells}</Row>`;
    })
    .join('');
  const subtitle = xmlEscape(
    [meta.title || 'Textured Lab employee export', meta.filters || '', `${rows.length} employees`]
      .filter(Boolean)
      .join(' | ')
  );
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#1B2A4A" ss:Pattern="Solid"/></Style>
  <Style ss:ID="Meta"><Font ss:Italic="1" ss:Color="#555555"/></Style>
  <Style ss:ID="Stripe"><Interior ss:Color="#F4F6FA" ss:Pattern="Solid"/></Style>
 </Styles>
 <Worksheet ss:Name="Employees">
  <Table>
   ${columns}
   <Row><Cell ss:MergeAcross="${EXPORT_COLUMNS.length - 1}" ss:StyleID="Meta"><Data ss:Type="String">${subtitle}</Data></Cell></Row>
   <Row>${header}</Row>
   ${body}
  </Table>
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
   <FreezePanes/><FrozenNoSplit/><SplitHorizontal>2</SplitHorizontal><TopRowBottomPane>2</TopRowBottomPane>
  </WorksheetOptions>
 </Worksheet>
</Workbook>`;
}

function textWidth(font, text, size) {
  try {
    return font.widthOfTextAtSize(String(text || ''), size);
  } catch {
    return String(text || '').length * size * 0.5;
  }
}

function wrapText(font, text, size, maxWidth) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  if (!words.length) return ['-'];
  const lines = [];
  let current = words[0];
  for (let i = 1; i < words.length; i += 1) {
    const next = `${current} ${words[i]}`;
    if (textWidth(font, next, size) <= maxWidth) {
      current = next;
    } else {
      lines.push(current);
      current = words[i];
    }
  }
  lines.push(current);
  return lines;
}

function safeDrawText(page, text, opts) {
  try {
    page.drawText(String(text || ''), opts);
  } catch {
    const fallback = String(text || '').replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '?');
    page.drawText(fallback, opts);
  }
}

async function embedExportFonts(pdf) {
  if (unicodeFontBytes) {
    pdf.registerFontkit(fontkit);
    const embedded = await pdf.embedFont(unicodeFontBytes, { subset: true });
    return { font: embedded, bold: embedded };
  }
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  return { font, bold };
}

async function buildEmployeePdf(records, meta = {}) {
  const rows = displayRows(records);
  const pdf = await PDFDocument.create();
  const { font, bold } = await embedExportFonts(pdf);
  let logoImage = null;
  if (logoPngBytes) {
    try {
      logoImage = await pdf.embedPng(logoPngBytes);
    } catch (err) {
      console.warn('employee export PDF logo embed failed:', err.message || err);
    }
  }
  const pageWidth = 842;
  const pageHeight = 595;
  const margin = 28;
  const ink = rgb(0.09, 0.12, 0.18);
  const muted = rgb(0.38, 0.42, 0.5);
  const band = rgb(0.1, 0.16, 0.28);
  const bandText = rgb(0.97, 0.98, 0.99);
  const section = rgb(0.42, 0.47, 0.55);
  const cardBg = rgb(0.97, 0.975, 0.982);
  const rule = rgb(0.82, 0.85, 0.9);
  const inner = pageWidth - margin * 2;
  const colGap = 14;
  const colW = (inner - 20 - colGap * 2) / 3;
  const labelW = 82;
  const valueW = colW - labelW;
  const rowH = 11;

  let page = null;
  let y = 0;
  let pageNo = 0;

  function drawRight(text, atY, size, usedFont, color) {
    const width = textWidth(usedFont, text, size);
    safeDrawText(page, text, {
      x: pageWidth - margin - width,
      y: atY,
      size,
      font: usedFont,
      color,
    });
  }

  function drawWatermark(target) {
    if (!logoImage) return;
    const maxSide = Math.min(pageWidth, pageHeight) * 0.62;
    const scale = Math.min(maxSide / logoImage.width, maxSide / logoImage.height);
    const width = logoImage.width * scale;
    const height = logoImage.height * scale;
    target.drawImage(logoImage, {
      x: (pageWidth - width) / 2,
      y: (pageHeight - height) / 2,
      width,
      height,
      opacity: 0.22,
    });
  }

  function addPage() {
    page = pdf.addPage([pageWidth, pageHeight]);
    pageNo += 1;
    y = pageHeight - margin;
    safeDrawText(page, 'TEXTURED LAB', {
      x: margin,
      y,
      size: 8,
      font: bold,
      color: section,
    });
    drawRight('Confidential employee directory', y, 8, font, section);
    y -= 12;
    const generatedBy = String(meta.generatedBy || '').trim();
    if (generatedBy) {
      drawRight(`Report generated by ${generatedBy}`, y, 8, font, section);
    }
    y -= 16;
    safeDrawText(page, meta.title || 'Employee export', {
      x: margin,
      y,
      size: 16,
      font: bold,
      color: ink,
    });
    y -= 16;
    safeDrawText(
      page,
      `${meta.filters || 'All assigned employees'}  |  ${rows.length} employees  |  ${
        meta.generatedAt || ''
      }`,
      { x: margin, y, size: 9, font, color: muted }
    );
    y -= 10;
    page.drawLine({
      start: { x: margin, y: y + 4 },
      end: { x: pageWidth - margin, y: y + 4 },
      thickness: 1.2,
      color: band,
    });
    y -= 10;
  }

  function fieldHeight(value) {
    return Math.max(rowH, wrapText(font, value, 8, valueW).slice(0, 2).length * 10);
  }

  function cardHeight(row) {
    const body = Math.max(
      ...PDF_GROUPS.map((group) =>
        group.fields.reduce((sum, [, key]) => sum + fieldHeight(displayValue(row, key)), 18)
      )
    );
    return 26 + body + 12;
  }

  function drawField(x, cursorY, label, value) {
    safeDrawText(page, label, {
      x,
      y: cursorY,
      size: 7,
      font: bold,
      color: section,
    });
    const lines = wrapText(font, value, 8, valueW).slice(0, 2);
    lines.forEach((line, idx) => {
      safeDrawText(page, line, {
        x: x + labelW,
        y: cursorY - idx * 10,
        size: 8,
        font,
        color: ink,
      });
    });
    return Math.max(rowH, lines.length * 10);
  }

  addPage();

  if (!rows.length) {
    safeDrawText(page, 'No employees matched these filters.', {
      x: margin,
      y,
      size: 11,
      font,
      color: muted,
    });
    return Buffer.from(await pdf.save());
  }

  for (const row of rows) {
    const height = cardHeight(row);
    if (y - height < margin + 10) addPage();

    const top = y;
    const bottom = y - height;
    page.drawRectangle({
      x: margin,
      y: bottom,
      width: inner,
      height,
      color: cardBg,
      borderColor: rule,
      borderWidth: 0.7,
    });
    page.drawRectangle({
      x: margin,
      y: top - 22,
      width: inner,
      height: 22,
      color: band,
    });

    const empId = displayValue(row, 'employee_id');
    const name = displayValue(row, 'name');
    const titleLeft = empId === '-' ? name : empId;
    safeDrawText(page, titleLeft, {
      x: margin + 10,
      y: top - 15,
      size: 9,
      font: bold,
      color: bandText,
    });
    if (empId !== '-' && name !== '-') {
      safeDrawText(page, name, {
        x: margin + 16 + textWidth(bold, titleLeft, 9),
        y: top - 15,
        size: 10,
        font: bold,
        color: bandText,
      });
    }

    const badge = [displayValue(row, 'status'), displayValue(row, 'employment_type')]
      .filter((v) => v && v !== '-')
      .join('  |  ');
    if (badge) {
      safeDrawText(page, badge, {
        x: pageWidth - margin - 12 - textWidth(font, badge, 8),
        y: top - 15,
        size: 8,
        font,
        color: bandText,
      });
    }

    PDF_GROUPS.forEach((group, idx) => {
      const x = margin + 10 + idx * (colW + colGap);
      let cursor = top - 36;
      safeDrawText(page, group.title.toUpperCase(), {
        x,
        y: cursor,
        size: 7,
        font: bold,
        color: section,
      });
      cursor -= 13;
      for (const [label, key] of group.fields) {
        cursor -= drawField(x, cursor, label, displayValue(row, key));
      }
    });

    y = bottom - 8;
  }

  pdf.getPages().forEach((p, idx, all) => {
    drawWatermark(p);
    safeDrawText(p, `${idx + 1} / ${all.length}`, {
      x: pageWidth / 2 - 14,
      y: 12,
      size: 8,
      font,
      color: muted,
    });
  });

  return Buffer.from(await pdf.save());
}

module.exports = {
  EXPORT_COLUMNS,
  buildExcelXml,
  buildEmployeePdf,
  cellValue,
  displayRows,
};
