// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  console.error('[error]', err.message);

  if (err.code === '23505') {
    return res.status(409).json({ error: 'resource already exists' });
  }
  if (err.code === '23503') {
    return res.status(400).json({ error: 'referenced resource not found' });
  }

  const status = err.status || 500;
  const message = status < 500 ? err.message : 'internal server error';
  res.status(status).json({ error: message });
}

module.exports = errorHandler;
