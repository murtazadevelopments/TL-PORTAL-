const { PDFDocument } = require('pdf-lib');
const sharp = require('sharp');

/** Long edge in PDF points (~A4). Viewers then scale the whole page to the screen. */
const PAGE_LONG_EDGE = 842;
const MAX_IMAGE_EDGE = 2480;

/**
 * Build a multi-page PDF from camera/gallery scans.
 * Page size follows the photo (no crop, no forced A4 bars) but is sized so
 * phones and desktops can fit-width / pinch-zoom the full page.
 */
async function imagesToEmploymentFormPdf(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('At least one image is required.');
  }

  const pdfDoc = await PDFDocument.create();

  for (const file of files) {
    if (!file?.buffer?.length) {
      throw new Error('One of the uploaded images is empty.');
    }

    let jpegBytes;
    try {
      jpegBytes = await sharp(file.buffer)
        .rotate()
        .resize({
          width: MAX_IMAGE_EDGE,
          height: MAX_IMAGE_EDGE,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 86, mozjpeg: true })
        .toBuffer();
    } catch (err) {
      throw new Error(`Could not process image: ${err.message}`);
    }

    const image = await pdfDoc.embedJpg(jpegBytes);
    const imgW = image.width;
    const imgH = image.height;
    const longEdge = Math.max(imgW, imgH) || 1;
    const scale = PAGE_LONG_EDGE / longEdge;
    const pageW = Math.max(1, imgW * scale);
    const pageH = Math.max(1, imgH * scale);

    const page = pdfDoc.addPage([pageW, pageH]);
    page.drawImage(image, { x: 0, y: 0, width: pageW, height: pageH });
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

module.exports = { imagesToEmploymentFormPdf };
