require('dotenv').config();
const mysql = require('mysql2/promise');
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  // Observation DATETIME values are KST wall-clock strings, never host-local Dates.
  dateStrings: true,
  waitForConnections: true,
  connectionLimit: 20,
  queueLimit: 0,
  // Fail fast with a real error instead of letting API requests hang when MySQL is
  // unreachable (the browser would otherwise just time out: "cannot reach the server").
  connectTimeout: 10000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
});
module.exports = pool;
