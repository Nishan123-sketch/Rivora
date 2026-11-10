
const jwt = require('jsonwebtoken');
const pool = require('./db');

async function requireAuth(req, res, next) {
    try {
        const sessionUser=await require('./account-sessions').sessionUser(req,pool);
        if(sessionUser){
            if(sessionUser.must_change_password&&!['/profile','/profile/password','/auth/logout','/auth/me','/auth/session'].some(p=>req.originalUrl?.split('?')[0].endsWith(p)))return res.status(403).json({success:false,message:'Change your initial password before continuing.'});
            req.user=sessionUser;return next();
        }
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
            `SELECT user_id, email, email_verified_at, display_name, role, account_status, student_id, must_change_password, sessions_revoked_at
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

        if((rows[0].account_status&&rows[0].account_status!=='ACTIVE')||(rows[0].sessions_revoked_at&&decoded.iat*1000<=Date.parse(String(rows[0].sessions_revoked_at).replace(' ','T')+'Z')))return res.status(401).json({success:false,message:'Session is no longer valid.'});
        if(rows[0].must_change_password&&!req.originalUrl?.split('?')[0].endsWith('/profile/password'))return res.status(403).json({success:false,message:'Change your initial password before continuing.'});

        req.user = {
            ...require('./account-sessions').publicUser(rows[0]),
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
