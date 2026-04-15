const csrfProtect = (req, res, next) => {
  const origin = req.headers.origin || req.headers.referer || '';
  if (!origin) return next(); // server-to-server or same-origin form posts

  const allowed = [
    `http://localhost:${process.env.PORT || 3000}`,
    process.env.APP_URL
  ].filter(Boolean);

  if (!allowed.some(base => origin.startsWith(base))) {
    return res.status(403).json({ error: 'Forbidden.' });
  }
  next();
};

export default csrfProtect;
