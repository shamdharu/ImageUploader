// Role-Based Access Control (very basic, mirrors Doc 1 section 3).
// Every action (upload / view / download / print) is checked independently.

export function isOwner(user, category) {
  return category.owner_user_id === user.id;
}

export function isAssigned(db, userId, categoryId) {
  return !!db.prepare('SELECT 1 FROM category_acl WHERE category_id = ? AND user_id = ?').get(categoryId, userId);
}

export function canManageCategories(user) {
  return user.role === 'admin' || user.role === 'manager';
}

/** Who may SEE images in this category. */
export function canView(db, user, category) {
  if (user.role === 'admin') return true;
  return isOwner(user, category) || isAssigned(db, user.id, category.id);
}

/** Who may UPLOAD into this category. */
export function canUpload(db, user, category) {
  if (user.role === 'admin') return true;
  if (user.role !== 'manager' && user.role !== 'contributor') return false;
  return isOwner(user, category) || isAssigned(db, user.id, category.id);
}

/**
 * Highest resolution this user may DOWNLOAD from this category.
 * 'web' - thumbnail + web only | 'hd' | 'original'
 */
export function maxDownloadResolution(db, user, category) {
  if (user.role === 'admin') return 'original';
  if (user.role === 'manager') return isOwner(user, category) || isAssigned(db, user.id, category.id) ? 'original' : 'web';
  if (user.role === 'contributor') return isOwner(user, category) ? 'original' : 'web';
  if (user.role === 'viewer') return isOwner(user, category) ? 'web' : 'web';
  return null;
}

/** Who may PRINT (full-resolution print quality) from this category. */
export function canPrint(db, user, category) {
  if (user.role === 'admin') return true;
  if (user.role === 'manager') return isOwner(user, category) || isAssigned(db, user.id, category.id);
  return false; // contributors & viewers: no print
}

/**
 * Can this user download a specific variant (independent of view/print rights)?
 * Allows thumbnail/web/hd/original up to their maxDownload cap.
 */
export function canDownloadResolution(db, user, category, variant) {
  const rank = RANK[variant];
  if (!rank || variant === 'print') return false;
  const max = maxDownloadResolution(db, user, category);
  return !!(max && rank <= RANK[max]);
}

const RANK = { thumbnail: 1, web: 2, hd: 3, original: 4, print: 5 };

/**
 * Evaluate a specific file-serving request for an image.
 * Returns { allowed, action } where action ∈ {view, download, print}.
 */
export function serveAccess(db, user, category, variant) {
  const rank = RANK[variant];
  if (!rank) return { allowed: false, action: null };
  if (variant === 'print') return { allowed: canPrint(db, user, category), action: 'print' };
  if (rank <= 2) return { allowed: canView(db, user, category), action: 'view' };

  const max = maxDownloadResolution(db, user, category);
  if (!max) return { allowed: false, action: 'download' };
  const allowed = RANK[max] >= rank;
  return { allowed, action: 'download' };
}