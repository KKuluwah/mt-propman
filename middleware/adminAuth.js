// Protect routes — redirect to login if no session
export function requireAdmin(req, res, next) {
  if (req.session?.admin) return next();
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(401).json({ error: 'Login required.' });
  }
  res.redirect('/login.html');
}
