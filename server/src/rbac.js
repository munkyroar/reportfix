// Role-based access control. Every API route declares the permission it needs.
// Ownership / department scoping (ABAC) is enforced inside the handlers on top of this.
export const PERMISSIONS = {
  student: [
    'me:read', 'board:read',
    'report:create', 'report:clarify_own',
    'issue:read_public', 'issue:read_own',
    'issue:metoo', 'issue:vote',
    'account:manage',
  ],
  staff: [
    'me:read', 'board:read', 'account:manage',
    'queue:read_dept', 'issue:read_dept',
    'issue:status_dept', 'issue:reroute_dept',
  ],
  admin: [
    'me:read', 'board:read', 'account:manage',
    'admin:reset_password', 'admin:export',
    'issue:read_all', 'issue:read_confidential',
    'issue:status_any', 'issue:reroute_any',
    'admin:issues', 'admin:confidential', 'admin:users', 'admin:flags', 'admin:summary', 'admin:ailog',
    'demo:reset',
  ],
};

export function can(user, perm) {
  return !!user && (PERMISSIONS[user.role] || []).includes(perm);
}

// express middleware: requires ANY of the given permissions
export const requirePerm = (...perms) => (req, res, next) =>
  (perms.some((p) => can(req.user, p)) ? next() : res.status(403).json({ error: 'Forbidden' }));
