import fs from 'fs';
import path from 'path';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import puppeteer from 'puppeteer';

/**
 * Converts DOCX file to PDF buffer or file.
 */
export async function convertDocxToPdf(docxPath: string, outputPath: string): Promise<string> {
  const result = await mammoth.convertToHtml({ path: docxPath });
  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: 'Helvetica Neue', Arial, sans-serif; padding: 40px; color: #1a1a1a; line-height: 1.6; }
          h1, h2, h3 { color: #111; margin-top: 1.5em; }
          table { border-collapse: collapse; width: 100%; margin: 20px 0; font-size: 13px; }
          th, td { border: 1px solid #e2e8f0; padding: 10px 12px; text-align: left; }
          th { background-color: #f8fafc; font-weight: 600; }
          img { max-width: 100%; height: auto; border-radius: 4px; }
          p { margin-bottom: 1em; }
        </style>
      </head>
      <body>
        ${result.value}
      </body>
    </html>
  `;

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'domcontentloaded' });
    await page.pdf({
      path: outputPath,
      format: 'A4',
      margin: { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' },
      printBackground: true,
    });
    return outputPath;
  } finally {
    await browser.close();
  }
}

/**
 * Converts Excel (.xlsx, .xls) file to PDF.
 */
export async function convertExcelToPdf(excelPath: string, outputPath: string): Promise<string> {
  const workbook = XLSX.readFile(excelPath);
  let htmlSheets = '';

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const htmlTable = XLSX.utils.sheet_to_html(worksheet);
    htmlSheets += `
      <div style="margin-bottom: 40px; page-break-after: always;">
        <h2 style="color: #2D4537; font-family: sans-serif; margin-bottom: 12px; border-bottom: 2px solid #4ADE80; padding-bottom: 6px;">Sheet: ${sheetName}</h2>
        ${htmlTable}
      </div>
    `;
  }

  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: 'Helvetica Neue', Arial, sans-serif; padding: 30px; color: #111; }
          table { border-collapse: collapse; width: 100%; margin-bottom: 20px; font-size: 11px; }
          td, th { border: 1px solid #cbd5e1; padding: 6px 10px; text-align: left; }
          tr:nth-child(even) { background-color: #f8fafc; }
          tr:first-child, tr:first-child th { background-color: #1e293b; color: #ffffff; font-weight: bold; }
        </style>
      </head>
      <body>
        ${htmlSheets}
      </body>
    </html>
  `;

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'domcontentloaded' });
    await page.pdf({
      path: outputPath,
      format: 'A4',
      landscape: true,
      margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' },
      printBackground: true,
    });
    return outputPath;
  } finally {
    await browser.close();
  }
}

/**
 * Converts Image file to PDF.
 */
export async function convertImageToPdf(imagePath: string, outputPath: string, mimetype: string): Promise<string> {
  const imageBuffer = fs.readFileSync(imagePath);
  const base64 = imageBuffer.toString('base64');
  const dataUri = `data:${mimetype || 'image/png'};base64,${base64}`;

  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { margin: 0; padding: 20px; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #fff; box-sizing: border-box; }
          img { max-width: 100%; max-height: 95vh; object-fit: contain; border-radius: 4px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
        </style>
      </head>
      <body>
        <img src="${dataUri}" alt="Document Image" />
      </body>
    </html>
  `;

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'domcontentloaded' });
    await page.pdf({
      path: outputPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
    });
    return outputPath;
  } finally {
    await browser.close();
  }
}

/**
 * Converts Text file to PDF.
 */
export async function convertTextToPdf(textPath: string, outputPath: string): Promise<string> {
  const textContent = fs.readFileSync(textPath, 'utf-8');
  const escapedText = textContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: 'Helvetica Neue', Arial, sans-serif; padding: 40px; color: #1a1a1a; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
        </style>
      </head>
      <body>${escapedText}</body>
    </html>
  `;

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'domcontentloaded' });
    await page.pdf({
      path: outputPath,
      format: 'A4',
      margin: { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' },
    });
    return outputPath;
  } finally {
    await browser.close();
  }
}

/**
 * Main conversion routing utility.
 * If file is not PDF, converts it to PDF and returns the path to the resulting PDF file.
 */
export async function ensurePdfFormat(filePath: string, mimetype: string, originalName: string): Promise<{ pdfPath: string; isConverted: boolean }> {
  const ext = path.extname(originalName).toLowerCase();

  // If already PDF, return as is
  if (mimetype === 'application/pdf' || ext === '.pdf') {
    return { pdfPath: filePath, isConverted: false };
  }

  const pdfOutputPath = `${filePath}_converted.pdf`;

  if (ext === '.txt' || mimetype.includes('text')) {
    console.log(`[Converter] Converting Text to PDF: ${originalName}`);
    await convertTextToPdf(filePath, pdfOutputPath);
    return { pdfPath: pdfOutputPath, isConverted: true };
  }

  if (ext === '.docx' || ext === '.doc' || mimetype.includes('wordprocessingml') || mimetype.includes('msword')) {
    console.log(`[Converter] Converting DOCX to PDF: ${originalName}`);
    await convertDocxToPdf(filePath, pdfOutputPath);
    return { pdfPath: pdfOutputPath, isConverted: true };
  }

  if (ext === '.xlsx' || ext === '.xls' || mimetype.includes('spreadsheet') || mimetype.includes('excel')) {
    console.log(`[Converter] Converting Excel to PDF: ${originalName}`);
    await convertExcelToPdf(filePath, pdfOutputPath);
    return { pdfPath: pdfOutputPath, isConverted: true };
  }

  if (mimetype.includes('image') || ['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
    console.log(`[Converter] Converting Image to PDF: ${originalName}`);
    await convertImageToPdf(filePath, pdfOutputPath, mimetype);
    return { pdfPath: pdfOutputPath, isConverted: true };
  }

  // Fallback: return original file path if unrecognized
  return { pdfPath: filePath, isConverted: false };
}
