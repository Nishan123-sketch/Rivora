const express = require('express');
const pool = require('./db');
const { cached } = require('./ttl-cache');

const router = express.Router();
const LATEST_TTL_MS = Number(process.env.LATEST_CACHE_SECONDS || 30) * 1000;

// PERFORMANCE NOTE
// The old queries used  "WHERE w.observed_at = (SELECT MAX(...) WHERE station_id = w.station_id)".
// MySQL then scans EVERY row of the readings table and runs a sub-query per row, which gets
// slower every day as history grows. Here the latest timestamp per station is found with
// GROUP BY + MAX() over the (station_id, observed_at) unique index (a cheap index-only scan),
// and only those few rows are joined back.

// 1. Get all monitoring stations
router.get('/stations', async (req, res) => {
    try {
        const rows = await cached('stations', 60000, async () => {
            const [r] = await pool.execute(`
                SELECT station_id, station_name, latitude, longitude, data_source, external_station_id
                FROM stations
                ORDER BY data_source, station_name
            `);
            return r;
        });
        res.json({ success: true, count: rows.length, data: rows });
    } catch (error) {
        console.error('Stations API error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch stations' });
    }
});

// 2. Get latest weather observation per station
router.get('/weather/latest', async (req, res) => {
    try {
        const rows = await cached('weather-latest', LATEST_TTL_MS, async () => {
            const [r] = await pool.query(`
                SELECT
                    s.station_id, s.station_name, s.latitude, s.longitude,
                    w.observed_at, w.temperature, w.rainfall, w.humidity, w.wind_speed,
                    aws.observed_at     AS aws_observed_at,
                    aws.hourly_rainfall AS aws_hourly_rainfall,
                    aws.daily_rainfall  AS aws_daily_rainfall,
                    aws.aws_station_code AS aws_station_code
                FROM stations s
                JOIN (SELECT station_id, MAX(observed_at) AS observed_at
                        FROM weather_readings GROUP BY station_id) lw
                  ON lw.station_id = s.station_id
                JOIN weather_readings w
                  ON w.station_id = lw.station_id AND w.observed_at = lw.observed_at
                LEFT JOIN (SELECT aws_station_code, MAX(observed_at) AS observed_at
                             FROM aws_rainfall_readings GROUP BY aws_station_code) la
                  ON la.aws_station_code = CAST(s.external_station_id AS CHAR)
                LEFT JOIN aws_rainfall_readings aws
                  ON aws.aws_station_code = la.aws_station_code AND aws.observed_at = la.observed_at
                WHERE s.data_source = 'KMA'
                ORDER BY s.station_name
            `);
            return r;
        });
        res.json({ success: true, count: rows.length, data: rows });
    } catch (error) {
        console.error('Weather API error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch weather data' });
    }
});

// 3. Get latest water observation per station
router.get('/water/latest', async (req, res) => {
    try {
        const rows = await cached('water-latest', LATEST_TTL_MS, async () => {
            const [r] = await pool.query(`
                SELECT
                    s.station_id, s.station_name, s.latitude, s.longitude,
                    w.observed_at, w.water_level, w.flow_rate
                FROM stations s
                JOIN (SELECT station_id, MAX(observed_at) AS observed_at
                        FROM water_readings GROUP BY station_id) lw
                  ON lw.station_id = s.station_id
                JOIN water_readings w
                  ON w.station_id = lw.station_id AND w.observed_at = lw.observed_at
                WHERE s.data_source IN ('KWATER', 'RIVER_GAUGE')
                ORDER BY s.station_name
            `);
            return r;
        });
        res.json({ success: true, count: rows.length, data: rows });
    } catch (error) {
        console.error('Water API error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch water data' });
    }
});

module.exports = router;
