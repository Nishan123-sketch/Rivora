
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { rateLimit } = require('express-rate-limit');

const pool = require('./db');
const requireAuth = require('./auth-middleware');

const {
    sendVerificationEmail,
    hashOtp
} = require('./email-verification');

const router = express.Router();

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
        success: false,
        message: 'Too many requests. Please try again later.'
    }
});

const otpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
        success: false,
        message: 'Too many verification attempts. Try again later.'
    }
});

const resendLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
        success: false,
        message: 'Too many resend requests. Try again later.'
    }
});

function validEmail(email) {
    return (
        typeof email === 'string' &&
        email.length <= 254 &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    );
}

function normalizeEmail(value) {
    return typeof value === 'string'
        ? value.trim().toLowerCase()
        : '';
}

function createToken(user) {
    const secret = process.env.JWT_SECRET;

    if (!secret || secret.length < 32) {
        throw new Error(
            'JWT_SECRET must contain at least 32 characters.'
        );
    }

    return jwt.sign(
        { userId: Number(user.user_id) },
        secret,
        {
            expiresIn: '2h',
            algorithm: 'HS256'
        }
    );
}

// POST /api/auth/register
router.post('/auth/register', authLimiter, async (req, res) => {
    try {
        const email = normalizeEmail(req.body?.email);
        const password = req.body?.password;

        if (!validEmail(email)) {
            return res.status(400).json({
                success: false,
                message: 'Enter a valid email address.'
            });
        }

        if (
            typeof password !== 'string' ||
            password.length < 12 ||
            Buffer.byteLength(password, 'utf8') > 72
        ) {
            return res.status(400).json({
                success: false,
                message:
                    'Password must be at least 12 characters and no more than 72 UTF-8 bytes.'
            });
        }

        await require('./monitoring-locations').registrationLocation({location:req.body.location,stationId:Number(req.body.station_id),province:req.body.province},pool);
        const passwordHash = await bcrypt.hash(password, 12);

        const result = await require('./register-account').createAccount({email,passwordHash,stationId:Number(req.body.station_id),consent:false},pool);

        // Do not make the public registration response reveal account existence
        // through SMTP latency. Existing authenticated resend remains available.
        setImmediate(()=>{void sendVerificationEmail(result.insertId,email).catch(()=>console.error('Account verification delivery unavailable.'));});

        return res.status(201).json({
            success: true,
            message: 'If this address is eligible, check your email for a verification code. Existing account holders can sign in or recover their password.'
        });

    } catch (error) {
        if(error.status===400)return res.status(400).json({success:false,message:error.message});
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(201).json({
                success: true,
                message: 'If this address is eligible, check your email for a verification code. Existing account holders can sign in or recover their password.'
            });
        }

        console.error('Registration error:', error);

        return res.status(500).json({
            success: false,
            message: 'Registration failed.'
        });
    }
});

// POST /api/auth/login
router.post('/auth/login', authLimiter, async (req, res) => {
    try {
        const email = normalizeEmail(req.body?.email);
        const password = req.body?.password;

        if (
            !validEmail(email) ||
            typeof password !== 'string'
        ) {
            return res.status(400).json({
                success: false,
                message: 'Invalid email or password.'
            });
        }

        const [rows] = await pool.execute(
            `SELECT user_id, email, password_hash,
                    email_verified_at, account_status, must_change_password
             FROM users
             WHERE email = ?
             LIMIT 1`,
            [email]
        );

        if (!rows.length) {
            await bcrypt.compare(password,'$2b$12$GHEl2WLDk4uMLuzRROGoB.7UOqV5DGaT0qwdxU5wc6TQ7BNbv0KlK');
            await require('./account-sessions').audit(pool,null,'EMAIL_LOGIN','FAILED');
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password.'
            });
        }

        const user = rows[0];

        const matches = await bcrypt.compare(
            password,
            user.password_hash
        );

        if (!matches) {
            await require('./account-sessions').audit(pool,null,'EMAIL_LOGIN','FAILED');
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password.'
            });
        }

        if(user.account_status&&user.account_status!=='ACTIVE'){await require('./account-sessions').audit(pool,null,'EMAIL_LOGIN','FAILED');return res.status(401).json({success:false,message:'Invalid email or password.'});}
        const sessionUser=await require('./account-sessions').issue(req,res,user,pool);
        await pool.execute('UPDATE users SET last_login_at=UTC_TIMESTAMP() WHERE user_id=?',[user.user_id]);
        await require('./account-sessions').audit(pool,user.user_id,'EMAIL_LOGIN','SUCCESS');
        const token = user.must_change_password?null:createToken(user);

        return res.json({
            success: true,
            message: 'Login successful.',
            token,
            token_type: 'Bearer',
            expires_in: 7200,
            user: sessionUser
        });

    } catch (error) {
        console.error('Login error:', error);

        return res.status(500).json({
            success: false,
            message: 'Login failed.'
        });
    }
});

// GET /api/auth/me
router.get('/auth/me', requireAuth, (req, res) => {
    return res.json({
        success: true,
        user: req.user
    });
});

// POST /api/auth/verify-otp
router.post('/auth/verify-otp', otpLimiter, async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const otp = req.body?.otp;

    if (
        !validEmail(email) ||
        typeof otp !== 'string' ||
        !/^\d{6}$/.test(otp)
    ) {
        return res.status(400).json({
            success: false,
            message: 'Enter a valid email and 6-digit code.'
        });
    }

    let connection;
    let transactionStarted = false;

    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();
        transactionStarted = true;

        const [users] = await connection.execute(
            `SELECT user_id, email_verified_at
             FROM users
             WHERE email = ?
             FOR UPDATE`,
            [email]
        );

        if (!users.length) {
            await connection.rollback();
            transactionStarted = false;

            return res.status(400).json({
                success: false,
                message: 'Invalid or expired verification code.'
            });
        }

        const user = users[0];

        if (user.email_verified_at) {
            await connection.rollback();
            transactionStarted = false;

            return res.status(400).json({
                success: false,
                message: 'Invalid or expired verification code.'
            });
        }

        const [tokens] = await connection.execute(
            `SELECT
                token_id,
                token_hash,
                attempts,
                expires_at > UTC_TIMESTAMP() AS is_valid
             FROM email_verification_tokens
             WHERE user_id = ?
             ORDER BY token_id DESC
             LIMIT 1
             FOR UPDATE`,
            [user.user_id]
        );

        if (!tokens.length) {
            await connection.rollback();
            transactionStarted = false;

            return res.status(400).json({
                success: false,
                message: 'Invalid or expired verification code.'
            });
        }

        const record = tokens[0];

        if (!record.is_valid) {
            await connection.execute(
                `DELETE FROM email_verification_tokens
                 WHERE user_id = ?`,
                [user.user_id]
            );

            await connection.commit();
            transactionStarted = false;

            return res.status(400).json({
                success: false,
                message: 'Invalid or expired verification code.'
            });
        }

        if (record.attempts >= 5) {
            await connection.commit();
            transactionStarted = false;

            return res.status(429).json({
                success: false,
                message: 'Too many incorrect attempts. Request a new code.'
            });
        }

        const submittedHash = hashOtp(user.user_id, otp);

        const matches = crypto.timingSafeEqual(
            Buffer.from(submittedHash, 'hex'),
            Buffer.from(record.token_hash, 'hex')
        );

        if (!matches) {
            await connection.execute(
                `UPDATE email_verification_tokens
                 SET attempts = attempts + 1
                 WHERE token_id = ?`,
                [record.token_id]
            );

            await connection.commit();
            transactionStarted = false;

            return res.status(400).json({
                success: false,
                message: 'Invalid or expired verification code.'
            });
        }

        await connection.execute(
            `UPDATE users
             SET email_verified_at = UTC_TIMESTAMP()
             WHERE user_id = ?`,
            [user.user_id]
        );

        await connection.execute(
            `DELETE FROM email_verification_tokens
             WHERE user_id = ?`,
            [user.user_id]
        );

        await connection.commit();
        transactionStarted = false;

        return res.json({
            success: true,
            message: 'Email verified successfully.'
        });

    } catch (error) {
        if (connection && transactionStarted) {
            await connection.rollback();
        }

        console.error('OTP verification error:', error);

        return res.status(500).json({
            success: false,
            message: 'OTP verification failed.'
        });

    } finally {
        if (connection) {
            connection.release();
        }
    }
});

// POST /api/auth/resend-otp
router.post(
    '/auth/resend-otp',
    resendLimiter,
    async (req, res) => {
        try {
            const email = normalizeEmail(req.body?.email);
            const password = req.body?.password;

            if (
                !validEmail(email) ||
                typeof password !== 'string'
            ) {
                return res.status(400).json({
                    success: false,
                    message: 'Valid email and password are required.'
                });
            }

            const [users] = await pool.execute(
                `SELECT user_id, email, password_hash,
                        email_verified_at
                 FROM users
                 WHERE email = ?
                 LIMIT 1`,
                [email]
            );

            if (!users.length) {
                return res.status(401).json({
                    success: false,
                    message: 'Invalid email or password.'
                });
            }

            const user = users[0];

            const passwordMatches = await bcrypt.compare(
                password,
                user.password_hash
            );

            if (!passwordMatches) {
                return res.status(401).json({
                    success: false,
                    message: 'Invalid email or password.'
                });
            }

            if (user.email_verified_at) {
                return res.status(400).json({
                    success: false,
                    message: 'Email is already verified.'
                });
            }

            // Enforce 60-second cooldown using UTC database time.
            const [recentTokens] = await pool.execute(
                `SELECT
                    created_at > DATE_SUB(
                        UTC_TIMESTAMP(), INTERVAL 60 SECOND
                    ) AS too_soon
                 FROM email_verification_tokens
                 WHERE user_id = ?
                 ORDER BY token_id DESC
                 LIMIT 1`,
                [user.user_id]
            );

            if (
                recentTokens.length &&
                recentTokens[0].too_soon
            ) {
                return res.status(429).json({
                    success: false,
                    message: 'Please wait 60 seconds before requesting another code.'
                });
            }

            await sendVerificationEmail(
                user.user_id,
                user.email
            );

            return res.json({
                success: true,
                message: 'A new verification code has been sent.'
            });

        } catch (error) {
            console.error('Resend OTP error:', error);

            return res.status(500).json({
                success: false,
                message: 'Could not resend verification code.'
            });
        }
    }
);

module.exports = router;
