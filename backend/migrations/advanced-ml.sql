-- Additive only. Existing readings, thresholds, users and subscriptions are preserved.
CREATE TABLE IF NOT EXISTS ml_source_coverage (
 coverage_id CHAR(64) PRIMARY KEY, station_code VARCHAR(20) NOT NULL,
 start_at DATETIME NOT NULL, end_at DATETIME NOT NULL,
 status VARCHAR(24) NOT NULL, initial_state VARCHAR(16) NULL,
 source_url VARCHAR(500) NOT NULL, evidence TEXT,
 checked_at DATETIME NOT NULL, INDEX idx_ml_coverage_station_time(station_code,start_at,end_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS ml_dataset_runs (
 dataset_id VARCHAR(80) PRIMARY KEY, created_at DATETIME NOT NULL,
 target_definition VARCHAR(250) NOT NULL, metadata JSON NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS ml_model_versions (
 model_version VARCHAR(100) PRIMARY KEY, station_id INT UNSIGNED NULL,
 prediction_type VARCHAR(40) NOT NULL, status VARCHAR(60) NOT NULL,
 created_at DATETIME NOT NULL, report JSON NOT NULL,
 INDEX idx_ml_model_station(station_id,prediction_type,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS ml_feature_snapshots (
 station_id INT UNSIGNED NOT NULL, observed_at DATETIME NOT NULL,
 generated_at DATETIME NOT NULL, features JSON NOT NULL,
 quality JSON NOT NULL, PRIMARY KEY(station_id,observed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS ml_advanced_predictions (
 prediction_id CHAR(64) PRIMARY KEY, station_id INT UNSIGNED NOT NULL,
 observed_at DATETIME NULL, issued_at DATETIME NOT NULL, valid_at DATETIME NULL,
 horizon_hours SMALLINT NOT NULL, prediction_type VARCHAR(40) NOT NULL,
 model_version VARCHAR(100), prediction_value DOUBLE NULL,
 validation_status VARCHAR(80) NOT NULL, quality_status VARCHAR(60) NOT NULL,
 reason VARCHAR(160) NULL, INDEX idx_ml_prediction_station_time(station_id,issued_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
