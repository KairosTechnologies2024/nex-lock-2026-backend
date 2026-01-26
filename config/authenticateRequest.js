const jwt = require('jsonwebtoken');

function authenticateRequest(req, res, next) {
  try {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: 'Authentication token missing' });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
      if (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }

      req.user = decoded;
      console.log('Authenticated user:', req.user);
      console.log('token:', token);
      next();
    });
  } catch (err) {
    console.error('Auth middleware error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}



module.exports = authenticateRequest;