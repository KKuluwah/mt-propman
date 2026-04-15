const csrfProtect = (req, res, next) => {
  const origin = req.headers.origin || req.headers.referer || '';
  if (origin && !origin.startsWith(`http://localhost:${process.env.PORT || 3000}`)) {
    return res.status(403).json({ error: 'Forbidden: invalid request origin.' });
  }
  next();
};

export default csrfProtect;
