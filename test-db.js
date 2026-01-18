require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: false,
  connectionTimeoutMillis: 10000, // 10 second timeout
});

console.log('Testing database connection...');
console.log(`Host: ${process.env.DB_HOST}`);
console.log(`Port: ${process.env.DB_PORT}`);
console.log(`Database: ${process.env.DB_NAME}`);
console.log(`User: ${process.env.DB_USER}`);

pool.connect()
  .then(client => {
    console.log('✅ Successfully connected to database!');
    return client.query('SELECT version()')
      .then(result => {
        console.log('PostgreSQL version:', result.rows[0].version);
        client.release();
        pool.end();
        process.exit(0);
      })
      .catch(err => {
        console.error('❌ Query failed:', err.message);
        client.release();
        pool.end();
        process.exit(1);
      });
  })
  .catch(err => {
    console.error('❌ Connection failed:', err.message);
    console.error('Error code:', err.code);
    pool.end();
    process.exit(1);
  });