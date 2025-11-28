const pool = require('../../../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Global login for both controllers and super users
const login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    // Find user in users_nex_lock
    const userResult = await pool.query('SELECT * FROM users_nex_lock WHERE email = $1', [email]);
    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = userResult.rows[0];

    // Check password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Get additional info based on role
    let additionalInfo = {};
    if (user.role === 'controller') {
      const controllerResult = await pool.query('SELECT * FROM controllers_nex_lock WHERE email = $1', [email]);
      if (controllerResult.rows.length > 0) {
        additionalInfo = controllerResult.rows[0];
      }
    } else if (user.role === 'owner') {
      const customerResult = await pool.query('SELECT * FROM customers_nex_lock WHERE email = $1', [email]);
      if (customerResult.rows.length > 0) {
        additionalInfo = customerResult.rows[0];
      }
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, company_id: user.company_id },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        company_id: user.company_id,
        ...additionalInfo
      }
    });
  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  login,
};
