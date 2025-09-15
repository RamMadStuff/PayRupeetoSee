// server.js (CommonJS)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const { Pool } = require('pg');  // PostgreSQL client

const PORT = process.env.PORT || 4000;
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';

const DATABASE_URL = process.env.DATABASE_URL;

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // needed for Render/Supabase
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS counter (
      id SERIAL PRIMARY KEY,
      count INTEGER DEFAULT 0
    );
  `);

// Ensure a row exists

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

const DATA_FILE = './data.json';
function readData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (err) {
    const init = { count: 0 };
    fs.writeFileSync(DATA_FILE, JSON.stringify(init, null, 2));
    return init;
  }
}
function writeData(obj) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(obj, null, 2));
}

// ✅ Health check route
app.get('/', (req, res) => {
  res.send('🚀 API is running at api.payonerupee.online');
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
app.post('/verify', (req, res) => {
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
    const data = readData();
    data.count = (data.count || 0) + 1;
    writeData(data);

    const token = jwt.sign({ paid: true, ts: Date.now() }, JWT_SECRET, { expiresIn: '7d' });
    return res.json({ success: true, token, count: data.count });
  } else {
    return res.status(400).json({ success: false, message: 'Invalid signature' });
  }
});

/**
 * Protected route to read the counter
 */
app.get('/count', (req, res) => {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return res.status(403).json({ message: 'Unauthorized' });

  const token = auth.split(' ')[1];
  try {
    jwt.verify(token, JWT_SECRET);
    const data = readData();
    return res.json({ count: data.count });
  } catch (err) {
    return res.status(403).json({ message: 'Unauthorized' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Backend running on http://localhost:${PORT}`);
});
