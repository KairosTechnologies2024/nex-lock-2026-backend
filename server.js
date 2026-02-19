require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createTransport } = require('nodemailer');
const app = express();
const port =  3001;
const crypto = require('crypto');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,


});

    const otp = crypto.randomInt(100000, 999999).toString();
        const expires = Date.now() + 5 * 60 * 1000; 
        const otpData = `${otp}:${expires}`;
const sendOTPEmail = async (email, otp, userId) => {
  const expires = Date.now() + 5 * 60 * 1000;
  const otpData = `${otp}:${expires}`;
  
  const transporter = createTransport({
    host: 'mail.kairostechnology.co.za',
    port: 465,
    secure: true,
    auth: {
      user: 'no-reply@kairostechnology.co.za',
      pass: 'sxaUnu%%j7S}&]Yr',
    },
  });

  await transporter.sendMail({
    from: 'no-reply@kairostechnology.co.za',
    to: email,
    subject: 'NFC OTP Code',
    html: `
      <html>
        <head>
          <style>
            body {
              font-family: Arial, sans-serif;
              background-color: #f4f6f9;
              margin: 0;
              padding: 0;
            }
            .container {
              width: 100%;
              max-width: 600px;
              margin: 0 auto;
              background-color: #ffffff;
              padding: 20px;
              border-radius: 8px;
              box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
            }
            .header {
              text-align: center;
              margin-bottom: 20px;
            }
            .header h2 {
              color: #333;
              font-size: 24px;
              margin: 0;
            }
            .content {
              font-size: 16px;
              color: #555;
              line-height: 1.5;
            }
            .content p {
              margin: 10px 0;
            }
            .otp-code {
              font-size: 24px;
              font-weight: bold;
              color: #007BFF;
              text-align: center;
              margin: 20px 0;
              padding: 10px;
              background-color: #f8f9fa;
              border-radius: 5px;
            }
            .footer {
              text-align: center;
              font-size: 12px;
              color: #888;
              margin-top: 20px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h2>Your OTP Code</h2>
            </div>
            <div class="content">
              <p>Hi,</p>
              <p>The one-time password (OTP) for the NFC App login is:</p>
              <div class="otp-code">${otp}</div>
              <p>This code will expire in 5 minutes. If you did not request this, please ignore this email.</p>
            </div>
            <div class="footer">
              <p>&copy; 2026 Kairos Technology. All Rights Reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `,
  });
   await pool.query('UPDATE users_nex_lock SET twofa_secret = $1 WHERE id = $2', [otpData, userId]);
};


// Token generation functions
const generateAccessToken = (id, email, role, company_id) => {
  return jwt.sign(
    { id, email, role, company_id },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
};

const generateRefreshToken = (id, email, role, company_id) => {
  return jwt.sign(
    { id, email, role, company_id },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
};

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

    // Send OTP email after successful login (hardcoded to user 13)
    const loginOtp = crypto.randomInt(100000, 999999).toString();
    await sendOTPEmail("nhlamulo@kairostechnology.co.za", loginOtp, 13);

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
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        twofa_enabled: user.twofa_enabled,
        company_id: user.company_id,
        ...additionalInfo
      }
    });
  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};


app.use(express.json());
app.use(express.urlencoded({ extended: true }));



app.get('/api/geofences/for-serial', async (req, res) => {

  const serial = req.headers.serial;
  const truckId = serial ? parseInt(serial, 10) : null;
  if (!truckId) return res.status(400).json({ error: 'Missing or invalid truck id in header `serial`' });
  try {
    const result = await pool.query(
      'SELECT id, lat, lng, radius_km as rad, shape, polygon_coords FROM geofences WHERE $1 = ANY(trucks) AND active = true ORDER BY id',
      [truckId]
    );

    const data = result.rows; 

    let dataMapped = data.map(row => {
      const shape = row.shape || 'circle';
      const polygon = Array.isArray(row.polygon_coords) ? row.polygon_coords : [];
      if (shape === 'polygon' && polygon.length > 0) {
    /*      return {
          id: row.id,
          lat: polygon.map(p => parseFloat(p.lat)),
          lng: polygon.map(p => parseFloat(p.lng)),
          rad: 0,
       
        };  */
      }
      return {
        id: row.id,
        lat: parseFloat(row.lat),
        lng: parseFloat(row.lng),
        rad: parseFloat(row.rad),
      
      };
    });
   

   // console.log('mapped data', dataMapped)
   // console.log(data);
    res.json(dataMapped);
  } catch (error) {
    console.error('Error fetching geofences for truck id', truckId, error);
    res.status(500).json({ error: 'Internal server error' });
  }
});




app.get('/api/geofences/for-serial-test', async (req, res) => {

  const serial = req.headers.serial;
  const truckId = serial ? parseInt(serial, 10) : null;
  if (!truckId) return res.status(400).json({ error: 'Missing or invalid truck id in header `serial`' });
  try {
    const result = await pool.query(
      'SELECT id, lat, lng, radius_km as rad, shape, polygon_coords FROM geofences WHERE $1 = ANY(trucks) AND active = true ORDER BY id',
      [truckId]
    );

    const data = result.rows;

    let dataMapped = data.map(row => {
      const shape = row.shape || 'circle';
      const polygon = Array.isArray(row.polygon_coords) ? row.polygon_coords : [];
      if (shape === 'polygon' && polygon.length > 0) {
        return {
          id: row.id,
          lat: polygon.map(p => parseFloat(p.lat)),
          lng: polygon.map(p => parseFloat(p.lng)),
          rad: 0,

        };
      }
      return {
        id: row.id,
        lat: [parseFloat(row.lat)],
        lng: [parseFloat(row.lng)],
        rad: parseFloat(row.rad),

      };
    });


   // console.log('mapped data', dataMapped)
   // console.log(data);
    res.json(dataMapped);
  } catch (error) {
    console.error('Error fetching geofences for truck id', truckId, error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/nfc-trucks', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT fleet_number, vehicle_reg, device_serial FROM vehicle_info'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching trucks:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/login', login);







const verify2FA = async (req, res) => {
  const userId = 13;
  const { token } = req.body;

  try {
    const result = await pool.query('SELECT id, email, role, twofa_secret FROM users_nex_lock WHERE id = $1', [userId]);
    const user = result.rows[0];

    if (!user || !user.twofa_secret) {
      return res.status(400).json({ error: 'No OTP found.' });
    }

    const [storedOTP, storedExpires] = user.twofa_secret.split(':');
    const now = Date.now();
    const expires = parseInt(storedExpires);

    if (now > expires) {
      return res.status(400).json({ error: 'OTP expired.' });
    }

    if (token !== storedOTP) {
      return res.status(401).json({ error: 'Invalid OTP' });
    }

    // Clear OTP
    await pool.query('UPDATE users_nex_lock SET twofa_secret = NULL WHERE id = $1', [userId]);

    // Generate JWT tokens
    const accessToken = generateAccessToken(user.id, user.email, user.role,  user.company_id);
    const refreshToken = generateRefreshToken(user.id, user.email,  user.role, user.company_id);

    res.json({ message: 'OTP verified', accessToken, refreshToken , user, userId});

  } catch (err) {
    console.error('Error verifying 2FA:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

app.post('/api/verify2fa', verify2FA);














app.listen(port, ()=>{
    console.log('Server is running on port ', port);
})
