const { PDFDocument } = require('pdf-lib');
const sharp = require('sharp');

/**
 * Build a multi-page PDF from image buffers (one page per image, native aspect ratio).
 * Order of `files` is preserved.
 * @param {Array<{ buffer: Buffer, mimetype?: string }>} files
 * @returns {Promise<Buffer>}
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

    const mime = String(file.mimetype || '').toLowerCase();
    let embedBytes = file.buffer;
    let kind = 'jpg';

    if (mime === 'image/png') {
      kind = 'png';
    } else if (mime === 'image/jpeg' || mime === 'image/jpg') {
      kind = 'jpg';
    } else {
      // webp/gif/heic/etc → jpeg via sharp
      try {
        embedBytes = await sharp(file.buffer)
          .rotate()
          .jpeg({ quality: 88, mozjpeg: true })
          .toBuffer();
        kind = 'jpg';
      } catch (err) {
        throw new Error(`Could not process image: ${err.message}`);
      }
    }

    let image;
    try {
      image =
        kind === 'png'
          ? await pdfDoc.embedPng(embedBytes)
          : await pdfDoc.embedJpg(embedBytes);
    } catch (err) {
      // Corrupt JPEG that claims jpeg — re-encode once
      try {
        embedBytes = await sharp(file.buffer)
          .rotate()
          .jpeg({ quality: 88, mozjpeg: true })
          .toBuffer();
        image = await pdfDoc.embedJpg(embedBytes);
      } catch {
        throw new Error(`Could not embed image in PDF: ${err.message}`);
      }
    }

    const { width, height } = image.scale(1);
    const page = pdfDoc.addPage([width, height]);
    page.drawImage(image, { x: 0, y: 0, width, height });
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

module.exports = { imagesToEmploymentFormPdf };
