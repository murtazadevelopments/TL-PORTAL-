const path = require('path');
const multer = require('multer');

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB per image
const MAX_CV_FILE_SIZE = 8 * 1024 * 1024; // 8MB for CV PDFs

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const PDF_TYPES = new Set([
  'application/pdf',
  'application/x-pdf',
  'application/acrobat',
  'application/vnd.pdf',
  'text/pdf',
]);
const CLEARLY_NOT_PDF = new Set([
  ...IMAGE_TYPES,
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/html',
]);

function bufferLooksLikePdf(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 5) return false;
  // Allow a small BOM / leading whitespace before %PDF
  const head = buf.subarray(0, 16).toString('latin1');
  return /%PDF-/i.test(head);
}

function looksLikePdfUpload(file) {
  const mime = String(file?.mimetype || '').toLowerCase().trim();
  const name = String(file?.originalname || '').toLowerCase();
  if (CLEARLY_NOT_PDF.has(mime)) return false;
  if (PDF_TYPES.has(mime)) return true;
  if (name.endsWith('.pdf')) return true;
  // Mobile often sends blank or octet-stream — accept and verify magic bytes after parse.
  if (!mime || mime === 'application/octet-stream' || mime === 'binary/octet-stream') {
    return true;
  }
  return false;
}

function fileFilter(req, file, cb) {
  const field = file.fieldname;

  if (field === 'cv') {
    if (!looksLikePdfUpload(file)) {
      return cb(
        new Error(
          'CV must be a real PDF file. Open it in a PDF reader, or Export/Save As PDF from Word, then upload.'
        )
      );
    }
    return cb(null, true);
  }

  if (['cnic_front', 'cnic_back', 'profile_picture', 'picture'].includes(field)) {
    if (!IMAGE_TYPES.has(file.mimetype)) {
      return cb(new Error(`${field} must be an image (jpeg, png, webp, or gif).`));
    }
    return cb(null, true);
  }

  if (field === 'extra_1_file' || field === 'extra_2_file') {
    if (!IMAGE_TYPES.has(file.mimetype) && !PDF_TYPES.has(file.mimetype)) {
      return cb(new Error('Extra files must be an image or PDF.'));
    }
    return cb(null, true);
  }

  return cb(new Error(`Unexpected file field: ${field}`));
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 6 },
  fileFilter,
});

function isInterruptedUpload(err) {
  const raw = String(err?.message || err?.code || '');
  return /unexpected (end of )?form|unexpected form error|aborted|econnreset|request aborted/i.test(
    raw
  );
}

function sendUploadError(res, err, sizeMessage) {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ message: sizeMessage });
  }
  if (isInterruptedUpload(err)) {
    return res.status(400).json({ message: 'Check your internet connection.' });
  }
  return res.status(400).json({ message: err?.message || 'Invalid upload.' });
}

/**
 * Signup multipart parser:
 * text fields + cnic_front, cnic_back, cv, profile_picture
 */
function signupUpload(req, res, next) {
  upload.fields([
    { name: 'cnic_front', maxCount: 1 },
    { name: 'cnic_back', maxCount: 1 },
    { name: 'cv', maxCount: 1 },
    { name: 'profile_picture', maxCount: 1 },
  ])(req, res, (err) => {
    if (!err) return next();
    return sendUploadError(res, err, 'Each file must be 5MB or smaller.');
  });
}

function extFromFile(file, fallback) {
  const fromName = path.extname(file.originalname || '').toLowerCase();
  if (fromName) return fromName;
  return fallback;
}

/**
 * Authenticated profile-picture upload (single image field).
 */
function profilePictureUpload(req, res, next) {
  upload.single('profile_picture')(req, res, (err) => {
    if (!err) return next();
    return sendUploadError(res, err, 'Each file must be 5MB or smaller.');
  });
}

/**
 * Authenticated document upload (any of: cnic_front, cnic_back, cv).
 * Multer limit is 8MB so CVs fit; CNIC images are re-checked at 5MB after parse.
 */
function documentUpload(req, res, next) {
  const documentMulter = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_CV_FILE_SIZE, files: 6 },
    fileFilter,
  });

  documentMulter.fields([
    { name: 'cnic_front', maxCount: 1 },
    { name: 'cnic_back', maxCount: 1 },
    { name: 'cv', maxCount: 1 },
  ])(req, res, (err) => {
    if (err) {
      console.warn(
        `[upload] document multer reject: code=${err.code || 'n/a'} message=${err.message || err}`
      );
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        const field = String(err.field || '');
        if (field === 'cv') {
          return res.status(400).json({ message: 'CV must be a PDF of 8MB or smaller.' });
        }
        return res.status(400).json({ message: 'Each image must be 5MB or smaller.' });
      }
      return sendUploadError(res, err, 'Each file must be 8MB or smaller.');
    }

    for (const field of ['cnic_front', 'cnic_back']) {
      const file = req.files?.[field]?.[0];
      if (file && Number(file.size) > MAX_FILE_SIZE) {
        return res.status(400).json({ message: 'Each image must be 5MB or smaller.' });
      }
    }

    const cv = req.files?.cv?.[0];
    if (cv) {
      console.log(
        `[upload] cv candidate name=${cv.originalname || '?'} mime=${cv.mimetype || '?'} size=${cv.size || 0}`
      );
      if (!bufferLooksLikePdf(cv.buffer)) {
        return res.status(400).json({
          message:
            'This file is not a valid PDF (contents do not look like a PDF). If it is a Word document, Export/Save As PDF first — renaming .docx to .pdf will not work.',
        });
      }
      // Normalize so save path always treats it as PDF.
      cv.mimetype = 'application/pdf';
      if (!String(cv.originalname || '').toLowerCase().endsWith('.pdf')) {
        cv.originalname = `${String(cv.originalname || 'cv').replace(/\.[^.]+$/, '') || 'cv'}.pdf`;
      }
    }
    return next();
  });
}

function employmentFormUpload(req, res, next) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024, files: 10 },
    fileFilter(req, file, cb) {
      const field = String(file.fieldname || '');
      const mime = String(file.mimetype || '').toLowerCase();
      if (field === 'pdf') {
        if (mime !== 'application/pdf') {
          return cb(new Error('Employment form file must be a PDF.'));
        }
        return cb(null, true);
      }
      if (field === 'images') {
        if (!mime.startsWith('image/')) {
          return cb(new Error('Employment form pages must be images.'));
        }
        return cb(null, true);
      }
      return cb(new Error(`Unexpected file field: ${field}`));
    },
  });

  upload.fields([
    { name: 'pdf', maxCount: 1 },
    { name: 'images', maxCount: 10 },
  ])(req, res, (err) => {
    if (!err) return next();
    if (
      err instanceof multer.MulterError &&
      (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE')
    ) {
      return res.status(400).json({ message: 'Maximum 10 images (or 1 PDF) allowed.' });
    }
    return sendUploadError(res, err, 'Each file must be 8MB or smaller.');
  });
}

function messagePictureUpload(req, res, next) {
  const contentType = String(req.headers['content-type'] || '');
  if (!contentType.includes('multipart/form-data')) return next();
  upload.single('picture')(req, res, (err) => {
    if (!err) return next();
    return sendUploadError(res, err, 'Picture must be 5MB or smaller.');
  });
}

function lowerStaffUpload(req, res, next) {
  const contentType = String(req.headers['content-type'] || '');
  if (!contentType.includes('multipart/form-data')) return next();

  upload.fields([
    { name: 'cnic_front', maxCount: 1 },
    { name: 'cnic_back', maxCount: 1 },
    { name: 'extra_1_file', maxCount: 1 },
    { name: 'extra_2_file', maxCount: 1 },
  ])(req, res, (err) => {
    if (!err) return next();
    return sendUploadError(res, err, 'Each file must be 5MB or smaller.');
  });
}

/**
 * Leave prescription: single image or PDF field "prescription".
 */
function leavePrescriptionUpload(req, res, next) {
  const leaveUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE, files: 1 },
    fileFilter(req, file, cb) {
      const mime = String(file.mimetype || '').toLowerCase();
      if (mime === 'application/pdf' || mime.startsWith('image/')) {
        return cb(null, true);
      }
      return cb(new Error('Document must be an image or PDF.'));
    },
  });

  leaveUpload.single('prescription')(req, res, (err) => {
    // Annual leave may omit the file; multer still parses the multipart body.
    if (!err) return next();
    return sendUploadError(res, err, 'Document must be 5MB or smaller.');
  });
}

module.exports = {
  signupUpload,
  profilePictureUpload,
  documentUpload,
  employmentFormUpload,
  messagePictureUpload,
  lowerStaffUpload,
  leavePrescriptionUpload,
  extFromFile,
  bufferLooksLikePdf,
  MAX_CV_FILE_SIZE,
};

