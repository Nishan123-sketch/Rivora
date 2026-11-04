CREATE TABLE IF NOT EXISTS river_gauge_links (
 river_id VARCHAR(80) NOT NULL, station_id INT UNSIGNED NOT NULL,
 verification_status VARCHAR(30) NOT NULL DEFAULT 'UNVERIFIED',
 reference_url VARCHAR(1000), verified_at DATETIME, source_river_name VARCHAR(100),
 last_verified_observation_at DATETIME, verification_method VARCHAR(100),
 PRIMARY KEY(river_id,station_id)
);
CREATE TABLE IF NOT EXISTS station_rainfall_links (
 station_id INT UNSIGNED PRIMARY KEY, aws_station_code VARCHAR(50) NOT NULL,
 verification_status VARCHAR(30) NOT NULL DEFAULT 'UNVERIFIED', reference_url VARCHAR(1000) NOT NULL
);
CREATE TABLE IF NOT EXISTS prediction_history (
 prediction_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 station_id INT UNSIGNED NOT NULL, observed_at DATETIME NOT NULL, valid_at DATETIME NOT NULL,
 generated_at DATETIME NOT NULL, model_version VARCHAR(100) NOT NULL,
 predicted_water_level DECIMAL(10,4), risk_score DECIMAL(5,2), risk_level VARCHAR(20),
 status VARCHAR(80) NOT NULL, reason TEXT, features_json JSON,
 UNIQUE KEY uq_prediction (station_id,observed_at,model_version),
 INDEX idx_prediction_time (station_id,valid_at)
);
CREATE TABLE IF NOT EXISTS official_alert_snapshots (
 snapshot_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 fetched_at DATETIME NOT NULL, provider VARCHAR(40) NOT NULL, payload JSON NOT NULL
);
CREATE TABLE IF NOT EXISTS river_locations (
 river_id VARCHAR(80) PRIMARY KEY, latitude DECIMAL(9,6) NOT NULL, longitude DECIMAL(9,6) NOT NULL,
 source_url VARCHAR(1000) NOT NULL
);
