// SMTP messages are only transmitted when explicitly requested by a caller.
// Never print credentials, application passwords, or OTPs to logs.
require('dotenv').config();
const nodemailer = require('nodemailer');

function smtpConfig(env = process.env) {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_APP_PASSWORD) {
    throw new Error('SMTP is not configured. Supply SMTP_HOST, SMTP_USER, SMTP_APP_PASSWORD in your local .env.');
  }
  const port = env.SMTP_PORT ? Number(env.SMTP_PORT) : 465;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid SMTP_PORT');
  return {
    host: env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_APP_PASSWORD }
  };
}

let transport;
function getTransport() {
  if (!transport) transport = nodemailer.createTransport(smtpConfig());
  return transport;
}

async function sendEmail(to, subject, text) {
  if (!to || !subject || !text) throw new Error('Email recipient, subject and message are required');
  const info = await getTransport().sendMail({
    from: process.env.SMTP_USER,
    to,
    subject,
    text
  });
  return info.messageId;
}

async function verifyEmailConnection() {
  await getTransport().verify();
  console.log('SMTP connection verification completed.');
}

module.exports = { sendEmail, verifyEmailConnection, smtpConfig };
