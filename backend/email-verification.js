
const crypto = require('crypto');
const pool = require('./db');
const { sendEmail } = require('./email-service');

const OTP_EXPIRY_MINUTES = 5;

function hashOtp(userId, otp) {
    const secret = process.env.OTP_SECRET;

    if (!secret || secret.length < 32) {
        throw new Error(
            'OTP_SECRET must contain at least 32 characters.'
        );
    }

    return crypto
        .createHmac('sha256', secret)
        .update(`${userId}:${otp}`)
        .digest('hex');
}

async function sendVerificationEmail(userId, email) {
    // Generate a secure six-digit OTP.
    const otp = crypto.randomInt(
        100000,
        1000000
    ).toString();

    // Store only the HMAC hash, never the OTP itself.
    const otpHash = hashOtp(userId, otp);

    // Replace previous verification tokens.
    await pool.execute(
        `DELETE FROM email_verification_tokens
         WHERE user_id = ?`,
        [userId]
    );

    // Store the OTP hash with a five-minute expiry.
    await pool.execute(
        `INSERT INTO email_verification_tokens
            (user_id, token_hash, expires_at, attempts, created_at)
         VALUES (
            ?,
            ?,
            DATE_ADD(
                UTC_TIMESTAMP(),
                INTERVAL 5 MINUTE
            ),
            0,
            UTC_TIMESTAMP()
         )`,
        [userId, otpHash]
    );

    const subject =
        'Your Verification Code - Weather and Flood Risk Forecasting';

    const message = `
Welcome to Weather and Flood Risk Forecasting!

Your email verification code is:

${otp}

This code expires in ${OTP_EXPIRY_MINUTES} minutes.

Do not share this code with anyone.

If you did not create this account,
you can ignore this email.

--------------------------------------------
Weather and Flood Risk Forecasting
Educational Capstone Project

This system is not an official government
weather or flood warning service.
`;

    await sendEmail(email, subject, message);

    return {
        success: true,
        message: 'Verification OTP sent successfully.'
    };
}

module.exports = {
    sendVerificationEmail,
    hashOtp
};
