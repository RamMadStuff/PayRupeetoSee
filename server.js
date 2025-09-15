// server.js (CommonJS)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');  // PostgreSQL client

const PORT = process.env.PORT || 4000;
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';

const DATABASE_URL = process.env.DATABASE_URL;

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Required for Render/Heroku
});

// ✅ Initialize DB with counter table
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS counter (
      id SERIAL PRIMARY KEY,
      count INTEGER DEFAULT 0
    );
  `);

  // Ensure at least one row exists
  const result = await pool.query("SELECT * FROM counter LIMIT 1");
  if (result.rows.length === 0) {
    await pool.query("INSERT INTO counter (count) VALUES (0)");
  }
}
initDB();

const app = express();
app.use(cors());
app.use(express.json());

const razorpay = new Razorpay({
  key_id: RAZORPAY_KEY_ID,
  key_secret: RAZORPAY_KEY_SECRET,
});

// ✅ Health check route
app.get('/', (req, res) => {
  res.send('🚀 API is running with PostgreSQL at api.payonerupee.online');
});

/**
 * Create order (called by frontend)
 */
app.post('/create-order', async (req, res) => {
  try {
    const options = {
      amount: 100, // ₹1 = 100 paise
      currency: 'INR',
      receipt: `receipt_${Date.now()}`,
      payment_capture: 1,
    };
    const order = await razorpay.orders.create(options);
    res.json(order);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'create-order failed' });
  }
});

/**
 * Verify payment
 */
app.post('/verify', async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ success: false, message: 'Missing fields' });
  }

  const body = razorpay_order_id + '|' + razorpay_payment_id;
  const expectedSignature = crypto
    .createHmac('sha256', RAZORPAY_KEY_SECRET)
    .update(body)
    .digest('hex');

  if (expectedSignature === razorpay_signature) {
    try {
      // increment counter in DB
      await pool.query(`UPDATE counter SET count = count + 1 WHERE id = 1`);
      const result = await pool.query(`SELECT count FROM counter WHERE id = 1`);
      const currentCount = result.rows[0].count;

      // generate JWT
      const token = jwt.sign({ paid: true, ts: Date.now() }, JWT_SECRET, { expiresIn: '7d' });

      return res.json({ success: true, token, count: currentCount });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: 'DB error' });
    }
  } else {
    return res.status(400).json({ success: false, message: 'Invalid signature' });
  }
});

/**
 * Protected route to read the counter
 */
app.get('/count', async (req, res) => {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return res.status(403).json({ message: 'Unauthorized' });

  const token = auth.split(' ')[1];
  try {
    jwt.verify(token, JWT_SECRET);

    // fetch count from DB
    const result = await pool.query(`SELECT count FROM counter WHERE id = 1`);
    const currentCount = result.rows[0].count;

    return res.json({ count: currentCount });
  } catch (err) {
    return res.status(403).json({ message: 'Unauthorized' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Backend running on http://localhost:${PORT}`);
});
