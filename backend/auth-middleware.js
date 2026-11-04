
const jwt = require('jsonwebtoken');
const pool = require('./db');

async function requireAuth(req, res, next) {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required.'
            });
        }

        const token = authHeader.slice(7).trim();

        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Authentication token missing.'
            });
        }

        if (!process.env.JWT_SECRET) {
            throw new Error('JWT_SECRET is not configured');
        }

        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET,
            { algorithms: ['HS256'] }
        );

        if (!Number.isSafeInteger(decoded.userId) ||
            decoded.userId <= 0) {
            return res.status(401).json({
                success: false,
                message: 'Invalid authentication token.'
            });
        }

        const [rows] = await pool.execute(
            `SELECT user_id, email, email_verified_at
             FROM users
             WHERE user_id = ?
             LIMIT 1`,
            [decoded.userId]
        );

        if (rows.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'User account not found.'
            });
        }

        req.user = {
            user_id: rows[0].user_id,
            email: rows[0].email,
            email_verified: Boolean(rows[0].email_verified_at)
        };

        next();

    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: 'Session expired. Please log in again.'
            });
        }

        if (error.name === 'JsonWebTokenError' ||
            error.name === 'NotBeforeError') {
            return res.status(401).json({
                success: false,
                message: 'Invalid authentication token.'
            });
        }

        console.error('Authentication error:', error.message);

        return res.status(500).json({
            success: false,
            message: 'Authentication check failed.'
        });
    }
}

module.exports = requireAuth;
