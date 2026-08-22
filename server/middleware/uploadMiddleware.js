const path = require('path');
const multer = require('multer');

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB per file

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const PDF_TYPES = new Set(['application/pdf']);

function fileFilter(req, file, cb) {
  const field = file.fieldname;

  if (field === 'cv') {
    if (!PDF_TYPES.has(file.mimetype)) {
      return cb(new Error('CV must be a PDF file.'));
    }
    return cb(null, true);
  }

  if (['cnic_front', 'cnic_back', 'profile_picture'].includes(field)) {
    if (!IMAGE_TYPES.has(file.mimetype)) {
      return cb(new Error(`${field} must be an image (jpeg, png, webp, or gif).`));
    }
    return cb(null, true);
  }

  return cb(new Error(`Unexpected file field: ${field}`));
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 4 },
  fileFilter,
});

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

    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: 'Each file must be 5MB or smaller.' });
      }
      return res.status(400).json({ message: err.message });
    }

    return res.status(400).json({ message: err.message || 'Invalid upload.' });
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

    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: 'Each file must be 5MB or smaller.' });
      }
      return res.status(400).json({ message: err.message });
    }

    return res.status(400).json({ message: err.message || 'Invalid upload.' });
  });
}

/**
 * Authenticated document upload (any of: cnic_front, cnic_back, cv).
 */
function documentUpload(req, res, next) {
  upload.fields([
    { name: 'cnic_front', maxCount: 1 },
    { name: 'cnic_back', maxCount: 1 },
    { name: 'cv', maxCount: 1 },
  ])(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: 'Each file must be 5MB or smaller.' });
      }
      return res.status(400).json({ message: err.message });
    }

    return res.status(400).json({ message: err.message || 'Invalid upload.' });
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

    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: 'Each file must be 8MB or smaller.' });
      }
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ message: 'Maximum 10 images (or 1 PDF) allowed.' });
      }
      return res.status(400).json({ message: err.message });
    }

    return res.status(400).json({ message: err.message || 'Invalid upload.' });
  });
}

module.exports = {
  signupUpload,
  profilePictureUpload,
  documentUpload,
  employmentFormUpload,
  extFromFile,
};

